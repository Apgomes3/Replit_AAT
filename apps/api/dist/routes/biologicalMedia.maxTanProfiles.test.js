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
const testSecret = 'maximum-tan-profile-route-test-secret';
const profile = {
    id: '00000000-0000-4000-8000-000000000001',
    profile_code: 'PUBLIC_AQUARIUM',
    profile_name: 'Public Aquarium',
    revision: 1,
    max_tan_mg_n_l: '0.1',
    engineering_note: 'Starting assumption.',
    status: 'Approved',
    is_default: true,
};
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [{ access_level: 'manage' }] };
        if (sql.includes('FROM lss_max_tan_profiles') && sql.includes('ORDER BY is_default')) {
            return { rows: [profile] };
        }
        throw new Error(`Unexpected query: ${sql}`);
    });
    const client = {
        query: vitest_1.vi.fn(async (sql, params = []) => {
            state.calls.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK')
                return { rows: [] };
            if (sql.includes('SELECT * FROM lss_max_tan_profiles WHERE id=$1 FOR UPDATE'))
                return { rows: [profile] };
            if (sql.includes('SET is_default=false'))
                return { rows: [] };
            if (sql.includes('SET is_default=true'))
                return { rows: [profile] };
            throw new Error(`Unexpected client query: ${sql}`);
        }),
        release: vitest_1.vi.fn(),
    };
    return {
        query,
        default: { query, connect: vitest_1.vi.fn(async () => client) },
    };
});
function request(app, method, path, role, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const payload = body == null ? null : JSON.stringify(body);
            const token = jsonwebtoken_1.default.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method,
                path,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            }, res => {
                let response = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { response += chunk; });
                res.on('end', () => server.close(error => {
                    if (error)
                        return reject(error);
                    resolve({ status: res.statusCode || 0, body: response ? JSON.parse(response) : {} });
                }));
            });
            req.on('error', reject);
            if (payload)
                req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('Maximum TAN profile routes', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: routes } = await Promise.resolve().then(() => __importStar(require('./biologicalMedia')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', routes);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('lists active controlled profiles and identifies the server default for an authenticated designer', async () => {
        const response = await request(app, 'GET', '/api/v1/biological-media/max-tan-profiles?approved_only=true', 'engineer');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.items).toEqual([profile]);
        (0, vitest_1.expect)(response.body.default_profile).toMatchObject({
            profile_code: 'PUBLIC_AQUARIUM',
            max_tan_mg_n_l: '0.1',
            is_default: true,
        });
    });
    (0, vitest_1.it)('rejects profile management by non-administrators', async () => {
        const response = await request(app, 'POST', '/api/v1/admin/biological-media/max-tan-profiles', 'engineer', {
            profile_code: 'OTHER',
            profile_name: 'Other',
            max_tan_mg_n_l: 0.2,
        });
        (0, vitest_1.expect)(response.status).toBe(403);
    });
    (0, vitest_1.it)('rejects invalid administrator values before writing a revision', async () => {
        const response = await request(app, 'POST', '/api/v1/admin/biological-media/max-tan-profiles', 'admin', {
            profile_code: 'BAD',
            profile_name: 'Bad',
            max_tan_mg_n_l: -0.1,
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('VALIDATION');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO lss_max_tan_profiles'))).toBe(false);
    });
    (0, vitest_1.it)('moves the effective default transactionally for an administrator', async () => {
        const response = await request(app, 'PATCH', `/api/v1/admin/biological-media/max-tan-profiles/${profile.id}/default`, 'admin');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toMatchObject({ id: profile.id, is_default: true });
        (0, vitest_1.expect)(state.calls.map(call => call.sql)).toEqual(vitest_1.expect.arrayContaining([
            'BEGIN',
            vitest_1.expect.stringContaining('SET is_default=false'),
            vitest_1.expect.stringContaining('SET is_default=true'),
            'COMMIT',
        ]));
    });
});
