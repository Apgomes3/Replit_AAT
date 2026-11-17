// @vitest-environment node
// My Work tasks for a project, enquiry or design book, and what happens when an enquiry is won.
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import myWorkRoutes from './myWorkRoutes';
import enquiryRoutes from '../../routes/enquiries';
import { validatePersonalTaskInput } from './validation';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let base = '';
let token = '';
const ids: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('task links', () => {
  it('allows one link at most', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    expect(validatePersonalTaskInput({ title: 'x', enquiry_id: a }, { creating: true }).value).toMatchObject({ enquiry_id: a });
    expect(validatePersonalTaskInput({ title: 'x', enquiry_id: a, design_book_id: a }, { creating: true }).error).toMatch(/for one thing/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('tasks for enquiries and design books (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.user = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Bid', 'Writer', 'admin') RETURNING id`,
      [`tasks-${tag}@example.test`])).rows[0].id;
    token = jwt.sign({ id: ids.user, email: `tasks-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    ids.client = (await query(`INSERT INTO clients (client_code, name) VALUES ($1, $2) RETURNING id`, [`T-${tag}`, `Bidding Aquarium ${tag}`])).rows[0].id;
    ids.enquiry = (await query(`INSERT INTO enquiries (enquiry_number, client_id, title, status, created_by) VALUES ($1, $2, 'Tender for LSS', 'in_review', $3) RETURNING id`,
      [`ENQ-T-${tag}`.slice(0, 30), ids.client, ids.user])).rows[0].id;
    ids.book = (await query(`INSERT INTO design_books (book_code, book_title, created_by) VALUES ($1, 'Concept LSS', $2) RETURNING id`, [`DB-T-${tag}`, ids.user])).rows[0].id;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/my-work', myWorkRoutes);
    app.use('/api/v1/enquiries', enquiryRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM planning_personal_tasks WHERE user_id = $1`, [ids.user]);
    const project = (await query(`SELECT project_id FROM enquiries WHERE id = $1`, [ids.enquiry])).rows[0]?.project_id;
    await query(`DELETE FROM enquiries WHERE id = $1`, [ids.enquiry]);
    if (project) await query(`DELETE FROM projects WHERE id = $1`, [project]);
    await query(`DELETE FROM design_books WHERE id = $1`, [ids.book]);
    await query(`DELETE FROM clients WHERE id = $1`, [ids.client]);
    await query(`DELETE FROM notifications WHERE user_id = $1`, [ids.user]).catch(() => undefined);
    await query(`DELETE FROM audit_logs WHERE actor_id = $1`, [ids.user]);
    await query(`DELETE FROM users WHERE id = $1`, [ids.user]);
  });

  it('offers open enquiries and design books, and lists the tasks on them', async () => {
    const options = await call('GET', '/my-work/link-options');
    expect(options.body.enquiries.map((e: any) => e.id)).toContain(ids.enquiry);
    expect(options.body.design_books.map((b: any) => b.id)).toContain(ids.book);

    const sizing = await call('POST', '/my-work/tasks', { title: 'Size the filtration', enquiry_id: ids.enquiry, planned_hours: 8 });
    expect(sizing.status).toBe(201);
    expect(sizing.body.enquiry).toMatchObject({ id: ids.enquiry, name: 'Tender for LSS' });
    await call('POST', '/my-work/tasks', { title: 'Site visit notes', enquiry_id: ids.enquiry, status: 'done' });
    const book = await call('POST', '/my-work/tasks', { title: 'Review thermal tab', design_book_id: ids.book });
    expect(book.body.design_book).toMatchObject({ id: ids.book });

    // Changing what a task is for replaces the old link.
    const moved = await call('PATCH', `/my-work/tasks/${book.body.id}`, { enquiry_id: ids.enquiry });
    expect(moved.body).toMatchObject({ enquiry: { id: ids.enquiry }, design_book: null });
    await call('PATCH', `/my-work/tasks/${book.body.id}`, { design_book_id: ids.book });

    const onEnquiry = await call('GET', `/my-work/linked-tasks?enquiry_id=${ids.enquiry}`);
    expect(onEnquiry.body.data.map((t: any) => t.title)).toEqual(['Size the filtration', 'Site visit notes']);
    expect(onEnquiry.body.data[0].user_name).toBe('Bid Writer');
    expect((await call('GET', '/my-work/linked-tasks')).status).toBe(400);
  });

  it('moves the open enquiry tasks to the project when the enquiry is won', async () => {
    const created = await call('POST', `/enquiries/${ids.enquiry}/create-project`, { project_code: `P-${tag}`, project_name: 'Won tender' });
    expect(created.status).toBeLessThan(300);
    const projectId = (await query(`SELECT project_id FROM enquiries WHERE id = $1`, [ids.enquiry])).rows[0].project_id;
    const tasks = (await query(`SELECT title, project_id, enquiry_id FROM planning_personal_tasks WHERE user_id = $1 AND design_book_id IS NULL ORDER BY title`, [ids.user])).rows;
    expect(tasks).toEqual([
      { title: 'Site visit notes', project_id: null, enquiry_id: ids.enquiry }, // finished work stays with the enquiry
      { title: 'Size the filtration', project_id: projectId, enquiry_id: null },
    ]);
  });
});
