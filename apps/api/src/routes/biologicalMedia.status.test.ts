// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'biological-media-status-test-secret';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  profiles: {
    tan: {
      id: 'tan-profile-1',
      profile_code: 'TAN-TEST',
      profile_name: 'Test TAN profile',
      coefficient: 0.09216,
      coefficient_unit: 'kg TAN-N/kg feed protein',
      recommended_application: 'Test approval',
      scope_type: 'Global feeding',
      scope_unit: null,
      scope_min: null,
      scope_max: null,
      evidence_reference: 'TAN-REF-TEST',
      status: 'Draft',
    },
    media: {
      id: 'media-profile-1',
      profile_code: 'MEDIA-TEST',
      profile_name: 'Test media profile',
      water_types: ['Freshwater'],
      reactor_types: ['Moving bed biofilter'],
      capacity_model: 'MANUAL',
      capacity_model_version: '1',
      capacity_basis_unit: 'g TAN/m3/day',
      operating_min_temperature_c: 10,
      operating_max_temperature_c: 28,
      operating_min_salinity_ppt: 0,
      operating_max_salinity_ppt: 5,
      media_min_depth_mm: 500,
      media_max_depth_mm: 1200,
      media_void_fraction: 0.65,
      media_bulk_density_kg_m3: 110,
      evidence_reference: 'MEDIA-REF-TEST',
      status: 'Draft',
    },
  } as Record<string, any>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });

    if (sql.includes('SELECT rma.access_level')) return { rows: [] };
    if (sql.includes('SELECT * FROM lss_tan_generation_profiles WHERE id=$1')) {
      return { rows: [{ ...state.profiles.tan }] };
    }
    if (sql.includes('SELECT * FROM lss_biological_media_profiles WHERE id=$1')) {
      return { rows: [{ ...state.profiles.media }] };
    }
    if (sql.includes('UPDATE lss_tan_generation_profiles SET status=')
        || sql.includes('UPDATE lss_biological_media_profiles SET status=')) {
      // PostgreSQL raises 42P08 for the old query because $1 is reused as
      // both a VARCHAR column value and an untyped comparison operand.
      if (!sql.includes('$1::varchar')) {
        const error: any = new Error('inconsistent types deduced for parameter $1');
        error.code = '42P08';
        throw error;
      }
      const profile = sql.includes('lss_tan_generation_profiles')
        ? state.profiles.tan
        : state.profiles.media;
      return { rows: [{ ...profile, status: params[0] }] };
    }
    return { rows: [] };
  });

  return {
    default: { query, connect: vi.fn() },
    query,
  };
});

function request(
  app: Express,
  method: string,
  path: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(JSON.stringify(body)),
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
      req.end(JSON.stringify(body));
    });
    server.on('error', reject);
  });
}

describe('Biological Media profile status updates', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: biologicalMediaRoutes } = await import('./biologicalMedia');
    app = express();
    app.use(express.json());
    app.use('/api/v1', biologicalMediaRoutes);
    token = jwt.sign({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }, testSecret);
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.profiles.tan.status = 'Draft';
    state.profiles.media.status = 'Draft';
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('approves TAN profiles when the reused status parameter is explicitly typed', async () => {
    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/biological-media/tan-profiles/tan-profile-1/status',
      token,
      { status: 'Approved' },
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Approved');
    const update = state.calls.find(call => call.sql.includes('UPDATE lss_tan_generation_profiles'));
    expect(update?.sql.match(/\$1::varchar/g)).toHaveLength(4);
  });

  it('approves media profiles through the same type-safe status path', async () => {
    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/biological-media/media-profiles/media-profile-1/status',
      token,
      { status: 'Approved' },
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Approved');
    const update = state.calls.find(call => call.sql.includes('UPDATE lss_biological_media_profiles'));
    expect(update?.sql.match(/\$1::varchar/g)).toHaveLength(4);
  });
});