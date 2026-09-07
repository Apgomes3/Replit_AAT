// @vitest-environment node
import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const secret = 'water-density-test-secret';
const state = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; params: any[] }> }));
vi.mock('../db', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.startsWith('SELECT wdp')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM water_density_parameters')) return { rows: [{ id: 'density-1', water_type: 'Freshwater' }] };
    if (sql.startsWith('INSERT INTO water_density_parameters')) return { rows: [{ id: 'density-1', water_type: params[0] }] };
    if (sql.startsWith('UPDATE water_density_parameters')) return { rows: [{ id: 'density-1', water_type: params[0] }] };
    if (sql.startsWith('DELETE FROM water_density_parameters')) return { rows: [{ id: 'density-1', water_type: 'Freshwater' }] };
    return { rows: [] };
  }),
  default: { connect: vi.fn() },
}));
vi.mock('../db/audit', () => ({ logAudit: vi.fn(async () => undefined) }));

function request(app: Express, method: string, role: string, body?: unknown, suffix = '') {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const token = jwt.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, secret);
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const req = http.request({ host: '127.0.0.1', port: address.port, method, path: `/admin/chemical-parameters/water-density${suffix}`, headers: { Authorization: `Bearer ${token}`, ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) } }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => server.close(error => error ? reject(error) : resolve({ status: res.statusCode || 0, body: text ? JSON.parse(text) : {} })));
      });
      req.on('error', reject);
      if (encoded) req.write(encoded);
      req.end();
    });
  });
}

const valid = { water_type: 'Freshwater', density_kg_m3: 998.2, conditions: '20 °C; practical salinity 0 PSU', unit: 'kg/m3', source: 'NIST Chemistry WebBook', is_active: true };

describe('water density parameter administration', () => {
  let app: Express;
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const { default: adminRoutes } = await import('./admin');
    app = express();
    app.use(express.json());
    app.use('/admin', adminRoutes);
  });

  it('permits only administrators to read and mutate the governed library', async () => {
    expect((await request(app, 'GET', 'engineer')).status).toBe(403);
    expect((await request(app, 'POST', 'engineer', valid)).status).toBe(403);
    expect((await request(app, 'PUT', 'engineer', valid, '/density-1')).status).toBe(403);
    expect((await request(app, 'DELETE', 'engineer', undefined, '/density-1')).status).toBe(403);
    expect((await request(app, 'POST', 'admin', valid)).status).toBe(201);
    expect((await request(app, 'PUT', 'admin', { ...valid, density_kg_m3: 999 }, '/density-1')).status).toBe(200);
    expect((await request(app, 'DELETE', 'admin', undefined, '/density-1')).status).toBe(204);
  });

  it('rejects invalid units, density, source, and water types before writing', async () => {
    for (const payload of [
      { ...valid, density_kg_m3: 0 },
      { ...valid, unit: 'kg/L' },
      { ...valid, source: '' },
      { ...valid, water_type: 'Saltwater' },
    ]) expect((await request(app, 'POST', 'admin', payload)).status).toBe(400);
  });
});