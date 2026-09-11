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
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_http_1 = __importDefault(require("node:http"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const lssIoSchedule_1 = require("../lib/lssIoSchedule");
const secret = 'lss-io-schedule-test';
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const frozenTag = 'LSS-01-PS-HISTORIC-01';
const frozenInstrument = 'Retired pressure switch';
const frozenProduct = 'P-OLD — Frozen assigned product';
const frozenLogic = 'Frozen trip logic retained after issue';
const frozenBook = {
    id: 'book-1', book_code: 'BOOK-01', book_title: 'Frozen controls',
    project_id: 'project-1', status: 'Released',
    release_snapshot: {
        systems: [{ id: 'system-1', system_code: 'LSS-01', system_name: 'Frozen LSS', system_type: 'Life Support System' }],
        lss_control_configurations: [{ system_id: 'system-1', panel_type: 'PLC' }],
        lss_instrument_instances: [{
                id: 'frozen-instance', system_id: 'system-1', tag: frozenTag, sequence_number: 1,
                control_logic: frozenLogic,
                definition_snapshot: { name: frozenInstrument, tag_code: 'PS', sort_order: 1, signal_type: 'digital', signal_direction: 'input' },
                product_snapshot: { product_code: 'P-OLD', product_name: 'Frozen assigned product' },
            }],
    },
};
const query = vitest_1.vi.fn(async (statement) => {
    const sql = typeof statement === 'string' ? statement : statement.text;
    if (sql.includes('role_module_access'))
        return { rows: [] };
    if (sql.includes('FROM design_books'))
        return { rows: [frozenBook] };
    throw new Error(`Unexpected mutable query: ${sql}`);
});
vitest_1.vi.mock('../db', () => ({ default: { connect: vitest_1.vi.fn() }, query }));
vitest_1.vi.mock('./designBooks', () => ({ loadReleaseContext: vitest_1.vi.fn() }));
function get(app, path = '/api/v1/systems/system-1/control/io-schedule.pdf?design_book_id=book-1') {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const token = jsonwebtoken_1.default.sign({ id: 'user-1', role: 'engineer', email: 'io@example.test' }, secret);
            const request = node_http_1.default.request({
                host: '127.0.0.1', port: server.address().port,
                path,
                headers: { Authorization: `Bearer ${token}` },
            }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.on('end', () => server.close(error => error ? reject(error) : resolve({
                    status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks),
                })));
            });
            request.on('error', reject);
            request.end();
        });
    });
}
async function extractPdfText(pdf) {
    const directory = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), 'lss-io-schedule-'));
    const pdfPath = node_path_1.default.join(directory, 'schedule.pdf');
    try {
        await (0, promises_1.writeFile)(pdfPath, pdf);
        const { stdout } = await execFileAsync('pdftotext', [pdfPath, '-']);
        return stdout;
    }
    finally {
        await (0, promises_1.rm)(directory, { recursive: true, force: true });
    }
}
(0, vitest_1.describe)('LSS I/O schedule', () => {
    (0, vitest_1.it)('projects every saved instance in deterministic schedule order', () => {
        const rows = (0, lssIoSchedule_1.projectLssIoSchedule)([{ id: 'a', system_code: 'LSS-01' }, { id: 'b', system_code: 'LSS-02' }], [{
                system_id: 'b', control: { panel_type: 'GPO' },
                instruments: [{ tag: 'LSS-02-Z-01', sequence_number: 1, control_logic: 'Z', definition_snapshot: { name: 'Zeta', tag_code: 'Z', sort_order: 2 } }],
            }, {
                system_id: 'a', control: { panel_type: 'PLC' },
                instruments: [
                    { tag: 'LSS-01-B-02', sequence_number: 2, control_logic: 'Second', definition_snapshot: { name: 'Beta', tag_code: 'B', sort_order: 1, signal_direction: 'output' } },
                    { tag: 'LSS-01-B-01', sequence_number: 1, control_logic: 'First', product_snapshot: { product_code: 'P-1', product_name: 'Product 1' }, definition_snapshot: { name: 'Beta', tag_code: 'B', sort_order: 9, signal_type: 'digital', signal_direction: 'input' } },
                ],
            }]);
        (0, vitest_1.expect)(rows.map(row => row.tag)).toEqual(['LSS-01-B-01', 'LSS-01-B-02', 'LSS-02-Z-01']);
        (0, vitest_1.expect)(rows.map(row => row.direction)).toEqual(['input', 'output', null]);
        (0, vitest_1.expect)(rows[0]).toMatchObject({
            panel: 'PLC', instrument: 'Beta', signal_type: 'digital', direction: 'input',
            assigned_product: 'P-1 — Product 1', control_logic: 'First',
        });
    });
    (0, vitest_1.it)('renders grouped Unicode schedule evidence to a PDF', async () => {
        const rows = (0, lssIoSchedule_1.projectLssIoSchedule)([{ id: 'a', system_code: 'LSS-01' }], [{
                system_id: 'a', control: { panel_type: 'PLC' }, instruments: [{
                        id: 'unicode', tag: 'LSS-01-PT-01', control_logic: 'Arrêt à pressão alta',
                        definition_snapshot: { name: 'Датчик pressão', signal_type: 'analog', signal_direction: 'input' },
                        product_snapshot: { product_code: 'P-1', product_name: 'Válvula Δ' },
                    }],
            }]);
        const pdf = await (0, lssIoSchedule_1.renderLssIoSchedulePdf)({ book_code: 'DB-1', book_title: 'Aquário Δ', status: 'For Review' }, rows);
        (0, vitest_1.expect)(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        (0, vitest_1.expect)(pdf.length).toBeGreaterThan(1000);
    });
    (0, vitest_1.it)('exports frozen evidence as a downloadable PDF without mutable product queries', async () => {
        process.env.JWT_SECRET = secret;
        const { default: routes } = await Promise.resolve().then(() => __importStar(require('./lssControls')));
        const app = (0, express_1.default)();
        app.use('/api/v1', routes);
        const response = await get(app);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.headers['content-type']).toContain('application/pdf');
        (0, vitest_1.expect)(response.headers['content-disposition']).toContain('attachment; filename="BOOK-01-lss-io-schedule.pdf"');
        (0, vitest_1.expect)(response.body.subarray(0, 5).toString()).toBe('%PDF-');
        (0, vitest_1.expect)(response.body.length).toBeGreaterThan(1000);
        const pdfText = await extractPdfText(response.body);
        (0, vitest_1.expect)(pdfText).toContain(frozenTag);
        (0, vitest_1.expect)(pdfText).toContain(frozenInstrument);
        (0, vitest_1.expect)(pdfText).toContain(frozenProduct);
        (0, vitest_1.expect)(pdfText).toContain(frozenLogic);
        (0, vitest_1.expect)(query.mock.calls.map(([sql]) => sql)).not.toContain(vitest_1.expect.stringContaining('product_masters'));
        (0, vitest_1.expect)(query.mock.calls.map(([sql]) => sql)).not.toContain(vitest_1.expect.stringContaining('FROM systems'));
    });
    (0, vitest_1.it)('serves frozen control evidence without resolving the live system', async () => {
        process.env.JWT_SECRET = secret;
        const { default: routes } = await Promise.resolve().then(() => __importStar(require('./lssControls')));
        const app = (0, express_1.default)();
        app.use('/api/v1', routes);
        const response = await get(app, '/api/v1/systems/system-1/control?design_book_id=book-1');
        const payload = JSON.parse(response.body.toString());
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(payload.frozen).toBe(true);
        (0, vitest_1.expect)(payload.instruments[0]).toMatchObject({
            tag: frozenTag,
            control_logic: frozenLogic,
            product_snapshot: { product_name: 'Frozen assigned product' },
        });
        (0, vitest_1.expect)(query.mock.calls.map(([sql]) => sql)).not.toContain(vitest_1.expect.stringContaining('FROM systems'));
        (0, vitest_1.expect)(query.mock.calls.map(([sql]) => sql)).not.toContain(vitest_1.expect.stringContaining('product_masters'));
    });
    (0, vitest_1.it)('fails closed when an issued book has no frozen evidence package', async () => {
        process.env.JWT_SECRET = secret;
        const snapshot = frozenBook.release_snapshot;
        frozenBook.release_snapshot = null;
        try {
            const { default: routes } = await Promise.resolve().then(() => __importStar(require('./lssControls')));
            const app = (0, express_1.default)();
            app.use('/api/v1', routes);
            const [pdfResponse, controlResponse] = await Promise.all([
                get(app),
                get(app, '/api/v1/systems/system-1/control?design_book_id=book-1'),
            ]);
            (0, vitest_1.expect)(pdfResponse.status).toBe(409);
            (0, vitest_1.expect)(pdfResponse.body.toString()).toContain('DESIGN_BOOK_SNAPSHOT_MISSING');
            (0, vitest_1.expect)(controlResponse.status).toBe(409);
            (0, vitest_1.expect)(controlResponse.body.toString()).toContain('DESIGN_BOOK_SNAPSHOT_MISSING');
        }
        finally {
            frozenBook.release_snapshot = snapshot;
        }
    });
});
