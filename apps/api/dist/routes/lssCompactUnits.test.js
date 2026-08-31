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
const testSecret = 'edp-secret-change-in-production';
const state = vitest_1.vi.hoisted(() => ({
    bomRows: [],
    lineRows: [],
    componentRows: [],
    productRows: [],
    clientQueries: [],
}));
vitest_1.vi.mock('../db', () => ({
    default: { connect: vitest_1.vi.fn() },
    query: vitest_1.vi.fn(async (sql) => {
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [{ access_level: 'manage' }] };
        if (sql.includes('FROM standard_boms sb'))
            return { rows: state.bomRows };
        if (sql.includes('FROM bom_lines bl'))
            return { rows: state.lineRows };
        if (sql.includes('FROM standard_boms'))
            return { rows: state.bomRows };
        if (sql.includes('FROM bom_lines'))
            return { rows: state.lineRows };
        if (sql.includes('SELECT id FROM components'))
            return { rows: state.componentRows };
        if (sql.includes('SELECT id FROM product_masters'))
            return { rows: state.productRows };
        return { rows: [] };
    }),
}));
let app;
let connectMock;
(0, vitest_1.beforeAll)(async () => {
    const db = await Promise.resolve().then(() => __importStar(require('../db')));
    connectMock = vitest_1.vi.mocked(db.default.connect);
    const { default: routes } = await Promise.resolve().then(() => __importStar(require('./lssCompactUnits')));
    app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', routes);
});
(0, vitest_1.beforeEach)(() => {
    state.bomRows = [];
    state.lineRows = [];
    state.componentRows = [];
    state.productRows = [];
    state.clientQueries = [];
    connectMock.mockReset();
});
function request(method, path, payload) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const body = payload === undefined ? '' : JSON.stringify(payload);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method,
                path,
                headers: {
                    Authorization: `Bearer ${jsonwebtoken_1.default.sign({ id: 'user-1', email: 'user@example.com', role: 'engineer' }, testSecret)}`,
                    ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
                },
            }, response => {
                let text = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { text += chunk; });
                response.on('end', () => server.close(() => resolve({
                    status: response.statusCode || 0,
                    body: text ? JSON.parse(text) : {},
                })));
            });
            req.on('error', reject);
            if (body)
                req.write(body);
            req.end();
        });
    });
}
(0, vitest_1.describe)('LSS compact-unit BOM API', () => {
    (0, vitest_1.it)('returns a normalized applicable BOM with optional and size details', async () => {
        state.bomRows = [{
                id: 'bom-1',
                bom_code: 'BOM-CU-1',
                revision_code: 'C',
                product_master_id: 'product-1',
                product_code: 'CU-1',
                product_name: 'Compact One',
            }];
        state.lineRows = [{
                id: 'line-1',
                line_number: 10,
                component_id: 'component-1',
                component_type: 'Filter',
                component_reference_code: 'FLT-1',
                resolved_component_name: 'Drum Filter',
                quantity: '2',
                unit: 'EA',
                is_optional: true,
                source_size_or_power: '100 micron',
            }];
        const response = await request('GET', '/api/v1/lss-compact-units/bom/product-1');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toMatchObject({
            available: true,
            bom: { bom_code: 'BOM-CU-1', revision_code: 'C' },
            lines: [{
                    source_bom_line_id: 'line-1',
                    component_reference_code: 'FLT-1',
                    component_name: 'Drum Filter',
                    quantity: 2,
                    is_optional: true,
                    included: true,
                    is_filtration: true,
                    size_or_power: '100 micron',
                }],
        });
    });
    (0, vitest_1.it)('uses Component provenance when a legacy BOM line contains both source IDs', async () => {
        state.bomRows = [{ id: 'bom-1', bom_code: 'BOM-CU-1', revision_code: 'A' }];
        state.lineRows = [{
                id: 'line-1',
                component_id: 'component-1',
                sub_product_id: 'product-1',
                source_component_code: 'COMP-1',
                sub_product_code: 'PROD-1',
                resolved_component_name: 'Legacy mixed source',
                quantity: 1,
            }];
        const response = await request('GET', '/api/v1/lss-compact-units/bom/product-1');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.lines[0]).toMatchObject({
            source_component_id: 'component-1',
            source_product_id: null,
            component_reference_code: 'COMP-1',
        });
    });
    (0, vitest_1.it)('persists Component-only provenance from a legacy dual-source BOM line', async () => {
        state.bomRows = [{
                id: 'bom-1',
                bom_code: 'BOM-CU-1',
                revision_code: 'A',
                product_master_id: 'product-1',
            }];
        state.lineRows = [{
                id: 'line-1',
                component_id: 'component-1',
                sub_product_id: 'product-2',
            }];
        const client = {
            query: vitest_1.vi.fn(async (sql, params) => {
                state.clientQueries.push({ sql, params });
                if (sql.includes('INSERT INTO lss_compact_units'))
                    return { rows: [{ id: 'unit-1', unit_code: 'CU-1' }] };
                return { rows: [] };
            }),
            release: vitest_1.vi.fn(),
        };
        connectMock.mockResolvedValue(client);
        const response = await request('POST', '/api/v1/lss-compact-units', {
            unit_code: 'CU-1',
            unit_name: 'Compact One',
            product_master_id: 'product-1',
            source_bom_id: 'bom-1',
            equipment: [{
                    source_bom_line_id: 'line-1',
                    source_component_id: 'component-1',
                    source_product_id: null,
                    component_name: 'Legacy mixed source',
                    quantity: 1,
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body.equipment[0]).toMatchObject({
            source_component_id: 'component-1',
            source_product_id: null,
            is_custom: false,
        });
        const equipmentInsert = state.clientQueries.find(entry => entry.sql.includes('INSERT INTO lss_compact_unit_equipment'));
        (0, vitest_1.expect)(equipmentInsert?.params?.[3]).toBe('component-1');
        (0, vitest_1.expect)(equipmentInsert?.params?.[5]).toBeNull();
    });
    (0, vitest_1.it)('distinguishes missing and empty BOMs without blocking manual configuration', async () => {
        (0, vitest_1.expect)((await request('GET', '/api/v1/lss-compact-units/bom/product-1')).body)
            .toMatchObject({ available: false, reason: 'missing_bom', lines: [] });
        state.bomRows = [{ id: 'bom-1', bom_code: 'EMPTY', revision_code: 'A' }];
        (0, vitest_1.expect)((await request('GET', '/api/v1/lss-compact-units/bom/product-1')).body)
            .toMatchObject({ available: false, reason: 'empty_bom', lines: [] });
    });
    (0, vitest_1.it)('rejects invalid equipment snapshots before persistence', async () => {
        const response = await request('POST', '/api/v1/lss-compact-units', {
            unit_code: 'CU-1',
            unit_name: 'Compact One',
            equipment: [{ component_name: 'Filter', quantity: -1, included: true }],
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error).toMatchObject({
            code: 'VALIDATION',
            message: 'equipment[0].quantity must be a non-negative number',
        });
    });
    (0, vitest_1.it)('persists Component, Product, and custom provenance as independent snapshots', async () => {
        state.componentRows = [{ id: 'component-1' }];
        state.productRows = [{ id: 'product-1' }];
        const client = {
            query: vitest_1.vi.fn(async (sql, params) => {
                state.clientQueries.push({ sql, params });
                if (sql.includes('INSERT INTO lss_compact_units'))
                    return { rows: [{ id: 'unit-1', unit_code: 'CU-1' }] };
                return { rows: [] };
            }),
            release: vitest_1.vi.fn(),
        };
        connectMock.mockResolvedValue(client);
        const response = await request('POST', '/api/v1/lss-compact-units', {
            unit_code: 'CU-1',
            unit_name: 'Compact One',
            equipment: [
                {
                    source_component_id: 'component-1',
                    component_name: 'Catalog Pump',
                    quantity: 1,
                    is_custom: false,
                },
                {
                    source_product_id: 'product-1',
                    component_name: 'Catalog Product',
                    quantity: 1,
                    is_custom: false,
                },
                {
                    component_name: 'Custom Manifold',
                    quantity: 1,
                    is_custom: true,
                },
            ],
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body.equipment).toEqual([
            vitest_1.expect.objectContaining({ source_component_id: 'component-1', is_custom: false }),
            vitest_1.expect.objectContaining({ source_product_id: 'product-1', is_custom: false }),
            vitest_1.expect.objectContaining({ component_name: 'Custom Manifold', is_custom: true }),
        ]);
        const equipmentInserts = state.clientQueries.filter(entry => entry.sql.includes('INSERT INTO lss_compact_unit_equipment'));
        (0, vitest_1.expect)(equipmentInserts).toHaveLength(3);
        (0, vitest_1.expect)(equipmentInserts[0].params?.[3]).toBe('component-1');
        (0, vitest_1.expect)(equipmentInserts[1].params?.[5]).toBe('product-1');
        (0, vitest_1.expect)(equipmentInserts[2].params?.[3]).toBeNull();
        (0, vitest_1.expect)(equipmentInserts[2].params?.[5]).toBeNull();
    });
    (0, vitest_1.it)('rejects ambiguous PIM equipment provenance', async () => {
        const response = await request('POST', '/api/v1/lss-compact-units', {
            unit_code: 'CU-1',
            unit_name: 'Compact One',
            equipment: [{
                    source_component_id: 'component-1',
                    source_product_id: 'product-1',
                    component_name: 'Ambiguous source',
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.message).toContain('cannot reference both');
    });
    (0, vitest_1.it)('rejects missing direct PIM sources before persistence', async () => {
        const response = await request('POST', '/api/v1/lss-compact-units', {
            unit_code: 'CU-1',
            unit_name: 'Compact One',
            equipment: [{
                    source_component_id: 'missing-component',
                    component_name: 'Missing source',
                }],
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error).toMatchObject({
            code: 'INVALID_PROVENANCE',
            message: 'One or more PIM Component sources do not exist.',
        });
    });
    (0, vitest_1.it)('requires explicit confirmation before a reimport can change a snapshot', async () => {
        const response = await request('POST', '/api/v1/lss-compact-units/unit-1/reimport-bom', { confirm: false });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('CONFIRMATION_REQUIRED');
    });
    (0, vitest_1.it)('keeps direct Component and Product snapshots separate during BOM reimport', async () => {
        const currentEquipment = [
            {
                id: 'direct-component',
                source_bom_line_id: null,
                source_component_id: 'component-1',
                source_product_id: null,
                component_reference_code: 'COMP-1',
                component_name: 'Direct component snapshot',
                quantity: 1,
                included: true,
                is_custom: false,
            },
            {
                id: 'direct-product',
                source_bom_line_id: null,
                source_component_id: null,
                source_product_id: 'product-2',
                component_reference_code: 'PROD-2',
                component_name: 'Direct product snapshot',
                quantity: 1,
                included: true,
                is_custom: false,
            },
        ];
        const client = {
            query: vitest_1.vi.fn(async (sql, params) => {
                state.clientQueries.push({ sql, params });
                if (sql.includes('SELECT * FROM lss_compact_units')) {
                    return { rows: [{ id: 'unit-1', product_master_id: 'product-1' }] };
                }
                if (sql.includes('FROM standard_boms sb')) {
                    return { rows: [{ id: 'bom-1', bom_code: 'BOM-1', revision_code: 'B' }] };
                }
                if (sql.includes('FROM bom_lines bl')) {
                    return {
                        rows: [
                            {
                                id: 'bom-line-component',
                                component_id: 'component-1',
                                source_component_code: 'COMP-1',
                                resolved_component_name: 'BOM component',
                                quantity: 1,
                            },
                            {
                                id: 'bom-line-product',
                                sub_product_id: 'product-2',
                                sub_product_code: 'PROD-2',
                                resolved_component_name: 'BOM product',
                                quantity: 1,
                            },
                        ],
                    };
                }
                if (sql.includes('SELECT * FROM lss_compact_unit_equipment')) {
                    return { rows: currentEquipment };
                }
                return { rows: [] };
            }),
            release: vitest_1.vi.fn(),
        };
        connectMock.mockResolvedValue(client);
        const response = await request('POST', '/api/v1/lss-compact-units/unit-1/reimport-bom', { confirm: true });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.equipment).toHaveLength(4);
        (0, vitest_1.expect)(response.body.equipment).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({
                source_bom_line_id: 'bom-line-component',
                source_component_id: 'component-1',
                component_name: 'BOM component',
            }),
            vitest_1.expect.objectContaining({
                source_bom_line_id: 'bom-line-product',
                source_product_id: 'product-2',
                component_name: 'BOM product',
            }),
            vitest_1.expect.objectContaining({
                source_bom_line_id: null,
                source_component_id: 'component-1',
                component_name: 'Direct component snapshot',
            }),
            vitest_1.expect.objectContaining({
                source_bom_line_id: null,
                source_product_id: 'product-2',
                component_name: 'Direct product snapshot',
            }),
        ]));
        (0, vitest_1.expect)(state.clientQueries.filter(entry => entry.sql.includes('INSERT INTO lss_compact_unit_equipment'))).toHaveLength(4);
    });
});
