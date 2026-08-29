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
const testSecret = 'biological-media-frozen-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    bookExists: true,
}));
vitest_1.vi.mock('../db', () => ({
    query: vitest_1.vi.fn(async (sql) => {
        state.calls.push(sql);
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [{ access_level: 'manage' }] };
        if (sql.includes('SELECT status, review_snapshot, release_snapshot FROM design_books')) {
            if (!state.bookExists)
                return { rows: [] };
            return {
                rows: [{
                        status: 'Released',
                        review_snapshot: null,
                        release_snapshot: {
                            systems: [{ id: 'system-1', water_type: 'Freshwater' }],
                            system_links: [{
                                    system_id: 'system-1',
                                    exhibit_id: 'exhibit-1',
                                    exhibit_code: 'EX-01',
                                }],
                            exhibits: [{
                                    id: 'exhibit-1',
                                    exhibit_code: 'EX-01',
                                    exhibit_name: 'Frozen Exhibit',
                                    water_type: 'Freshwater',
                                }],
                            engineering_calculations: {
                                exhibits: [{
                                        inputs: { exhibit_id: 'exhibit-1' },
                                        results: { operating_volume_m3: 42.125 },
                                    }],
                            },
                            biological_media_cases: [{
                                    id: 'case-frozen',
                                    system_id: 'system-1',
                                    design_book_id: 'book-1',
                                    reactor_type: 'Moving bed biofilter',
                                    media_profile_revision_id: 'media-1',
                                    tan_generation_profile_revision_id: 'tan-1',
                                    media_profile_status: 'Approved',
                                    tan_profile_status: 'Approved',
                                }],
                        },
                    }],
            };
        }
        throw new Error(`Unexpected live-data query: ${sql}`);
    }),
}));
function request(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const token = jsonwebtoken_1.default.sign({ id: 'user-1', email: 'user@example.com', role: 'engineer' }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'GET',
                path: '/api/v1/systems/system-1/biological-media?design_book_id=book-1',
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
(0, vitest_1.describe)('Biological Media frozen Design Book API context', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: biologicalMediaRoutes } = await Promise.resolve().then(() => __importStar(require('./biologicalMedia')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', biologicalMediaRoutes);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.bookExists = true;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('returns the captured case and volume without reading live exhibit tables', async () => {
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.case).toMatchObject({ id: 'case-frozen', reactor_type: 'Moving bed biofilter' });
        (0, vitest_1.expect)(response.body.context).toMatchObject({
            source: 'frozen_design_book_package',
            total_operating_volume_m3: 42.125,
        });
        (0, vitest_1.expect)(response.body.readiness_status).toBe('Draft');
        const sql = state.calls.join('\n');
        (0, vitest_1.expect)(sql).not.toContain('system_exhibit_links');
        (0, vitest_1.expect)(sql).not.toContain('FROM tanks');
        (0, vitest_1.expect)(sql).not.toContain('design_book_exhibit_hydraulics');
    });
    (0, vitest_1.it)('returns not found instead of disguising a rejected context as an empty draft', async () => {
        state.bookExists = false;
        const response = await request(app);
        (0, vitest_1.expect)(response.status).toBe(404);
        (0, vitest_1.expect)(response.body.error.code).toBe('NOT_FOUND');
    });
});
