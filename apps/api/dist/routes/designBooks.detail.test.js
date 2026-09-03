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
const pumpSelections_1 = require("../lib/pumpSelections");
const testSecret = 'design-books-detail-test-secret';
const bookId = '00000000-0000-4000-8000-000000000143';
const projectId = '00000000-0000-4000-8000-000000000144';
const systems = [1, 2, 3].map(index => ({
    id: `00000000-0000-4000-8000-00000000014${index + 4}`,
    project_id: projectId,
    system_code: `LSS-0${index}`,
    system_name: `Life Support ${index}`,
    system_type: index === 1 ? 'Single Exhibit LSS' : 'Life Support',
    status: 'Draft',
    design_flow_m3h: null,
    side_streams: [],
    fractionator_allocations: [],
}));
const sandFilterAllocation = {
    id: '00000000-0000-4000-8000-000000000199',
    system_id: systems[0].id,
    parent_loop_number: 1,
    process_rate_ls_m2: 6,
    notes: 'Reviewed basis',
    products: [{
            product_master_id: '00000000-0000-4000-8000-000000000198',
            product_code: 'SF-1000',
            product_name: 'Approved Sand Filter',
            diameter_mm: 1000,
            quantity: 2,
        }],
    calculation_status: 'capacity_above_required',
};
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    status: 'Draft',
    reviewSnapshot: null,
    releaseSnapshot: null,
    wallConstructionVersion: 'AAT_FOUNDATIONS_WALL_V1.0',
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level')) {
            return { rows: [{ access_level: 'manage' }] };
        }
        if (sql.includes('SELECT db.*, p.project_code') && sql.includes('p.client_name')) {
            return {
                rows: [{
                        id: bookId,
                        project_id: projectId,
                        book_code: 'DB-THERMAL',
                        book_title: 'Thermal response regression',
                        revision: 'A',
                        status: state.status,
                        review_snapshot: state.reviewSnapshot,
                        release_snapshot: state.releaseSnapshot,
                        project_scopes: ['LSS'],
                    }],
            };
        }
        if (sql.includes('FROM exhibits e') && sql.includes('WHERE e.project_id')) {
            return { rows: [] };
        }
        if (sql.includes('FROM tanks t')) {
            return { rows: [] };
        }
        if (sql.includes('FROM systems s')) {
            return { rows: systems };
        }
        if (sql.includes('FROM system_flow_sand_filter_allocations')) {
            return { rows: [sandFilterAllocation] };
        }
        if (sql.includes('FROM system_flow_side_streams') ||
            sql.includes('FROM system_flow_fractionator_allocations') ||
            sql.includes('FROM design_book_exhibit_species') ||
            sql.includes('FROM design_book_exhibit_hydraulics') ||
            sql.includes('FROM design_book_exhibit_substrate') ||
            sql.includes('FROM design_book_exhibit_lights') ||
            sql.includes('FROM system_exhibit_links') ||
            sql.includes('FROM design_book_thermal_calculations') ||
            sql.includes('FROM design_book_friction_loss_calculations') ||
            sql.includes('FROM system_pump_selections')) {
            return { rows: [] };
        }
        if (sql.includes('FROM thermal_wall_construction_defaults')) {
            return {
                rows: [
                    { construction_code: 'acrylic', construction_label: 'Acrylic', material: 'Acrylic / PMMA', thickness_mm: 12, conductivity_w_m_k: 0.19, version: state.wallConstructionVersion, source_basis: 'AAT Foundations', source_reference: 'AAT Foundations wall construction starter defaults', status: 'approved' },
                    { construction_code: 'concrete', construction_label: 'Concrete', material: 'Reinforced concrete', thickness_mm: 150, conductivity_w_m_k: 1.4, version: state.wallConstructionVersion, source_basis: 'AAT Foundations', source_reference: 'AAT Foundations wall construction starter defaults', status: 'approved' },
                    { construction_code: 'frp', construction_label: 'FRP', material: 'FRP / GRP laminate', thickness_mm: 6, conductivity_w_m_k: 0.25, version: state.wallConstructionVersion, source_basis: 'AAT Foundations', source_reference: 'AAT Foundations wall construction starter defaults', status: 'approved' },
                    { construction_code: 'steel', construction_label: 'Steel', material: 'Stainless steel 316L', thickness_mm: 3, conductivity_w_m_k: 14, version: state.wallConstructionVersion, source_basis: 'AAT Foundations', source_reference: 'AAT Foundations wall construction starter defaults', status: 'approved' },
                ],
            };
        }
        throw new Error(`Unexpected query in Design Book detail regression test: ${sql}`);
    });
    return {
        query,
        default: {
            query,
            connect: vitest_1.vi.fn(),
        },
    };
});
function requestDetail(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
            const token = jsonwebtoken_1.default.sign({ id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path: `/api/v1/design-books/${bookId}`,
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            }, res => {
                let response = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { response += chunk; });
                res.on('end', () => {
                    server.close(error => {
                        if (error)
                            return reject(error);
                        resolve({ status: res.statusCode ?? 0, body: JSON.parse(response) });
                    });
                });
            });
            req.on('error', reject);
            req.end();
        });
    });
}
(0, vitest_1.describe)('Design Book detail thermal response', () => {
    let app;
    let designBookModule;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        designBookModule = await Promise.resolve().then(() => __importStar(require('./designBooks')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', designBookModule.default);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.status = 'Draft';
        state.reviewSnapshot = null;
        state.releaseSnapshot = null;
        state.wallConstructionVersion = 'AAT_FOUNDATIONS_WALL_V1.0';
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('returns an unsaved current preview for every Life Support system in a Draft book', async () => {
        const response = await requestDetail(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.thermal_calculations).toHaveLength(3);
        (0, vitest_1.expect)(response.body.thermal_calculations.map((item) => item.system_id)).toEqual(systems.map(system => system.id));
        (0, vitest_1.expect)(response.body.thermal_calculations).toEqual(vitest_1.expect.arrayContaining(systems.map(system => vitest_1.expect.objectContaining({
            system_id: system.id,
            system: vitest_1.expect.objectContaining({ id: system.id, system_type: system.system_type }),
            saved: null,
            calculation: null,
            current_preview: vitest_1.expect.any(Object),
            status: 'Not configured',
            freshness: 'unsaved',
            source_fingerprint: vitest_1.expect.any(String),
        }))));
        (0, vitest_1.expect)(response.body.thermal_construction_defaults).toEqual([
            vitest_1.expect.objectContaining({ code: 'acrylic', material: 'Acrylic / PMMA', thickness_mm: 12, conductivity_w_m_k: 0.19 }),
            vitest_1.expect.objectContaining({ code: 'concrete', material: 'Reinforced concrete', thickness_mm: 150, conductivity_w_m_k: 1.4 }),
            vitest_1.expect.objectContaining({ code: 'frp', material: 'FRP / GRP laminate', thickness_mm: 6, conductivity_w_m_k: 0.25 }),
            vitest_1.expect.objectContaining({ code: 'steel', material: 'Stainless steel 316L', thickness_mm: 3, conductivity_w_m_k: 14 }),
        ]);
        (0, vitest_1.expect)(state.calls).toContainEqual(vitest_1.expect.objectContaining({
            params: [bookId, systems.map(system => system.id)],
        }));
        (0, vitest_1.expect)(response.body.friction_loss_calculations.map((item) => item.system_id)).toEqual(systems.map(system => system.id));
        (0, vitest_1.expect)(response.body.systems[0].sand_filter_allocations).toEqual([sandFilterAllocation]);
        (0, vitest_1.expect)(response.body.systems).toEqual(vitest_1.expect.arrayContaining(systems.map(system => vitest_1.expect.objectContaining({
            id: system.id,
            source_flows_m3h: vitest_1.expect.any(Object),
        }))));
    });
    (0, vitest_1.it)('inherits a fresh circuit pump into an unsaved friction-loss package', async () => {
        const system = {
            id: '00000000-0000-4000-8000-000000000201',
            system_code: 'LSS-201',
            system_name: 'Shark LSS',
            system_type: 'Single Exhibit LSS',
            design_flow_m3h: 100,
            loop1_flow_source: 'Exhibit return',
            loop1_filtration: 'Mechanical',
            loop1_flow_pct: 100,
            side_streams: [],
        };
        const circuit = (0, pumpSelections_1.pumpCircuits)(system, [])[0];
        const selectedPump = {
            id: '00000000-0000-4000-8000-000000000202',
            project_equipment_item_id: '00000000-0000-4000-8000-000000000202',
            equip_code: 'P-201',
            product_code: 'PUMP-201',
            product_name: 'Duty pump',
            power_kw: 10,
            design_flow_m3h: 120,
            design_head_m: 15,
        };
        const source = {
            circuit: {
                circuit_key: circuit.circuit_key,
                circuit_kind: circuit.circuit_kind,
                circuit_name: circuit.circuit_name,
                circuit_type: circuit.circuit_type,
                parent_loop_number: circuit.parent_loop_number,
                side_stream_id: circuit.side_stream_id,
                flow_m3h: circuit.flow_m3h,
            },
            design_head_m: 10,
            pump_efficiency_pct: 80,
            motor_efficiency_pct: 90,
        };
        let pumpBelongsToProject = true;
        const runner = vitest_1.vi.fn(async (sql) => {
            if (sql.includes('SELECT sps.system_id')) {
                return {
                    rows: pumpBelongsToProject ? [{
                            system_id: system.id,
                            circuit_key: circuit.circuit_key,
                            ...selectedPump,
                        }] : [],
                };
            }
            if (sql.includes('FROM system_pump_selections')) {
                return {
                    rows: [{
                            system_id: system.id,
                            circuit_key: circuit.circuit_key,
                            project_equipment_item_id: selectedPump.id,
                            design_head_m: 10,
                            pump_efficiency_pct: 80,
                            motor_efficiency_pct: 90,
                            source_fingerprint: (0, pumpSelections_1.pumpSourceFingerprint)(source),
                            pump_snapshot: selectedPump,
                            calculation_version: pumpSelections_1.PUMP_SELECTION_CALCULATION_VERSION,
                            result_snapshot: { results: { recommended_motor_kw: 5.5 } },
                        }],
                };
            }
            if (sql.includes('FROM design_book_friction_loss_calculations'))
                return { rows: [] };
            throw new Error(`Unexpected friction package query: ${sql}`);
        });
        const packages = await designBookModule.loadFrictionLossPackages(runner, bookId, [system]);
        (0, vitest_1.expect)(packages[0].items[0]).toMatchObject({
            circuit_key: 'loop:1',
            flow_m3h: 100,
            project_equipment_item_id: selectedPump.id,
            selected_pump: vitest_1.expect.objectContaining({ id: selectedPump.id, equip_code: 'P-201' }),
            pump_selection_ready: true,
            pump_selection_status: 'ready',
            pump_selection_freshness: 'fresh',
            freshness: 'unsaved',
        });
        pumpBelongsToProject = false;
        const crossProjectPackages = await designBookModule.loadFrictionLossPackages(runner, bookId, [system]);
        (0, vitest_1.expect)(crossProjectPackages[0].items[0]).toMatchObject({
            pump_selection_ready: false,
            pump_selection_status: 'stale',
            pump_selection_freshness: 'stale',
            status: 'incomplete',
        });
        (0, vitest_1.expect)(crossProjectPackages[0].items[0].pump_selection_reasons).toContain('The selected circuit pump is no longer an active eligible pump assigned to this LSS system. Open Pump Selection and select a current pump.');
    });
    vitest_1.it.each([
        ['For Review', 'reviewSnapshot'],
        ['Approved', 'reviewSnapshot'],
        ['Released', 'releaseSnapshot'],
    ])('keeps %s Thermal data frozen after the wall library is superseded', async (status, snapshotKey) => {
        const frozenThermal = [{
                system_id: 'frozen-system',
                freshness: 'fresh',
                status: 'Ready',
                calculation: {
                    status: 'Ready',
                    frozen: true,
                    water_temperature_basis: {
                        minimum_c: 24,
                        maximum_c: 26,
                        average_c: 25,
                        calculated_temperature_c: 25,
                        reviewed_override_used: false,
                    },
                    wall_construction_basis: {
                        construction_type: 'frp',
                        u_value_w_m2_k: 2.5,
                        basis_version: 'aat-thermal-construction-v1',
                    },
                },
            }];
        const frozenDefaults = [{
                code: 'frp',
                label: 'FRP',
                material: 'FRP / GRP laminate',
                thickness_mm: 6,
                conductivity_w_m_k: 0.25,
                version: 'AAT_FOUNDATIONS_WALL_V1.0',
            }];
        state.status = status;
        state.wallConstructionVersion = 'AAT_FOUNDATIONS_WALL_V2.0';
        state[snapshotKey] = {
            thermal_calculations: frozenThermal,
            thermal_construction_defaults: frozenDefaults,
        };
        const response = await requestDetail(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.thermal_calculations).toEqual(frozenThermal);
        (0, vitest_1.expect)(response.body.thermal_construction_defaults).toEqual(frozenDefaults);
    });
});
