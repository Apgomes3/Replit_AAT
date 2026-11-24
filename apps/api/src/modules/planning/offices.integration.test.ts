// @vitest-environment node
// Offices: admins manage them, and giving a person an office sets their working calendar.
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import adminRoutes from '../../routes/admin';
import { STARTING_OFFICES, validateOfficeInput } from './offices';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
let token = '';
const ids: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1/admin${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('office input', () => {
  it('needs a name and takes an optional calendar, address and time zone', () => {
    expect(validateOfficeInput({ name: '  Shanghai ' }).value).toEqual({ name: 'Shanghai', calendar_id: null, address: null, time_zone: null });
    expect(validateOfficeInput({ name: 'x', address: ' 1 Road\r\nShanghai ', time_zone: ' Asia/Shanghai ' }).value)
      .toMatchObject({ address: '1 Road\nShanghai', time_zone: 'Asia/Shanghai' });
    expect(validateOfficeInput({ name: 'x', time_zone: 'Mars/Olympus' }).error).toMatch(/not a time zone/);
    expect(validateOfficeInput({ name: 'x', time_zone: 'EST' }).error).toMatch(/not a time zone/);
    expect(validateOfficeInput({ name: 'x', address: 'a'.repeat(1001) }).error).toMatch(/address/);
    expect(validateOfficeInput({ name: '' }).error).toMatch(/name/);
    expect(validateOfficeInput({ name: 'x', calendar_id: 'nope' }).error).toMatch(/calendar_id/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('offices (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.admin = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Office', 'Admin', 'admin') RETURNING id`,
      [`offices-admin-${tag}@example.test`])).rows[0].id;
    ids.person = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Moving', 'Person', 'user') RETURNING id`,
      [`offices-person-${tag}@example.test`])).rows[0].id;
    token = jwt.sign({ id: ids.admin, email: `offices-admin-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    ids.calA = (await query(`INSERT INTO planning_calendars (name, week_hours) VALUES ($1, '{8,8,8,8,8,0,0}') RETURNING id`, [`Cal A ${tag}`])).rows[0].id;
    ids.calB = (await query(`INSERT INTO planning_calendars (name, week_hours) VALUES ($1, '{9,9,9,9,9,8,0}') RETURNING id`, [`Cal B ${tag}`])).rows[0].id;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM planning_resources WHERE user_id = ANY($1::uuid[])`, [[ids.admin, ids.person]]);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [ids.admin]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.admin, ids.person]]);
    await query(`DELETE FROM offices WHERE name LIKE $1`, [`%${tag}`]);
    await query(`DELETE FROM planning_calendars WHERE id = ANY($1::uuid[])`, [[ids.calA, ids.calB]]);
  });

  it('has the starting offices after migration, with their time zones', async () => {
    const rows = (await query(`SELECT name, time_zone FROM offices`)).rows;
    expect(rows.map(r => r.name)).toEqual(expect.arrayContaining(STARTING_OFFICES.map(o => o.name)));
    expect(rows.find(r => r.name === 'Philippines')?.time_zone).toBe('Asia/Manila');
  });

  it('adds, renames and refuses duplicate offices', async () => {
    const a = await call('POST', '/offices', { name: `Office A ${tag}`, calendar_id: ids.calA, address: '1 Test Road\nShanghai', time_zone: 'Asia/Shanghai' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ calendar_name: `Cal A ${tag}`, people: 0, address: '1 Test Road\nShanghai', time_zone: 'Asia/Shanghai' });
    expect((await call('POST', '/offices', { name: `Office Z ${tag}`, time_zone: 'Nowhere/Here' })).status).toBe(400);
    ids.officeA = a.body.id;
    ids.officeB = (await call('POST', '/offices', { name: `Office B ${tag}`, calendar_id: ids.calB })).body.id;
    expect((await call('POST', '/offices', { name: `office a ${tag}` })).status).toBe(409);
    const list = await call('GET', '/offices');
    expect(list.body.data.map((o: any) => o.id)).toEqual(expect.arrayContaining([ids.officeA, ids.officeB]));
    expect(list.body.calendars.map((c: any) => c.id)).toContain(ids.calA);
  });

  it('edits the address and time zone, and clears them', async () => {
    const put = await call('PUT', `/offices/${ids.officeB}`, { name: `Office B ${tag}`, calendar_id: ids.calB, address: 'Manila', time_zone: 'Asia/Manila' });
    expect(put.body).toMatchObject({ address: 'Manila', time_zone: 'Asia/Manila' });
    const cleared = await call('PUT', `/offices/${ids.officeB}`, { name: `Office B ${tag}`, calendar_id: ids.calB, address: '', time_zone: '' });
    expect(cleared.body).toMatchObject({ address: null, time_zone: null });
  });

  it("sets the person's calendar from their office, and filters people by office", async () => {
    const put = (office_id: string | null) => call('PUT', `/users/${ids.person}`, { first_name: 'Moving', last_name: 'Person', role: 'user', is_active: true, office_id });
    expect((await put(ids.officeA)).status).toBe(200);
    const calOf = async () => (await query(`SELECT calendar_id FROM planning_resources WHERE user_id = $1`, [ids.person])).rows[0]?.calendar_id;
    expect(await calOf()).toBe(ids.calA);

    // A different calendar set by hand stays while the office does not change.
    await query(`UPDATE planning_resources SET calendar_id = $2 WHERE user_id = $1`, [ids.person, ids.calB]);
    await call('PUT', `/users/${ids.person}`, { first_name: 'Moved', last_name: 'Person', role: 'user', is_active: true });
    expect(await calOf()).toBe(ids.calB);
    await put(ids.officeA);
    expect(await calOf()).toBe(ids.calB);

    expect((await put(ids.officeB)).status).toBe(200);
    expect(await calOf()).toBe(ids.calB);
    await put(ids.officeA);
    expect(await calOf()).toBe(ids.calA);

    const inA = await call('GET', `/users?office=${ids.officeA}&page_size=100`);
    expect(inA.body.items.map((u: any) => u.id)).toEqual([ids.person]);
    expect(inA.body.items[0].office_name).toBe(`Office A ${tag}`);
    const none = await call('GET', `/users?office=none&page_size=1000`);
    expect(none.body.items.map((u: any) => u.id)).toContain(ids.admin);

    const audit = (await query(`SELECT details->>'summary' AS s FROM audit_logs WHERE entity_id = $1 AND entity_type = 'user' ORDER BY created_at DESC LIMIT 1`, [ids.person])).rows[0];
    expect(audit.s).toMatch(/^Office: .* → Office A/);
  });

  it('exports offices and moves people between offices from a file', async () => {
    await query(`UPDATE users SET department = 'engineering' WHERE id = $1`, [ids.person]);
    const exported = await fetch(`${base}/api/v1/admin/users/export`, { headers: { Authorization: `Bearer ${token}` } });
    const csv = await exported.text();
    expect(csv.split('\r\n')[0]).toMatch(/,office,department$/);
    expect(csv).toContain(`offices-person-${tag}@example.test,Moving,Person,,user,active,,,Office A ${tag},Engineering`);

    const upload = async (apply: boolean) => {
      const form = new FormData();
      form.append('file', new Blob([`email,office\r\noffices-person-${tag}@example.test,office b ${tag}\r\n`], { type: 'text/csv' }), 'users.csv');
      const res = await fetch(`${base}/api/v1/admin/users/reporting-import${apply ? '?apply=1' : ''}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      return (await res.json()) as any;
    };
    const preview = await upload(false);
    expect(preview.changes).toEqual([expect.objectContaining({ office: { from: `Office A ${tag}`, to: `Office B ${tag}`, to_id: ids.officeB } })]);
    expect((await query(`SELECT office_id FROM users WHERE id = $1`, [ids.person])).rows[0].office_id).toBe(ids.officeA);

    expect((await upload(true)).applied).toBe(true);
    expect((await query(`SELECT office_id FROM users WHERE id = $1`, [ids.person])).rows[0].office_id).toBe(ids.officeB);
    expect((await query(`SELECT calendar_id FROM planning_resources WHERE user_id = $1`, [ids.person])).rows[0].calendar_id).toBe(ids.calB);

    // Back to office A for the next test.
    await call('PUT', `/users/${ids.person}`, { first_name: 'Moving', last_name: 'Person', role: 'user', is_active: true, office_id: ids.officeA });
  });

  it('leaves people without an office when it is removed, keeping their calendar', async () => {
    expect((await call('DELETE', `/offices/${ids.officeA}`)).status).toBe(200);
    expect((await query(`SELECT office_id FROM users WHERE id = $1`, [ids.person])).rows[0].office_id).toBeNull();
    expect((await query(`SELECT calendar_id FROM planning_resources WHERE user_id = $1`, [ids.person])).rows[0].calendar_id).toBe(ids.calA);
    expect((await call('DELETE', `/offices/${ids.officeA}`)).status).toBe(404);
  });
});
