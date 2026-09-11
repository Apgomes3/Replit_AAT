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
const testSecret = 'generated-tds-test-secret';
const state = vitest_1.vi.hoisted(() => ({
    product: {},
    document: null,
    revisions: [],
    nextRevisionId: 1,
    usedDocumentCodes: [],
    pneumatic: null,
}));
vitest_1.vi.mock('../db', () => {
    const clientQuery = vitest_1.vi.fn(async (sql, params = []) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql))
            return { rows: [] };
        if (sql.includes('FOR UPDATE OF pm'))
            return { rows: [{ ...state.product }] };
        if (sql.includes('FROM product_variants'))
            return { rows: [{ id: 'variant-1', variant_code: 'V-1' }] };
        if (sql.includes('FROM standard_boms sb'))
            return { rows: [{ id: 'bom-1', bom_code: 'BOM-1', revision_code: 'A', lines: [{ line_number: 1, component_name: 'Motor' }] }] };
        if (sql.includes('FROM vendor_options'))
            return { rows: [{ id: 'vendor-1', vendor_name: 'Vendor A' }] };
        if (sql.includes('FROM product_dimensions'))
            return { rows: [{ length_mm: 1000 }] };
        if (sql.includes('FROM product_electrical'))
            return { rows: [{ voltage_v: 400 }] };
        if (sql.includes('FROM product_hydraulic'))
            return { rows: [{ design_flow_m3h: state.product.design_flow_m3h }] };
        if (sql.includes('FROM product_pneumatic'))
            return { rows: state.pneumatic ? [{ ...state.pneumatic }] : [] };
        if (sql.includes('FROM family_classifiers fc'))
            return { rows: [{ id: 'classifier-1', label: 'Connection Size', unit: 'DN', value_text: '80' }] };
        if (sql.includes('FROM product_usages'))
            return { rows: [{ id: 'project-1', project_code: 'PRJ-1' }] };
        if (sql.includes('FROM entity_relationships'))
            return { rows: [{ id: 'rel-1', edge_type: 'compatible_with' }] };
        if (sql.includes('FROM documents WHERE product_id=$1 ORDER BY'))
            return { rows: state.document ? [{ ...state.document }] : [] };
        if (sql.includes("generated_source='pim_tds'"))
            return { rows: state.document ? [{ ...state.document }] : [] };
        if (sql.includes('SELECT document_code FROM documents WHERE document_code LIKE')) {
            return { rows: state.usedDocumentCodes.map(document_code => ({ document_code })) };
        }
        if (sql.includes('INSERT INTO documents')) {
            state.document = {
                id: 'document-1',
                document_code: params[0],
                document_title: params[1],
                document_type: 'Technical Data Sheet',
                product_id: params[3],
                current_revision: 'A',
                status: 'Draft',
                generated_source: 'pim_tds',
            };
            return { rows: [{ ...state.document }] };
        }
        if (sql.includes('SELECT * FROM document_revisions'))
            return { rows: state.revisions.map(row => ({ ...row })).reverse() };
        if (sql.includes('INSERT INTO document_revisions')) {
            const isInitial = sql.includes("VALUES ($1,'A'");
            const revision = {
                id: `revision-${state.nextRevisionId++}`,
                document_id: params[0],
                revision_code: isInitial ? 'A' : params[1],
                status: 'Draft',
                content: isInitial ? params[2] : params[3],
                source_snapshot: isInitial ? params[3] : params[4],
                generated_at: isInitial ? params[4] : params[5],
            };
            state.revisions.push(revision);
            return { rows: [{ ...revision }] };
        }
        if (sql.includes('UPDATE document_revisions')) {
            const revision = state.revisions.find(row => row.id === params[3]);
            Object.assign(revision, { status: 'Draft', content: params[0], source_snapshot: params[1], generated_at: params[2] });
            return { rows: [{ ...revision }] };
        }
        if (sql.includes('UPDATE documents SET current_revision')) {
            Object.assign(state.document, { current_revision: params[0], status: 'Draft' });
            return { rows: [{ ...state.document }] };
        }
        return { rows: [] };
    });
    const query = vitest_1.vi.fn(async () => ({ rows: [] }));
    return {
        query,
        default: {
            connect: vitest_1.vi.fn(async () => ({ query: clientQuery, release: vitest_1.vi.fn() })),
        },
    };
});
function post(app, token) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('No test server address'));
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                method: 'POST',
                path: '/api/v1/product-masters/product-1/generate-tds',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            }, res => {
                let response = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { response += chunk; });
                res.on('end', () => server.close(error => error ? reject(error) : resolve({
                    status: res.statusCode ?? 0,
                    body: response ? JSON.parse(response) : {},
                })));
            });
            req.on('error', reject);
            req.end('{}');
        });
    });
}
(0, vitest_1.describe)('PIM generated Technical Data Sheets', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: productRoutes } = await Promise.resolve().then(() => __importStar(require('./products')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', productRoutes);
        token = jsonwebtoken_1.default.sign({ id: 'actor-1', email: 'actor@example.com', role: 'engineer' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.product = {
            id: 'product-1',
            product_code: 'P-100',
            product_name: 'Circulation Pump',
            product_category: 'Pumping',
            manufacturer: 'Pump Co',
            model: 'X100',
            design_flow_m3h: 25,
            primary_material_code: 'SS316',
            material_name: 'Stainless Steel',
            image_url: '/pump.png',
            notes: 'Product notes',
        };
        state.document = null;
        state.revisions = [];
        state.nextRevisionId = 1;
        state.usedDocumentCodes = [];
        state.pneumatic = null;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('creates one linked draft with complete content and a frozen source snapshot', async () => {
        const response = await post(app, token);
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body.document.product_id).toBe('product-1');
        (0, vitest_1.expect)(response.body.document.generated_source).toBe('pim_tds');
        (0, vitest_1.expect)(response.body.revision.content.sections.identity.manufacturer).toBe('Pump Co');
        (0, vitest_1.expect)(response.body.revision.content.sections.bill_of_materials[0].lines[0].component_name).toBe('Motor');
        (0, vitest_1.expect)(response.body.revision.source_snapshot.specifications.electrical.voltage_v).toBe(400);
        (0, vitest_1.expect)(response.body.revision.source_snapshot.vendors[0].vendor_name).toBe('Vendor A');
        (0, vitest_1.expect)(response.body.revision.source_snapshot.classifier_values[0].value_text).toBe('80');
    });
    (0, vitest_1.it)('includes pneumatic specifications only while the product is in the Pneumatic category', async () => {
        state.pneumatic = { gas_flow_value: 50, gas_flow_unit: 'SCFM' };
        state.product.product_category = 'Pneumatic';
        const pneumaticTds = await post(app, token);
        (0, vitest_1.expect)(pneumaticTds.body.revision.source_snapshot.specifications.pneumatic).toMatchObject({
            gas_flow_value: 50,
            gas_flow_unit: 'SCFM',
        });
        (0, vitest_1.expect)(pneumaticTds.body.revision.content.sections.pneumatic.gas_flow_value).toBe(50);
        state.product.product_category = 'Pumping';
        const reclassifiedTds = await post(app, token);
        (0, vitest_1.expect)(reclassifiedTds.body.revision.source_snapshot.specifications.pneumatic).toBeNull();
        (0, vitest_1.expect)(reclassifiedTds.body.revision.content.sections.pneumatic).toBeNull();
    });
    (0, vitest_1.it)('freezes tank classification and engineering requirements into the TDS', async () => {
        state.product.product_category = 'Tank';
        state.product.product_description = 'FRP process tank';
        state.product.tank_classification = 'Cylindrical atmospheric FRP tank';
        state.product.tank_engineering_details = {
            construction_type: 'FRP',
            fabrication_method: 'Filament wound',
            service_medium: 'Seawater',
            max_operating_pressure_bar: 0.5,
            proposed_design_standard: 'ASTM D3299',
            required_astm_tests: 'Hydrostatic and laminate coupon tests',
            certification_inspection_requirements: 'Third-party final inspection',
        };
        const response = await post(app, token);
        (0, vitest_1.expect)(response.body.revision.content.sections.classification.tank_classification)
            .toBe('Cylindrical atmospheric FRP tank');
        (0, vitest_1.expect)(response.body.revision.content.sections.tank_engineering).toMatchObject({
            service_medium: 'Seawater',
            proposed_design_standard: 'ASTM D3299',
        });
        (0, vitest_1.expect)(response.body.revision.source_snapshot.product.tank_engineering_details.required_astm_tests)
            .toContain('Hydrostatic');
    });
    (0, vitest_1.it)('regenerates an editable draft in place without creating a duplicate document or revision', async () => {
        const initial = await post(app, token);
        state.product.product_name = 'Updated Circulation Pump';
        const regenerated = await post(app, token);
        (0, vitest_1.expect)(regenerated.status).toBe(200);
        (0, vitest_1.expect)(regenerated.body.generation.action).toBe('updated');
        (0, vitest_1.expect)(regenerated.body.document.id).toBe(initial.body.document.id);
        (0, vitest_1.expect)(regenerated.body.revision.id).toBe(initial.body.revision.id);
        (0, vitest_1.expect)(state.revisions).toHaveLength(1);
        (0, vitest_1.expect)(regenerated.body.revision.source_snapshot.product.product_name).toBe('Updated Circulation Pump');
    });
    (0, vitest_1.it)('creates a new draft revision while preserving an approved source snapshot', async () => {
        await post(app, token);
        state.revisions[0].status = 'Approved';
        const approvedSnapshot = structuredClone(state.revisions[0].source_snapshot);
        state.document.status = 'Approved';
        state.product.design_flow_m3h = 30;
        const regenerated = await post(app, token);
        (0, vitest_1.expect)(regenerated.body.generation.action).toBe('revision_created');
        (0, vitest_1.expect)(regenerated.body.revision.revision_code).toBe('B');
        (0, vitest_1.expect)(state.revisions).toHaveLength(2);
        (0, vitest_1.expect)(state.revisions[0].status).toBe('Approved');
        (0, vitest_1.expect)(state.revisions[0].source_snapshot).toEqual(approvedSnapshot);
        (0, vitest_1.expect)(regenerated.body.revision.source_snapshot.product.design_flow_m3h).toBe(30);
    });
    (0, vitest_1.it)('marks unavailable values and warns when a product has very little data', async () => {
        state.product = { id: 'product-1', product_code: 'P-EMPTY', product_name: 'Sparse Product' };
        const response = await post(app, token);
        (0, vitest_1.expect)(response.body.revision.content.sections.engineering_values.design_flow_m3h).toBeNull();
        (0, vitest_1.expect)(response.body.revision.content.unavailable_fields).toContain('manufacturer');
        (0, vitest_1.expect)(response.body.generation.warnings[0]).toContain('sparse');
    });
    (0, vitest_1.it)('chooses a controlled alternate code when a manual document already uses the standard TDS code', async () => {
        state.usedDocumentCodes = ['P-100-TDS'];
        const response = await post(app, token);
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body.document.document_code).toBe('P-100-TDS-PIM');
    });
    (0, vitest_1.it)('advances generated revision lettering beyond Z without repeating AA', async () => {
        await post(app, token);
        state.document.status = 'Approved';
        state.revisions = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((revision_code, index) => ({
            id: `revision-${index + 1}`,
            document_id: 'document-1',
            revision_code,
            status: 'Approved',
            source_snapshot: { revision_code },
        }));
        state.revisions.push({
            id: 'revision-27',
            document_id: 'document-1',
            revision_code: 'AA',
            status: 'Approved',
            source_snapshot: { revision_code: 'AA' },
        });
        const response = await post(app, token);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.revision.revision_code).toBe('AB');
    });
});
