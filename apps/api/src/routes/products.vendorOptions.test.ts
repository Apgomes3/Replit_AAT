// @vitest-environment node

import express, { Express } from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'vendor-options-test-secret';
const productId = '00000000-0000-0000-0000-000000000101';

const state = vi.hoisted(() => ({
  nextId: 1,
  options: [] as Record<string, any>[],
  lock: Promise.resolve(),
}));

vi.mock('../db', () => {
  const accessQuery = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (sql.startsWith('update vendor_options set')) {
      const row = state.options.find(option => option.id === params[8]);
      if (!row) return { rows: [] };
      Object.assign(row, {
        vendor_name: params[0],
        vendor_item_code: params[2],
        approved_status: params[3],
        unit_price: params[6],
        currency: params[7],
      });
      return { rows: [{ ...row }] };
    }
    return { rows: [] };
  });
  const connect = vi.fn(async () => {
    let releaseLock: (() => void) | undefined;
    return {
      query: vi.fn(async (text: string, params: any[] = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [] };
        if (sql.includes('pg_advisory_xact_lock')) {
          const previous = state.lock;
          state.lock = new Promise<void>(resolve => { releaseLock = resolve; });
          await previous;
          return { rows: [] };
        }
        if (sql.startsWith('select coalesce(max((substring(vendor_option_code')) {
          return { rows: [{ next_number: state.options.length + 1 }] };
        }
        if (sql.startsWith('insert into vendor_options')) {
          const row = {
            id: `option-${state.nextId++}`,
            vendor_option_code: params[0],
            product_master_id: params[1],
            vendor_name: params[2],
            vendor_item_code: params[4],
            approved_status: params[5],
            unit_price: params[8],
            currency: params[9],
          };
          state.options.push(row);
          return { rows: [row] };
        }
        return { rows: [] };
      }),
      release: () => releaseLock?.(),
    };
  });
  return { query: accessQuery, default: { query: accessQuery, connect } };
});

function request(app: Express, method: string, path: string, token: string, body: Record<string, unknown>) {
  return new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not determine test server port'));
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
        }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

describe('vendor option system codes', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: productRoutes } = await import('../modules/pim/products');
    app = express();
    app.use(express.json());
    app.use('/api/v1', productRoutes);
    token = jwt.sign({ id: 'actor-1', email: 'actor@example.com', role: 'engineer' }, testSecret);
  });

  beforeEach(() => {
    state.nextId = 1;
    state.options.length = 0;
    state.lock = Promise.resolve();
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('allocates different sequential codes for concurrent creates and ignores supplied codes', async () => {
    const [first, second] = await Promise.all([
      request(app, 'POST', '/api/v1/vendor-options', token, {
        product_master_id: productId,
        vendor_name: 'Vendor A',
        vendor_option_code: 'VO-999999',
      }),
      request(app, 'POST', '/api/v1/vendor-options', token, {
        product_master_id: productId,
        vendor_name: 'Vendor B',
        vendor_option_code: 'MANUAL-CODE',
      }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect([first.body.vendor_option_code, second.body.vendor_option_code].sort()).toEqual([
      'VO-000001',
      'VO-000002',
    ]);
  });

  it('does not allow an update payload to overwrite the allocated code', async () => {
    const created = await request(app, 'POST', '/api/v1/vendor-options', token, {
      product_master_id: productId,
      vendor_name: 'Vendor A',
    });
    const updated = await request(app, 'PUT', `/api/v1/vendor-options/${created.body.id}`, token, {
      vendor_name: 'Vendor A updated',
      vendor_option_code: 'VO-888888',
    });

    expect(updated.status).toBe(200);
    expect(updated.body.vendor_option_code).toBe('VO-000001');
    expect(updated.body.vendor_name).toBe('Vendor A updated');
  });
});