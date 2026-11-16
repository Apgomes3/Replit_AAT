// @vitest-environment node
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../db';
import { JWT_SECRET } from '../middleware/auth';
import { errorHandler } from '../middleware/errors';
import projectRoutes, { cleanProjectCode } from './projects';

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
let server: http.Server;
let base = '';
let token = '';
let userId = '';
const projectIds: string[] = [];

async function put(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/v1/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('cleanProjectCode', () => {
  it('trims, and refuses empty or long codes', () => {
    expect(cleanProjectCode('  064-123 ')).toEqual({ code: '064-123' });
    expect(cleanProjectCode('   ')).toEqual({ error: 'Project code cannot be empty' });
    expect(cleanProjectCode('x'.repeat(51))).toEqual({ error: expect.stringMatching(/50/) });
    expect(cleanProjectCode(64)).toEqual({ error: 'Project code must be text' });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('changing a project code (PostgreSQL)', () => {
  beforeAll(async () => {
    userId = (await query(
      `INSERT INTO users (email, password_hash, first_name, role) VALUES ($1, 'x', 'Coder', 'admin') RETURNING id`,
      [`code-edit-${suffix.toLowerCase()}@example.test`],
    )).rows[0].id;
    token = jwt.sign({ id: userId, email: 'code-edit@example.test', role: 'admin' }, JWT_SECRET);
    for (const code of [`T-${suffix}-XXX`, `T-${suffix}-TAKEN`]) {
      projectIds.push((await query(
        `INSERT INTO projects (project_code, project_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [code, `Project ${code}`, userId],
      )).rows[0].id);
    }
    const app = express();
    app.use(express.json());
    app.use('/api/v1', projectRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM notifications WHERE entity_id = ANY($1::text[])`, [projectIds]).catch(() => undefined);
    await query(`DELETE FROM audit_logs WHERE entity_id::text = ANY($1::text[])`, [projectIds]).catch(() => undefined);
    await query(`DELETE FROM projects WHERE id = ANY($1::uuid[])`, [projectIds]);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [userId]);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it('changes the code, keeps the record and logs old → new', async () => {
    const [placeholder] = projectIds;
    const res = await put(placeholder, { project_code: ` T-${suffix}-123 `, project_name: 'NZ Underwater UV', project_status: 'Concept' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: placeholder, project_code: `T-${suffix}-123`, project_name: 'NZ Underwater UV' });
    const audit = await query(`SELECT details FROM audit_logs WHERE entity_id::text = $1 ORDER BY created_at DESC LIMIT 1`, [placeholder]);
    expect(audit.rows[0]?.details?.summary).toBe(`Project code changed from T-${suffix}-XXX → T-${suffix}-123`);
  });

  it('refuses a code another project uses, in any letter case', async () => {
    const [placeholder] = projectIds;
    const res = await put(placeholder, { project_code: `t-${suffix}-taken`, project_name: 'NZ Underwater UV', project_status: 'Concept' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already used by "Project T-.*-TAKEN"/);
    const after = await query(`SELECT project_code FROM projects WHERE id = $1`, [placeholder]);
    expect(after.rows[0].project_code).toBe(`T-${suffix}-123`);
  });

  it('links a project to a directory company and keeps its name in client_name', async () => {
    const [placeholder] = projectIds;
    const company = (await query(`INSERT INTO clients (client_code, name, notes) VALUES ($1, $2, 'test') RETURNING id`,
      [`T-${suffix}`, `Aquarium of Guam ${suffix}`])).rows[0].id;
    try {
      const linked = await put(placeholder, { project_name: 'NZ Underwater UV', project_status: 'Concept', client_id: company, client_name: 'ignored text' });
      expect(linked.body).toMatchObject({ client_id: company, client_name: `Aquarium of Guam ${suffix}` });
      // A save that does not mention the client leaves it alone.
      expect((await put(placeholder, { project_name: 'NZ Underwater UV', project_status: 'Concept' })).body.client_id).toBe(company);
      // Unlinking keeps typed text, and an unknown company is refused.
      const unlinked = await put(placeholder, { project_name: 'NZ Underwater UV', project_status: 'Concept', client_id: null, client_name: 'Someone' });
      expect(unlinked.body).toMatchObject({ client_id: null, client_name: 'Someone' });
      expect((await put(placeholder, { project_name: 'X', project_status: 'Concept', client_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    } finally {
      await query(`UPDATE projects SET client_id = NULL WHERE client_id = $1`, [company]);
      await query(`DELETE FROM clients WHERE id = $1`, [company]);
    }
  });

  it('leaves the code alone when the body has none, and refuses an empty one', async () => {
    const [placeholder] = projectIds;
    expect((await put(placeholder, { project_name: 'Renamed', project_status: 'Concept' })).body.project_code).toBe(`T-${suffix}-123`);
    expect((await put(placeholder, { project_code: '  ', project_name: 'Renamed', project_status: 'Concept' })).status).toBe(400);
  });
});
