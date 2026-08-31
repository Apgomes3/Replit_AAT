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
        return { rows: [] };
    }),
}));
let app;
(0, vitest_1.beforeAll)(async () => {
    const { default: routes } = await Promise.resolve().then(() => __importStar(require('./lssCompactUnits')));
    app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', routes);
});
(0, vitest_1.beforeEach)(() => {
    state.bomRows = [];
    state.lineRows = [];
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
    (0, vitest_1.it)('requires explicit confirmation before a reimport can change a snapshot', async () => {
        const response = await request('POST', '/api/v1/lss-compact-units/unit-1/reimport-bom', { confirm: false });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('CONFIRMATION_REQUIRED');
    });
});
