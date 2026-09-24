// @vitest-environment node
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  creates: new Map<string, any>(),
  inserts: 0,
  links: 0,
  histories: 0,
  seq: 0,
}));
vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('idempotency_key=$2')) return { rows: state.creates.has(`${params[0]}:${params[1]}`) ? [state.creates.get(`${params[0]}:${params[1]}`)] : [] };
    if (sql.includes("nextval('po_code_seq')")) return { rows: [{ yr: '2026', seq: ++state.seq }] };
    if (sql.includes('INSERT INTO purchase_orders')) {
      const row = { id: `22222222-2222-4222-8222-${String(++state.inserts).padStart(12, '0')}`, po_code: params[0], created_by: params[4] };
      if (params.at(-1)) state.creates.set(`${params[4]}:${params.at(-1)}`, row);
      return { rows: [row] };
    }
    if (sql.includes('INSERT INTO po_systems')) state.links++;
    if (sql.includes('INSERT INTO po_lifecycle_history')) state.histories++;
    return { rows: [] };
  });
  return { query, withTransaction: vi.fn(async (work: any) => work({ query })) };
});

import purchaseOrders from './purchaseOrders';

async function create(body: any, userId = '99999999-9999-4999-8999-999999999999') {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', purchaseOrders);
  const server = app.listen(0);
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as any;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/purchase-orders`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt.sign({ id: userId, role: 'engineer' }, 'edp-secret-change-in-production')}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() as { id?: string; po_code?: string } };
  } finally {
    server.close();
  }
}

describe('PO create retries', () => {
  beforeEach(() => { state.creates.clear(); state.inserts = 0; state.links = 0; state.histories = 0; state.seq = 0; });

  it('recovers a lost response without duplicating header, system links, or history', async () => {
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const body = { idempotency_key: key, system_ids: ['11111111-1111-4111-8111-111111111111'] };
    const first = await create(body);
    const retry = await create(body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.json.id).toBe(first.json.id);
    expect([state.inserts, state.links, state.histories, state.seq]).toEqual([1, 1, 1, 1]);

    const otherUser = await create(body, '88888888-8888-4888-8888-888888888888');
    const otherKey = await create({ ...body, idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(otherUser.status).toBe(201);
    expect(otherKey.status).toBe(201);
    expect(new Set([first.json.id, otherUser.json.id, otherKey.json.id]).size).toBe(3);
  });

  it('rejects malformed keys without inserting a PO', async () => {
    expect((await create({ idempotency_key: 'not-a-uuid' })).status).toBe(400);
    expect(state.inserts).toBe(0);
  });
});