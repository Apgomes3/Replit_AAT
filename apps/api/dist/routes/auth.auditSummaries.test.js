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
const testSecret = 'auth-audit-summary-test-secret';
const actorId = 'user-1';
const state = vitest_1.vi.hoisted(() => ({
    auditRows: [],
}));
vitest_1.vi.mock('bcryptjs', () => ({
    default: {
        compare: vitest_1.vi.fn(async () => true),
        hash: vitest_1.vi.fn(async () => 'new-password-hash'),
    },
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.startsWith('select password_hash, email from users')) {
            return { rows: [{ password_hash: 'old-password-hash', email: 'user@example.com' }] };
        }
        if (sql.startsWith('select prt.*, u.id as uid')) {
            return { rows: [{ id: 'reset-token-1', uid: actorId, email: 'user@example.com' }] };
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
function request(app, method, path, token, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
            const payload = JSON.stringify(body);
            const headers = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            };
            if (token)
                headers.Authorization = `Bearer ${token}`;
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path,
                method,
                headers,
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
(0, vitest_1.describe)('persisted audit summaries for password reset mutations', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: authRoutes } = await Promise.resolve().then(() => __importStar(require('./auth')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1/auth', authRoutes);
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'user@example.com', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.auditRows.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('persists the self-service password reset summary', async () => {
        const response = await request(app, 'PATCH', '/api/v1/auth/change-password', token, {
            currentPassword: 'old-password',
            newPassword: 'new-password',
        });
        (0, vitest_1.expect)(response.status).toBe(204);
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType: 'user',
            entityId: actorId,
            action: 'RESET_PASSWORD',
            details: vitest_1.expect.objectContaining({
                summary: 'User password reset',
                self_service: true,
            }),
        }));
    });
    (0, vitest_1.it)('persists the reset-link password reset summary', async () => {
        const response = await request(app, 'POST', '/api/v1/auth/reset-password', undefined, {
            token: 'valid-reset-token',
            password: 'new-password',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType: 'user',
            entityId: actorId,
            action: 'RESET_PASSWORD',
            details: vitest_1.expect.objectContaining({
                summary: 'User password reset through reset link',
                via_reset_link: true,
            }),
        }));
    });
});
