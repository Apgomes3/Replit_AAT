// @vitest-environment node
// Admin › Users › Import CSV with invitations off: people are only added to the database.
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../db';
import { JWT_SECRET } from '../middleware/auth';
import { errorHandler } from '../middleware/errors';
import adminRoutes from './admin';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const newEmail = `import-new-${tag}@example.test`;
let server: http.Server;
let base = '';
let token = '';
let adminId = '';

describe.skipIf(!process.env.DATABASE_URL)('users CSV import without invites (PostgreSQL)', () => {
  beforeAll(async () => {
    adminId = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Import', 'Admin', 'admin') RETURNING id`,
      [`import-admin-${tag}@example.test`])).rows[0].id;
    token = jwt.sign({ id: adminId, email: `import-admin-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    const ids = (await query(`SELECT id FROM users WHERE email = ANY($1)`, [[newEmail, `import-admin-${tag}@example.test`]])).rows.map(r => r.id);
    await query(`DELETE FROM audit_logs WHERE entity_id::text = ANY($1::text[]) OR actor_id::text = ANY($1::text[])`, [ids]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
  });

  it('adds new people with no setup link or email, and skips existing ones', async () => {
    const form = new FormData();
    form.append('send_invites', 'false');
    form.append('file', new Blob([
      `email,first_name,last_name,job_title,role\r\n${newEmail},New,Person,Drafter,user\r\nimport-admin-${tag}@example.test,Import,Admin,,admin\r\n`,
    ], { type: 'text/csv' }), 'users.csv');
    const res = await fetch(`${base}/api/v1/admin/users/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 2, invites_sent: false, invited: 0, added: 1, skipped: 1, errors: [] });

    const user = (await query(`SELECT id, first_name, job_title, role FROM users WHERE email = $1`, [newEmail])).rows[0];
    expect(user).toMatchObject({ first_name: 'New', job_title: 'Drafter', role: 'user' });
    const tokens = await query(`SELECT 1 FROM password_reset_tokens WHERE user_id = $1`, [user.id]);
    expect(tokens.rows).toHaveLength(0);
    const audit = (await query(`SELECT action, details->>'summary' AS s FROM audit_logs WHERE entity_id = $1`, [user.id])).rows[0];
    expect(audit).toMatchObject({ action: 'CREATE', s: `Added ${newEmail} from file (no invitation sent)` });
  });
});
