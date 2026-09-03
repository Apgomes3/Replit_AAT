// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testSecret = 'thermal-correlation-usage-test-secret';
const correlationId = '00000000-0000-4000-8000-000000000154';
const newCorrelationId = '00000000-0000-4000-8000-000000000155';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  moduleAccess: 'manage',
  usages: [
    {
      design_book_id: 'book-draft',
      design_book_status: 'Draft',
      book_code: 'DB-001',
      book_title: 'Draft thermal design',
      revision: 'A',
      project_id: 'project-1',
      project_code: 'P-001',
      project_name: 'Ocean Habitat',
      system_id: 'system-1',
      system_code: 'LSS-01',
      system_name: 'Main LSS',
      correlation_id: '00000000-0000-4000-8000-000000000154',
      captured_at: '2026-08-20T10:00:00.000Z',
    },
    {
      design_book_id: 'book-released',
      design_book_status: 'Released',
      book_code: 'DB-002',
      book_title: 'Released thermal design',
      revision: 'B',
      project_id: 'project-1',
      project_code: 'P-001',
      project_name: 'Ocean Habitat',
      system_id: 'system-2',
      system_code: 'LSS-02',
      system_name: 'Secondary LSS',
      correlation_id: '00000000-0000-4000-8000-000000000154',
      captured_at: '2026-08-25T10:00:00.000Z',
    },
  ],
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] };
    }
    if (sql.includes('SELECT rma.access_level')) {
      return { rows: [{ access_level: state.moduleAccess }] };
    }
    if (sql.includes('SELECT id FROM thermal_mass_transfer_correlations') &&
        sql.includes("status='approved'")) {
      return { rows: [{ id: correlationId }] };
    }
    if (sql.includes('SELECT * FROM thermal_agitation_classes')) {
      return {
        rows: [{
          id: 'class-1',
          class_code: 'MODERATE',
          class_name: 'Moderate',
          description: 'Moderate circulation',
        }],
      };
    }
    if (sql.includes('UPDATE thermal_mass_transfer_correlations')) {
      if (sql.includes('WHERE id=$2')) {
        return {
          rows: [{
            id: correlationId,
            version: '2026.1',
            status: 'superseded',
            superseded_by: 'admin-1',
          }],
        };
      }
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO thermal_mass_transfer_correlations')) {
      return { rows: [{ id: newCorrelationId }] };
    }
    if (sql.includes('INSERT INTO audit_log')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT id FROM design_books') && sql.includes('FOR SHARE')) {
      return { rows: state.usages.map(usage => ({ id: usage.design_book_id })) };
    }
    if (sql.includes('WHERE c.id=$1')) {
      return {
        rows: [{
          id: correlationId,
          class_id: 'class-1',
          class_code: 'MODERATE',
          class_name: 'Moderate',
          class_description: null,
          class_sort_order: 1,
          class_is_active: true,
          version: '2026.1',
          coefficient_kg_m2_s_kpa: '0.000001',
          source_reference: 'Engineering standard',
          notes: null,
          status: 'approved',
          approved_by: 'admin-1',
          approved_at: '2026-08-01T10:00:00.000Z',
          superseded_by: null,
          superseded_at: null,
          created_at: '2026-08-01T10:00:00.000Z',
          usage_count: '2',
        }],
      };
    }
    if (sql.includes('SELECT design_book_id, design_book_status')) {
      return { rows: state.usages };
    }
    throw new Error(`Unexpected query in thermal correlation usage test: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  return {
    query,
    default: {
      query,
      connect: vi.fn(async () => client),
    },
  };
});

function requestUsages(app: Express): Promise<{ status: number; body: any }> {
  return request(app, 'GET');
}

function request(
  app: Express,
  method: 'GET' | 'POST' | 'PUT',
  body?: Record<string, any>,
  role = 'admin',
  path = `/api/v1/thermal-correlations/versions/${correlationId}/${method === 'GET' ? 'usages' : 'supersede'}`,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const token = jwt.sign(
        { id: `${role}-1`, email: `${role}@example.com`, role },
        testSecret,
      );
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(JSON.stringify(body)),
          } : {}),
        },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => {
          server.close(error => {
            if (error) return reject(error);
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(response) });
          });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

describe('thermal correlation captured usage', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: designBookRoutes } = await import('./designBooks');
    app = express();
    app.use(express.json());
    app.use('/api/v1', designBookRoutes);
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns the version count and read-only usages across editable and frozen books', async () => {
    const response = await requestUsages(app);

    expect(response.status).toBe(200);
    expect(response.body.correlation).toMatchObject({
      id: correlationId,
      class_code: 'MODERATE',
      version: '2026.1',
      usage_count: 2,
    });
    expect(response.body.usages).toEqual(state.usages);
    expect(response.body.impact_token).toMatch(/^[a-f0-9]{64}\.[a-f0-9]{64}$/);

    const usageQuery = state.calls.find(call =>
      call.sql.includes('SELECT design_book_id, design_book_status'));
    expect(usageQuery?.params).toEqual([correlationId]);
    expect(usageQuery?.sql).toContain("db.status IN ('Draft', 'In Progress')");
    expect(usageQuery?.sql).toContain("db.status IN ('For Review', 'Approved')");
    expect(usageQuery?.sql).toContain("db.status='Released'");
    expect(usageQuery?.sql).toContain("db.review_snapshot->'thermal_calculations'");
    expect(usageQuery?.sql).toContain("db.release_snapshot->'thermal_calculations'");
  });

  it('forbids correlation usage review and supersession for non-admin users', async () => {
    const usageResponse = await request(app, 'GET', undefined, 'engineer');
    const supersedeResponse = await request(app, 'POST', {}, 'engineer');

    expect(usageResponse.status).toBe(403);
    expect(usageResponse.body.error).toMatchObject({ code: 'FORBIDDEN' });
    expect(supersedeResponse.status).toBe(403);
    expect(supersedeResponse.body.error).toMatchObject({ code: 'FORBIDDEN' });
    expect(state.calls.some(call => call.sql.includes("SET status='superseded'"))).toBe(false);
  });

  it('forbids every correlation governance mutation for non-admin users', async () => {
    const createClass = await request(
      app,
      'POST',
      { class_code: 'new', class_name: 'New' },
      'engineer',
      '/api/v1/thermal-correlations/classes',
    );
    const createVersion = await request(
      app,
      'POST',
      { version: '2026.2', coefficient_kg_m2_s_kpa: 0.000001, source_reference: 'ES-42' },
      'engineer',
      `/api/v1/thermal-correlations/classes/${correlationId}/versions`,
    );
    const updateClass = await request(
      app,
      'PUT',
      { class_code: 'moderate', class_name: 'Moderate' },
      'engineer',
      `/api/v1/thermal-correlations/classes/${correlationId}`,
    );

    expect(createClass.status).toBe(403);
    expect(createClass.body.error).toMatchObject({ code: 'FORBIDDEN' });
    expect(createVersion.status).toBe(403);
    expect(createVersion.body.error).toMatchObject({ code: 'FORBIDDEN' });
    expect(updateClass.status).toBe(403);
    expect(updateClass.body.error).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows an admin to approve a replacement after confirming captured usage', async () => {
    const usageResponse = await requestUsages(app);
    const response = await request(
      app,
      'POST',
      {
        version: '2026.2',
        coefficient_kg_m2_s_kpa: 0.0000012,
        upper_class_coefficient_kg_m2_s_kpa: 0.0000015,
        related_agitation_values: { upper: 0.0000015 },
        source_reference: 'ES-42',
        impact_token: usageResponse.body.impact_token,
      },
      'admin',
      '/api/v1/thermal-correlations/classes/class-1/versions',
    );

    expect(response.status).toBe(201);
    const insert = state.calls.find(call =>
      call.sql.includes('INSERT INTO thermal_mass_transfer_correlations'));
    expect(insert?.params).toHaveLength(18);
    expect(insert?.params[13]).toBe(0.0000015);
    expect(insert?.params[14]).toBe(JSON.stringify({ upper: 0.0000015 }));
    expect(insert?.params[17]).toBe('admin-1');
    expect(state.calls.some(call =>
      call.sql.includes('UPDATE thermal_mass_transfer_correlations') &&
      call.sql.includes("status='superseded'"))).toBe(true);
  });

  it('rejects a direct supersede request that did not acknowledge the current usage', async () => {
    const callStart = state.calls.length;
    const response = await request(app, 'POST', {});

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'THERMAL_CORRELATION_IMPACT_CHANGED',
    });
    expect(state.calls.slice(callStart).some(call => call.sql.includes("SET status='superseded'"))).toBe(false);
  });

  it('allows an admin to supersede directly after confirming captured usage', async () => {
    const usageResponse = await requestUsages(app);
    const callStart = state.calls.length;
    const response = await request(app, 'POST', {
      impact_token: usageResponse.body.impact_token,
      reason: 'Replaced by validated evidence',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: correlationId,
      status: 'superseded',
      superseded_by: 'admin-1',
    });
    expect(state.calls.slice(callStart).some(call =>
      call.sql.includes('WHERE id=$2') &&
      call.sql.includes("SET status='superseded'"))).toBe(true);
    expect(state.calls.slice(callStart).some(call =>
      call.sql.includes('INSERT INTO audit_log'))).toBe(true);
  });

  it('allows platform admins to review correlations when Design Books are hidden', async () => {
    state.moduleAccess = 'hidden';
    try {
      const response = await requestUsages(app);
      expect(response.status).toBe(200);
      expect(response.body.correlation).toMatchObject({ id: correlationId });
    } finally {
      state.moduleAccess = 'manage';
    }
  });
});