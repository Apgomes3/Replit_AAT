// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import biologicalMediaRoutes from './biologicalMedia';

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const database = new Pool({ connectionString: databaseUrl });
const secret = process.env.JWT_SECRET || 'edp-secret-change-in-production';
const ids: Record<string, string> = {};
let app: Express;
let token: string;

function request(path: string, body: Record<string, unknown>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        return server.close(() => reject(new Error('No test server port')));
      }
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => server.close(error => error
          ? reject(error)
          : resolve({ status: response.statusCode || 0, body: text ? JSON.parse(text) : {} })));
      });
      req.on('error', error => server.close(() => reject(error)));
      req.write(payload);
      req.end();
    });
  });
}

async function waitForBlockedPlenumSave(blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await database.query(
      `SELECT pid
       FROM pg_stat_activity
       WHERE $1 = ANY(pg_blocking_pids(pid))
       LIMIT 1`,
      [blockerPid],
    );
    if (blocked.rows[0]) return Number(blocked.rows[0].pid);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the plenum save to block on the Biological Media case');
}

describeDatabase.sequential('Biological Media plenum PostgreSQL concurrency', () => {
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', biologicalMediaRoutes);
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ error: { code: error?.code || 'INTERNAL', message: error?.message } }));

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ids.user = (await database.query(
      `INSERT INTO users(email,password_hash,role)
       VALUES($1,'integration-test','admin') RETURNING id`,
      [`bio-plenum-${suffix}@example.test`],
    )).rows[0].id;
    token = jwt.sign({ id: ids.user, role: 'admin', email: `bio-plenum-${suffix}@example.test` }, secret);
    ids.project = (await database.query(
      `INSERT INTO projects(project_code,project_name,created_by)
       VALUES($1,'Biological Media plenum concurrency',$2) RETURNING id`,
      [`BIO-PLENUM-${suffix}`, ids.user],
    )).rows[0].id;
    ids.exhibit = (await database.query(
      `INSERT INTO exhibits(project_id,exhibit_code,exhibit_name,water_type)
       VALUES($1,$2,'Plenum concurrency exhibit','Freshwater') RETURNING id`,
      [ids.project, `BIO-EX-${suffix}`],
    )).rows[0].id;
    ids.book = (await database.query(
      `INSERT INTO design_books(book_code,book_title,project_id,status,created_by)
       VALUES($1,'Plenum concurrency book',$2,'Draft',$3) RETURNING id`,
      [`BIO-BOOK-${suffix}`, ids.project, ids.user],
    )).rows[0].id;
    ids.system = (await database.query(
      `INSERT INTO systems(project_id,system_code,system_name,system_type,water_type,status)
       VALUES($1,$2,'Plenum concurrency LSS','Life Support System','Freshwater','Draft') RETURNING id`,
      [ids.project, `BIO-SYS-${suffix}`],
    )).rows[0].id;
    await database.query(
      `INSERT INTO system_exhibit_links(system_id,exhibit_id,link_type,allocation_source)
       VALUES($1,$2,'Primary','calculated')`,
      [ids.system, ids.exhibit],
    );
    await database.query(
      `INSERT INTO tanks(project_id,exhibit_id,tank_code,tank_name,operating_volume_m3,quantity,status)
       VALUES($1,$2,$3,'Plenum concurrency tank',20,1,'Active')`,
      [ids.project, ids.exhibit, `BIO-TANK-${suffix}`],
    );
    ids.case = (await database.query(
      `INSERT INTO lss_biological_media_cases
         (system_id,design_book_id,status,calculation_engine,water_volume_m3,water_type,
          preview_result,preview_input_snapshot,previewed_at,preview_stale,created_by)
       VALUES($1,$2,'Draft','AAT_CORE',20,'Freshwater',$3::jsonb,$4::jsonb,NOW(),false,$5)
       RETURNING id`,
      [
        ids.system,
        ids.book,
        JSON.stringify({ status: 'VALID', media: { installed_media_m3: 0.238 } }),
        JSON.stringify({ biomass: { water_volume_m3: 20 }, water: { water_type: 'Freshwater' } }),
        ids.user,
      ],
    )).rows[0].id;
  });

  afterAll(async () => {
    if (ids.book) await database.query('DELETE FROM design_books WHERE id=$1', [ids.book]);
    if (ids.exhibit) await database.query('DELETE FROM tanks WHERE exhibit_id=$1', [ids.exhibit]);
    if (ids.exhibit) await database.query('DELETE FROM exhibits WHERE id=$1', [ids.exhibit]);
    if (ids.project) await database.query('DELETE FROM projects WHERE id=$1', [ids.project]);
    if (ids.user) {
      await database.query('UPDATE audit_logs SET actor_id=NULL WHERE actor_id=$1', [ids.user]);
      await database.query('DELETE FROM users WHERE id=$1', [ids.user]);
    }
    await database.end();
  });

  it('rejects an obsolete crate layout after a concurrent media update locks the exact case row', async () => {
    const mediaClient: PoolClient = await database.connect();
    try {
      await mediaClient.query('BEGIN');
      const mediaPid = Number((await mediaClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await mediaClient.query(
        `UPDATE lss_biological_media_cases
         SET preview_stale=true,water_volume_m3=40,updated_at=NOW()
         WHERE id=$1`,
        [ids.case],
      );

      const savePromise = request(`/api/v1/systems/${ids.system}/bio-degas-plenum`, {
        design_book_id: ids.book,
        layout: {
          external_length_mm: 5000,
          external_width_mm: 2250,
          external_height_mm: 2000,
          wall_thickness_mm: 100,
          rows: 1,
          stack_height: 1,
          water_level_mm: 1200,
          tray_gap_mm: 100,
          tray_count: 1,
          stacks: [{ row: 0, column: 0, quantity: 1 }],
        },
      });

      const plenumPid = await waitForBlockedPlenumSave(mediaPid);
      const blockers = await database.query('SELECT pg_blocking_pids($1) AS pids', [plenumPid]);
      expect(blockers.rows[0].pids.map(Number)).toContain(mediaPid);

      await mediaClient.query('COMMIT');
      const response = await savePromise;
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body.error.code).toBe('STALE_SOURCE');

      const persisted = await database.query(
        `SELECT source_crate_count
         FROM design_book_bio_degas_plenum_layouts
         WHERE system_id=$1 AND design_book_id=$2`,
        [ids.system, ids.book],
      );
      expect(persisted.rows).toEqual([]);
    } catch (error) {
      await mediaClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      mediaClient.release();
    }
  }, 10_000);
});