// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'configuration-reset-test-secret';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  auditRows: [] as Array<{ entityType: string; entityId: string; action: string; details: Record<string, unknown> | null }>,
  bookStatus: 'Draft',
  systemStatus: 'Draft',
  moduleAccess: 'manage',
  failOn: '' as string,
}));

vi.mock('../db', () => {
  const clientQuery = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (state.failOn && sql.includes(state.failOn)) throw new Error('simulated database failure');
    if (sql.replace(/\s+/g, ' ').trim().toLowerCase().startsWith('insert into audit_logs')) {
      state.auditRows.push({
        entityType: 'system',
        entityId: String(params[0]),
        action: 'RESET_CONFIGURATION',
        details: (params[2] as Record<string, unknown> | null) ?? null,
      });
    }
    if (sql.includes('SELECT * FROM systems WHERE id=$1 FOR UPDATE')) {
      return {
        rows: [{
          id: 'system-1',
          system_code: 'LSS-01',
          project_id: 'project-1',
          status: state.systemStatus,
        }],
      };
    }
    if (sql.includes('SELECT id, status FROM design_books')) {
      return { rows: [{ id: 'book-1', status: state.bookStatus }] };
    }
    if (sql.includes('UPDATE systems SET')) {
      return {
        rows: [{
          id: 'system-1',
          system_code: 'LSS-01',
          project_id: 'project-1',
          status: state.systemStatus,
          system_config: null,
          compact_unit_id: null,
          design_flow_m3h: null,
          turnover_rate_hr: null,
          calculation_inputs: null,
        }],
      };
    }
    return { rows: [] };
  });
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: state.moduleAccess }] };
    return { rows: [] };
  });
  return {
    default: {
      connect: vi.fn(async () => ({
        query: clientQuery,
        release: vi.fn(),
      })),
    },
    query,
  };
});

vi.mock('../db/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

function request(app: Express, role = 'engineer') {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const token = jwt.sign(
        { id: 'user-1', email: 'user@example.com', role },
        testSecret,
      );
      const payload = JSON.stringify({ design_book_id: 'book-1' });
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: '/api/v1/systems/system-1/configuration-reset',
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
            resolve({
              status: res.statusCode ?? 0,
              body: response && res.headers['content-type']?.includes('application/json')
                ? JSON.parse(response)
                : {},
            });
          });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

describe('safe LSS configuration reset', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: projectRoutes } = await import('./projects');
    app = express();
    app.use(express.json());
    app.use('/api/v1', projectRoutes);
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: { code: 'SERVER_ERROR' } });
    });
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.auditRows.length = 0;
    state.bookStatus = 'Draft';
    state.systemStatus = 'Draft';
    state.moduleAccess = 'manage';
    state.failOn = '';
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('clears the documented LSS-owned records in one transaction and preserves source records', async () => {
    const response = await request(app);

    expect(response.status).toBe(200);
    expect(response.body.system).toMatchObject({
      system_config: null,
      compact_unit_id: null,
      design_flow_m3h: null,
      turnover_rate_hr: null,
      side_streams: [],
      fractionator_allocations: [],
      equipment: [],
    });
    const sql = state.calls.map(call => call.sql).join('\n');
    expect(sql).toContain('BEGIN');
    expect(sql).toContain('DELETE FROM system_exhibit_links');
    expect(sql).toContain('DELETE FROM system_flow_side_streams');
    expect(sql).toContain('DELETE FROM system_flow_fractionator_allocations');
    expect(sql).toContain('DELETE FROM project_equipment_items');
    expect(sql).toContain('RESET_CONFIGURATION');
    expect(sql).toContain('COMMIT');
    expect(state.auditRows).toContainEqual(expect.objectContaining({
      entityType: 'system',
      entityId: 'system-1',
      action: 'RESET_CONFIGURATION',
      details: expect.objectContaining({
        summary: 'LSS configuration reset for LSS-01',
      }),
    }));
    expect(sql).not.toMatch(/DELETE FROM (tanks|exhibits|design_book_exhibit_hydraulics|product_masters)/);
    expect(sql).not.toMatch(/UPDATE (tanks|exhibits|design_book_exhibit_hydraulics|product_masters)/);
  });

  it('rejects reviewed Design Books before changing any LSS records', async () => {
    state.bookStatus = 'For Review';

    const response = await request(app);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DESIGN_BOOK_NOT_EDITABLE');
    expect(state.calls.some(call => call.sql.includes('DELETE FROM'))).toBe(false);
    expect(state.calls.some(call => call.sql === 'ROLLBACK')).toBe(true);
  });

  it('rolls back the whole reset when a database operation fails', async () => {
    state.failOn = 'DELETE FROM project_equipment_items';

    const response = await request(app);

    expect(response.status).toBe(500);
    expect(state.calls.some(call => call.sql === 'ROLLBACK')).toBe(true);
    expect(state.calls.some(call => call.sql === 'COMMIT')).toBe(false);
  });

  it('rejects users without an editable engineering role', async () => {
    const response = await request(app, 'viewer');

    expect(response.status).toBe(403);
    expect(state.calls.some(call => call.sql === 'BEGIN')).toBe(false);
  });

  it('rejects engineers with read-only Projects module access', async () => {
    state.moduleAccess = 'view';

    const response = await request(app);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MODULE_READ_ONLY');
    expect(state.calls.some(call => call.sql === 'BEGIN')).toBe(false);
  });
});