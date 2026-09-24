// @vitest-environment node
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: 'manage', counter: 1, enquiry: true, project: false, designBook: true, quote: false, quoteStatus: 'draft', creates: new Map<string, any>(), inserts: 0 }));
vi.mock('../db', () => {
  const clientQuery = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('idempotency_key=$2')) return { rows: state.creates.has(`${params[0]}:${params[1]}`) ? [state.creates.get(`${params[0]}:${params[1]}`)] : [] };
    if (sql.includes('enquiry_number_counters') && sql.includes('INSERT')) return { rows: [] };
    if (sql.includes('enquiry_number_counters') && sql.includes('SELECT')) return { rows: [{ value: state.counter++ }] };
    if (sql.includes('FROM clients WHERE id=$1')) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Client' }] };
    if (sql.includes('FROM projects WHERE id=$1')) return state.project ? { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] } : { rows: [] };
    if (sql.includes('FROM design_books WHERE id=$1')) return state.designBook ? { rows: [{ id: '55555555-5555-4555-8555-555555555555', project_id: null }] } : { rows: [] };
    if (sql.includes('INSERT INTO enquiries')) {
      state.inserts++;
      const row = { id: `22222222-2222-4222-8222-${String(state.inserts).padStart(12, '0')}`, enquiry_number: params[0], title: params[2], status: params[4], client_id: params[1], contact_details: params[5], source_metadata: params[10] };
      if (params[12]) state.creates.set(`${params[11]}:${params[12]}`, row);
      return { rows: [row] };
    }
    if (sql.includes('INSERT INTO enquiry_activities')) return { rows: [] };
    if (sql.includes('FROM enquiries WHERE id=$1')) return state.enquiry ? { rows: [{ id: '22222222-2222-4222-8222-222222222222', client_id: '11111111-1111-4111-8111-111111111111', design_book_id: state.designBook ? '55555555-5555-4555-8555-555555555555' : null, updated_at: new Date('2026-01-01T00:00:00.000Z'), version: '42' }] } : { rows: [] };
    if (sql.includes('SELECT * FROM enquiry_quotes')) return state.quote ? { rows: [{ id: '66666666-6666-4666-8666-666666666666', enquiry_id: '22222222-2222-4222-8222-222222222222', quote_number: 'QUO-2026-0001', status: state.quoteStatus }] } : { rows: [] };
    if (sql.includes('UPDATE enquiry_quotes')) { state.quoteStatus = params[0] || state.quoteStatus; return { rows: [{ id: '66666666-6666-4666-8666-666666666666', status: state.quoteStatus, currency: params[1] || 'USD' }] }; }
    if (sql.includes('INSERT INTO enquiry_quotes')) { state.quote = true; state.quoteStatus = 'draft'; return { rows: [{ id: '66666666-6666-4666-8666-666666666666', quote_number: params[1], enquiry_id: params[0], status: 'draft' }] }; }
    if (sql.includes('design_book_equipment_breakdown_lines')) return { rows: [{ id: '77777777-7777-4777-8777-777777777777', description: 'Pump', quantity: 2, unit: 'EA', unit_cost: 0, selling_price: 0, currency: 'USD' }] };
    if (sql.includes('INSERT INTO enquiry_quote_lines')) return { rows: [{ id: '88888888-8888-4888-8888-888888888888' }] };
    if (sql.includes('SELECT * FROM enquiry_quote_lines')) return { rows: [{ id: '88888888-8888-4888-8888-888888888888', description: 'Pump' }] };
    return { rows: [] };
  });
  return {
    query: vi.fn(async (sql: string) => sql.includes('SELECT rma.access_level') ? { rows: [{ access_level: state.access }] } : { rows: [] }),
    withTransaction: vi.fn(async (work: any) => work({ query: clientQuery })),
  };
});

import enquiries from './enquiries';

function request(method: string, path: string, body?: any, userId = '99999999-9999-4999-8999-999999999999') {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/enquiries', enquiries);
  const server = app.listen(0);
  return new Promise<any>(resolve => {
    server.once('listening', async () => {
      const address = server.address() as any;
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: { authorization: `Bearer ${jwt.sign({ id: userId, role: 'engineer' }, 'edp-secret-change-in-production')}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json();
      server.close();
      resolve({ status: response.status, json });
    });
  });
}

describe('enquiry API contract', () => {
  beforeEach(() => { state.access = 'manage'; state.counter = 1; state.enquiry = true; state.project = false; state.designBook = true; state.quote = false; state.quoteStatus = 'draft'; state.creates.clear(); state.inserts = 0; });

  it('returns the first enquiry after its response is lost, scoped to its creator and key', async () => {
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const body = { client_id: '11111111-1111-4111-8111-111111111111', title: 'Lost response', idempotency_key: key };
    const first = await request('POST', '/api/v1/enquiries', body);
    const retry = await request('POST', '/api/v1/enquiries', body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.json.id).toBe(first.json.id);
    expect(state.inserts).toBe(1);
    const other = await request('POST', '/api/v1/enquiries', body, '88888888-8888-4888-8888-888888888888');
    expect(other.status).toBe(201);
    expect(other.json.id).not.toBe(first.json.id);
    const next = await request('POST', '/api/v1/enquiries', { ...body, idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(next.status).toBe(201);
    expect(next.json.id).not.toBe(first.json.id);
  });

  it('returns a committed enquiry on a next-day retry before validating the now-past due date', async () => {
    const body = {
      client_id: '11111111-1111-4111-8111-111111111111',
      title: 'Due today',
      due_date: '2026-09-24',
      idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
      const first = await request('POST', '/api/v1/enquiries', body);
      vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
      const retried = await request('POST', '/api/v1/enquiries', body);
      expect(first.status).toBe(201);
      expect(retried.status).toBe(200);
      expect(retried.json.id).toBe(first.json.id);
      expect(state.inserts).toBe(1);
      expect(state.counter).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces module manage access', async () => {
    state.access = 'view';
    const response = await request('POST', '/api/v1/enquiries', { client_id: '11111111-1111-4111-8111-111111111111', title: 'Request' });
    expect(response.status).toBe(403);
  });

  it('creates a standalone enquiry with controlled number and flat contact aliases', async () => {
    const response = await request('POST', '/api/v1/enquiries', { client_id: '11111111-1111-4111-8111-111111111111', title: 'Request', contact_name: 'Alex', contact_email: 'alex@example.com', source: 'web' });
    expect(response.status).toBe(201);
    expect(response.json.enquiry_number).toMatch(/^ENQ-\d{4}-0001$/);
    expect(response.json.contact_name).toBe('Alex');
    expect(response.json.source).toBe('web');
  });

  it('rejects a missing linked project and missing create-project fields', async () => {
    const linked = await request('POST', '/api/v1/enquiries', { client_id: '11111111-1111-4111-8111-111111111111', title: 'Request', project_id: '33333333-3333-4333-8333-333333333333' });
    expect(linked.status).toBe(404);
    const project = await request('POST', '/api/v1/enquiries/22222222-2222-4222-8222-222222222222/create-project', {});
    expect(project.status).toBe(400);
  });

  it('creates and updates one quote, and imports persisted snapshot lines', async () => {
    const created = await request('POST', '/api/v1/enquiries/22222222-2222-4222-8222-222222222222/quote', {});
    expect(created.status).toBe(201);
    const imported = await request('POST', '/api/v1/enquiries/22222222-2222-4222-8222-222222222222/quote/import-equipment-breakdown');
    expect(imported.status).toBe(200);
    expect(imported.json.quote).toBeDefined();
    expect(imported.json.lines[0].id).toBe('88888888-8888-4888-8888-888888888888');
    const updated = await request('PATCH', '/api/v1/enquiries/22222222-2222-4222-8222-222222222222/quote', { status: 'issued', currency: 'EUR' });
    expect(updated.status).toBe(200);
    const locked = await request('POST', '/api/v1/enquiries/22222222-2222-4222-8222-222222222222/quote/import-equipment-breakdown');
    expect(locked.status).toBe(409);
  });

  it('rejects an enquiry PATCH based on a stale expected_version with the current row and token', async () => {
    const stale = await request('PATCH', '/api/v1/enquiries/22222222-2222-4222-8222-222222222222', {
      title: 'Overwritten title',
      expected_version: '41',
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('VERSION_CONFLICT');
    expect(stale.json.error.current_version).toBe('42');
    expect(stale.json.error.current_record.version).toBe('42');
  });
});