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
const testSecret = 'tank-promotion-test-secret';
const tankId = 'tank-1';
const productId = 'product-1';
const libraryTankId = 'pim-tank-1';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    sourceTank: {
        id: 'tank-1',
        tank_code: 'TK-01',
        tank_name: 'Main Display Tank',
        tank_type: 'Display Tank',
        project_id: 'project-1',
        project_code: 'PRJ-01',
        project_name: 'Aquarium Project',
        product_master_id: null,
        shape_type: 'Rectangular',
        length_mm: '5000',
        width_mm: '3000',
        height_mm: '2500',
        design_water_level_mm: '2200',
        overflow_level_mm: '2300',
        gross_volume_m3: '37.5',
        operating_volume_m3: '33',
        primary_material: 'Acrylic',
        notes: null,
    },
    promotedProduct: null,
    duplicatePimAssignment: null,
    libraryProduct: {
        id: 'library-tank-1',
        product_code: 'PIM-TNK-001',
        product_name: 'Library Display Tank',
        product_category: 'Tank',
        tank_family_id: 'family-1',
        application_type: 'Display Tank',
        shape_type: 'Rectangular',
        length_mm: '5000',
        width_mm: '3000',
        height_mm: '2500',
        design_water_level_mm: '2200',
        gross_volume_m3: '37.5',
        operating_volume_m3: '33',
        surface_area_m2: null,
    },
    libraryTank: {
        id: 'pim-tank-1',
        product_code: 'PIM-MAIN-01',
        product_name: 'PIM Main Display Tank',
        product_category: 'Tank',
        application_type: 'Display Tank',
        shape_type: 'Rectangular',
        length_mm: '6000',
        width_mm: '3500',
        height_mm: '2800',
        design_water_level_mm: '2500',
        gross_volume_m3: '58.8',
        operating_volume_m3: '52.5',
        primary_material_code: 'ACRYLIC',
        notes: 'Reusable tank details',
        tank_family_name: 'Main Displays',
    },
    exhibit: {
        id: 'exhibit-1',
        project_id: 'project-1',
        exhibit_name: 'Main Exhibit',
        project_code: 'PRJ-01',
    },
    existingExhibitTank: null,
    linkedTank: null,
    linkedInsertConflict: false,
    ordinaryInsertConflict: false,
    patchProductValid: true,
    assignmentTank: {
        id: 'assignment-tank',
        project_id: 'project-1',
        product_master_id: 'pim-tank-1',
    },
    moduleAccess: { projects: 'manage', pim: 'manage' },
    designBookStatus: 'Draft',
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params, scope: 'query' });
        if (sql.includes('SELECT rma.module_key, rma.access_level')) {
            return {
                rows: Object.entries(state.moduleAccess).map(([module_key, access_level]) => ({
                    module_key,
                    access_level,
                })),
            };
        }
        if (sql.includes("rma.module_key='pim'")) {
            return { rows: [{ access_level: state.moduleAccess.pim }] };
        }
        if (sql.includes('SELECT rma.access_level')) {
            return { rows: [{ access_level: state.moduleAccess[String(params[1])] || 'manage' }] };
        }
        if (sql.includes("FROM product_masters") && sql.includes("product_category='Tank'")) {
            return { rows: state.patchProductValid ? [{ id: params[0] }] : [] };
        }
        if (sql.includes('SELECT id, project_id, product_master_id FROM tanks WHERE id=$1')) {
            return { rows: [{ ...state.assignmentTank }] };
        }
        if (sql.includes('SELECT id, product_master_id FROM tanks WHERE id=$1')) {
            return { rows: [{ ...state.assignmentTank }] };
        }
        if (sql.includes('SELECT t.overflow_level_mm') && sql.includes('effective_water_level_mm')) {
            return { rows: [{
                        overflow_level_mm: state.sourceTank.overflow_level_mm,
                        effective_water_level_mm: state.sourceTank.design_water_level_mm,
                    }] };
        }
        if (sql === 'SELECT system_id FROM tanks WHERE id=$1') {
            return { rows: [{ system_id: null }] };
        }
        if (sql.includes('FROM tanks t') && sql.includes('project_code')) {
            return { rows: [{
                        ...state.sourceTank,
                        eff_shape: state.sourceTank.shape_type,
                        eff_length_mm: state.sourceTank.length_mm,
                        eff_width_mm: state.sourceTank.width_mm,
                        eff_height_mm: state.sourceTank.height_mm,
                        eff_water_level_mm: state.sourceTank.design_water_level_mm,
                        exhibit_id: 'exhibit-1',
                        exhibit_code: 'EX-1',
                        exhibit_name: 'Main Exhibit',
                        water_type: 'Freshwater',
                        design_temperature_min: 20,
                        design_temperature_max: 22,
                        system_id: null,
                    }] };
        }
        if (sql.includes('water_density_parameters')) {
            return { rows: [{
                        id: 'density-freshwater',
                        water_type: 'Freshwater',
                        density_kg_m3: 998.2,
                        conditions: '20 °C',
                        unit: 'kg/m3',
                        source: 'NIST',
                        is_active: true,
                    }] };
        }
        if (sql.includes('design_book_thermal_calculations'))
            return { rows: [] };
        if (sql.includes('UPDATE tanks SET')) {
            if (params[8]) {
                state.sourceTank.overflow_level_mm = params[9] == null ? null : String(params[9]);
            }
            return { rows: [{ ...state.sourceTank, tank_name: params[1] }] };
        }
        if (sql.includes('SELECT id FROM exhibits WHERE id=$1 AND project_id=$2')) {
            return { rows: [{ id: params[0] }] };
        }
        if (sql.includes('INSERT INTO tanks')) {
            if (state.ordinaryInsertConflict) {
                throw Object.assign(new Error('duplicate tank code'), {
                    code: '23505',
                    constraint: 'tanks_project_id_tank_code_key',
                });
            }
            return {
                rows: [{
                        id: 'project-only-tank',
                        tank_code: params[0],
                        project_id: params[1],
                        tank_name: params[5],
                        product_master_id: params[7] || null,
                    }],
            };
        }
        return { rows: [] };
    });
    const clientQuery = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params, scope: 'client' });
        if (sql.includes('FROM tanks t') && sql.includes('FOR UPDATE')) {
            return { rows: [{ ...state.sourceTank }] };
        }
        if (sql.includes('FROM design_books') && sql.includes('FOR SHARE')) {
            return { rows: [{ id: 'book-1', status: state.designBookStatus }] };
        }
        if (sql.includes('FROM exhibits e') && sql.includes('FOR UPDATE')) {
            return { rows: [{ ...state.exhibit }] };
        }
        if (sql.includes('LEFT JOIN tank_families tf') && sql.includes("pm.product_category='Tank'")) {
            const product = params[0] === state.libraryProduct.id ? state.libraryProduct : state.libraryTank;
            return { rows: product ? [{ ...product }] : [] };
        }
        if (sql.includes('FROM tanks') && sql.includes('project_id=$1 AND exhibit_id=$2 AND product_master_id=$3')) {
            return { rows: state.existingExhibitTank ? [{ ...state.existingExhibitTank }] : [] };
        }
        if (sql === 'SELECT tank_code FROM tanks WHERE project_id=$1 FOR UPDATE') {
            return { rows: [] };
        }
        if (sql.includes('INSERT INTO tanks') && sql.includes('product_master_id')) {
            if (state.linkedInsertConflict) {
                throw Object.assign(new Error('duplicate exhibit assignment'), {
                    code: '23505',
                    constraint: 'idx_tanks_pim_assignment',
                });
            }
            state.linkedTank = {
                id: 'linked-project-tank',
                tank_code: params[0],
                project_id: params[1],
                exhibit_id: params[2],
                tank_name: params[3],
                tank_type: null,
                product_master_id: params[4],
                shape_type: null,
                length_mm: null,
                width_mm: null,
                height_mm: null,
                design_water_level_mm: null,
            };
            return { rows: [state.linkedTank] };
        }
        if (sql.includes('FROM product_masters pm') && sql.includes('pm.source_tank_id')) {
            return { rows: state.promotedProduct ? [state.promotedProduct] : [] };
        }
        if (sql.includes('SELECT pm.* FROM product_masters pm')) {
            return { rows: [{ ...state.libraryProduct }] };
        }
        if (sql.includes('FROM tanks') && sql.includes('product_master_id=$3')) {
            return { rows: state.duplicatePimAssignment ? [state.duplicatePimAssignment] : [] };
        }
        if (sql.includes('INSERT INTO tanks')) {
            return {
                rows: [{
                        id: 'linked-project-tank',
                        tank_code: params[0],
                        project_id: params[1],
                        exhibit_id: params[2],
                        tank_name: params[3],
                        tank_type: params[4],
                        product_master_id: params[5],
                    }],
            };
        }
        if (sql.startsWith('SELECT id FROM tank_families'))
            return { rows: [{ id: 'family-1' }] };
        if (sql.includes('INSERT INTO product_masters')) {
            state.promotedProduct = {
                id: productId,
                product_code: params[0],
                product_name: params[2],
                tank_family_id: params[1],
                source_tank_id: tankId,
            };
            return { rows: [state.promotedProduct] };
        }
        return { rows: [] };
    });
    const client = { query: clientQuery, release: vitest_1.vi.fn() };
    return {
        query,
        default: {
            query,
            connect: vitest_1.vi.fn(async () => client),
        },
    };
});
function request(app, method, path, role, body = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
            const payload = JSON.stringify(body);
            const token = jsonwebtoken_1.default.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path,
                method,
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
                        resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
                    });
                });
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('project tank promotion into PIM', () => {
    let app;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: projectRoutes } = await Promise.resolve().then(() => __importStar(require('./projects')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', projectRoutes);
    });
    (0, vitest_1.beforeEach)(() => {
        state.calls.length = 0;
        state.sourceTank.product_master_id = null;
        state.sourceTank.overflow_level_mm = '2300';
        state.promotedProduct = null;
        state.duplicatePimAssignment = null;
        state.libraryTank = {
            id: libraryTankId,
            product_code: 'PIM-MAIN-01',
            product_name: 'PIM Main Display Tank',
            product_category: 'Tank',
            application_type: 'Display Tank',
            shape_type: 'Rectangular',
            length_mm: '6000',
            width_mm: '3500',
            height_mm: '2800',
            design_water_level_mm: '2500',
            gross_volume_m3: '58.8',
            operating_volume_m3: '52.5',
            primary_material_code: 'ACRYLIC',
            notes: 'Reusable tank details',
            tank_family_name: 'Main Displays',
        };
        state.exhibit = {
            id: 'exhibit-1',
            project_id: 'project-1',
            exhibit_name: 'Main Exhibit',
            project_code: 'PRJ-01',
        };
        state.existingExhibitTank = null;
        state.linkedTank = null;
        state.linkedInsertConflict = false;
        state.ordinaryInsertConflict = false;
        state.patchProductValid = true;
        state.assignmentTank = {
            id: 'assignment-tank',
            project_id: 'project-1',
            product_master_id: 'pim-tank-1',
        };
        state.moduleAccess = { projects: 'manage', pim: 'manage' };
        state.designBookStatus = 'Draft';
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('keeps ordinary Design Book tank creation project-only', async () => {
        const response = await request(app, 'POST', '/api/v1/tanks', 'engineer', {
            tank_code: 'TK-PROJECT',
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            tank_name: 'Project-only Tank',
            shape_type: 'Rectangular',
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body.product_master_id).toBeNull();
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO product_masters'))).toBe(false);
    });
    (0, vitest_1.it)('identifies the field responsible for ordinary tank validation failures', async () => {
        const response = await request(app, 'POST', '/api/v1/tanks', 'engineer', {
            project_id: 'project-1',
            tank_name: 'Project-only Tank',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error).toEqual({
            code: 'VALIDATION',
            field: 'tank_code',
            message: 'Tank code is required.',
        });
    });
    (0, vitest_1.it)('identifies the tank code when ordinary creation hits a duplicate', async () => {
        state.ordinaryInsertConflict = true;
        const response = await request(app, 'POST', '/api/v1/tanks', 'engineer', {
            tank_code: 'TK-PROJECT',
            project_id: 'project-1',
            tank_name: 'Project-only Tank',
        });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error).toEqual({
            code: 'DUPLICATE_TANK',
            field: 'tank_code',
            message: 'A tank with this code already exists in the project.',
        });
    });
    (0, vitest_1.it)('rejects PIM links submitted through ordinary project-tank creation', async () => {
        const response = await request(app, 'POST', '/api/v1/tanks', 'engineer', {
            tank_code: 'TK-BYPASS',
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            tank_name: 'Bypass Attempt',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PIM_ASSIGNMENT');
    });
    (0, vitest_1.it)('requires PIM manage access for an unassigned linked project tank', async () => {
        state.moduleAccess.pim = 'view';
        const response = await request(app, 'POST', '/api/v1/tanks', 'engineer', {
            tank_code: 'TK-LINKED',
            project_id: 'project-1',
            tank_name: 'Linked Project Tank',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
    });
    (0, vitest_1.it)('preserves project-level creation from a PIM tank for PIM managers', async () => {
        const response = await request(app, 'POST', '/api/v1/tanks', 'engineer', {
            tank_code: 'TK-LINKED',
            project_id: 'project-1',
            tank_name: 'Linked Project Tank',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body.product_master_id).toBe(libraryTankId);
    });
    (0, vitest_1.it)('creates a project tank linked to a PIM tank and exposes inherited values', async () => {
        const originalLibraryTank = { ...state.libraryTank };
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            design_book_id: 'book-1',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body).toMatchObject({
            id: 'linked-project-tank',
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            product_master_id: libraryTankId,
            pim_product_code: 'PIM-MAIN-01',
            eff_shape: 'Rectangular',
            eff_length_mm: '6000',
            eff_width_mm: '3500',
            eff_height_mm: '2800',
            eff_water_level_mm: '2500',
            eff_primary_material: 'ACRYLIC',
            gross_volume_m3: '58.8',
        });
        (0, vitest_1.expect)(response.body.tank_code).toBe('PIM-PIM-MAIN-01');
        (0, vitest_1.expect)(state.linkedTank).toMatchObject({
            product_master_id: libraryTankId,
            shape_type: null,
            length_mm: null,
        });
        (0, vitest_1.expect)(state.libraryTank).toEqual(originalLibraryTank);
        (0, vitest_1.expect)(state.calls.some(call => call.sql.startsWith('UPDATE product_masters'))).toBe(false);
    });
    (0, vitest_1.it)('rejects an invalid PIM selection', async () => {
        state.libraryTank = null;
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            design_book_id: 'book-1',
            product_master_id: 'not-a-tank',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PIM_TANK');
        (0, vitest_1.expect)(state.linkedTank).toBeNull();
    });
    (0, vitest_1.it)('rejects an exhibit from another project', async () => {
        state.exhibit.project_id = 'project-2';
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            design_book_id: 'book-1',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PROJECT');
        (0, vitest_1.expect)(state.linkedTank).toBeNull();
    });
    (0, vitest_1.it)('rejects a duplicate exhibit assignment with a clear conflict', async () => {
        state.existingExhibitTank = { id: 'existing-tank', tank_code: 'TK-EXISTING', tank_name: 'Existing PIM Tank' };
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            design_book_id: 'book-1',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('DUPLICATE_ASSIGNMENT');
        (0, vitest_1.expect)(response.body.error.message).toContain('TK-EXISTING');
        (0, vitest_1.expect)(state.linkedTank).toBeNull();
    });
    (0, vitest_1.it)('translates a database-level assignment race into a clear duplicate response', async () => {
        state.linkedInsertConflict = true;
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            design_book_id: 'book-1',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error).toEqual({
            code: 'DUPLICATE_ASSIGNMENT',
            message: 'This PIM tank is already assigned to the exhibit.',
        });
        (0, vitest_1.expect)(state.linkedTank).toBeNull();
    });
    (0, vitest_1.it)('rejects changing a PIM link through the generic update endpoint', async () => {
        state.moduleAccess.pim = 'hidden';
        const response = await request(app, 'PATCH', `/api/v1/tanks/${tankId}`, 'engineer', {
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PIM_ASSIGNMENT');
    });
    (0, vitest_1.it)('rejects every product link through the generic update path', async () => {
        state.patchProductValid = false;
        const response = await request(app, 'PATCH', `/api/v1/tanks/${tankId}`, 'engineer', {
            product_master_id: 'non-tank-product',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PIM_ASSIGNMENT');
    });
    (0, vitest_1.it)('rejects assigning an existing PIM-linked tank through the quick exhibit path', async () => {
        const response = await request(app, 'PATCH', `/api/v1/tanks/${tankId}/exhibit`, 'engineer', {
            exhibit_id: 'exhibit-1',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PIM_ASSIGNMENT');
    });
    (0, vitest_1.it)('rejects assigning an existing PIM-linked tank through the general update path', async () => {
        const response = await request(app, 'PUT', `/api/v1/tanks/${tankId}`, 'engineer', {
            tank_name: 'Existing Linked Tank',
            exhibit_id: 'exhibit-1',
        });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_PIM_ASSIGNMENT');
    });
    (0, vitest_1.it)('preserves overflow when an existing edit omits it and clears only when explicit', async () => {
        const unrelatedEdit = await request(app, 'PUT', `/api/v1/tanks/${tankId}`, 'engineer', {
            tank_name: 'Renamed Main Display Tank',
            design_water_level_mm: '2200',
        });
        (0, vitest_1.expect)(unrelatedEdit.status).toBe(200);
        (0, vitest_1.expect)(unrelatedEdit.body.overflow_level_mm).toBe('2300');
        const preservingUpdate = state.calls.find(call => call.sql.includes('UPDATE tanks SET'));
        (0, vitest_1.expect)(preservingUpdate?.sql).toContain('overflow_level_mm=CASE WHEN $9 THEN $10 ELSE overflow_level_mm END');
        (0, vitest_1.expect)(preservingUpdate?.params[8]).toBe(false);
        const preview = await request(app, 'GET', '/api/v1/projects/project-1/tanks/tank-1/design-sheet', 'engineer');
        (0, vitest_1.expect)(preview.status).toBe(200);
        (0, vitest_1.expect)(preview.body.validation.valid).toBe(true);
        const explicitClear = await request(app, 'PUT', `/api/v1/tanks/${tankId}`, 'engineer', {
            tank_name: 'Renamed Main Display Tank',
            design_water_level_mm: '2200',
            overflow_level_mm: null,
        });
        (0, vitest_1.expect)(explicitClear.status).toBe(200);
        (0, vitest_1.expect)(explicitClear.body.overflow_level_mm).toBeNull();
    });
    (0, vitest_1.it)('rejects linked assignment without project design-edit authority', async () => {
        state.moduleAccess.projects = 'view';
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            design_book_id: 'book-1',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
        (0, vitest_1.expect)(state.calls.some(call => call.scope === 'client')).toBe(false);
    });
    (0, vitest_1.it)('rejects linked assignment without PIM access', async () => {
        state.moduleAccess.pim = 'hidden';
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            design_book_id: 'book-1',
            product_master_id: libraryTankId,
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
        (0, vitest_1.expect)(state.calls.some(call => call.scope === 'client')).toBe(false);
    });
    (0, vitest_1.it)('explicitly creates and links a reusable PIM tank', async () => {
        const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'engineer', {
            design_book_id: 'book-1',
            product_code: 'PM-TNK-001',
            product_name: 'Reusable Main Display Tank',
            tank_family_id: 'family-1',
            standard_status: 'Concept',
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body).toMatchObject({
            id: productId,
            product_code: 'PM-TNK-001',
            source_tank_id: tankId,
            source_tank_code: 'TK-01',
        });
        (0, vitest_1.expect)(state.calls.some(call => call.sql.startsWith('UPDATE tanks SET product_master_id'))).toBe(false);
        const insert = state.calls.find(call => call.sql.includes('INSERT INTO product_masters'));
        (0, vitest_1.expect)(JSON.parse(insert.params[18])).toMatchObject({
            design_book_id: 'book-1',
            tank_code: 'TK-01',
            project_code: 'PRJ-01',
        });
    });
    (0, vitest_1.it)('creates a project tank linked to a selected PIM tank with water-surface area', async () => {
        const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
            design_book_id: 'book-1',
            project_id: 'project-1',
            exhibit_id: 'exhibit-1',
            product_master_id: 'library-tank-1',
            tank_code: 'TK-LIB-01',
            tank_name: 'Main Exhibit',
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(response.body).toMatchObject({
            tank_code: 'TK-LIB-01',
            tank_name: 'Main Exhibit',
            product_master_id: 'library-tank-1',
            surface_area_m2: 15,
        });
        const insert = state.calls.find(call => call.scope === 'client' && call.sql.includes('INSERT INTO tanks'));
        (0, vitest_1.expect)(insert.params[4]).toBe('library-tank-1');
    });
    (0, vitest_1.it)('rejects promotion by a viewer', async () => {
        const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'viewer', {
            design_book_id: 'book-1',
            product_code: 'PM-TNK-001',
            product_name: 'Reusable Main Display Tank',
            tank_family_id: 'family-1',
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('FORBIDDEN');
        (0, vitest_1.expect)(state.calls.some(call => call.scope === 'client')).toBe(false);
    });
    (0, vitest_1.it)('rejects promotion when the user only has view access to PIM', async () => {
        state.moduleAccess.pim = 'view';
        const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'engineer', {
            design_book_id: 'book-1',
            product_code: 'PM-TNK-001',
            product_name: 'Reusable Main Display Tank',
            tank_family_id: 'family-1',
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe('MODULE_READ_ONLY');
        (0, vitest_1.expect)(state.calls.some(call => call.scope === 'client')).toBe(false);
    });
    (0, vitest_1.it)('rejects promotion when the linked Design Book is read-only', async () => {
        state.designBookStatus = 'Released';
        const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'engineer', {
            design_book_id: 'book-1',
            product_code: 'PM-TNK-001',
            product_name: 'Reusable Main Display Tank',
            tank_family_id: 'family-1',
        });
        (0, vitest_1.expect)(response.status).toBe(409);
        (0, vitest_1.expect)(response.body.error.code).toBe('DESIGN_BOOK_READ_ONLY');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO product_masters'))).toBe(false);
    });
    (0, vitest_1.it)('returns a conflict instead of creating a duplicate library record', async () => {
        const payload = {
            design_book_id: 'book-1',
            product_code: 'PM-TNK-001',
            product_name: 'Reusable Main Display Tank',
            tank_family_id: 'family-1',
        };
        const first = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'admin', payload);
        const second = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'admin', payload);
        (0, vitest_1.expect)(first.status).toBe(201);
        (0, vitest_1.expect)(second.status).toBe(409);
        (0, vitest_1.expect)(second.body.error.code).toBe('DUPLICATE_PROMOTION');
        (0, vitest_1.expect)(second.body.existing_product.product_code).toBe('PM-TNK-001');
        (0, vitest_1.expect)(state.calls.filter(call => call.sql.includes('INSERT INTO product_masters'))).toHaveLength(1);
    });
});
