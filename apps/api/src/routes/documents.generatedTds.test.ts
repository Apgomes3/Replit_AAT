// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'generated-document-content-test-secret';

const state = vi.hoisted(() => ({
  status: 'Draft',
  content: { title: 'Original draft' } as Record<string, unknown>,
  sourceSnapshot: { product: { product_name: 'Authoritative PIM name' } } as Record<string, unknown>,
  moduleAccess: null as string | null,
  documentType: 'Technical Data Sheet',
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('SELECT rma.access_level')) return { rows: state.moduleAccess ? [{ access_level: state.moduleAccess }] : [] };
    if (sql === 'SELECT generated_source FROM documents WHERE id=$1') {
      return { rows: [{ generated_source: 'pim_tds' }] };
    }
    if (sql === 'SELECT generated_source, document_type, status FROM documents WHERE id=$1') {
      return { rows: [{ generated_source: 'pim_tds', document_type: state.documentType, status: state.status }] };
    }
    if (sql.includes('UPDATE documents SET document_title')) {
      state.documentType = params[1];
      state.status = params[3];
      return { rows: [{ id: 'document-1', generated_source: 'pim_tds', document_type: state.documentType, status: state.status }] };
    }
    if (sql.includes('SELECT dr.*, d.generated_source')) {
      return { rows: [{ id: 'revision-1', document_id: 'document-1', revision_code: 'A', status: state.status, generated_source: 'pim_tds' }] };
    }
    if (sql.includes('SELECT dr.id, dr.status, d.generated_source')) {
      return { rows: [{ id: 'revision-1', status: state.status, generated_source: 'pim_tds' }] };
    }
    if (sql.includes('UPDATE document_revisions SET content')) {
      state.content = params[0];
      return {
        rows: [{
          id: 'revision-1',
          document_id: 'document-1',
          status: state.status,
          content: state.content,
          source_snapshot: state.sourceSnapshot,
        }],
      };
    }
    return { rows: [] };
  });
  return { query, default: { query } };
});

function request(app: Express, token: string, method: string, path: string, body?: Record<string, unknown>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const payload = body ? JSON.stringify(body) : '';
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => error ? reject(error) : resolve({
          status: res.statusCode ?? 0,
          body: response ? JSON.parse(response) : {},
        })));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function put(app: Express, token: string, content: Record<string, unknown>) {
  return request(app, token, 'PUT', '/api/v1/documents/document-1/revisions/revision-1/content', { content });
}

describe('generated TDS document-only editing', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: documentRoutes } = await import('./documents');
    app = express();
    app.use(express.json());
    app.use('/api/v1', documentRoutes);
    token = jwt.sign({ id: 'actor-1', email: 'actor@example.com', role: 'engineer' }, testSecret);
  });

  beforeEach(() => {
    state.status = 'Draft';
    state.content = { title: 'Original draft' };
    state.sourceSnapshot = { product: { product_name: 'Authoritative PIM name' } };
    state.moduleAccess = null;
    state.documentType = 'Technical Data Sheet';
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it.each(['Draft', 'Internal Review', 'Review Commented', 'Resubmitted'])(
    'allows document-only edits during %s without changing the PIM source snapshot',
    async status => {
      state.status = status;
      const originalSnapshot = structuredClone(state.sourceSnapshot);

      const response = await put(app, token, { title: 'Reviewer wording' });

      expect(response.status).toBe(200);
      expect(response.body.content.title).toBe('Reviewer wording');
      expect(response.body.source_snapshot).toEqual(originalSnapshot);
    },
  );

  it.each(['Approved', 'Released', 'Rejected'])('keeps %s revisions frozen', async status => {
    state.status = status;

    const response = await put(app, token, { title: 'Should not save' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REVISION_FROZEN');
    expect(state.content.title).toBe('Original draft');
  });

  it('rejects document writes for users with view-only module access', async () => {
    state.moduleAccess = 'view';

    const response = await put(app, token, { title: 'Should not save' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MODULE_READ_ONLY');
  });

  it('prevents generated TDS documents from being reassigned to another product', async () => {
    const response = await request(app, token, 'PUT', '/api/v1/documents/document-1/product', { product_id: 'other-product' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GENERATED_LINK_IMMUTABLE');
  });

  it('preserves generated TDS identity and lifecycle status during metadata edits', async () => {
    state.status = 'Approved';

    const response = await request(app, token, 'PUT', '/api/v1/documents/document-1', {
      document_title: 'Edited title',
      document_type: 'Drawing',
      status: 'Draft',
    });

    expect(response.status).toBe(200);
    expect(response.body.document_type).toBe('Technical Data Sheet');
    expect(response.body.status).toBe('Approved');
  });

  it('prevents an admin from deleting a frozen generated TDS revision', async () => {
    state.status = 'Released';
    const adminToken = jwt.sign({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }, testSecret);

    const response = await request(app, adminToken, 'DELETE', '/api/v1/documents/revisions/revision-1');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REVISION_FROZEN');
  });
});