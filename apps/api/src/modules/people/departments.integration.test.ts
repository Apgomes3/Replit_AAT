// @vitest-environment node
// Departments: admins add, rename, nest, archive and remove them; people and teams stay tied to them.
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import adminRoutes from '../../routes/admin';
import authRoutes from '../../routes/auth';
import { departmentForUser, slugKey, STARTING_DEPARTMENTS, validateDepartmentInput } from './departments';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
let token = '';
const ids: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('department input', () => {
  it('needs a name and checks code, colour, people, parent and menu areas', () => {
    expect(validateDepartmentInput({ name: '  Quality   control ', code: ' qa ' }).value).toMatchObject({ name: 'Quality control', code: 'QA', colour: 'slate', nav_areas: null, is_active: true });
    expect(validateDepartmentInput({ name: '' }).error).toMatch(/name/);
    expect(validateDepartmentInput({ name: 'x', colour: 'pink' }).error).toMatch(/colour/);
    expect(validateDepartmentInput({ name: 'x', code: 'TOO-LONG-CODE' }).error).toMatch(/code/);
    expect(validateDepartmentInput({ name: 'x', nav_areas: ['engineering', 'nowhere'] }).error).toMatch(/nav_areas/);
    expect(validateDepartmentInput({ name: 'x', nav_areas: ['factory', 'engineering'] }).value!.nav_areas).toEqual(['engineering', 'factory']);
    expect(validateDepartmentInput({ name: 'x', parent_id: 'nope' }).error).toMatch(/parent_id/);
    expect(slugKey('Business Development / Sales')).toBe('business_development_sales');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('departments (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.admin = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Dept', 'Admin', 'admin') RETURNING id`,
      [`dept-admin-${tag}@example.test`])).rows[0].id;
    ids.person = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Dept', 'Person', 'user') RETURNING id`,
      [`dept-person-${tag}@example.test`])).rows[0].id;
    token = jwt.sign({ id: ids.admin, email: `dept-admin-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
    app.use('/api/v1/auth', authRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM drafting_teams WHERE name LIKE $1`, [`%${tag}`]);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [ids.admin]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.admin, ids.person]]);
    await query(`UPDATE departments SET parent_id = NULL WHERE name LIKE $1`, [`%${tag}`]);
    await query(`DELETE FROM departments WHERE name LIKE $1`, [`%${tag}`]);
  });

  it('has the starting departments, with Design and Drafting under Engineering', async () => {
    const rows = (await query(`SELECT d.key, p.key AS parent FROM departments d LEFT JOIN departments p ON p.id = d.parent_id`)).rows;
    expect(rows.map(r => r.key)).toEqual(expect.arrayContaining(STARTING_DEPARTMENTS.map(d => d.key)));
    expect(rows.find(r => r.key === 'design')?.parent).toBe('engineering');
    expect(rows.find(r => r.key === 'drafting')?.parent).toBe('engineering');
  });

  it('adds, nests and refuses duplicates and loops', async () => {
    const top = await call('POST', '/admin/departments', { name: `Quality ${tag}`, code: 'qa', colour: 'teal', head_user_id: ids.admin, nav_areas: ['factory'] });
    expect(top.status).toBe(201);
    expect(top.body).toMatchObject({ code: 'QA', head_name: 'Dept Admin', nav_areas: ['factory'], people: 0, teams: [] });
    ids.top = top.body.id; ids.topKey = top.body.key;
    const sub = await call('POST', '/admin/departments', { name: `Inspection ${tag}`, parent_id: ids.top });
    expect(sub.body.parent_name).toBe(`Quality ${tag}`);
    ids.sub = sub.body.id;
    expect((await call('POST', '/admin/departments', { name: `quality ${tag}` })).status).toBe(409);
    const loop = await call('PUT', `/admin/departments/${ids.top}`, { name: `Quality ${tag}`, parent_id: ids.sub });
    expect(loop.status).toBe(400);
    expect(loop.body.error.message).toMatch(/under itself/);
  });

  it('gives people the department, its menu areas at sign-in, and filters the user list', async () => {
    expect((await call('PUT', `/admin/users/${ids.person}`, { first_name: 'Dept', last_name: 'Person', role: 'user', is_active: true, department: 'nowhere' })).status).toBe(400);
    expect((await call('PUT', `/admin/users/${ids.person}`, { first_name: 'Dept', last_name: 'Person', role: 'user', is_active: true, department: ids.topKey })).status).toBe(200);
    expect(await departmentForUser(ids.topKey)).toEqual({ department_name: `Quality ${tag}`, department_areas: ['factory'] });
    const list = await call('GET', `/admin/users?department=${ids.topKey}&page_size=100`);
    expect(list.body.items.map((u: any) => u.id)).toEqual([ids.person]);
    expect((await call('GET', '/admin/departments')).body.data.find((d: any) => d.id === ids.top).people).toBe(1);
  });

  it('carries a rename through to teams, and refuses to remove a department in use', async () => {
    await query(`INSERT INTO drafting_teams (name, department) VALUES ($1, $2)`, [`Team ${tag}`, `Quality ${tag}`]);
    const renamed = await call('PUT', `/admin/departments/${ids.top}`, { name: `Quality assurance ${tag}`, code: 'QA', colour: 'teal', nav_areas: ['factory'] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.teams.map((t: any) => t.name)).toEqual([`Team ${tag}`]);
    expect((await query(`SELECT department FROM drafting_teams WHERE name = $1`, [`Team ${tag}`])).rows[0].department).toBe(`Quality assurance ${tag}`);
    expect((await query(`SELECT department FROM users WHERE id = $1`, [ids.person])).rows[0].department).toBe(ids.topKey); // key never changes

    const refused = await call('DELETE', `/admin/departments/${ids.top}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/1 person, 1 team, 1 sub-department/);

    const archived = await call('PUT', `/admin/departments/${ids.top}`, { name: `Quality assurance ${tag}`, is_active: false });
    expect(archived.body.is_active).toBe(false);
    const audit = (await query(`SELECT details->>'summary' AS s FROM audit_logs WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [ids.top])).rows[0];
    expect(audit.s).toMatch(/archived/);
  });

  it('keeps Drafting named as it is, and removes an unused department', async () => {
    const drafting = (await query(`SELECT id FROM departments WHERE key = 'drafting'`)).rows[0];
    expect((await call('PUT', `/admin/departments/${drafting.id}`, { name: 'Drawings' })).body.error.message).toMatch(/cannot be renamed/);
    expect((await call('DELETE', `/admin/departments/${ids.sub}`)).status).toBe(200);
    expect((await call('DELETE', `/admin/departments/${ids.sub}`)).status).toBe(404);
  });
});
