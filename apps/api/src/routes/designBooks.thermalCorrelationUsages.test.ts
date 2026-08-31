// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testSecret = 'thermal-correlation-usage-test-secret';
const correlationId = '00000000-0000-4000-8000-000000000154';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
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
      return { rows: [{ access_level: 'manage' }] };
    }
    if (sql.includes('SELECT id FROM thermal_mass_transfer_correlations') &&
        sql.includes("status='approved'")) {
      return { rows: [{ id: correlationId }] };
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
  method: 'GET' | 'POST',
  body?: Record<string, any>,
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
        { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
        testSecret,
      );
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: `/api/v1/thermal-correlations/versions/${correlationId}/${method === 'GET' ? 'usages' : 'supersede'}`,
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

  it('rejects a direct supersede request that did not acknowledge the current usage', async () => {
    const response = await request(app, 'POST', {});

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'THERMAL_CORRELATION_IMPACT_CHANGED',
    });
    expect(state.calls.some(call => call.sql.includes("SET status='superseded'"))).toBe(false);
  });
});