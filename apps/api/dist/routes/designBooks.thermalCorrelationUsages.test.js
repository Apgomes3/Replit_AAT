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
const testSecret = 'thermal-correlation-usage-test-secret';
const correlationId = '00000000-0000-4000-8000-000000000154';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    usages: [
        {
            design_book_id: 'book-draft',
            design_book_status: 'Draft',
            book_code: 'DB-001',
            book_title: 'Draft thermal design',
            revision: 'A',
            project_id: 'project-1',
            project_code: 'P-001',
            project_name: 'Ocean Habitat',
            system_id: 'system-1',
            system_code: 'LSS-01',
            system_name: 'Main LSS',
            correlation_id: '00000000-0000-4000-8000-000000000154',
            captured_at: '2026-08-20T10:00:00.000Z',
        },
        {
            design_book_id: 'book-released',
            design_book_status: 'Released',
            book_code: 'DB-002',
            book_title: 'Released thermal design',
            revision: 'B',
            project_id: 'project-1',
            project_code: 'P-001',
            project_name: 'Ocean Habitat',
            system_id: 'system-2',
            system_code: 'LSS-02',
            system_name: 'Secondary LSS',
            correlation_id: '00000000-0000-4000-8000-000000000154',
            captured_at: '2026-08-25T10:00:00.000Z',
        },
    ],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
        }
        if (sql.includes('SELECT rma.access_level')) {
            return { rows: [{ access_level: 'manage' }] };
        }
        if (sql.includes('SELECT id FROM thermal_mass_transfer_correlations') &&
            sql.includes("status='approved'")) {
            return { rows: [{ id: correlationId }] };
        }
        if (sql.includes('SELECT id FROM design_books') && sql.includes('FOR SHARE')) {
            return { rows: state.usages.map(usage => ({ id: usage.design_book_id })) };
        }
        if (sql.includes('WHERE c.id=$1')) {
            return {
                rows: [{
                        id: correlationId,
                        class_id: 'class-1',
                        class_code: 'MODERATE',
                        class_name: 'Moderate',
                        class_description: null,
                        class_sort_order: 1,
                        class_is_active: true,
                        version: '2026.1',
                        coefficient_kg_m2_s_kpa: '0.000001',
                        source_reference: 'Engineering standard',
                        notes: null,
                        status: 'approved',
                        approved_by: 'admin-1',
                        approved_at: '2026-08-01T10:00:00.000Z',
                        superseded_by: null,
                        superseded_at: null,
                        created_at: '2026-08-01T10:00:00.000Z',
                        usage_count: '2',
                    }],
            };
        }
        if (sql.includes('SELECT design_book_id, design_book_status')) {
            return { rows: state.usages };
        }
        throw new Error(`Unexpected query in thermal correlation usage test: ${sql}`);
    });
    const client = { query, release: vitest_1.vi.fn() };
    return {
        query,
        default: {
            query,
            connect: vitest_1.vi.fn(async () => client),
        },
    };
});
function requestUsages(app) {
    return request(app, 'GET');
}
function request(app, method, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
            const token = jsonwebtoken_1.default.sign({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path: `/api/v1/thermal-correlations/versions/${correlationId}/${method === 'GET' ? 'usages' : 'supersede'}`,
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(body ? {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(JSON.stringify(body)),
                    } : {}),
                },
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
            if (body)
                req.write(JSON.stringify(body));
            req.end();
        });
    });
}
(0, vitest_1.describe)('thermal correlation captured usage', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: designBookRoutes } = await Promise.resolve().then(() => __importStar(require('./designBooks')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', designBookRoutes);
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('returns the version count and read-only usages across editable and frozen books', async () => {
        const response = await requestUsages(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.correlation).toMatchObject({
            id: correlationId,
            class_code: 'MODERATE',
            version: '2026.1',
            usage_count: 2,
        });
        (0, vitest_1.expect)(response.body.usages).toEqual(state.usages);
        (0, vitest_1.expect)(response.body.impact_token).toMatch(/^[a-f0-9]{64}\.[a-f0-9]{64}$/);
        const usageQuery = state.calls.find(call => call.sql.includes('SELECT design_book_id, design_book_status'));
        (0, vitest_1.expect)(usageQuery?.params).toEqual([correlationId]);
        (0, vitest_1.expect)(usageQuery?.sql).toContain("db.status IN ('Draft', 'In Progress')");
        (0, vitest_1.expect)(usageQuery?.sql).toContain("db.status IN ('For Review', 'Approved')");
        (0, vitest_1.expect)(usageQuery?.sql).toContain("db.status='Released'");
        (0, vitest_1.expect)(usageQuery?.sql).toContain("db.review_snapshot->'thermal_calculations'");
        (0, vitest_1.expect)(usageQuery?.sql).toContain("db.release_snapshot->'thermal_calculations'");
    });
    (0, vitest_1.it)('rejects a direct supersede request that did not acknowledge the current usage', async () => {
        const response = await request(app, 'POST', {});
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error).toMatchObject({
            code: 'THERMAL_CORRELATION_IMPACT_CHANGED',
        });
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes("SET status='superseded'"))).toBe(false);
    });
});
