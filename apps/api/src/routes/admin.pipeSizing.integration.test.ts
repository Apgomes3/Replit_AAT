// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import adminRoutes from './admin';

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const database = new Pool({ connectionString: databaseUrl });
const secret = process.env.JWT_SECRET || 'edp-secret-change-in-production';
const ids: Record<string, string> = {};
let app: Express;
let token: string;

function request(method: 'PUT' | 'DELETE', standardId: string, body?: Record<string, unknown>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        return server.close(() => reject(new Error('No test server port')));
      }
      const payload = body === undefined ? '' : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: `/api/v1/admin/pipe-sizing-standards/${standardId}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => server.close(error => error
          ? reject(error)
          : resolve({ status: response.statusCode || 0, body: text ? JSON.parse(text) : null })));
      });
      req.on('error', error => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function waitForBlockedAdminOperation(operation: 'UPDATE' | 'DELETE', blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await database.query(
      `SELECT 1
       FROM pg_stat_activity
       WHERE $1 = ANY(pg_blocking_pids(pid))
       LIMIT 1`,
      [blockerPid],
    );
    if (result.rows[0]) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for the admin ${operation.toLowerCase()} to block on the exhibit save`);
}

describeDatabase.sequential('admin pipe sizing PostgreSQL concurrency', () => {
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ error: { code: error?.code || 'INTERNAL', message: error?.message } }));

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ids.user = (await database.query(
      `INSERT INTO users(email,password_hash,role) VALUES($1,'integration-test','admin') RETURNING id`,
      [`pipe-sizing-${suffix}@example.test`],
    )).rows[0].id;
    token = jwt.sign({ id: ids.user, role: 'admin' }, secret);
    ids.project = (await database.query(
      `INSERT INTO projects(project_code,project_name,created_by)
       VALUES($1,'Pipe sizing concurrency integration',$2) RETURNING id`,
      [`PIPE-${suffix}`, ids.user],
    )).rows[0].id;
    ids.exhibit = (await database.query(
      `INSERT INTO exhibits(exhibit_code,project_id,exhibit_name)
       VALUES($1,$2,'Pipe sizing concurrency exhibit') RETURNING id`,
      [`EX-${suffix}`, ids.project],
    )).rows[0].id;
    ids.book = (await database.query(
      `INSERT INTO design_books(book_code,book_title,project_id,status,created_by)
       VALUES($1,'Pipe sizing concurrency book',$2,'Draft',$3) RETURNING id`,
      [`PIPE-BOOK-${suffix}`, ids.project, ids.user],
    )).rows[0].id;
    const standard = await database.query(
      `INSERT INTO pipe_sizing_standards(dn,internal_diameter_mm)
       SELECT candidate,candidate FROM generate_series(7001,7999) candidate
       WHERE NOT EXISTS (SELECT 1 FROM pipe_sizing_standards WHERE dn=candidate)
       LIMIT 1
       RETURNING id,dn`,
    );
    ids.standard = standard.rows[0].id;
    ids.dn = String(standard.rows[0].dn);
  });

  afterAll(async () => {
    if (ids.book) await database.query('DELETE FROM design_books WHERE id=$1', [ids.book]);
    if (ids.exhibit) await database.query('DELETE FROM exhibits WHERE id=$1', [ids.exhibit]);
    if (ids.standard) await database.query('DELETE FROM pipe_sizing_standards WHERE id=$1', [ids.standard]);
    if (ids.project) await database.query('DELETE FROM projects WHERE id=$1', [ids.project]);
    if (ids.user) {
      await database.query('UPDATE audit_logs SET actor_id=NULL WHERE actor_id=$1', [ids.user]);
      await database.query('DELETE FROM users WHERE id=$1', [ids.user]);
    }
    await database.end();
  });

  async function saveWhileAdminOperates(
    operation: 'UPDATE' | 'DELETE',
    adminRequest: () => Promise<{ status: number; body: any }>,
  ) {
    const saveClient: PoolClient = await database.connect();
    try {
      await saveClient.query('BEGIN');
      const blockerPid = Number((await saveClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await saveClient.query(
        `INSERT INTO design_book_exhibit_hydraulics
          (design_book_id,exhibit_id,inlet_pipe_dn,inlet_pipe_evidence)
         VALUES($1,$2,$3,$4::jsonb)`,
        [ids.book, ids.exhibit, Number(ids.dn), JSON.stringify({ dn: Number(ids.dn), source: 'integration-test' })],
      );

      const responsePromise = adminRequest();
      await waitForBlockedAdminOperation(operation, blockerPid);
      await saveClient.query('COMMIT');
      const response = await responsePromise;

      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body.error.code).toBe('IN_USE');
      const saved = await database.query(
        `SELECT h.inlet_pipe_dn,s.id AS standard_id
         FROM design_book_exhibit_hydraulics h
         JOIN pipe_sizing_standards s ON s.dn=h.inlet_pipe_dn
         WHERE h.design_book_id=$1 AND h.exhibit_id=$2`,
        [ids.book, ids.exhibit],
      );
      expect(saved.rows).toEqual([{ inlet_pipe_dn: Number(ids.dn), standard_id: ids.standard }]);
    } catch (error) {
      await saveClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      saveClient.release();
    }
  }

  it('keeps a concurrently saved selection valid when an administrator renames its DN', async () => {
    await saveWhileAdminOperates('UPDATE', () => request('PUT', ids.standard, {
      dn: Number(ids.dn) + 1000,
      internal_diameter_mm: Number(ids.dn),
      pressure_velocity_min_m_s: 1.5,
      pressure_velocity_max_m_s: 3,
      gravity_velocity_min_m_s: 0.1,
      gravity_velocity_max_m_s: 1.5,
      is_active: true,
    }));
  }, 10_000);

  it('keeps a concurrently saved selection valid when an administrator deletes its DN', async () => {
    await database.query(
      'DELETE FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id=$2',
      [ids.book, ids.exhibit],
    );
    await saveWhileAdminOperates('DELETE', () => request('DELETE', ids.standard));
  }, 10_000);
});