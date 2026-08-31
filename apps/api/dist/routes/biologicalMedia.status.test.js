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
const testSecret = 'biological-media-status-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    profiles: {
        tan: {
            id: 'tan-profile-1',
            profile_code: 'TAN-TEST',
            profile_name: 'Test TAN profile',
            coefficient: 0.09216,
            coefficient_unit: 'kg TAN-N/kg feed protein',
            recommended_application: 'Test approval',
            scope_type: 'Global feeding',
            scope_unit: null,
            scope_min: null,
            scope_max: null,
            evidence_reference: 'TAN-REF-TEST',
            status: 'Draft',
            edit_version: 1,
        },
        media: {
            id: 'media-profile-1',
            profile_code: 'MEDIA-TEST',
            profile_name: 'Test media profile',
            water_types: ['Freshwater'],
            reactor_types: ['Moving bed biofilter'],
            capacity_model: 'MANUAL',
            capacity_model_version: '1',
            capacity_basis_unit: 'g TAN/m3/day',
            operating_min_temperature_c: 10,
            operating_max_temperature_c: 28,
            operating_min_salinity_ppt: 0,
            operating_max_salinity_ppt: 5,
            media_min_depth_mm: 500,
            media_max_depth_mm: 1200,
            media_void_fraction: 0.65,
            media_bulk_density_kg_m3: 110,
            evidence_reference: 'MEDIA-REF-TEST',
            status: 'Draft',
            edit_version: 1,
        },
    },
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [] };
        if (sql.includes('SELECT * FROM lss_tan_generation_profiles WHERE id=$1')) {
            return { rows: [{ ...state.profiles.tan }] };
        }
        if (sql.includes('SELECT * FROM lss_biological_media_profiles WHERE id=$1')) {
            return { rows: [{ ...state.profiles.media }] };
        }
        if ((sql.includes('UPDATE lss_tan_generation_profiles')
            || sql.includes('UPDATE lss_biological_media_profiles'))
            && sql.includes('SET profile_name=$1')) {
            const profile = sql.includes('lss_tan_generation_profiles')
                ? state.profiles.tan
                : state.profiles.media;
            return { rows: [{ ...profile, status: params.at(-2) }] };
        }
        if (sql.includes('UPDATE lss_tan_generation_profiles SET status=')
            || sql.includes('UPDATE lss_biological_media_profiles SET status=')) {
            // PostgreSQL raises 42P08 for the old query because $1 is reused as
            // both a VARCHAR column value and an untyped comparison operand.
            if (!sql.includes('$1::varchar')) {
                const error = new Error('inconsistent types deduced for parameter $1');
                error.code = '42P08';
                throw error;
            }
            const profile = sql.includes('lss_tan_generation_profiles')
                ? state.profiles.tan
                : state.profiles.media;
            return { rows: [{ ...profile, status: params[0] }] };
        }
        return { rows: [] };
    });
    return {
        default: {
            query,
            connect: vitest_1.vi.fn(async () => ({ query, release: vitest_1.vi.fn() })),
        },
        query,
    };
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
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path,
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(JSON.stringify(body)),
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
            req.end(JSON.stringify(body));
        });
        server.on('error', reject);
    });
}
(0, vitest_1.describe)('Biological Media profile status updates', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: biologicalMediaRoutes } = await Promise.resolve().then(() => __importStar(require('./biologicalMedia')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', biologicalMediaRoutes);
        token = jsonwebtoken_1.default.sign({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        Object.assign(state.profiles.tan, {
            profile_code: 'TAN-TEST',
            coefficient: 0.09216,
            evidence_reference: 'TAN-REF-TEST',
            status: 'Draft',
        });
        state.profiles.media.status = 'Draft';
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('approves TAN profiles when the reused status parameter is explicitly typed', async () => {
        const response = await request(app, 'PATCH', '/api/v1/admin/biological-media/tan-profiles/tan-profile-1/status', token, { status: 'Approved' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.status).toBe('Approved');
        const update = state.calls.find(call => call.sql.includes('UPDATE lss_tan_generation_profiles'));
        (0, vitest_1.expect)(update?.sql.match(/\$1::varchar/g)).toHaveLength(4);
    });
    (0, vitest_1.it)('approves media profiles through the same type-safe status path', async () => {
        const response = await request(app, 'PATCH', '/api/v1/admin/biological-media/media-profiles/media-profile-1/status', token, { status: 'Approved' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.status).toBe('Approved');
        const update = state.calls.find(call => call.sql.includes('UPDATE lss_biological_media_profiles'));
        (0, vitest_1.expect)(update?.sql.match(/\$1::varchar/g)).toHaveLength(4);
    });
    (0, vitest_1.it)('validates the stored TAN revision instead of unsaved fields supplied with a status change', async () => {
        Object.assign(state.profiles.tan, {
            profile_code: 'SPECIES_AND_FEED_VALIDATED',
            coefficient: null,
            evidence_reference: null,
        });
        const response = await request(app, 'PATCH', '/api/v1/admin/biological-media/tan-profiles/tan-profile-1/status', token, {
            status: 'Approved',
            coefficient: 0.1,
            evidence_reference: 'UNSAVED-SPOOF',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.fields).toEqual(vitest_1.expect.arrayContaining([
            'Coefficient must be greater than zero.',
            'Evidence reference is required.',
        ]));
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE lss_tan_generation_profiles'))).toBe(false);
    });
    (0, vitest_1.it)('updates an In Review media revision in place, returns it to Draft, and audits changed fields', async () => {
        Object.assign(state.profiles.media, { status: 'In Review', evidence_reference: null });
        const response = await request(app, 'PATCH', '/api/v1/admin/biological-media/media-profiles/media-profile-1', token, {
            profile_code: 'SPOOFED-CODE',
            revision: 99,
            edit_version: state.profiles.media.edit_version,
            evidence_reference: 'MEDIA-REF-CORRECTED',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.status).toBe('Draft');
        const update = state.calls.find(call => call.sql.includes('UPDATE lss_biological_media_profiles') && call.sql.includes('SET profile_name=$1'));
        (0, vitest_1.expect)(update).toBeDefined();
        (0, vitest_1.expect)(update?.sql).not.toContain('profile_code=');
        (0, vitest_1.expect)(update?.sql).not.toContain('revision=');
        (0, vitest_1.expect)(update?.params.slice(-3)).toEqual(['media-profile-1', 'Draft', state.profiles.media.edit_version]);
        const audit = state.calls.find(call => call.sql.includes('INSERT INTO audit_logs'));
        (0, vitest_1.expect)(audit?.params[1]).toBe('media-profile-1');
        (0, vitest_1.expect)(audit?.params[3]).toBe('admin-1');
        (0, vitest_1.expect)(audit?.params[4]).toEqual(vitest_1.expect.objectContaining({
            profile_kind: 'media',
            profile_code: 'MEDIA-TEST',
            from_status: 'In Review',
            to_status: 'Draft',
            changed_fields: ['evidence_reference'],
        }));
    });
    (0, vitest_1.it)('updates a Draft TAN revision without creating a new revision', async () => {
        const response = await request(app, 'PATCH', '/api/v1/admin/biological-media/tan-profiles/tan-profile-1', token, {
            edit_version: state.profiles.tan.edit_version,
            recommended_application: 'Corrected controlled application',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const update = state.calls.find(call => call.sql.includes('UPDATE lss_tan_generation_profiles') && call.sql.includes('SET profile_name=$1'));
        (0, vitest_1.expect)(update?.params.slice(-3)).toEqual(['tan-profile-1', 'Draft', state.profiles.tan.edit_version]);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO lss_tan_generation_profiles'))).toBe(false);
    });
    (0, vitest_1.it)('rejects in-place edits to approved profile revisions', async () => {
        state.profiles.media.status = 'Approved';
        const response = await request(app, 'PATCH', '/api/v1/admin/biological-media/media-profiles/media-profile-1', token, { edit_version: state.profiles.media.edit_version, evidence_reference: 'SHOULD-NOT-SAVE' });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('IMMUTABLE_REVISION');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE lss_biological_media_profiles') && call.sql.includes('SET profile_name=$1'))).toBe(false);
    });
    (0, vitest_1.it)('rejects stale and missing edit tokens before overwriting a newer Draft', async () => {
        state.profiles.media.edit_version = 2;
        const stale = await request(app, 'PATCH', '/api/v1/admin/biological-media/media-profiles/media-profile-1', token, { edit_version: 1, evidence_reference: 'STALE-CHANGE' });
        (0, vitest_1.expect)(stale.status).toBe(409);
        (0, vitest_1.expect)(stale.body.error.code).toBe('REVISION_CHANGED');
        const missing = await request(app, 'PATCH', '/api/v1/admin/biological-media/media-profiles/media-profile-1', token, { evidence_reference: 'NO-TOKEN' });
        (0, vitest_1.expect)(missing.status).toBe(400);
        (0, vitest_1.expect)(missing.body.error.code).toBe('VALIDATION');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE lss_biological_media_profiles') && call.sql.includes('SET profile_name=$1'))).toBe(false);
    });
});
