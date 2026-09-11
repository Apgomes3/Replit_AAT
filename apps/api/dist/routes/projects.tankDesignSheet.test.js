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
const secret = 'tank-design-sheet-test';
const state = vitest_1.vi.hoisted(() => ({ scoped: true, valid: true, audits: 0 }));
vitest_1.vi.mock('../db', () => ({
    default: { query: vitest_1.vi.fn() },
    query: vitest_1.vi.fn(async (sql) => {
        if (sql.includes('role_module_access'))
            return { rows: [{ access_level: 'manage' }] };
        if (sql.includes('FROM tanks t') && sql.includes('project_code'))
            return { rows: state.scoped ? [{
                        id: 'tank-1', project_id: 'project-1', project_code: 'P-1', project_name: 'Project',
                        tank_code: 'TK-1', tank_name: 'Tank', eff_shape: 'Rectangular', eff_length_mm: 2000,
                        eff_width_mm: 1000, eff_height_mm: 1200, gross_volume_m3: 2.4, design_volume_m3: 2,
                        eff_water_level_mm: state.valid ? 1000 : null, overflow_level_mm: state.valid ? 1100 : null,
                        exhibit_id: 'ex-1', exhibit_code: 'EX-1', exhibit_name: 'Exhibit', water_type: 'Freshwater',
                        design_temperature_min: 20, design_temperature_max: 22, system_id: null,
                    }] : [] };
        if (sql.includes('water_density_parameters'))
            return { rows: [{ id: 'density-1', water_type: 'Freshwater', density_kg_m3: 998.2, is_active: true, unit: 'kg/m3', conditions: '20 C', source: 'NIST' }] };
        if (sql.includes('design_book_thermal_calculations'))
            return { rows: [] };
        return { rows: [] };
    }),
}));
vitest_1.vi.mock('../db/audit', () => ({ logAudit: vitest_1.vi.fn(async () => { state.audits++; }) }));
function get(app, path, token) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const req = node_http_1.default.request({ host: '127.0.0.1', port: address.port, path, headers: token ? { Authorization: `Bearer ${token}` } : {} }, res => {
                const chunks = [];
                res.on('data', c => chunks.push(Buffer.from(c)));
                res.on('end', () => server.close(() => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) })));
            });
            req.on('error', reject);
            req.end();
        });
    });
}
(0, vitest_1.describe)('tank design-sheet endpoints', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = secret;
        token = jsonwebtoken_1.default.sign({ id: 'engineer', email: 'e@test', role: 'engineer' }, secret);
        const routes = await Promise.resolve().then(() => __importStar(require('./projects')));
        app = (0, express_1.default)();
        app.use('/api/v1', routes.default);
    });
    (0, vitest_1.it)('rejects unauthenticated PDF access and scopes preview tank to project', async () => {
        (0, vitest_1.expect)((await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet.pdf')).status).toBe(401);
        state.scoped = false;
        (0, vitest_1.expect)((await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet', token)).status).toBe(404);
        state.scoped = true;
    });
    (0, vitest_1.it)('returns a governed PDF with deterministic headers and audits generation', async () => {
        const response = await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet.pdf', token);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.headers['content-type']).toContain('application/pdf');
        (0, vitest_1.expect)(response.headers['content-disposition']).toContain('TK-1-tank-design-sheet.pdf');
        (0, vitest_1.expect)(response.body.subarray(0, 4).toString()).toBe('%PDF');
        (0, vitest_1.expect)(response.body.length).toBeGreaterThan(500);
        (0, vitest_1.expect)(state.audits).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('returns preview validation and blocks invalid PDF generation', async () => {
        state.valid = false;
        const preview = await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet', token);
        (0, vitest_1.expect)(preview.status).toBe(200);
        (0, vitest_1.expect)(JSON.parse(preview.body.toString()).validation.valid).toBe(false);
        (0, vitest_1.expect)((await get(app, '/api/v1/projects/P-1/tanks/tank-1/design-sheet.pdf', token)).status).toBe(422);
        state.valid = true;
    });
});
