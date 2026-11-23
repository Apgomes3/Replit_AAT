// @vitest-environment node
// Knowledge Library access and approval. Runs against the PostgreSQL test database.
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import libraryRoutes from './routes';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1/library${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe.skipIf(!process.env.DATABASE_URL)('knowledge library (PostgreSQL)', () => {
  beforeAll(async () => {
    for (const who of ['owner', 'editor', 'reader', 'outsider']) {
      const email = `kb-${who}-${tag}@example.test`;
      ids[who] = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', $2, 'Test', 'engineer') RETURNING id`,
        [email, who])).rows[0].id;
      tokens[who] = jwt.sign({ id: ids[who], email, role: 'engineer' }, JWT_SECRET);
    }
    ids.pool = (await query(`INSERT INTO knowledge_pools (slug, name, restricted, owner_user_id) VALUES ($1, $2, TRUE, $3) RETURNING id`,
      [`kb-test-${tag}`, `Secret pool ${tag}`, ids.owner])).rows[0].id;
    ids.team = (await query(`INSERT INTO drafting_teams (name) VALUES ($1) RETURNING id`, [`KB team ${tag}`])).rows[0].id;
    await query(`INSERT INTO drafting_team_members (team_id, user_id) VALUES ($1, $2)`, [ids.team, ids.editor]);
    const app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/api/v1/library', libraryRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    const people = Object.entries(ids).filter(([k]) => ['owner', 'editor', 'reader', 'outsider'].includes(k)).map(([, v]) => v);
    await query(`UPDATE knowledge_articles SET latest_revision_id = NULL, published_revision_id = NULL WHERE pool_id = $1`, [ids.pool]);
    await query(`DELETE FROM knowledge_articles WHERE pool_id = $1`, [ids.pool]);
    await query(`DELETE FROM knowledge_pools WHERE id = $1`, [ids.pool]);
    await query(`DELETE FROM drafting_teams WHERE id = $1`, [ids.team]);
    await query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [people]).catch(() => undefined);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people]);
  });

  it('keeps a restricted pool hidden from people who are not chosen', async () => {
    const slug = `kb-test-${tag}`;
    expect((await call('outsider', 'GET', '/pools')).body.data.map((p: any) => p.slug)).not.toContain(slug);
    expect((await call('outsider', 'GET', `/pools/${slug}`)).status).toBe(404);
    // The owner adds an editor team and a reader; only the owner manages members.
    expect((await call('editor', 'PUT', `/pools/${slug}/members`, { editors: [] })).status).toBe(404);
    expect((await call('owner', 'PUT', `/pools/${slug}/members`, { editors: [{ team_id: ids.team }], readers: [{ user_id: ids.reader }] })).status).toBe(200);
    const asEditor = await call('editor', 'GET', `/pools/${slug}`);
    expect(asEditor.body.rights).toMatchObject({ read: true, write: true, approve: false });
    expect((await call('reader', 'GET', `/pools/${slug}`)).body.rights).toMatchObject({ read: true, write: false });
    expect((await call('reader', 'POST', '/articles', { pool: slug, title: 'Nope' })).status).toBe(403);
  });

  it('sends an editor\'s procedure to the owner, and readers see only the published version', async () => {
    const slug = `kb-test-${tag}`;
    const made = await call('editor', 'POST', '/articles', {
      pool: slug, title: 'Annealing acrylic', kind: 'procedure', body_html: '<p>Step one</p><script>alert(1)</script>', publish: true,
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ outcome: 'review', code: expect.stringMatching(/^KA-\d{4,}$/) });
    const id = made.body.id;

    // Waiting for approval: the reader cannot see it, the owner is told, the script tag is gone.
    expect((await call('reader', 'GET', `/articles/${id}`)).status).toBe(404);
    const owned = await call('owner', 'GET', `/articles/${id}`);
    expect(owned.body).toMatchObject({ in_review: true, status: 'draft', rights: { write: true, approve: true } });
    expect(owned.body.revision.body_html).toBe('<p>Step one</p>');
    const told = (await query(`SELECT 1 FROM notifications WHERE user_id = $1 AND entity_id = $2`, [ids.owner, id])).rows;
    expect(told.length).toBe(1);

    expect((await call('owner', 'GET', '/overview')).body.awaiting_approval.map((a: any) => a.id)).toContain(id);
    expect((await call('editor', 'GET', '/articles?mine=1')).body.data.map((a: any) => a.id)).toContain(id);
    expect((await call('editor', 'POST', `/articles/${id}/approve`)).status).toBe(403);
    expect((await call('owner', 'POST', `/articles/${id}/send-back`, {})).status).toBe(400);
    expect((await call('owner', 'POST', `/articles/${id}/send-back`, { note: 'Add the oven temperature' })).status).toBe(200);
    expect((await call('editor', 'PUT', `/articles/${id}`, { body_html: '<p>Step one at 85 °C</p>', publish: true })).body.outcome).toBe('review');
    expect((await call('owner', 'POST', `/articles/${id}/approve`)).status).toBe(200);

    const read = await call('reader', 'GET', `/articles/${id}`);
    expect(read.body).toMatchObject({ status: 'published', in_review: false, rights: { write: false } });
    expect(read.body.revision).toMatchObject({ rev_no: 2, body_html: '<p>Step one at 85 °C</p>' });
    expect(read.body.revisions).toEqual([]);

    // An unpublished edit stays with the writers; readers keep the published text.
    expect((await call('editor', 'PUT', `/articles/${id}`, { body_html: '<p>Draft rewrite</p>' })).body.outcome).toBe('saved');
    expect((await call('reader', 'GET', `/articles/${id}`)).body.revision.body_html).toBe('<p>Step one at 85 °C</p>');
    expect((await call('editor', 'GET', `/articles/${id}`)).body).toMatchObject({ has_unpublished_changes: true, revision: { rev_no: 3 } });
    const found = await call('reader', 'GET', `/articles?q=85`);
    expect(found.body.data.map((a: any) => a.id)).toContain(id);
    expect((await call('outsider', 'GET', `/articles?q=85`)).body.data.map((a: any) => a.id)).not.toContain(id);

    // A published article cannot be deleted, only archived.
    expect((await call('editor', 'DELETE', `/articles/${id}`)).status).toBe(400);
  });

  it('publishes a how-to straight away and deletes a never-published draft', async () => {
    const slug = `kb-test-${tag}`;
    const howto = await call('editor', 'POST', '/articles', { pool: slug, title: 'Cleaning the oven', kind: 'howto', publish: true });
    expect(howto.body.outcome).toBe('publish');
    const draft = await call('editor', 'POST', '/articles', { pool: slug, title: 'Half written', kind: 'lesson' });
    expect(draft.body.outcome).toBe('draft');
    expect((await call('reader', 'GET', `/articles/${draft.body.id}`)).status).toBe(404);
    expect((await call('editor', 'DELETE', `/articles/${draft.body.id}`)).status).toBe(200);
  });
});
