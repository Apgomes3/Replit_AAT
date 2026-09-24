// @vitest-environment node
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const userId = '99999999-9999-4999-8999-999999999999';
const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  query: vi.fn(),
}));

vi.mock('../db', () => ({ query: state.query, default: { query: state.query } }));

const testSecret = 'notifications-test-secret';

function notification(id: string, options: Record<string, any> = {}) {
  const day = id.slice(-1);
  return {
    id,
    user_id: userId,
    type: 'po_submitted',
    title: `Notification ${id}`,
    body: null,
    entity_type: 'purchase_order',
    entity_id: id,
    href: `/purchase-orders/${id}`,
    severity: 'info',
    action_required: false,
    is_read: false,
    created_at: new Date(`2026-01-0${day}T00:00:00.000Z`),
    visible: true,
    ...options,
  };
}

describe('notifications API', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: notifications } = await import('./notifications');
    const app = express();
    app.use(express.json());
    app.use('/api/v1', notifications);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: String(error) });
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as import('node:net').AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    token = jwt.sign({ id: userId, email: 'user@example.com', role: 'engineer' }, testSecret);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    delete process.env.JWT_SECRET;
  });

  beforeEach(() => {
    state.rows = [
      notification('11111111-1111-4111-8111-111111111111', { is_read: true }),
      notification('22222222-2222-4222-8222-222222222222', { action_required: true }),
      notification('33333333-3333-4333-8333-333333333333', { entity_type: 'project', action_required: true }),
      notification('44444444-4444-4444-8444-444444444444', { user_id: '88888888-8888-4888-8888-888888888888' }),
      notification('55555555-5555-4555-8555-555555555555', { visible: false }),
    ];
    state.query.mockReset();
    state.query.mockImplementation(async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      if (normalized.startsWith('select n.id')) {
        const filter = normalized.includes('and n.action_required and not n.is_read')
          ? 'action'
          : normalized.includes('and not n.is_read') ? 'unread' : 'all';
        const rows = state.rows
          .filter(row => row.user_id === params[0] && row.visible)
          .filter(row => filter === 'all' || (!row.is_read && (filter !== 'action' || row.action_required)))
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id));
        return { rows: rows.slice(params[2], params[2] + params[1]) };
      }
      if (normalized.startsWith('select count(*)')) {
        const rows = state.rows.filter(row => row.user_id === params[0] && row.visible);
        return { rows: [{ unread_count: rows.filter(row => !row.is_read).length, total: rows.length }] };
      }
      if (normalized.startsWith('update notifications')) {
        if (normalized.includes('where id in')) {
          const filter = normalized.includes('and n.action_required and not n.is_read')
            ? 'action'
            : normalized.includes('and not n.is_read') ? 'unread' : 'all';
          const rows = state.rows.filter(row => row.user_id === params[0] && row.visible && !row.is_read &&
            (filter !== 'action' || row.action_required));
          for (const row of rows) row.is_read = true;
          return { rowCount: rows.length, rows: rows.map(row => ({ id: row.id })) };
        }
        const row = state.rows.find(item => item.id === params[1] && item.user_id === params[0] && item.visible);
        if (!row) return { rowCount: 0, rows: [] };
        row.is_read = true;
        return { rowCount: 1, rows: [{ id: row.id }] };
      }
      if (normalized.startsWith('delete from notifications')) {
        const index = state.rows.findIndex(row => row.id === params[0] && row.user_id === params[1]);
        if (index < 0) return { rowCount: 0, rows: [] };
        state.rows.splice(index, 1);
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });

  async function request(method: string, path: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() as any };
  }

  it('limits notifications and counts to the recipient and hides modules and unauthorized purchase orders', async () => {
    const result = await request('GET', '/api/v1/notifications');
    expect(result.status).toBe(200);
    expect(result.json.notifications.map((row: any) => row.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(result.json).toMatchObject({ unread_count: 2, total: 3 });

    const [pageCall, countCall] = state.query.mock.calls;
    for (const [sql, params] of [pageCall, countCall]) {
      expect(sql).toContain('n.user_id = $1');
      expect(sql).toContain("access.access_level IS DISTINCT FROM 'hidden'");
      expect(sql).toContain('owner.can_see_all_pos');
      expect(params[0]).toBe(userId);
    }
  });

  it('supports pagination, unread and action filters with independent unread count', async () => {
    const page = await request('GET', '/api/v1/notifications?limit=1&offset=1&filter=all');
    expect(page.json.notifications.map((row: any) => row.id)).toEqual(['22222222-2222-4222-8222-222222222222']);
    const unread = await request('GET', '/api/v1/notifications?filter=unread');
    expect(unread.json.notifications.map((row: any) => row.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
    ]);
    const action = await request('GET', '/api/v1/notifications?filter=action');
    expect(action.json.notifications.map((row: any) => row.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(action.json.unread_count).toBe(2);
    expect(action.json.total).toBe(3);
  });

  it('marks only unread action-required notifications read when requested', async () => {
    const result = await request('PATCH', '/api/v1/notifications/read-all', { filter: 'action' });
    expect(result).toMatchObject({ status: 200, json: { ok: true, updated: 2 } });
    expect(state.rows.find(row => row.id.startsWith('2'))?.is_read).toBe(true);
    expect(state.rows.find(row => row.id.startsWith('3'))?.is_read).toBe(true);
    expect(state.rows.find(row => row.id.startsWith('1'))?.is_read).toBe(true);
    expect(state.query.mock.calls[0][0]).toContain('AND n.action_required AND NOT n.is_read');
  });

  it('reads only an owned, visible notification and validates IDs', async () => {
    const read = await request('PATCH', '/api/v1/notifications/22222222-2222-4222-8222-222222222222/read');
    expect(read).toMatchObject({ status: 200, json: { ok: true } });
    expect(state.rows.find(row => row.id.startsWith('2'))?.is_read).toBe(true);

    const denied = await request('PATCH', '/api/v1/notifications/44444444-4444-4444-8444-444444444444/read');
    expect(denied.status).toBe(404);
    const malformed = await request('PATCH', '/api/v1/notifications/not-a-uuid/read');
    expect(malformed.status).toBe(400);
  });

  it('rejects invalid pagination and filters', async () => {
    expect((await request('GET', '/api/v1/notifications?limit=101')).status).toBe(400);
    expect((await request('GET', '/api/v1/notifications?offset=-1')).status).toBe(400);
    expect((await request('GET', '/api/v1/notifications?filter=unknown')).status).toBe(400);
  });

  it('checks module and record visibility before revealing follow status or changing it', async () => {
    const recordId = '11111111-1111-4111-8111-111111111111';
    const ownSubscriptions = new Set<string>();
    let visible = true;
    state.query.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM purchase_orders record')) {
        expect(sql).toContain("access.access_level IS DISTINCT FROM 'hidden'");
        expect(sql).toContain('u.can_see_all_pos');
        expect(sql).toContain('po_designated_users');
        expect(sql).toContain('po_stage_assignees');
        expect(params).toEqual([recordId, userId, 'orders']);
        return { rowCount: visible ? 1 : 0 };
      }
      if (sql.includes('DELETE FROM notification_subscriptions')) {
        ownSubscriptions.delete(recordId);
        return { rowCount: 1 };
      }
      if (sql.includes('FROM notification_subscriptions')) {
        expect(params).toEqual([userId, 'purchase_order', recordId]);
        return { rowCount: ownSubscriptions.has(recordId) ? 1 : 0 };
      }
      if (sql.includes('INTO notification_subscriptions')) {
        ownSubscriptions.add(recordId);
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const path = `/api/v1/notifications/subscriptions/purchase_order/${recordId}`;
    expect(await request('GET', path)).toMatchObject({ status: 200, json: { following: false } });
    expect(await request('PUT', path)).toMatchObject({ status: 200, json: { following: true } });
    expect(await request('GET', path)).toMatchObject({ status: 200, json: { following: true } });
    visible = false;
    expect((await request('GET', path)).status).toBe(404);
    expect((await request('PUT', path)).status).toBe(404);
    expect((await request('DELETE', path)).status).toBe(404);
    expect(ownSubscriptions.has(recordId)).toBe(true);
    visible = true;
    expect(await request('DELETE', path)).toMatchObject({ status: 200, json: { following: false } });
    expect(await request('GET', path)).toMatchObject({ status: 200, json: { following: false } });
    expect((await request('GET', '/api/v1/notifications/subscriptions/purchase_order/not-an-id')).status).toBe(400);
    expect((await request('GET', `/api/v1/notifications/subscriptions/unknown/${recordId}`)).status).toBe(400);
  });
});