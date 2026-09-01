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
const express_1 = __importDefault(require("express"));
const node_http_1 = __importDefault(require("node:http"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const testSecret = 'product-pneumatic-test-secret';
const productId = '00000000-0000-0000-0000-000000000101';
const duplicateId = '00000000-0000-0000-0000-000000000102';
const state = vitest_1.vi.hoisted(() => ({
    category: 'Pneumatic',
    moduleAccess: null,
    pneumatic: null,
    snapshot: null,
    duplicatePneumatic: null,
    calls: [],
    auditActions: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        state.calls.push({ sql, params });
        if (sql === 'begin') {
            state.snapshot = state.pneumatic ? { ...state.pneumatic } : null;
            return { rows: [] };
        }
        if (sql === 'commit') {
            state.snapshot = null;
            return { rows: [] };
        }
        if (sql === 'rollback') {
            state.pneumatic = state.snapshot ? { ...state.snapshot } : null;
            state.snapshot = null;
            return { rows: [] };
        }
        if (sql.startsWith('select rma.access_level')) {
            return { rows: state.moduleAccess ? [{ access_level: state.moduleAccess }] : [] };
        }
        if (sql.startsWith('select id from product_masters where id::text=$1 or product_code=$1')) {
            return { rows: [{ id: productId }] };
        }
        if (sql.startsWith('select product_category from product_masters')) {
            return { rows: [{ product_category: state.category }] };
        }
        if (sql.startsWith('select * from product_pneumatic')) {
            return { rows: state.pneumatic ? [{ ...state.pneumatic }] : [] };
        }
        if (sql.startsWith('insert into product_pneumatic') && sql.includes('on conflict')) {
            state.pneumatic = {
                id: 'pneumatic-1',
                product_master_id: params[0],
                gas_flow_value: params[1],
                gas_flow_unit: params[2],
                operating_temperature_value: params[3],
                operating_temperature_unit: params[4],
                dew_point_value: params[5],
                dew_point_unit: params[6],
                inlet_port_value: params[7],
                inlet_port_unit: params[8],
                outlet_port_value: params[9],
                outlet_port_unit: params[10],
            };
            return { rows: [{ ...state.pneumatic }] };
        }
        if (sql.startsWith('insert into audit_logs')) {
            state.auditActions.push(params[2]);
            return { rows: [] };
        }
        if (sql.startsWith('select pm.*, ph.design_flow_m3h as hydraulic_design_flow_m3h')) {
            return {
                rows: [{
                        id: productId,
                        product_code: 'AIR-100',
                        product_name: 'Air dryer',
                        product_category: state.category,
                        product_family_id: null,
                        standard_status: 'Active',
                        hydraulic_design_flow_m3h: null,
                        design_flow_m3h: null,
                        manufacturer: null,
                        model: null,
                    }],
            };
        }
        if (sql.startsWith('select id from product_masters where product_code=$1'))
            return { rows: [] };
        if (sql.startsWith('insert into product_masters')) {
            return { rows: [{ id: duplicateId, product_code: params[0], product_name: params[2], product_category: params[3] }] };
        }
        if (sql.startsWith('insert into product_hydraulic'))
            return { rows: [] };
        if (sql.startsWith('insert into product_pneumatic')) {
            state.duplicatePneumatic = state.pneumatic
                ? { ...state.pneumatic, id: 'pneumatic-2', product_master_id: params[0] }
                : null;
            return { rows: [] };
        }
        return { rows: [] };
    });
    return { query, default: { query } };
});
function request(app, method, path, token, body = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('Could not determine test server port'));
            const payload = JSON.stringify(body);
            const req = node_http_1.default.request({
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
                res.on('end', () => server.close(error => {
                    if (error)
                        return reject(error);
                    resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
                }));
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('PIM pneumatic specifications', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: productRoutes } = await Promise.resolve().then(() => __importStar(require('./products')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', productRoutes);
        app.use((error, _req, res, _next) => {
            res.status(error.status || 500).json({ error: { code: error.code || 'SERVER_ERROR', message: error.message } });
        });
        token = jsonwebtoken_1.default.sign({ id: 'actor-1', email: 'actor@example.com', role: 'engineer' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.category = 'Pneumatic';
        state.moduleAccess = null;
        state.pneumatic = null;
        state.snapshot = null;
        state.duplicatePneumatic = null;
        state.calls.length = 0;
        state.auditActions.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('saves and reloads metric values while preserving separate inlet and outlet ports', async () => {
        const save = await request(app, 'PUT', `/api/v1/product-masters/${productId}/pneumatic`, token, {
            gas_flow_value: 125.5,
            gas_flow_unit: 'm³/h',
            operating_temperature_value: -5,
            operating_temperature_unit: '°C',
            dew_point_value: -40,
            dew_point_unit: '°C',
            inlet_port_value: 50,
            inlet_port_unit: 'DN',
            outlet_port_value: 40,
            outlet_port_unit: 'mm',
        });
        (0, vitest_1.expect)(save.status).toBe(200);
        (0, vitest_1.expect)(save.body).toMatchObject({
            gas_flow_value: 125.5,
            gas_flow_unit: 'm3/h',
            operating_temperature_value: -5,
            dew_point_value: -40,
            inlet_port_value: 50,
            outlet_port_value: 40,
        });
        (0, vitest_1.expect)(state.auditActions).toContain('PNEUMATIC_SPECIFICATION_UPDATE');
        const reload = await request(app, 'GET', `/api/v1/product-masters/${productId}/pneumatic`, token);
        (0, vitest_1.expect)(reload.status).toBe(200);
        (0, vitest_1.expect)(reload.body.inlet_port_unit).toBe('DN');
        (0, vitest_1.expect)(reload.body.outlet_port_unit).toBe('mm');
    });
    (0, vitest_1.it)('supports imperial values and partial clear without changing other specifications', async () => {
        state.pneumatic = {
            id: 'pneumatic-1',
            product_master_id: productId,
            gas_flow_value: 88,
            gas_flow_unit: 'SCFM',
            operating_temperature_value: 32,
            operating_temperature_unit: '°F',
            dew_point_value: -20,
            dew_point_unit: '°F',
            inlet_port_value: 2,
            inlet_port_unit: 'in',
            outlet_port_value: 1.5,
            outlet_port_unit: 'in',
        };
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/pneumatic`, token, {
            gas_flow_value: '',
            gas_flow_unit: '',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.gas_flow_value).toBeNull();
        (0, vitest_1.expect)(response.body.gas_flow_unit).toBeNull();
        (0, vitest_1.expect)(response.body.dew_point_value).toBe(-20);
        (0, vitest_1.expect)(response.body.inlet_port_value).toBe(2);
        (0, vitest_1.expect)(response.body.outlet_port_value).toBe(1.5);
    });
    vitest_1.it.each([
        [{ gas_flow_value: -1, gas_flow_unit: 'SCFM' }, 'finite, non-negative'],
        [{ gas_flow_value: 'Infinity', gas_flow_unit: 'SCFM' }, 'finite, non-negative'],
        [{ gas_flow_value: 10, gas_flow_unit: 'L/min' }, 'supported unit'],
        [{ inlet_port_value: -0.5, inlet_port_unit: 'in' }, 'finite, non-negative'],
        [{ dew_point_value: -10, dew_point_unit: 'K' }, 'supported unit'],
        [{ outlet_port_value: null, outlet_port_unit: 'DN' }, 'cannot be set without a value'],
    ])('rejects invalid value and unit combinations', async (body, message) => {
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/pneumatic`, token, body);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PNEUMATIC_SPEC');
        (0, vitest_1.expect)(response.body.error.message).toContain(message);
        (0, vitest_1.expect)(state.pneumatic).toBeNull();
    });
    (0, vitest_1.it)('rejects pneumatic writes for a non-pneumatic product', async () => {
        state.category = 'Pumping';
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/pneumatic`, token, {
            gas_flow_value: 20,
            gas_flow_unit: 'SCFM',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PRODUCT_CATEGORY');
        (0, vitest_1.expect)(state.pneumatic).toBeNull();
    });
    (0, vitest_1.it)('does not expose retained pneumatic data while the product is in another category', async () => {
        state.category = 'Pumping';
        state.pneumatic = {
            id: 'pneumatic-1',
            product_master_id: productId,
            gas_flow_value: 88,
            gas_flow_unit: 'SCFM',
        };
        const response = await request(app, 'GET', `/api/v1/product-masters/${productId}/pneumatic`, token);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PRODUCT_CATEGORY');
    });
    (0, vitest_1.it)('requires PIM manage access to save specifications', async () => {
        state.moduleAccess = 'view';
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/pneumatic`, token, {
            gas_flow_value: 20,
            gas_flow_unit: 'SCFM',
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
        (0, vitest_1.expect)(state.pneumatic).toBeNull();
    });
    (0, vitest_1.it)('copies the pneumatic record when duplicating a product', async () => {
        state.pneumatic = {
            id: 'pneumatic-1',
            product_master_id: productId,
            gas_flow_value: 75,
            gas_flow_unit: 'SCFM',
            operating_temperature_value: -4,
            operating_temperature_unit: '°F',
            dew_point_value: -35,
            dew_point_unit: '°F',
            inlet_port_value: 2,
            inlet_port_unit: 'in',
            outlet_port_value: 1,
            outlet_port_unit: 'in',
        };
        const response = await request(app, 'POST', `/api/v1/product-masters/${productId}/duplicate`, token);
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(state.duplicatePneumatic).toMatchObject({
            product_master_id: duplicateId,
            gas_flow_value: 75,
            inlet_port_value: 2,
            outlet_port_value: 1,
        });
    });
    (0, vitest_1.it)('does not copy a retained pneumatic record after the source is reclassified', async () => {
        state.category = 'Pumping';
        state.pneumatic = {
            id: 'pneumatic-1',
            product_master_id: productId,
            gas_flow_value: 75,
            gas_flow_unit: 'SCFM',
        };
        const response = await request(app, 'POST', `/api/v1/product-masters/${productId}/duplicate`, token);
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(state.duplicatePneumatic).toBeNull();
    });
    (0, vitest_1.it)('requires PIM manage access to duplicate a product', async () => {
        state.moduleAccess = 'view';
        const response = await request(app, 'POST', `/api/v1/product-masters/${productId}/duplicate`, token);
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
        (0, vitest_1.expect)(state.duplicatePneumatic).toBeNull();
    });
});
