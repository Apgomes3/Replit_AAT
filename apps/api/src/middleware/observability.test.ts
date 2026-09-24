import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { observe, summary, databaseEvent } from '../lib/telemetry';
import { errorHandler, notFound } from './errors';
import { readiness } from './readiness';
import pool from '../db';

async function serve(app: express.Express, work: (base: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('missing port');
    await work(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

describe('operational boundary', () => {
  it('returns correlation IDs, safe errors and route-only structured logs', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = express();
    app.use(observe);
    app.get('/api/v1/fail/:id', () => { throw new Error('secret token abc'); });
    app.use('/api', notFound);
    app.use(errorHandler);
    try {
      await serve(app, async base => {
        const response = await fetch(`${base}/api/v1/fail/private-record?password=secret`, { headers: { 'x-correlation-id': 'attacker-controlled' } });
        const body = await response.json() as any;
        const id = response.headers.get('x-correlation-id');
        expect(id).toMatch(/^[a-f0-9-]{36}$/);
        expect(body.error).toEqual({ code: 'SERVER_ERROR', message: 'An unexpected error occurred', correlationId: id });
        expect(JSON.stringify(output.mock.calls)).not.toMatch(/secret|private-record|attacker-controlled/i);
        expect(output.mock.calls.map(([line]) => JSON.parse(line)).find(event => event.event === 'http_request')).toMatchObject({
          endpoint: '/api/v1/fail/:id', status: 500, category: 'application', correlationId: id,
        });
      });
    } finally { output.mockRestore(); }
  });

  it('reports dependency readiness transitions and categories without leaking errors', async () => {
    let available = true;
    const app = express();
    app.use(observe);
    app.get('/api/ready', readiness(async () => {
      if (!available) throw new Error('database credential secret');
      return { rowCount: 1 };
    }));
    await serve(app, async base => {
      expect((await fetch(`${base}/api/ready`)).status).toBe(200);
      available = false;
      const failure = await fetch(`${base}/api/ready`);
      expect(failure.status).toBe(503);
      expect(await failure.json()).toEqual({ status: 'not_ready', database: 'unavailable' });
      expect(summary(5).find(row => row.endpoint === '/api/ready')?.errors).toBeGreaterThan(0);
      available = true;
      expect((await fetch(`${base}/api/ready`)).status).toBe(200);
    });
  });
  it('classifies invalid requests and database failures by endpoint', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = express();
    app.use(observe);
    app.get('/api/v1/invalid', (_, res) => res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid input' } }));
    app.get('/api/v1/database', (_, res) => {
      databaseEvent(15, true);
      res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE' } });
    });
    try {
      await serve(app, async base => {
        const invalid = await fetch(`${base}/api/v1/invalid`);
        expect((await invalid.json() as any).error.correlationId).toBe(invalid.headers.get('x-correlation-id'));
        await fetch(`${base}/api/v1/database`);
        expect(summary(5).find(row => row.endpoint === '/api/v1/database')?.databaseFailures).toBeGreaterThan(0);
        const logs = output.mock.calls.map(([line]) => JSON.parse(line));
        expect(logs.find(event => event.endpoint === '/api/v1/invalid')).toMatchObject({ category: 'invalid_client' });
        expect(logs.find(event => event.endpoint === '/api/v1/database')).toMatchObject({ category: 'database' });
        expect(logs.find(event => event.event === 'database_operation')).not.toHaveProperty('sql');
      });
    } finally { output.mockRestore(); }
  });
  it('counts a direct leased-client failure and preserves forwarded domain conflict guidance', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const client = { query: vi.fn().mockRejectedValue(Object.assign(new Error('internal SQL detail'), { code: '08006' })) };
    pool.emit('acquire', client as any);
    const app = express();
    app.use(observe);
    app.get('/api/v1/direct-client', async (_req, _res, next) => {
      try { await client.query(); } catch (error) { next(error); }
    });
    app.get('/api/v1/conflict', (_req, _res, next) => {
      next(Object.assign(new Error('Conflicting design flows require an explicit resolution'), { status: 409, code: 'CONFLICT' }));
    });
    app.use(errorHandler);
    try {
      await serve(app, async base => {
        const failed = await fetch(`${base}/api/v1/direct-client`);
        expect((await failed.json() as any).error.message).toBe('An unexpected error occurred');
        expect(summary(5).find(row => row.endpoint === '/api/v1/direct-client')?.databaseFailures).toBeGreaterThan(0);
        const conflict = await fetch(`${base}/api/v1/conflict`);
        const conflictBody = await conflict.json() as any;
        expect(conflict.status).toBe(409);
        expect(conflictBody.error).toMatchObject({
          code: 'CONFLICT', message: 'Conflicting design flows require an explicit resolution',
          correlationId: conflict.headers.get('x-correlation-id'),
        });
        expect(output.mock.calls.map(([line]) => JSON.parse(line)).find(event => event.endpoint === '/api/v1/conflict').category).toBe('invalid_client');
      });
    } finally { output.mockRestore(); }
  });
});