// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testSecret = 'biological-media-evidence-test-secret';
const calls = vi.hoisted(() => [] as string[]);

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('FROM lss_biological_media_evidence_records e')) {
      return {
        rows: [{
          id: '00000000-0000-0000-0000-000000000001',
          evidence_code: 'OBS_MARINE_FLUIDIZED_SAND',
          revision: 1,
          title: 'Marine fluidized sand filter',
          record_type: 'Observation',
          evidence_classification: 'Loading benchmark',
          review_status: 'Review Needed',
          is_approved: false,
          promotable: false,
          promotion_exclusion_reason: 'Loading benchmark is explicitly excluded from direct Overall-VTR promotion.',
        }],
      };
    }
    if (sql.includes('FROM lss_biological_media_evidence_observations')) {
      return {
        rows: [{
          evidence_record_id: '00000000-0000-0000-0000-000000000001',
          observation_code: 'applied_tan_load',
          value: '500',
          value_text: '500',
          unit: 'g TAN-N/m³/day',
          qualifier: 'Loading benchmark',
        }],
      };
    }
    if (sql.includes('FROM lss_biological_media_evidence_links')) return { rows: [] };
    return { rows: [] };
  });
  return { query, default: { query, connect: vi.fn() } };
});

function request(app: Express, role: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No server address'));
      const token = jwt.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: '/api/v1/biological-media/evidence',
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

describe('Biological Media evidence API', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: routes } = await import('./biologicalMedia');
    app = express();
    app.use(express.json());
    app.use('/api/v1', routes);
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns nested review evidence with explicit selector exclusion', async () => {
    const response = await request(app, 'admin');

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      evidence_code: 'OBS_MARINE_FLUIDIZED_SAND',
      review_status: 'Review Needed',
      is_approved: false,
      promotable: false,
      selectable: false,
      approved: false,
      observations: [expect.objectContaining({
        value_text: '500',
        unit: 'g TAN-N/m³/day',
        qualifier: 'Loading benchmark',
      })],
    });
    expect(calls.some(sql => sql.includes('lss_biological_media_profiles'))).toBe(false);
  });

  it('does not expose the review library to designer roles', async () => {
    const response = await request(app, 'engineer');
    expect(response.status).toBe(403);
  });
});