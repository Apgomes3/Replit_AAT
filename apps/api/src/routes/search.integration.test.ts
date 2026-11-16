// @vitest-environment node
// Runs the real search SQL against the PostgreSQL test database (TEST_DATABASE_URL), so a broken
// source query (wrong column or type) fails here instead of turning every search into an error.
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../db';
import { JWT_SECRET } from '../middleware/auth';
import { errorHandler } from '../middleware/errors';
import searchRoutes from './search';

const tag = `zq${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
let token = '';
const ids: Record<string, string> = {};

async function search(path: string) {
  const res = await fetch(`${base}/api/v1/search${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as any };
}

describe.skipIf(!process.env.DATABASE_URL)('search (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.user = (await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, job_title) VALUES ($1, 'x', 'Searchy', $2, 'admin', 'Test Engineer') RETURNING id`,
      [`${tag}@example.test`, tag])).rows[0].id;
    token = jwt.sign({ id: ids.user, email: `${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    ids.client = (await query(`INSERT INTO clients (client_code, name) VALUES ($1, $2) RETURNING id`, [`T-${tag}`, `Aquarium ${tag}`])).rows[0].id;
    ids.contact = (await query(`INSERT INTO client_contacts (client_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
      [ids.client, `Curator ${tag}`, `curator-${tag}@example.test`])).rows[0].id;
    ids.project = (await query(`INSERT INTO projects (project_code, project_name, client_id, client_name) VALUES ($1, 'Search test', $2, $3) RETURNING id`,
      [`P-${tag}`, ids.client, `Aquarium ${tag}`])).rows[0].id;
    const app = express();
    app.use('/api/v1/search', searchRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM projects WHERE id = $1`, [ids.project]);
    await query(`DELETE FROM clients WHERE id = $1`, [ids.client]);
    await query(`DELETE FROM users WHERE id = $1`, [ids.user]);
  });

  it('runs every source and finds people, clients, their contacts and projects', async () => {
    const res = await search(`?q=${tag}&page_size=50`);
    expect(res.status).toBe(200);
    const found = Object.fromEntries(res.body.results.map((r: any) => [r.type, r]));
    expect(found.person).toMatchObject({ code: `${tag}@example.test`, name: `Searchy ${tag} · Test Engineer` });
    expect(found.person.href).toBe(`/admin/users?q=${encodeURIComponent(`${tag}@example.test`)}`);
    expect(found.client.href).toBe(`/clients/${ids.client}`);
    expect(found.contact).toMatchObject({ name: `Curator ${tag} · Aquarium ${tag}`, href: `/clients/${ids.client}` });
    expect(found.project).toMatchObject({ name: `Search test · Aquarium ${tag}`, href: `/projects/${ids.project}` });
  });

  it('runs My Work and filters by type without errors', async () => {
    expect((await search('/my-work')).status).toBe(200);
    const people = await search(`?q=${tag}&type=person`);
    expect(people.body.results.map((r: any) => r.type)).toEqual(['person']);
  });
});
