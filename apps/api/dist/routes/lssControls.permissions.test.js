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
const secret = 'lss-control-permission-test';
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql) => {
        if (sql.includes('FROM design_books')) {
            return { rows: [{ id: 'book-1', project_id: 'project-1', status: 'Draft' }] };
        }
        if (sql.includes('FROM systems')) {
            return { rows: [{ id: 'lss-1', project_id: 'project-1', system_code: 'LSS-01', system_type: 'Life Support' }] };
        }
        if (sql.includes('FROM field_instrument_definitions')) {
            return { rows: [{
                        id: 'optional-definition', name: 'Optional sensor', tag_code: 'OS',
                        signal_type: 'digital', signal_direction: 'input', requirement_rule: 'optional',
                    }] };
        }
        if (sql.includes('module_key=\'pim\''))
            return { rows: [{ access_level: 'view' }] };
        if (sql.includes('role_module_access'))
            return { rows: [{ access_level: 'manage' }] };
        return { rows: [] };
    });
    return { default: { connect: vitest_1.vi.fn(async () => ({ query, release: vitest_1.vi.fn() })) }, query };
});
vitest_1.vi.mock('./designBooks', () => ({
    loadReleaseContext: vitest_1.vi.fn(async () => ({
        id: 'book-1', project_id: 'project-1', status: 'Draft',
        systems: [{ id: 'lss-1', project_id: 'project-1', system_code: 'LSS-01', system_type: 'Life Support' }],
    })),
}));
function request(app, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const payload = JSON.stringify(body);
            const token = jsonwebtoken_1.default.sign({ id: 'engineer-1', email: 'engineer@example.com', role: 'engineer' }, secret);
            const req = node_http_1.default.request({
                host: '127.0.0.1', port: server.address().port, method: 'PUT',
                path: '/api/v1/systems/lss-1/control',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            }, res => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => server.close(error => error
                    ? reject(error)
                    : resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : {} })));
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('LSS Control product overrides', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = secret;
        const { default: routes } = await Promise.resolve().then(() => __importStar(require('./lssControls')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', routes);
    });
    (0, vitest_1.afterAll)(() => { delete process.env.JWT_SECRET; });
    (0, vitest_1.it)('requires PIM manage access when an explicitly supplied null clears a product', async () => {
        const response = await request(app, {
            design_book_id: 'book-1', panel_type: 'PLC',
            instruments: [{ definition_id: 'optional-definition', quantity: 0, product_master_id: null }],
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error).toMatchObject({ code: 'MODULE_READ_ONLY' });
    });
});
