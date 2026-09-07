// @vitest-environment node
import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const secret = 'tank-design-sheet-test';
const state = vi.hoisted(() => ({ scoped: true, valid: true, audits: 0 }));
vi.mock('../db', () => ({
  default: { query: vi.fn() },
  query: vi.fn(async (sql: string) => {
    if (sql.includes('role_module_access')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('FROM tanks t') && sql.includes('project_code')) return { rows: state.scoped ? [{
      id: 'tank-1', project_id: 'project-1', project_code: 'P-1', project_name: 'Project',
      tank_code: 'TK-1', tank_name: 'Tank', eff_shape: 'Rectangular', eff_length_mm: 2000,
      eff_width_mm: 1000, eff_height_mm: 1200, gross_volume_m3: 2.4, design_volume_m3: 2,
      eff_water_level_mm: state.valid ? 1000 : null, overflow_level_mm: state.valid ? 1100 : null,
      exhibit_id: 'ex-1', exhibit_code: 'EX-1', exhibit_name: 'Exhibit', water_type: 'Freshwater',
      design_temperature_min: 20, design_temperature_max: 22, system_id: null,
    }] : [] };
    if (sql.includes('water_density_parameters')) return { rows: [{ id: 'density-1', water_type: 'Freshwater', density_kg_m3: 998.2, is_active: true, unit: 'kg/m3', conditions: '20 C', source: 'NIST' }] };
    if (sql.includes('design_book_thermal_calculations')) return { rows: [] };
    return { rows: [] };
  }),
}));
vi.mock('../db/audit', () => ({ logAudit: vi.fn(async () => { state.audits++; }) }));

function get(app: Express, path: string, token?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      const req = http.request({ host: '127.0.0.1', port: address.port, path, headers: token ? { Authorization: `Bearer ${token}` } : {} }, res => {
        const chunks: Buffer[] = []; res.on('data', c => chunks.push(Buffer.from(c)));
        res.on('end', () => server.close(() => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) })));
      }); req.on('error', reject); req.end();
    });
  });
}

describe('tank design-sheet endpoints', () => {
  let app: Express;
  let token: string;
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    token = jwt.sign({ id: 'engineer', email: 'e@test', role: 'engineer' }, secret);
    const routes = await import('./projects');
    app = express(); app.use('/api/v1', routes.default);
  });
  it('rejects unauthenticated PDF access and scopes preview tank to project', async () => {
    expect((await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet.pdf')).status).toBe(401);
    state.scoped = false;
    expect((await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet', token)).status).toBe(404);
    state.scoped = true;
  });
  it('returns a governed PDF with deterministic headers and audits generation', async () => {
    const response = await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet.pdf', token);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('TK-1-tank-design-sheet.pdf');
    expect(response.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(response.body.length).toBeGreaterThan(500);
    expect(state.audits).toBeGreaterThan(0);
  });
  it('returns preview validation and blocks invalid PDF generation', async () => {
    state.valid = false;
    const preview = await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet', token);
    expect(preview.status).toBe(200);
    expect(JSON.parse(preview.body.toString()).validation.valid).toBe(false);
    expect((await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet.pdf', token)).status).toBe(422);
    state.valid = true;
  });
});