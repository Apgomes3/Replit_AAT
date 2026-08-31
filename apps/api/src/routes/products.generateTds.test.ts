// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'generated-tds-test-secret';

const state = vi.hoisted(() => ({
  product: {} as Record<string, any>,
  document: null as Record<string, any> | null,
  revisions: [] as Array<Record<string, any>>,
  nextRevisionId: 1,
  usedDocumentCodes: [] as string[],
}));

vi.mock('../db', () => {
  const clientQuery = vi.fn(async (sql: string, params: any[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FOR UPDATE OF pm')) return { rows: [{ ...state.product }] };
    if (sql.includes('FROM product_variants')) return { rows: [{ id: 'variant-1', variant_code: 'V-1' }] };
    if (sql.includes('FROM standard_boms sb')) return { rows: [{ id: 'bom-1', bom_code: 'BOM-1', revision_code: 'A', lines: [{ line_number: 1, component_name: 'Motor' }] }] };
    if (sql.includes('FROM vendor_options')) return { rows: [{ id: 'vendor-1', vendor_name: 'Vendor A' }] };
    if (sql.includes('FROM product_dimensions')) return { rows: [{ length_mm: 1000 }] };
    if (sql.includes('FROM product_electrical')) return { rows: [{ voltage_v: 400 }] };
    if (sql.includes('FROM product_hydraulic')) return { rows: [{ design_flow_m3h: state.product.design_flow_m3h }] };
    if (sql.includes('FROM family_classifiers fc')) return { rows: [{ id: 'classifier-1', label: 'Connection Size', unit: 'DN', value_text: '80' }] };
    if (sql.includes('FROM product_usages')) return { rows: [{ id: 'project-1', project_code: 'PRJ-1' }] };
    if (sql.includes('FROM entity_relationships')) return { rows: [{ id: 'rel-1', edge_type: 'compatible_with' }] };
    if (sql.includes('FROM documents WHERE product_id=$1 ORDER BY')) return { rows: state.document ? [{ ...state.document }] : [] };
    if (sql.includes("generated_source='pim_tds'")) return { rows: state.document ? [{ ...state.document }] : [] };
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
    if (sql.includes('SELECT * FROM document_revisions')) return { rows: state.revisions.map(row => ({ ...row })).reverse() };
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
      const revision = state.revisions.find(row => row.id === params[3])!;
      Object.assign(revision, { status: 'Draft', content: params[0], source_snapshot: params[1], generated_at: params[2] });
      return { rows: [{ ...revision }] };
    }
    if (sql.includes('UPDATE documents SET current_revision')) {
      Object.assign(state.document!, { current_revision: params[0], status: 'Draft' });
      return { rows: [{ ...state.document }] };
    }
    return { rows: [] };
  });
  const query = vi.fn(async () => ({ rows: [] }));
  return {
    query,
    default: {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    },
  };
});

function post(app: Express, token: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const req = http.request({
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

describe('PIM generated Technical Data Sheets', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: productRoutes } = await import('./products');
    app = express();
    app.use(express.json());
    app.use('/api/v1', productRoutes);
    token = jwt.sign({ id: 'actor-1', email: 'actor@example.com', role: 'engineer' }, testSecret);
  });

  beforeEach(() => {
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
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('creates one linked draft with complete content and a frozen source snapshot', async () => {
    const response = await post(app, token);

    expect(response.status).toBe(201);
    expect(response.body.document.product_id).toBe('product-1');
    expect(response.body.document.generated_source).toBe('pim_tds');
    expect(response.body.revision.content.sections.identity.manufacturer).toBe('Pump Co');
    expect(response.body.revision.content.sections.bill_of_materials[0].lines[0].component_name).toBe('Motor');
    expect(response.body.revision.source_snapshot.specifications.electrical.voltage_v).toBe(400);
    expect(response.body.revision.source_snapshot.vendors[0].vendor_name).toBe('Vendor A');
    expect(response.body.revision.source_snapshot.classifier_values[0].value_text).toBe('80');
  });

  it('regenerates an editable draft in place without creating a duplicate document or revision', async () => {
    const initial = await post(app, token);
    state.product.product_name = 'Updated Circulation Pump';
    const regenerated = await post(app, token);

    expect(regenerated.status).toBe(200);
    expect(regenerated.body.generation.action).toBe('updated');
    expect(regenerated.body.document.id).toBe(initial.body.document.id);
    expect(regenerated.body.revision.id).toBe(initial.body.revision.id);
    expect(state.revisions).toHaveLength(1);
    expect(regenerated.body.revision.source_snapshot.product.product_name).toBe('Updated Circulation Pump');
  });

  it('creates a new draft revision while preserving an approved source snapshot', async () => {
    await post(app, token);
    state.revisions[0].status = 'Approved';
    const approvedSnapshot = structuredClone(state.revisions[0].source_snapshot);
    state.document!.status = 'Approved';
    state.product.design_flow_m3h = 30;

    const regenerated = await post(app, token);

    expect(regenerated.body.generation.action).toBe('revision_created');
    expect(regenerated.body.revision.revision_code).toBe('B');
    expect(state.revisions).toHaveLength(2);
    expect(state.revisions[0].status).toBe('Approved');
    expect(state.revisions[0].source_snapshot).toEqual(approvedSnapshot);
    expect(regenerated.body.revision.source_snapshot.product.design_flow_m3h).toBe(30);
  });

  it('marks unavailable values and warns when a product has very little data', async () => {
    state.product = { id: 'product-1', product_code: 'P-EMPTY', product_name: 'Sparse Product' };

    const response = await post(app, token);

    expect(response.body.revision.content.sections.engineering_values.design_flow_m3h).toBeNull();
    expect(response.body.revision.content.unavailable_fields).toContain('manufacturer');
    expect(response.body.generation.warnings[0]).toContain('sparse');
  });

  it('chooses a controlled alternate code when a manual document already uses the standard TDS code', async () => {
    state.usedDocumentCodes = ['P-100-TDS'];

    const response = await post(app, token);

    expect(response.status).toBe(201);
    expect(response.body.document.document_code).toBe('P-100-TDS-PIM');
  });

  it('advances generated revision lettering beyond Z without repeating AA', async () => {
    await post(app, token);
    state.document!.status = 'Approved';
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

    expect(response.status).toBe(200);
    expect(response.body.revision.revision_code).toBe('AB');
  });
});