// @vitest-environment node
import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const secret = 'pump-selection-route-test';
const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  book: { id: 'book-1', project_id: 'project-1', status: 'Draft' } as any,
  system: {
    id: 'system-1', project_id: 'project-1', design_flow_m3h: '100', calculation_inputs: { design_flow_source: 'manual_override' },
    loop1_name: 'Main return', loop1_flow_source: 'Bottom Drain', loop1_filtration: 'Sand Filter', loop1_flow_pct: '60',
  } as any,
  sideStreams: [{ id: 'side-1', system_id: 'system-1', parent_loop_number: 1, name: 'UV branch', preset: 'UV', flow_pct: '25', sort_order: 0 }] as any[],
  fractionatorAllocations: [] as any[],
  saved: [] as any[],
  candidates: [{ id: 'pump-item-1', project_equipment_item_id: 'pump-item-1', equip_code: 'P-101', product_master_id: 'pump-1', product_code: 'PUMP-101', product_name: 'Duty Pump', power_kw: '3' }],
  exhibits: [] as any[], tanks: [] as any[], hydraulics: [] as any[], links: [] as any[],
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.startsWith('SELECT * FROM design_books') || sql.includes('FROM design_books db')) return { rows: [state.book] };
    if (sql.startsWith('SELECT * FROM systems')) return { rows: (params[0] === 'system-1' || params[0] === 'project-1') ? [state.system] : [] };
    if (sql.includes('FROM exhibits')) return { rows: state.exhibits };
    if (sql.includes('FROM tanks')) return { rows: state.tanks };
    if (sql.includes('FROM design_book_exhibit_hydraulics')) return { rows: state.hydraulics };
    if (sql.includes('FROM system_exhibit_links')) return { rows: state.links };
    if (sql.includes('FROM system_flow_side_streams')) return { rows: state.sideStreams };
    if (sql.includes('FROM system_flow_fractionator_allocations')) return { rows: state.fractionatorAllocations };
    if (sql.includes('FROM system_pump_selections')) return { rows: state.saved };
    if (sql.startsWith('SELECT id FROM project_equipment_items')) return { rows: [] };
    if (sql.includes('SELECT equip_code FROM project_equipment_items')) return { rows: [] };
    if (sql.includes('FROM project_equipment_items')) return { rows: state.candidates };
    if (sql.includes('INSERT INTO project_equipment_items')) {
      const created = {
        id: 'created-pump-1', project_equipment_item_id: 'created-pump-1',
        equip_code: params[0], project_id: params[1], system_id: params[2],
        description: params[3], quantity: 1, unit: 'EA', status: 'Design',
      };
      state.candidates.push(created as any);
      return { rows: [created] };
    }
    if (sql.includes('INSERT INTO system_pump_selections')) {
      const saved = {
        system_id: params[0], circuit_key: params[1], project_equipment_item_id: params[2],
        design_head_m: params[3] == null ? null : String(params[3]),
        pump_efficiency_pct: params[4] == null ? null : String(params[4]),
        motor_efficiency_pct: params[5] == null ? null : String(params[5]),
        source_fingerprint: params[6], pump_snapshot: JSON.parse(params[7]), calculation_version: params[8],
        result_snapshot: JSON.parse(params[9]), pump_role: params[11], venturi_flow_m3h: params[12],
      };
      state.saved = state.saved.filter(row =>
        !(row.system_id === saved.system_id && row.circuit_key === saved.circuit_key &&
          (row.pump_role || 'primary') === (saved.pump_role || 'primary')));
      state.saved.push(saved);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return {
    default: {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    },
    query,
  };
});

function request(app: Express, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const token = jwt.sign({ id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' }, secret);
      const req = http.request({ host: '127.0.0.1', port: (server.address() as any).port, method, path,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }) } }, res => {
        let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => server.close(error =>
          error ? reject(error) : resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : {} })));
      });
      req.on('error', reject); if (payload) req.write(payload); req.end();
    });
  });
}

describe('pump selection HTTP routes', () => {
  let app: Express;
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const { default: routes } = await import('./pumpSelections');
    app = express(); app.use(express.json()); app.use('/api/v1', routes);
  });
  beforeEach(() => {
    state.calls.length = 0; state.book = { id: 'book-1', project_id: 'project-1', status: 'Draft' };
    state.saved = []; state.candidates = [{ id: 'pump-item-1', project_equipment_item_id: 'pump-item-1', equip_code: 'P-101', product_master_id: 'pump-1', product_code: 'PUMP-101', product_name: 'Duty Pump', power_kw: '3' }];
    state.fractionatorAllocations = [];
    state.exhibits = []; state.tanks = []; state.hydraulics = []; state.links = [];
    state.system.calculation_inputs = { design_flow_source: 'manual_override' }; state.system.design_flow_m3h = '100';
    state.system.loop1_name = 'Main return';
    state.system.loop1_flow_source = 'Bottom Drain';
    state.system.loop1_filtration = 'Sand Filter';
    state.system.loop1_flow_pct = '60';
  });
  afterAll(() => { delete process.env.JWT_SECRET; });

  it('derives stable main and side-stream circuit keys and flows, scoped candidates', async () => {
    const response = await request(app, 'GET', '/api/v1/systems/system-1/pump-selections?design_book_id=book-1');
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ circuit_key: 'loop:1', circuit_kind: 'loop', flow_m3h: 60 }),
      expect.objectContaining({ circuit_key: 'side_stream:side-1', circuit_kind: 'side_stream', flow_m3h: 15 }),
    ]));
    expect(response.body.pump_candidates[0]).toMatchObject({ id: 'pump-item-1', project_equipment_item_id: 'pump-item-1', power_kw: '3' });
    const candidateCall = state.calls.find(call => call.sql.includes('FROM project_equipment_items'));
    expect(candidateCall?.params).toEqual(['project-1', 'system-1']);
  });

  it('excludes side streams explicitly marked as not having a dedicated pump', async () => {
    state.sideStreams = [{
      id: 'side-1', system_id: 'system-1', parent_loop_number: 1,
      name: 'UV branch', preset: 'UV', flow_pct: '25', sort_order: 0,
      has_dedicated_pump: false,
    }];
    const response = await request(app, 'GET', '/api/v1/systems/system-1/pump-selections?design_book_id=book-1');
    expect(response.status).toBe(200);
    expect(response.body.items.map((item: any) => item.circuit_key)).not.toContain('side_stream:side-1');
    expect(response.body.items.map((item: any) => item.circuit_key)).toContain('loop:1');
  });

  it('rejects a pump not returned by the eligible candidate query', async () => {
    const response = await request(app, 'PUT', '/api/v1/systems/system-1/pump-selections', {
      design_book_id: 'book-1', circuit_key: 'loop:1', project_equipment_item_id: 'other-system-pump',
      design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INELIGIBLE_PUMP');
    expect(state.calls.some(call => call.sql.includes('INSERT INTO system_pump_selections'))).toBe(false);
  });

  it('uses the Design Book calculated linked-exhibit flow rather than raw stored system flow', async () => {
    state.system.calculation_inputs = { design_flow_source: 'linked_exhibits', turnover_source: 'primary_exhibit' };
    state.system.design_flow_m3h = '1000';
    state.exhibits = [{ id: 'ex-1', project_id: 'project-1', water_type: 'Marine' }];
    state.tanks = [{ id: 'tank-1', exhibit_id: 'ex-1', operating_volume_m3: 20, eff_shape: 'custom' }];
    state.hydraulics = [{ exhibit_id: 'ex-1', target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 }];
    state.links = [{ id: 'link-1', system_id: 'system-1', exhibit_id: 'ex-1', exhibit_code: 'EX-1', link_type: 'Primary' }];
    const response = await request(app, 'GET', '/api/v1/systems/system-1/pump-selections?design_book_id=book-1');
    expect(response.status).toBe(200);
    // 20 m³ × 2/h = 40 m³/h resolved Design Book system flow; loop is 60%.
    expect(response.body.items.find((item: any) => item.circuit_key === 'loop:1').flow_m3h).toBe(24);
  });

  it('persists an eligible same-system pump and returns ready sizing', async () => {
    const response = await request(app, 'PUT', '/api/v1/systems/system-1/pump-selections', {
      design_book_id: 'book-1', circuit_key: 'loop:1', project_equipment_item_id: 'pump-item-1',
      design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ circuit_key: 'loop:1', status: 'ready', freshness: 'fresh', project_equipment_item_id: 'pump-item-1' });
    expect(response.body.results.recommended_motor_kw).toBe(3);
    const insert = state.calls.find(call => call.sql.includes('INSERT INTO system_pump_selections'));
    expect(insert?.params.slice(0, 3)).toEqual(['system-1', 'loop:1', 'pump-item-1']);
  });

  it('persists an eligible underpowered pump but returns it as incompatible', async () => {
    state.candidates[0].power_kw = '1.1';
    const response = await request(app, 'PUT', '/api/v1/systems/system-1/pump-selections', {
      design_book_id: 'book-1', circuit_key: 'loop:1', project_equipment_item_id: 'pump-item-1',
      design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90,
    });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('incompatible');
    expect(response.body.reasons.join(' ')).toContain('catalog power is 1.1 kW');
    expect(state.calls.some(call => call.sql.includes('INSERT INTO system_pump_selections'))).toBe(true);
  });

  it('creates and immediately allocates an FFSP project pump to the current project and LSS', async () => {
    state.system.design_flow_m3h = '224.15';
    state.system.loop1_flow_pct = '100';
    state.system.loop1_filtration = 'Foam Fractionation';
    state.system.loop1_name = 'Foam Fractionator Loop';
    state.candidates = [];

    const response = await request(app, 'POST', '/api/v1/systems/system-1/pump-lines', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'primary',
      equip_code: 'FFSP-001',
      description: 'FFSP — Foam Fractionator Supply Pump',
    });

    expect(response.status).toBe(201);
    expect(response.body.project_equipment_item).toMatchObject({
      id: 'created-pump-1',
      project_id: 'project-1',
      system_id: 'system-1',
      equip_code: 'FFSP-001',
      description: 'FFSP — Foam Fractionator Supply Pump',
    });
    expect(response.body.pump_line).toMatchObject({
      circuit_key: 'loop:1',
      pump_role: 'primary',
      project_equipment_item_id: 'created-pump-1',
      effective_flow_m3h: 224.15,
      status: 'incomplete',
    });
    expect(state.calls.some(call => call.sql === 'BEGIN')).toBe(true);
    expect(state.calls.some(call => call.sql === 'COMMIT')).toBe(true);
  });

  it('creates the first FFVP line from its active FFSP circuit', async () => {
    state.system.design_flow_m3h = '224.15';
    state.system.loop1_flow_pct = '100';
    state.system.loop1_filtration = 'Foam Fractionation';
    state.system.loop1_name = 'Foam Fractionator Loop';
    state.candidates = [];
    state.fractionatorAllocations = [{
      system_id: 'system-1',
      parent_loop_number: 1,
      products: [{ product_master_id: 'ff-1', quantity: 2, venturi_flow_m3h: 21.25 }],
    }];

    const response = await request(app, 'POST', '/api/v1/systems/system-1/pump-lines', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'venturi',
      equip_code: 'FFVP-001',
      description: 'FFVP — Foam Fractionator Venturi Pump',
    });

    expect(response.status).toBe(201);
    expect(response.body.project_equipment_item).toMatchObject({
      id: 'created-pump-1',
      equip_code: 'FFVP-001',
      description: 'FFVP — Foam Fractionator Venturi Pump',
    });
    expect(response.body.pump_line).toMatchObject({
      circuit_key: 'loop:1',
      pump_role: 'venturi',
      pump_role_name: 'FFVP — Foam Fractionator Venturi Pump',
      effective_flow_m3h: 42.5,
      status: 'incomplete',
    });
    expect(state.calls.some(call => call.sql.includes('INSERT INTO system_pump_selections'))).toBe(true);
  });

  it('seeds and persists first FFVP duty from authoritative FFSP demand when products have no venturi hydraulics', async () => {
    state.system.design_flow_m3h = '224.15';
    state.system.loop1_flow_pct = '100';
    state.system.loop1_filtration = 'Foam Fractionation';
    state.system.loop1_name = 'Foam Fractionator Loop';
    state.fractionatorAllocations = [{
      system_id: 'system-1',
      parent_loop_number: 1,
      products: [{ product_master_id: 'ff-1', quantity: 2, venturi_flow_m3h: null }],
    }];
    state.candidates = [];

    const response = await request(app, 'POST', '/api/v1/systems/system-1/pump-lines', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'venturi',
    });

    expect(response.status).toBe(201);
    expect(response.body.project_equipment_item).toMatchObject({
      equip_code: 'FFVP-001',
      description: 'FFVP — Foam Fractionator Venturi Pump',
    });
    expect(response.body.pump_line).toMatchObject({
      pump_role: 'venturi',
      venturi_flow_m3h: 224.15,
      effective_flow_m3h: 224.15,
    });
    const insert = state.calls.find(call => call.sql.includes('INSERT INTO system_pump_selections'));
    expect(insert?.params[12]).toBe(224.15);
  });

  it('creates Sand Filter supply equipment with the SFSP convention', async () => {
    state.system.design_flow_m3h = '100';
    state.system.loop1_flow_pct = '100';
    state.system.loop1_filtration = 'Sand Filter';
    state.system.loop1_name = 'Sand Filter Loop';
    state.candidates = [];

    const response = await request(app, 'POST', '/api/v1/systems/system-1/pump-lines', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'primary',
    });

    expect(response.status).toBe(201);
    expect(response.body.project_equipment_item).toMatchObject({
      equip_code: 'SFSP-001',
      description: 'SFSP — Sand Filter Supply Pump',
    });
    expect(response.body.pump_line.pump_role_name).toBe('SFSP — Sand Filter Supply Pump');
  });

  it('treats a repeated create request as idempotent without creating another equipment item', async () => {
    state.candidates = [];
    const body = {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'primary',
    };
    expect((await request(app, 'POST', '/api/v1/systems/system-1/pump-lines', body)).status).toBe(201);
    const repeated = await request(app, 'POST', '/api/v1/systems/system-1/pump-lines', body);
    expect(repeated.status).toBe(200);
    expect(repeated.body.idempotent).toBe(true);
    expect(state.calls.filter(call => call.sql.includes('INSERT INTO project_equipment_items'))).toHaveLength(1);
  });

  it('refuses to create equipment for an orphaned no-pump side-stream duty', async () => {
    state.sideStreams = [{
      id: 'side-1', system_id: 'system-1', parent_loop_number: 1,
      name: 'UV branch', preset: 'UV', flow_pct: '25', sort_order: 0,
      has_dedicated_pump: false,
    }];
    state.saved = [{
      system_id: 'system-1',
      circuit_key: 'side_stream:side-1',
      pump_role: 'primary',
      project_equipment_item_id: null,
      pump_snapshot: null,
      result_snapshot: { status: 'incomplete' },
    }];

    const response = await request(app, 'POST', '/api/v1/systems/system-1/pump-lines', {
      design_book_id: 'book-1',
      circuit_key: 'side_stream:side-1',
      pump_role: 'primary',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INACTIVE_PUMP_DUTY');
    expect(state.calls.some(call => call.sql.includes('INSERT INTO project_equipment_items'))).toBe(false);
  });

  it('requires a distinct positive venturi duty flow before FFVP sizing', async () => {
    state.system.design_flow_m3h = '224.15';
    state.system.loop1_flow_pct = '100';
    state.system.loop1_filtration = 'Foam Fractionation';
    state.saved = [{
      system_id: 'system-1', circuit_key: 'loop:1', pump_role: 'venturi',
      project_equipment_item_id: 'pump-item-1', pump_snapshot: state.candidates[0],
      venturi_flow_m3h: null,
    }];

    const response = await request(app, 'PUT', '/api/v1/systems/system-1/pump-selections', {
      design_book_id: 'book-1', circuit_key: 'loop:1', pump_role: 'venturi',
      project_equipment_item_id: 'pump-item-1',
      design_head_m: 8, pump_efficiency_pct: 75, motor_efficiency_pct: 90,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('Venturi duty flow is required');
  });

  it('persists primary and venturi roles independently on one FF circuit', async () => {
    state.system.design_flow_m3h = '224.15';
    state.system.loop1_flow_pct = '100';
    state.system.loop1_filtration = 'Foam Fractionation';
    state.saved = [{
      system_id: 'system-1', circuit_key: 'loop:1', pump_role: 'primary',
      project_equipment_item_id: 'pump-item-1', pump_snapshot: state.candidates[0],
      design_head_m: '10', pump_efficiency_pct: '80', motor_efficiency_pct: '90',
      source_fingerprint: 'legacy', calculation_version: 'pump-selection-v1',
    }, {
      system_id: 'system-1', circuit_key: 'loop:1', pump_role: 'venturi',
      project_equipment_item_id: 'pump-item-1', pump_snapshot: state.candidates[0],
      design_head_m: null, pump_efficiency_pct: null, motor_efficiency_pct: null,
      venturi_flow_m3h: null, source_fingerprint: 'legacy',
      calculation_version: 'pump-selection-v1',
    }];

    const response = await request(app, 'PUT', '/api/v1/systems/system-1/pump-selections', {
      design_book_id: 'book-1', circuit_key: 'loop:1', pump_role: 'venturi',
      project_equipment_item_id: 'pump-item-1', venturi_flow_m3h: 42.5,
      design_head_m: 8, pump_efficiency_pct: 75, motor_efficiency_pct: 90,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      pump_role: 'venturi',
      effective_flow_m3h: 42.5,
      project_equipment_item_id: 'pump-item-1',
    });
    expect(state.saved).toHaveLength(2);
    const insert = state.calls.find(call => call.sql.includes('ON CONFLICT (system_id,circuit_key,pump_role)'));
    expect(insert?.params[11]).toBe('venturi');
    expect(insert?.params[12]).toBe(42.5);
  });

  it('rejects changes to a non-editable Design Book', async () => {
    state.book.status = 'For Review';
    const response = await request(app, 'PUT', '/api/v1/systems/system-1/pump-selections', {
      design_book_id: 'book-1', circuit_key: 'loop:1', project_equipment_item_id: 'pump-item-1',
      design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90,
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DESIGN_BOOK_NOT_EDITABLE');
  });

  it('marks an old calculation version stale and retains its persisted result evidence', async () => {
    state.saved = [{
      system_id: 'system-1', circuit_key: 'loop:1', project_equipment_item_id: 'pump-item-1',
      design_head_m: '10', pump_efficiency_pct: '80', motor_efficiency_pct: '90', source_fingerprint: 'current-does-not-matter',
      calculation_version: 'pump-selection-v0', pump_snapshot: state.candidates[0],
      result_snapshot: { results: { hydraulic_power_kw: 9.99, shaft_power_kw: 10, motor_input_kw: 11, recommended_motor_kw: 15 } },
    }];
    const response = await request(app, 'GET', '/api/v1/systems/system-1/pump-selections?design_book_id=book-1');
    const item = response.body.items.find((value: any) => value.circuit_key === 'loop:1');
    expect(item).toMatchObject({ status: 'stale', freshness: 'stale', calculation_version: 'pump-selection-v0' });
    expect(item.reasons.join(' ')).toContain('outdated');
    expect(item.results.hydraulic_power_kw).toBe(9.99);
  });

  it.each([
    ['For Review', 'review_snapshot'], ['Released', 'release_snapshot'],
  ])('serves %s snapshot selections as frozen', async (status, snapshotField) => {
    state.book = { id: 'book-1', project_id: 'project-1', status, [snapshotField]: { pump_selections: [{ system_id: 'system-1', items: [{ circuit_key: 'loop:1', circuit_name: 'Frozen pump', status: 'ready' }] }] } };
    const response = await request(app, 'GET', '/api/v1/systems/system-1/pump-selections?design_book_id=book-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [{ circuit_key: 'loop:1', circuit_name: 'Frozen pump', status: 'ready' }], pump_candidates: [], frozen: true });
  });
});