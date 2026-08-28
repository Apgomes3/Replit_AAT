// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AQUARIUM_CALCULATION_VERSION } from '../lib/aquariumCalculations';

const testSecret = 'design-books-release-test-secret';
const bookId = 'book-release-1';
const managerRoles = ['admin', 'hq_manager', 'pmo'];

const state = vi.hoisted(() => ({
  snapshot: {} as Record<string, any>,
  calls: [] as Array<{ sql: string; params: any[] }>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) {
      return { rows: [{ access_level: 'manage' }] };
    }
    if (sql.includes('SELECT db.*, p.project_scopes')) {
      return {
        rows: [{
          id: bookId,
          book_code: 'DB-RELEASE',
          book_title: 'Release Gate Test',
          revision: 'A',
          status: 'Approved',
          project_id: null,
          project_scopes: state.snapshot.project_scopes,
          review_snapshot: state.snapshot,
        }],
      };
    }
    if (sql.includes("SET status='Released'")) {
      return { rows: [{ id: bookId, status: 'Released', revision: 'A' }] };
    }
    if (sql.includes('SELECT COALESCE(MAX(version_number)')) {
      return { rows: [{ next: 1 }] };
    }
    if (sql.includes('INSERT INTO design_book_versions')) {
      return { rows: [{ id: 'version-1', version_number: 1 }] };
    }
    return { rows: [] };
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

function validSnapshot() {
  return {
    id: bookId,
    book_code: 'DB-RELEASE',
    book_title: 'Release Gate Test',
    revision: 'A',
    project_id: 'project-1',
    project_scopes: ['Aquarium'],
    exhibits: [{ id: 'exhibit-1' }],
    tanks: [{ id: 'tank-1', exhibit_id: 'exhibit-1' }],
    species: [{ id: 'species-1', exhibit_id: 'exhibit-1' }],
    hydraulics: [{
      exhibit_id: 'exhibit-1',
      calculation_version: AQUARIUM_CALCULATION_VERSION,
    }],
    systems: [],
    engineering_calculations: {
      exhibits: [{ status: 'valid', inputs: { exhibit_id: 'exhibit-1' } }],
      systems: [],
    },
  };
}

function snapshotWithAllocations(flowPct: number | null, bioDegasPct: number | null) {
  const snapshot = validSnapshot();
  snapshot.project_scopes = ['Aquarium', 'LSS'];
  snapshot.systems = [{
    id: 'system-1',
    system_code: 'LSS-01',
    system_config: 'Recirculating',
    system_type: 'Life Support',
    status: 'Design',
    design_flow_m3h: 120,
    calculation_version: AQUARIUM_CALCULATION_VERSION,
    loop1_flow_source: 'Exhibit return',
    loop1_filtration: 'Mechanical and biological',
    loop1_flow_pct: flowPct,
    loop1_bio_degas_pct: bioDegasPct,
    loop1_bio_degas_m3h: 12,
    loop1_link_bio_degas: true,
  }];
  snapshot.engineering_calculations.systems = [{
    status: 'valid',
    inputs: { system_id: 'system-1' },
  }];
  return snapshot;
}

function requestRelease(app: Express, role: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const token = jwt.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
      const payload = JSON.stringify({
        revision: 'A',
        included_scope: state.snapshot.project_scopes,
        release_notes: 'Release gate API test',
        override_blockers: true,
        override_reason: 'This input must never bypass engineering blockers',
      });
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: `/api/v1/design-books/${bookId}/release`,
        method: 'POST',
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
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(response) });
          });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function requestPreflight(app: Express): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const token = jwt.sign({ id: 'reviewer-1', email: 'reviewer@example.com', role: 'hq_manager' }, testSecret);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: `/api/v1/design-books/${bookId}/release-preflight`,
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

describe('Design Book release API blocker enforcement', () => {
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
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it.each(managerRoles)('rejects invalid and stale exhibit calculations for %s', async role => {
    state.snapshot = validSnapshot();
    state.snapshot.engineering_calculations.exhibits = [{
      status: 'invalid',
      is_stale: true,
      reasons: ['Target turnover is missing.'],
      inputs: { exhibit_id: 'exhibit-1' },
    }];

    const response = await requestRelease(app, role);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('RELEASE_BLOCKED');
    expect(response.body.blockers.map((item: any) => item.key)).toEqual(
      expect.arrayContaining(['calculations', 'calculation_freshness']),
    );
    expect(state.calls.some(call => call.sql.includes('UPDATE design_books'))).toBe(false);
  });

  it.each(managerRoles)('rejects invalid LSS calculations for %s', async role => {
    state.snapshot = validSnapshot();
    state.snapshot.project_scopes = ['Aquarium', 'LSS'];
    state.snapshot.systems = [{
      id: 'system-1',
      system_config: 'Recirculating',
      system_type: 'Life Support',
      status: 'Design',
      design_flow_m3h: 120,
      calculation_version: AQUARIUM_CALCULATION_VERSION,
      loop1_flow_source: 'Exhibit return',
      loop1_filtration: 'Mechanical and biological',
    }];
    state.snapshot.engineering_calculations.systems = [{
      status: 'invalid',
      reasons: ['Linked flow allocation does not reconcile.'],
      inputs: { system_id: 'system-1' },
    }];

    const response = await requestRelease(app, role);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('RELEASE_BLOCKED');
    expect(response.body.blockers.map((item: any) => item.key)).toContain('calculations');
    expect(state.calls.some(call => call.sql.includes('UPDATE design_books'))).toBe(false);
  });

  it('reports nullable frozen allocations as separate non-blocking preflight warnings', async () => {
    state.snapshot = snapshotWithAllocations(null, null);

    const response = await requestPreflight(app);
    const loopAllocation = response.body.checklist.find((item: any) => item.key === 'flow_route_allocations');
    const branchAllocation = response.body.checklist.find((item: any) => item.key === 'bio_degas_allocations');

    expect(response.status).toBe(200);
    expect(loopAllocation).toMatchObject({ status: 'warning', affected_ids: ['system-1'] });
    expect(loopAllocation.message).toMatch(/LSS-01 · Loop 1/);
    expect(branchAllocation).toMatchObject({ status: 'warning', affected_ids: ['system-1'] });
    expect(response.body.blockers.map((item: any) => item.key)).not.toContain('flow_route_allocations');
    expect(response.body.blockers.map((item: any) => item.key)).not.toContain('bio_degas_allocations');
  });

  it.each([
    ['reviewed', 60, 25],
    ['intentional zero', 0, 0],
  ])('passes %s frozen allocation percentages in preflight', async (_label, flowPct, bioDegasPct) => {
    state.snapshot = snapshotWithAllocations(flowPct, bioDegasPct);

    const response = await requestPreflight(app);

    expect(response.status).toBe(200);
    expect(response.body.checklist.find((item: any) => item.key === 'flow_route_allocations')?.status).toBe('pass');
    expect(response.body.checklist.find((item: any) => item.key === 'bio_degas_allocations')?.status).toBe('pass');
  });

  it('allows release with nullable allocation warnings and freezes them in the checklist', async () => {
    state.snapshot = snapshotWithAllocations(null, null);

    const response = await requestRelease(app, 'hq_manager');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Released');
    expect(response.body.checklist.find((item: any) => item.key === 'flow_route_allocations')?.status).toBe('warning');
    expect(response.body.checklist.find((item: any) => item.key === 'bio_degas_allocations')?.status).toBe('warning');
    expect(state.calls.some(call => call.sql.includes("SET status='Released'"))).toBe(true);
  });
});