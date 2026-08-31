// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'design-books-detail-test-secret';
const bookId = '00000000-0000-4000-8000-000000000143';
const projectId = '00000000-0000-4000-8000-000000000144';
const systems = [1, 2, 3].map(index => ({
  id: `00000000-0000-4000-8000-00000000014${index + 4}`,
  project_id: projectId,
  system_code: `LSS-0${index}`,
  system_name: `Life Support ${index}`,
  system_type: 'Life Support',
  status: 'Draft',
  design_flow_m3h: null,
  side_streams: [],
  fractionator_allocations: [],
}));

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  status: 'Draft',
  reviewSnapshot: null as any,
  releaseSnapshot: null as any,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) {
      return { rows: [{ access_level: 'manage' }] };
    }
    if (sql.includes('SELECT db.*, p.project_code') && sql.includes('p.client_name')) {
      return {
        rows: [{
          id: bookId,
          project_id: projectId,
          book_code: 'DB-THERMAL',
          book_title: 'Thermal response regression',
          revision: 'A',
          status: state.status,
          review_snapshot: state.reviewSnapshot,
          release_snapshot: state.releaseSnapshot,
          project_scopes: ['LSS'],
        }],
      };
    }
    if (sql.includes('FROM exhibits e') && sql.includes('WHERE e.project_id')) {
      return { rows: [] };
    }
    if (sql.includes('FROM tanks t')) {
      return { rows: [] };
    }
    if (sql.includes('FROM systems s')) {
      return { rows: systems };
    }
    if (sql.includes('FROM system_flow_side_streams') ||
        sql.includes('FROM system_flow_fractionator_allocations') ||
        sql.includes('FROM design_book_exhibit_species') ||
        sql.includes('FROM design_book_exhibit_hydraulics') ||
        sql.includes('FROM design_book_exhibit_substrate') ||
        sql.includes('FROM system_exhibit_links') ||
        sql.includes('FROM design_book_thermal_calculations') ||
        sql.includes('FROM system_pump_selections')) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query in Design Book detail regression test: ${sql}`);
  });
  return {
    query,
    default: {
      query,
      connect: vi.fn(),
    },
  };
});

function requestDetail(app: Express): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const token = jwt.sign(
        { id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' },
        testSecret,
      );
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: `/api/v1/design-books/${bookId}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
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
      req.end();
    });
  });
}

describe('Design Book detail thermal response', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: designBookRoutes } = await import('./designBooks');
    app = express();
    app.use(express.json());
    app.use('/api/v1', designBookRoutes);
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.status = 'Draft';
    state.reviewSnapshot = null;
    state.releaseSnapshot = null;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns an unsaved current preview for every Life Support system in a Draft book', async () => {
    const response = await requestDetail(app);

    expect(response.status).toBe(200);
    expect(response.body.thermal_calculations).toHaveLength(3);
    expect(response.body.thermal_calculations.map((item: any) => item.system_id)).toEqual(
      systems.map(system => system.id),
    );
    expect(response.body.thermal_calculations).toEqual(
      expect.arrayContaining(systems.map(system => expect.objectContaining({
        system_id: system.id,
        system: expect.objectContaining({ id: system.id, system_type: 'Life Support' }),
        saved: null,
        calculation: null,
        current_preview: expect.any(Object),
        status: 'Not configured',
        freshness: 'unsaved',
        source_fingerprint: expect.any(String),
      }))),
    );
    expect(state.calls).toContainEqual(expect.objectContaining({
      params: [bookId, systems.map(system => system.id)],
    }));
  });

  it.each([
    ['For Review', 'reviewSnapshot'],
    ['Approved', 'reviewSnapshot'],
    ['Released', 'releaseSnapshot'],
  ] as const)('keeps %s Thermal data frozen', async (status, snapshotKey) => {
    const frozenThermal = [{
      system_id: 'frozen-system',
      freshness: 'fresh',
      status: 'Ready',
      calculation: { status: 'Ready', frozen: true },
    }];
    state.status = status;
    state[snapshotKey] = { thermal_calculations: frozenThermal };

    const response = await requestDetail(app);

    expect(response.status).toBe(200);
    expect(response.body.thermal_calculations).toEqual(frozenThermal);
  });
});