// @vitest-environment node
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import clientRoutes from './routes';
import partyRoutes from './partiesRoutes';
import enquiryRoutes from '../../routes/enquiries';
import peopleRoutes from '../people/routes';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
const tokens: Record<string, string> = {};
const userIds: string[] = [];
const roleIds: string[] = [];

async function call(method: string, path: string, who: 'editor' | 'reader', body?: unknown) {
  const res = await fetch(`${base}${path.startsWith('/api/') ? '' : '/api/v1/clients'}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : (await res.json()) as any };
}

describe.skipIf(!process.env.DATABASE_URL)('client directory API (PostgreSQL)', () => {
  beforeAll(async () => {
    // Two throwaway roles: one that manages the directory and one that can only look.
    for (const [who, level] of [['editor', 'manage'], ['reader', 'view']] as const) {
      const role = `t_${who}_${tag}`;
      const roleId = (await query(`INSERT INTO roles (name, description) VALUES ($1, 'test role') RETURNING id`, [role])).rows[0].id;
      roleIds.push(roleId);
      await query(`INSERT INTO role_module_access (role_id, module_key, access_level) VALUES ($1, 'clients', $2), ($1, 'projects', $2)`, [roleId, level]);
      const id = (await query(`INSERT INTO users (email, password_hash, first_name, role) VALUES ($1, 'x', $2, $3) RETURNING id`,
        [`${who}-${tag}@example.test`, who, role])).rows[0].id;
      userIds.push(id);
      tokens[who] = jwt.sign({ id, email: `${who}-${tag}@example.test`, role }, JWT_SECRET);
    }
    const app = express();
    app.use(express.json());
    app.use('/api/v1/clients', clientRoutes);
    app.use('/api/v1', partyRoutes);
    app.use('/api/v1/enquiries', enquiryRoutes);
    app.use('/api/v1/people', peopleRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    const ids = (await query(`SELECT id FROM clients WHERE notes = $1`, [tag])).rows.map(r => r.id);
    await query(`UPDATE clients SET parent_client_id = NULL WHERE id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [userIds]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    await query(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [roleIds]);
  });

  it('creates a company, warns about look-alikes, and allows it when confirmed', async () => {
    const made = await call('POST', '/', 'editor', { name: `Bass Pro Shops ${tag}`, country: 'United States', notes: tag, kinds: ['client'] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: `Bass Pro Shops ${tag}`, kinds: ['client'], active: true });
    expect(made.body.client_code).toMatch(/^CL-\d{4}-\d{4}$/);

    const dup = await call('POST', '/', 'editor', { name: `basspro shops ${tag}`, notes: tag });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('POSSIBLE_DUPLICATE');
    expect(dup.body.error.matches[0].id).toBe(made.body.id);

    const similar = await call('GET', `/similar?name=${encodeURIComponent(`BassPro Shops ${tag}`)}`, 'reader');
    expect(similar.body.data.map((m: any) => m.id)).toEqual([made.body.id]);

    const forced = await call('POST', '/', 'editor', { name: `Bass Pro Shops ${tag} Springfield`, notes: tag, allow_duplicate: true, parent_client_id: made.body.id });
    expect(forced.status).toBe(201);
    const parent = await call('GET', `/${made.body.id}`, 'reader');
    expect(parent.body.children.map((c: any) => c.id)).toEqual([forced.body.id]);
    // A parent cannot be moved under its own child.
    const loop = await call('PATCH', `/${made.body.id}`, 'editor', { parent_client_id: forced.body.id });
    expect(loop.status).toBe(400);
    expect(loop.body.error.message).toMatch(/loop/);
  });

  it('lets readers look but not change, and filters by kind', async () => {
    const supplier = await call('POST', '/', 'editor', { name: `Pumps Unlimited ${tag}`, kinds: ['supplier'], notes: tag });
    expect(supplier.status).toBe(201);
    expect((await call('POST', '/', 'reader', { name: `Reader Co ${tag}`, notes: tag })).status).toBe(403);
    expect((await call('PATCH', `/${supplier.body.id}`, 'reader', { city: 'X' })).status).toBe(403);
    const suppliers = await call('GET', `/?kind=supplier&search=${tag}`, 'reader');
    expect(suppliers.body.data.map((c: any) => c.name)).toEqual([`Pumps Unlimited ${tag}`]);
  });

  it('lists the company projects and renames them with the company', async () => {
    const company = (await call('POST', '/', 'editor', { name: `Pairi Daiza ${tag}`, notes: tag, country: 'Belgium' })).body;
    const projectId = (await query(
      `INSERT INTO projects (project_code, project_name, client_id, client_name) VALUES ($1, 'Test project', $2, $3) RETURNING id`,
      [`T-${tag}`, company.id, company.name])).rows[0].id;
    try {
      const detail = await call('GET', `/${company.id}`, 'reader');
      expect(detail.body.projects.map((p: any) => p.project_code)).toEqual([`T-${tag}`]);
      expect(detail.body.project_count).toBe(1);
      await call('PATCH', `/${company.id}`, 'editor', { name: `Pairi Daiza Zoo ${tag}`, allow_duplicate: true });
      const project = (await query(`SELECT client_name FROM projects WHERE id = $1`, [projectId])).rows[0];
      expect(project.client_name).toBe(`Pairi Daiza Zoo ${tag}`);
    } finally {
      await query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    }
  });

  it('puts companies and their people on a project with roles, and shows it on the company', async () => {
    const owner = (await call('POST', '/', 'editor', { name: `Owner Zoo ${tag}`, notes: tag })).body;
    const consultant = (await call('POST', '/', 'editor', { name: `Consult Partners ${tag}`, notes: tag, kinds: ['consultant'] })).body;
    const eng = (await call('POST', `/${consultant.id}/contacts`, 'editor', { name: 'Eve Engineer', email: 'eve@consult.test' })).body;
    const outsider = (await call('POST', `/${owner.id}/contacts`, 'editor', { name: 'Olly Owner', email: 'olly@owner.test' })).body;
    const projectId = (await query(`INSERT INTO projects (project_code, project_name, client_id, client_name) VALUES ($1, 'Parties', $2, $3) RETURNING id`,
      [`PP-${tag}`, owner.id, owner.name])).rows[0].id;
    try {
      const firm = await call('POST', `/api/v1/projects/${projectId}/parties`, 'editor', { client_id: consultant.id, role: 'Consultant' });
      expect(firm.status).toBe(201);
      const person = await call('POST', `/api/v1/projects/${projectId}/parties`, 'editor', { client_id: consultant.id, contact_id: eng.id, role: 'Consultant engineer' });
      expect(person.body).toMatchObject({ contact_name: 'Eve Engineer', client_name: consultant.name, role: 'Consultant engineer' });
      // Same role twice, a person from another company, and readers are refused.
      expect((await call('POST', `/api/v1/projects/${projectId}/parties`, 'editor', { client_id: consultant.id, role: 'consultant' })).status).toBe(409);
      expect((await call('POST', `/api/v1/projects/${projectId}/parties`, 'editor', { client_id: consultant.id, contact_id: outsider.id, role: 'Site contact' })).status).toBe(400);
      expect((await call('POST', `/api/v1/projects/${projectId}/parties`, 'reader', { client_id: consultant.id, role: 'Partner' })).status).toBe(403);

      const listed = await call('GET', `/api/v1/projects/${projectId}/parties`, 'reader');
      expect(listed.body.data.map((p: any) => [p.contact_name, p.role])).toEqual([[null, 'Consultant'], ['Eve Engineer', 'Consultant engineer']]);
      const company = await call('GET', `/${consultant.id}`, 'reader');
      expect(company.body.involvements.map((i: any) => [i.project_code, i.contact_name, i.role])).toEqual([[`PP-${tag}`, null, 'Consultant'], [`PP-${tag}`, 'Eve Engineer', 'Consultant engineer']]);
      expect((await call('DELETE', `/api/v1/projects/${projectId}/parties/${firm.body.id}`, 'editor')).status).toBe(204);
    } finally {
      await query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    }
  });

  it('records the client person an enquiry came from, only from that client', async () => {
    const company = (await call('POST', '/', 'editor', { name: `Enquiring Aquarium ${tag}`, notes: tag })).body;
    const other = (await call('POST', '/', 'editor', { name: `Other Place ${tag}`, notes: tag })).body;
    const curator = (await call('POST', `/${company.id}/contacts`, 'editor', { name: 'Cora Curator', email: 'cora@aq.test', phone: '+61 7 0000' })).body;
    const stranger = (await call('POST', `/${other.id}/contacts`, 'editor', { name: 'Stan', email: 'stan@other.test' })).body;
    const made = await call('POST', '/api/v1/enquiries', 'editor', { client_id: company.id, title: `UV upgrade ${tag}`, contact_id: curator.id });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ contact_id: curator.id, contact_name: 'Cora Curator', contact_email: 'cora@aq.test', contact_phone: '+61 7 0000' });
    expect((await call('POST', '/api/v1/enquiries', 'editor', { client_id: company.id, title: 'x', contact_id: stranger.id })).status).toBe(400);
    // Moving the enquiry to another client drops the person, who worked for the first one.
    const moved = await call('PATCH', `/api/v1/enquiries/${made.body.id}`, 'editor', { client_id: other.id });
    expect(moved.body.contact_id ?? null).toBeNull();
    await query(`DELETE FROM enquiries WHERE id = $1`, [made.body.id]);
  });

  it('shows a person card with their manager, chain, reports and teams', async () => {
    const [editor, reader] = userIds;
    await query(`UPDATE users SET reports_to_user_id = $1, job_title = 'Drafter' WHERE id = $2`, [editor, reader]);
    const card = await call('GET', `/api/v1/people/${editor}`, 'reader');
    expect(card.status).toBe(200);
    expect(card.body.direct_reports.map((r: any) => r.id)).toEqual([reader]);
    const theirs = await call('GET', `/api/v1/people/${reader}`, 'reader');
    expect(theirs.body).toMatchObject({ job_title: 'Drafter', reports_to: { id: editor }, chain: [{ id: editor }] });
    expect(theirs.body).not.toHaveProperty('password_hash');
    await query(`UPDATE users SET reports_to_user_id = NULL WHERE id = $1`, [reader]);
  });

  it('keeps people with stable ids: primary, phone-only, left and back', async () => {
    const company = (await call('POST', '/', 'editor', { name: `Aquarium of Guam ${tag}`, notes: tag })).body;
    const ana = await call('POST', `/${company.id}/contacts`, 'editor', { name: 'Ana', email: 'ana@guam.test', job_title: 'Curator' });
    expect(ana.status).toBe(201);
    expect(ana.body.is_primary).toBe(true); // first person becomes primary
    const ben = await call('POST', `/${company.id}/contacts`, 'editor', { name: 'Ben', mobile: '+1 671 555 0100' });
    expect(ben.body.is_primary).toBe(false);
    expect((await call('POST', `/${company.id}/contacts`, 'editor', { name: 'Nobody' })).status).toBe(400);

    const promoted = await call('PATCH', `/${company.id}/contacts/${ben.body.id}`, 'editor', { is_primary: true });
    expect(promoted.body).toMatchObject({ id: ben.body.id, is_primary: true });

    const left = await call('PATCH', `/${company.id}/contacts/${ben.body.id}`, 'editor', { left: true });
    expect(left.body).toMatchObject({ id: ben.body.id, is_primary: false });
    expect(left.body.left_on).toBeTruthy();

    const detail = await call('GET', `/${company.id}`, 'reader');
    expect(detail.body.contacts.map((c: any) => [c.name, !!c.left_on])).toEqual([['Ana', false], ['Ben', true]]);
    expect(detail.body.contact_count).toBe(1);

    const back = await call('PATCH', `/${company.id}/contacts/${ben.body.id}`, 'editor', { left: false });
    expect(back.body.left_on).toBeNull();
    expect((await call('DELETE', `/${company.id}/contacts/${ana.body.id}`, 'editor')).status).toBe(204);
  });
});
