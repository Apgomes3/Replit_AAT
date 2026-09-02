// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'import-access-test-secret';

const state = vi.hoisted(() => ({
  moduleAccessByUser: {} as Record<string, string>,
  missingProjects: new Set<string>(),
  writes: [] as string[],
  pendingWrites: [] as string[],
  failOnInsertCode: undefined as string | undefined,
  transactionActive: false,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (sql === 'begin') {
      state.transactionActive = true;
      state.pendingWrites.length = 0;
      return { rows: [] };
    }
    if (sql === 'commit') {
      state.writes.push(...state.pendingWrites);
      state.pendingWrites.length = 0;
      state.transactionActive = false;
      return { rows: [] };
    }
    if (sql === 'rollback') {
      state.pendingWrites.length = 0;
      state.transactionActive = false;
      return { rows: [] };
    }
    if (sql.startsWith('select rma.access_level')) {
      const accessLevel = state.moduleAccessByUser[String(params[0])];
      return { rows: accessLevel ? [{ access_level: accessLevel }] : [] };
    }
    if (sql.includes('select id from projects where project_code=$1')) {
      if (state.missingProjects.has(String(params[0]))) return { rows: [] };
      return { rows: [{ id: 'project-1' }] };
    }
    if (sql.startsWith('select id from components where upper(component_code)=upper($1)')) {
      return { rows: [] };
    }
    if (sql.startsWith('insert into')) {
      if (state.failOnInsertCode && String(params[0]) === state.failOnInsertCode) {
        throw new Error(`simulated insert failure for ${state.failOnInsertCode}`);
      }
      if (state.transactionActive) {
        state.pendingWrites.push(sql);
      } else {
        state.writes.push(sql);
      }
      return { rows: [] };
    }
    return { rows: [] };
  });
  const withTransaction = vi.fn(async (work: (client: { query: typeof query }) => Promise<unknown>) => {
    await query('BEGIN');
    try {
      const result = await work({ query });
      await query('COMMIT');
      return result;
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  });
  return { query, withTransaction, default: { query } };
});

function multipartBody(csvText: string) {
  const boundary = '----import-access-test-boundary';
  const body = [
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="file"; filename="import.csv"\r\n',
    'Content-Type: text/csv\r\n\r\n',
    `${csvText}\r\n`,
    `--${boundary}--\r\n`,
  ].join('');
  return { boundary, body: Buffer.from(body) };
}

function request(app: Express, path: string, csvText: string, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const multipart = multipartBody(csvText);
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine test server port'));
        return;
      }
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`,
          'Content-Length': multipart.body.length,
        },
      }, response => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { responseBody += chunk; });
        response.on('end', () => {
          server.close(() => resolve({
            status: response.statusCode ?? 0,
            body: responseBody ? JSON.parse(responseBody) : {},
          }));
        });
      });
      req.on('error', error => server.close(() => reject(error)));
      req.end(multipart.body);
    });
  });
}

describe('CSV import access policy', () => {
  let app: Express;
  let adminToken: string;
  let viewerToken: string;
  let hiddenToken: string;
  let engineerToken: string;
  let unlinkSpy: ReturnType<typeof vi.spyOn>;
  let diskUnlinkSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: importRoutes } = await import('./import');
    app = express();
    app.use('/api/v1/import', importRoutes);
    adminToken = jwt.sign({ id: 'import-admin', email: 'admin@example.com', role: 'admin' }, testSecret);
    viewerToken = jwt.sign({ id: 'import-viewer', email: 'viewer@example.com', role: 'viewer' }, testSecret);
    hiddenToken = jwt.sign({ id: 'import-hidden', email: 'hidden@example.com', role: 'contractor' }, testSecret);
    engineerToken = jwt.sign({ id: 'import-engineer', email: 'engineer@example.com', role: 'engineer' }, testSecret);
    unlinkSpy = vi.spyOn(fs.promises, 'unlink');
    diskUnlinkSpy = vi.spyOn(fs, 'unlink');
  });

  beforeEach(() => {
    state.moduleAccessByUser = {
      'import-viewer': 'view',
      'import-hidden': 'hidden',
      'import-engineer': 'manage',
    };
    state.missingProjects.clear();
    state.writes.length = 0;
    state.pendingWrites.length = 0;
    state.failOnInsertCode = undefined;
    state.transactionActive = false;
    unlinkSpy.mockClear();
    diskUnlinkSpy.mockClear();
  });

  afterAll(() => {
    unlinkSpy.mockRestore();
    diskUnlinkSpy.mockRestore();
    delete process.env.JWT_SECRET;
  });

  it.each([
    ['/products', 'product_code,product_name\nPM-ACCESS,Access Product'],
    ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-ACCESS,PRJ-ACCESS,Access Equipment'],
    ['/documents', 'document_code,document_title\nDOC-ACCESS,Access Document'],
    ['/components', 'component_code,component_name\nCMP-ACCESS,Access Component'],
  ])('allows platform admins to import via %s', async (path, csvText) => {
    const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);

    expect(response.status).toBe(200);
  });

  it.each([
    ['/products', 'product_code,product_name\nPM-ACCESS,Access Product'],
    ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-ACCESS,PRJ-ACCESS,Access Equipment'],
    ['/documents', 'document_code,document_title\nDOC-ACCESS,Access Document'],
    ['/components', 'component_code,component_name\nCMP-ACCESS,Access Component'],
  ])('allows module managers to import via %s', async (path, csvText) => {
    const response = await request(app, `/api/v1/import${path}`, csvText, engineerToken);

    expect(response.status).toBe(200);
  });

  it.each([
    ['/products', 'product_code,product_name\nPM-DENIED,Denied Product'],
    ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-DENIED,PRJ-DENIED,Denied Equipment'],
    ['/documents', 'document_code,document_title\nDOC-DENIED,Denied Document'],
    ['/components', 'component_code,component_name\nCMP-DENIED,Denied Component'],
  ])('rejects read-only users with a clear 403 on %s', async (path, csvText) => {
    const response = await request(app, `/api/v1/import${path}`, csvText, viewerToken);

    expect(response.status).toBe(403);
    expect(response.body.error).toEqual({
      code: 'MODULE_READ_ONLY',
      message: 'Manage access is required for this module.',
    });
  });

  it.each([
    ['/products', 'product_code,product_name\nPM-HIDDEN,Hidden Product'],
    ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-HIDDEN,PRJ-HIDDEN,Hidden Equipment'],
    ['/documents', 'document_code,document_title\nDOC-HIDDEN,Hidden Document'],
    ['/components', 'component_code,component_name\nCMP-HIDDEN,Hidden Component'],
  ])('rejects hidden users with a clear 403 on %s', async (path, csvText) => {
    const response = await request(app, `/api/v1/import${path}`, csvText, hiddenToken);

    expect(response.status).toBe(403);
    expect(response.body.error).toEqual({
      code: 'MODULE_HIDDEN',
      message: 'This module is hidden for your role.',
    });
  });

  it.each([
    ['/products', 'product_code,product_name\nPM-CLEAN,Clean Product'],
    ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-CLEAN,PRJ-CLEAN,Clean Equipment'],
    ['/documents', 'document_code,document_title\nDOC-CLEAN,Clean Document'],
  ])('cleans up the temporary file after a successful %s import', async (path, csvText) => {
    const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);

    expect(response.status).toBe(200);
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/products', 'product_code,product_name\nPM-BAD'],
    ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-BAD,PRJ-BAD'],
    ['/documents', 'document_code,document_title\nDOC-BAD'],
  ])('rejects malformed %s uploads before writing and cleans up', async (path, csvText) => {
    const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'INVALID_CSV' });
    expect(response.body.error.message).toContain('Row length does not match headers');
    expect(state.writes).toHaveLength(0);
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      '/products',
      'product_code,product_name\nPM-ROW-1,\n,Second Product',
      ['Product CSV row 2 field "product_name" is required', 'Product CSV row 3 field "product_code" is required'],
    ],
    [
      '/equipment',
      'equipment_code,project_code,equipment_name\nEQ-ROW-1,PRJ-ROW-1,\n,PRJ-ROW-2,Second Equipment',
      ['Equipment CSV row 2 field "equipment_name" is required', 'Equipment CSV row 3 field "equipment_code" is required'],
    ],
    [
      '/documents',
      'document_code,document_title\nDOC-ROW-1,\n,Second Document',
      ['Document CSV row 2 field "document_title" is required', 'Document CSV row 3 field "document_code" is required'],
    ],
  ])('reports all row validation errors before mutating %s', async (path, csvText, expectedErrors) => {
    const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'INVALID_CSV' });
    expect(response.body.errors).toEqual(expectedErrors);
    expect(response.body.error.details).toEqual(expectedErrors);
    expect(response.body.imported).toBe(0);
    expect(response.body.total).toBe(2);
    expect(state.writes).toHaveLength(0);
  });

  it('validates all equipment project references before importing any rows', async () => {
    state.missingProjects.add('PRJ-MISSING');

    const response = await request(
      app,
      '/api/v1/import/equipment',
      'equipment_code,project_code,equipment_name\nEQ-VALID,PRJ-VALID,Valid Equipment\nEQ-MISSING,PRJ-MISSING,Missing Project',
      adminToken,
    );

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      'Equipment CSV row 3 field "project_code": project "PRJ-MISSING" was not found',
    ]);
    expect(state.writes).toHaveLength(0);
  });

  it('rejects a blank equipment project reference before importing earlier rows', async () => {
    const response = await request(
      app,
      '/api/v1/import/equipment',
      'equipment_code,project_code,equipment_name\nEQ-VALID,PRJ-VALID,Valid Equipment\nEQ-BLANK,,Blank Project',
      adminToken,
    );

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      'Equipment CSV row 3 field "project_code" is required',
    ]);
    expect(response.body.imported).toBe(0);
    expect(state.writes).toHaveLength(0);
  });

  it('rejects a padded equipment project reference before importing earlier rows', async () => {
    const response = await request(
      app,
      '/api/v1/import/equipment',
      'equipment_code,project_code,equipment_name\nEQ-VALID,PRJ-VALID,Valid Equipment\nEQ-PADDED, PRJ-PADDED ,Padded Project',
      adminToken,
    );

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      'Equipment CSV row 3 field "project_code" must not have leading or trailing whitespace',
    ]);
    expect(response.body.imported).toBe(0);
    expect(state.writes).toHaveLength(0);
  });

  it.each([
    [
      '/products',
      'product_code,product_name\nPM-FIRST,First Product\nPM-FAIL,Failed Product',
      'PM-FAIL',
      'Product',
    ],
    [
      '/equipment',
      'equipment_code,project_code,equipment_name\nEQ-FIRST,PRJ-FIRST,First Equipment\nEQ-FAIL,PRJ-FAIL,Failed Equipment',
      'EQ-FAIL',
      'Equipment',
    ],
    [
      '/documents',
      'document_code,document_title\nDOC-FIRST,First Document\nDOC-FAIL,Failed Document',
      'DOC-FAIL',
      'Document',
    ],
  ])('rolls back earlier rows when a later %s insert fails', async (path, csvText, failedCode, destination) => {
    state.failOnInsertCode = failedCode;

    const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      imported: 0,
      total: 2,
      error: {
        code: 'IMPORT_FAILED',
      },
    });
    expect(response.body.error.message).toContain(`${destination} CSV import failed; no rows were imported`);
    expect(response.body.error.message).toContain('simulated insert failure');
    expect(state.writes).toHaveLength(0);
    expect(state.pendingWrites).toHaveLength(0);
    expect(state.transactionActive).toBe(false);
  });

  it.each([
    ['/products', 'Product'],
    ['/equipment', 'Equipment'],
    ['/documents', 'Document'],
  ])('rejects oversized %s uploads without leaving a temporary file', async (path, destination) => {
    const oversizedCsv = `code,name\n${'X'.repeat(5 * 1024 * 1024)}`;
    const response = await request(app, `/api/v1/import${path}`, oversizedCsv, adminToken);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      imported: 0,
      skipped: 0,
      total: 0,
      error: {
        code: 'INVALID_UPLOAD',
        message: `${destination} CSV must be 5 MB or smaller`,
      },
    });
    expect(state.writes).toHaveLength(0);
    expect(diskUnlinkSpy).toHaveBeenCalled();
  });
});