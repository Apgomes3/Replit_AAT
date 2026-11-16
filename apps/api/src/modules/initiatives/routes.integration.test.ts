// @vitest-environment node
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import initiativeRoutes from './routes';
import myWorkRoutes from '../planning/myWorkRoutes';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
const users: Record<string, { id: string; token: string }> = {};
const roleIds: string[] = [];
let projectId = '';

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : (await res.json()) as any };
}

describe.skipIf(!process.env.DATABASE_URL)('initiatives (PostgreSQL)', () => {
  beforeAll(async () => {
    for (const [who, level] of [['staff', 'view'], ['boss', 'view'], ['manager', 'manage']] as const) {
      const role = `t_ini_${who}_${tag}`;
      const roleId = (await query(`INSERT INTO roles (name, description) VALUES ($1, 'test role') RETURNING id`, [role])).rows[0].id;
      roleIds.push(roleId);
      await query(`INSERT INTO role_module_access (role_id, module_key, access_level) VALUES ($1, 'initiatives', $2)`, [roleId, level]);
      const id = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', $2, 'Test', $3) RETURNING id`,
        [`ini-${who}-${tag}@example.test`, who, role])).rows[0].id;
      users[who] = { id, token: jwt.sign({ id, email: `ini-${who}-${tag}@example.test`, role }, JWT_SECRET) };
    }
    projectId = (await query(`INSERT INTO projects (project_code, project_name) VALUES ($1, 'Linked project') RETURNING id`, [`IP-${tag}`])).rows[0].id;
    // NZD without a rate (to check it is left out), AUD at 1.5 per USD for the conversion.
    await query(`INSERT INTO platform_exchange_rates (currency_code, rate_per_usd) VALUES ('AUD', 1.5), ('NZD', NULL)
      ON CONFLICT (currency_code) DO UPDATE SET rate_per_usd = EXCLUDED.rate_per_usd`);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/initiatives', initiativeRoutes);
    app.use('/api/v1/my-work', myWorkRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    const ids = Object.values(users).map(u => u.id);
    await query(`DELETE FROM planning_personal_tasks WHERE user_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM initiatives WHERE created_by = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [roleIds]);
  });

  it('takes an idea from proposal to done, with hours, costs, links and tasks', async () => {
    // Anyone can propose; it starts as an idea owned by them, with its own INT code.
    const made = await call('staff', 'POST', '/initiatives', {
      title: `Compact UV skid ${tag}`, type: 'product_development', sponsor_user_id: users.boss.id,
      estimated_hours: 80, budget_amount: 10000, currency: 'USD', stage: 'in_progress',
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ stage: 'idea', owner_user_id: users.staff.id, sponsor_name: 'boss Test' });
    expect(made.body.code).toMatch(/^INT-\d{4}-\d{3}$/);
    const id = made.body.id;

    // No hours on an idea; the owner cannot approve their own idea; the sponsor can.
    expect((await call('staff', 'POST', `/initiatives/${id}/time`, { work_date: '2026-11-02', hours: 2 })).status).toBe(400);
    expect((await call('staff', 'POST', `/initiatives/${id}/stage`, { stage: 'approved' })).status).toBe(403);
    expect((await call('boss', 'POST', `/initiatives/${id}/stage`, { stage: 'approved', note: 'Go ahead' })).body.stage).toBe('approved');
    expect((await call('staff', 'POST', `/initiatives/${id}/stage`, { stage: 'in_progress' })).body.start_date).toBeTruthy();

    // Hours from two people, a cost in another currency, a linked project and a My Work task.
    await call('staff', 'POST', `/initiatives/${id}/time`, { work_date: '2026-11-02', hours: 3.5, note: 'Layout' });
    await call('manager', 'POST', `/initiatives/${id}/time`, { work_date: '2026-11-03', hours: 1 });
    expect((await call('staff', 'POST', `/initiatives/${id}/costs`, { description: 'Prototype acrylic', amount: 150, currency: 'AUD', category: 'materials' })).status).toBe(201);
    expect((await call('staff', 'POST', `/initiatives/${id}/costs`, { description: 'Courier', amount: 40, currency: 'NZD' })).status).toBe(201);
    expect((await call('staff', 'POST', `/initiatives/${id}/links`, { entity_type: 'project', entity_id: projectId })).status).toBe(201);
    const task = await call('staff', 'POST', '/my-work/tasks', { title: 'Draw the frame', initiative_id: id, planned_hours: 6 });
    expect(task.status).toBe(201);
    expect(task.body.initiative).toMatchObject({ id, code: made.body.code });
    expect((await call('staff', 'POST', '/my-work/tasks', { title: 'x', initiative_id: id, project_id: projectId })).status).toBe(400);

    const detail = await call('boss', 'GET', `/initiatives/${id}`);
    expect(detail.body).toMatchObject({ logged_hours: 4.5, task_count: 1, task_hours: 6, cost_total: 100, cost_unconverted: 1 });
    expect(detail.body.hours_by_person.map((h: any) => h.hours)).toEqual([3.5, 1]);
    expect(detail.body.links[0]).toMatchObject({ entity_type: 'project', code: `IP-${tag}` });
    expect(detail.body.events.map((e: any) => e.to_stage)).toEqual(['in_progress', 'approved', 'idea']);
    expect(detail.body.can).toMatchObject({ decide: true, log_time: true });

    // Only your own hours can be removed (managers excepted).
    const other = detail.body.time_entries.find((t: any) => t.user_id === users.manager.id);
    expect((await call('staff', 'DELETE', `/initiatives/${id}/time/${other.id}`)).status).toBe(404);

    expect((await call('staff', 'POST', `/initiatives/${id}/stage`, { stage: 'done' })).body.completed_at).toBeTruthy();
    expect((await call('staff', 'POST', `/initiatives/${id}/stage`, { stage: 'in_progress' })).status).toBe(403);
    const list = await call('staff', 'GET', `/initiatives?search=${tag}`);
    expect(list.body.data.map((i: any) => i.id)).toEqual([id]);
  });
});
