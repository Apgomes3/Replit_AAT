// @vitest-environment node
// GET /people/org-chart: every active person with their active manager. Runs on TEST_DATABASE_URL.
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import peopleRoutes from './routes';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ids: Record<string, string> = {};
let server: http.Server;
let base = '';

const addUser = async (key: string, active = true, manager?: string) => {
  ids[key] = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, reports_to_user_id, job_title)
    VALUES ($1, 'x', 'Org', $2, 'user', $3, $4, $5) RETURNING id`, [`org-${key}-${tag}@example.test`, key, active, manager ?? null, `${key} title`])).rows[0].id;
};

describe.skipIf(!process.env.DATABASE_URL)('org chart (PostgreSQL)', () => {
  beforeAll(async () => {
    await addUser('boss');
    await addUser('gone', false, ids.boss);
    await addUser('worker', true, ids.boss);
    await addUser('orphan', true, ids.gone);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/people', peopleRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`UPDATE users SET reports_to_user_id = NULL WHERE id = ANY($1::uuid[])`, [Object.values(ids)]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(ids)]);
  });

  it('lists active people with their manager, leaving out inactive people and inactive managers', async () => {
    const token = jwt.sign({ id: ids.worker, email: 'w@example.test', role: 'user' }, JWT_SECRET);
    const res = await fetch(`${base}/api/v1/people/org-chart`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const mine = ((await res.json()) as any).data.filter((p: any) => Object.values(ids).includes(p.id));
    expect(mine.map((p: any) => p.name).sort()).toEqual(['Org boss', 'Org orphan', 'Org worker']);
    expect(mine.find((p: any) => p.id === ids.worker)).toMatchObject({ manager_id: ids.boss, job_title: 'worker title' });
    expect(mine.find((p: any) => p.id === ids.orphan).manager_id).toBeNull();
    expect(mine.find((p: any) => p.id === ids.boss)).toMatchObject({ department_id: null, heads: [] });
  });
});
