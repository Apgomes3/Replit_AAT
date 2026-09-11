"use strict";
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
// @vitest-environment node
const node_http_1 = __importDefault(require("node:http"));
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const secret = 'water-density-test-secret';
const state = vitest_1.vi.hoisted(() => ({ calls: [] }));
vitest_1.vi.mock('../db', () => ({
    query: vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.startsWith('SELECT wdp'))
            return { rows: [] };
        if (sql.startsWith('SELECT * FROM water_density_parameters'))
            return { rows: [{ id: 'density-1', water_type: 'Freshwater' }] };
        if (sql.startsWith('INSERT INTO water_density_parameters'))
            return { rows: [{ id: 'density-1', water_type: params[0] }] };
        if (sql.startsWith('UPDATE water_density_parameters'))
            return { rows: [{ id: 'density-1', water_type: params[0] }] };
        if (sql.startsWith('DELETE FROM water_density_parameters'))
            return { rows: [{ id: 'density-1', water_type: 'Freshwater' }] };
        return { rows: [] };
    }),
    default: { connect: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../db/audit', () => ({ logAudit: vitest_1.vi.fn(async () => undefined) }));
function request(app, method, role, body, suffix = '') {
    return new Promise((resolve, reject) => {
        const token = jsonwebtoken_1.default.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, secret);
        const encoded = body === undefined ? undefined : JSON.stringify(body);
        const server = app.listen(0, () => {
            const address = server.address();
            const req = node_http_1.default.request({ host: '127.0.0.1', port: address.port, method, path: `/admin/chemical-parameters/water-density${suffix}`, headers: { Authorization: `Bearer ${token}`, ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) } }, res => {
                let text = '';
                res.on('data', chunk => { text += chunk; });
                res.on('end', () => server.close(error => error ? reject(error) : resolve({ status: res.statusCode || 0, body: text ? JSON.parse(text) : {} })));
            });
            req.on('error', reject);
            if (encoded)
                req.write(encoded);
            req.end();
        });
    });
}
const valid = { water_type: 'Freshwater', density_kg_m3: 998.2, conditions: '20 °C; practical salinity 0 PSU', unit: 'kg/m3', source: 'NIST Chemistry WebBook', is_active: true };
(0, vitest_1.describe)('water density parameter administration', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = secret;
        const { default: adminRoutes } = await Promise.resolve().then(() => __importStar(require('./admin')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/admin', adminRoutes);
    });
    (0, vitest_1.it)('permits only administrators to read and mutate the governed library', async () => {
        (0, vitest_1.expect)((await request(app, 'GET', 'engineer')).status).toBe(403);
        (0, vitest_1.expect)((await request(app, 'POST', 'engineer', valid)).status).toBe(403);
        (0, vitest_1.expect)((await request(app, 'PUT', 'engineer', valid, '/density-1')).status).toBe(403);
        (0, vitest_1.expect)((await request(app, 'DELETE', 'engineer', undefined, '/density-1')).status).toBe(403);
        (0, vitest_1.expect)((await request(app, 'POST', 'admin', valid)).status).toBe(201);
        (0, vitest_1.expect)((await request(app, 'PUT', 'admin', { ...valid, density_kg_m3: 999 }, '/density-1')).status).toBe(200);
        (0, vitest_1.expect)((await request(app, 'DELETE', 'admin', undefined, '/density-1')).status).toBe(204);
    });
    (0, vitest_1.it)('rejects invalid units, density, source, and water types before writing', async () => {
        for (const payload of [
            { ...valid, density_kg_m3: 0 },
            { ...valid, unit: 'kg/L' },
            { ...valid, source: '' },
            { ...valid, water_type: 'Saltwater' },
        ])
            (0, vitest_1.expect)((await request(app, 'POST', 'admin', payload)).status).toBe(400);
    });
});
