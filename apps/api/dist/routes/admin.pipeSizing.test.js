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
const testSecret = 'admin-pipe-sizing-test-secret';
const state = vitest_1.vi.hoisted(() => ({ failOperation: '' }));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql) => {
        if (sql.includes('SELECT dn FROM pipe_sizing_standards'))
            return { rows: [{ dn: 40 }] };
        if (sql.includes('SELECT 1 FROM design_book_exhibit_hydraulics'))
            return { rows: [] };
        if ((state.failOperation === 'update' && sql.includes('UPDATE pipe_sizing_standards')) ||
            (state.failOperation === 'delete' && sql.includes('DELETE FROM pipe_sizing_standards'))) {
            throw Object.assign(new Error('foreign key violation'), { code: '23503' });
        }
        return { rows: [{ id: 'standard-1', dn: 40 }] };
    });
    return { query, default: { query } };
});
function request(app, token, method, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No server address'));
            const payload = body ? JSON.stringify(body) : '';
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path: '/api/v1/admin/pipe-sizing-standards/standard-1',
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            }, res => {
                let response = '';
                res.on('data', chunk => { response += chunk; });
                res.on('end', () => server.close(() => resolve({
                    status: res.statusCode || 0,
                    body: response ? JSON.parse(response) : null,
                })));
            });
            req.on('error', reject);
            if (payload)
                req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('admin pipe sizing standard conflicts', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: routes } = await Promise.resolve().then(() => __importStar(require('./admin')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1/admin', routes);
        token = jsonwebtoken_1.default.sign({ id: 'admin-1', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => { state.failOperation = ''; });
    (0, vitest_1.it)('returns an in-use conflict when a concurrent save blocks a DN rename', async () => {
        state.failOperation = 'update';
        const response = await request(app, token, 'PUT', {
            dn: 40,
            internal_diameter_mm: 41,
            pressure_velocity_min_m_s: 1.5,
            pressure_velocity_max_m_s: 3,
            gravity_velocity_min_m_s: 0.1,
            gravity_velocity_max_m_s: 1.5,
            is_active: true,
        });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('IN_USE');
    });
    (0, vitest_1.it)('returns an in-use conflict when a concurrent save blocks deletion', async () => {
        state.failOperation = 'delete';
        const response = await request(app, token, 'DELETE');
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('IN_USE');
    });
});
