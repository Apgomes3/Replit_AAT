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
const aquariumCalculations_1 = require("../lib/aquariumCalculations");
const testSecret = 'design-books-release-test-secret';
const bookId = 'book-release-1';
const managerRoles = ['admin', 'hq_manager', 'pmo'];
const state = vitest_1.vi.hoisted(() => ({
    snapshot: {},
    calls: [],
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level')) {
            return { rows: [{ access_level: 'manage' }] };
        }
        if (sql.includes('SELECT db.*, p.project_scopes')) {
            return {
                rows: [{
                        id: bookId,
                        book_code: 'DB-RELEASE',
                        book_title: 'Release Gate Test',
                        revision: 'A',
                        status: 'Approved',
                        project_id: null,
                        project_scopes: state.snapshot.project_scopes,
                        review_snapshot: state.snapshot,
                    }],
            };
        }
        return { rows: [] };
    });
    const client = { query, release: vitest_1.vi.fn() };
    return {
        query,
        default: {
            query,
            connect: vitest_1.vi.fn(async () => client),
        },
    };
});
function validSnapshot() {
    return {
        id: bookId,
        book_code: 'DB-RELEASE',
        book_title: 'Release Gate Test',
        revision: 'A',
        project_id: 'project-1',
        project_scopes: ['Aquarium'],
        exhibits: [{ id: 'exhibit-1' }],
        tanks: [{ id: 'tank-1', exhibit_id: 'exhibit-1' }],
        species: [{ id: 'species-1', exhibit_id: 'exhibit-1' }],
        hydraulics: [{
                exhibit_id: 'exhibit-1',
                calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            }],
        systems: [],
        engineering_calculations: {
            exhibits: [{ status: 'valid', inputs: { exhibit_id: 'exhibit-1' } }],
            systems: [],
        },
    };
}
function requestRelease(app, role) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
            const token = jsonwebtoken_1.default.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
            const payload = JSON.stringify({
                revision: 'A',
                included_scope: state.snapshot.project_scopes,
                release_notes: 'Release gate API test',
                override_blockers: true,
                override_reason: 'This input must never bypass engineering blockers',
            });
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path: `/api/v1/design-books/${bookId}/release`,
                method: 'POST',
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
(0, vitest_1.describe)('Design Book release API blocker enforcement', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: designBookRoutes } = await Promise.resolve().then(() => __importStar(require('./designBooks')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', designBookRoutes);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    vitest_1.it.each(managerRoles)('rejects invalid and stale exhibit calculations for %s', async (role) => {
        state.snapshot = validSnapshot();
        state.snapshot.engineering_calculations.exhibits = [{
                status: 'invalid',
                is_stale: true,
                reasons: ['Target turnover is missing.'],
                inputs: { exhibit_id: 'exhibit-1' },
            }];
        const response = await requestRelease(app, role);
        (0, vitest_1.expect)(response.status).toBe(422);
        (0, vitest_1.expect)(response.body.error.code).toBe('RELEASE_BLOCKED');
        (0, vitest_1.expect)(response.body.blockers.map((item) => item.key)).toEqual(vitest_1.expect.arrayContaining(['calculations', 'calculation_freshness']));
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE design_books'))).toBe(false);
    });
    vitest_1.it.each(managerRoles)('rejects invalid LSS calculations for %s', async (role) => {
        state.snapshot = validSnapshot();
        state.snapshot.project_scopes = ['Aquarium', 'LSS'];
        state.snapshot.systems = [{
                id: 'system-1',
                system_config: 'Recirculating',
                system_type: 'Life Support',
                status: 'Design',
                design_flow_m3h: 120,
                calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
                loop1_flow_source: 'Exhibit return',
                loop1_filtration: 'Mechanical and biological',
            }];
        state.snapshot.engineering_calculations.systems = [{
                status: 'invalid',
                reasons: ['Linked flow allocation does not reconcile.'],
                inputs: { system_id: 'system-1' },
            }];
        const response = await requestRelease(app, role);
        (0, vitest_1.expect)(response.status).toBe(422);
        (0, vitest_1.expect)(response.body.error.code).toBe('RELEASE_BLOCKED');
        (0, vitest_1.expect)(response.body.blockers.map((item) => item.key)).toContain('calculations');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('UPDATE design_books'))).toBe(false);
    });
});
