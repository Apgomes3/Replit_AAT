// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'maximum-tan-profile-route-test-secret';
const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  profile_code: 'PUBLIC_AQUARIUM',
  profile_name: 'Public Aquarium',
  revision: 1,
  max_tan_mg_n_l: '0.1',
  engineering_note: 'Starting assumption.',
  status: 'Approved',
  is_default: true,
};

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('FROM lss_max_tan_profiles') && sql.includes('ORDER BY is_default')) {
      return { rows: [profile] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      state.calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT * FROM lss_max_tan_profiles WHERE id=$1 FOR UPDATE')) return { rows: [profile] };
      if (sql.includes('SET is_default=false')) return { rows: [] };
      if (sql.includes('SET is_default=true')) return { rows: [profile] };
      throw new Error(`Unexpected client query: ${sql}`);
    }),
    release: vi.fn(),
  };
  return {
    query,
    default: { query, connect: vi.fn(async () => client) },
  };
});

function request(app: Express, method: string, path: string, role: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const payload = body == null ? null : JSON.stringify(body);
      const token = jwt.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
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
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('Maximum TAN profile routes', () => {
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
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('lists active controlled profiles and identifies the server default for an authenticated designer', async () => {
    const response = await request(app, 'GET', '/api/v1/biological-media/max-tan-profiles?approved_only=true', 'engineer');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([profile]);
    expect(response.body.default_profile).toMatchObject({
      profile_code: 'PUBLIC_AQUARIUM',
      max_tan_mg_n_l: '0.1',
      is_default: true,
    });
  });

  it('rejects profile management by non-administrators', async () => {
    const response = await request(app, 'POST', '/api/v1/admin/biological-media/max-tan-profiles', 'engineer', {
      profile_code: 'OTHER',
      profile_name: 'Other',
      max_tan_mg_n_l: 0.2,
    });

    expect(response.status).toBe(403);
  });

  it('rejects invalid administrator values before writing a revision', async () => {
    const response = await request(app, 'POST', '/api/v1/admin/biological-media/max-tan-profiles', 'admin', {
      profile_code: 'BAD',
      profile_name: 'Bad',
      max_tan_mg_n_l: -0.1,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
    expect(state.calls.some(call => call.sql.includes('INSERT INTO lss_max_tan_profiles'))).toBe(false);
  });

  it('moves the effective default transactionally for an administrator', async () => {
    const response = await request(
      app,
      'PATCH',
      `/api/v1/admin/biological-media/max-tan-profiles/${profile.id}/default`,
      'admin',
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: profile.id, is_default: true });
    expect(state.calls.map(call => call.sql)).toEqual(expect.arrayContaining([
      'BEGIN',
      expect.stringContaining('SET is_default=false'),
      expect.stringContaining('SET is_default=true'),
      'COMMIT',
    ]));
  });
});