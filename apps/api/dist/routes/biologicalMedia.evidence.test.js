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
const testSecret = 'biological-media-evidence-test-secret';
const calls = vitest_1.vi.hoisted(() => []);
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql) => {
        calls.push(sql);
        if (sql.includes('SELECT rma.access_level'))
            return { rows: [{ access_level: 'manage' }] };
        if (sql.includes('FROM lss_biological_media_evidence_records e')) {
            return {
                rows: [{
                        id: '00000000-0000-0000-0000-000000000001',
                        evidence_code: 'OBS_MARINE_FLUIDIZED_SAND',
                        revision: 1,
                        title: 'Marine fluidized sand filter',
                        record_type: 'Observation',
                        evidence_classification: 'Loading benchmark',
                        review_status: 'Review Needed',
                        is_approved: false,
                        promotable: false,
                        promotion_exclusion_reason: 'Loading benchmark is explicitly excluded from direct Overall-VTR promotion.',
                    }],
            };
        }
        if (sql.includes('FROM lss_biological_media_evidence_observations')) {
            return {
                rows: [{
                        evidence_record_id: '00000000-0000-0000-0000-000000000001',
                        observation_code: 'applied_tan_load',
                        value: '500',
                        value_text: '500',
                        unit: 'g TAN-N/m³/day',
                        qualifier: 'Loading benchmark',
                    }],
            };
        }
        if (sql.includes('FROM lss_biological_media_evidence_links'))
            return { rows: [] };
        return { rows: [] };
    });
    return { query, default: { query, connect: vitest_1.vi.fn() } };
});
function request(app, role) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No server address'));
            const token = jsonwebtoken_1.default.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path: '/api/v1/biological-media/evidence',
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
(0, vitest_1.describe)('Biological Media evidence API', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: routes } = await Promise.resolve().then(() => __importStar(require('./biologicalMedia')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', routes);
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('returns nested review evidence with explicit selector exclusion', async () => {
        const response = await request(app, 'admin');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.items[0]).toMatchObject({
            evidence_code: 'OBS_MARINE_FLUIDIZED_SAND',
            review_status: 'Review Needed',
            is_approved: false,
            promotable: false,
            selectable: false,
            approved: false,
            observations: [vitest_1.expect.objectContaining({
                    value_text: '500',
                    unit: 'g TAN-N/m³/day',
                    qualifier: 'Loading benchmark',
                })],
        });
        (0, vitest_1.expect)(calls.some(sql => sql.includes('lss_biological_media_profiles'))).toBe(false);
    });
    (0, vitest_1.it)('does not expose the review library to designer roles', async () => {
        const response = await request(app, 'engineer');
        (0, vitest_1.expect)(response.status).toBe(403);
    });
});
