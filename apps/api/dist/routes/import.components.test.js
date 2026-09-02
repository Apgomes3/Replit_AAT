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
const node_fs_1 = __importDefault(require("node:fs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const testSecret = 'component-import-test-secret';
const actorId = 'component-import-actor';
const state = vitest_1.vi.hoisted(() => ({
    existingCodes: new Set(),
    materialCodes: new Set(),
    inserts: [],
    pendingInserts: [],
    failOnInsertCode: undefined,
    transactionActive: false,
    moduleAccessByUser: {},
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql === 'begin') {
            state.transactionActive = true;
            state.pendingInserts.length = 0;
            return { rows: [] };
        }
        if (sql === 'commit') {
            state.inserts.push(...state.pendingInserts);
            state.pendingInserts.length = 0;
            state.transactionActive = false;
            return { rows: [] };
        }
        if (sql === 'rollback') {
            state.pendingInserts.length = 0;
            state.transactionActive = false;
            return { rows: [] };
        }
        if (sql.startsWith('select rma.access_level')) {
            const accessLevel = state.moduleAccessByUser[String(params[0])];
            return { rows: accessLevel ? [{ access_level: accessLevel }] : [] };
        }
        if (sql.startsWith('select id from components where upper(component_code)=upper($1)')) {
            const requestedCode = String(params[0]).toUpperCase();
            const exists = [...state.existingCodes].some(code => code.toUpperCase() === requestedCode);
            return { rows: exists ? [{ id: 'existing-component' }] : [] };
        }
        if (sql.startsWith('select material_code from materials where material_code=$1')) {
            return { rows: state.materialCodes.has(String(params[0])) ? [{ material_code: params[0] }] : [] };
        }
        if (sql.startsWith('insert into components')) {
            if (state.failOnInsertCode && String(params[0]) === state.failOnInsertCode) {
                throw new Error(`simulated insert failure for ${state.failOnInsertCode}`);
            }
            if (state.transactionActive) {
                state.pendingInserts.push(params);
            }
            else {
                state.inserts.push(params);
            }
            state.existingCodes.add(String(params[0]));
            return { rows: [] };
        }
        return { rows: [] };
    });
    const withTransaction = vitest_1.vi.fn(async (work) => {
        await query('BEGIN');
        try {
            const result = await work({ query });
            await query('COMMIT');
            return result;
        }
        catch (error) {
            await query('ROLLBACK');
            throw error;
        }
    });
    return { query, withTransaction, default: { query } };
});
function multipartBody(csvText, fields) {
    const boundary = '----component-import-test-boundary';
    const chunks = [
        ...(fields ? [
            `--${boundary}\r\n`,
            'Content-Disposition: form-data; name="fields"\r\n\r\n',
            `${JSON.stringify(fields)}\r\n`,
        ] : []),
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="file"; filename="components.csv"\r\n',
        'Content-Type: text/csv\r\n\r\n',
        `${csvText}\r\n`,
        `--${boundary}--\r\n`,
    ];
    return { boundary, body: Buffer.from(chunks.join('')) };
}
function request(app, csvText, token, fields) {
    return new Promise((resolve, reject) => {
        const multipart = multipartBody(csvText, fields);
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Could not determine test server port'));
                return;
            }
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path: '/api/v1/import/components',
                method: 'POST',
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`,
                    'Content-Length': multipart.body.length,
                },
            }, response => {
                let responseBody = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { responseBody += chunk; });
                response.on('end', () => {
                    server.close(() => resolve({
                        status: response.statusCode ?? 0,
                        body: responseBody ? JSON.parse(responseBody) : {},
                    }));
                });
            });
            req.on('error', error => server.close(() => reject(error)));
            req.end(multipart.body);
        });
    });
}
(0, vitest_1.describe)('component CSV import', () => {
    let app;
    let token;
    let unlinkSpy;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: importRoutes } = await Promise.resolve().then(() => __importStar(require('./import')));
        app = (0, express_1.default)();
        app.use('/api/v1/import', importRoutes);
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
        unlinkSpy = vitest_1.vi.spyOn(node_fs_1.default.promises, 'unlink');
    });
    (0, vitest_1.beforeEach)(() => {
        state.existingCodes.clear();
        state.materialCodes.clear();
        state.inserts.length = 0;
        state.pendingInserts.length = 0;
        state.failOnInsertCode = undefined;
        state.transactionActive = false;
        state.moduleAccessByUser = {};
        unlinkSpy.mockClear();
    });
    (0, vitest_1.afterAll)(() => {
        unlinkSpy.mockRestore();
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('persists every supported field with numeric precision and the authenticated creator', async () => {
        state.materialCodes.add('MAT-SS316');
        const headers = [
            'component_code', 'component_name', 'component_type', 'component_category',
            'description', 'primary_material_code', 'standard_size', 'weight_kg', 'unit',
            'status', 'notes', 'synonyms', 'cost', 'sell_price', 'manufacturer', 'model',
        ];
        const response = await request(app, [
            headers.join(','),
            'cmp-001,Valve,Valve,Mechanical,Isolation valve,MAT-SS316,DN100,12.75,EA,Draft,Review,BFV; isolation valve,125.55,175.95,Acme,BV-100',
        ].join('\n'), token, headers);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toMatchObject({ imported: 1, skipped: 0, errors: [], total: 1 });
        (0, vitest_1.expect)(state.inserts[0]).toEqual([
            'CMP-001', 'Valve', 'Valve', 'Mechanical', 'Isolation valve', 'MAT-SS316',
            'DN100', 12.75, 'EA', 'Draft', 'Review', ['BFV', 'isolation valve'],
            actorId, 125.55, 175.95, 'Acme', 'BV-100',
        ]);
        (0, vitest_1.expect)(unlinkSpy).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('uses component-creation defaults when optional fields are blank or unselected', async () => {
        const response = await request(app, 'component_code,component_name\nCMP-DEFAULT,Default Component', token, ['component_code', 'component_name']);
        (0, vitest_1.expect)(response.body).toMatchObject({ imported: 1, skipped: 0 });
        (0, vitest_1.expect)(state.inserts[0]).toEqual([
            'CMP-DEFAULT', 'Default Component', 'Vessel', 'Mechanical', null, null,
            null, null, 'EA', 'Active', null, [], actorId, 0, null, null, null,
        ]);
    });
    (0, vitest_1.it)('reports invalid material references and numeric values with row and field context', async () => {
        const materialResponse = await request(app, 'component_code,component_name,primary_material_code\nCMP-MAT,Material Test,MAT-UNKNOWN', token, ['component_code', 'component_name', 'primary_material_code']);
        (0, vitest_1.expect)(materialResponse.body).toMatchObject({ imported: 0, skipped: 1, total: 1 });
        (0, vitest_1.expect)(materialResponse.body.errors[0]).toContain('Row 2: primary_material_code "MAT-UNKNOWN"');
        const numericResponse = await request(app, 'component_code,component_name,weight_kg\nCMP-WEIGHT,Weight Test,heavy', token, ['component_code', 'component_name', 'weight_kg']);
        (0, vitest_1.expect)(numericResponse.body).toMatchObject({ imported: 0, skipped: 1, total: 1 });
        (0, vitest_1.expect)(numericResponse.body.errors[0]).toBe('Row 2: weight_kg must be a valid number');
    });
    (0, vitest_1.it)('skips existing and repeated component codes without overwriting', async () => {
        state.existingCodes.add('cmp-existing');
        const response = await request(app, [
            'component_code,component_name',
            'CMP-EXISTING,Existing',
            'CMP-NEW,New',
            'cmp-new,Repeated',
        ].join('\n'), token, ['component_code', 'component_name']);
        (0, vitest_1.expect)(response.body).toMatchObject({ imported: 1, skipped: 2, total: 3 });
        (0, vitest_1.expect)(response.body.errors).toEqual([
            vitest_1.expect.stringContaining('CMP-EXISTING already exists'),
            vitest_1.expect.stringContaining('CMP-NEW is duplicated in this file'),
        ]);
        (0, vitest_1.expect)(state.inserts).toHaveLength(1);
    });
    (0, vitest_1.it)('rolls back earlier component rows when a later insert fails', async () => {
        state.failOnInsertCode = 'CMP-FAIL';
        const response = await request(app, 'component_code,component_name\nCMP-FIRST,First\nCMP-FAIL,Failed', token, ['component_code', 'component_name']);
        (0, vitest_1.expect)(response.status).toBe(500);
        (0, vitest_1.expect)(response.body).toMatchObject({
            imported: 0,
            error: { code: 'IMPORT_FAILED' },
        });
        (0, vitest_1.expect)(response.body.error.message).toContain('Component CSV import failed; no rows were imported');
        (0, vitest_1.expect)(response.body.error.message).toContain('simulated insert failure');
        (0, vitest_1.expect)(state.inserts).toHaveLength(0);
        (0, vitest_1.expect)(state.pendingInserts).toHaveLength(0);
        (0, vitest_1.expect)(state.transactionActive).toBe(false);
    });
    (0, vitest_1.it)('rejects unknown and unselected headers before any database write', async () => {
        const unknown = await request(app, 'component_code,component_name,created_by\nCMP-1,One,other-user', token, ['component_code', 'component_name']);
        (0, vitest_1.expect)(unknown.status).toBe(400);
        (0, vitest_1.expect)(unknown.body.error.message).toContain('Unknown component CSV column "created_by"');
        const unselected = await request(app, 'component_code,component_name,notes\nCMP-2,Two,Do not write', token, ['component_code', 'component_name']);
        (0, vitest_1.expect)(unselected.status).toBe(400);
        (0, vitest_1.expect)(unselected.body.error.message).toContain('CSV column "notes" was not selected');
        (0, vitest_1.expect)(state.inserts).toHaveLength(0);
        (0, vitest_1.expect)(unlinkSpy).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('requires authentication before accepting an upload', async () => {
        const response = await request(app, 'component_code,component_name\nCMP-1,One');
        (0, vitest_1.expect)(response.status).toBe(401);
        (0, vitest_1.expect)(state.inserts).toHaveLength(0);
    });
    (0, vitest_1.it)('rejects authenticated non-admin users before accepting an upload', async () => {
        const viewerId = 'component-import-viewer';
        state.moduleAccessByUser[viewerId] = 'view';
        const viewerToken = jsonwebtoken_1.default.sign({ id: viewerId, email: 'viewer@example.com', role: 'viewer' }, testSecret);
        const response = await request(app, 'component_code,component_name\nCMP-1,One', viewerToken, ['component_code', 'component_name']);
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error).toMatchObject({
            code: 'MODULE_READ_ONLY',
            message: 'Manage access is required for this module.',
        });
        (0, vitest_1.expect)(state.inserts).toHaveLength(0);
        (0, vitest_1.expect)(unlinkSpy).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects component CSV files larger than 5 MB before parsing rows', async () => {
        const oversizedCsv = `component_code,component_name\n${'X'.repeat(5 * 1024 * 1024)}`;
        const response = await request(app, oversizedCsv, token, ['component_code', 'component_name']);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body).toMatchObject({
            imported: 0,
            skipped: 0,
            total: 0,
            error: {
                code: 'INVALID_UPLOAD',
                message: 'Component CSV must be 5 MB or smaller',
            },
        });
        (0, vitest_1.expect)(state.inserts).toHaveLength(0);
    });
});
