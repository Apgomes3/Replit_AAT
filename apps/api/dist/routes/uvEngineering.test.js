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
const testSecret = 'uv-engineering-test-secret';
const actorId = 'admin-1';
const state = vitest_1.vi.hoisted(() => ({
    revision: {
        id: 'revision-1',
        catalog_id: 'catalog-1',
        revision_number: 1,
        status: 'Draft',
        lamp_count: null,
        lamp_power_w: null,
        effective_reactor_volume_l: null,
        irradiance_85t_mw_cm2: null,
        irradiance_95t_mw_cm2: null,
        compatibility: null,
        arrangement: null,
        source_evidence: null,
    },
    queries: [],
    calls: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        state.queries.push(sql);
        state.calls.push({ sql, params });
        if (sql.startsWith('select rma.access_level'))
            return { rows: [] };
        if (sql === 'begin' || sql === 'commit' || sql === 'rollback')
            return { rows: [] };
        if (sql.startsWith('select id from uv_engineering_catalogs where id=$1 for update')) {
            return { rows: params[0] === 'catalog-1' ? [{ id: 'catalog-1' }] : [] };
        }
        if (sql.startsWith('select * from uv_engineering_revisions where catalog_id=$1 order by revision_number desc limit 1')) {
            return { rows: [{ ...state.revision }] };
        }
        if (sql.startsWith('select * from uv_engineering_revisions where id=$1')) {
            if (params[0] === 'foreign-revision') {
                return { rows: [{ ...state.revision, id: 'foreign-revision', catalog_id: 'catalog-2' }] };
            }
            return { rows: [{ ...state.revision }] };
        }
        if (sql.startsWith('insert into uv_engineering_revisions')) {
            return { rows: [{ ...state.revision, id: 'revision-2', revision_number: 2, supersedes_id: params[12] }] };
        }
        if (sql.startsWith('update uv_engineering_revisions set status=')) {
            state.revision = { ...state.revision, status: params[0] };
            return { rows: [{ ...state.revision }] };
        }
        if (sql.startsWith('update uv_engineering_catalogs set needs_review=false'))
            return { rows: [] };
        if (sql.includes("where c.needs_review=false") && sql.includes("approved.status='approved'")) {
            return {
                rows: [{
                        id: 'catalog-1',
                        product_code: 'UV-100',
                        selected_revision: { ...state.revision, status: 'Approved' },
                        latest_revision: { ...state.revision, status: 'Approved' },
                    }],
            };
        }
        return { rows: [] };
    });
    return {
        query,
        default: {
            query,
            connect: vitest_1.vi.fn(async () => ({ query, release: vitest_1.vi.fn() })),
        },
    };
});
vitest_1.vi.mock('../db/audit', () => ({
    logAudit: vitest_1.vi.fn(async () => undefined),
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
                        if (error)
                            return reject(error);
                        resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
                    });
                });
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('UV engineering lifecycle', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const routes = await Promise.resolve().then(() => __importStar(require('./uvEngineering')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1/admin/uv-engineering', routes.default);
        app.use('/api/v1', routes.uvEngineeringConsumerRoutes);
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'admin@example.com', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.queries.length = 0;
        state.calls.length = 0;
        state.revision = {
            id: 'revision-1',
            catalog_id: 'catalog-1',
            revision_number: 1,
            status: 'Draft',
            lamp_count: null,
            lamp_power_w: null,
            effective_reactor_volume_l: null,
            irradiance_85t_mw_cm2: null,
            irradiance_95t_mw_cm2: null,
            compatibility: null,
            arrangement: null,
            source_evidence: null,
        };
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    vitest_1.it.each([-1, 0])('rejects invalid engineering measurements before persistence (%s)', async (lampCount) => {
        const response = await request(app, 'PUT', '/api/v1/admin/uv-engineering/revisions/revision-1', token, { lamp_count: lampCount });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('VALIDATION');
        (0, vitest_1.expect)(state.queries.some(sql => sql.startsWith('update uv_engineering_revisions set lamp_count='))).toBe(false);
    });
    (0, vitest_1.it)('stores explicit water compatibility overrides on a draft revision', async () => {
        const response = await request(app, 'PUT', '/api/v1/admin/uv-engineering/revisions/revision-1', token, { compatibility_overrides: [{ water_type: 'Seawater', allowed: true }] });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.calls).toContainEqual(vitest_1.expect.objectContaining({
            sql: vitest_1.expect.stringContaining('insert into uv_engineering_revision_compatibility'),
            params: ['revision-1', 'Seawater', true],
        }));
    });
    (0, vitest_1.it)('rejects unknown water compatibility types', async () => {
        const response = await request(app, 'PUT', '/api/v1/admin/uv-engineering/revisions/revision-1', token, { compatibility_overrides: [{ water_type: 'Pool water', allowed: true }] });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('VALIDATION');
    });
    (0, vitest_1.it)('does not approve incomplete UV engineering evidence', async () => {
        const response = await request(app, 'PATCH', '/api/v1/admin/uv-engineering/revisions/revision-1/status', token, { status: 'Approved' });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INCOMPLETE_REVISION');
        (0, vitest_1.expect)(response.body.error.message).toContain('PIM lamp count');
        (0, vitest_1.expect)(response.body.error.message).toContain('positive effective reactor volume');
    });
    (0, vitest_1.it)('keeps approved revision values immutable', async () => {
        state.revision.status = 'Approved';
        const response = await request(app, 'PATCH', '/api/v1/admin/uv-engineering/revisions/revision-1/status', token, { status: 'Draft' });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('IMMUTABLE_REVISION');
    });
    (0, vitest_1.it)('does not rewrite approval evidence for a no-op Approved status request', async () => {
        state.revision.status = 'Approved';
        const response = await request(app, 'PATCH', '/api/v1/admin/uv-engineering/revisions/revision-1/status', token, { status: 'Approved' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.queries.some(sql => sql.startsWith('update uv_engineering_revisions set status='))).toBe(false);
    });
    (0, vitest_1.it)('clears the PIM review blocker when a complete revision is approved', async () => {
        state.revision = {
            ...state.revision,
            lamp_count: 2,
            lamp_power_w: 85,
            effective_reactor_volume_l: 120,
            irradiance_85t_mw_cm2: 1.2,
            irradiance_95t_mw_cm2: 1.6,
            compatibility: 'Marine and freshwater',
            arrangement: 'Two-lamp reactor',
            source_evidence: 'Manufacturer TDS',
        };
        const response = await request(app, 'PATCH', '/api/v1/admin/uv-engineering/revisions/revision-1/status', token, { status: 'Approved' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.queries).toContainEqual(vitest_1.expect.stringContaining('update uv_engineering_catalogs set needs_review=false'));
    });
    (0, vitest_1.it)('only exposes current PIM-linked approved records to calculations', async () => {
        const response = await request(app, 'GET', '/api/v1/uv-engineering/selectable', token);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.items).toHaveLength(1);
        const selectableSql = state.queries.find(sql => sql.includes("approved.status='approved'"));
        (0, vitest_1.expect)(selectableSql).toContain('c.needs_review=false');
        (0, vitest_1.expect)(selectableSql).toContain('row_to_json(r) as selected_revision');
        (0, vitest_1.expect)(response.body.items[0].selected_revision.status).toBe('Approved');
    });
    (0, vitest_1.it)('rejects revision lineage from another UV product', async () => {
        const response = await request(app, 'POST', '/api/v1/admin/uv-engineering/catalog-1/revisions', token, { source_revision_id: 'foreign-revision' });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_SOURCE_REVISION');
    });
    (0, vitest_1.it)('serializes revision allocation and links the immediate predecessor', async () => {
        const response = await request(app, 'POST', '/api/v1/admin/uv-engineering/catalog-1/revisions', token, { source_revision_id: 'revision-1' });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body.revision_number).toBe(2);
        (0, vitest_1.expect)(response.body.supersedes_id).toBe('revision-1');
        (0, vitest_1.expect)(state.queries).toContain('select id from uv_engineering_catalogs where id=$1 for update');
    });
});
