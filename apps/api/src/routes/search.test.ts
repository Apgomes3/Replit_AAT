// @vitest-environment node
import express from 'express';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  access: [] as any[],
  calls: [] as { sql: string; params: any[] }[],
  total: 251,
  rows: [] as any[],
}));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', role: 'engineer' };
    next();
  },
}));
vi.mock('../db', () => ({
  query: async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT u.can_see_all_pos')) return { rows: state.access };
    if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: sql.includes('WHERE false') ? 0 : state.total }] };
    return { rows: state.rows };
  },
}));
import search from './search';

async function request(path: string) {
  const app = express();
  app.use('/search', search);
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}${path}`);
    return { status: response.status, body: await response.json() as any };
  } finally {
    server.close();
  }
}

describe('cross-module search and work queue', () => {
  beforeEach(() => {
    state.access = [{ can_see_all_pos: false }];
    state.calls = [];
    state.total = 251;
    state.rows = [];
  });

  it('paginates on the server, with stable ordering and an exact total above 200', async () => {
    state.rows = [{ type: 'purchase_order', id: 'po-1', code: 'PO-1', name: 'Pump', status: 'draft' }];
    const { body, status } = await request('/search?q=pump&page=11&page_size=25');
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 251, page: 11, page_size: 25 });
    expect(body.results[0].href).toBe('/purchase-orders/po-1');
    const page = state.calls.at(-1)!;
    expect(page.sql).toContain('ORDER BY CASE WHEN LOWER(code)');
    expect(page.sql).toContain('LIMIT $');
    expect(page.params.slice(-2)).toEqual([25, 250]);
    expect(state.calls.at(-2)!.sql).toContain('COUNT(*)::int AS total FROM selected');
  });

  it('uses PO creator, designated-user and stage-assignee visibility for rows and count', async () => {
    await request('/search?q=secret&type=purchase_order');
    const count = state.calls.find(c => c.sql.includes('COUNT(*)::int'))!;
    expect(count.sql).toContain('po.created_by=$2::uuid');
    expect(count.sql).toContain('po_designated_users');
    expect(count.sql).toContain('po_stage_assignees');
    expect(count.params[0]).toBe(false);
  });

  it('does not include hidden modules in either query or count even with filters', async () => {
    state.access = [{ can_see_all_pos: true, module_key: 'orders', access_level: 'hidden' },
      { can_see_all_pos: true, module_key: 'clients', access_level: 'hidden' }];
    const { body } = await request('/search?q=pump&module=orders');
    expect(body.total).toBe(0);
    for (const call of state.calls.slice(1)) {
      expect(call.sql).not.toContain('FROM purchase_orders');
      expect(call.sql).not.toContain('FROM clients');
    }
    expect(state.calls.at(-1)!.sql).toContain('WHERE false');
  });

  it('filters actionable records in SQL and never fetches a capped browser collection', async () => {
    const { body } = await request('/search/my-work?module=orders&status=po_review&owner=assigned&due=overdue&page=2');
    expect(body.page).toBe(2);
    const count = state.calls.find(c => c.sql.includes('COUNT(*)::int'))!;
    expect(count.sql).toContain("status IN ('po_review','engineering_review')");
    expect(count.sql).toContain('due_date < CURRENT_DATE');
    expect(count.sql).toContain("LOWER(status)=LOWER(");
    expect(count.sql).toContain("psa.stage=status");
    expect(state.calls.at(-1)!.params.slice(-2)).toEqual([25, 25]);
  });

  it('returns route metadata for project equipment and an empty search state', async () => {
    state.rows = [{ type: 'equipment', id: 'eq-1', system_id: 'project:project-1', code: 'EQ-1', name: 'Pump' }];
    const result = await request('/search?q=pump');
    expect(result.body.results[0].href).toBe('/projects/project-1?equipment=eq-1');
    const empty = await request('/search?q=p');
    expect(empty.body).toMatchObject({ total: 0, results: [] });
  });
});