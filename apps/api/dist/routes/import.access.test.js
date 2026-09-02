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
const testSecret = 'import-access-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    moduleAccessByUser: {},
    missingProjects: new Set(),
    writes: [],
    pendingWrites: [],
    failOnInsertCode: undefined,
    transactionActive: false,
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql === 'begin') {
            state.transactionActive = true;
            state.pendingWrites.length = 0;
            return { rows: [] };
        }
        if (sql === 'commit') {
            state.writes.push(...state.pendingWrites);
            state.pendingWrites.length = 0;
            state.transactionActive = false;
            return { rows: [] };
        }
        if (sql === 'rollback') {
            state.pendingWrites.length = 0;
            state.transactionActive = false;
            return { rows: [] };
        }
        if (sql.startsWith('select rma.access_level')) {
            const accessLevel = state.moduleAccessByUser[String(params[0])];
            return { rows: accessLevel ? [{ access_level: accessLevel }] : [] };
        }
        if (sql.includes('select id from projects where project_code=$1')) {
            if (state.missingProjects.has(String(params[0])))
                return { rows: [] };
            return { rows: [{ id: 'project-1' }] };
        }
        if (sql.startsWith('select id from components where upper(component_code)=upper($1)')) {
            return { rows: [] };
        }
        if (sql.startsWith('insert into')) {
            if (state.failOnInsertCode && String(params[0]) === state.failOnInsertCode) {
                throw new Error(`simulated insert failure for ${state.failOnInsertCode}`);
            }
            if (state.transactionActive) {
                state.pendingWrites.push(sql);
            }
            else {
                state.writes.push(sql);
            }
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
function multipartBody(csvText) {
    const boundary = '----import-access-test-boundary';
    const body = [
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="file"; filename="import.csv"\r\n',
        'Content-Type: text/csv\r\n\r\n',
        `${csvText}\r\n`,
        `--${boundary}--\r\n`,
    ].join('');
    return { boundary, body: Buffer.from(body) };
}
function request(app, path, csvText, token) {
    return new Promise((resolve, reject) => {
        const multipart = multipartBody(csvText);
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Could not determine test server port'));
                return;
            }
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path,
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
(0, vitest_1.describe)('CSV import access policy', () => {
    let app;
    let adminToken;
    let viewerToken;
    let hiddenToken;
    let engineerToken;
    let unlinkSpy;
    let diskUnlinkSpy;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: importRoutes } = await Promise.resolve().then(() => __importStar(require('./import')));
        app = (0, express_1.default)();
        app.use('/api/v1/import', importRoutes);
        adminToken = jsonwebtoken_1.default.sign({ id: 'import-admin', email: 'admin@example.com', role: 'admin' }, testSecret);
        viewerToken = jsonwebtoken_1.default.sign({ id: 'import-viewer', email: 'viewer@example.com', role: 'viewer' }, testSecret);
        hiddenToken = jsonwebtoken_1.default.sign({ id: 'import-hidden', email: 'hidden@example.com', role: 'contractor' }, testSecret);
        engineerToken = jsonwebtoken_1.default.sign({ id: 'import-engineer', email: 'engineer@example.com', role: 'engineer' }, testSecret);
        unlinkSpy = vitest_1.vi.spyOn(node_fs_1.default.promises, 'unlink');
        diskUnlinkSpy = vitest_1.vi.spyOn(node_fs_1.default, 'unlink');
    });
    (0, vitest_1.beforeEach)(() => {
        state.moduleAccessByUser = {
            'import-viewer': 'view',
            'import-hidden': 'hidden',
            'import-engineer': 'manage',
        };
        state.missingProjects.clear();
        state.writes.length = 0;
        state.pendingWrites.length = 0;
        state.failOnInsertCode = undefined;
        state.transactionActive = false;
        unlinkSpy.mockClear();
        diskUnlinkSpy.mockClear();
    });
    (0, vitest_1.afterAll)(() => {
        unlinkSpy.mockRestore();
        diskUnlinkSpy.mockRestore();
        delete process.env.JWT_SECRET;
    });
    vitest_1.it.each([
        ['/products', 'product_code,product_name\nPM-ACCESS,Access Product'],
        ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-ACCESS,PRJ-ACCESS,Access Equipment'],
        ['/documents', 'document_code,document_title\nDOC-ACCESS,Access Document'],
        ['/components', 'component_code,component_name\nCMP-ACCESS,Access Component'],
    ])('allows platform admins to import via %s', async (path, csvText) => {
        const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);
        (0, vitest_1.expect)(response.status).toBe(200);
    });
    vitest_1.it.each([
        ['/products', 'product_code,product_name\nPM-ACCESS,Access Product'],
        ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-ACCESS,PRJ-ACCESS,Access Equipment'],
        ['/documents', 'document_code,document_title\nDOC-ACCESS,Access Document'],
        ['/components', 'component_code,component_name\nCMP-ACCESS,Access Component'],
    ])('allows module managers to import via %s', async (path, csvText) => {
        const response = await request(app, `/api/v1/import${path}`, csvText, engineerToken);
        (0, vitest_1.expect)(response.status).toBe(200);
    });
    vitest_1.it.each([
        ['/products', 'product_code,product_name\nPM-DENIED,Denied Product'],
        ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-DENIED,PRJ-DENIED,Denied Equipment'],
        ['/documents', 'document_code,document_title\nDOC-DENIED,Denied Document'],
        ['/components', 'component_code,component_name\nCMP-DENIED,Denied Component'],
    ])('rejects read-only users with a clear 403 on %s', async (path, csvText) => {
        const response = await request(app, `/api/v1/import${path}`, csvText, viewerToken);
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error).toEqual({
            code: 'MODULE_READ_ONLY',
            message: 'Manage access is required for this module.',
        });
    });
    vitest_1.it.each([
        ['/products', 'product_code,product_name\nPM-HIDDEN,Hidden Product'],
        ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-HIDDEN,PRJ-HIDDEN,Hidden Equipment'],
        ['/documents', 'document_code,document_title\nDOC-HIDDEN,Hidden Document'],
        ['/components', 'component_code,component_name\nCMP-HIDDEN,Hidden Component'],
    ])('rejects hidden users with a clear 403 on %s', async (path, csvText) => {
        const response = await request(app, `/api/v1/import${path}`, csvText, hiddenToken);
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error).toEqual({
            code: 'MODULE_HIDDEN',
            message: 'This module is hidden for your role.',
        });
    });
    vitest_1.it.each([
        ['/products', 'product_code,product_name\nPM-CLEAN,Clean Product'],
        ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-CLEAN,PRJ-CLEAN,Clean Equipment'],
        ['/documents', 'document_code,document_title\nDOC-CLEAN,Clean Document'],
    ])('cleans up the temporary file after a successful %s import', async (path, csvText) => {
        const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(unlinkSpy).toHaveBeenCalledTimes(1);
    });
    vitest_1.it.each([
        ['/products', 'product_code,product_name\nPM-BAD'],
        ['/equipment', 'equipment_code,project_code,equipment_name\nEQ-BAD,PRJ-BAD'],
        ['/documents', 'document_code,document_title\nDOC-BAD'],
    ])('rejects malformed %s uploads before writing and cleans up', async (path, csvText) => {
        const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error).toMatchObject({ code: 'INVALID_CSV' });
        (0, vitest_1.expect)(response.body.error.message).toContain('Row length does not match headers');
        (0, vitest_1.expect)(state.writes).toHaveLength(0);
        (0, vitest_1.expect)(unlinkSpy).toHaveBeenCalledTimes(1);
    });
    vitest_1.it.each([
        [
            '/products',
            'product_code,product_name\nPM-ROW-1,\n,Second Product',
            ['Product CSV row 2 field "product_name" is required', 'Product CSV row 3 field "product_code" is required'],
        ],
        [
            '/equipment',
            'equipment_code,project_code,equipment_name\nEQ-ROW-1,PRJ-ROW-1,\n,PRJ-ROW-2,Second Equipment',
            ['Equipment CSV row 2 field "equipment_name" is required', 'Equipment CSV row 3 field "equipment_code" is required'],
        ],
        [
            '/documents',
            'document_code,document_title\nDOC-ROW-1,\n,Second Document',
            ['Document CSV row 2 field "document_title" is required', 'Document CSV row 3 field "document_code" is required'],
        ],
    ])('reports all row validation errors before mutating %s', async (path, csvText, expectedErrors) => {
        const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error).toMatchObject({ code: 'INVALID_CSV' });
        (0, vitest_1.expect)(response.body.errors).toEqual(expectedErrors);
        (0, vitest_1.expect)(response.body.error.details).toEqual(expectedErrors);
        (0, vitest_1.expect)(response.body.imported).toBe(0);
        (0, vitest_1.expect)(response.body.total).toBe(2);
        (0, vitest_1.expect)(state.writes).toHaveLength(0);
    });
    (0, vitest_1.it)('validates all equipment project references before importing any rows', async () => {
        state.missingProjects.add('PRJ-MISSING');
        const response = await request(app, '/api/v1/import/equipment', 'equipment_code,project_code,equipment_name\nEQ-VALID,PRJ-VALID,Valid Equipment\nEQ-MISSING,PRJ-MISSING,Missing Project', adminToken);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.errors).toEqual([
            'Equipment CSV row 3 field "project_code": project "PRJ-MISSING" was not found',
        ]);
        (0, vitest_1.expect)(state.writes).toHaveLength(0);
    });
    (0, vitest_1.it)('rejects a blank equipment project reference before importing earlier rows', async () => {
        const response = await request(app, '/api/v1/import/equipment', 'equipment_code,project_code,equipment_name\nEQ-VALID,PRJ-VALID,Valid Equipment\nEQ-BLANK,,Blank Project', adminToken);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.errors).toEqual([
            'Equipment CSV row 3 field "project_code" is required',
        ]);
        (0, vitest_1.expect)(response.body.imported).toBe(0);
        (0, vitest_1.expect)(state.writes).toHaveLength(0);
    });
    (0, vitest_1.it)('rejects a padded equipment project reference before importing earlier rows', async () => {
        const response = await request(app, '/api/v1/import/equipment', 'equipment_code,project_code,equipment_name\nEQ-VALID,PRJ-VALID,Valid Equipment\nEQ-PADDED, PRJ-PADDED ,Padded Project', adminToken);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.errors).toEqual([
            'Equipment CSV row 3 field "project_code" must not have leading or trailing whitespace',
        ]);
        (0, vitest_1.expect)(response.body.imported).toBe(0);
        (0, vitest_1.expect)(state.writes).toHaveLength(0);
    });
    vitest_1.it.each([
        [
            '/products',
            'product_code,product_name\nPM-FIRST,First Product\nPM-FAIL,Failed Product',
            'PM-FAIL',
            'Product',
        ],
        [
            '/equipment',
            'equipment_code,project_code,equipment_name\nEQ-FIRST,PRJ-FIRST,First Equipment\nEQ-FAIL,PRJ-FAIL,Failed Equipment',
            'EQ-FAIL',
            'Equipment',
        ],
        [
            '/documents',
            'document_code,document_title\nDOC-FIRST,First Document\nDOC-FAIL,Failed Document',
            'DOC-FAIL',
            'Document',
        ],
    ])('rolls back earlier rows when a later %s insert fails', async (path, csvText, failedCode, destination) => {
        state.failOnInsertCode = failedCode;
        const response = await request(app, `/api/v1/import${path}`, csvText, adminToken);
        (0, vitest_1.expect)(response.status).toBe(500);
        (0, vitest_1.expect)(response.body).toMatchObject({
            imported: 0,
            total: 2,
            error: {
                code: 'IMPORT_FAILED',
            },
        });
        (0, vitest_1.expect)(response.body.error.message).toContain(`${destination} CSV import failed; no rows were imported`);
        (0, vitest_1.expect)(response.body.error.message).toContain('simulated insert failure');
        (0, vitest_1.expect)(state.writes).toHaveLength(0);
        (0, vitest_1.expect)(state.pendingWrites).toHaveLength(0);
        (0, vitest_1.expect)(state.transactionActive).toBe(false);
    });
    vitest_1.it.each([
        ['/products', 'Product'],
        ['/equipment', 'Equipment'],
        ['/documents', 'Document'],
    ])('rejects oversized %s uploads without leaving a temporary file', async (path, destination) => {
        const oversizedCsv = `code,name\n${'X'.repeat(5 * 1024 * 1024)}`;
        const response = await request(app, `/api/v1/import${path}`, oversizedCsv, adminToken);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body).toMatchObject({
            imported: 0,
            skipped: 0,
            total: 0,
            error: {
                code: 'INVALID_UPLOAD',
                message: `${destination} CSV must be 5 MB or smaller`,
            },
        });
        (0, vitest_1.expect)(state.writes).toHaveLength(0);
        (0, vitest_1.expect)(diskUnlinkSpy).toHaveBeenCalled();
    });
});
