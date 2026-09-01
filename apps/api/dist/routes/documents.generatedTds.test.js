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
const testSecret = 'generated-document-content-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    status: 'Draft',
    content: { title: 'Original draft' },
    sourceSnapshot: { product: { product_name: 'Authoritative PIM name' } },
    moduleAccess: null,
    documentType: 'Technical Data Sheet',
    documentGeneratedSource: 'pim_tds',
    revisionGeneratedSource: 'pim_tds',
    pdfRevisionFound: true,
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        if (sql.includes('SELECT rma.access_level'))
            return { rows: state.moduleAccess ? [{ access_level: state.moduleAccess }] : [] };
        if (sql === 'SELECT generated_source FROM documents WHERE id=$1') {
            return { rows: [{ generated_source: 'pim_tds' }] };
        }
        if (sql === 'SELECT generated_source, document_type, status FROM documents WHERE id=$1') {
            return { rows: [{ generated_source: 'pim_tds', document_type: state.documentType, status: state.status }] };
        }
        if (sql.includes('UPDATE documents SET document_title')) {
            state.documentType = params[1];
            state.status = params[3];
            return { rows: [{ id: 'document-1', generated_source: 'pim_tds', document_type: state.documentType, status: state.status }] };
        }
        if (sql.includes('SELECT dr.*, d.generated_source')) {
            return { rows: [{ id: 'revision-1', document_id: 'document-1', revision_code: 'A', status: state.status, generated_source: 'pim_tds' }] };
        }
        if (sql.includes('SELECT dr.id, dr.status, d.generated_source')) {
            return { rows: [{ id: 'revision-1', status: state.status, generated_source: 'pim_tds', revision_generated_source: state.revisionGeneratedSource }] };
        }
        if (sql.includes('document_generated_source')) {
            return {
                rows: state.pdfRevisionFound ? [{
                        document_id: 'document-1',
                        document_code: 'P-100-TDS',
                        document_title: 'Pump Technical Data Sheet',
                        document_status: state.status,
                        document_generated_source: state.documentGeneratedSource,
                        revision_id: 'revision-1',
                        revision_code: 'A',
                        status: state.status,
                        content: state.content,
                        generated_at: '2026-09-01T10:00:00.000Z',
                        revision_generated_source: state.revisionGeneratedSource,
                    }] : [],
            };
        }
        if (sql.includes('UPDATE document_revisions SET content')) {
            state.content = params[0];
            return {
                rows: [{
                        id: 'revision-1',
                        document_id: 'document-1',
                        status: state.status,
                        content: state.content,
                        source_snapshot: state.sourceSnapshot,
                    }],
            };
        }
        return { rows: [] };
    });
    return { query, default: { query } };
});
function request(app, token, method, path, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const payload = body ? JSON.stringify(body) : '';
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method,
                path,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            }, res => {
                let response = '';
                res.setEncoding('binary');
                res.on('data', chunk => { response += chunk; });
                res.on('end', () => server.close(error => error ? reject(error) : resolve({
                    status: res.statusCode ?? 0,
                    body: response
                        ? (res.headers['content-type']?.includes('application/json') ? JSON.parse(response) : Buffer.from(response, 'binary'))
                        : {},
                    headers: res.headers,
                })));
            });
            req.on('error', reject);
            if (payload)
                req.write(payload);
            req.end();
        });
    });
}
function put(app, token, content) {
    return request(app, token, 'PUT', '/api/v1/documents/document-1/revisions/revision-1/content', { content });
}
(0, vitest_1.describe)('generated TDS document-only editing', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: documentRoutes } = await Promise.resolve().then(() => __importStar(require('./documents')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', documentRoutes);
        token = jsonwebtoken_1.default.sign({ id: 'actor-1', email: 'actor@example.com', role: 'engineer' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.status = 'Draft';
        state.content = { title: 'Original draft' };
        state.sourceSnapshot = { product: { product_name: 'Authoritative PIM name' } };
        state.moduleAccess = null;
        state.documentType = 'Technical Data Sheet';
        state.documentGeneratedSource = 'pim_tds';
        state.revisionGeneratedSource = 'pim_tds';
        state.pdfRevisionFound = true;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    vitest_1.it.each(['Draft', 'Internal Review', 'Review Commented', 'Resubmitted'])('allows document-only edits during %s without changing the PIM source snapshot', async (status) => {
        state.status = status;
        const originalSnapshot = structuredClone(state.sourceSnapshot);
        const response = await put(app, token, { title: 'Reviewer wording' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.content.title).toBe('Reviewer wording');
        (0, vitest_1.expect)(response.body.source_snapshot).toEqual(originalSnapshot);
    });
    vitest_1.it.each(['Approved', 'Released', 'Rejected'])('keeps %s revisions frozen', async (status) => {
        state.status = status;
        const response = await put(app, token, { title: 'Should not save' });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('REVISION_FROZEN');
        (0, vitest_1.expect)(state.content.title).toBe('Original draft');
    });
    (0, vitest_1.it)('rejects document writes for users with view-only module access', async () => {
        state.moduleAccess = 'view';
        const response = await put(app, token, { title: 'Should not save' });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
    });
    (0, vitest_1.it)('does not edit a non-generated revision attached to a generated document', async () => {
        state.revisionGeneratedSource = 'upload';
        const response = await put(app, token, { title: 'Should not save' });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('NOT_GENERATED_TDS');
        (0, vitest_1.expect)(state.content.title).toBe('Original draft');
    });
    (0, vitest_1.it)('prevents generated TDS documents from being reassigned to another product', async () => {
        const response = await request(app, token, 'PUT', '/api/v1/documents/document-1/product', { product_id: 'other-product' });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('GENERATED_LINK_IMMUTABLE');
    });
    (0, vitest_1.it)('preserves generated TDS identity and lifecycle status during metadata edits', async () => {
        state.status = 'Approved';
        const response = await request(app, token, 'PUT', '/api/v1/documents/document-1', {
            document_title: 'Edited title',
            document_type: 'Drawing',
            status: 'Draft',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.document_type).toBe('Technical Data Sheet');
        (0, vitest_1.expect)(response.body.status).toBe('Approved');
    });
    (0, vitest_1.it)('prevents an admin from deleting a frozen generated TDS revision', async () => {
        state.status = 'Released';
        const adminToken = jsonwebtoken_1.default.sign({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }, testSecret);
        const response = await request(app, adminToken, 'DELETE', '/api/v1/documents/revisions/revision-1');
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('REVISION_FROZEN');
    });
    (0, vitest_1.it)('renders the requested generated revision as an uncached inline PDF without changing lifecycle state', async () => {
        state.status = 'Approved';
        state.content = {
            title: 'Reviewer-owned pump sheet',
            sections: { identity: { product_code: 'P-100', product_name: 'Pump' }, notes: 'Approved wording' },
        };
        const response = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.headers['content-type']).toContain('application/pdf');
        (0, vitest_1.expect)(response.headers['content-disposition']).toContain('inline');
        (0, vitest_1.expect)(response.headers['cache-control']).toBe('no-store');
        (0, vitest_1.expect)(response.body.subarray(0, 8).toString()).toBe('%PDF-1.4');
        (0, vitest_1.expect)(response.body.toString('binary')).toContain('Reviewer-owned pump sheet');
        (0, vitest_1.expect)(state.status).toBe('Approved');
        (0, vitest_1.expect)(state.sourceSnapshot.product.product_name).toBe('Authoritative PIM name');
    });
    (0, vitest_1.it)('does not expose a revision that is not linked to the requested document', async () => {
        state.pdfRevisionFound = false;
        const response = await request(app, token, 'GET', '/api/v1/documents/other-document/revisions/revision-1/tds.pdf');
        (0, vitest_1.expect)(response.status).toBe(404);
        (0, vitest_1.expect)(response.body.error.code).toBe('NOT_FOUND');
    });
    (0, vitest_1.it)('rejects non-generated revisions and missing generated content', async () => {
        state.revisionGeneratedSource = 'upload';
        const wrongType = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
        (0, vitest_1.expect)(wrongType.status).toBe(400);
        (0, vitest_1.expect)(wrongType.body.error.code).toBe('NOT_GENERATED_TDS');
        state.revisionGeneratedSource = 'pim_tds';
        state.content = null;
        const missingContent = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
        (0, vitest_1.expect)(missingContent.status).toBe(422);
        (0, vitest_1.expect)(missingContent.body.error.code).toBe('TDS_CONTENT_MISSING');
    });
    (0, vitest_1.it)('allows view-only users to render but blocks hidden document access', async () => {
        state.moduleAccess = 'view';
        const viewResponse = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
        (0, vitest_1.expect)(viewResponse.status).toBe(200);
        state.moduleAccess = 'hidden';
        const hiddenResponse = await request(app, token, 'GET', '/api/v1/documents/document-1/revisions/revision-1/tds.pdf');
        (0, vitest_1.expect)(hiddenResponse.status).toBe(403);
        (0, vitest_1.expect)(hiddenResponse.body.error.code).toBe('MODULE_HIDDEN');
    });
});
