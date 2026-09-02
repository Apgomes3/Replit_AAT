// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'import-access-test-secret';

const state = vi.hoisted(() => ({
  moduleAccessByUser: {} as Record<string, string>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (sql.startsWith('select rma.access_level')) {
      const accessLevel = state.moduleAccessByUser[String(params[0])];
      return { rows: accessLevel ? [{ access_level: accessLevel }] : [] };
    }
    if (sql.includes('select id from projects where project_code=$1')) {
      return { rows: [{ id: 'project-1' }] };
    }
    if (sql.startsWith('select id from components where upper(component_code)=upper($1)')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { query, default: { query } };
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

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: importRoutes } = await import('./import');
    app = express();
    app.use('/api/v1/import', importRoutes);
    adminToken = jwt.sign({ id: 'import-admin', email: 'admin@example.com', role: 'admin' }, testSecret);
    viewerToken = jwt.sign({ id: 'import-viewer', email: 'viewer@example.com', role: 'viewer' }, testSecret);
    hiddenToken = jwt.sign({ id: 'import-hidden', email: 'hidden@example.com', role: 'contractor' }, testSecret);
    engineerToken = jwt.sign({ id: 'import-engineer', email: 'engineer@example.com', role: 'engineer' }, testSecret);
  });

  beforeEach(() => {
    state.moduleAccessByUser = {
      'import-viewer': 'view',
      'import-hidden': 'hidden',
      'import-engineer': 'manage',
    };
  });

  afterAll(() => {
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
});