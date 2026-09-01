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
const testSecret = 'lss-lifecycle-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    moduleAccess: 'manage',
    sourceStatus: 'Design',
    sourceProject: 'project-1',
    replacementProject: 'project-1',
    replacementStatus: 'Design',
    supersededBy: null,
}));
vitest_1.vi.mock('../db', () => {
    const clientQuery = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT * FROM systems WHERE id=$1 FOR UPDATE')) {
            return { rows: [{
                        id: 'system-1',
                        system_code: 'LSS-OLD',
                        system_name: 'Old LSS',
                        system_type: 'Life Support',
                        project_id: state.sourceProject,
                        status: state.sourceStatus,
                        superseded_by_system_id: state.supersededBy,
                    }] };
        }
        if (sql.includes('SELECT * FROM systems WHERE id = ANY')) {
            return { rows: [
                    {
                        id: 'system-1',
                        system_code: 'LSS-OLD',
                        system_name: 'Old LSS',
                        system_type: 'Life Support',
                        project_id: state.sourceProject,
                        status: state.sourceStatus,
                        superseded_by_system_id: state.supersededBy,
                    },
                    {
                        id: 'system-2',
                        system_code: 'LSS-NEW',
                        system_name: 'New LSS',
                        system_type: 'Life Support',
                        project_id: state.replacementProject,
                        status: state.replacementStatus,
                        supersedes_system_id: null,
                    },
                ] };
        }
        if (sql.includes("SET status='Decommissioned'")) {
            state.sourceStatus = 'Decommissioned';
            return { rows: [{ id: 'system-1', status: state.sourceStatus, lifecycle_reason: params[1] }] };
        }
        if (sql.includes("SET status='Superseded'")) {
            state.sourceStatus = 'Superseded';
            state.supersededBy = String(params[1]);
            return { rows: [{ id: 'system-1', status: state.sourceStatus, superseded_by_system_id: state.supersededBy }] };
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
            connect: vitest_1.vi.fn(async () => ({ query: clientQuery, release: vitest_1.vi.fn() })),
        },
        query,
    };
});
vitest_1.vi.mock('../db/audit', () => ({ logAudit: vitest_1.vi.fn(async () => undefined) }));
function request(app, path, body, role = 'engineer') {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const token = jsonwebtoken_1.default.sign({ id: 'user-1', email: 'user@example.com', role }, testSecret);
            const payload = JSON.stringify(body);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'POST',
                path,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            }, response => {
                let data = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { data += chunk; });
                response.on('end', () => server.close(error => {
                    if (error)
                        return reject(error);
                    resolve({ status: response.statusCode || 0, body: data ? JSON.parse(data) : {} });
                }));
            });
            req.on('error', reject);
            req.end(payload);
        });
    });
}
(0, vitest_1.describe)('governed LSS lifecycle', () => {
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
        state.moduleAccess = 'manage';
        state.sourceStatus = 'Design';
        state.sourceProject = 'project-1';
        state.replacementProject = 'project-1';
        state.replacementStatus = 'Design';
        state.supersededBy = null;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('requires an accountable archive reason', async () => {
        const response = await request(app, '/api/v1/systems/system-1/archive', { reason: '   ' });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('REASON_REQUIRED');
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'BEGIN')).toBe(false);
    });
    (0, vitest_1.it)('archives atomically and writes transition evidence', async () => {
        const response = await request(app, '/api/v1/systems/system-1/archive', { reason: 'Plant retired' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.status).toBe('Decommissioned');
        const audit = state.calls.find(call => call.sql.includes("VALUES ('system',$1,'ARCHIVE'"));
        (0, vitest_1.expect)(audit?.params[2]).toMatchObject({
            reason: 'Plant retired',
            previous_status: 'Design',
            new_status: 'Decommissioned',
        });
        (0, vitest_1.expect)(state.calls.some(call => call.sql === 'COMMIT')).toBe(true);
    });
    (0, vitest_1.it)('preserves bidirectional supersession and is safe to repeat', async () => {
        const first = await request(app, '/api/v1/systems/system-1/supersede', {
            reason: 'Capacity replacement',
            replacement_system_id: 'system-2',
        });
        (0, vitest_1.expect)(first.status).toBe(200);
        (0, vitest_1.expect)(first.body).toMatchObject({ status: 'Superseded', superseded_by_system_id: 'system-2' });
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE systems SET supersedes_system_id=$1')
            && call.params[0] === 'system-1'
            && call.params[1] === 'system-2')).toBe(true);
        state.calls.length = 0;
        const repeated = await request(app, '/api/v1/systems/system-1/supersede', {
            reason: 'Capacity replacement',
            replacement_system_id: 'system-2',
        });
        (0, vitest_1.expect)(repeated.status).toBe(200);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes("SET status='Superseded'"))).toBe(false);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes("VALUES ('system',$1,'SUPERSEDE'"))).toBe(false);
    });
    (0, vitest_1.it)('rejects a replacement from another project and read-only users', async () => {
        state.replacementProject = 'project-2';
        const mismatch = await request(app, '/api/v1/systems/system-1/supersede', {
            reason: 'Replacement',
            replacement_system_id: 'system-2',
        });
        (0, vitest_1.expect)(mismatch.status).toBe(409);
        (0, vitest_1.expect)(mismatch.body.error.code).toBe('REPLACEMENT_PROJECT_MISMATCH');
        const forbidden = await request(app, '/api/v1/systems/system-1/archive', {
            reason: 'Replacement',
        }, 'viewer');
        (0, vitest_1.expect)(forbidden.status).toBe(403);
    });
});
