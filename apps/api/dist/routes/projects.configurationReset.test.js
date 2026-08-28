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
const testSecret = 'configuration-reset-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    auditRows: [],
    bookStatus: 'Draft',
    systemStatus: 'Draft',
    moduleAccess: 'manage',
    failOn: '',
}));
vitest_1.vi.mock('../db', () => {
    const clientQuery = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (state.failOn && sql.includes(state.failOn))
            throw new Error('simulated database failure');
        if (sql.replace(/\s+/g, ' ').trim().toLowerCase().startsWith('insert into audit_logs')) {
            state.auditRows.push({
                entityType: 'system',
                entityId: String(params[0]),
                action: 'RESET_CONFIGURATION',
                details: params[2] ?? null,
            });
        }
        if (sql.includes('SELECT * FROM systems WHERE id=$1 FOR UPDATE')) {
            return {
                rows: [{
                        id: 'system-1',
                        system_code: 'LSS-01',
                        project_id: 'project-1',
                        status: state.systemStatus,
                    }],
            };
        }
        if (sql.includes('SELECT id, status FROM design_books')) {
            return { rows: [{ id: 'book-1', status: state.bookStatus }] };
        }
        if (sql.includes('UPDATE systems SET')) {
            return {
                rows: [{
                        id: 'system-1',
                        system_code: 'LSS-01',
                        project_id: 'project-1',
                        status: state.systemStatus,
                        system_config: null,
                        compact_unit_id: null,
                        design_flow_m3h: null,
                        turnover_rate_hr: null,
                        calculation_inputs: null,
                    }],
            };
        }
        return { rows: [] };
    });
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [{ access_level: state.moduleAccess }] };
        return { rows: [] };
    });
    return {
        default: {
            connect: vitest_1.vi.fn(async () => ({
                query: clientQuery,
                release: vitest_1.vi.fn(),
            })),
        },
        query,
    };
});
vitest_1.vi.mock('../db/audit', () => ({
    logAudit: vitest_1.vi.fn(async () => undefined),
}));
function request(app, role = 'engineer') {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const token = jsonwebtoken_1.default.sign({ id: 'user-1', email: 'user@example.com', role }, testSecret);
            const payload = JSON.stringify({ design_book_id: 'book-1' });
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'POST',
                path: '/api/v1/systems/system-1/configuration-reset',
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
                        resolve({
                            status: res.statusCode ?? 0,
                            body: response && res.headers['content-type']?.includes('application/json')
                                ? JSON.parse(response)
                                : {},
                        });
                    });
                });
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('safe LSS configuration reset', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: projectRoutes } = await Promise.resolve().then(() => __importStar(require('./projects')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', projectRoutes);
        app.use((_error, _req, res, _next) => {
            res.status(500).json({ error: { code: 'SERVER_ERROR' } });
        });
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.auditRows.length = 0;
        state.bookStatus = 'Draft';
        state.systemStatus = 'Draft';
        state.moduleAccess = 'manage';
        state.failOn = '';
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('clears the documented LSS-owned records in one transaction and preserves source records', async () => {
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.system).toMatchObject({
            system_config: null,
            compact_unit_id: null,
            design_flow_m3h: null,
            turnover_rate_hr: null,
            side_streams: [],
            fractionator_allocations: [],
            equipment: [],
        });
        const sql = state.calls.map(call => call.sql).join('\n');
        (0, vitest_1.expect)(sql).toContain('BEGIN');
        (0, vitest_1.expect)(sql).toContain('DELETE FROM system_exhibit_links');
        (0, vitest_1.expect)(sql).toContain('DELETE FROM system_flow_side_streams');
        (0, vitest_1.expect)(sql).toContain('DELETE FROM system_flow_fractionator_allocations');
        (0, vitest_1.expect)(sql).toContain('DELETE FROM project_equipment_items');
        (0, vitest_1.expect)(sql).toContain('RESET_CONFIGURATION');
        (0, vitest_1.expect)(sql).toContain('COMMIT');
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType: 'system',
            entityId: 'system-1',
            action: 'RESET_CONFIGURATION',
            details: vitest_1.expect.objectContaining({
                summary: 'LSS configuration reset for LSS-01',
            }),
        }));
        (0, vitest_1.expect)(sql).not.toMatch(/DELETE FROM (tanks|exhibits|design_book_exhibit_hydraulics|product_masters)/);
        (0, vitest_1.expect)(sql).not.toMatch(/UPDATE (tanks|exhibits|design_book_exhibit_hydraulics|product_masters)/);
    });
    (0, vitest_1.it)('rejects reviewed Design Books before changing any LSS records', async () => {
        state.bookStatus = 'For Review';
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('DESIGN_BOOK_NOT_EDITABLE');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('DELETE FROM'))).toBe(false);
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'ROLLBACK')).toBe(true);
    });
    (0, vitest_1.it)('rolls back the whole reset when a database operation fails', async () => {
        state.failOn = 'DELETE FROM project_equipment_items';
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(500);
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'ROLLBACK')).toBe(true);
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'COMMIT')).toBe(false);
    });
    (0, vitest_1.it)('rejects users without an editable engineering role', async () => {
        const response = await request(app, 'viewer');
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'BEGIN')).toBe(false);
    });
    (0, vitest_1.it)('rejects engineers with read-only Projects module access', async () => {
        state.moduleAccess = 'view';
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'BEGIN')).toBe(false);
    });
});
