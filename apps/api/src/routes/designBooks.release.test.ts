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
});