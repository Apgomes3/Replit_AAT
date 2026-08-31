// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'edp-secret-change-in-production';
const state = vi.hoisted(() => ({
  bomRows: [] as any[],
  lineRows: [] as any[],
}));

vi.mock('../db', () => ({
  default: { connect: vi.fn() },
  query: vi.fn(async (sql: string) => {
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('FROM standard_boms sb')) return { rows: state.bomRows };
    if (sql.includes('FROM bom_lines bl')) return { rows: state.lineRows };
    return { rows: [] };
  }),
}));

let app: Express;

beforeAll(async () => {
  const { default: routes } = await import('./lssCompactUnits');
  app = express();
  app.use(express.json());
  app.use('/api/v1', routes);
});

beforeEach(() => {
  state.bomRows = [];
  state.lineRows = [];
});

function request(method: string, path: string, payload?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const body = payload === undefined ? '' : JSON.stringify(payload);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: {
          Authorization: `Bearer ${jwt.sign({ id: 'user-1', email: 'user@example.com', role: 'engineer' }, testSecret)}`,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => server.close(() => resolve({
          status: response.statusCode || 0,
          body: text ? JSON.parse(text) : {},
        })));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  });
}

describe('LSS compact-unit BOM API', () => {
  it('returns a normalized applicable BOM with optional and size details', async () => {
    state.bomRows = [{
      id: 'bom-1',
      bom_code: 'BOM-CU-1',
      revision_code: 'C',
      product_master_id: 'product-1',
      product_code: 'CU-1',
      product_name: 'Compact One',
    }];
    state.lineRows = [{
      id: 'line-1',
      line_number: 10,
      component_id: 'component-1',
      component_type: 'Filter',
      component_reference_code: 'FLT-1',
      resolved_component_name: 'Drum Filter',
      quantity: '2',
      unit: 'EA',
      is_optional: true,
      source_size_or_power: '100 micron',
    }];

    const response = await request('GET', '/api/v1/lss-compact-units/bom/product-1');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      available: true,
      bom: { bom_code: 'BOM-CU-1', revision_code: 'C' },
      lines: [{
        source_bom_line_id: 'line-1',
        component_reference_code: 'FLT-1',
        component_name: 'Drum Filter',
        quantity: 2,
        is_optional: true,
        included: true,
        is_filtration: true,
        size_or_power: '100 micron',
      }],
    });
  });

  it('distinguishes missing and empty BOMs without blocking manual configuration', async () => {
    expect((await request('GET', '/api/v1/lss-compact-units/bom/product-1')).body)
      .toMatchObject({ available: false, reason: 'missing_bom', lines: [] });
    state.bomRows = [{ id: 'bom-1', bom_code: 'EMPTY', revision_code: 'A' }];
    expect((await request('GET', '/api/v1/lss-compact-units/bom/product-1')).body)
      .toMatchObject({ available: false, reason: 'empty_bom', lines: [] });
  });

  it('rejects invalid equipment snapshots before persistence', async () => {
    const response = await request('POST', '/api/v1/lss-compact-units', {
      unit_code: 'CU-1',
      unit_name: 'Compact One',
      equipment: [{ component_name: 'Filter', quantity: -1, included: true }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION',
      message: 'equipment[0].quantity must be a non-negative number',
    });
  });

  it('requires explicit confirmation before a reimport can change a snapshot', async () => {
    const response = await request('POST', '/api/v1/lss-compact-units/unit-1/reimport-bom', { confirm: false });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CONFIRMATION_REQUIRED');
  });
});