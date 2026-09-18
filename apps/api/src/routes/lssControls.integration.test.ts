// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcilePumpLinkedInstruments } from '../lib/lssControls';
import { projectLssIoSchedule } from '../lib/lssIoSchedule';
import lssControlRoutes from './lssControls';

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const database = new Pool({ connectionString: databaseUrl });
const secret = process.env.JWT_SECRET || 'edp-secret-change-in-production';
const ids: Record<string, string> = {};
let app: Express;
let token: string;

function request(method: string, path: string, body?: Record<string, unknown>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return server.close(() => reject(new Error('No test server port')));
      const payload = body === undefined ? '' : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1', port: address.port, path, method,
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
          : resolve({ status: response.statusCode || 0, body: text ? JSON.parse(text) : {} })));
      });
      req.on('error', error => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describeDatabase('LSS Control PostgreSQL integration', () => {
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', lssControlRoutes);
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ error: { code: error?.code || 'INTERNAL', message: error?.message } }));

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ids.user = (await database.query(
      `INSERT INTO users(email,password_hash,role) VALUES($1,'integration-test','admin') RETURNING id`,
      [`lss-controls-${suffix}@example.test`],
    )).rows[0].id;
    token = jwt.sign({ id: ids.user, role: 'admin', email: `lss-controls-${suffix}@example.test` }, secret);
    ids.project = (await database.query(
      `INSERT INTO projects(project_code,project_name,created_by) VALUES($1,'LSS control integration',$2) RETURNING id`,
      [`LSS-CTRL-${suffix}`, ids.user],
    )).rows[0].id;
    ids.system = (await database.query(
      `INSERT INTO systems(project_id,system_code,system_name,system_type,water_type,status)
       VALUES($1,$2,'Control LSS','Life Support System','Freshwater','Draft') RETURNING id`,
      [ids.project, `LSS-${suffix}`,],
    )).rows[0].id;
    ids.book = (await database.query(
      `INSERT INTO design_books(book_code,book_title,project_id,status,created_by)
       VALUES($1,'LSS control integration',$2,'Draft',$3) RETURNING id`,
      [`LSS-BOOK-${suffix}`, ids.project, ids.user],
    )).rows[0].id;
    ids.productA = (await database.query(
      `INSERT INTO product_masters(product_code,product_name,status) VALUES($1,'Snapshot product A','Active') RETURNING id`,
      [`LSS-PROD-A-${suffix}`],
    )).rows[0].id;
    ids.productB = (await database.query(
      `INSERT INTO product_masters(product_code,product_name,status) VALUES($1,'Snapshot product B','Active') RETURNING id`,
      [`LSS-PROD-B-${suffix}`],
    )).rows[0].id;
    ids.optional = (await database.query(
      `INSERT INTO field_instrument_definitions
        (name,tag_code,signal_type,signal_direction,requirement_rule,default_control_logic,default_product_master_id,
         default_range_min,default_range_max,default_unit,default_calibration_required,
         default_calibration_interval_days,default_calibration_procedure,default_datasheet_reference,sort_order)
        VALUES('Integration imported sensor',$1,'analog','input','optional','Read A',$2,
         0,6,'bar',true,365,'CAL-A','DS-A',9990) RETURNING id`,
      [`IT-${suffix.slice(-6)}`, ids.productA],
    )).rows[0].id;
    ids.pumpLinked = (await database.query(
      `INSERT INTO field_instrument_definitions
       (name,tag_code,signal_type,signal_direction,requirement_rule,default_control_logic,sort_order)
       VALUES('Integration pump flow switch',$1,'digital','input','pump_linked','Prove integration pump flow',9991) RETURNING id`,
      [`IFS-${suffix.slice(-6)}`],
    )).rows[0].id;
    ids.controlValve = (await database.query(
      `SELECT id FROM field_instrument_definitions WHERE tag_code='2BV' AND is_active=true`,
    )).rows[0].id;
  });

  afterAll(async () => {
    if (ids.book) {
      await database.query('ALTER TABLE design_books DISABLE TRIGGER guard_released_design_book_parent');
      try {
        await database.query(
          `UPDATE design_books SET status='Draft', release_snapshot=NULL WHERE id=$1`,
          [ids.book],
        );
      } finally {
        await database.query('ALTER TABLE design_books ENABLE TRIGGER guard_released_design_book_parent');
      }
      await database.query('DELETE FROM design_books WHERE id=$1', [ids.book]);
    }
    if (ids.optional) await database.query(
      'DELETE FROM field_instrument_definitions WHERE id = ANY($1::uuid[])',
      [[ids.optional, ids.pumpLinked]],
    );
    if (ids.productA) await database.query('DELETE FROM product_masters WHERE id = ANY($1::uuid[])', [[ids.productA, ids.productB]]);
    if (ids.project) await database.query('DELETE FROM projects WHERE id=$1', [ids.project]);
    if (ids.user) {
      await database.query('UPDATE audit_logs SET actor_id=NULL WHERE actor_id=$1', [ids.user]);
      await database.query('DELETE FROM users WHERE id=$1', [ids.user]);
    }
    await database.end();
  });

  async function editableInstruments(optionalQuantity: number) {
    const definitions = (await database.query(
      `SELECT id,requirement_rule FROM field_instrument_definitions WHERE is_active=true`,
    )).rows;
    return definitions.flatMap(definition => {
      if (definition.id === ids.optional) return [{ definition_id: definition.id, quantity: optionalQuantity }];
      if (definition.requirement_rule === 'mandatory') return [{ definition_id: definition.id, quantity: 1, control_logic: 'Integration mandatory interlock' }];
      if (definition.requirement_rule === 'pump_linked') return [{ definition_id: definition.id, quantity: 0 }];
      return [];
    });
  }

  it('serializes concurrent control saves so a tag is allocated once', async () => {
    const instruments = await editableInstruments(1);
    const responses = await Promise.all([
      request('PUT', `/api/v1/systems/${ids.system}/control`, { design_book_id: ids.book, panel_type: 'PLC', instruments }),
      request('PUT', `/api/v1/systems/${ids.system}/control`, { design_book_id: ids.book, panel_type: 'PLC', instruments }),
    ]);
    for (const response of responses) expect(response.status, JSON.stringify(response.body)).toBe(200);
    const rows = await database.query(
      `SELECT tag,sequence_number FROM design_book_lss_instruments
       WHERE design_book_id=$1 AND system_id=$2 AND definition_id=$3`,
      [ids.book, ids.system, ids.optional],
    );
    expect(rows.rows).toEqual([{ tag: expect.stringMatching(/-IT-.*-01$/), sequence_number: 1 }]);
  });

  it('reloads panel and editable imported evidence without replacing historic product snapshots', async () => {
    await database.query(
      `UPDATE field_instrument_definitions SET default_product_master_id=$1,default_control_logic='Read B',
       default_range_max=10,default_unit='kPa',default_calibration_interval_days=180,
       default_calibration_procedure='CAL-B',default_datasheet_reference='DS-B' WHERE id=$2`,
      [ids.productB, ids.optional],
    );
    await database.query(`UPDATE product_masters SET product_name='Product A renamed after import' WHERE id=$1`, [ids.productA]);
    const saved = await request('PUT', `/api/v1/systems/${ids.system}/control`, {
      design_book_id: ids.book, panel_type: 'GPO', instruments: await editableInstruments(2),
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const loaded = await request('GET', `/api/v1/systems/${ids.system}/control?design_book_id=${ids.book}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.control.panel_type).toBe('GPO');
    const imported = loaded.body.instruments.filter((item: any) => item.definition_id === ids.optional);
    expect(imported).toHaveLength(2);
    expect(imported.map((item: any) => item.control_logic)).toEqual(['Read A', 'Read B']);
    expect(imported[0].product_snapshot).toMatchObject({ id: ids.productA, product_name: 'Snapshot product A' });
    expect(imported[1].product_snapshot).toMatchObject({ id: ids.productB, product_name: 'Snapshot product B' });
    expect(imported[0]).toMatchObject({
      range_min: '0', range_max: '6', unit: 'bar', calibration_required: true,
      calibration_interval_days: 365, calibration_procedure: 'CAL-A', datasheet_reference: 'DS-A',
    });
    expect(imported[1]).toMatchObject({
      range_min: '0', range_max: '10', unit: 'kPa', calibration_required: true,
      calibration_interval_days: 180, calibration_procedure: 'CAL-B', datasheet_reference: 'DS-B',
    });
  });

  it('keeps control-valve size-group rows, snapshots, tags, and I/O projections isolated through edits and deletes', async () => {
    await database.query(
      `UPDATE product_masters
       SET product_name=CASE id
         WHEN $1 THEN 'Snapshot product A'
         WHEN $2 THEN 'Snapshot product B'
       END
       WHERE id = ANY($3::uuid[])`,
      [ids.productA, ids.productB, [ids.productA, ids.productB]],
    );
    const instruments = [
      ...await editableInstruments(0),
      {
        definition_id: ids.controlValve,
        group_key: 'supply-dn50',
        nominal_size: 'DN50',
        quantity: 2,
        product_master_id: ids.productA,
      },
      {
        definition_id: ids.controlValve,
        group_key: 'bypass-dn80',
        nominal_size: 'DN80',
        quantity: 1,
        product_master_id: ids.productB,
      },
    ];
    const saved = await request('PUT', `/api/v1/systems/${ids.system}/control`, {
      design_book_id: ids.book,
      panel_type: 'PLC',
      instruments,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const loaded = await request('GET', `/api/v1/systems/${ids.system}/control?design_book_id=${ids.book}`);
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
    const valves = loaded.body.instruments.filter((item: any) => item.definition_id === ids.controlValve);
    expect(valves).toHaveLength(3);

    const supplyGroup = valves.filter((item: any) => item.group_key === 'supply-dn50');
    const bypassGroup = valves.filter((item: any) => item.group_key === 'bypass-dn80');
    expect([...new Set(valves.map((item: any) => item.group_key))].sort())
      .toEqual(['bypass-dn80', 'supply-dn50']);
    expect(supplyGroup).toHaveLength(2);
    expect(bypassGroup).toHaveLength(1);
    expect(supplyGroup).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nominal_size: 'DN50',
        product_master_id: ids.productA,
        product_snapshot: expect.objectContaining({
          id: ids.productA,
          product_code: expect.stringMatching(/^LSS-PROD-A-/),
          product_name: 'Snapshot product A',
        }),
        tag: expect.stringMatching(/-2BV-\d{2}$/),
      }),
    ]));
    expect(bypassGroup).toEqual([
      expect.objectContaining({
        nominal_size: 'DN80',
        product_master_id: ids.productB,
        product_snapshot: expect.objectContaining({
          id: ids.productB,
          product_code: expect.stringMatching(/^LSS-PROD-B-/),
          product_name: 'Snapshot product B',
        }),
        tag: expect.stringMatching(/-2BV-\d{2}$/),
      }),
    ]);
    expect(new Set(valves.map((item: any) => item.tag)).size).toBe(3);

    const schedule = projectLssIoSchedule(
      [{ id: ids.system, system_code: 'LSS-CTRL', system_name: 'Control LSS' }],
      [{ system_id: ids.system, control: loaded.body.control, instruments: valves }],
    );
    expect(schedule).toHaveLength(3);
    expect(schedule.filter(row => row.nominal_size === 'DN50')).toHaveLength(2);
    expect(schedule.filter(row => row.nominal_size === 'DN80')).toHaveLength(1);
    expect(schedule.filter(row => row.nominal_size === 'DN50').map(row => row.assigned_product))
      .toEqual([
        expect.stringMatching(/^LSS-PROD-A-.* — Snapshot product A$/),
        expect.stringMatching(/^LSS-PROD-A-.* — Snapshot product A$/),
      ]);
    expect(schedule.find(row => row.nominal_size === 'DN80')?.assigned_product)
      .toMatch(/^LSS-PROD-B-.* — Snapshot product B$/);
    expect(schedule.map(row => row.tag).sort()).toEqual(valves.map((item: any) => item.tag).sort());

    const bypassRowsBeforeEdit = (await database.query(
      `SELECT * FROM design_book_lss_instruments
        WHERE design_book_id=$1 AND system_id=$2 AND definition_id=$3 AND group_key='bypass-dn80'
        ORDER BY sequence_number,id`,
      [ids.book, ids.system, ids.controlValve],
    )).rows;
    const bypassScheduleBeforeEdit = projectLssIoSchedule(
      [{ id: ids.system, system_code: 'LSS-CTRL', system_name: 'Control LSS' }],
      [{ system_id: ids.system, control: loaded.body.control, instruments: bypassGroup }],
    );

    const edited = await request('PUT', `/api/v1/systems/${ids.system}/control`, {
      design_book_id: ids.book,
      panel_type: 'PLC',
      instruments: [
        ...await editableInstruments(0),
        {
          definition_id: ids.controlValve,
          group_key: 'supply-dn50',
          nominal_size: 'DN50',
          quantity: 3,
          product_master_id: ids.productB,
        },
        {
          definition_id: ids.controlValve,
          group_key: 'bypass-dn80',
          nominal_size: 'DN80',
          quantity: 1,
        },
      ],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);

    const valvesAfterEdit = edited.body.instruments.filter((item: any) => item.definition_id === ids.controlValve);
    const supplyAfterEdit = valvesAfterEdit.filter((item: any) => item.group_key === 'supply-dn50');
    expect(supplyAfterEdit).toHaveLength(3);
    expect(supplyAfterEdit.every((item: any) =>
      item.product_master_id === ids.productB
      && item.product_snapshot?.id === ids.productB
      && item.product_snapshot?.product_name === 'Snapshot product B')).toBe(true);
    const bypassRowsAfterEdit = (await database.query(
      `SELECT * FROM design_book_lss_instruments
        WHERE design_book_id=$1 AND system_id=$2 AND definition_id=$3 AND group_key='bypass-dn80'
        ORDER BY sequence_number,id`,
      [ids.book, ids.system, ids.controlValve],
    )).rows;
    expect(bypassRowsAfterEdit).toEqual(bypassRowsBeforeEdit);

    const deleted = await request('PUT', `/api/v1/systems/${ids.system}/control`, {
      design_book_id: ids.book,
      panel_type: 'PLC',
      instruments: [
        ...await editableInstruments(0),
        {
          definition_id: ids.controlValve,
          group_key: 'bypass-dn80',
          nominal_size: 'DN80',
          quantity: 1,
        },
      ],
    });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);

    const remainingValveRows = (await database.query(
      `SELECT * FROM design_book_lss_instruments
        WHERE design_book_id=$1 AND system_id=$2 AND definition_id=$3
        ORDER BY sequence_number,id`,
      [ids.book, ids.system, ids.controlValve],
    )).rows;
    expect(remainingValveRows).toEqual(bypassRowsBeforeEdit);
    const remainingValves = deleted.body.instruments.filter((item: any) => item.definition_id === ids.controlValve);
    expect(projectLssIoSchedule(
      [{ id: ids.system, system_code: 'LSS-CTRL', system_name: 'Control LSS' }],
      [{ system_id: ids.system, control: deleted.body.control, instruments: remainingValves }],
    )).toEqual(bypassScheduleBeforeEdit);
  });

  it('reconciles pump-driven FS evidence and creates none when no pumps are configured', async () => {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await reconcilePumpLinkedInstruments(client.query.bind(client), {
        projectId: ids.project, systemId: ids.system, systemCode: `LSS-${ids.system}`, userId: ids.user,
      });
      expect((await client.query(
        'SELECT id FROM design_book_lss_instruments WHERE design_book_id=$1 AND definition_id=$2', [ids.book, ids.pumpLinked],
      )).rows).toHaveLength(0);
      ids.pump = (await client.query(
        `INSERT INTO project_equipment_items(equip_code,project_id,system_id,description)
         VALUES($1,$2,$3,'Integration pump') RETURNING id`,
        [`PUMP-${ids.system.slice(0, 6)}`, ids.project, ids.system],
      )).rows[0].id;
      await client.query(
        `INSERT INTO system_pump_selections
         (system_id,circuit_key,project_equipment_item_id,source_fingerprint,calculation_version,result_snapshot,pump_role,pump_quantity)
         VALUES($1,'integration-circuit',$2,'integration','test','{}'::jsonb,'primary',2)`,
        [ids.system, ids.pump],
      );
      await reconcilePumpLinkedInstruments(client.query.bind(client), {
        projectId: ids.project, systemId: ids.system, systemCode: `LSS-${ids.system}`, userId: ids.user,
      });
      const switches = await client.query(
        `SELECT sequence_number,control_logic FROM design_book_lss_instruments
         WHERE design_book_id=$1 AND definition_id=$2 ORDER BY sequence_number`, [ids.book, ids.pumpLinked],
      );
      expect(switches.rows).toEqual([
        { sequence_number: 1, control_logic: 'Prove integration pump flow' },
        { sequence_number: 2, control_logic: 'Prove integration pump flow' },
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('reads release evidence instead of mutable live control rows', async () => {
    await database.query(
      `UPDATE design_books SET status='Released',release_snapshot=$1::jsonb WHERE id=$2`,
      [JSON.stringify({
        systems: [{
          id: ids.system, system_code: `LSS-${ids.system}`, system_name: 'Control LSS',
          system_type: 'Life Support System', water_type: 'Freshwater', status: 'Draft',
        }],
        lss_controls: [{ system_id: ids.system, control: { system_id: ids.system, panel_type: 'PLC' } }],
        lss_instrument_instances: [{
          system_id: ids.system, definition_id: ids.optional, tag: 'FROZEN-IT-01',
          control_logic: 'Frozen logic', product_snapshot: { id: ids.productA, product_name: 'Frozen product evidence' },
          definition_snapshot: { id: ids.optional, tag_code: 'IT', sort_order: 1 },
        }],
      }), ids.book],
    );
    const response = await request('GET', `/api/v1/systems/${ids.system}/control?design_book_id=${ids.book}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      frozen: true, control: { panel_type: 'PLC' },
      instruments: [{ tag: 'FROZEN-IT-01', control_logic: 'Frozen logic', product_snapshot: { product_name: 'Frozen product evidence' } }],
    });
    await expect(database.query(
      `UPDATE design_book_lss_instruments SET datasheet_reference='tampered'
       WHERE design_book_id=$1`,
      [ids.book],
    )).rejects.toMatchObject({ code: '55000' });
    await expect(database.query(
      `UPDATE design_book_lss_controls SET panel_type='PLC'
       WHERE design_book_id=$1`,
      [ids.book],
    )).rejects.toMatchObject({ code: '55000' });
  });
});