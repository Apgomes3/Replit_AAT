// @vitest-environment node
// A company's logo, and its projects showing it unless they have their own. Test database only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import clientRoutes from './routes';
import projectRoutes from '../../routes/projects';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const uploads = path.join(__dirname, '../../../uploads');
// A 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
let server: http.Server;
let base = '';
let token = '';
const ids: Record<string, string> = {};
const files: string[] = [];

const auth = () => ({ Authorization: `Bearer ${token}` });
async function call(method: string, url: string) {
  const res = await fetch(`${base}/api/v1${url}`, { method, headers: auth() });
  return { status: res.status, body: (await res.json()) as any };
}
async function upload(url: string, type = 'image/png', name = 'logo.png') {
  const fd = new FormData();
  fd.append('logo', new Blob([PNG], { type }), name);
  const res = await fetch(`${base}/api/v1${url}`, { method: 'POST', headers: auth(), body: fd });
  const body = (await res.json()) as any;
  if (body?.logo_url) files.push(path.join(uploads, path.basename(body.logo_url)));
  return { status: res.status, body };
}

describe.skipIf(!process.env.DATABASE_URL)('client logos (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.user = (await query(`INSERT INTO users (email, password_hash, first_name, role) VALUES ($1, 'x', 'Logo', 'admin') RETURNING id`, [`logo-${tag}@example.test`])).rows[0].id;
    token = jwt.sign({ id: ids.user, email: `logo-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    ids.client = (await query(`INSERT INTO clients (client_code, name) VALUES ($1, $2) RETURNING id`, [`T-L-${tag}`, `Logo Aquarium ${tag}`])).rows[0].id;
    ids.project = (await query(`INSERT INTO projects (project_code, project_name, client_id, client_name) VALUES ($1, 'Logo test', $2, $3) RETURNING id`,
      [`LG-${tag}`, ids.client, `Logo Aquarium ${tag}`])).rows[0].id;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/clients', clientRoutes);
    app.use('/api/v1', projectRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM projects WHERE id = $1`, [ids.project]);
    await query(`DELETE FROM clients WHERE id = $1`, [ids.client]);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [ids.user]);
    await query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    for (const f of files) fs.rmSync(f, { force: true });
  });

  it('gives a client without a logo the first logo uploaded on one of its projects', async () => {
    const first = await upload(`/projects/${ids.project}/logo`);
    expect(first.body).toMatchObject({ logo_url: null, client_logo_url: expect.stringMatching(/^\/uploads\/logo-/) });
    expect((await call('GET', `/clients/${ids.client}`)).body.logo_url).toBe(first.body.client_logo_url);
    files.push(path.join(uploads, path.basename(first.body.client_logo_url)));
    expect((await call('DELETE', `/clients/${ids.client}/logo`)).body.logo_url).toBeNull();
  });

  it('shows the client logo on its projects until a project has its own', async () => {
    expect((await upload(`/clients/${ids.client}/logo`, 'text/plain', 'notes.txt')).status).toBe(400);
    const set = await upload(`/clients/${ids.client}/logo`);
    expect(set.status).toBe(200);
    expect(set.body.logo_url).toMatch(/^\/uploads\/logo-client-.+\.png$/);
    expect(fs.existsSync(path.join(uploads, path.basename(set.body.logo_url)))).toBe(true);
    expect((await call('GET', `/clients/${ids.client}`)).body.logo_url).toBe(set.body.logo_url);

    const project = await call('GET', `/projects/${ids.project}`);
    expect(project.body).toMatchObject({ logo_url: null, client_logo_url: set.body.logo_url });
    const listed = await call('GET', `/projects?client_id=${ids.client}`);
    expect(listed.body.items[0]).toMatchObject({ id: ids.project, client_logo_url: set.body.logo_url });

    // The project's own logo wins; dropping it shows the client's again.
    const own = await upload(`/projects/${ids.project}/logo`);
    expect((await call('GET', `/projects/${ids.project}`)).body).toMatchObject({ logo_url: own.body.logo_url, client_logo_url: set.body.logo_url });
    expect((await call('DELETE', `/projects/${ids.project}/logo`)).body).toMatchObject({ logo_url: null, client_logo_url: set.body.logo_url });

    expect((await call('DELETE', `/clients/${ids.client}/logo`)).body.logo_url).toBeNull();
    expect((await call('GET', `/projects/${ids.project}`)).body.client_logo_url).toBeNull();
  });
});
