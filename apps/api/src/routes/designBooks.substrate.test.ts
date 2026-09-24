// @vitest-environment node
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateExhibitHydraulics } from '../lib/aquariumCalculations';

const bookId = '00000000-0000-4000-8000-000000000347';
const exhibitId = '00000000-0000-4000-8000-000000000348';
const secret = 'substrate-route-test-secret';
const outline = {
  units: 'mm', closed: true,
  segments: [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 10000, y: 0 } },
    { type: 'line', start: { x: 10000, y: 0 }, end: { x: 10000, y: 5000 } },
    { type: 'line', start: { x: 10000, y: 5000 }, end: { x: 0, y: 5000 } },
    { type: 'line', start: { x: 0, y: 5000 }, end: { x: 0, y: 0 } },
  ],
};
const state = vi.hoisted(() => ({
  tanks: [] as any[],
  saved: null as any,
  calls: [] as Array<{ sql: string; params: any[] }>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('SELECT status FROM design_books')) return { rows: [{ status: 'Draft' }] };
    if (sql.includes('FROM tanks t') && sql.includes('JOIN design_books db')) {
      return { rows: state.tanks };
    }
    if (sql.includes('INSERT INTO design_book_exhibit_substrate')) {
      state.saved = {
        substrate_volume_m3: params[4], theming_height_mm: params[6],
        theming_volume_m3: params[7], theming_volume_pct: params[8],
      };
      return { rows: [state.saved] };
    }
    throw new Error(`Unexpected substrate query: ${sql}`);
  });
  return { query, default: { query, connect: vi.fn() } };
});

describe('percentage-based theming saves', () => {
  let app: ReturnType<typeof express>;

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const router = (await import('./designBooks')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1', router);
  });
  afterAll(() => { delete process.env.JWT_SECRET; });
  beforeEach(() => {
    state.calls.length = 0;
    state.saved = null;
    state.tanks = [{
      id: 'custom', shape_type: 'Custom', eff_shape: 'Custom',
      custom_footprint: outline, surface_area_m2: 12, // stale cached area
      design_water_level_mm: 2900, eff_water_level_mm: 2900,
      operating_volume_m3: null, project_operating_volume_m3: null,
      quantity: 2,
    }];
  });

  async function save(body: any) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') return reject(new Error('No test port'));
        const request = http.request({
          host: '127.0.0.1', port: address.port,
          path: `/api/v1/design-books/${bookId}/exhibits/${exhibitId}/substrate`,
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${jwt.sign({ id: 'engineer', role: 'engineer' }, secret)}`,
            'Content-Type': 'application/json',
          },
        }, response => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { text += chunk; });
          response.on('end', () => server.close(() => resolve({
            status: response.statusCode || 0, body: JSON.parse(text),
          })));
        });
        request.on('error', reject);
        request.end(JSON.stringify(body));
      });
    });
  }

  it('accepts the assigned custom outline, adds all tanks, and persists percentage rather than a stale m³ cache', async () => {
    state.tanks.push({ id: 'pim', eff_shape: 'Custom', pim_operating_volume_m3: 30, quantity: 1 });
    const response = await save({
      theming_volume_pct: 10, theming_volume_m3: 9999,
      theming_height_mm: 200, substrate_volume_m3: 5,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      substrate_volume_m3: 5, theming_volume_pct: 10,
      theming_volume_m3: null, theming_height_mm: null,
    });
    expect(state.calls.find(call => call.sql.includes('FROM tanks t'))?.params)
      .toEqual([exhibitId, bookId]);
    const calculation = calculateExhibitHydraulics({ id: exhibitId }, state.tanks,
      { target_turnover_rate: 2 }, response.body);
    expect(calculation.inputs.gross_operating_volume_m3).toBe(320);
    expect(calculation.inputs.theming_volume_m3).toBe(32);
    expect(calculation.results.operating_volume_m3).toBe(283);

    state.tanks[0].eff_water_level_mm = 2500;
    const changed = calculateExhibitHydraulics({ id: exhibitId }, state.tanks,
      { target_turnover_rate: 2 }, response.body);
    expect(changed.inputs.gross_operating_volume_m3).toBe(280);
    expect(changed.inputs.theming_volume_m3).toBe(28);
    expect(changed.results.operating_volume_m3).toBe(247);
  });

  it('rejects percentages with missing or invalid geometry but allows direct m³', async () => {
    state.tanks[0].custom_footprint = { closed: false, segments: [] };
    const rejected = await save({ theming_volume_pct: 10 });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toContain('known tank operating volume');
    expect(state.saved).toBeNull();

    const direct = await save({ theming_volume_m3: 4 });
    expect(direct.status).toBe(200);
    expect(direct.body.theming_volume_m3).toBe(4);
  });

  it('uses explicitly stored tank volumes and rejects displacement at or above gross volume', async () => {
    state.tanks[0] = { id: 'manual', eff_shape: 'Custom', operating_volume_m3: 20, quantity: 2 };
    const valid = await save({ theming_volume_pct: 10, substrate_volume_m3: 35 });
    expect(valid.status).toBe(200);
    expect(valid.body.theming_volume_pct).toBe(10);
    const impossible = await save({ theming_volume_pct: 10, substrate_volume_m3: 36 });
    expect(impossible.status).toBe(400);
    expect(impossible.body.error.message).toContain('less than operating volume');
  });
});