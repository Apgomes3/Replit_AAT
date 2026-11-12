// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databaseState = vi.hoisted(() => ({
  client: null as PoolClient | null,
  queryQueue: Promise.resolve(),
}));

vi.mock('../db', () => {
  const enqueue = (text: string, params?: any[]) => {
    if (!databaseState.client) throw new Error('Integration database client is not ready');
    const operation = databaseState.queryQueue.then(() => databaseState.client!.query(text, params));
    databaseState.queryQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const transactionQuery = (text: string, params?: any[]) => {
    if (text === 'BEGIN ISOLATION LEVEL SERIALIZABLE') {
      return enqueue('SAVEPOINT biological_media_run');
    }
    if (text === 'COMMIT') return enqueue('RELEASE SAVEPOINT biological_media_run');
    if (text === 'ROLLBACK') return enqueue('ROLLBACK TO SAVEPOINT biological_media_run');
    return enqueue(text, params);
  };
  return {
    query: enqueue,
    default: {
      query: enqueue,
      connect: async () => ({
        query: transactionQuery,
        release: () => undefined,
      }),
    },
  };
});

import biologicalMediaRoutes from './biologicalMedia';

const database = new Pool({ connectionString: process.env.DATABASE_URL });
const testSecret = process.env.JWT_SECRET || 'edp-secret-change-in-production';
const ids: Record<string, string> = {};
let client: PoolClient;
let app: Express;
let token: string;

function request(method: string, path: string, body?: Record<string, unknown>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const payload = body == null ? '' : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          } : {}),
        },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({
            status: res.statusCode || 0,
            body: response ? JSON.parse(response) : {},
          });
        }));
      });
      req.on('error', error => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

beforeAll(async () => {
  client = await database.connect();
  databaseState.client = client;
  await client.query('BEGIN');

  app = express();
  app.use(express.json());
  app.use('/api/v1', biologicalMediaRoutes);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: { code: error?.code || 'INTERNAL', message: error?.message } });
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ids.user = (await client.query(
    `INSERT INTO users(email,password_hash,role,first_name,last_name)
     VALUES($1,'integration-test','admin','Biological','Reviewer') RETURNING id`,
    [`biological-media-${suffix}@example.test`],
  )).rows[0].id;
  token = jwt.sign({
    id: ids.user,
    email: `biological-media-${suffix}@example.test`,
    role: 'admin',
  }, testSecret);
  ids.project = (await client.query(
    `INSERT INTO projects(project_code,project_name,created_by)
     VALUES($1,'Biological Media integration test',$2) RETURNING id`,
    [`BIO-RUN-${suffix}`, ids.user],
  )).rows[0].id;
  ids.exhibit = (await client.query(
    `INSERT INTO exhibits(project_id,exhibit_code,exhibit_name,water_type,design_temperature_min,design_temperature_max)
      VALUES($1,$2,'Biological Media exhibit','Freshwater',16,20) RETURNING id`,
    [ids.project, `BIO-EX-${suffix}`],
  )).rows[0].id;
  ids.book = (await client.query(
    `INSERT INTO design_books(book_code,book_title,project_id,status,created_by)
     VALUES($1,'Biological Media integration test',$2,'Draft',$3) RETURNING id`,
    [`BIO-BOOK-${suffix}`, ids.project, ids.user],
  )).rows[0].id;
  ids.system = (await client.query(
    `INSERT INTO systems(project_id,system_code,system_name,system_type,water_type,status)
     VALUES($1,$2,'Biological Media LSS','Life Support System','Freshwater','Draft') RETURNING id`,
    [ids.project, `BIO-SYS-${suffix}`],
  )).rows[0].id;
  await client.query(
    `INSERT INTO system_exhibit_links(system_id,exhibit_id,link_type,allocation_source)
     VALUES($1,$2,'Primary','calculated')`,
    [ids.system, ids.exhibit],
  );
  await client.query(
    `INSERT INTO tanks(project_id,exhibit_id,tank_code,tank_name,operating_volume_m3,quantity,status)
     VALUES($1,$2,$3,'Biological Media tank',20,1,'Active')`,
    [ids.project, ids.exhibit, `BIO-TANK-${suffix}`],
  );
  ids.media = (await client.query(
    `INSERT INTO lss_biological_media_profiles
       (profile_code,profile_name,water_types,reactor_types,capacity_model,
        overall_vtr_g_tan_n_m3_d,default_safety_factor,minimum_media_m3,
        module_increment_m3,media_fill_fraction,evidence_reference,status,
        created_by,approved_by,approved_at)
     VALUES($1,'Integration media',ARRAY['Freshwater'],ARRAY['Moving bed biofilter'],
            'OVERALL_VTR',90,1.2,0.1,0.01,0.6,'BIO-INTEGRATION','Approved',$2,$2,NOW())
     RETURNING id`,
    [`BIO-MEDIA-${suffix}`, ids.user],
  )).rows[0].id;
  ids.tan = (await client.query(
    `INSERT INTO lss_tan_generation_profiles
       (profile_code,profile_name,coefficient,coefficient_unit,scope_type,
        evidence_reference,status,created_by,approved_by,approved_at)
     VALUES($1,'Integration TAN',0.09216,'kg TAN-N/kg feed protein',
            'Species and feed validated','TAN-INTEGRATION','Approved',$2,$2,NOW())
     RETURNING id`,
    [`BIO-TAN-${suffix}`, ids.user],
  )).rows[0].id;
});

afterAll(async () => {
  if (client) {
    await databaseState.queryQueue;
    await client.query('ROLLBACK');
    client.release();
  }
  databaseState.client = null;
  await database.end();
});

// Runs only against a dedicated test database (TEST_DATABASE_URL, see vitest.config.ts).
describe.skipIf(!process.env.DATABASE_URL)('Biological Media review run PostgreSQL integration', () => {
  it('persists and reads array snapshots without shape changes', async () => {
    const draft = {
      design_book_id: ids.book,
      reactor_type: 'Moving bed biofilter',
      media_profile_revision_id: ids.media,
      tan_generation_profile_revision_id: ids.tan,
      biomass_method: 'SPECIES_LIST',
      species_rows: [{
        common_name_snapshot: 'Whale shark',
        scientific_name_snapshot: 'Rhincodon typus',
        life_stage: 'Adult',
        quantity: 2,
        design_weight_kg: 500,
      }],
      feed_rate_pct_biomass_day: 1,
      protein_pct: 45,
      manual_daily_feed_kg_d: 8,
      temperature_c: 24,
      ph: 7.8,
      salinity_ppt: 0,
      max_tan_source: 'CUSTOM',
      max_tan_mg_n_l: 0.1,
      safety_factor: 1.2,
    };
    const saved = await request('PUT', `/api/v1/systems/${ids.system}/biological-media`, draft);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const savedDraft = {
      ...draft,
      species_rows: saved.body.case.species_rows,
    };

    const preview = await request(
      'POST',
      `/api/v1/systems/${ids.system}/biological-media/preview`,
      savedDraft,
    );
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.status).toBe('VALID_WITH_WARNINGS');
    expect(preview.body.assumptions.length).toBeGreaterThan(0);
    expect(preview.body.messages.length).toBeGreaterThan(0);

    const created = await request(
      'POST',
      `/api/v1/systems/${ids.system}/biological-media/runs`,
      {
        design_book_id: ids.book,
        previewed_at: saved.body.case?.previewed_at,
        overrides: [],
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe('Pending Review');
    expect(created.body.species_snapshot).toEqual(saved.body.case.species_rows.map((row: any) => ({
      id: row.id,
      species_profile_id: row.species_profile_id,
      common_name_snapshot: row.common_name_snapshot,
      scientific_name_snapshot: row.scientific_name_snapshot,
      life_stage: row.life_stage,
      quantity: Number(row.quantity),
      design_weight_kg: Number(row.design_weight_kg),
      entered_weight_kg: Number(row.entered_weight_kg),
      notes: row.notes,
      sort_order: Number(row.sort_order),
    })));
    expect(created.body.assumptions).toEqual(preview.body.assumptions);
    expect(created.body.messages).toEqual(preview.body.messages);
    expect(created.body.overrides_snapshot).toEqual([]);

    const persisted = (await client.query(
      `SELECT species_snapshot,assumptions,messages,overrides_snapshot
       FROM lss_biological_media_runs WHERE id=$1`,
      [created.body.id],
    )).rows[0];
    for (const value of Object.values(persisted)) expect(Array.isArray(value)).toBe(true);
    expect(persisted).toMatchObject({
      species_snapshot: created.body.species_snapshot,
      assumptions: created.body.assumptions,
      messages: created.body.messages,
      overrides_snapshot: [],
    });

    const read = await request(
      'GET',
      `/api/v1/systems/${ids.system}/biological-media/runs/${created.body.id}?design_book_id=${ids.book}`,
    );
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({
      id: created.body.id,
      status: 'Pending Review',
      species_snapshot: persisted.species_snapshot,
      assumptions: persisted.assumptions,
      messages: persisted.messages,
      overrides_snapshot: [],
    });
  });

  it('persists, previews, and freezes an AAT Core Foundation selection', async () => {
    const draft = {
      design_book_id: ids.book,
      calculation_engine: 'AAT_CORE',
      temperature_basis: 'AVERAGE',
      temperature_c: 5,
      notes: 'Cold-water AAT foundation.',
    };
    const saved = await request('PUT', `/api/v1/systems/${ids.system}/biological-media`, draft);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.case.calculation_engine).toBe('AAT_CORE');

    const preview = await request('POST', `/api/v1/systems/${ids.system}/biological-media/preview`, draft);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({
      status: 'VALID',
      engine_version: 'AAT_CORE_1_0',
      calculation_engine: 'AAT_CORE',
      media: {
        foundation_percentage: 3.5,
        required_media_m3: 0.7,
        design_temperature_c: 18,
        foundation_rule: 'Freshwater exhibit',
      },
    });

    const created = await request('POST', `/api/v1/systems/${ids.system}/biological-media/runs`, {
      design_book_id: ids.book,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.engine_version).toBe('AAT_CORE_1_0');
    expect(created.body.normalized_input_snapshot.calculation_engine).toBe('AAT_CORE');
    expect(created.body.normalized_input_snapshot.temperature_basis).toBe('AVERAGE');
    expect(created.body.result_snapshot.media.required_media_m3).toBe(0.7);
  });
});