// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'exhibit-inheritance-test-secret';

const state = vi.hoisted(() => ({
  source: {
    id: 'exhibit-source',
    project_id: 'project-1',
    water_type: 'Marine',
    design_temperature_min: 24,
    design_temperature_max: 26,
  } as Record<string, any> | null,
  calls: [] as Array<{ sql: string; params: any[] }>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('FROM exhibits WHERE id=$1 AND project_id=$2')) {
      return {
        rows: state.source && params[0] === state.source.id && params[1] === state.source.project_id
          ? [{ ...state.source }]
          : [],
      };
    }
    if (sql.includes('INSERT INTO exhibits')) {
      return { rows: [{ id: 'exhibit-new', water_type: params[4], design_temperature_min: params[5], design_temperature_max: params[6] }] };
    }
    return { rows: [] };
  });
  return { query, default: { query } };
});

function request(app: Express, body: Record<string, unknown>) {
  return new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not determine test server port'));
      const payload = JSON.stringify(body);
      const token = jwt.sign({ id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' }, testSecret);
      const req = http.request({
        host: '127.0.0.1', port: address.port, path: '/api/v1/exhibits', method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, res => {
        let response = '';
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => error
          ? reject(error)
          : resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} })));
      });
      req.on('error', reject);
      req.end(payload);
    });
  });
}

describe('POST /exhibits previous-exhibit inheritance', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: projectRoutes } = await import('./projects');
    app = express();
    app.use(express.json());
    app.use('/api/v1', projectRoutes);
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.source = {
      id: 'exhibit-source', project_id: 'project-1', water_type: 'Marine',
      design_temperature_min: 24, design_temperature_max: 26,
    };
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('copies only missing water type and design temperatures from a same-project exhibit', async () => {
    const response = await request(app, {
      exhibit_code: 'EX-02', exhibit_name: 'New Exhibit', project_id: 'project-1',
      inherit_from_exhibit_id: 'exhibit-source',
    });

    expect(response.status).toBe(201);
    const insert = state.calls.find(call => call.sql.includes('INSERT INTO exhibits'));
    expect(insert?.params).toEqual(['EX-02', 'project-1', undefined, 'New Exhibit', 'Marine', 24, 26, undefined]);
    expect(insert?.sql).not.toContain('inherit_from_exhibit_id');
    expect(state.source).toEqual({
      id: 'exhibit-source', project_id: 'project-1', water_type: 'Marine',
      design_temperature_min: 24, design_temperature_max: 26,
    });
  });

  it('keeps explicitly supplied values instead of inherited values', async () => {
    await request(app, {
      exhibit_code: 'EX-02', exhibit_name: 'New Exhibit', project_id: 'project-1',
      inherit_from_exhibit_id: 'exhibit-source', water_type: 'Freshwater',
      design_temperature_min: 20, design_temperature_max: 22,
    });

    const insert = state.calls.find(call => call.sql.includes('INSERT INTO exhibits'));
    expect(insert?.params.slice(4, 7)).toEqual(['Freshwater', 20, 22]);
  });

  it('rejects a previous exhibit outside the new exhibit project', async () => {
    const response = await request(app, {
      exhibit_code: 'EX-02', exhibit_name: 'New Exhibit', project_id: 'other-project',
      inherit_from_exhibit_id: 'exhibit-source',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REFERENCE');
    expect(state.calls.some(call => call.sql.includes('INSERT INTO exhibits'))).toBe(false);
  });
});