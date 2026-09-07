// @vitest-environment node
import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const secret = 'lss-control-permission-test';

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM field_instrument_definitions')) {
      return { rows: [{
        id: 'optional-definition', name: 'Optional sensor', tag_code: 'OS',
        signal_type: 'digital', signal_direction: 'input', requirement_rule: 'optional',
      }] };
    }
    if (sql.includes('module_key=\'pim\'')) return { rows: [{ access_level: 'view' }] };
    if (sql.includes('role_module_access')) return { rows: [{ access_level: 'manage' }] };
    return { rows: [] };
  });
  return { default: { connect: vi.fn(async () => ({ query, release: vi.fn() })) }, query };
});

vi.mock('./designBooks', () => ({
  loadReleaseContext: vi.fn(async () => ({
    id: 'book-1', project_id: 'project-1', status: 'Draft',
    systems: [{ id: 'lss-1', project_id: 'project-1', system_code: 'LSS-01', system_type: 'Life Support' }],
  })),
}));

function request(app: Express, body: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const payload = JSON.stringify(body);
      const token = jwt.sign({ id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' }, secret);
      const req = http.request({
        host: '127.0.0.1', port: (server.address() as any).port, method: 'PUT',
        path: '/api/v1/systems/lss-1/control',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => server.close(error => error
          ? reject(error)
          : resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : {} })));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

describe('LSS Control product overrides', () => {
  let app: Express;
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const { default: routes } = await import('./lssControls');
    app = express();
    app.use(express.json());
    app.use('/api/v1', routes);
  });
  afterAll(() => { delete process.env.JWT_SECRET; });

  it('requires PIM manage access when an explicitly supplied null clears a product', async () => {
    const response = await request(app, {
      design_book_id: 'book-1', panel_type: 'PLC',
      instruments: [{ definition_id: 'optional-definition', quantity: 0, product_master_id: null }],
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({ code: 'MODULE_READ_ONLY' });
  });
});