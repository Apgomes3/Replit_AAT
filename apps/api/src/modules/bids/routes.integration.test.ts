// @vitest-environment node
// A tender from enquiry to lost, and the pipeline. Runs against the PostgreSQL test database.
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { JWT_SECRET } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errors';
import bidRoutes from './routes';
import enquiryRoutes from '../../routes/enquiries';

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

describe.skipIf(!process.env.DATABASE_URL)('bids (PostgreSQL)', () => {
  beforeAll(async () => {
    for (const who of ['lead', 'estimator']) {
      ids[who] = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', $2, 'Test', 'admin') RETURNING id`,
        [`bid-${who}-${tag}@example.test`, who])).rows[0].id;
    }
    token = jwt.sign({ id: ids.lead, email: `bid-lead-${tag}@example.test`, role: 'admin' }, JWT_SECRET);
    ids.client = (await query(`INSERT INTO clients (client_code, name) VALUES ($1, $2) RETURNING id`, [`T-B-${tag}`, `Tender Aquarium ${tag}`])).rows[0].id;
    await query(`INSERT INTO platform_exchange_rates (currency_code, rate_per_usd) VALUES ('AUD', 1.5) ON CONFLICT (currency_code) DO UPDATE SET rate_per_usd = 1.5`);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/bids', bidRoutes);
    app.use('/api/v1/enquiries', enquiryRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    server?.close();
    await query(`DELETE FROM enquiries WHERE client_id = $1`, [ids.client]);
    await query(`DELETE FROM clients WHERE id = $1`, [ids.client]);
    await query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [[ids.lead, ids.estimator]]).catch(() => undefined);
    await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [[ids.lead, ids.estimator]]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lead, ids.estimator]]);
  });

  it('runs a tender from first contact to lost, with decision, value, team and reasons', async () => {
    const made = await call('POST', '/enquiries', { client_id: ids.client, title: `Oceanarium LSS ${tag}`, enquiry_type: 'tender', status: 'qualifying' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ enquiry_type: 'tender', status: 'qualifying', bid_owner_user_id: ids.lead });
    const id = made.body.id;

    // A tender cannot be worked on before deciding to bid, by either route.
    expect((await call('POST', `/bids/${id}/stage`, { stage: 'bidding' })).body.error.message).toMatch(/bid \/ no-bid/);
    expect((await call('PATCH', `/enquiries/${id}`, { status: 'bidding' })).status).toBe(400);

    expect((await call('PATCH', `/bids/${id}`, { estimated_value: 300000, value_currency: 'AUD', win_probability: 40 })).status).toBe(200);
    expect((await call('PUT', `/bids/${id}/team`, { members: [{ user_id: ids.estimator, role: 'Estimator' }] })).status).toBe(200);
    expect((await call('POST', `/bids/${id}/decision`, { decision: 'bid', note: 'Strong fit' })).status).toBe(200);

    const detail = await call('GET', `/bids/${id}`);
    expect(detail.body).toMatchObject({
      status: 'bidding', bid_decision: 'bid', bid_decision_note: 'Strong fit', bid_decided_by: { id: ids.lead },
      estimated_value: 300000, value_currency: 'AUD', probability: 40, team: [{ user_id: ids.estimator, role: 'Estimator' }],
    });

    expect((await call('POST', `/bids/${id}/stage`, { stage: 'submitted' })).status).toBe(200);
    const pipeline = await call('GET', '/bids/pipeline');
    const row = pipeline.body.data.find((r: any) => r.id === id);
    expect(row).toMatchObject({ status: 'submitted', value_usd: 200000, probability: 40, team_size: 1 });
    expect(pipeline.body.summary.find((s: any) => s.stage === 'submitted').weighted_usd).toBeGreaterThanOrEqual(80000);
    expect((await call('GET', '/bids/pipeline?mine=1')).body.data.map((r: any) => r.id)).toContain(id);

    expect((await call('POST', `/bids/${id}/stage`, { stage: 'lost' })).body.error.message).toBe('Say why it was lost');
    expect((await call('POST', `/bids/${id}/stage`, { stage: 'lost', reason: 'price', note: 'Lost to a local firm, 15% cheaper' })).status).toBe(200);
    const lost = await call('GET', `/bids/${id}`);
    expect(lost.body).toMatchObject({ status: 'lost', outcome_reason: 'price', outcome_note: 'Lost to a local firm, 15% cheaper' });
    expect(lost.body.submitted_on).toBeTruthy();
  });

  it('closes a tender we decide not to bid for', async () => {
    const made = await call('POST', '/enquiries', { client_id: ids.client, title: `Too far away ${tag}`, enquiry_type: 'tender' });
    expect((await call('POST', `/bids/${made.body.id}/decision`, { decision: 'no_bid' })).status).toBe(400); // needs a reason
    expect((await call('POST', `/bids/${made.body.id}/decision`, { decision: 'no_bid', note: 'Outside our region' })).status).toBe(200);
    expect((await call('GET', `/bids/${made.body.id}`)).body).toMatchObject({ status: 'closed', bid_decision: 'no_bid', outcome_reason: 'no_bid' });
  });
});
