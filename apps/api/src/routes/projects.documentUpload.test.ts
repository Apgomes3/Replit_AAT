// @vitest-environment node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'project-document-upload-test-secret';
const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  moduleAccess: {} as Record<string, string>,
  classificationActive: true,
  transactionFails: false,
  persisted: {
    documents: [] as string[],
    revisions: [] as string[],
    links: [] as string[],
  },
  downloadFilePath: '',
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) {
      return { rows: [{ access_level: state.moduleAccess[String(params[1])] || 'manage' }] };
    }
    if (sql.includes('SELECT id FROM projects')) return { rows: [{ id: 'project-1' }] };
    if (sql.includes('SELECT * FROM documents WHERE id=$1')) {
      return { rows: [{ id: 'document-1', generated_source: null }] };
    }
    if (sql.includes('SELECT * FROM document_revisions WHERE document_id=$1 ORDER BY created_at DESC')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT id FROM document_revisions WHERE document_id=$1')) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO document_revisions')) {
      return { rows: [{ id: 'revision-2', document_id: 'document-1' }] };
    }
    if (sql.includes('FROM document_classifications')) {
      return { rows: state.classificationActive ? [{ code: params[0] }] : [] };
    }
    if (sql.includes('FROM document_revisions dr') && sql.includes('dr.file_path')) {
      return { rows: state.downloadFilePath ? [{
        file_path: state.downloadFilePath,
        file_name: 'basis.txt',
      }] : [] };
    }
    return { rows: [] };
  });
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      state.calls.push({ sql, params });
      if (state.transactionFails && sql.includes('INSERT INTO document_project_links')) {
        throw new Error('link failed');
      }
      if (sql.includes('INSERT INTO documents')) {
        state.persisted.documents.push('document-1');
        return {
          rows: [{
            id: 'document-1',
            document_code: params[0],
            document_title: params[1],
            classification: params[2],
            current_revision: 'A',
            status: 'Draft',
          }],
        };
      }
      if (sql.includes('INSERT INTO document_revisions')) state.persisted.revisions.push('revision-1');
      if (sql.includes('INSERT INTO document_project_links')) state.persisted.links.push('link-1');
      return { rows: [] };
    }),
  };
  return {
    default: {},
    query,
    withTransaction: vi.fn(async (work: (client: any) => Promise<any>) => {
      const snapshot = {
        documents: [...state.persisted.documents],
        revisions: [...state.persisted.revisions],
        links: [...state.persisted.links],
      };
      try {
        return await work(client);
      } catch (error) {
        state.persisted.documents = snapshot.documents;
        state.persisted.revisions = snapshot.revisions;
        state.persisted.links = snapshot.links;
        throw error;
      }
    }),
  };
});

vi.mock('../db/audit', () => ({ logAudit: vi.fn(async () => undefined) }));

function multipartRequest(
  app: Express,
  fields: Record<string, string>,
  role = 'engineer',
  includeFile = true,
  fileName = 'basis.txt',
  fileContent = 'controlled document content',
  requestPath = '/api/v1/projects/project-1/documents',
) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const boundary = `----test-${Date.now()}`;
    const chunks: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    if (includeFile) {
      chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`,
      ));
      chunks.push(Buffer.from(fileContent));
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const payload = Buffer.concat(chunks);

    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const token = jwt.sign({ id: 'user-1', email: 'user@example.com', role }, testSecret);
      const request = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: requestPath,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length,
        },
      }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({ status: response.statusCode || 0, body: data ? JSON.parse(data) : {} });
        }));
      });
      request.on('error', reject);
      request.end(payload);
    });
  });
}

function downloadRequest(app: Express, authorize: boolean) {
  return new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const headers: Record<string, string> = {};
      if (authorize) {
        headers.Authorization = `Bearer ${jwt.sign({ id: 'user-1', email: 'user@example.com', role: 'engineer' }, testSecret)}`;
      }
      const request = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'GET',
        path: '/api/v1/documents/document-1/revisions/revision-1/download',
        headers,
      }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({
            status: response.statusCode || 0,
            body: Buffer.concat(chunks),
            headers: response.headers,
          });
        }));
      });
      request.on('error', reject);
      request.end();
    });
  });
}

const uploadsDir = path.join(__dirname, '../../uploads');
const privateUploadsDir = path.join(__dirname, '../../private-uploads/documents');
const uploadedFiles = () => new Set(
  fs.existsSync(privateUploadsDir)
    ? fs.readdirSync(privateUploadsDir)
    : [],
);

describe('project document upload', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: projectRoutes } = await import('./projects');
    const { default: documentRoutes } = await import('./documents');
    app = express();
    app.use('/api/v1', projectRoutes);
    app.use('/api/v1', documentRoutes);
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: { code: 'SERVER_ERROR' } });
    });
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.moduleAccess = {};
    state.classificationActive = true;
    state.transactionFails = false;
    state.persisted = { documents: [], revisions: [], links: [] };
    state.downloadFilePath = '';
  });

  it('creates the document, initial revision, and project association with file evidence', async () => {
    const before = uploadedFiles();
    const response = await multipartRequest(app, {
      document_code: 'DOC-001',
      document_title: 'Hydraulic Basis',
      classification: 'Design',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ document_code: 'DOC-001', classification: 'Design', current_revision: 'A' });
    const documentInsert = state.calls.find(call => call.sql.includes('INSERT INTO documents'));
    expect(documentInsert?.params).toEqual(['DOC-001', 'Hydraulic Basis', 'Design', 'user-1']);
    const revisionInsert = state.calls.find(call => call.sql.includes('INSERT INTO document_revisions'));
    expect(revisionInsert?.params[0]).toBe('document-1');
    expect(revisionInsert?.params[1]).toBe('user-1');
    expect(revisionInsert?.params[2]).toMatch(/^private-uploads\/documents\/document-.+\.txt$/);
    expect(revisionInsert?.params.slice(3)).toEqual([
      'basis.txt',
      27,
      'text/plain',
      '0db95d3e7bb2efe5b82aac5c72cc6c80633f71355095e90787352c91741d44a6',
    ]);
    expect(state.calls.some(call => call.sql.includes('INSERT INTO document_project_links')
      && call.params[1] === 'project-1')).toBe(true);
    expect(state.persisted).toEqual({
      documents: ['document-1'],
      revisions: ['revision-1'],
      links: ['link-1'],
    });

    const created = [...uploadedFiles()].filter(name => !before.has(name));
    expect(created).toHaveLength(1);
    fs.unlinkSync(path.join(privateUploadsDir, created[0]));
  });

  it('rejects users without a project management role before accepting a file', async () => {
    const before = uploadedFiles();
    const response = await multipartRequest(app, {
      document_code: 'DOC-002',
      document_title: 'Commercial Offer',
      classification: 'Commercial',
    }, 'viewer');

    expect(response.status).toBe(403);
    expect(uploadedFiles()).toEqual(before);
    expect(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
  });

  it('keeps active content private and only serves it as an authenticated attachment', async () => {
    const before = uploadedFiles();
    const activeContent = '<script>localStorage.getItem("edp_token")</script>';
    const upload = await multipartRequest(app, {
      document_code: 'DOC-HTML',
      document_title: 'Active Content',
      classification: 'Design',
    }, 'engineer', true, 'active.html', activeContent);
    expect(upload.status).toBe(201);

    const revisionInsert = state.calls.find(call => call.sql.includes('INSERT INTO document_revisions'));
    state.downloadFilePath = revisionInsert!.params[2];
    const anonymous = await downloadRequest(app, false);
    expect(anonymous.status).toBe(401);

    const authorized = await downloadRequest(app, true);
    expect(authorized.status).toBe(200);
    expect(authorized.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(authorized.headers['content-disposition']).toMatch(/^attachment;/);
    expect(authorized.headers['x-content-type-options']).toBe('nosniff');
    expect(authorized.body.toString()).toBe(activeContent);

    const created = [...uploadedFiles()].filter(name => !before.has(name));
    expect(created).toHaveLength(1);
    fs.unlinkSync(path.join(privateUploadsDir, created[0]));
  });

  it('stores later document revisions outside the public static directory', async () => {
    const before = uploadedFiles();
    const response = await multipartRequest(app, {
      revision_code: 'B',
      revision_purpose: 'Updated evidence',
    }, 'engineer', true, 'revision-b.html', '<script>alert(1)</script>',
    '/api/v1/documents/document-1/revisions');

    expect(response.status).toBe(201);
    const revisionInsert = state.calls.find(call =>
      call.sql.includes('INSERT INTO document_revisions') && call.params[1] === 'B');
    expect(revisionInsert?.params[5]).toMatch(/^private-uploads\/documents\/.+\.html$/);
    expect(revisionInsert?.params[5]).not.toMatch(/^\/uploads\//);

    const created = [...uploadedFiles()].filter(name => !before.has(name));
    expect(created).toHaveLength(1);
    fs.unlinkSync(path.join(privateUploadsDir, created[0]));
  });

  it('rejects read-only module access before accepting a file', async () => {
    state.moduleAccess.documents = 'view';
    const before = uploadedFiles();
    const response = await multipartRequest(app, {
      document_code: 'DOC-002A',
      document_title: 'Read Only Attempt',
      classification: 'Commercial',
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MODULE_READ_ONLY');
    expect(uploadedFiles()).toEqual(before);
    expect(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
  });

  it('rejects inactive classifications and removes the uploaded file', async () => {
    state.classificationActive = false;
    const before = uploadedFiles();
    const response = await multipartRequest(app, {
      document_code: 'DOC-003',
      document_title: 'Unknown Classification',
      classification: 'Legal',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CLASSIFICATION');
    expect(uploadedFiles()).toEqual(before);
    expect(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
  });

  it('removes the file and reports failure when persistence cannot complete', async () => {
    state.transactionFails = true;
    const before = uploadedFiles();
    const response = await multipartRequest(app, {
      document_code: 'DOC-004',
      document_title: 'Failed Association',
      classification: 'Design',
    });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('UPLOAD_FAILED');
    expect(uploadedFiles()).toEqual(before);
    expect(state.persisted).toEqual({ documents: [], revisions: [], links: [] });
  });

  it('requires the uploaded file', async () => {
    const response = await multipartRequest(app, {
      document_code: 'DOC-005',
      document_title: 'Missing File',
      classification: 'Design',
    }, 'engineer', false);

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/file.*required/i);
    expect(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
  });
});