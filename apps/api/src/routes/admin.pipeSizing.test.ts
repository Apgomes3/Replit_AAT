// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'admin-pipe-sizing-test-secret';
const state = vi.hoisted(() => ({ failOperation: '' }));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT dn FROM pipe_sizing_standards')) return { rows: [{ dn: 40 }] };
    if (sql.includes('SELECT 1 FROM design_book_exhibit_hydraulics')) return { rows: [] };
    if ((state.failOperation === 'update' && sql.includes('UPDATE pipe_sizing_standards')) ||
        (state.failOperation === 'delete' && sql.includes('DELETE FROM pipe_sizing_standards'))) {
      throw Object.assign(new Error('foreign key violation'), { code: '23503' });
    }
    return { rows: [{ id: 'standard-1', dn: 40 }] };
  });
  return { query, default: { query } };
});

function request(app: Express, token: string, method: 'PUT' | 'DELETE', body?: object) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No server address'));
      const payload = body ? JSON.stringify(body) : '';
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: '/api/v1/admin/pipe-sizing-standards/standard-1',
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, res => {
        let response = '';
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(() => resolve({
          status: res.statusCode || 0,
          body: response ? JSON.parse(response) : null,
        })));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('admin pipe sizing standard conflicts', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: routes } = await import('./admin');
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', routes);
    token = jwt.sign({ id: 'admin-1', role: 'admin' }, testSecret);
  });

  beforeEach(() => { state.failOperation = ''; });

  it('returns an in-use conflict when a concurrent save blocks a DN rename', async () => {
    state.failOperation = 'update';
    const response = await request(app, token, 'PUT', {
      dn: 40,
      internal_diameter_mm: 41,
      pressure_velocity_min_m_s: 1.5,
      pressure_velocity_max_m_s: 3,
      gravity_velocity_min_m_s: 0.1,
      gravity_velocity_max_m_s: 1.5,
      is_active: true,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IN_USE');
  });

  it('returns an in-use conflict when a concurrent save blocks deletion', async () => {
    state.failOperation = 'delete';
    const response = await request(app, token, 'DELETE');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IN_USE');
  });
});