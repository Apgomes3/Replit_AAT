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
const testSecret = 'design-books-detail-test-secret';
const bookId = '00000000-0000-4000-8000-000000000143';
const projectId = '00000000-0000-4000-8000-000000000144';
const systems = [1, 2, 3].map(index => ({
    id: `00000000-0000-4000-8000-00000000014${index + 4}`,
    project_id: projectId,
    system_code: `LSS-0${index}`,
    system_name: `Life Support ${index}`,
    system_type: 'Life Support',
    status: 'Draft',
    design_flow_m3h: null,
    side_streams: [],
    fractionator_allocations: [],
}));
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    status: 'Draft',
    reviewSnapshot: null,
    releaseSnapshot: null,
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
        if (sql.includes('FROM system_flow_side_streams') ||
            sql.includes('FROM system_flow_fractionator_allocations') ||
            sql.includes('FROM design_book_exhibit_species') ||
            sql.includes('FROM design_book_exhibit_hydraulics') ||
            sql.includes('FROM design_book_exhibit_substrate') ||
            sql.includes('FROM system_exhibit_links') ||
            sql.includes('FROM design_book_thermal_calculations') ||
            sql.includes('FROM design_book_friction_loss_calculations') ||
            sql.includes('FROM system_pump_selections')) {
            return { rows: [] };
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
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: designBookRoutes } = await Promise.resolve().then(() => __importStar(require('./designBooks')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', designBookRoutes);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.status = 'Draft';
        state.reviewSnapshot = null;
        state.releaseSnapshot = null;
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
            system: vitest_1.expect.objectContaining({ id: system.id, system_type: 'Life Support' }),
            saved: null,
            calculation: null,
            current_preview: vitest_1.expect.any(Object),
            status: 'Not configured',
            freshness: 'unsaved',
            source_fingerprint: vitest_1.expect.any(String),
        }))));
        (0, vitest_1.expect)(response.body.thermal_construction_defaults).toEqual([
            vitest_1.expect.objectContaining({ code: 'acrylic', label: 'Acrylic', units: 'W/m²·K' }),
            vitest_1.expect.objectContaining({ code: 'concrete', label: 'Concrete', units: 'W/m²·K' }),
            vitest_1.expect.objectContaining({ code: 'frp', label: 'FRP', units: 'W/m²·K' }),
            vitest_1.expect.objectContaining({ code: 'steel', label: 'Steel', units: 'W/m²·K' }),
        ]);
        (0, vitest_1.expect)(state.calls).toContainEqual(vitest_1.expect.objectContaining({
            params: [bookId, systems.map(system => system.id)],
        }));
    });
    vitest_1.it.each([
        ['For Review', 'reviewSnapshot'],
        ['Approved', 'reviewSnapshot'],
        ['Released', 'releaseSnapshot'],
    ])('keeps %s Thermal data frozen', async (status, snapshotKey) => {
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
        state.status = status;
        state[snapshotKey] = { thermal_calculations: frozenThermal };
        const response = await requestDetail(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.thermal_calculations).toEqual(frozenThermal);
    });
});
