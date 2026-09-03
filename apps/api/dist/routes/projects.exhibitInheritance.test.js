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
const testSecret = 'exhibit-inheritance-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    source: {
        id: 'exhibit-source',
        project_id: 'project-1',
        water_type: 'Marine',
        design_temperature_min: 24,
        design_temperature_max: 26,
    },
    calls: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [{ access_level: 'manage' }] };
        if (sql.includes('FROM exhibits WHERE id=$1 AND project_id=$2')) {
            return {
                rows: state.source && params[0] === state.source.id && params[1] === state.source.project_id
                    ? [{ ...state.source }]
                    : [],
            };
        }
        if (sql.includes('INSERT INTO exhibits')) {
            return { rows: [{ id: 'exhibit-new', water_type: params[4], design_temperature_min: params[5], design_temperature_max: params[6] }] };
        }
        return { rows: [] };
    });
    return { query, default: { query } };
});
function request(app, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('Could not determine test server port'));
            const payload = JSON.stringify(body);
            const token = jsonwebtoken_1.default.sign({ id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1', port: address.port, path: '/api/v1/exhibits', method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            }, res => {
                let response = '';
                res.on('data', chunk => { response += chunk; });
                res.on('end', () => server.close(error => error
                    ? reject(error)
                    : resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} })));
            });
            req.on('error', reject);
            req.end(payload);
        });
    });
}
(0, vitest_1.describe)('POST /exhibits previous-exhibit inheritance', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: projectRoutes } = await Promise.resolve().then(() => __importStar(require('./projects')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', projectRoutes);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.source = {
            id: 'exhibit-source', project_id: 'project-1', water_type: 'Marine',
            design_temperature_min: 24, design_temperature_max: 26,
        };
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('copies only missing water type and design temperatures from a same-project exhibit', async () => {
        const response = await request(app, {
            exhibit_code: 'EX-02', exhibit_name: 'New Exhibit', project_id: 'project-1',
            inherit_from_exhibit_id: 'exhibit-source',
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        const insert = state.calls.find(call => call.sql.includes('INSERT INTO exhibits'));
        (0, vitest_1.expect)(insert?.params).toEqual(['EX-02', 'project-1', undefined, 'New Exhibit', 'Marine', 24, 26, undefined]);
        (0, vitest_1.expect)(insert?.sql).not.toContain('inherit_from_exhibit_id');
        (0, vitest_1.expect)(state.source).toEqual({
            id: 'exhibit-source', project_id: 'project-1', water_type: 'Marine',
            design_temperature_min: 24, design_temperature_max: 26,
        });
    });
    (0, vitest_1.it)('keeps explicitly supplied values instead of inherited values', async () => {
        await request(app, {
            exhibit_code: 'EX-02', exhibit_name: 'New Exhibit', project_id: 'project-1',
            inherit_from_exhibit_id: 'exhibit-source', water_type: 'Freshwater',
            design_temperature_min: 20, design_temperature_max: 22,
        });
        const insert = state.calls.find(call => call.sql.includes('INSERT INTO exhibits'));
        (0, vitest_1.expect)(insert?.params.slice(4, 7)).toEqual(['Freshwater', 20, 22]);
    });
    (0, vitest_1.it)('rejects a previous exhibit outside the new exhibit project', async () => {
        const response = await request(app, {
            exhibit_code: 'EX-02', exhibit_name: 'New Exhibit', project_id: 'other-project',
            inherit_from_exhibit_id: 'exhibit-source',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_REFERENCE');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO exhibits'))).toBe(false);
    });
});
