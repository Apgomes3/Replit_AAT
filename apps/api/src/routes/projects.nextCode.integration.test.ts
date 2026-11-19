// @vitest-environment node
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../db';
import { JWT_SECRET } from '../middleware/auth';
import { errorHandler } from '../middleware/errors';
import projectRoutes from './projects';

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toLowerCase();
let server: http.Server;
let base = '';
let token = '';
let userId = '';
const createdCodes: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe.skipIf(!process.env.DATABASE_URL)('project code suggestion (PostgreSQL)', () => {
  beforeAll(async () => {
    userId = (await query(
      `INSERT INTO users (email, password_hash, first_name, role) VALUES ($1, 'x', 'Coder', 'admin') RETURNING id`,
      [`next-code-${suffix}@example.test`],
    )).rows[0].id;
    token = jwt.sign({ id: userId, email: 'next-code@example.test', role: 'admin' }, JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', projectRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM projects WHERE project_code = ANY($1::text[])`, [createdCodes]);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [userId]).catch(() => undefined);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it('suggests the next free number after existing codes with the same prefix', async () => {
    // Tuvalu (+688) is unlikely to be used by other tests; count from whatever is already there.
    const before = await call('GET', '/projects/next-code?country=Tuvalu');
    expect(before.status).toBe(200);
    expect(before.body.prefix).toBe('688');
    const n = Number(before.body.code.split('-')[1]);
    const high = `688-${String(n + 4).padStart(3, '0')}`;
    createdCodes.push(high, `688-X${suffix}`);
    for (const code of createdCodes) {
      await query(`INSERT INTO projects (project_code, project_name, created_by) VALUES ($1, $2, $3)`, [code, `Next ${code}`, userId]);
    }
    const after = await call('GET', '/projects/next-code?country=tuvalu');
    expect(after.body.code).toBe(`688-${String(n + 5).padStart(3, '0')}`);
  });

  it('answers 404 for a country without a known calling code', async () => {
    const res = await call('GET', '/projects/next-code?country=Atlantis');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNKNOWN_COUNTRY');
  });

  it('accepts a hand-typed code on create but refuses a duplicate', async () => {
    const code = `MIG-${suffix}`;
    createdCodes.push(code);
    const first = await call('POST', '/projects', { project_code: ` ${code} `, project_name: 'Manual code', country: 'Tuvalu' });
    expect(first.status).toBe(201);
    expect(first.body.project_code).toBe(code);
    const dup = await call('POST', '/projects', { project_code: code.toLowerCase(), project_name: 'Dup' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already used by "Manual code"/);
  });
});
