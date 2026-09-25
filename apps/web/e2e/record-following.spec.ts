import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Unlike the component fixtures, this suite uses the real API and PostgreSQL.
// Run with npm run test:browser:follow against a migrated development database.
test('following persists on every detail page and PO updates stay private across sessions and stages', async ({ browser, request }) => {
  test.setTimeout(120_000);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the real-browser following test');
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const password = `follow-${randomUUID()}`;
  const users = ['owner', 'follower', 'stage'] as const;
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  const api = async (token: string, method: string, path: string) => {
    const response = await request.fetch(`http://127.0.0.1:4173/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${token}` },
    });
    return { status: response.status(), body: await response.json() as any };
  };
  const login = async (email: string, client: APIRequestContext) => {
    const response = await client.post('http://127.0.0.1:4173/api/v1/auth/login', {
      data: { email, password },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).token as string;
  };
  const openSession = async (token: string) => {
    const context = await browser.newContext();
    contexts.push(context);
    await context.addInitScript(value => localStorage.setItem('edp_token', value), token);
    return context.newPage();
  };
  const follow = async (page: Page, path: string, leaveFollowing = false) => {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unfollow' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Unfollow' })).toBeVisible();
    if (!leaveFollowing) {
      await page.getByRole('button', { name: 'Unfollow' }).click();
      await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeEnabled();
    }
  };

  try {
    const hash = await bcrypt.hash(password, 4);
    for (const role of users) {
      ids[role] = (await db.query(
        `INSERT INTO users(email,password_hash,role,can_see_all_pos)
         VALUES($1,$2,$3,false) RETURNING id`,
        [`follow-${role}-${suffix}@example.test`, hash, role === 'owner' ? 'admin' : 'engineer'],
      )).rows[0].id;
    }
    ids.project = (await db.query(
      `INSERT INTO projects(project_code,project_name,created_by)
       VALUES($1,'Browser following project',$2) RETURNING id`,
      [`FOLLOW-${suffix}`, ids.owner],
    )).rows[0].id;
    ids.book = (await db.query(
      `INSERT INTO design_books(book_code,book_title,project_id,created_by)
       VALUES($1,'Browser following book',$2,$3) RETURNING id`,
      [`FOLLOW-BOOK-${suffix}`, ids.project, ids.owner],
    )).rows[0].id;
    ids.client = (await db.query(
      `INSERT INTO clients(client_code,name,created_by)
       VALUES($1,'Browser following client',$2) RETURNING id`,
      [`FOLLOW-${suffix}`, ids.owner],
    )).rows[0].id;
    ids.enquiry = (await db.query(
      `INSERT INTO enquiries(enquiry_number,client_id,title,created_by)
       VALUES($1,$2,'Browser following enquiry',$3) RETURNING id`,
      [`FOLLOW-${suffix}`, ids.client, ids.owner],
    )).rows[0].id;
    ids.po = (await db.query(
      `INSERT INTO purchase_orders(po_code,status,project_id,created_by)
       VALUES($1,'purchase_order',$2,$3) RETURNING id`,
      [`FOLLOW-${suffix}`, ids.project, ids.owner],
    )).rows[0].id;
    await db.query('INSERT INTO po_items(po_id,cost_price) VALUES($1,10)', [ids.po]);
    await db.query('INSERT INTO po_designated_users(po_id,user_id) VALUES($1,$2)', [ids.po, ids.follower]);
    await db.query(
      `INSERT INTO po_stage_assignees(stage,user_id,created_by)
       VALUES('purchase_order',$1,$3),('po_review',$1,$3),('po_review',$2,$3)`,
      [ids.owner, ids.stage, ids.owner],
    );

    const tokens = {
      owner: await login(`follow-owner-${suffix}@example.test`, request),
      follower: await login(`follow-follower-${suffix}@example.test`, request),
      stage: await login(`follow-stage-${suffix}@example.test`, request),
    };
    const follower = await openSession(tokens.follower);
    const stage = await openSession(tokens.stage);
    const poPath = `/purchase-orders/${ids.po}`;
    const subscription = `/notifications/subscriptions/purchase_order/${ids.po}`;

    // The first real transition precedes any subscription.
    expect(await api(tokens.owner, 'POST', `${poPath}/transition`))
      .toMatchObject({ status: 200, body: { status: 'po_review' } });
    expect((await api(tokens.follower, 'GET', '/notifications')).body.notifications
      .filter((n: any) => n.entity_id === ids.po)).toHaveLength(0);

    for (const path of [
      `/projects/${ids.project}`,
      `/design-books/${ids.book}`,
      `/enquiries/${ids.enquiry}`,
    ]) await follow(follower, path);
    await follow(follower, poPath, true);
    await follow(stage, poPath, true);

    // A previously delivered notification must disappear from the inbox when
    // the stage-only recipient loses access, even though its row still exists.
    await db.query(
      `INSERT INTO notifications(user_id,type,title,entity_type,entity_id)
       VALUES($1,'po_transitioned','Visible while assigned','purchase_order',$2)`,
      [ids.stage, ids.po],
    );
    expect((await api(tokens.stage, 'GET', '/notifications')).body.notifications
      .filter((n: any) => n.entity_id === ids.po).map((n: any) => n.title))
      .toEqual(['Visible while assigned']);
    const transitioned = await api(tokens.owner, 'POST', `${poPath}/transition`);
    expect(transitioned).toMatchObject({ status: 200, body: { status: 'engineering_review' } });
    const denied = await api(tokens.stage, 'GET', subscription);
    expect(denied.status).toBe(404);
    expect((await api(tokens.stage, 'PUT', subscription)).status).toBe(404);
    expect((await api(tokens.stage, 'DELETE', subscription)).status).toBe(404);
    const hiddenInbox = await api(tokens.stage, 'GET', '/notifications');
    expect(hiddenInbox.status).toBe(200);
    expect(hiddenInbox.body.notifications.filter((n: any) => n.entity_id === ids.po)).toHaveLength(0);
    expect((await db.query(
      `SELECT title FROM notifications WHERE user_id=$1 AND entity_id=$2`,
      [ids.stage, ids.po],
    )).rows.map(row => row.title)).toEqual(['Visible while assigned']);

    await stage.reload();
    await expect(stage.getByRole('button', { name: 'Unfollow' })).toHaveCount(0);
    await follower.reload();
    await expect(follower.getByRole('button', { name: 'Unfollow' })).toBeVisible();
    const followerInbox = await api(tokens.follower, 'GET', '/notifications');
    expect(followerInbox.body.notifications.filter((n: any) => n.entity_id === ids.po)
      .map((n: any) => n.title)).toEqual(['PO Stage Updated']);
    await follower.getByRole('button', { name: 'Unfollow' }).click();
    await expect(follower.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
    await follower.reload();
    await expect(follower.getByRole('button', { name: 'Follow', exact: true })).toBeEnabled();
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    try {
      if (ids.po) await db.query('DELETE FROM purchase_orders WHERE id=$1', [ids.po]);
      if (ids.enquiry) await db.query('DELETE FROM enquiries WHERE id=$1', [ids.enquiry]);
      if (ids.book) await db.query('DELETE FROM design_books WHERE id=$1', [ids.book]);
      if (ids.client) await db.query('DELETE FROM clients WHERE id=$1', [ids.client]);
      if (ids.project) await db.query('DELETE FROM projects WHERE id=$1', [ids.project]);
      if (ids.owner) await db.query('DELETE FROM po_stage_assignees WHERE created_by=$1', [ids.owner]);
      if (ids.owner) await db.query('DELETE FROM audit_logs WHERE actor_id=$1', [ids.owner]);
      for (const role of users) if (ids[role]) await db.query('DELETE FROM users WHERE id=$1', [ids[role]]);
    } finally { await db.end(); }
  }
});