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
  documentGeneratedSource: 'pim_tds',
  revisionGeneratedSource: 'pim_tds',
  pdfRevisionFound: true,
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
      return { rows: [{ id: 'revision-1', status: state.status, generated_source: 'pim_tds', revision_generated_source: state.revisionGeneratedSource }] };
    }
    if (sql.includes('document_generated_source')) {
      return {
        rows: state.pdfRevisionFound ? [{
          document_id: 'document-1',
          document_code: 'P-100-TDS',
          document_title: 'Pump Technical Data Sheet',
          document_status: state.status,
          document_generated_source: state.documentGeneratedSource,
          revision_id: 'revision-1',
          revision_code: 'A',
          status: state.status,
          content: state.content,
          generated_at: '2026-09-01T10:00:00.000Z',
          revision_generated_source: state.revisionGeneratedSource,
        }] : [],
      };
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
  return new Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
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
        res.setEncoding('binary');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => error ? reject(error) : resolve({
          status: res.statusCode ?? 0,
          body: response
            ? (res.headers['content-type']?.includes('application/json') ? JSON.parse(response) : Buffer.from(response, 'binary'))
            : {},
          headers: res.headers,
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
    state.documentGeneratedSource = 'pim_tds';
    state.revisionGeneratedSource = 'pim_tds';
    state.pdfRevisionFound = true;
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

  it('does not edit a non-generated revision attached to a generated document', async () => {
    state.revisionGeneratedSource = 'upload';

    const response = await put(app, token, { title: 'Should not save' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('NOT_GENERATED_TDS');
    expect(state.content.title).toBe('Original draft');
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

  it('renders the requested generated revision as an uncached inline PDF without changing lifecycle state', async () => {
    state.status = 'Approved';
    state.content = {
      title: 'Reviewer-owned pump sheet',
      sections: { identity: { product_code: 'P-100', product_name: 'Pump' }, notes: 'Approved wording' },
    };

    const response = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(response.body.toString('binary')).toContain('Reviewer-owned pump sheet');
    expect(state.status).toBe('Approved');
    expect((state.sourceSnapshot.product as Record<string, unknown>).product_name).toBe('Authoritative PIM name');
  });

  it('does not expose a revision that is not linked to the requested document', async () => {
    state.pdfRevisionFound = false;

    const response = await request(app, token, 'GET', '/api/v1/documents/other-document/revisions/revision-1/tds.pdf');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects non-generated revisions and missing generated content', async () => {
    state.revisionGeneratedSource = 'upload';
    const wrongType = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.code).toBe('NOT_GENERATED_TDS');

    state.revisionGeneratedSource = 'pim_tds';
    state.content = null as any;
    const missingContent = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
    expect(missingContent.status).toBe(422);
    expect(missingContent.body.error.code).toBe('TDS_CONTENT_MISSING');
  });

  it('allows view-only users to render but blocks hidden document access', async () => {
    state.moduleAccess = 'view';
    const viewResponse = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
    expect(viewResponse.status).toBe(200);

    state.moduleAccess = 'hidden';
    const hiddenResponse = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
    expect(hiddenResponse.status).toBe(403);
    expect(hiddenResponse.body.error.code).toBe('MODULE_HIDDEN');
  });
});