// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'flow-route-allocation-test-secret';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  currentSystem: {
    id: 'system-1',
    project_id: 'project-1',
    water_type: 'Freshwater',
    loop1_flow_pct: '40',
    loop1_bio_degas_pct: '25',
    loop2_flow_pct: null,
    loop2_bio_degas_pct: null,
    loop3_flow_pct: null,
    loop3_bio_degas_pct: null,
  } as Record<string, any>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) {
      return { rows: [{ access_level: 'manage' }] };
    }
    if (sql.includes('SELECT * FROM systems WHERE id=$1')) {
      return { rows: [{ ...state.currentSystem }] };
    }
    if (sql.includes('SELECT DISTINCT water_type FROM exhibits')) {
      return { rows: [] };
    }
    if (sql.includes('UPDATE systems SET')) {
      return { rows: [{ ...state.currentSystem, id: params[31] }] };
    }
    return { rows: [] };
  });
  return {
    default: { connect: vi.fn() },
    query,
  };
});

vi.mock('../db/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

function request(app: Express, body: Record<string, any>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const token = jwt.sign(
        { id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' },
        testSecret,
      );
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'PUT',
        path: '/api/v1/systems/system-1',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => {
          server.close(error => {
            if (error) return reject(error);
            resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
          });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

const basePayload = {
  system_code: 'LSS-01',
  system_name: 'Primary Life Support',
  system_type: 'Life Support',
  design_flow_m3h: 100,
  turnover_rate_hr: 2,
  water_type: 'Freshwater',
  status: 'Draft',
  loop1_flow_source: 'Bottom Drain',
  loop1_filtration: 'Sand Filter',
  loop1_bio_degas_m3h: 12,
  loop1_link_bio_degas: true,
  loop2_flow_source: 'Surface Skim',
  loop2_filtration: 'Pressurized Bag Filter',
  loop2_bio_degas_m3h: null,
  loop2_link_bio_degas: false,
  loop3_flow_source: null,
  loop3_filtration: null,
  loop3_bio_degas_m3h: null,
  loop3_link_bio_degas: false,
};

describe('system Flow Route allocation persistence', () => {
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
    state.currentSystem.loop1_flow_pct = '40';
    state.currentSystem.loop1_bio_degas_pct = '25';
    state.currentSystem.loop2_flow_pct = null;
    state.currentSystem.loop2_bio_degas_pct = null;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('rejects active loop allocation totals above 100 percent', async () => {
    const response = await request(app, {
      ...basePayload,
      loop1_flow_pct: 60,
      loop1_bio_degas_pct: 25,
      loop2_flow_pct: 50,
      loop2_bio_degas_pct: null,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('FLOW_ALLOCATION_EXCEEDS_100');
    expect(response.body.error.message).toContain('110.0%');
    expect(state.calls.some(call => call.sql.includes('UPDATE systems SET'))).toBe(false);
  });

  it('persists nullable loop and branch percentages independently', async () => {
    const response = await request(app, {
      ...basePayload,
      loop1_flow_pct: 55,
      loop1_bio_degas_pct: null,
      loop2_flow_pct: 45,
      loop2_bio_degas_pct: 30,
    });

    expect(response.status).toBe(200);
    const update = state.calls.find(call => call.sql.includes('UPDATE systems SET'));
    expect(update?.params[11]).toBe(55);
    expect(update?.params[12]).toBeNull();
    expect(update?.params[17]).toBe(45);
    expect(update?.params[18]).toBe(30);
  });

  it('preserves reviewed percentages when an older client omits the new fields', async () => {
    const response = await request(app, basePayload);

    expect(response.status).toBe(200);
    const update = state.calls.find(call => call.sql.includes('UPDATE systems SET'));
    expect(update?.params[11]).toBe(40);
    expect(update?.params[12]).toBe(25);
  });

  it('rejects individual percentages outside the allowed range', async () => {
    const response = await request(app, {
      ...basePayload,
      loop1_flow_pct: 40,
      loop1_bio_degas_pct: 101,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION',
      message: 'Loop 1 Bio/Degas allocation must be between 0% and 100%.',
    });
  });
});