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
const testSecret = 'products-audit-summary-test-secret';
const actorId = 'actor-1';
const state = vitest_1.vi.hoisted(() => ({
    auditRows: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.startsWith('select rma.access_level'))
            return { rows: [] };
        if (sql.startsWith('select 1 from tanks'))
            return { rows: [] };
        if (sql.startsWith('select 1 from bom_lines'))
            return { rows: [] };
        if (sql.startsWith('select id from product_masters where id::text=$1 or product_code=$1')) {
            return { rows: [{ id: 'product-1' }] };
        }
        if (sql.startsWith('insert into product_masters')) {
            return {
                rows: [{
                        id: 'product-1',
                        product_code: 'P-100',
                        product_name: 'Test Product',
                        standard_status: 'Concept',
                    }],
            };
        }
        if (sql.startsWith('update product_masters set standard_status')) {
            return { rows: [{ id: 'product-1', standard_status: params[0] }] };
        }
        if (sql.startsWith('update product_masters set')) {
            return {
                rows: [{
                        id: 'product-1',
                        product_code: 'P-100',
                        product_name: 'Updated Product',
                        standard_status: 'Active',
                    }],
            };
        }
        if (sql.startsWith('delete from product_masters')) {
            return { rows: [{ id: 'product-1', product_code: 'P-100' }] };
        }
        if (sql.startsWith('insert into components')) {
            return {
                rows: [{
                        id: 'component-1',
                        component_code: 'C-100',
                        component_name: 'Test Component',
                        status: 'Active',
                    }],
            };
        }
        if (sql.startsWith('update components set status')) {
            return { rows: [{ id: 'component-1', status: params[0] }] };
        }
        if (sql.startsWith('update components set component_name')) {
            return {
                rows: [{
                        id: 'component-1',
                        component_code: 'C-100',
                        component_name: 'Updated Component',
                        status: 'Active',
                    }],
            };
        }
        if (sql.startsWith('delete from components')) {
            return { rows: [{ id: 'component-1', component_code: 'C-100' }] };
        }
        if (sql.startsWith('insert into product_hydraulic')) {
            return { rows: [{ product_master_id: 'product-1', venturi_flow_m3h: 12 }] };
        }
        if (sql.startsWith('insert into audit_logs')) {
            state.auditRows.push({
                entityType: String(params[0]),
                entityId: String(params[1]),
                action: String(params[2]),
                details: params[4] ?? null,
            });
        }
        return { rows: [] };
    });
    return { query, default: { query } };
});
function request(app, method, path, token, body = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
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
                res.on('end', () => {
                    server.close(error => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        try {
                            resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
                        }
                        catch (error) {
                            reject(error);
                        }
                    });
                });
            });
            req.on('error', error => {
                server.close();
                reject(error);
            });
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('persisted audit summaries for product mutations', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: productRoutes } = await Promise.resolve().then(() => __importStar(require('./products')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', productRoutes);
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.auditRows.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    const expectSummary = (entityType, entityId, action, summary) => {
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType,
            entityId,
            action,
            details: vitest_1.expect.objectContaining({ summary }),
        }));
    };
    (0, vitest_1.it)('keeps readable summaries for product create, update, delete, and status changes', async () => {
        (0, vitest_1.expect)((await request(app, 'POST', '/api/v1/product-masters', token, {
            product_code: 'P-100',
            product_name: 'Test Product',
        })).status).toBe(201);
        expectSummary('product', 'product-1', 'CREATE', 'Product P-100 created');
        (0, vitest_1.expect)((await request(app, 'PUT', '/api/v1/product-masters/product-1', token, {
            product_name: 'Updated Product',
            product_category: 'Pump',
            standard_status: 'Active',
        })).status).toBe(200);
        expectSummary('product', 'product-1', 'UPDATE', 'Product details updated');
        (0, vitest_1.expect)((await request(app, 'PATCH', '/api/v1/product-masters/product-1/status', token, {
            standard_status: 'Obsolete',
        })).status).toBe(200);
        expectSummary('product', 'product-1', 'STATUS_CHANGE', 'Status changed to Obsolete');
        (0, vitest_1.expect)((await request(app, 'DELETE', '/api/v1/product-masters/product-1', token)).status).toBe(200);
        expectSummary('product', 'product-1', 'DELETE', 'Product P-100 deleted');
    });
    (0, vitest_1.it)('keeps readable summaries for component create, update, delete, and status changes', async () => {
        (0, vitest_1.expect)((await request(app, 'POST', '/api/v1/components', token, {
            component_code: 'C-100',
            component_name: 'Test Component',
        })).status).toBe(201);
        expectSummary('component', 'component-1', 'CREATE', 'Component C-100 created');
        (0, vitest_1.expect)((await request(app, 'PUT', '/api/v1/components/component-1', token, {
            component_name: 'Updated Component',
            component_type: 'Valve',
            status: 'Active',
        })).status).toBe(200);
        expectSummary('component', 'component-1', 'UPDATE', 'Component details updated');
        (0, vitest_1.expect)((await request(app, 'PATCH', '/api/v1/components/component-1/status', token, {
            status: 'Obsolete',
        })).status).toBe(200);
        expectSummary('component', 'component-1', 'STATUS_CHANGE', 'Status changed to Obsolete');
        (0, vitest_1.expect)((await request(app, 'DELETE', '/api/v1/components/component-1', token)).status).toBe(200);
        expectSummary('component', 'component-1', 'DELETE', 'Component C-100 deleted');
    });
    (0, vitest_1.it)('keeps a readable summary for hydraulic product updates', async () => {
        const response = await request(app, 'PUT', '/api/v1/product-masters/product-1/hydraulic', token, {
            venturi_flow_m3h: 12,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        expectSummary('product', 'product-1', 'UPDATE', 'Product hydraulic data updated');
    });
});
