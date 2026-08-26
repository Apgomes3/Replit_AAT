// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'design-books-hydraulics-test-secret';
const actorId = 'actor-1';
const bookId = 'book-1';
const exhibitId = 'exhibit-1';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    return { rows: [{ id: 'hydraulics-1' }] };
  });
  return { query, default: { query } };
});

function request(
  app: Express,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: `/api/v1/design-books/${bookId}/exhibits/${exhibitId}/hydraulics`,
        method: 'PUT',
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

describe('design-book hydraulics weir persistence', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: designBookRoutes } = await import('./designBooks');
    app = express();
    app.use(express.json());
    app.use('/api/v1', designBookRoutes);
    token = jwt.sign({ id: actorId, email: 'actor@example.com', role: 'engineer' }, testSecret);
  });

  beforeEach(() => {
    state.calls.length = 0;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('preserves every saved weir field when an older client omits them', async () => {
    const response = await request(app, token, {
      target_turnover_rate: 5,
      surface_skim_pct: 30,
      bottom_drain_pct: 70,
    });

    expect(response.status).toBe(200);
    const call = state.calls[0];
    expect(call.sql).toContain('CASE WHEN $13');
    expect(call.params.slice(12, 18)).toEqual([false, false, false, false, false, false]);
  });

  it('updates all Francis basis fields when they are explicitly supplied', async () => {
    const response = await request(app, token, {
      target_turnover_rate: 5,
      surface_skim_pct: 30,
      bottom_drain_pct: 70,
      weir_head_mm: 100,
      weir_formula_method: 'francis_184',
      weir_geometry: 'sharp_rectangular',
      weir_end_contractions: 2,
      weir_discharge_condition: 'free',
      weir_downstream_head_mm: 0,
    });

    expect(response.status).toBe(200);
    expect(state.calls[0].params.slice(12, 18)).toEqual([true, true, true, true, true, true]);
  });

  it('allows an explicit null to clear a saved basis field without treating it as omitted', async () => {
    const response = await request(app, token, { weir_formula_method: null });

    expect(response.status).toBe(200);
    expect(state.calls[0].params[7]).toBeNull();
    expect(state.calls[0].params[13]).toBe(true);
  });
});