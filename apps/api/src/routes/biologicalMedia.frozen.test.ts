// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'biological-media-frozen-test-secret';
const state = vi.hoisted(() => ({
  calls: [] as string[],
  bookExists: true,
}));

vi.mock('../db', () => ({
  query: vi.fn(async (sql: string) => {
    state.calls.push(sql);
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('SELECT status, review_snapshot, release_snapshot FROM design_books')) {
      if (!state.bookExists) return { rows: [] };
      return {
        rows: [{
          status: 'Released',
          review_snapshot: null,
          release_snapshot: {
            systems: [{ id: 'system-1', water_type: 'Freshwater' }],
            system_links: [{
              system_id: 'system-1',
              exhibit_id: 'exhibit-1',
              exhibit_code: 'EX-01',
            }],
            exhibits: [{
              id: 'exhibit-1',
              exhibit_code: 'EX-01',
              exhibit_name: 'Frozen Exhibit',
              water_type: 'Freshwater',
            }],
            engineering_calculations: {
              exhibits: [{
                inputs: { exhibit_id: 'exhibit-1' },
                results: { operating_volume_m3: 42.125 },
              }],
            },
            biological_media_cases: [{
              id: 'case-frozen',
              system_id: 'system-1',
              design_book_id: 'book-1',
              reactor_type: 'Moving bed biofilter',
              media_profile_revision_id: 'media-1',
              tan_generation_profile_revision_id: 'tan-1',
              media_profile_status: 'Approved',
              tan_profile_status: 'Approved',
            }],
          },
        }],
      };
    }
    throw new Error(`Unexpected live-data query: ${sql}`);
  }),
}));

function request(app: Express) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const token = jwt.sign({ id: 'user-1', email: 'user@example.com', role: 'engineer' }, testSecret);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'GET',
        path: '/api/v1/systems/system-1/biological-media?design_book_id=book-1',
        headers: { Authorization: `Bearer ${token}` },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({ status: res.statusCode || 0, body: response ? JSON.parse(response) : {} });
        }));
      });
      req.on('error', reject);
      req.end();
    });
  });
}

describe('Biological Media frozen Design Book API context', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: biologicalMediaRoutes } = await import('./biologicalMedia');
    app = express();
    app.use(express.json());
    app.use('/api/v1', biologicalMediaRoutes);
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.bookExists = true;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns the captured case and volume without reading live exhibit tables', async () => {
    const response = await request(app);

    expect(response.status).toBe(200);
    expect(response.body.case).toMatchObject({ id: 'case-frozen', reactor_type: 'Moving bed biofilter' });
    expect(response.body.context).toMatchObject({
      source: 'frozen_design_book_package',
      total_operating_volume_m3: 42.125,
    });
    expect(response.body.readiness_status).toBe('Draft');
    const sql = state.calls.join('\n');
    expect(sql).not.toContain('system_exhibit_links');
    expect(sql).not.toContain('FROM tanks');
    expect(sql).not.toContain('design_book_exhibit_hydraulics');
  });

  it('returns not found instead of disguising a rejected context as an empty draft', async () => {
    state.bookExists = false;
    const response = await request(app);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});