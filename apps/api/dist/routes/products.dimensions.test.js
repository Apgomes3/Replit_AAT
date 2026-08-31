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
const testSecret = 'product-dimensions-test-secret';
const productId = 'product-1';
const state = vitest_1.vi.hoisted(() => ({
    calls: [],
    dimensions: null,
}));
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (sql, params = []) => {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1')) {
            return { rows: [{ id: productId }] };
        }
        if (sql.includes('SELECT length_mm, width_mm, height_mm, diameter_mm')) {
            return { rows: state.dimensions ? [{ ...state.dimensions }] : [] };
        }
        if (sql.includes('SELECT * FROM product_dimensions')) {
            return { rows: state.dimensions ? [{ ...state.dimensions }] : [] };
        }
        if (sql.includes('INSERT INTO product_dimensions')) {
            state.dimensions = {
                id: 'dimensions-1',
                product_master_id: params[0],
                length_mm: params[1],
                width_mm: params[2],
                height_mm: params[3],
                diameter_mm: params[4],
                sand_media_per_filter_kg: params[5],
                weight_kg: params[6],
                inlet_dn_mm: params[7],
                outlet_dn_mm: params[8],
                notes: params[9],
            };
            return { rows: [{ ...state.dimensions }] };
        }
        return { rows: [] };
    });
    return { query, default: { query } };
});
function request(app, method, path, token, body = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
            const payload = JSON.stringify(body);
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
(0, vitest_1.describe)('PIM product dimensions diameter', () => {
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
        state.calls.length = 0;
        state.dimensions = {
            id: 'dimensions-1',
            product_master_id: productId,
            length_mm: '1200',
            width_mm: '800',
            height_mm: '600',
            diameter_mm: null,
            sand_media_per_filter_kg: null,
            weight_kg: '42',
            inlet_dn_mm: '50',
            outlet_dn_mm: '40',
            notes: 'Existing dimensions',
        };
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    (0, vitest_1.it)('saves, returns, and reloads a valid diameter without changing other dimensions', async () => {
        const save = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, {
            length_mm: '1200',
            width_mm: '800',
            height_mm: '600',
            diameter_mm: '1250.5',
            weight_kg: '42',
            inlet_dn_mm: '50',
            outlet_dn_mm: '40',
            notes: 'Existing dimensions',
        });
        (0, vitest_1.expect)(save.status).toBe(200);
        (0, vitest_1.expect)(save.body.diameter_mm).toBe(1250.5);
        (0, vitest_1.expect)(save.body.length_mm).toBe('1200');
        (0, vitest_1.expect)(save.body.notes).toBe('Existing dimensions');
        const reload = await request(app, 'GET', `/api/v1/product-masters/${productId}/dimensions`, token);
        (0, vitest_1.expect)(reload.status).toBe(200);
        (0, vitest_1.expect)(reload.body.diameter_mm).toBe(1250.5);
        (0, vitest_1.expect)(reload.body.width_mm).toBe('800');
    });
    (0, vitest_1.it)('preserves existing fields for a diameter-only update and clears diameter with a blank value', async () => {
        state.dimensions.diameter_mm = '1250';
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, {
            diameter_mm: '',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.diameter_mm).toBeNull();
        (0, vitest_1.expect)(response.body.length_mm).toBe('1200');
        (0, vitest_1.expect)(response.body.weight_kg).toBe('42');
        (0, vitest_1.expect)(response.body.inlet_dn_mm).toBe('50');
        (0, vitest_1.expect)(response.body.notes).toBe('Existing dimensions');
    });
    (0, vitest_1.it)('edits an existing diameter without requiring a product type or changing other dimensions', async () => {
        state.dimensions.diameter_mm = '1250';
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, {
            diameter_mm: '1400',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.diameter_mm).toBe(1400);
        (0, vitest_1.expect)(response.body.height_mm).toBe('600');
        (0, vitest_1.expect)(response.body.outlet_dn_mm).toBe('40');
    });
    (0, vitest_1.it)('returns an empty object for a product with no dimensions record', async () => {
        state.dimensions = null;
        const response = await request(app, 'GET', `/api/v1/product-masters/${productId}/dimensions`, token);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toEqual({});
    });
    (0, vitest_1.it)('accepts zero as a valid diameter', async () => {
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, {
            diameter_mm: 0,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.diameter_mm).toBe(0);
    });
    (0, vitest_1.it)('saves, returns, and reloads a valid sand/media load without changing other dimensions', async () => {
        const save = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, {
            sand_media_per_filter_kg: '250.5',
        });
        (0, vitest_1.expect)(save.status).toBe(200);
        (0, vitest_1.expect)(save.body.sand_media_per_filter_kg).toBe(250.5);
        (0, vitest_1.expect)(save.body.length_mm).toBe('1200');
        (0, vitest_1.expect)(save.body.weight_kg).toBe('42');
        const reload = await request(app, 'GET', `/api/v1/product-masters/${productId}/dimensions`, token);
        (0, vitest_1.expect)(reload.status).toBe(200);
        (0, vitest_1.expect)(reload.body.sand_media_per_filter_kg).toBe(250.5);
        (0, vitest_1.expect)(reload.body.outlet_dn_mm).toBe('40');
    });
    (0, vitest_1.it)('preserves existing fields for a sand/media-only update and clears the value with a blank', async () => {
        state.dimensions.sand_media_per_filter_kg = '250';
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, {
            sand_media_per_filter_kg: '',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.sand_media_per_filter_kg).toBeNull();
        (0, vitest_1.expect)(response.body.length_mm).toBe('1200');
        (0, vitest_1.expect)(response.body.weight_kg).toBe('42');
        (0, vitest_1.expect)(response.body.notes).toBe('Existing dimensions');
    });
    (0, vitest_1.it)('accepts zero as an explicit sand/media load', async () => {
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, {
            sand_media_per_filter_kg: 0,
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.sand_media_per_filter_kg).toBe(0);
    });
    vitest_1.it.each(['-1', 'Infinity', 'not-a-number'])('rejects invalid diameter %s', async (diameter_mm) => {
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, { diameter_mm });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_REQUEST');
        (0, vitest_1.expect)(response.body.error.message).toContain('diameter_mm');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO product_dimensions'))).toBe(false);
    });
    vitest_1.it.each(['-1', 'Infinity', 'not-a-number'])('rejects invalid sand/media load %s', async (sand_media_per_filter_kg) => {
        const response = await request(app, 'PUT', `/api/v1/product-masters/${productId}/dimensions`, token, { sand_media_per_filter_kg });
        (0, vitest_1.expect)(response.status).toBe(400);
        (0, vitest_1.expect)(response.body.error.code).toBe('INVALID_REQUEST');
        (0, vitest_1.expect)(response.body.error.message).toContain('sand_media_per_filter_kg');
        (0, vitest_1.expect)(state.calls.some(call => call.sql.includes('INSERT INTO product_dimensions'))).toBe(false);
    });
});
