import express, { Express } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'product-design-flow-sync-test-secret';
const actorId = '00000000-0000-0000-0000-000000000001';

const initialHydraulic = () => ({
  product_master_id: 'product-1',
  design_flow_m3h: 20,
  min_flow_m3h: 8,
  max_flow_m3h: 28,
  venturi_flow_m3h: 4,
  friction_loss_mh2o: 2.5,
  design_head_m: 11,
  design_pressure_bar: 2.5,
  max_pressure_bar: 4,
  npsh_required_m: 1.2,
  fluid_type: 'Seawater',
  min_temperature_c: 18,
  max_temperature_c: 27,
  notes: 'Keep me',
});

const state = vi.hoisted(() => ({
  productFlow: 20 as number | null,
  hydraulic: null as Record<string, any> | null,
  snapshot: null as { productFlow: number | null; hydraulic: Record<string, any> | null } | null,
  failHydraulicWrite: false,
  failAuditWrite: false,
  auditDetails: [] as Array<Record<string, any>>,
}));

vi.mock('../db', () => {
  const run = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (sql === 'begin') {
      state.snapshot = { productFlow: state.productFlow, hydraulic: state.hydraulic ? { ...state.hydraulic } : null };
      return { rows: [] };
    }
    if (sql === 'commit') {
      state.snapshot = null;
      return { rows: [] };
    }
    if (sql === 'rollback') {
      if (state.snapshot) {
        state.productFlow = state.snapshot.productFlow;
        state.hydraulic = state.snapshot.hydraulic;
      }
      state.snapshot = null;
      return { rows: [] };
    }
    if (sql.startsWith('select rma.access_level')) return { rows: [] };
    if (sql.startsWith('select id from product_masters where id::text=$1 or product_code=$1')) {
      return { rows: [{ id: 'product-1' }] };
    }
    if (sql.startsWith('select id from product_masters where product_code=$1')) return { rows: [] };
    if (sql.includes('from product_masters pm left join product_hydraulic ph') && sql.includes('for update of pm')) {
      if (sql.includes('pm.product_code')) {
        return {
          rows: [{
            id: 'product-1',
            product_code: 'P-100',
            product_design_flow_m3h: state.productFlow,
            hydraulic_design_flow_m3h: state.hydraulic?.design_flow_m3h ?? null,
          }],
        };
      }
      return {
        rows: [{
          product_design_flow_m3h: state.productFlow,
          hydraulic_design_flow_m3h: state.hydraulic?.design_flow_m3h ?? null,
        }],
      };
    }
    if (sql.startsWith('select design_flow_m3h from product_masters')) {
      return { rows: [{ design_flow_m3h: state.productFlow }] };
    }
    if (sql.startsWith('select * from product_hydraulic')) {
      return { rows: state.hydraulic ? [{ ...state.hydraulic }] : [] };
    }
    if (sql.startsWith('update product_masters set product_code=')) {
      state.productFlow = params[3];
      return {
        rows: [{
          id: 'product-1',
          product_code: 'P-100',
          product_name: params[0],
          design_flow_m3h: state.productFlow,
        }],
      };
    }
    if (sql.startsWith('update product_masters set design_flow_m3h=')) {
      state.productFlow = params[1];
      return { rows: [{ id: 'product-1', design_flow_m3h: state.productFlow }] };
    }
    if (sql.startsWith('insert into product_hydraulic')) {
      if (state.failHydraulicWrite) throw new Error('hydraulic write failed');
      if (params.length === 2) {
        state.hydraulic = { ...(state.hydraulic || { product_master_id: params[0] }), design_flow_m3h: params[1] };
      } else {
        state.hydraulic = {
          product_master_id: params[0],
          design_flow_m3h: params[1],
          min_flow_m3h: params[2],
          max_flow_m3h: params[3],
          venturi_flow_m3h: params[4],
           friction_loss_mh2o: params[5],
           design_head_m: params[6],
           design_pressure_bar: params[7],
           max_pressure_bar: params[8],
           npsh_required_m: params[9],
           fluid_type: params[10],
           min_temperature_c: params[11],
           max_temperature_c: params[12],
           notes: params[13],
        };
      }
      return { rows: [{ ...state.hydraulic }] };
    }
    if (sql.includes('from product_masters pm') && sql.includes('coalesce(ph.design_flow_m3h')) {
      const flow = state.hydraulic?.design_flow_m3h ?? state.productFlow;
      return {
        rows: [{
          ...(state.hydraulic || {}),
          product_master_id: 'product-1',
          design_flow_m3h: flow,
          product_design_flow_m3h: state.productFlow,
          hydraulic_design_flow_m3h: state.hydraulic?.design_flow_m3h ?? null,
          design_flow_sync_status: state.productFlow != null && state.hydraulic?.design_flow_m3h != null && state.productFlow !== state.hydraulic.design_flow_m3h
            ? 'conflict'
            : flow == null ? 'empty' : 'synchronized',
        }],
      };
    }
    if (sql.startsWith('insert into audit_logs')) {
      if (state.failAuditWrite) throw new Error('audit write failed');
      state.auditDetails.push(params[4] || {});
      return { rows: [] };
    }
    return { rows: [] };
  });
  return {
    query: run,
    default: {
      connect: vi.fn(async () => ({ query: run, release: vi.fn() })),
      query: run,
    },
  };
});

function request(app: Express, method: string, path: string, token: string, body: Record<string, unknown> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not start test server'));
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
      }, response => {
        let raw = '';
        response.on('data', chunk => { raw += chunk; });
        response.on('end', () => {
          server.close();
          resolve({ status: response.statusCode || 0, body: raw ? JSON.parse(raw) : {} });
        });
      });
      req.on('error', error => { server.close(); reject(error); });
      req.write(payload);
      req.end();
    });
  });
}

describe('linked Product Master and Hydraulic design flow', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: productRoutes } = await import('../modules/pim/products');
    app = express();
    app.use(express.json());
    app.use('/api/v1', productRoutes);
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error.status || 500).json({ error: { code: error.code || 'SERVER_ERROR', message: error.message } });
    });
    token = jwt.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
  });

  beforeEach(() => {
    state.productFlow = 20;
    state.hydraulic = initialHydraulic();
    state.snapshot = null;
    state.failHydraulicWrite = false;
    state.failAuditWrite = false;
    state.auditDetails.length = 0;
  });

  it('updates both records from Product Master and identifies the source in audit history', async () => {
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
      product_name: 'Pump',
      product_category: 'Pump',
      design_flow_m3h: 24,
    });
    expect(response.status).toBe(200);
    expect(state.productFlow).toBe(24);
    expect(state.hydraulic?.design_flow_m3h).toBe(24);
    expect(state.hydraulic?.notes).toBe('Keep me');
    expect(state.auditDetails).toContainEqual(expect.objectContaining({
      source: 'product_master',
      design_flow_m3h: 24,
    }));
  });

  it('rolls back the Product Master value when the linked Hydraulic write fails', async () => {
    state.failHydraulicWrite = true;
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
      product_name: 'Pump',
      product_category: 'Pump',
      design_flow_m3h: 26,
    });
    expect(response.status).toBe(500);
    expect(state.productFlow).toBe(20);
    expect(state.hydraulic?.design_flow_m3h).toBe(20);
  });

  it('rolls back both values when the linked audit write fails', async () => {
    state.failAuditWrite = true;
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
      product_name: 'Pump',
      product_category: 'Pump',
      design_flow_m3h: 26,
    });
    expect(response.status).toBe(500);
    expect(state.productFlow).toBe(20);
    expect(state.hydraulic?.design_flow_m3h).toBe(20);
  });

  it('updates both records from the Hydraulic card without clearing unrelated fields', async () => {
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1/hydraulic', token, {
      design_flow_m3h: 32,
    });
    expect(response.status).toBe(200);
    expect(state.productFlow).toBe(32);
    expect(state.hydraulic).toMatchObject({
      design_flow_m3h: 32,
      min_flow_m3h: 8,
      max_flow_m3h: 28,
       friction_loss_mh2o: 2.5,
      design_head_m: 11,
      fluid_type: 'Seawater',
      notes: 'Keep me',
    });
    expect(state.auditDetails).toContainEqual(expect.objectContaining({ source: 'hydraulic_card' }));
  });

  it('saves and clears per-product friction loss without changing other hydraulic fields', async () => {
    const save = await request(app, 'PUT', '/api/v1/product-masters/product-1/hydraulic', token, {
      friction_loss_mh2o: '5.0',
    });
    expect(save.status).toBe(200);
    expect(state.hydraulic).toMatchObject({
      friction_loss_mh2o: 5,
      design_head_m: 11,
      notes: 'Keep me',
    });

    const clear = await request(app, 'PUT', '/api/v1/product-masters/product-1/hydraulic', token, {
      friction_loss_mh2o: '',
    });
    expect(clear.status).toBe(200);
    expect(state.hydraulic?.friction_loss_mh2o).toBeNull();
    expect(state.hydraulic?.design_head_m).toBe(11);
    expect(state.hydraulic?.notes).toBe('Keep me');
  });

  it.each(['-1', 'Infinity', 'not-a-number'])('rejects invalid friction loss %s', async friction_loss_mh2o => {
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1/hydraulic', token, { friction_loss_mh2o });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_FRICTION_LOSS');
    expect(response.body.error.message).toContain('mH₂O');
  });

  it('returns Hydraulic as the read authority while exposing an unresolved conflict', async () => {
    state.productFlow = 18;
    state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
    const response = await request(app, 'GET', '/api/v1/product-masters/product-1/hydraulic', token);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      design_flow_m3h: 21,
      product_design_flow_m3h: 18,
      hydraulic_design_flow_m3h: 21,
      design_flow_sync_status: 'conflict',
    });
  });

  it('requires an explicit choice for conflicts and applies the selected reconciliation idempotently', async () => {
    state.productFlow = 18;
    state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
    const conflict = await request(app, 'POST', '/api/v1/product-masters/design-flow/reconcile', token, {
      product_id: 'product-1',
    });
    expect(conflict.status).toBe(409);
    expect(state.productFlow).toBe(18);
    expect(state.hydraulic.design_flow_m3h).toBe(21);

    const resolved = await request(app, 'POST', '/api/v1/product-masters/design-flow/reconcile', token, {
      product_id: 'product-1',
      resolution: 'hydraulic',
    });
    expect(resolved.status).toBe(200);
    expect(state.productFlow).toBe(21);
    expect(state.hydraulic.design_flow_m3h).toBe(21);

    const repeated = await request(app, 'POST', '/api/v1/product-masters/design-flow/reconcile', token, {
      product_id: 'product-1',
    });
    expect(repeated.status).toBe(200);
    expect(state.productFlow).toBe(21);
    expect(state.hydraulic.design_flow_m3h).toBe(21);
  });

  it('does not let an ordinary save silently resolve a pre-existing conflict', async () => {
    state.productFlow = 18;
    state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
      product_name: 'Renamed pump',
      product_category: 'Pump',
      design_flow_m3h: 21,
    });
    expect(response.status).toBe(409);
    expect(state.productFlow).toBe(18);
    expect(state.hydraulic.design_flow_m3h).toBe(21);
  });

  it('retains and audits the original Product Master value when that authority resolves a conflict', async () => {
    state.productFlow = 18;
    state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
    const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
      product_name: 'Pump',
      product_category: 'Pump',
      design_flow_m3h: 21,
      design_flow_conflict_resolution: 'product_master',
    });
    expect(response.status).toBe(200);
    expect(state.productFlow).toBe(18);
    expect(state.hydraulic.design_flow_m3h).toBe(18);
    expect(state.auditDetails).toContainEqual(expect.objectContaining({
      source: 'product_master',
      design_flow_m3h: 18,
      previous_product_design_flow_m3h: 18,
      previous_hydraulic_design_flow_m3h: 21,
      resolved_conflict: true,
    }));
  });
});