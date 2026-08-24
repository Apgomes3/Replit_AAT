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
const testSecret = 'audit-summary-test-secret';
const actorId = 'actor-1';
const poId = 'po-1';
const projectId = 'project-1';
const userId = 'user-1';
const state = vitest_1.vi.hoisted(() => ({
    auditRows: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.startsWith('select * from purchase_orders where id=$1')) {
            return {
                rows: [{
                        id: poId,
                        po_code: 'PO-001',
                        status: 'purchase_order',
                        created_by: actorId,
                    }],
            };
        }
        if (sql.startsWith('select 1 from po_stage_assignees'))
            return { rows: [] };
        if (sql.startsWith('select id, cost_price from po_items')) {
            return { rows: [{ id: 'item-1', cost_price: '125.00' }] };
        }
        if (sql.startsWith('select fo_number from purchase_orders')) {
            return { rows: [{ fo_number: null }] };
        }
        if (sql.startsWith('update projects set')) {
            return {
                rows: [{
                        id: projectId,
                        project_name: 'Updated Aquarium',
                        project_status: 'Active',
                    }],
            };
        }
        if (sql.startsWith('select is_active, role from users')) {
            return { rows: [{ is_active: true, role: 'viewer' }] };
        }
        if (sql.startsWith('update users set')) {
            return {
                rows: [{
                        id: userId,
                        email: 'user@example.com',
                        first_name: 'Test',
                        last_name: 'User',
                        role: 'engineer',
                        is_active: true,
                    }],
            };
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
    return {
        query,
        default: { query },
    };
});
vitest_1.vi.mock('../db/notifications', () => ({
    createNotification: vitest_1.vi.fn(),
    notifyAdminsAndManagers: vitest_1.vi.fn(),
}));
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
                            resolve({ status: res.statusCode ?? 0, body: JSON.parse(response) });
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
(0, vitest_1.describe)('audit summaries on update routes', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const [{ default: projectRoutes }, { default: purchaseOrderRoutes }, { default: adminRoutes }] = await Promise.all([
            Promise.resolve().then(() => __importStar(require('./projects'))),
            Promise.resolve().then(() => __importStar(require('./purchaseOrders'))),
            Promise.resolve().then(() => __importStar(require('./admin'))),
        ]);
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', projectRoutes);
        app.use('/api/v1', purchaseOrderRoutes);
        app.use('/api/v1/admin', adminRoutes);
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.auditRows.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('persists a readable summary when a purchase order changes state', async () => {
        const response = await request(app, 'POST', `/api/v1/purchase-orders/${poId}/transition`, token);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.status).toBe('po_review');
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType: 'purchase_order',
            entityId: poId,
            action: 'STATE_TRANSITION',
            details: vitest_1.expect.objectContaining({
                summary: 'Status changed from Purchase Order → Po Review',
            }),
        }));
    });
    (0, vitest_1.it)('persists a readable summary when a project is updated', async () => {
        const response = await request(app, 'PUT', `/api/v1/projects/${projectId}`, token, {
            project_name: 'Updated Aquarium',
            project_status: 'Active',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType: 'project',
            entityId: projectId,
            action: 'UPDATE',
            details: vitest_1.expect.objectContaining({
                summary: 'Project details updated',
            }),
        }));
    });
    (0, vitest_1.it)('persists a readable summary when a user role changes', async () => {
        const response = await request(app, 'PUT', `/api/v1/admin/users/${userId}`, token, {
            first_name: 'Test',
            last_name: 'User',
            role: 'engineer',
            is_active: true,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType: 'user',
            entityId: userId,
            action: 'UPDATE',
            details: vitest_1.expect.objectContaining({
                summary: 'Role changed from viewer → engineer',
            }),
        }));
    });
});
