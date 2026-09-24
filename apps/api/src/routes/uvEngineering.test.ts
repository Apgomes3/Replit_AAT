// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'uv-engineering-test-secret';
const actorId = 'admin-1';

const state = vi.hoisted(() => ({
  revision: {
    id: 'revision-1',
    catalog_id: 'catalog-1',
    revision_number: 1,
    status: 'Draft',
    created_by: 'admin-1',
    reviewer_id: null as string | null,
    lamp_count: null as number | null,
    lamp_power_w: null as number | null,
    effective_reactor_volume_l: null as number | null,
    irradiance_85t_mw_cm2: null as number | null,
    irradiance_95t_mw_cm2: null as number | null,
    compatibility: null as string | null,
    arrangement: null as string | null,
    source_evidence: null as string | null,
  },
  queries: [] as string[],
  calls: [] as Array<{ sql: string; params: any[] }>,
  eligibleReviewers: [] as Array<{ id: string; first_name: string; last_name: string; email: string; role: string }>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
    state.queries.push(sql);
    state.calls.push({ sql, params });
    if (sql.startsWith('select rma.access_level')) return { rows: [] };
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [] };
    if (sql.startsWith('select u.id, u.first_name')) {
      return { rows: state.eligibleReviewers.filter(user => user.id !== params[0]) };
    }
    if (sql.startsWith('select u.id from users u')) {
      return { rows: state.eligibleReviewers.filter(user => user.id === params[0]) };
    }
    if (sql.startsWith('select id from uv_engineering_catalogs where id=$1 for update')) {
      return { rows: params[0] === 'catalog-1' ? [{ id: 'catalog-1' }] : [] };
    }
    if (sql.startsWith('select * from uv_engineering_revisions where catalog_id=$1 order by revision_number desc limit 1')) {
      return { rows: [{ ...state.revision }] };
    }
    if (sql.startsWith('select * from uv_engineering_revisions where id=$1')) {
      if (params[0] === 'foreign-revision') {
        return { rows: [{ ...state.revision, id: 'foreign-revision', catalog_id: 'catalog-2' }] };
      }
      return { rows: [{ ...state.revision }] };
    }
    if (sql.startsWith('insert into uv_engineering_revisions')) {
      return { rows: [{ ...state.revision, id: 'revision-2', revision_number: 2, supersedes_id: params[12] }] };
    }
    if (sql.startsWith('insert into lifecycle_transitions')) return { rows: [{ id: 'transition-1' }] };
    if (sql.startsWith('update uv_engineering_revisions set status=')) {
      state.revision = { ...state.revision, status: params[0], reviewer_id: params[0] === 'In Review' ? params[2] : state.revision.reviewer_id };
      return { rows: [{ ...state.revision }] };
    }
    if (sql.startsWith('update uv_engineering_catalogs set needs_review=false')) return { rows: [] };
    if (sql.includes("where c.needs_review=false") && sql.includes("approved.status='approved'")) {
      return {
        rows: [{
          id: 'catalog-1',
          product_code: 'UV-100',
          selected_revision: { ...state.revision, status: 'Approved' },
          latest_revision: { ...state.revision, status: 'Approved' },
        }],
      };
    }
    return { rows: [] };
  });
  return {
    query,
    default: {
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    },
  };
});

vi.mock('../db/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

function request(
  app: Express,
  method: string,
  path: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => {
          server.close(error => {
            if (error) return reject(error);
            resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
          });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

describe('UV engineering lifecycle', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const routes = await import('./uvEngineering');
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/uv-engineering', routes.default);
    app.use('/api/v1', routes.uvEngineeringConsumerRoutes);
    token = jwt.sign({ id: actorId, email: 'admin@example.com', role: 'admin' }, testSecret);
  });

  beforeEach(() => {
    state.queries.length = 0;
    state.calls.length = 0;
    state.revision = {
      id: 'revision-1',
      catalog_id: 'catalog-1',
      revision_number: 1,
      status: 'Draft',
      created_by: actorId,
      reviewer_id: null,
      lamp_count: null,
      lamp_power_w: null,
      effective_reactor_volume_l: null,
      irradiance_85t_mw_cm2: null,
      irradiance_95t_mw_cm2: null,
      compatibility: null,
      arrangement: null,
      source_evidence: null,
    };
    state.eligibleReviewers = [];
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it.each([-1, 0])('rejects invalid engineering measurements before persistence (%s)', async lampCount => {
    const response = await request(
      app,
      'PUT',
      '/api/v1/admin/uv-engineering/revisions/revision-1',
      token,
      { lamp_count: lampCount },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
    expect(state.queries.some(sql => sql.startsWith('update uv_engineering_revisions set lamp_count='))).toBe(false);
  });

  it('stores explicit water compatibility overrides on a draft revision', async () => {
    const response = await request(
      app,
      'PUT',
      '/api/v1/admin/uv-engineering/revisions/revision-1',
      token,
      { compatibility_overrides: [{ water_type: 'Seawater', allowed: true }] },
    );
    expect(response.status).toBe(200);
    expect(state.calls).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining('insert into uv_engineering_revision_compatibility'),
      params: ['revision-1', 'Seawater', true],
    }));
  });

  it('lists only eligible UV reviewers for the PIM module', async () => {
    const reviewer = {
      id: 'reviewer-2',
      first_name: 'Review',
      last_name: 'Engineer',
      email: 'reviewer@example.com',
      role: 'engineer',
    };
    const actingUser = {
      id: actorId,
      first_name: 'Current',
      last_name: 'Actor',
      email: 'admin@example.com',
      role: 'admin',
    };
    state.eligibleReviewers = [actingUser, reviewer];

    const response = await request(app, 'GET', '/api/v1/admin/uv-engineering/reviewers', token);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([reviewer]);
    expect(state.queries.some(sql => sql.includes('u.id<>$1')
      && sql.includes('u.is_active=true')
      && sql.includes("(access.access_level is null or access.access_level='manage')")
      && sql.includes("u.role in ('admin', 'engineer')"))).toBe(true);
  });

  it('rejects unknown water compatibility types', async () => {
    const response = await request(
      app,
      'PUT',
      '/api/v1/admin/uv-engineering/revisions/revision-1',
      token,
      { compatibility_overrides: [{ water_type: 'Pool water', allowed: true }] },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  it('does not approve incomplete UV engineering evidence', async () => {
    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/uv-engineering/revisions/revision-1/status',
      token,
      { status: 'Approved' },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INCOMPLETE_REVISION');
    expect(response.body.error.message).toContain('PIM lamp count');
    expect(response.body.error.message).toContain('positive effective reactor volume');
  });

  it('requires and notifies an assigned reviewer when the creator submits their own revision', async () => {
    const reviewer = {
      id: 'reviewer-2',
      first_name: 'Review',
      last_name: 'Engineer',
      email: 'reviewer@example.com',
      role: 'engineer',
    };
    state.revision.created_by = actorId;
    state.eligibleReviewers = [reviewer];

    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/uv-engineering/revisions/revision-1/status',
      token,
      { status: 'In Review', reviewer_id: reviewer.id },
    );

    expect(response.status).toBe(200);
    expect(response.body.reviewer_id).toBe(reviewer.id);
    expect(state.calls).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining('update uv_engineering_revisions set status='),
      params: ['In Review', actorId, reviewer.id, 'revision-1'],
    }));
    expect(state.calls).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining('insert into notifications'),
      params: expect.arrayContaining([true, 'info', 'pim', actorId, [reviewer.id], false]),
    }));
    const deliveries = state.calls.filter(call => call.sql.includes('insert into notifications'));
    const reviewerAction = deliveries.find(call => call.params[11]?.includes(reviewer.id) && call.params[7] === true);
    expect(reviewerAction?.params[12]).toBe(false);
    const subscriberUpdate = deliveries.find(call => call.params[12] === true);
    expect(subscriberUpdate?.params[7]).toBe(false);
    expect(subscriberUpdate?.params[13]).toContain(reviewer.id);
  });

  it('does not submit a revision for review without an eligible reviewer', async () => {
    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/uv-engineering/revisions/revision-1/status',
      token,
      { status: 'In Review' },
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REVIEWER_REQUIRED');
    expect(state.queries.some(sql => sql.startsWith('update uv_engineering_revisions set status='))).toBe(false);
  });

  it('rejects the acting user as their own UV reviewer', async () => {
    state.eligibleReviewers = [{
      id: actorId,
      first_name: 'Current',
      last_name: 'Actor',
      email: 'admin@example.com',
      role: 'admin',
    }];

    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/uv-engineering/revisions/revision-1/status',
      token,
      { status: 'In Review', reviewer_id: actorId },
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REVIEWER');
    expect(state.queries.some(sql => sql.startsWith('update uv_engineering_revisions set status='))).toBe(false);
    expect(state.queries.some(sql => sql.startsWith('insert into notifications'))).toBe(false);
  });

  it('keeps approved revision values immutable', async () => {
    state.revision.status = 'Approved';
    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/uv-engineering/revisions/revision-1/status',
      token,
      { status: 'Draft' },
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IMMUTABLE_REVISION');
  });

  it('does not rewrite approval evidence for a no-op Approved status request', async () => {
    state.revision.status = 'Approved';
    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/uv-engineering/revisions/revision-1/status',
      token,
      { status: 'Approved' },
    );
    expect(response.status).toBe(200);
    expect(state.queries.some(sql => sql.startsWith('update uv_engineering_revisions set status='))).toBe(false);
  });

  it('clears the PIM review blocker when a complete revision is approved', async () => {
    state.revision = {
      ...state.revision,
      lamp_count: 2,
      lamp_power_w: 85,
      effective_reactor_volume_l: 120,
      irradiance_85t_mw_cm2: 1.2,
      irradiance_95t_mw_cm2: 1.6,
      compatibility: 'Marine and freshwater',
      arrangement: 'Two-lamp reactor',
      source_evidence: 'Manufacturer TDS',
    };
    const response = await request(
      app,
      'PATCH',
      '/api/v1/admin/uv-engineering/revisions/revision-1/status',
      token,
      { status: 'Approved' },
    );
    expect(response.status).toBe(200);
    expect(state.queries).toContainEqual(expect.stringContaining('update uv_engineering_catalogs set needs_review=false'));
  });

  it('only exposes current PIM-linked approved records to calculations', async () => {
    const response = await request(app, 'GET', '/api/v1/uv-engineering/selectable', token);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    const selectableSql = state.queries.find(sql => sql.includes("approved.status='approved'"));
    expect(selectableSql).toContain('c.needs_review=false');
    expect(selectableSql).toContain('row_to_json(r) as selected_revision');
    expect(response.body.items[0].selected_revision.status).toBe('Approved');
  });

  it('rejects revision lineage from another UV product', async () => {
    const response = await request(
      app,
      'POST',
      '/api/v1/admin/uv-engineering/catalog-1/revisions',
      token,
      { source_revision_id: 'foreign-revision' },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_SOURCE_REVISION');
  });

  it('serializes revision allocation and links the immediate predecessor', async () => {
    const response = await request(
      app,
      'POST',
      '/api/v1/admin/uv-engineering/catalog-1/revisions',
      token,
      { source_revision_id: 'revision-1' },
    );
    expect(response.status).toBe(201);
    expect(response.body.revision_number).toBe(2);
    expect(response.body.supersedes_id).toBe('revision-1');
    expect(state.queries).toContain('select id from uv_engineering_catalogs where id=$1 for update');
  });
});