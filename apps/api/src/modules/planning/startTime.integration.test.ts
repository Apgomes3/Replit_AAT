// @vitest-environment node
// Optional start times on regular commitments and own tasks, so they sit in time order in the
// My Work day lists. Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import myWorkRoutes from './myWorkRoutes';
import { parseTimeOfDay, validateCommitmentInput, validatePersonalTaskInput } from './validation';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
let token = '';
let userId = '';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const meeting = { title: 'Team meeting', kind: 'meeting', start_date: '2026-11-16', end_date: null, project_id: null, weekdays: [0], hours_per_day: 1 };

describe('start times', () => {
  it('reads a time of day', () => {
    expect(parseTimeOfDay('9:05')).toBe('09:05');
    expect(parseTimeOfDay('17:30:00')).toBe('17:30');
    expect(parseTimeOfDay('')).toBeNull();
    expect(parseTimeOfDay('24:00')).toBeUndefined();
    expect(parseTimeOfDay('9am')).toBeUndefined();
  });

  it('takes a start time on weekday commitments only, and not past midnight', () => {
    expect(validateCommitmentInput({ ...meeting, start_time: '09:00' }).value?.start_time).toBe('09:00');
    expect(validateCommitmentInput({ ...meeting, start_time: '23:30' }).error).toMatch(/past midnight/);
    expect(validateCommitmentInput({ ...meeting, weekdays: null, hours_per_day: null, capacity_pct: 20, start_time: '09:00' }).value?.start_time).toBeNull();
  });

  it('takes a start time on own tasks', () => {
    expect(validatePersonalTaskInput({ title: 'x', start_time: '14:00' }, { creating: true }).value?.start_time).toBe('14:00');
    expect(validatePersonalTaskInput({ title: 'x', start_time: 'noon' }, { creating: true }).error).toMatch(/time of day/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('start times saved (PostgreSQL)', () => {
  beforeAll(async () => {
    userId = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Clock', 'Watcher', 'admin') RETURNING id`,
      [`times-${tag}@example.test`])).rows[0].id;
    token = jwt.sign({ id: userId, email: `times-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/my-work', myWorkRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM planning_personal_tasks WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM planning_commitments WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [userId]).catch(() => undefined);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it('keeps the time on commitments and tasks, and clears it', async () => {
    const c = await call('POST', '/my-work/commitments', { ...meeting, start_time: '09:30' });
    expect(c.status).toBe(201);
    expect(c.body.start_time).toBe('09:30');
    const t = await call('POST', '/my-work/tasks', { title: 'Call supplier', due_date: '2026-11-17', start_time: '14:00' });
    expect(t.body.start_time).toBe('14:00');

    const work = await call('GET', '/my-work?from=2026-11-16&weeks=1');
    expect(work.body.commitments.find((x: any) => x.id === c.body.id).start_time).toBe('09:30');
    expect(work.body.tasks.find((x: any) => x.id === t.body.id).start_time).toBe('14:00');

    expect((await call('PUT', `/my-work/commitments/${c.body.id}`, { ...meeting, start_time: null })).body.start_time).toBeNull();
    expect((await call('PATCH', `/my-work/tasks/${t.body.id}`, { start_time: '' })).body.start_time).toBeNull();
  });

  it('books the whole working day for all-day tasks and commitments', async () => {
    await query(`DELETE FROM planning_personal_tasks WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM planning_commitments WHERE user_id = $1`, [userId]);
    // Factory on Fridays all day; a site visit on Tue–Wed 1–2 Dec 2026, with effort and time dropped.
    const c = await call('POST', '/my-work/commitments', { ...meeting, title: 'Factory', weekdays: [4], hours_per_day: null, all_day: true, start_time: '09:00' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ all_day: true, hours_per_day: null, start_time: null });
    const t = await call('POST', '/my-work/tasks', { title: 'Site visit', start_date: '2026-12-01', due_date: '2026-12-02', planned_hours: 3, start_time: '10:00', all_day: true });
    expect(t.body).toMatchObject({ all_day: true, planned_hours: null, start_time: null });

    const work = await call('GET', '/my-work?from=2026-11-30&weeks=1');
    const days = work.body.weeks[0].days as Array<{ date: string; capacity: number; booked: number }>;
    const on = (d: string) => days.find(x => x.date === d)!;
    for (const d of ['2026-12-01', '2026-12-02', '2026-12-04']) expect(on(d).booked).toBe(on(d).capacity);
    expect(on('2026-11-30').booked).toBe(0);
    expect(on('2026-12-03').booked).toBe(0);
  });
});
