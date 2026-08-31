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
const testSecret = 'biological-media-delete-profile-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    status: 'Draft',
    referenced: false,
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [{ access_level: 'manage' }] };
        if (sql.includes('SELECT * FROM lss_tan_generation_profiles WHERE id=$1')) {
            return {
                rows: [{
                        id: 'tan-profile-1',
                        profile_code: 'TAN-TEST',
                        profile_name: 'Test TAN profile',
                        status: state.status,
                    }],
            };
        }
        if (sql.includes('AS referenced_by_cases')) {
            return { rows: [{ referenced_by_cases: state.referenced, referenced_by_runs: false }] };
        }
        if (sql.includes('DELETE FROM lss_tan_generation_profiles')) {
            return { rows: [{ id: 'tan-profile-1' }] };
        }
        return { rows: [] };
    });
    return {
        query,
        default: { query, connect: vitest_1.vi.fn() },
    };
});
function request(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const token = jsonwebtoken_1.default.sign({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'DELETE',
                path: '/api/v1/admin/biological-media/tan-profiles/tan-profile-1',
                headers: { Authorization: `Bearer ${token}` },
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
            req.end();
        });
    });
}
(0, vitest_1.describe)('Biological Media profile deletion', () => {
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
        state.status = 'Draft';
        state.referenced = false;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('deletes an unreferenced Draft revision', async () => {
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toEqual({ deleted: true, id: 'tan-profile-1' });
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes("DELETE FROM lss_tan_generation_profiles WHERE id=$1 AND status='Draft'"))).toBe(true);
    });
    (0, vitest_1.it)('keeps referenced Draft revisions and directs the administrator to Retire', async () => {
        state.referenced = true;
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('PROFILE_REFERENCED');
        (0, vitest_1.expect)(response.body.error.message).toMatch(/use Retire instead/i);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('DELETE FROM lss_tan_generation_profiles'))).toBe(false);
    });
    (0, vitest_1.it)('never permanently deletes an Approved revision', async () => {
        state.status = 'Approved';
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('PROFILE_MUST_BE_RETIRED');
        (0, vitest_1.expect)(response.body.error.message).toMatch(/use Retire instead/i);
    });
});
