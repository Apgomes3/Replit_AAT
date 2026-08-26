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
const testSecret = 'design-books-hydraulics-test-secret';
const actorId = 'actor-1';
const bookId = 'book-1';
const exhibitId = 'exhibit-1';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        return { rows: [{ id: 'hydraulics-1' }] };
    });
    return { query, default: { query } };
});
function request(app, token, body) {
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
                path: `/api/v1/design-books/${bookId}/exhibits/${exhibitId}/hydraulics`,
                method: 'PUT',
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
                        resolve({ status: res.statusCode ?? 0, body: JSON.parse(response) });
                    });
                });
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('design-book hydraulics weir persistence', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: designBookRoutes } = await Promise.resolve().then(() => __importStar(require('./designBooks')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', designBookRoutes);
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'actor@example.com', role: 'engineer' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('preserves every saved weir field when an older client omits them', async () => {
        const response = await request(app, token, {
            target_turnover_rate: 5,
            surface_skim_pct: 30,
            bottom_drain_pct: 70,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        const call = state.calls[0];
        (0, vitest_1.expect)(call.sql).toContain('CASE WHEN $13');
        (0, vitest_1.expect)(call.params.slice(12, 18)).toEqual([false, false, false, false, false, false]);
    });
    (0, vitest_1.it)('updates all Francis basis fields when they are explicitly supplied', async () => {
        const response = await request(app, token, {
            target_turnover_rate: 5,
            surface_skim_pct: 30,
            bottom_drain_pct: 70,
            weir_head_mm: 100,
            weir_formula_method: 'francis_184',
            weir_geometry: 'sharp_rectangular',
            weir_end_contractions: 2,
            weir_discharge_condition: 'free',
            weir_downstream_head_mm: 0,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.calls[0].params.slice(12, 18)).toEqual([true, true, true, true, true, true]);
    });
    (0, vitest_1.it)('allows an explicit null to clear a saved basis field without treating it as omitted', async () => {
        const response = await request(app, token, { weir_formula_method: null });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(state.calls[0].params[7]).toBeNull();
        (0, vitest_1.expect)(state.calls[0].params[13]).toBe(true);
    });
});
