// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'tank-promotion-test-secret';
const tankId = 'tank-1';
const productId = 'product-1';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[]; scope: 'query' | 'client' }>,
  sourceTank: {
    id: 'tank-1',
    tank_code: 'TK-01',
    tank_name: 'Main Display Tank',
    tank_type: 'Display Tank',
    project_id: 'project-1',
    project_code: 'PRJ-01',
    project_name: 'Aquarium Project',
    product_master_id: null as string | null,
    shape_type: 'Rectangular',
    length_mm: '5000',
    width_mm: '3000',
    height_mm: '2500',
    design_water_level_mm: '2200',
    gross_volume_m3: '37.5',
    operating_volume_m3: '33',
    primary_material: 'Acrylic',
    notes: null,
  },
  promotedProduct: null as Record<string, any> | null,
  duplicatePimAssignment: null as Record<string, any> | null,
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
  moduleAccess: { projects: 'manage', pim: 'manage' } as Record<string, string>,
  designBookStatus: 'Draft',
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params, scope: 'query' });
    if (sql.includes('SELECT rma.access_level')) {
      return { rows: [{ access_level: state.moduleAccess[String(params[1])] || 'manage' }] };
    }
    if (sql.includes('INSERT INTO tanks')) {
      return {
        rows: [{
          id: 'project-only-tank',
          tank_code: params[0],
          project_id: params[1],
          tank_name: params[5],
          product_master_id: null,
        }],
      };
    }
    return { rows: [] };
  });

  const clientQuery = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params, scope: 'client' });
    if (sql.includes('FROM tanks t') && sql.includes('FOR UPDATE')) {
      return { rows: [{ ...state.sourceTank }] };
    }
    if (sql.includes('FROM design_books') && sql.includes('FOR SHARE')) {
      return { rows: [{ id: 'book-1', status: state.designBookStatus }] };
    }
    if (sql.includes('FROM exhibits') && sql.includes('FOR SHARE')) {
      return { rows: [{ id: 'exhibit-1', project_id: 'project-1' }] };
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
    if (sql.startsWith('SELECT id FROM tank_families')) return { rows: [{ id: 'family-1' }] };
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

  const client = { query: clientQuery, release: vi.fn() };
  return {
    query,
    default: {
      query,
      connect: vi.fn(async () => client),
    },
  };
});

function request(
  app: Express,
  method: string,
  path: string,
  role: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const payload = JSON.stringify(body);
      const token = jwt.sign({ id: `${role}-1`, email: `${role}@example.com`, role }, testSecret);
      const req = http.request({
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
            if (error) return reject(error);
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

describe('project tank promotion into PIM', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: projectRoutes } = await import('./projects');
    app = express();
    app.use(express.json());
    app.use('/api/v1', projectRoutes);
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.sourceTank.product_master_id = null;
    state.promotedProduct = null;
    state.duplicatePimAssignment = null;
    state.moduleAccess = { projects: 'manage', pim: 'manage' };
    state.designBookStatus = 'Draft';
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('keeps ordinary Design Book tank creation project-only', async () => {
    const response = await request(app, 'POST', '/api/v1/tanks', 'engineer', {
      tank_code: 'TK-PROJECT',
      project_id: 'project-1',
      exhibit_id: 'exhibit-1',
      tank_name: 'Project-only Tank',
      shape_type: 'Rectangular',
    });

    expect(response.status).toBe(201);
    expect(response.body.product_master_id).toBeNull();
    expect(state.calls.some(call => call.sql.includes('INSERT INTO product_masters'))).toBe(false);
  });

  it('explicitly creates and links a reusable PIM tank', async () => {
    const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'engineer', {
      design_book_id: 'book-1',
      product_code: 'PM-TNK-001',
      product_name: 'Reusable Main Display Tank',
      tank_family_id: 'family-1',
      standard_status: 'Concept',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: productId,
      product_code: 'PM-TNK-001',
      source_tank_id: tankId,
      source_tank_code: 'TK-01',
    });
    expect(state.calls.some(call => call.sql.startsWith('UPDATE tanks SET product_master_id'))).toBe(false);
    const insert = state.calls.find(call => call.sql.includes('INSERT INTO product_masters'))!;
    expect(JSON.parse(insert.params[18])).toMatchObject({
      design_book_id: 'book-1',
      tank_code: 'TK-01',
      project_code: 'PRJ-01',
    });
  });

  it('creates a project tank linked to a selected PIM tank with water-surface area', async () => {
    const response = await request(app, 'POST', '/api/v1/tanks/from-pim', 'engineer', {
      design_book_id: 'book-1',
      project_id: 'project-1',
      exhibit_id: 'exhibit-1',
      product_master_id: 'library-tank-1',
      tank_code: 'TK-LIB-01',
      tank_name: 'Main Exhibit',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      tank_code: 'TK-LIB-01',
      tank_name: 'Main Exhibit',
      product_master_id: 'library-tank-1',
      surface_area_m2: 15,
    });
    const insert = state.calls.find(call => call.scope === 'client' && call.sql.includes('INSERT INTO tanks'))!;
    expect(insert.params[5]).toBe('library-tank-1');
  });

  it('rejects promotion by a viewer', async () => {
    const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'viewer', {
      design_book_id: 'book-1',
      product_code: 'PM-TNK-001',
      product_name: 'Reusable Main Display Tank',
      tank_family_id: 'family-1',
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(state.calls.some(call => call.scope === 'client')).toBe(false);
  });

  it('rejects promotion when the user only has view access to PIM', async () => {
    state.moduleAccess.pim = 'view';
    const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'engineer', {
      design_book_id: 'book-1',
      product_code: 'PM-TNK-001',
      product_name: 'Reusable Main Display Tank',
      tank_family_id: 'family-1',
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MODULE_READ_ONLY');
    expect(state.calls.some(call => call.scope === 'client')).toBe(false);
  });

  it('rejects promotion when the linked Design Book is read-only', async () => {
    state.designBookStatus = 'Released';
    const response = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'engineer', {
      design_book_id: 'book-1',
      product_code: 'PM-TNK-001',
      product_name: 'Reusable Main Display Tank',
      tank_family_id: 'family-1',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DESIGN_BOOK_READ_ONLY');
    expect(state.calls.some(call => call.sql.includes('INSERT INTO product_masters'))).toBe(false);
  });

  it('returns a conflict instead of creating a duplicate library record', async () => {
    const payload = {
      design_book_id: 'book-1',
      product_code: 'PM-TNK-001',
      product_name: 'Reusable Main Display Tank',
      tank_family_id: 'family-1',
    };
    const first = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'admin', payload);
    const second = await request(app, 'POST', `/api/v1/tanks/${tankId}/promote-to-pim`, 'admin', payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_PROMOTION');
    expect(second.body.existing_product.product_code).toBe('PM-TNK-001');
    expect(state.calls.filter(call => call.sql.includes('INSERT INTO product_masters'))).toHaveLength(1);
  });
});