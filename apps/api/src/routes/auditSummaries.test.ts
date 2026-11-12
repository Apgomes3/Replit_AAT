// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'audit-summary-test-secret';
const actorId = 'actor-1';
const poId = 'po-1';
const projectId = 'project-1';
const userId = 'user-1';

const state = vi.hoisted(() => ({
  auditRows: [] as Array<{
    entityType: string;
    entityId: string;
    action: string;
    details: Record<string, unknown> | null;
  }>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (sql.startsWith('select * from purchase_orders where id=$1')) {
      return {
        rows: [{
          id: poId,
          po_code: 'PO-001',
          status: 'purchase_order',
          created_by: actorId,
        }],
      };
    }
    if (sql.startsWith('select 1 from po_stage_assignees')) return { rows: [] };
    if (sql.startsWith('select id, cost_price from po_items')) {
      return { rows: [{ id: 'item-1', cost_price: '125.00' }] };
    }
    if (sql.startsWith('select fo_number from purchase_orders')) {
      return { rows: [{ fo_number: null }] };
    }
    if (sql.startsWith('update projects set')) {
      return {
        rows: [{
          id: projectId,
          project_name: 'Updated Aquarium',
          project_status: 'Active',
          // Routes use updated_at as the optimistic-concurrency version.
          updated_at: new Date('2026-11-01T00:00:00.000Z'),
        }],
      };
    }
    if (sql.startsWith('insert into po_lifecycle_history')) {
      // Transitions read back the history row id to link follow-up notifications.
      return { rows: [{ id: 'history-1' }] };
    }
    if (sql.startsWith('select is_active, role from users')) {
      return { rows: [{ is_active: true, role: 'viewer' }] };
    }
    if (sql.startsWith('update users set')) {
      return {
        rows: [{
          id: userId,
          email: 'user@example.com',
          first_name: 'Test',
          last_name: 'User',
          role: 'engineer',
          is_active: true,
        }],
      };
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

  // Routes run some writes inside transactions; the fake client shares the same query handler.
  const withTransaction = vi.fn(async (work: (db: { query: typeof query }) => unknown) => work({ query }));

  return {
    query,
    withTransaction,
    default: { query },
  };
});

vi.mock('../db/notifications', () => ({
  createNotification: vi.fn(),
  emitNotification: vi.fn(),
  notifyAdminsAndManagers: vi.fn(),
}));

type ResponseBody = Record<string, unknown>;

function request(
  app: Express,
  method: string,
  path: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: ResponseBody }> {
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
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(response) });
            } catch {
              // Surface the server's error page instead of an opaque JSON parse failure.
              const text = response.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
              reject(new Error(`Non-JSON ${res.statusCode} response: ${text.slice(0, 600)}`));
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

describe('audit summaries on update routes', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const [{ default: projectRoutes }, { default: purchaseOrderRoutes }, { default: adminRoutes }] = await Promise.all([
      import('./projects'),
      import('./purchaseOrders'),
      import('./admin'),
    ]);

    app = express();
    app.use(express.json());
    app.use('/api/v1', projectRoutes);
    app.use('/api/v1', purchaseOrderRoutes);
    app.use('/api/v1/admin', adminRoutes);
    token = jwt.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
  });

  beforeEach(() => {
    state.auditRows.length = 0;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('persists a readable summary when a purchase order changes state', async () => {
    const response = await request(app, 'POST', `/api/v1/purchase-orders/${poId}/transition`, token);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('po_review');
    expect(state.auditRows).toContainEqual(expect.objectContaining({
      entityType: 'purchase_order',
      entityId: poId,
      action: 'STATE_TRANSITION',
      details: expect.objectContaining({
        summary: 'Status changed from Purchase Order → Po Review',
      }),
    }));
  });

  it('persists a readable summary when a project is updated', async () => {
    const response = await request(app, 'PUT', `/api/v1/projects/${projectId}`, token, {
      project_name: 'Updated Aquarium',
      project_status: 'Active',
    });

    expect(response.status).toBe(200);
    expect(state.auditRows).toContainEqual(expect.objectContaining({
      entityType: 'project',
      entityId: projectId,
      action: 'UPDATE',
      details: expect.objectContaining({
        summary: 'Project details updated',
      }),
    }));
  });

  it('persists a readable summary when a user role changes', async () => {
    const response = await request(app, 'PUT', `/api/v1/admin/users/${userId}`, token, {
      first_name: 'Test',
      last_name: 'User',
      role: 'engineer',
      is_active: true,
    });

    expect(response.status).toBe(200);
    expect(state.auditRows).toContainEqual(expect.objectContaining({
      entityType: 'user',
      entityId: userId,
      action: 'UPDATE',
      details: expect.objectContaining({
        summary: 'Role changed from viewer → engineer',
      }),
    }));
  });
});