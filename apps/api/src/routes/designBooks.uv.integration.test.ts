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
  const query = (text: string, params?: any[]) => {
    if (!databaseState.client) throw new Error('Integration database client is not ready');
    const operation = databaseState.queryQueue.then(
      () => databaseState.client!.query(text, params),
    );
    databaseState.queryQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };
  return {
    query,
    default: {
      query,
      connect: async () => ({
        query,
        release: () => undefined,
      }),
    },
  };
});

import designBookRoutes from './designBooks';

const testSecret = process.env.JWT_SECRET || 'edp-secret-change-in-production';
const database = new Pool({ connectionString: process.env.DATABASE_URL });
const ids: Record<string, string> = {};
let client: PoolClient;
let app: Express;

function request(
  method: string,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
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
        path,
        method,
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
            if (error) {
              reject(error);
              return;
            }
            resolve({
              status: res.statusCode || 0,
              body: response ? JSON.parse(response) : {},
            });
          });
        });
      });
      req.on('error', error => server.close(() => reject(error)));
      req.write(payload);
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
  app.use('/api/v1', designBookRoutes);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: { code: error?.code || 'INTERNAL', message: error?.message } });
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ids.user = (await client.query(
    `INSERT INTO users(email,password_hash,role)
     VALUES($1,'integration-test','admin') RETURNING id`,
    [`uv-route-${suffix}@example.test`],
  )).rows[0].id;
  ids.project = (await client.query(
    `INSERT INTO projects(project_code,project_name,created_by)
     VALUES($1,'UV route integration test',$2) RETURNING id`,
    [`UV-ROUTE-${suffix}`, ids.user],
  )).rows[0].id;
  ids.exhibit = (await client.query(
    `INSERT INTO exhibits(project_id,exhibit_code,exhibit_name,water_type)
     VALUES($1,$2,'Linked UV exhibit','Freshwater') RETURNING id`,
    [ids.project, `UV-EX-${suffix}`],
  )).rows[0].id;
  ids.book = (await client.query(
    `INSERT INTO design_books(book_code,book_title,project_id,status,created_by)
     VALUES($1,'UV route integration test',$2,'Draft',$3) RETURNING id`,
    [`UV-BOOK-${suffix}`, ids.project, ids.user],
  )).rows[0].id;
  ids.system = (await client.query(
    `INSERT INTO systems
       (project_id,system_code,system_name,system_type,water_type,status,
        calculation_inputs,loop1_name,loop1_flow_source,loop1_flow_pct)
     VALUES($1,$2,'Linked exhibit LSS','Life Support System','Freshwater','Draft',
            '{"design_flow_source":"linked_exhibits"}'::jsonb,
            'Main loop','Linked exhibits',100)
     RETURNING id`,
    [ids.project, `UV-SYS-${suffix}`],
  )).rows[0].id;
  await client.query(
    `INSERT INTO system_exhibit_links(system_id,exhibit_id,link_type,allocation_source)
     VALUES($1,$2,'Primary','calculated')`,
    [ids.system, ids.exhibit],
  );
  await client.query(
    `INSERT INTO tanks
       (project_id,exhibit_id,tank_code,tank_name,operating_volume_m3,quantity,status)
     VALUES($1,$2,$3,'UV route tank',10,1,'Active')`,
    [ids.project, ids.exhibit, `UV-TANK-${suffix}`],
  );
  await client.query(
    `INSERT INTO design_book_exhibit_hydraulics
       (design_book_id,exhibit_id,target_turnover_rate,surface_skim_pct,bottom_drain_pct)
     VALUES($1,$2,2,30,70)`,
    [ids.book, ids.exhibit],
  );

  ids.material = (await client.query(
    `INSERT INTO materials(material_code,material_name)
     VALUES($1,'UV route test material') RETURNING id`,
    [`MAT-UV-${suffix}`],
  )).rows[0].id;
  await client.query(
    `INSERT INTO material_water_compatibility(material_code,water_type,allowed)
     VALUES($1,'Freshwater',true)`,
    [`MAT-UV-${suffix}`],
  );
  const uvFamily = (await client.query(
    `SELECT id FROM product_families WHERE product_family_code='PFM-UV'`,
  )).rows[0];
  expect(uvFamily).toBeDefined();
  ids.product = (await client.query(
    `INSERT INTO product_masters
       (product_code,product_family_id,product_name,manufacturer,
        primary_material_code,power_kw,lamp_count,status)
     VALUES($1,$2,'UV route test unit','Integration test',$3,1.2,2,'Active')
     RETURNING id`,
    [`UV-PRODUCT-${suffix}`, uvFamily.id, `MAT-UV-${suffix}`],
  )).rows[0].id;
  ids.catalog = (await client.query(
    'SELECT id FROM uv_engineering_catalogs WHERE product_master_id=$1',
    [ids.product],
  )).rows[0].id;
  ids.revision = (await client.query(
    `UPDATE uv_engineering_revisions
        SET status='Approved',
            effective_reactor_volume_l=100,
            irradiance_85t_mw_cm2=2,
            irradiance_95t_mw_cm2=2.5,
            source_evidence='UV route integration fixture',
            source_basis='AAT Foundations',
            source_basis_verified=true,
            approved_by=$2,
            approved_at=NOW()
      WHERE catalog_id=$1
      RETURNING id`,
    [ids.catalog, ids.user],
  )).rows[0].id;
  await client.query(
    `UPDATE uv_engineering_catalogs
        SET needs_review=false,review_reason=NULL
      WHERE id=$1`,
    [ids.catalog],
  );
  ids.stream = (await client.query(
    `INSERT INTO system_flow_side_streams
       (system_id,parent_loop_number,name,preset,flow_pct,uv_revision_id,
        uv_unit_quantity,uvt_basis)
     VALUES($1,1,'UV branch','UV',50,$2,1,'85T')
     RETURNING id`,
    [ids.system, ids.revision],
  )).rows[0].id;
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  databaseState.client = null;
  await database.end();
});

describe('POST /design-books/:id/uv/:systemId PostgreSQL integration', () => {
  it('resolves linked-exhibit Flow Route flow and persists the result snapshot without legacy columns', async () => {
    const legacyColumns = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema=current_schema()
          AND table_name='design_book_exhibit_hydraulics'
          AND column_name='results'`,
    );
    expect(legacyColumns.rows).toHaveLength(0);

    const token = jwt.sign({
      id: ids.user,
      email: 'uv-route-integration@example.test',
      role: 'admin',
    }, testSecret);
    const response = await request(
      'POST',
      `/api/v1/design-books/${ids.book}/uv/${ids.system}`,
      token,
      { target_fluence_mj_cm2: 50 },
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.result).toMatchObject({
      target_fluence_mj_cm2: 50,
      water_type: 'Freshwater',
      streams: [{
        side_stream_id: ids.stream,
        flow_m3h: 10,
        uv_revision_id: ids.revision,
      }],
    });

    const persisted = (await client.query(
      `SELECT input_snapshot,result_snapshot,calculation_version,freshness,calculated_by
         FROM design_book_uv_selections
        WHERE design_book_id=$1 AND system_id=$2`,
      [ids.book, ids.system],
    )).rows[0];
    expect(persisted).toBeDefined();
    expect(persisted.input_snapshot).toMatchObject({
      design_flow_m3h: 20,
      water_type: 'Freshwater',
      streams: [{
        side_stream_id: ids.stream,
        flow_m3h: 10,
        uv_revision_id: ids.revision,
      }],
    });
    expect(persisted.result_snapshot).toEqual(response.body.result);
    expect(persisted).toMatchObject({
      calculation_version: 'UV_SEL_V2.0',
      freshness: 'fresh',
      calculated_by: ids.user,
    });
  });
});