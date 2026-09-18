// @vitest-environment node
import express from 'express';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ access: 'manage', counter: 1, activities: [] as any[], project: false }));
vi.mock('../db', () => {
  const clientQuery = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('business_number_counters') && sql.includes('INSERT')) return { rows: [] };
    if (sql.includes('business_number_counters') && sql.includes('SELECT')) return { rows: [{ value: state.counter++ }] };
    if (sql.includes('FROM projects WHERE id=$1')) return state.project ? { rows: [{ id: '33333333-3333-4333-8333-333333333333', project_name: 'Harbour Aquarium', client_name: 'Copied Client', site_name: 'Harbour', country: 'NZ', city: 'Auckland' }] } : { rows: [] };
    if (sql.includes('SELECT book_number FROM business_books')) return { rows: [{ book_number: 'BD-2026-0001' }] };
    if (sql.includes('INSERT INTO business_book_activities')) { state.activities.push(params); return { rows: [] }; }
    if (sql.includes('INSERT INTO business_opportunities')) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', opportunity_number: params[1], title: params[2] }] };
    if (sql.includes('INSERT INTO business_books')) return { rows: [{
      id: '11111111-1111-4111-8111-111111111111', book_number: params[0], title: params[1],
      client_name: params[4], reporting_currency: params[8], status: params[9],
    }] };
    return { rows: [] };
  });
  return {
    query: vi.fn(async (sql: string) => sql.includes('SELECT rma.access_level') ? { rows: [{ access_level: state.access }] } : { rows: [] }),
    withTransaction: vi.fn(async (work: any) => work({ query: clientQuery })),
    default: { connect: vi.fn() },
  };
});

import businessBooks from './businessBooks';

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/business-books', businessBooks);
  return instance;
}
async function request(method: string, path: string, body?: any) {
  const server = app().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address() as any;
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method, headers: { authorization: `Bearer ${jwt.sign({ id: '22222222-2222-4222-8222-222222222222', role: 'engineer' }, 'edp-secret-change-in-production')}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await response.json();
  await new Promise<void>(resolve => server.close(() => resolve()));
  return { status: response.status, json };
}

describe('business development foundation', () => {
  beforeEach(() => { state.access = 'manage'; state.counter = 1; state.project = false; state.activities.length = 0; });

  it('enforces view versus manage access', async () => {
    state.access = 'view';
    const response = await request('POST', '/api/v1/business-books', { title: 'Read only', client_name: 'Client' });
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe('MODULE_READ_ONLY');
  });

  it('creates a standalone book with a controlled number and activity', async () => {
    const response = await request('POST', '/api/v1/business-books', { title: 'Standalone', client_name: 'Client' });
    expect(response.status).toBe(201);
    expect(response.json.book_number).toMatch(/^BD-\d{4}-0001$/);
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0][2]).toBe('created');
  });

  it('copies client and location snapshots when linked to a project', async () => {
    state.project = true;
    const response = await request('POST', '/api/v1/business-books', {
      project_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(response.status).toBe(201);
    expect(response.json.title).toBe('Harbour Aquarium');
    expect(response.json.client_name).toBe('Copied Client');
  });

  it('creates an opportunity under a business book and records activity', async () => {
    const response = await request('POST', '/api/v1/business-books/11111111-1111-4111-8111-111111111111/opportunities', {
      title: 'Base package', kind: 'package_scope', probability: 50,
    });
    expect(response.status).toBe(201);
    expect(response.json.opportunity_number).toBe('BD-2026-0001-OP01');
    expect(state.activities.at(-1)[2]).toBe('opportunity_created');
  });

  it('rejects invalid opportunity route UUIDs before database work', async () => {
    const response = await request('PATCH', '/api/v1/business-books/not-a-uuid/opportunities/not-a-uuid', { title: '' });
    expect(response.status).toBe(400);
    expect(response.json.error.code).toBe('VALIDATION');
  });
});