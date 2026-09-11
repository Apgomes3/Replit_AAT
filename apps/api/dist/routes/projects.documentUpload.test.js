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
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const testSecret = 'project-document-upload-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    moduleAccess: {},
    classificationActive: true,
    transactionFails: false,
    persisted: {
        documents: [],
        revisions: [],
        links: [],
    },
    downloadFilePath: '',
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT rma.access_level')) {
            return { rows: [{ access_level: state.moduleAccess[String(params[1])] || 'manage' }] };
        }
        if (sql.includes('SELECT id FROM projects'))
            return { rows: [{ id: 'project-1' }] };
        if (sql.includes('SELECT * FROM documents WHERE id=$1')) {
            return { rows: [{ id: 'document-1', generated_source: null }] };
        }
        if (sql.includes('SELECT * FROM document_revisions WHERE document_id=$1 ORDER BY created_at DESC')) {
            return { rows: [] };
        }
        if (sql.includes('SELECT id FROM document_revisions WHERE document_id=$1')) {
            return { rows: [] };
        }
        if (sql.includes('INSERT INTO document_revisions')) {
            return { rows: [{ id: 'revision-2', document_id: 'document-1' }] };
        }
        if (sql.includes('FROM document_classifications')) {
            return { rows: state.classificationActive ? [{ code: params[0] }] : [] };
        }
        if (sql.includes('FROM document_revisions dr') && sql.includes('dr.file_path')) {
            return { rows: state.downloadFilePath ? [{
                        file_path: state.downloadFilePath,
                        file_name: 'basis.txt',
                    }] : [] };
        }
        return { rows: [] };
    });
    const client = {
        query: vitest_1.vi.fn(async (sql, params = []) => {
            state.calls.push({ sql, params });
            if (state.transactionFails && sql.includes('INSERT INTO document_project_links')) {
                throw new Error('link failed');
            }
            if (sql.includes('INSERT INTO documents')) {
                state.persisted.documents.push('document-1');
                return {
                    rows: [{
                            id: 'document-1',
                            document_code: params[0],
                            document_title: params[1],
                            classification: params[2],
                            current_revision: 'A',
                            status: 'Draft',
                        }],
                };
            }
            if (sql.includes('INSERT INTO document_revisions'))
                state.persisted.revisions.push('revision-1');
            if (sql.includes('INSERT INTO document_project_links'))
                state.persisted.links.push('link-1');
            return { rows: [] };
        }),
    };
    return {
        default: {},
        query,
        withTransaction: vitest_1.vi.fn(async (work) => {
            const snapshot = {
                documents: [...state.persisted.documents],
                revisions: [...state.persisted.revisions],
                links: [...state.persisted.links],
            };
            try {
                return await work(client);
            }
            catch (error) {
                state.persisted.documents = snapshot.documents;
                state.persisted.revisions = snapshot.revisions;
                state.persisted.links = snapshot.links;
                throw error;
            }
        }),
    };
});
vitest_1.vi.mock('../db/audit', () => ({ logAudit: vitest_1.vi.fn(async () => undefined) }));
function multipartRequest(app, fields, role = 'engineer', includeFile = true, fileName = 'basis.txt', fileContent = 'controlled document content', requestPath = '/api/v1/projects/project-1/documents') {
    return new Promise((resolve, reject) => {
        const boundary = `----test-${Date.now()}`;
        const chunks = [];
        for (const [name, value] of Object.entries(fields)) {
            chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
        }
        if (includeFile) {
            chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`));
            chunks.push(Buffer.from(fileContent));
            chunks.push(Buffer.from('\r\n'));
        }
        chunks.push(Buffer.from(`--${boundary}--\r\n`));
        const payload = Buffer.concat(chunks);
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const token = jsonwebtoken_1.default.sign({ id: 'user-1', email: 'user@example.com', role }, testSecret);
            const request = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'POST',
                path: requestPath,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': payload.length,
                },
            }, response => {
                let data = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { data += chunk; });
                response.on('end', () => server.close(error => {
                    if (error)
                        return reject(error);
                    resolve({ status: response.statusCode || 0, body: data ? JSON.parse(data) : {} });
                }));
            });
            request.on('error', reject);
            request.end(payload);
        });
    });
}
function downloadRequest(app, authorize) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const headers = {};
            if (authorize) {
                headers.Authorization = `Bearer ${jsonwebtoken_1.default.sign({ id: 'user-1', email: 'user@example.com', role: 'engineer' }, testSecret)}`;
            }
            const request = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'GET',
                path: '/api/v1/documents/document-1/revisions/revision-1/download',
                headers,
            }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.on('end', () => server.close(error => {
                    if (error)
                        return reject(error);
                    resolve({
                        status: response.statusCode || 0,
                        body: Buffer.concat(chunks),
                        headers: response.headers,
                    });
                }));
            });
            request.on('error', reject);
            request.end();
        });
    });
}
const uploadsDir = node_path_1.default.join(__dirname, '../../uploads');
const privateUploadsDir = node_path_1.default.join(__dirname, '../../private-uploads/documents');
const uploadedFiles = () => new Set(node_fs_1.default.existsSync(privateUploadsDir)
    ? node_fs_1.default.readdirSync(privateUploadsDir)
    : []);
(0, vitest_1.describe)('project document upload', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: projectRoutes } = await Promise.resolve().then(() => __importStar(require('./projects')));
        const { default: documentRoutes } = await Promise.resolve().then(() => __importStar(require('./documents')));
        app = (0, express_1.default)();
        app.use('/api/v1', projectRoutes);
        app.use('/api/v1', documentRoutes);
        app.use((_error, _req, res, _next) => {
            res.status(500).json({ error: { code: 'SERVER_ERROR' } });
        });
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.moduleAccess = {};
        state.classificationActive = true;
        state.transactionFails = false;
        state.persisted = { documents: [], revisions: [], links: [] };
        state.downloadFilePath = '';
    });
    (0, vitest_1.it)('creates the document, initial revision, and project association with file evidence', async () => {
        const before = uploadedFiles();
        const response = await multipartRequest(app, {
            document_code: 'DOC-001',
            document_title: 'Hydraulic Basis',
            classification: 'Design',
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body).toMatchObject({ document_code: 'DOC-001', classification: 'Design', current_revision: 'A' });
        const documentInsert = state.calls.find(call => call.sql.includes('INSERT INTO documents'));
        (0, vitest_1.expect)(documentInsert?.params).toEqual(['DOC-001', 'Hydraulic Basis', 'Design', 'user-1']);
        const revisionInsert = state.calls.find(call => call.sql.includes('INSERT INTO document_revisions'));
        (0, vitest_1.expect)(revisionInsert?.params[0]).toBe('document-1');
        (0, vitest_1.expect)(revisionInsert?.params[1]).toBe('user-1');
        (0, vitest_1.expect)(revisionInsert?.params[2]).toMatch(/^private-uploads\/documents\/document-.+\.txt$/);
        (0, vitest_1.expect)(revisionInsert?.params.slice(3)).toEqual([
            'basis.txt',
            27,
            'text/plain',
            '0db95d3e7bb2efe5b82aac5c72cc6c80633f71355095e90787352c91741d44a6',
        ]);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO document_project_links')
            && call.params[1] === 'project-1')).toBe(true);
        (0, vitest_1.expect)(state.persisted).toEqual({
            documents: ['document-1'],
            revisions: ['revision-1'],
            links: ['link-1'],
        });
        const created = [...uploadedFiles()].filter(name => !before.has(name));
        (0, vitest_1.expect)(created).toHaveLength(1);
        node_fs_1.default.unlinkSync(node_path_1.default.join(privateUploadsDir, created[0]));
    });
    (0, vitest_1.it)('rejects users without a project management role before accepting a file', async () => {
        const before = uploadedFiles();
        const response = await multipartRequest(app, {
            document_code: 'DOC-002',
            document_title: 'Commercial Offer',
            classification: 'Commercial',
        }, 'viewer');
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(uploadedFiles()).toEqual(before);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
    });
    (0, vitest_1.it)('keeps active content private and only serves it as an authenticated attachment', async () => {
        const before = uploadedFiles();
        const activeContent = '<script>localStorage.getItem("edp_token")</script>';
        const upload = await multipartRequest(app, {
            document_code: 'DOC-HTML',
            document_title: 'Active Content',
            classification: 'Design',
        }, 'engineer', true, 'active.html', activeContent);
        (0, vitest_1.expect)(upload.status).toBe(201);
        const revisionInsert = state.calls.find(call => call.sql.includes('INSERT INTO document_revisions'));
        state.downloadFilePath = revisionInsert.params[2];
        const anonymous = await downloadRequest(app, false);
        (0, vitest_1.expect)(anonymous.status).toBe(401);
        const authorized = await downloadRequest(app, true);
        (0, vitest_1.expect)(authorized.status).toBe(200);
        (0, vitest_1.expect)(authorized.headers['content-type']).toMatch(/^application\/octet-stream/);
        (0, vitest_1.expect)(authorized.headers['content-disposition']).toMatch(/^attachment;/);
        (0, vitest_1.expect)(authorized.headers['x-content-type-options']).toBe('nosniff');
        (0, vitest_1.expect)(authorized.body.toString()).toBe(activeContent);
        const created = [...uploadedFiles()].filter(name => !before.has(name));
        (0, vitest_1.expect)(created).toHaveLength(1);
        node_fs_1.default.unlinkSync(node_path_1.default.join(privateUploadsDir, created[0]));
    });
    (0, vitest_1.it)('stores later document revisions outside the public static directory', async () => {
        const before = uploadedFiles();
        const response = await multipartRequest(app, {
            revision_code: 'B',
            revision_purpose: 'Updated evidence',
        }, 'engineer', true, 'revision-b.html', '<script>alert(1)</script>', '/api/v1/documents/document-1/revisions');
        (0, vitest_1.expect)(response.status).toBe(201);
        const revisionInsert = state.calls.find(call => call.sql.includes('INSERT INTO document_revisions') && call.params[1] === 'B');
        (0, vitest_1.expect)(revisionInsert?.params[5]).toMatch(/^private-uploads\/documents\/.+\.html$/);
        (0, vitest_1.expect)(revisionInsert?.params[5]).not.toMatch(/^\/uploads\//);
        const created = [...uploadedFiles()].filter(name => !before.has(name));
        (0, vitest_1.expect)(created).toHaveLength(1);
        node_fs_1.default.unlinkSync(node_path_1.default.join(privateUploadsDir, created[0]));
    });
    (0, vitest_1.it)('rejects read-only module access before accepting a file', async () => {
        state.moduleAccess.documents = 'view';
        const before = uploadedFiles();
        const response = await multipartRequest(app, {
            document_code: 'DOC-002A',
            document_title: 'Read Only Attempt',
            classification: 'Commercial',
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
        (0, vitest_1.expect)(uploadedFiles()).toEqual(before);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
    });
    (0, vitest_1.it)('rejects inactive classifications and removes the uploaded file', async () => {
        state.classificationActive = false;
        const before = uploadedFiles();
        const response = await multipartRequest(app, {
            document_code: 'DOC-003',
            document_title: 'Unknown Classification',
            classification: 'Legal',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_CLASSIFICATION');
        (0, vitest_1.expect)(uploadedFiles()).toEqual(before);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
    });
    (0, vitest_1.it)('removes the file and reports failure when persistence cannot complete', async () => {
        state.transactionFails = true;
        const before = uploadedFiles();
        const response = await multipartRequest(app, {
            document_code: 'DOC-004',
            document_title: 'Failed Association',
            classification: 'Design',
        });
        (0, vitest_1.expect)(response.status).toBe(500);
        (0, vitest_1.expect)(response.body.error.code).toBe('UPLOAD_FAILED');
        (0, vitest_1.expect)(uploadedFiles()).toEqual(before);
        (0, vitest_1.expect)(state.persisted).toEqual({ documents: [], revisions: [], links: [] });
    });
    (0, vitest_1.it)('requires the uploaded file', async () => {
        const response = await multipartRequest(app, {
            document_code: 'DOC-005',
            document_title: 'Missing File',
            classification: 'Design',
        }, 'engineer', false);
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.message).toMatch(/file.*required/i);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO documents'))).toBe(false);
    });
});
