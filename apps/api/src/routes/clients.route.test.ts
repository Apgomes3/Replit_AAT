// @vitest-environment node
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ sql: [] as string[], contactRows: [] as any[] }));
vi.mock('../middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => { _req.user = { id: 'user-1' }; next(); },
  requireModuleAccess: () => (_req: any, _res: any, next: any) => next(),
  requireModuleManage: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../db', () => {
  const clientQuery = vi.fn(async (sql: string, params: any[] = []) => {
    state.sql.push(sql);
    if (sql.includes('enquiry_number_counters') && sql.includes('INSERT')) return { rows: [] };
    if (sql.includes('enquiry_number_counters') && sql.includes('SELECT')) return { rows: [{ value: 4 }] };
    if (sql.includes('INSERT INTO clients')) return { rows: [{ id: 'client-1', name: params[1], client_code: params[0], address: {}, status: 'active', active: true }] };
    if (sql.includes('INSERT INTO client_contacts')) { state.contactRows.push(params); return { rows: [] }; }
    if (sql.includes('DELETE FROM client_contacts')) { state.contactRows = []; return { rows: [] }; }
    if (sql.includes('SELECT * FROM client_contacts')) return { rows: state.contactRows.map((p, i) => ({ id: `contact-${i}`, name: p[1], email: p[2], phone: p[3], is_primary: p[5] })) };
    if (sql.includes('UPDATE clients')) return { rows: [{ id: 'client-1', name: 'Company', address: {}, status: 'active', active: true }] };
    return { rows: [] };
  });
  return {
    query: vi.fn(async (sql: string) => {
      state.sql.push(sql);
      if (sql.includes('COUNT(*)')) return { rows: [{ count: 1 }] };
      if (sql.includes('FROM clients c')) return { rows: [{ id: 'client-1', name: 'Company', client_code: 'CL-1', address: {}, status: 'active', active: true, contact_count: 2, primary_contact_name: 'Alex', primary_contact_email: 'alex@example.com', primary_contact_phone: null }] };
      if (sql.includes('FROM clients WHERE')) return { rows: [{ id: 'client-1', name: 'Company', address: {}, status: 'active', active: true }] };
      if (sql.includes('FROM enquiries')) return { rows: [] };
      if (sql.includes('FROM client_contacts')) return { rows: state.contactRows.map((p, i) => ({ id: `contact-${i}`, name: p[1], email: p[2], phone: p[3], is_primary: p[5] })) };
      return { rows: [] };
    }),
    withTransaction: vi.fn(async (work: any) => work({ query: clientQuery })),
  };
});

import clients from './clients';

async function request(method: string, path: string, body?: any) {
  const app = express(); app.use(express.json()); app.use('/api/v1/clients', clients);
  const server = app.listen(0);
  return new Promise<any>(resolve => server.once('listening', async () => {
    const address = server.address() as any;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json(); server.close(); resolve({ status: response.status, json });
  }));
}

describe('client route contact contract', () => {
  beforeEach(() => { state.sql.length = 0; state.contactRows = []; });

  it('creates multiple contacts transactionally and exposes contact search/list projections', async () => {
    const created = await request('POST', '/api/v1/clients', {
      name: 'Company', contacts: [
        { name: 'Alex', email: 'alex@example.com' },
        { name: 'Sam', email: 'sam@example.com' },
      ],
    });
    expect(created.status).toBe(201);
    expect(state.contactRows).toHaveLength(2);
    const listed = await request('GET', '/api/v1/clients?search=sam');
    expect(listed.status).toBe(200);
    expect(state.sql.some(sql => sql.includes('sc.email ILIKE'))).toBe(true);
  });

  it('clears contacts with an explicit empty array while legacy aliases adapt only complete pairs', async () => {
    const patched = await request('PATCH', '/api/v1/clients/11111111-1111-4111-8111-111111111111', { contacts: [] });
    expect(patched.status).toBe(200);
    expect(state.sql.some(sql => sql.includes('DELETE FROM client_contacts'))).toBe(true);
    const legacy = await request('POST', '/api/v1/clients', { name: 'Legacy', contact_name: 'Alex', contact_email: 'alex@example.com' });
    expect(legacy.status).toBe(201);
    const rejected = await request('POST', '/api/v1/clients', { name: 'Incomplete', contact_name: 'Alex' });
    expect(rejected.status).toBe(400);
  });
});