"use strict";
// @vitest-environment node
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const testSecret = 'flow-route-allocation-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    currentSystem: {
        id: 'system-1',
        project_id: 'project-1',
        water_type: 'Freshwater',
        loop1_flow_pct: '40',
        loop1_bio_degas_pct: '25',
        loop2_flow_pct: null,
        loop2_bio_degas_pct: null,
        loop3_flow_pct: null,
        loop3_bio_degas_pct: null,
        loop1_filtration: 'Sand Filter',
        loop2_filtration: 'Pressurized Bag Filter',
        loop3_filtration: null,
        design_flow_m3h: '100',
    },
    fractionatorCatalog: [],
    sandFilterCatalog: [],
    sandFilterAllocations: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level')) {
            return { rows: [{ access_level: 'manage' }] };
        }
        if (sql.includes('SELECT * FROM systems WHERE id=$1')) {
            return { rows: [{ ...state.currentSystem }] };
        }
        if (sql.includes('FROM system_flow_side_streams')) {
            return { rows: [] };
        }
        if (sql.includes("pf.product_family_code='PFM-FF'")) {
            return { rows: state.fractionatorCatalog };
        }
        if (sql.includes("pf.product_family_code='PFM-SF'")) {
            return { rows: state.sandFilterCatalog };
        }
        if (sql.includes('FROM system_flow_fractionator_allocations')) {
            return { rows: [] };
        }
        if (sql.includes('FROM system_flow_sand_filter_allocations')) {
            return { rows: state.sandFilterAllocations };
        }
        if (sql.includes('SELECT DISTINCT water_type FROM exhibits')) {
            return { rows: [] };
        }
        if (sql.includes('UPDATE systems SET')) {
            return { rows: [{ ...state.currentSystem, id: params[31] }] };
        }
        return { rows: [] };
    });
    return {
        default: {
            connect: vitest_1.vi.fn(async () => ({
                query,
                release: vitest_1.vi.fn(),
            })),
        },
        query,
    };
});
vitest_1.vi.mock('../db/audit', () => ({
    logAudit: vitest_1.vi.fn(async () => undefined),
}));
function request(app, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const token = jsonwebtoken_1.default.sign({ id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' }, testSecret);
            const payload = JSON.stringify(body);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'PUT',
                path: '/api/v1/systems/system-1',
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
                        if (error)
                            return reject(error);
                        resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
                    });
                });
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    });
}
const basePayload = {
    system_code: 'LSS-01',
    system_name: 'Primary Life Support',
    system_type: 'Life Support',
    design_flow_m3h: 100,
    turnover_rate_hr: 2,
    water_type: 'Freshwater',
    status: 'Draft',
    loop1_flow_source: 'Bottom Drain',
    loop1_filtration: 'Sand Filter',
    loop1_bio_degas_m3h: 12,
    loop1_link_bio_degas: true,
    loop2_flow_source: 'Surface Skim',
    loop2_filtration: 'Pressurized Bag Filter',
    loop2_bio_degas_m3h: null,
    loop2_link_bio_degas: false,
    loop3_flow_source: null,
    loop3_filtration: null,
    loop3_bio_degas_m3h: null,
    loop3_link_bio_degas: false,
};
(0, vitest_1.describe)('system Flow Route allocation persistence', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: projectRoutes } = await Promise.resolve().then(() => __importStar(require('./projects')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', projectRoutes);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.currentSystem.loop1_flow_pct = '40';
        state.currentSystem.loop1_bio_degas_pct = '25';
        state.currentSystem.loop2_flow_pct = null;
        state.currentSystem.loop2_bio_degas_pct = null;
        state.currentSystem.loop1_filtration = 'Sand Filter';
        state.currentSystem.system_config = 'bespoke';
        state.currentSystem.compact_unit_id = null;
        state.fractionatorCatalog = [];
        state.sandFilterCatalog = [];
        state.sandFilterAllocations = [];
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('rejects active loop allocation totals above 100 percent', async () => {
        const response = await request(app, {
            ...basePayload,
            loop1_flow_pct: 60,
            loop1_bio_degas_pct: 25,
            loop2_flow_pct: 50,
            loop2_bio_degas_pct: null,
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('FLOW_ALLOCATION_EXCEEDS_100');
        (0, vitest_1.expect)(response.body.error.message).toContain('110.0%');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE systems SET'))).toBe(false);
    });
    (0, vitest_1.it)('persists nullable loop and branch percentages independently', async () => {
        const response = await request(app, {
            ...basePayload,
            loop1_flow_pct: 55,
            loop1_bio_degas_pct: null,
            loop2_flow_pct: 45,
            loop2_bio_degas_pct: 30,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const update = state.calls.find(call => call.sql.includes('UPDATE systems SET'));
        (0, vitest_1.expect)(update?.params[11]).toBe(55);
        (0, vitest_1.expect)(update?.params[12]).toBeNull();
        (0, vitest_1.expect)(update?.params[17]).toBe(45);
        (0, vitest_1.expect)(update?.params[18]).toBe(30);
    });
    (0, vitest_1.it)('preserves reviewed percentages when an older client omits the new fields', async () => {
        const response = await request(app, basePayload);
        (0, vitest_1.expect)(response.status).toBe(200);
        const update = state.calls.find(call => call.sql.includes('UPDATE systems SET'));
        (0, vitest_1.expect)(update?.params[11]).toBe(40);
        (0, vitest_1.expect)(update?.params[12]).toBe(25);
    });
    (0, vitest_1.it)('persists Foam Fractionator snapshots and status against the parent loop', async () => {
        state.fractionatorCatalog = [{
                id: '11111111-1111-4111-8111-111111111111',
                product_code: 'PM-FF-800',
                product_name: 'Foam Fractionator FF-800',
                diameter_mm: '800',
            }];
        const response = await request(app, {
            ...basePayload,
            water_type: 'Marine',
            loop1_filtration: 'Foam Fractionation',
            loop1_flow_pct: 36,
            fractionator_allocations: [{
                    parent_loop_number: 1,
                    process_rate_ls_m2: 20,
                    notes: 'Duty allocation',
                    products: [{
                            product_master_id: '11111111-1111-4111-8111-111111111111',
                            quantity: 2,
                        }],
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const insert = state.calls.find(call => call.sql.includes('INSERT INTO system_flow_fractionator_allocations'));
        (0, vitest_1.expect)(insert?.params[1]).toBe(1);
        (0, vitest_1.expect)(insert?.params[2]).toBe(20);
        (0, vitest_1.expect)(JSON.parse(insert?.params[4])).toEqual([vitest_1.expect.objectContaining({
                product_code: 'PM-FF-800',
                diameter_mm: 800,
                quantity: 2,
            })]);
        (0, vitest_1.expect)(['matched', 'required_above_capacity', 'capacity_above_required'])
            .toContain(insert?.params[5]);
    });
    (0, vitest_1.it)('rejects products outside the Foam Fractionator family', async () => {
        const response = await request(app, {
            ...basePayload,
            water_type: 'Marine',
            loop1_filtration: 'Foam Fractionation',
            loop1_flow_pct: 50,
            fractionator_allocations: [{
                    parent_loop_number: 1,
                    process_rate_ls_m2: 20,
                    products: [{
                            product_master_id: '22222222-2222-4222-8222-222222222222',
                            quantity: 1,
                        }],
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.message).toContain('not a Foam Fractionator');
    });
    (0, vitest_1.it)('rejects Foam Fractionation on freshwater systems through the API', async () => {
        const response = await request(app, {
            ...basePayload,
            loop1_filtration: 'Foam Fractionation',
            loop1_flow_pct: 50,
            fractionator_allocations: [],
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.message).toContain('only available for Marine or Salt Water');
    });
    (0, vitest_1.it)('persists active AAT Sand Filter identity and diameter snapshots', async () => {
        state.sandFilterCatalog = [{
                id: '33333333-3333-4333-8333-333333333333',
                product_code: 'PM-SF-900',
                product_name: 'AAT Sand Filter 900',
                status: 'Active',
                standard_status: 'Active',
                diameter_mm: '900',
            }];
        const response = await request(app, {
            ...basePayload,
            loop1_flow_pct: 40,
            sand_filter_allocations: [{
                    parent_loop_number: 1,
                    process_rate_ls_m2: 6,
                    notes: 'Main filter bank',
                    products: [{
                            product_master_id: '33333333-3333-4333-8333-333333333333',
                            quantity: 2,
                        }],
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const insert = state.calls.find(call => call.sql.includes('INSERT INTO system_flow_sand_filter_allocations'));
        (0, vitest_1.expect)(insert?.params[2]).toBe(6);
        (0, vitest_1.expect)(JSON.parse(insert?.params[4])).toEqual([{
                product_master_id: '33333333-3333-4333-8333-333333333333',
                product_code: 'PM-SF-900',
                product_name: 'AAT Sand Filter 900',
                diameter_mm: 900,
                quantity: 2,
            }]);
        (0, vitest_1.expect)(['matched', 'required_above_capacity', 'capacity_above_required'])
            .toContain(insert?.params[5]);
    });
    (0, vitest_1.it)('retains an existing Sand Filter snapshot when PIM values later change', async () => {
        const productId = '33333333-3333-4333-8333-333333333333';
        state.sandFilterAllocations = [{
                parent_loop_number: 1,
                products: [{
                        product_master_id: productId,
                        product_code: 'PM-SF-900',
                        product_name: 'AAT Sand Filter 900',
                        diameter_mm: 900,
                        quantity: 1,
                    }],
            }];
        state.sandFilterCatalog = [{
                id: productId,
                product_code: 'PM-SF-1000-RENAMED',
                product_name: 'Renamed Sand Filter',
                status: 'Inactive',
                standard_status: 'Obsolete',
                diameter_mm: '1000',
            }];
        const response = await request(app, {
            ...basePayload,
            sand_filter_allocations: [{
                    parent_loop_number: 1,
                    process_rate_ls_m2: 6,
                    notes: 'Unrelated note edit',
                    products: [{ product_master_id: productId, quantity: 3 }],
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const insert = state.calls.find(call => call.sql.includes('INSERT INTO system_flow_sand_filter_allocations'));
        (0, vitest_1.expect)(JSON.parse(insert?.params[4])).toEqual([vitest_1.expect.objectContaining({
                product_code: 'PM-SF-900',
                product_name: 'AAT Sand Filter 900',
                diameter_mm: 900,
                quantity: 3,
            })]);
    });
    (0, vitest_1.it)('rejects a newly selected Sand Filter that is not active and approved', async () => {
        state.sandFilterCatalog = [{
                id: '33333333-3333-4333-8333-333333333333',
                product_code: 'PM-SF-900',
                product_name: 'AAT Sand Filter 900',
                status: 'Inactive',
                standard_status: 'Obsolete',
                diameter_mm: '900',
            }];
        const response = await request(app, {
            ...basePayload,
            sand_filter_allocations: [{
                    parent_loop_number: 1,
                    process_rate_ls_m2: 6,
                    products: [{
                            product_master_id: '33333333-3333-4333-8333-333333333333',
                            quantity: 1,
                        }],
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.message).toContain('not an active AAT Sand Filter');
    });
    (0, vitest_1.it)('rejects individual percentages outside the allowed range', async () => {
        const response = await request(app, {
            ...basePayload,
            loop1_flow_pct: 40,
            loop1_bio_degas_pct: 101,
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error).toEqual({
            code: 'VALIDATION',
            message: 'Loop 1 Bio/Degas allocation must be between 0% and 100%.',
        });
    });
    (0, vitest_1.it)('persists custom loop names and multiple parent-owned side streams', async () => {
        const response = await request(app, {
            ...basePayload,
            loop1_name: 'Main Filtration',
            loop2_name: 'Polishing',
            loop3_name: 'Reserve',
            side_streams: [
                {
                    parent_loop_number: 1,
                    name: 'Thermal',
                    preset: 'Thermal',
                    flow_pct: 25,
                    has_dedicated_pump: true,
                    notes: 'Heat exchanger branch',
                    sort_order: 0,
                },
                {
                    parent_loop_number: 1,
                    name: 'UV Contact',
                    preset: 'UV',
                    flow_pct: 40,
                    has_dedicated_pump: false,
                    notes: null,
                    sort_order: 1,
                },
            ],
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const nameUpdate = state.calls.find(call => call.sql.includes('loop1_name=$2'));
        (0, vitest_1.expect)(nameUpdate?.params.slice(1)).toEqual(['Main Filtration', 'Polishing', 'Reserve']);
        const inserts = state.calls.filter(call => call.sql.includes('INSERT INTO system_flow_side_streams'));
        (0, vitest_1.expect)(inserts).toHaveLength(2);
        (0, vitest_1.expect)(inserts[0].params.slice(1, 6)).toEqual([1, 'Thermal', 'Thermal', 25, 'Heat exchanger branch']);
        (0, vitest_1.expect)(inserts[1].params.slice(1, 6)).toEqual([1, 'UV Contact', 'UV', 40, null]);
        (0, vitest_1.expect)(inserts.map(insert => insert.params[9])).toEqual([true, false]);
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'BEGIN')).toBe(true);
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'COMMIT')).toBe(true);
    });
    (0, vitest_1.it)('persists multiple independent 100 percent side streams under one parent', async () => {
        const response = await request(app, {
            ...basePayload,
            side_streams: [
                { parent_loop_number: 2, name: 'Thermal', preset: 'Thermal', flow_pct: 100 },
                { parent_loop_number: 2, name: 'UV', preset: 'UV', flow_pct: 100 },
            ],
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const inserts = state.calls.filter(call => call.sql.includes('INSERT INTO system_flow_side_streams'));
        (0, vitest_1.expect)(inserts).toHaveLength(2);
        (0, vitest_1.expect)(inserts.map(insert => insert.params[4])).toEqual([100, 100]);
    });
    (0, vitest_1.it)('preserves saved loop names when a partial update omits them', async () => {
        state.currentSystem.loop1_name = 'Main Filtration';
        state.currentSystem.loop2_name = 'Polishing';
        state.currentSystem.loop3_name = 'Reserve';
        const response = await request(app, basePayload);
        (0, vitest_1.expect)(response.status).toBe(200);
        const nameUpdate = state.calls.find(call => call.sql.includes('loop1_name=$2'));
        (0, vitest_1.expect)(nameUpdate?.params.slice(1)).toEqual(['Main Filtration', 'Polishing', 'Reserve']);
    });
    (0, vitest_1.it)('preserves existing system configuration when a standard update omits configuration fields', async () => {
        state.currentSystem.system_config = 'compact';
        state.currentSystem.compact_unit_id = 'compact-unit-1';
        const response = await request(app, basePayload);
        (0, vitest_1.expect)(response.status).toBe(200);
        const systemUpdate = state.calls.find(call => call.sql.includes('system_config=$28, compact_unit_id=$29'));
        (0, vitest_1.expect)(systemUpdate?.params[27]).toBe('compact');
        (0, vitest_1.expect)(systemUpdate?.params[28]).toBe('compact-unit-1');
    });
    vitest_1.it.each([
        ['', 'Loop 1 name is required.'],
        ['x'.repeat(256), 'Loop 1 name must be 255 characters or fewer.'],
    ])('rejects invalid loop names', async (loop1Name, message) => {
        const response = await request(app, { ...basePayload, loop1_name: loop1Name });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error).toEqual({ code: 'VALIDATION', message });
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE systems SET'))).toBe(false);
    });
});
