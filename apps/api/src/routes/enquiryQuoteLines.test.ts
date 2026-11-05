// @vitest-environment node
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, JWT_SECRET, requireModuleAccess } from '../middleware/auth';
import { enquiryQuoteLines } from './enquiryQuoteLines';

const enquiryId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const quoteId = '33333333-3333-4333-8333-333333333333';
const lineId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const state = vi.hoisted(() => ({
  product: null as any, quote: null as any, lines: [] as any[],
  bd: 'manage', pim: 'view', enquiry: true, version: 0,
  calls: [] as Array<{ sql: string; params: any[] }>,
}));
vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, p: any[] = []) => {
    state.calls.push({ sql, params: p });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: p[1] === 'pim' ? state.pim : state.bd }] };
    if (sql.includes('SELECT id FROM enquiries')) return { rows: state.enquiry ? [{ id: p[0] }] : [] };
    if (sql.includes('FROM product_masters')) return { rows: state.product ? [structuredClone(state.product)] : [] };
    if (sql.includes('SELECT currency FROM enquiry_quotes')) return { rows: state.quote ? [{ currency: state.quote.currency }] : [] };
    if (sql.includes('SELECT * FROM enquiry_quotes')) return { rows: state.quote ? [structuredClone(state.quote)] : [] };
    if (sql.includes('SELECT * FROM enquiry_quote_lines')) {
      const found = sql.includes('add_request_key')
        ? state.lines.filter(l => l.quote_id === p[0] && l.source_snapshot.add_request_key === p[1] && l.source_snapshot.added_by === p[2])
        : state.lines.filter(l => l.id === p[0] && l.quote_id === p[1]);
      return { rows: structuredClone(found) };
    }
    if (sql.includes('INSERT INTO enquiry_quote_lines')) {
      const line = { id: '44444444-4444-4444-8444-444444444444', quote_id: p[0], source_snapshot: structuredClone(p[1]),
        description: p[2], quantity: p[3], unit: p[4], unit_price: p[5], currency: p[6] };
      state.lines.push(line);
      return { rows: [structuredClone(line)] };
    }
    if (sql.includes('UPDATE enquiry_quotes')) {
      state.quote.updated_at = new Date(Date.UTC(2026, 10, 5, 0, 0, ++state.version)).toISOString();
      return { rows: [] };
    }
    if (sql.includes('UPDATE enquiry_quote_lines')) {
      const l = state.lines.find(l => l.id === p[4] && l.quote_id === p[5]);
      if (!l) return { rows: [] };
      Object.assign(l, { description: p[0], quantity: p[1], unit: p[2], unit_price: p[3] });
      return { rows: [structuredClone(l)] };
    }
    if (sql.includes('DELETE FROM enquiry_quote_lines')) {
      const removed = state.lines.filter(l => l.id === p[0] && l.quote_id === p[1]);
      state.lines = state.lines.filter(l => !removed.includes(l));
      return { rows: removed };
    }
    throw new Error(`Unexpected quote-lines query: ${sql}`);
  });
  return {
    query,
    withTransaction: async (work: any) => {
      const before = structuredClone({ quote: state.quote, lines: state.lines });
      try { return await work({ query }); }
      catch (error) { state.quote = before.quote; state.lines = before.lines; throw error; }
    },
  };
});

const events = vi.fn();
const app = express();
app.use(express.json());
app.use('/enquiries/:id/quote', authenticate, requireModuleAccess('business_development'), enquiryQuoteLines({
  ensureQuote: async (_db, id, _user, body) => {
    if (!state.enquiry) throw Object.assign(new Error('Enquiry not found.'), { status: 404, code: 'NOT_FOUND' });
    state.quote ||= { id: quoteId, enquiry_id: id, status: 'draft', currency: body.currency || 'USD', updated_at: '2026-11-05T00:00:00.000Z' };
    return state.quote;
  },
  recordActivity: events,
}));
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: { message: error.message } }));

async function request(method: string, suffix: string, body?: any): Promise<{ status: number; body: any }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/enquiries/${enquiryId}/quote${suffix}`, {
      method, headers: { authorization: `Bearer ${jwt.sign({ id: userId, role: 'engineer' }, JWT_SECRET)}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const add = (more = {}) => request('POST', '/lines', { product_master_id: productId, quantity: 2, ...more });

describe('PIM enquiry quote lines', () => {
  beforeEach(() => {
    state.product = {
      id: productId, product_code: 'PUMP-01', product_name: 'Reef pump',
      product_description: 'Marine circulation pump', manufacturer: 'Vendor', model: 'P100',
      sell_price: '125.50', currency: 'USD', status: 'Active', updated_at: '2026-10-01T00:00:00Z',
    };
    state.quote = null; state.lines = []; state.bd = 'manage'; state.pim = 'view';
    state.enquiry = true; state.version = 0; state.calls = []; events.mockClear();
  });

  it('searches the governed PIM catalog without exposing cost fields', async () => {
    const result = await request('GET', '/products?search=reef');
    expect(result.status).toBe(200);
    expect(result.body.items[0].product_code).toBe('PUMP-01');
    const search = state.calls.find(c => c.sql.includes('FROM product_masters'))!;
    expect(search.params).toEqual(['reef', '%reef%']);
    expect(search.sql).toContain('LIMIT 40');
    expect(search.sql).not.toMatch(/\bcost\b/);
    state.pim = 'hidden';
    expect((await request('GET', '/products')).status).toBe(403);
    expect((await add()).status).toBe(403);
  });

  it('creates a standalone quote with a frozen PIM snapshot and retries without duplicate lines', async () => {
    const key = '66666666-6666-4666-8666-666666666666';
    const first = await add({ idempotency_key: key });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ quantity: 2, unit_price: 125.5, currency: 'USD',
      source_snapshot: { source_type: 'pim_product', product_master_id: productId, product_code: 'PUMP-01' } });
    state.product.product_name = 'Changed later';
    state.product.sell_price = 999;
    const retry = await add({ idempotency_key: key });
    expect(retry.body.id).toBe(first.body.id);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].source_snapshot.product_name).toBe('Reef pump');
    expect(state.lines[0].unit_price).toBe(125.5);
    expect(events).toHaveBeenCalledTimes(1);
  });

  it('requires explicit quote-currency prices for mismatches and missing prices, accepting zero', async () => {
    state.product.currency = 'EUR';
    expect((await add()).status).toBe(400);
    expect(state.quote).toBeNull(); // invalid addition rolls back auto-creation
    expect((await add({ unit_price: 0 })).status).toBe(201);
    expect(state.lines[0]).toMatchObject({ unit_price: 0, currency: 'USD', source_snapshot: { currency: 'EUR' } });
    state.product.sell_price = null;
    expect((await add({ unit_price: ' ' })).status).toBe(400);
  });

  it.each([{ quantity: 0 }, { quantity: -1 }, { unit_price: -1 }, { unit_price: null }, { quantity: 'no' }])('rejects invalid numeric inputs %j', async values => {
    expect((await add(values)).status).toBe(400);
    expect(state.lines).toHaveLength(0);
  });

  it('edits and deletes only its own draft lines using the captured quote version', async () => {
    await add();
    const originalSnapshot = structuredClone(state.lines[0].source_snapshot);
    const version = state.quote.updated_at;
    const update = await request('PATCH', `/lines/${lineId}`, {
      expected_quote_version: version, quantity: 3, unit_price: 200, description: 'Offered pump', unit: 'EA',
    });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ quantity: 3, unit_price: 200 });
    expect(update.body.source_snapshot).toEqual(originalSnapshot);
    const stale = await request('PATCH', `/lines/${lineId}`, { expected_quote_version: version, quantity: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    state.lines[0].quote_id = 'another-quote';
    expect((await request('DELETE', `/lines/${lineId}`, { expected_quote_version: state.quote.updated_at })).status).toBe(404);
    state.lines[0].quote_id = quoteId;
    expect((await request('DELETE', `/lines/${lineId}`, { expected_quote_version: state.quote.updated_at })).status).toBe(204);
    expect(state.lines).toHaveLength(0);
  });

  it('blocks mutations for read-only commercial users and for issued quotes', async () => {
    state.bd = 'view';
    expect((await add()).status).toBe(403);
    state.bd = 'manage';
    await add();
    state.quote.status = 'issued';
    expect((await add()).status).toBe(409);
    expect((await request('PATCH', `/lines/${lineId}`, { quantity: 4 })).status).toBe(409);
    expect((await request('DELETE', `/lines/${lineId}`)).status).toBe(409);
    expect(state.lines).toHaveLength(1);
  });
});
