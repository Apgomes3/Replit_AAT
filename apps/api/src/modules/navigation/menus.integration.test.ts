// @vitest-environment node
// Admin -> Menus: who sees which left-menu menu, by department, by name and by exception.
// The PostgreSQL part runs against the test database (TEST_DATABASE_URL).
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import authRoutes from '../../routes/auth';
import menuRoutes from './routes';
import { menuStateFor, menusForUser, seedMenus, SYSTEM_MENUS, validateMenuInput } from './menus';
import { NAVIGATION_SCHEMA } from './schema';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const base = { id: 'm', is_active: true, visibility: 'departments' as const, department_keys: ['engineering'], user_ids: [] as string[], include_unassigned: false, outside: 'hide' as const };

describe('menu rules', () => {
  it('opens a menu for its departments (sub-departments count) and hides or folds it for others', () => {
    expect(menuStateFor(base, { id: A, departments: ['design', 'engineering'] })).toEqual({ state: 'open', member: true });
    expect(menuStateFor(base, { id: A, departments: ['procurement'] })).toBeNull();
    expect(menuStateFor({ ...base, outside: 'fold' }, { id: A, departments: ['procurement'] })).toEqual({ state: 'folded', member: false });
    expect(menuStateFor(base, { id: A, departments: [] })).toBeNull();
    expect(menuStateFor({ ...base, include_unassigned: true }, { id: A, departments: [] })).toEqual({ state: 'open', member: false });
  });

  it('handles everyone, named people, exceptions and switched-off menus', () => {
    expect(menuStateFor({ ...base, visibility: 'everyone' }, { id: A, departments: [] })).toEqual({ state: 'open', member: false });
    const people = { ...base, visibility: 'people' as const, user_ids: [A] };
    expect(menuStateFor(people, { id: A, departments: [] })).toEqual({ state: 'open', member: true });
    expect(menuStateFor(people, { id: B, departments: ['engineering'] })).toBeNull();
    expect(menuStateFor(base, { id: B, departments: [] }, 'show')).toEqual({ state: 'open', member: true });
    expect(menuStateFor({ ...base, visibility: 'everyone' }, { id: B, departments: [] }, 'hide')).toBeNull();
    expect(menuStateFor({ ...base, is_active: false }, { id: A, departments: ['engineering'] }, 'show')).toBeNull();
  });

  it('checks menu input', () => {
    expect(validateMenuInput({ label: '  Quality  ', visibility: 'everyone', items: [{ label: 'Wiki', path: 'https://wiki.example.com', module_key: '' }] }).value)
      .toMatchObject({ label: 'Quality', outside: 'hide', items: [{ label: 'Wiki', path: 'https://wiki.example.com', icon: null, module_key: null }] });
    expect(validateMenuInput({ label: '' }).error).toMatch(/label/);
    expect(validateMenuInput({ label: 'x', visibility: 'departments' }).error).toMatch(/department/);
    expect(validateMenuInput({ label: 'x', visibility: 'people' }).error).toMatch(/person/);
    expect(validateMenuInput({ label: 'x', visibility: 'people', user_ids: ['nope'] }).error).toMatch(/user_ids/);
    expect(validateMenuInput({ label: 'x', items: [{ label: 'Bad', path: '//evil.example' }] }).error).toMatch(/path/);
    expect(validateMenuInput({ label: 'x', items: [{ label: 'Bad', path: 'javascript:alert(1)' }] }).error).toMatch(/path/);
    expect(validateMenuInput({ label: 'x', items: [{ label: 'Hi', path: '/projects', module_key: 'nope' }] }).error).toMatch(/module/);
    expect(validateMenuInput({ label: 'x', icon: 'rocket' }).error).toMatch(/icon/);
    expect(validateMenuInput({ label: 'x', overrides: [{ user_id: A, mode: 'show' }, { user_id: A, mode: 'hide' }] }).error).toMatch(/one exception/);
    // Built-in menus keep their code-defined pages.
    expect(validateMenuInput({ label: 'x', items: [{ label: 'Hi', path: '/x' }] }, true).value!.items).toEqual([]);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('menus (PostgreSQL)', () => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ids: Record<string, string> = {};
  let server: http.Server;
  let url = '';
  let token = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}/api/v1${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    await query(NAVIGATION_SCHEMA);
    await seedMenus();
    const user = async (name: string, role: string, department: string | null) => (await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, department) VALUES ($1, 'x', 'Menu', $2, $3, $4) RETURNING id`,
      [`menu-${name}-${tag}@example.test`, name, role, department])).rows[0].id;
    ids.admin = await user('Admin', 'admin', null);
    ids.designer = await user('Designer', 'engineer', 'design');
    ids.buyer = await user('Buyer', 'user', 'procurement');
    ids.loner = await user('Loner', 'user', null);
    token = jwt.sign({ id: ids.admin, email: `menu-admin-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin/menus', menuRoutes);
    app.use('/api/v1/auth', authRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM nav_menus WHERE label LIKE $1`, [`%${tag}`]);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [ids.admin]);
    await query(`DELETE FROM users WHERE email LIKE $1`, [`menu-%-${tag}@example.test`]);
  });

  it('has the built-in menus, and seeding twice adds nothing', async () => {
    const keys = (await query(`SELECT key FROM nav_menus WHERE is_system`)).rows.map(r => r.key);
    expect(keys).toEqual(expect.arrayContaining(SYSTEM_MENUS.map(m => m.key)));
    expect(await seedMenus()).toEqual([]);
  });

  it('adds a custom menu for a department, with links, an exception and a preview', async () => {
    const created = await call('POST', '/admin/menus', {
      label: `Quality ${tag}`, icon: 'clipboard', visibility: 'departments', department_keys: ['engineering'], outside: 'hide',
      items: [{ label: 'Checklists', path: '/documents', icon: 'file', module_key: 'documents' }, { label: 'Wiki', path: 'https://wiki.example.com' }],
      overrides: [{ user_id: ids.loner, mode: 'show' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ is_system: false, items: [{ label: 'Checklists' }, { label: 'Wiki' }], overrides: [{ user_id: ids.loner, mode: 'show', name: 'Menu Loner' }] });
    ids.menu = created.body.data.id;
    const key = created.body.data.key;

    // Design sits under Engineering, so the designer gets it; the buyer does not; the loner has an exception.
    expect((await menusForUser(ids.designer))!.find(m => m.key === key)).toMatchObject({ state: 'open', member: true, items: [{ path: '/documents' }, { path: 'https://wiki.example.com' }] });
    expect((await menusForUser(ids.buyer))!.some(m => m.key === key)).toBe(false);
    expect((await menusForUser(ids.loner))!.find(m => m.key === key)).toMatchObject({ state: 'open', member: true });

    const preview = await call('GET', `/admin/menus/preview/${ids.buyer}`);
    expect(preview.status).toBe(200);
    expect(preview.body.role).toBe('user');
    expect(preview.body.data.some((m: any) => m.key === key)).toBe(false);
    expect((await call('GET', `/admin/menus/preview/not-a-person`)).status).toBe(404);

    // Folded for everyone else instead of hidden.
    const folded = await call('PUT', `/admin/menus/${ids.menu}`, { ...created.body.data, outside: 'fold' });
    expect(folded.status).toBe(200);
    expect((await menusForUser(ids.buyer))!.find(m => m.key === key)).toMatchObject({ state: 'folded', member: false });
  });

  it('returns the menus at sign-in and keeps built-in menus\' pages and existence', async () => {
    const me = await fetch(`${url}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${jwt.sign({ id: ids.designer, email: 'x', role: 'engineer' }, JWT_SECRET)}` } }).then(r => r.json()) as any;
    expect(me.menus.map((m: any) => m.key)).toContain('engineering');

    const eng = (await call('GET', '/admin/menus')).body.data.find((m: any) => m.key === 'engineering');
    const saved = await call('PUT', `/admin/menus/${eng.id}`, { ...eng, items: [{ label: 'Sneaky', path: '/x' }] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.items).toEqual([]);
    expect((await call('DELETE', `/admin/menus/${eng.id}`)).status).toBe(409);
  });

  it('reorders and removes custom menus', async () => {
    const all = (await call('GET', '/admin/menus')).body.data.map((m: any) => m.id) as string[];
    const order = [ids.menu, ...all.filter(id => id !== ids.menu)];
    const reordered = await call('PUT', '/admin/menus/reorder', { ids: order });
    expect(reordered.body.data[0].id).toBe(ids.menu);
    // Put the built-in order back for other tests and real use.
    await call('PUT', '/admin/menus/reorder', { ids: all });
    expect((await call('DELETE', `/admin/menus/${ids.menu}`)).status).toBe(200);
    expect((await query(`SELECT 1 FROM nav_menu_items WHERE menu_id = $1`, [ids.menu])).rows).toHaveLength(0);
  });
});
