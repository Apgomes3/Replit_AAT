// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'products-audit-summary-test-secret';
const actorId = 'actor-1';

const state = vi.hoisted(() => ({
  auditRows: [] as Array<{
    entityType: string;
    entityId: string;
    action: string;
    details: Record<string, unknown> | null;
  }>,
  listRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (sql.startsWith('select rma.access_level')) return { rows: [] };
    if (sql.startsWith('select count(*) from product_masters pm')) {
      const rows = sql.includes("pm.standard_status is distinct from 'obsolete'")
        ? state.listRows.filter(row => row.standard_status !== 'Obsolete')
        : state.listRows;
      return { rows: [{ count: String(rows.length) }] };
    }
    if (sql.startsWith('select pm.*, coalesce(ph.design_flow_m3h, pm.design_flow_m3h)')) {
      const rows = sql.includes("pm.standard_status is distinct from 'obsolete'")
        ? state.listRows.filter(row => row.standard_status !== 'Obsolete')
        : state.listRows;
      return { rows };
    }
    if (sql.startsWith('select 1 from tanks')) return { rows: [] };
    if (sql.startsWith('select 1 from bom_lines')) return { rows: [] };
    if (sql.startsWith('select id from product_masters where id::text=$1 or product_code=$1')) {
      return { rows: [{ id: 'product-1' }] };
    }
    if (sql.startsWith('insert into product_masters')) {
      return {
        rows: [{
          id: 'product-1',
          product_code: 'P-100',
          product_name: 'Test Product',
          standard_status: 'Concept',
        }],
      };
    }
    if (sql.startsWith('update product_masters set standard_status')) {
      return { rows: [{ id: 'product-1', standard_status: params[0] }] };
    }
    if (sql.startsWith('update product_masters set')) {
      return {
        rows: [{
          id: 'product-1',
          product_code: 'P-100',
          product_name: 'Updated Product',
          standard_status: 'Active',
        }],
      };
    }
    if (sql.startsWith('delete from product_masters')) {
      return { rows: [{ id: 'product-1', product_code: 'P-100' }] };
    }
    if (sql.startsWith('insert into components')) {
      return {
        rows: [{
          id: 'component-1',
          component_code: 'C-100',
          component_name: 'Test Component',
          status: 'Active',
        }],
      };
    }
    if (sql.startsWith('update components set status')) {
      return { rows: [{ id: 'component-1', status: params[0] }] };
    }
    if (sql.startsWith('update components set component_name')) {
      return {
        rows: [{
          id: 'component-1',
          component_code: 'C-100',
          component_name: 'Updated Component',
          status: 'Active',
        }],
      };
    }
    if (sql.startsWith('delete from components')) {
      return { rows: [{ id: 'component-1', component_code: 'C-100' }] };
    }
    if (sql.startsWith('insert into product_hydraulic')) {
      return { rows: [{ product_master_id: 'product-1', venturi_flow_m3h: 12 }] };
    }
    if (sql.startsWith('insert into audit_logs')) {
      state.auditRows.push({
        entityType: String(params[0]),
        entityId: String(params[1]),
        action: String(params[2]),
        details: (params[4] as Record<string, unknown> | null) ?? null,
      });
    }

    return { rows: [] };
  });

  return { query, default: { query } };
});

function request(
  app: Express,
  method: string,
  path: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }

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
        res.on('end', () => {
          server.close(error => {
            if (error) {
              reject(error);
              return;
            }
            try {
              resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
            } catch (error) {
              reject(error);
            }
          });
        });
      });
      req.on('error', error => {
        server.close();
        reject(error);
      });
      req.write(payload);
      req.end();
    });
  });
}

describe('persisted audit summaries for product mutations', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: productRoutes } = await import('./products');
    app = express();
    app.use(express.json());
    app.use('/api/v1', productRoutes);
    token = jwt.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
  });

  beforeEach(() => {
    state.auditRows.length = 0;
    state.listRows.length = 0;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  const expectSummary = (entityType: string, entityId: string, action: string, summary: string) => {
    expect(state.auditRows).toContainEqual(expect.objectContaining({
      entityType,
      entityId,
      action,
      details: expect.objectContaining({ summary }),
    }));
  };

  it('keeps readable summaries for product create, update, delete, and status changes', async () => {
    expect((await request(app, 'POST', '/api/v1/product-masters', token, {
      product_code: 'P-100',
      product_name: 'Test Product',
    })).status).toBe(201);
    expectSummary('product', 'product-1', 'CREATE', 'Product P-100 created');

    expect((await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
      product_name: 'Updated Product',
      product_category: 'Pump',
      standard_status: 'Active',
    })).status).toBe(200);
    expectSummary('product', 'product-1', 'UPDATE', 'Product details updated');

    expect((await request(app, 'PATCH', '/api/v1/product-masters/product-1/status', token, {
      standard_status: 'Obsolete',
    })).status).toBe(200);
    expectSummary('product', 'product-1', 'STATUS_CHANGE', 'Status changed to Obsolete');

    expect((await request(app, 'DELETE', '/api/v1/product-masters/product-1', token)).status).toBe(200);
    expectSummary('product', 'product-1', 'DELETE', 'Product P-100 deleted');
  });

  it('keeps readable summaries for component create, update, delete, and status changes', async () => {
    expect((await request(app, 'POST', '/api/v1/components', token, {
      component_code: 'C-100',
      component_name: 'Test Component',
    })).status).toBe(201);
    expectSummary('component', 'component-1', 'CREATE', 'Component C-100 created');

    expect((await request(app, 'PUT', '/api/v1/components/component-1', token, {
      component_name: 'Updated Component',
      component_type: 'Valve',
      status: 'Active',
    })).status).toBe(200);
    expectSummary('component', 'component-1', 'UPDATE', 'Component details updated');

    expect((await request(app, 'PATCH', '/api/v1/components/component-1/status', token, {
      status: 'Obsolete',
    })).status).toBe(200);
    expectSummary('component', 'component-1', 'STATUS_CHANGE', 'Status changed to Obsolete');

    expect((await request(app, 'DELETE', '/api/v1/components/component-1', token)).status).toBe(200);
    expectSummary('component', 'component-1', 'DELETE', 'Component C-100 deleted');
  });

  it('keeps a readable summary for hydraulic product updates', async () => {
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1/hydraulic', token, {
      venturi_flow_m3h: 12,
    });

    expect(response.status).toBe(200);
    expectSummary('product', 'product-1', 'UPDATE', 'Product hydraulic data updated');
  });

  it('hides obsolete products by default while allowing explicit inclusion', async () => {
    state.listRows.push(
      { id: 'active-1', product_code: 'P-ACTIVE', standard_status: 'Active' },
      { id: 'obsolete-1', product_code: 'P-OBSOLETE', standard_status: 'Obsolete' },
    );

    const defaultResponse = await request(app, 'GET', '/api/v1/product-masters?page_size=50', token);
    expect(defaultResponse.status).toBe(200);
    expect((defaultResponse.body as any).items).toEqual([
      { id: 'active-1', product_code: 'P-ACTIVE', standard_status: 'Active' },
    ]);
    expect((defaultResponse.body as any).pagination.total).toBe(1);

    const includeObsoleteResponse = await request(
      app,
      'GET',
      '/api/v1/product-masters?page_size=50&include_obsolete=true',
      token,
    );
    expect(includeObsoleteResponse.status).toBe(200);
    expect((includeObsoleteResponse.body as any).items).toEqual(state.listRows);
    expect((includeObsoleteResponse.body as any).pagination.total).toBe(2);
  });
});