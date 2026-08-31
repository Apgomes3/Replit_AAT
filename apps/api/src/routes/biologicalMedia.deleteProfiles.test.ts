// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'biological-media-delete-profile-test-secret';
const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  status: 'Draft',
  referenced: false,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('SELECT * FROM lss_tan_generation_profiles WHERE id=$1')) {
      return {
        rows: [{
          id: 'tan-profile-1',
          profile_code: 'TAN-TEST',
          profile_name: 'Test TAN profile',
          status: state.status,
        }],
      };
    }
    if (sql.includes('AS referenced_by_cases')) {
      return { rows: [{ referenced_by_cases: state.referenced, referenced_by_runs: false }] };
    }
    if (sql.includes('DELETE FROM lss_tan_generation_profiles')) {
      return { rows: [{ id: 'tan-profile-1' }] };
    }
    return { rows: [] };
  });
  return {
    query,
    default: { query, connect: vi.fn() },
  };
});

function request(app: Express) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const token = jwt.sign({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }, testSecret);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'DELETE',
        path: '/api/v1/admin/biological-media/tan-profiles/tan-profile-1',
        headers: { Authorization: `Bearer ${token}` },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({ status: res.statusCode || 0, body: response ? JSON.parse(response) : {} });
        }));
      });
      req.on('error', reject);
      req.end();
    });
  });
}

describe('Biological Media profile deletion', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: routes } = await import('./biologicalMedia');
    app = express();
    app.use(express.json());
    app.use('/api/v1', routes);
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.status = 'Draft';
    state.referenced = false;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('deletes an unreferenced Draft revision', async () => {
    const response = await request(app);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: true, id: 'tan-profile-1' });
    expect(state.calls.some(call => call.sql.includes("DELETE FROM lss_tan_generation_profiles WHERE id=$1 AND status='Draft'"))).toBe(true);
  });

  it('keeps referenced Draft revisions and directs the administrator to Retire', async () => {
    state.referenced = true;
    const response = await request(app);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROFILE_REFERENCED');
    expect(response.body.error.message).toMatch(/use Retire instead/i);
    expect(state.calls.some(call => call.sql.includes('DELETE FROM lss_tan_generation_profiles'))).toBe(false);
  });

  it('never permanently deletes an Approved revision', async () => {
    state.status = 'Approved';
    const response = await request(app);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROFILE_MUST_BE_RETIRED');
    expect(response.body.error.message).toMatch(/use Retire instead/i);
  });
});