// @vitest-environment node
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../db';
import { JWT_SECRET } from '../middleware/auth';
import { errorHandler } from '../middleware/errors';
import fs from 'node:fs';
import path from 'node:path';
import routes from './plateHeatExchangers';

const sheetModel = (rev: string) => ({
  header: { tag: 'HX-01', rev, service: 'Main exhibit LSS', project: 'PHE project' }, date: '24 Nov 2026',
  sections: [{ title: 'PERFORMANCE PER UNIT', columns: ['Primary (Hot side)', 'Secondary (Cold side)'], rows: [
    { n: 1, desc: 'Fluid', unit: '', a: 'Water', b: 'Seawater 35.0 g/kg' }, { n: 2, desc: 'Heat duty per unit', unit: 'kW', a: '150.0' },
  ] }],
  notes: ['Preliminary selection.'],
  chart: { hotName: 'Primary (hot)', coldName: 'Secondary (cold)', hotIn: 35, hotOut: 30, coldIn: 24, coldOut: 27, dT1: 8, dT2: 6,
    points: [{ x: 0, hot: 35, cold: 27 }, { x: 1, hot: 30, cold: 24 }] },
});

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
const users: Record<string, { id: string; token: string }> = {};
let projectId = '';
let otherProjectId = '';
const refs: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : (await res.json()) as any };
}

describe.skipIf(!process.env.DATABASE_URL)('plate heat exchanger sizings (PostgreSQL)', () => {
  beforeAll(async () => {
    for (const [who, role] of [['engineer', 'engineer'], ['viewer', 'viewer']] as const) {
      const email = `phe-${who}-${tag}@example.test`;
      const id = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', $2, 'Test', $3) RETURNING id`,
        [email, who, role])).rows[0].id;
      users[who] = { id, token: jwt.sign({ id, email, role }, JWT_SECRET) };
    }
    refs.client = (await query(`INSERT INTO clients (client_code, name) VALUES ($1, $2) RETURNING id`, [`PHEC-${tag}`, `PHE Client ${tag}`])).rows[0].id;
    refs.otherClient = (await query(`INSERT INTO clients (client_code, name) VALUES ($1, $2) RETURNING id`, [`PHEO-${tag}`, `Other Client ${tag}`])).rows[0].id;
    projectId = (await query(`INSERT INTO projects (project_code, project_name, client_id) VALUES ($1, 'PHE project', $2) RETURNING id`, [`PHE-${tag}`, refs.client])).rows[0].id;
    otherProjectId = (await query(`INSERT INTO projects (project_code, project_name) VALUES ($1, 'Other project') RETURNING id`, [`PHEX-${tag}`])).rows[0].id;
    refs.book = (await query(`INSERT INTO design_books (book_code, project_id, book_title) VALUES ($1, $2, 'PHE book') RETURNING id`, [`DB-PHE-${tag}`, projectId])).rows[0].id;
    refs.system = (await query(`INSERT INTO systems (system_code, project_id, system_name) VALUES ('LSS-01', $1, 'Main exhibit LSS') RETURNING id`, [projectId])).rows[0].id;
    refs.otherSystem = (await query(`INSERT INTO systems (system_code, project_id, system_name) VALUES ('LSS-09', $1, 'Elsewhere') RETURNING id`, [otherProjectId])).rows[0].id;
    const app = express();
    app.use(express.json());
    app.use('/api/v1', routes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    const ids = Object.values(users).map(u => u.id);
    const docs = (await query(`SELECT d.id, dr.file_path FROM documents d LEFT JOIN document_revisions dr ON dr.document_id=d.id WHERE d.created_by = ANY($1::uuid[])`, [ids])).rows;
    for (const d of docs) if (d.file_path) fs.rmSync(path.join(__dirname, '../..', d.file_path), { force: true });
    await query(`DELETE FROM plate_heat_exchanger_sizings WHERE created_by = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM lifecycle_transitions WHERE actor_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM documents WHERE created_by = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM design_books WHERE id = $1`, [refs.book]);
    await query(`DELETE FROM systems WHERE id = ANY($1::uuid[])`, [[refs.system, refs.otherSystem]]);
    await query(`DELETE FROM projects WHERE id = ANY($1::uuid[])`, [[projectId, otherProjectId]]);
    await query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [[refs.client, refs.otherClient]]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
  });

  it('saves, links to a project, lists by project, updates and deletes', async () => {
    const made = await call('engineer', 'POST', '/plate-heat-exchangers', {
      title: `HX-01 ${tag}`, project_id: projectId,
      inputs: { duty: 150, pTin: 35, pTout: 30 },
      sheet: { tag: 'HX-01', rev: 'A', ignored: 'x' },
      result_summary: { status: 'feasible', model: 'BR015M-1.0-3.8' },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ project_code: `PHE-${tag}`, sheet: { tag: 'HX-01', rev: 'A' }, created_by_name: 'engineer Test' });
    expect(made.body.sheet.ignored).toBeUndefined();

    const listed = await call('viewer', 'GET', `/plate-heat-exchangers?project_id=${projectId}`);
    expect(listed.body.map((r: any) => r.id)).toEqual([made.body.id]);

    const updated = await call('engineer', 'PUT', `/plate-heat-exchangers/${made.body.id}`, {
      title: 'HX-01 rev B', project_id: null, inputs: { duty: 200 }, sheet: { rev: 'B' },
    });
    expect(updated.body).toMatchObject({ title: 'HX-01 rev B', project_id: null, inputs: { duty: 200 } });

    expect((await call('engineer', 'DELETE', `/plate-heat-exchangers/${made.body.id}`)).status).toBe(204);
    expect((await call('engineer', 'GET', `/plate-heat-exchangers/${made.body.id}`)).status).toBe(404);
  });

  it('takes the client from the project and links the design book and LSS system', async () => {
    const options = await call('viewer', 'GET', `/plate-heat-exchangers/options/projects/${projectId}`);
    expect(options.body).toMatchObject({ client_id: refs.client, client_name: `PHE Client ${tag}` });
    expect(options.body.design_books.map((b: any) => b.id)).toEqual([refs.book]);
    expect(options.body.systems.map((x: any) => x.system_name)).toEqual(['Main exhibit LSS']);
    expect((await call('viewer', 'GET', '/plate-heat-exchangers/options/clients')).body.some((c: any) => c.id === refs.otherClient)).toBe(true);

    // A project's client wins over whatever the page sends.
    const made = await call('engineer', 'POST', '/plate-heat-exchangers', {
      title: 'HX-02', project_id: projectId, client_id: refs.otherClient, design_book_id: refs.book, system_id: refs.system, inputs: { duty: 100 },
    });
    expect(made.status).toBe(201);
    const next = await call('viewer', 'GET', `/plate-heat-exchangers/options/projects/${projectId}`);
    expect(next.body.systems[0].next_tag).toBe('HX-01');
    await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'HX-07', project_id: projectId, system_id: refs.system, sheet: { tag: 'HX-07' }, inputs: { duty: 10 } });
    expect((await call('viewer', 'GET', `/plate-heat-exchangers/options/projects/${projectId}`)).body.systems[0].next_tag).toBe('HX-08');
    // The LSS page lists the system's exchangers by tag.
    const bySystem = await call('viewer', 'GET', `/plate-heat-exchangers?system_id=${refs.system}`);
    expect(bySystem.body.map((x: any) => x.title)).toEqual(['HX-07', 'HX-02']);
    expect((await call('viewer', 'GET', '/plate-heat-exchangers?system_id=nope')).status).toBe(400);
    expect(made.body).toMatchObject({ client_id: refs.client, client_name: `PHE Client ${tag}`, book_code: `DB-PHE-${tag}`, system_code: 'LSS-01', system_name: 'Main exhibit LSS' });

    // Without a project the client is picked from the client list, and no book or system can be linked.
    const loose = await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'HX-03', client_id: refs.otherClient, inputs: { duty: 50 } });
    expect(loose.body).toMatchObject({ project_id: null, client_id: refs.otherClient, client_name: `Other Client ${tag}` });
    expect((await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'x', system_id: refs.system, inputs: { duty: 1 } })).status).toBe(400);
    expect((await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'x', project_id: projectId, system_id: refs.otherSystem, inputs: { duty: 1 } })).status).toBe(400);
  });

  it('stores the selection sheet as a PDF revision in the project documents', async () => {
    const loose = await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'No project', inputs: { duty: 5 } });
    expect((await call('engineer', 'POST', `/plate-heat-exchangers/${loose.body.id}/documents`, { sheet: sheetModel('A') })).status).toBe(409);

    const made = await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'HX-01', project_id: projectId, system_id: refs.system, sheet: { tag: 'HX-01' }, inputs: { duty: 150 } });
    expect((await call('engineer', 'POST', `/plate-heat-exchangers/${made.body.id}/documents`, { sheet: { header: {} } })).status).toBe(400);
    const stored = await call('engineer', 'POST', `/plate-heat-exchangers/${made.body.id}/documents`, { sheet: sheetModel('A') });
    expect(stored.status).toBe(201);
    expect(stored.body).toMatchObject({ document_code: `PHE-${tag}-PHE-HX-01`, revision_code: 'A' });

    const doc = (await query(`SELECT d.document_type, d.classification, d.system_id, d.current_revision, dr.file_path, dr.mime_type, dr.file_size
      FROM documents d JOIN document_revisions dr ON dr.document_id=d.id WHERE d.id=$1`, [stored.body.document_id])).rows[0];
    expect(doc).toMatchObject({ document_type: 'Data Sheet', classification: 'Design', system_id: refs.system, current_revision: 'A', mime_type: 'application/pdf' });
    const file = fs.readFileSync(path.join(__dirname, '../..', doc.file_path));
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await query('SELECT 1 FROM document_project_links WHERE document_id=$1 AND project_id=$2', [stored.body.document_id, projectId])).rows).toHaveLength(1);
    expect((await call('engineer', 'GET', `/plate-heat-exchangers/${made.body.id}`)).body.document_id).toBe(stored.body.document_id);

    // The same revision twice is refused; rev A is still a draft, so rev B waits for its review.
    expect((await call('engineer', 'POST', `/plate-heat-exchangers/${made.body.id}/documents`, { sheet: sheetModel('A') })).body.error.code).toBe('REVISION_EXISTS');
    expect((await call('engineer', 'POST', `/plate-heat-exchangers/${made.body.id}/documents`, { sheet: sheetModel('B') })).body.error.code).toBe('EDITABLE_REVISION_EXISTS');
    await query(`UPDATE document_revisions SET status='Approved' WHERE document_id=$1`, [stored.body.document_id]);
    expect((await call('engineer', 'POST', `/plate-heat-exchangers/${made.body.id}/documents`, { sheet: sheetModel('B') })).body.revision_code).toBe('B');
  });

  it('rejects bad input and read-only roles', async () => {
    expect((await call('engineer', 'POST', '/plate-heat-exchangers', { title: '', inputs: { duty: 1 } })).status).toBe(400);
    expect((await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'x', inputs: { duty: 0 } })).status).toBe(400);
    expect((await call('engineer', 'POST', '/plate-heat-exchangers', { title: 'x', inputs: { duty: 1 }, project_id: 'nope' })).status).toBe(400);
    expect((await call('viewer', 'POST', '/plate-heat-exchangers', { title: 'x', inputs: { duty: 1 } })).status).toBe(403);
  });
});
