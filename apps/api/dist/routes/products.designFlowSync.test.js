"use strict";
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
const http_1 = __importDefault(require("http"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const testSecret = 'product-design-flow-sync-test-secret';
const actorId = '00000000-0000-0000-0000-000000000001';
const initialHydraulic = () => ({
    product_master_id: 'product-1',
    design_flow_m3h: 20,
    min_flow_m3h: 8,
    max_flow_m3h: 28,
    venturi_flow_m3h: 4,
    design_head_m: 11,
    design_pressure_bar: 2.5,
    max_pressure_bar: 4,
    npsh_required_m: 1.2,
    fluid_type: 'Seawater',
    min_temperature_c: 18,
    max_temperature_c: 27,
    notes: 'Keep me',
});
const state = vitest_1.vi.hoisted(() => ({
    productFlow: 20,
    hydraulic: null,
    snapshot: null,
    failHydraulicWrite: false,
    failAuditWrite: false,
    auditDetails: [],
}));
vitest_1.vi.mock('../db', () => {
    const run = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql === 'begin') {
            state.snapshot = { productFlow: state.productFlow, hydraulic: state.hydraulic ? { ...state.hydraulic } : null };
            return { rows: [] };
        }
        if (sql === 'commit') {
            state.snapshot = null;
            return { rows: [] };
        }
        if (sql === 'rollback') {
            if (state.snapshot) {
                state.productFlow = state.snapshot.productFlow;
                state.hydraulic = state.snapshot.hydraulic;
            }
            state.snapshot = null;
            return { rows: [] };
        }
        if (sql.startsWith('select rma.access_level'))
            return { rows: [] };
        if (sql.startsWith('select id from product_masters where id::text=$1 or product_code=$1')) {
            return { rows: [{ id: 'product-1' }] };
        }
        if (sql.startsWith('select id from product_masters where product_code=$1'))
            return { rows: [] };
        if (sql.includes('from product_masters pm left join product_hydraulic ph') && sql.includes('for update of pm')) {
            if (sql.includes('pm.product_code')) {
                return {
                    rows: [{
                            id: 'product-1',
                            product_code: 'P-100',
                            product_design_flow_m3h: state.productFlow,
                            hydraulic_design_flow_m3h: state.hydraulic?.design_flow_m3h ?? null,
                        }],
                };
            }
            return {
                rows: [{
                        product_design_flow_m3h: state.productFlow,
                        hydraulic_design_flow_m3h: state.hydraulic?.design_flow_m3h ?? null,
                    }],
            };
        }
        if (sql.startsWith('select design_flow_m3h from product_masters')) {
            return { rows: [{ design_flow_m3h: state.productFlow }] };
        }
        if (sql.startsWith('select * from product_hydraulic')) {
            return { rows: state.hydraulic ? [{ ...state.hydraulic }] : [] };
        }
        if (sql.startsWith('update product_masters set product_code=')) {
            state.productFlow = params[3];
            return {
                rows: [{
                        id: 'product-1',
                        product_code: 'P-100',
                        product_name: params[0],
                        design_flow_m3h: state.productFlow,
                    }],
            };
        }
        if (sql.startsWith('update product_masters set design_flow_m3h=')) {
            state.productFlow = params[1];
            return { rows: [{ id: 'product-1', design_flow_m3h: state.productFlow }] };
        }
        if (sql.startsWith('insert into product_hydraulic')) {
            if (state.failHydraulicWrite)
                throw new Error('hydraulic write failed');
            if (params.length === 2) {
                state.hydraulic = { ...(state.hydraulic || { product_master_id: params[0] }), design_flow_m3h: params[1] };
            }
            else {
                state.hydraulic = {
                    product_master_id: params[0],
                    design_flow_m3h: params[1],
                    min_flow_m3h: params[2],
                    max_flow_m3h: params[3],
                    venturi_flow_m3h: params[4],
                    design_head_m: params[5],
                    design_pressure_bar: params[6],
                    max_pressure_bar: params[7],
                    npsh_required_m: params[8],
                    fluid_type: params[9],
                    min_temperature_c: params[10],
                    max_temperature_c: params[11],
                    notes: params[12],
                };
            }
            return { rows: [{ ...state.hydraulic }] };
        }
        if (sql.includes('from product_masters pm') && sql.includes('coalesce(ph.design_flow_m3h')) {
            const flow = state.hydraulic?.design_flow_m3h ?? state.productFlow;
            return {
                rows: [{
                        ...(state.hydraulic || {}),
                        product_master_id: 'product-1',
                        design_flow_m3h: flow,
                        product_design_flow_m3h: state.productFlow,
                        hydraulic_design_flow_m3h: state.hydraulic?.design_flow_m3h ?? null,
                        design_flow_sync_status: state.productFlow != null && state.hydraulic?.design_flow_m3h != null && state.productFlow !== state.hydraulic.design_flow_m3h
                            ? 'conflict'
                            : flow == null ? 'empty' : 'synchronized',
                    }],
            };
        }
        if (sql.startsWith('insert into audit_logs')) {
            if (state.failAuditWrite)
                throw new Error('audit write failed');
            state.auditDetails.push(params[4] || {});
            return { rows: [] };
        }
        return { rows: [] };
    });
    return {
        query: run,
        default: {
            connect: vitest_1.vi.fn(async () => ({ query: run, release: vitest_1.vi.fn() })),
            query: run,
        },
    };
});
function request(app, method, path, token, body = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('Could not start test server'));
            const payload = JSON.stringify(body);
            const req = http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path,
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            }, response => {
                let raw = '';
                response.on('data', chunk => { raw += chunk; });
                response.on('end', () => {
                    server.close();
                    resolve({ status: response.statusCode || 0, body: raw ? JSON.parse(raw) : {} });
                });
            });
            req.on('error', error => { server.close(); reject(error); });
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('linked Product Master and Hydraulic design flow', () => {
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
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.productFlow = 20;
        state.hydraulic = initialHydraulic();
        state.snapshot = null;
        state.failHydraulicWrite = false;
        state.failAuditWrite = false;
        state.auditDetails.length = 0;
    });
    (0, vitest_1.it)('updates both records from Product Master and identifies the source in audit history', async () => {
        const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
            product_name: 'Pump',
            product_category: 'Pump',
            design_flow_m3h: 24,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.productFlow).toBe(24);
        (0, vitest_1.expect)(state.hydraulic?.design_flow_m3h).toBe(24);
        (0, vitest_1.expect)(state.hydraulic?.notes).toBe('Keep me');
        (0, vitest_1.expect)(state.auditDetails).toContainEqual(vitest_1.expect.objectContaining({
            source: 'product_master',
            design_flow_m3h: 24,
        }));
    });
    (0, vitest_1.it)('rolls back the Product Master value when the linked Hydraulic write fails', async () => {
        state.failHydraulicWrite = true;
        const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
            product_name: 'Pump',
            product_category: 'Pump',
            design_flow_m3h: 26,
        });
        (0, vitest_1.expect)(response.status).toBe(500);
        (0, vitest_1.expect)(state.productFlow).toBe(20);
        (0, vitest_1.expect)(state.hydraulic?.design_flow_m3h).toBe(20);
    });
    (0, vitest_1.it)('rolls back both values when the linked audit write fails', async () => {
        state.failAuditWrite = true;
        const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
            product_name: 'Pump',
            product_category: 'Pump',
            design_flow_m3h: 26,
        });
        (0, vitest_1.expect)(response.status).toBe(500);
        (0, vitest_1.expect)(state.productFlow).toBe(20);
        (0, vitest_1.expect)(state.hydraulic?.design_flow_m3h).toBe(20);
    });
    (0, vitest_1.it)('updates both records from the Hydraulic card without clearing unrelated fields', async () => {
        const response = await request(app, 'PUT', '/api/v1/product-masters/product-1/hydraulic', token, {
            design_flow_m3h: 32,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.productFlow).toBe(32);
        (0, vitest_1.expect)(state.hydraulic).toMatchObject({
            design_flow_m3h: 32,
            min_flow_m3h: 8,
            max_flow_m3h: 28,
            design_head_m: 11,
            fluid_type: 'Seawater',
            notes: 'Keep me',
        });
        (0, vitest_1.expect)(state.auditDetails).toContainEqual(vitest_1.expect.objectContaining({ source: 'hydraulic_card' }));
    });
    (0, vitest_1.it)('returns Hydraulic as the read authority while exposing an unresolved conflict', async () => {
        state.productFlow = 18;
        state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
        const response = await request(app, 'GET', '/api/v1/product-masters/product-1/hydraulic', token);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toMatchObject({
            design_flow_m3h: 21,
            product_design_flow_m3h: 18,
            hydraulic_design_flow_m3h: 21,
            design_flow_sync_status: 'conflict',
        });
    });
    (0, vitest_1.it)('requires an explicit choice for conflicts and applies the selected reconciliation idempotently', async () => {
        state.productFlow = 18;
        state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
        const conflict = await request(app, 'POST', '/api/v1/product-masters/design-flow/reconcile', token, {
            product_id: 'product-1',
        });
        (0, vitest_1.expect)(conflict.status).toBe(409);
        (0, vitest_1.expect)(state.productFlow).toBe(18);
        (0, vitest_1.expect)(state.hydraulic.design_flow_m3h).toBe(21);
        const resolved = await request(app, 'POST', '/api/v1/product-masters/design-flow/reconcile', token, {
            product_id: 'product-1',
            resolution: 'hydraulic',
        });
        (0, vitest_1.expect)(resolved.status).toBe(200);
        (0, vitest_1.expect)(state.productFlow).toBe(21);
        (0, vitest_1.expect)(state.hydraulic.design_flow_m3h).toBe(21);
        const repeated = await request(app, 'POST', '/api/v1/product-masters/design-flow/reconcile', token, {
            product_id: 'product-1',
        });
        (0, vitest_1.expect)(repeated.status).toBe(200);
        (0, vitest_1.expect)(state.productFlow).toBe(21);
        (0, vitest_1.expect)(state.hydraulic.design_flow_m3h).toBe(21);
    });
    (0, vitest_1.it)('does not let an ordinary save silently resolve a pre-existing conflict', async () => {
        state.productFlow = 18;
        state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
        const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
            product_name: 'Renamed pump',
            product_category: 'Pump',
            design_flow_m3h: 21,
        });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(state.productFlow).toBe(18);
        (0, vitest_1.expect)(state.hydraulic.design_flow_m3h).toBe(21);
    });
    (0, vitest_1.it)('retains and audits the original Product Master value when that authority resolves a conflict', async () => {
        state.productFlow = 18;
        state.hydraulic = { ...initialHydraulic(), design_flow_m3h: 21 };
        const response = await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
            product_name: 'Pump',
            product_category: 'Pump',
            design_flow_m3h: 21,
            design_flow_conflict_resolution: 'product_master',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.productFlow).toBe(18);
        (0, vitest_1.expect)(state.hydraulic.design_flow_m3h).toBe(18);
        (0, vitest_1.expect)(state.auditDetails).toContainEqual(vitest_1.expect.objectContaining({
            source: 'product_master',
            design_flow_m3h: 18,
            previous_product_design_flow_m3h: 18,
            previous_hydraulic_design_flow_m3h: 21,
            resolved_conflict: true,
        }));
    });
});
