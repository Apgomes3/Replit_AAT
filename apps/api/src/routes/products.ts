import { NextFunction, Router, Response } from 'express';
import pool, { query } from '../db';
import { logAudit } from '../db/audit';
import { authenticate, requireModuleAccess, requireModuleManage, requireRole, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { calculateWaterSurfaceAreaM2 } from '../lib/tankCalculations';
import { isSupportedCurrency, SUPPORTED_CURRENCY_TEXT } from '../lib/currencies';

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

async function refreshDefaultBomCost(db: { query: typeof query }, productId: string) {
  await db.query(
    `WITH latest_bom AS (
       SELECT id FROM standard_boms WHERE product_master_id=$1
       ORDER BY effective_from DESC NULLS LAST, created_at DESC LIMIT 1
     ), priced AS (
       SELECT COALESCE(bl.quantity,1) AS quantity,
              COALESCE(c.cost,sp.cost) AS line_cost,
              COALESCE(c.currency,sp.currency,'USD') AS line_currency,
              pm.currency AS product_currency,
              line_rate.rate_per_usd AS line_rate,
              product_rate.rate_per_usd AS product_rate
       FROM latest_bom lb
       LEFT JOIN bom_lines bl ON bl.standard_bom_id=lb.id
       LEFT JOIN components c ON c.id=bl.component_id
       LEFT JOIN product_masters sp ON sp.id=bl.sub_product_id
       JOIN product_masters pm ON pm.id=$1
       LEFT JOIN platform_exchange_rates line_rate ON line_rate.currency_code=COALESCE(c.currency,sp.currency,'USD')
       LEFT JOIN platform_exchange_rates product_rate ON product_rate.currency_code=pm.currency
     ), total AS (
       SELECT CASE WHEN COUNT(*) FILTER (
          WHERE line_cost IS NOT NULL AND line_currency<>product_currency
            AND (line_rate IS NULL OR product_rate IS NULL)
        ) > 0 THEN NULL
        ELSE COALESCE(SUM(quantity * CASE
          WHEN line_cost IS NULL THEN 0
          WHEN line_currency=product_currency THEN line_cost
          ELSE line_cost / line_rate * product_rate
        END),0) END AS value
       FROM priced
     )
     UPDATE product_masters SET cost=(SELECT value FROM total),updated_at=NOW()
     WHERE id=$1 AND cost_is_override=false`,
    [productId],
  );
}
const imageStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_, file, cb) => {
  cb(null, file.mimetype.startsWith('image/'));
} });

const router = Router();
router.use(authenticate, requireModuleAccess('pim'));

type DbClient = { query: typeof query; release?: () => void };
const AAT_SAND_FILTER_FRICTION_DEFAULT_KEY = 'aat_sand_filter_friction_loss_v1';

const withProductTransaction = async <T>(work: (client: DbClient) => Promise<T>): Promise<T> => {
  const connect = (pool as any).connect;
  const client: DbClient = typeof connect === 'function'
    ? await connect.call(pool)
    : { query };
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
};

const normalizeDesignFlow = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    const error: any = new Error('Design flow must be a finite, non-negative value in m³/h');
    error.status = 400;
    error.code = 'INVALID_DESIGN_FLOW';
    throw error;
  }
  return normalized;
};

const isAatSandFilter = (product: {
  manufacturer?: unknown;
  product_name?: unknown;
  model?: unknown;
}) => {
  const manufacturer = String(product.manufacturer ?? '').trim().toLowerCase();
  const identity = `${String(product.product_name ?? '')} ${String(product.model ?? '')}`.toLowerCase();
  return manufacturer === 'aat' && /(^|\W)sand[\s-]*filter(\W|$)/.test(identity);
};

const flowsConflict = (productFlow: unknown, hydraulicFlow: unknown) =>
  productFlow != null && hydraulicFlow != null && Number(productFlow) !== Number(hydraulicFlow);

const insertAuditTx = (
  client: DbClient,
  actorId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  details: Record<string, any>,
) => client.query(
  `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details)
   VALUES ($1,$2,$3,$4,$5)`,
  [entityType, entityId, action, actorId, details],
);

const designFlowAuditDetails = (
  source: 'product_master' | 'hydraulic_card' | 'reconciliation' | 'product_create' | 'product_duplicate',
  designFlow: number | null,
  previousProductFlow: unknown,
  previousHydraulicFlow: unknown,
) => ({
  summary: 'Linked Product Master and Hydraulic design flow updated',
  source,
  design_flow_m3h: designFlow,
  previous_product_design_flow_m3h: previousProductFlow ?? null,
  previous_hydraulic_design_flow_m3h: previousHydraulicFlow ?? null,
  resolved_conflict: flowsConflict(previousProductFlow, previousHydraulicFlow),
});

const revisionOrdinal = (code: string) => {
  if (!/^[A-Z]+$/.test(code)) return 0;
  return [...code].reduce(
    (total, character) => (total * 26) + character.charCodeAt(0) - 64,
    0,
  );
};

const revisionCodeFromOrdinal = (ordinal: number) => {
  let remaining = ordinal;
  let code = '';
  while (remaining > 0) {
    remaining -= 1;
    code = String.fromCharCode(65 + (remaining % 26)) + code;
    remaining = Math.floor(remaining / 26);
  }
  return code || 'A';
};

const nextRevisionCode = (existing: string[]) => {
  const maximum = existing.reduce(
    (highest, code) => Math.max(highest, revisionOrdinal(code.trim().toUpperCase())),
    0,
  );
  return revisionCodeFromOrdinal(maximum + 1);
};

const isEditableDocumentRevision = (status: unknown) =>
  ['Draft', 'Internal Review', 'Review Commented', 'Resubmitted', 'Rejected'].includes(String(status));

const readPimTdsSource = async (client: DbClient, productId: string) => {
  const productResult = await client.query(
    `SELECT pm.*, pf.product_family_code, pf.product_family_name,
            m.material_name, m.material_category, m.density, m.chemical_resistance, m.temperature_limit
     FROM product_masters pm
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN materials m ON m.material_code=pm.primary_material_code
     WHERE pm.id::text=$1 OR pm.product_code=$1
     FOR UPDATE OF pm`,
    [productId],
  );
  const product = productResult.rows[0];
  if (!product) {
    const error: any = new Error('Product not found');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  const canonicalId = product.id;

  const [variants, boms, vendors, dimensions, electrical, hydraulic, pneumatic, classifiers, projects, relationships, linkedDocuments] =
    await Promise.all([
      client.query('SELECT * FROM product_variants WHERE product_master_id=$1 ORDER BY variant_code', [canonicalId]),
      client.query(
        `SELECT sb.*,
                COALESCE(json_agg(json_build_object(
                  'id', bl.id, 'line_number', bl.line_number, 'component_type', bl.component_type,
                  'component_reference_code', bl.component_reference_code, 'component_name', bl.component_name,
                  'quantity', bl.quantity, 'unit', bl.unit, 'is_optional', bl.is_optional, 'remarks', bl.remarks,
                  'sub_product_id', bl.sub_product_id, 'sub_product_code', sub_pm.product_code,
                  'sub_product_name', sub_pm.product_name, 'component_code', c.component_code
                ) ORDER BY bl.line_number) FILTER (WHERE bl.id IS NOT NULL), '[]'::json) AS lines
         FROM standard_boms sb
         LEFT JOIN bom_lines bl ON bl.standard_bom_id=sb.id
         LEFT JOIN components c ON c.id=bl.component_id
         LEFT JOIN product_masters sub_pm ON sub_pm.id=bl.sub_product_id
         WHERE sb.product_master_id=$1
         GROUP BY sb.id
         ORDER BY sb.effective_from DESC`,
        [canonicalId],
      ),
      client.query('SELECT * FROM vendor_options WHERE product_master_id=$1 ORDER BY vendor_option_code', [canonicalId]),
      client.query('SELECT * FROM product_dimensions WHERE product_master_id=$1', [canonicalId]),
      client.query('SELECT * FROM product_electrical WHERE product_master_id=$1', [canonicalId]),
      client.query('SELECT * FROM product_hydraulic WHERE product_master_id=$1', [canonicalId]),
      client.query('SELECT * FROM product_pneumatic WHERE product_master_id=$1', [canonicalId]),
      client.query(
        `SELECT fc.id, fc.label, fc.unit, fc.field_type, fc.sort_order, pcv.value_text
         FROM family_classifiers fc
         LEFT JOIN product_classifier_values pcv
           ON pcv.classifier_id=fc.id AND pcv.product_id=$1
         WHERE fc.family_id=$2
         ORDER BY fc.sort_order, fc.created_at`,
        [canonicalId, product.product_family_id],
      ),
      client.query(
        `SELECT DISTINCT p.id, p.project_code, p.project_name, p.project_status
         FROM product_usages pu JOIN projects p ON p.id=pu.project_id
         WHERE pu.product_master_id=$1 ORDER BY p.project_code`,
        [canonicalId],
      ),
      client.query(
        `SELECT er.* FROM entity_relationships er
         WHERE (er.source_id=$1 AND er.source_type IN ('product', 'product_master'))
            OR (er.target_id=$1 AND er.target_type IN ('product', 'product_master'))
         ORDER BY er.created_at`,
        [canonicalId],
      ),
      client.query(
        `SELECT id, document_code, document_title, document_type, current_revision, status
         FROM documents WHERE product_id=$1 ORDER BY document_type, document_code`,
        [canonicalId],
      ),
    ]);

  const capturedAt = new Date().toISOString();
  const isPneumaticProduct = String(product.product_category || '').toLowerCase() === 'pneumatic';
  const specificationRows = {
    dimensions: dimensions.rows[0] ?? null,
    electrical: electrical.rows[0] ?? null,
    hydraulic: hydraulic.rows[0] ?? null,
    pneumatic: isPneumaticProduct ? pneumatic.rows[0] ?? null : null,
  };
  const sourceSnapshot = {
    schema_version: 1,
    source: 'PIM Product Master',
    source_product_id: canonicalId,
    source_product_code: product.product_code,
    generated_at: capturedAt,
    product,
    specifications: specificationRows,
    classifier_values: classifiers.rows,
    variants: variants.rows,
    boms: boms.rows,
    vendors: vendors.rows,
    linked_context: {
      projects: projects.rows,
      relationships: relationships.rows,
      documents: linkedDocuments.rows,
    },
  };

  const knownValues: Record<string, unknown> = {
    product_code: product.product_code,
    product_name: product.product_name,
    product_category: product.product_category,
    application_type: product.application_type,
    manufacturer: product.manufacturer,
    model: product.model,
    design_flow_m3h: product.design_flow_m3h,
    design_pressure_bar: product.design_pressure_bar,
    design_head_m: product.design_head_m,
    power_kw: product.power_kw,
    primary_material_code: product.primary_material_code,
    image_url: product.image_url,
    product_description: product.product_description,
    tank_classification: product.tank_classification,
    tank_engineering_details: product.tank_engineering_details,
    notes: product.notes,
    dimensions: specificationRows.dimensions,
    electrical: specificationRows.electrical,
    hydraulic: specificationRows.hydraulic,
    pneumatic: specificationRows.pneumatic,
    bill_of_materials: boms.rows,
    vendors: vendors.rows,
    linked_projects: projects.rows,
  };
  const unavailableFields = Object.entries(knownValues)
    .filter(([, value]) => value == null || (Array.isArray(value) && value.length === 0))
    .map(([field]) => field);

  const content = {
    template: 'PIM Technical Data Sheet',
    title: `${product.product_code} — ${product.product_name}`,
    source_product_id: canonicalId,
    generated_at: capturedAt,
    sections: {
      identity: {
        product_code: product.product_code,
        product_name: product.product_name,
        manufacturer: product.manufacturer ?? null,
        model: product.model ?? null,
        image_url: product.image_url ?? null,
        product_description: product.product_description ?? null,
      },
      classification: {
        product_category: product.product_category ?? null,
        application_type: product.application_type ?? null,
        product_family: product.product_family_name ?? null,
        standard_status: product.standard_status ?? null,
        tank_classification: product.tank_classification ?? null,
        classifier_values: classifiers.rows,
      },
      engineering_values: {
        design_flow_m3h: product.design_flow_m3h ?? null,
        design_pressure_bar: product.design_pressure_bar ?? null,
        design_head_m: product.design_head_m ?? null,
        power_kw: product.power_kw ?? null,
      },
      materials: {
        primary_material_code: product.primary_material_code ?? null,
        material_name: product.material_name ?? null,
        material_category: product.material_category ?? null,
        density: product.density ?? null,
        chemical_resistance: product.chemical_resistance ?? null,
        temperature_limit: product.temperature_limit ?? null,
      },
      dimensions: specificationRows.dimensions,
      electrical: specificationRows.electrical,
      hydraulic: specificationRows.hydraulic,
      pneumatic: specificationRows.pneumatic,
      tank_engineering: product.product_category === 'Tank' ? (product.tank_engineering_details || {}) : null,
      bill_of_materials: boms.rows,
      vendors: vendors.rows,
      linked_context: sourceSnapshot.linked_context,
      notes: product.notes ?? null,
    },
    unavailable_fields: unavailableFields,
  };

  return { canonicalId, product, capturedAt, sourceSnapshot, content };
};

// PRODUCT FAMILIES
router.get('/product-families', async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT pf.*, COUNT(pm.id) as product_count FROM product_families pf LEFT JOIN product_masters pm ON pm.product_family_id=pf.id GROUP BY pf.id ORDER BY pf.product_family_code');
  res.json({ items: result.rows });
});

router.get('/product-families/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product family not found' } });
  const products = await query('SELECT * FROM product_masters WHERE product_family_id=$1 ORDER BY product_code', [result.rows[0].id]);
  res.json({ ...result.rows[0], products: products.rows });
});

router.post('/product-families', authenticate, async (req: AuthRequest, res: Response) => {
  const { product_family_code, product_family_name, category_code, description } = req.body;
  const result = await query('INSERT INTO product_families (product_family_code, product_family_name, category_code, description) VALUES ($1,$2,$3,$4) RETURNING *',
    [product_family_code, product_family_name, category_code, description]);
  res.status(201).json(result.rows[0]);
});

router.put('/product-families/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { product_family_code, product_family_name, category_code, description, status } = req.body;
  if (!product_family_code?.trim() || !product_family_name?.trim()) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Family code and name are required' } });
  }
  try {
    const result = await query(
      'UPDATE product_families SET product_family_code=$1, product_family_name=$2, category_code=$3, description=$4, status=COALESCE($5, status), updated_at=NOW() WHERE id::text=$6 RETURNING *',
      [product_family_code.trim().toUpperCase(), product_family_name.trim(), category_code || null, description || null, status || null, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'A family with that code already exists' } });
    throw err;
  }
});

router.delete('/product-families/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const existing = await query(
    `SELECT pf.id, pf.product_family_code, COUNT(pm.id)::int AS product_count
     FROM product_families pf
     LEFT JOIN product_masters pm ON pm.product_family_id=pf.id
     WHERE pf.id::text=$1 OR pf.product_family_code=$1
     GROUP BY pf.id`,
    [req.params.id],
  );
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
  if (existing.rows[0].product_count > 0) {
    return res.status(409).json({
      error: {
        code: 'IN_USE',
        message: `Cannot delete ${existing.rows[0].product_family_code} because ${existing.rows[0].product_count} product${existing.rows[0].product_count === 1 ? '' : 's'} still belong to it. Reassign the products first.`,
      },
    });
  }
  const deleted = await query(
    'DELETE FROM product_families WHERE id=$1 RETURNING id, product_family_code',
    [existing.rows[0].id],
  );
  if (!deleted.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
  res.json({ deleted: true, ...deleted.rows[0] });
});

// TANK FAMILIES
router.get('/tank-families', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT tf.*, COUNT(pm.id)::int as product_count
     FROM tank_families tf
     LEFT JOIN product_masters pm ON pm.tank_family_id = tf.id
     GROUP BY tf.id ORDER BY tf.sort_order, tf.name`
  );
  res.json({ items: result.rows });
});

router.get('/tank-families/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM tank_families WHERE id::text=$1 OR code=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
  const products = await query('SELECT * FROM product_masters WHERE tank_family_id=$1 ORDER BY product_code', [result.rows[0].id]);
  res.json({ ...result.rows[0], products: products.rows });
});

router.post('/tank-families', authenticate, async (req: AuthRequest, res: Response) => {
  const { code, name, description, sort_order } = req.body;
  if (!code || !name) return res.status(400).json({ error: { code: 'INVALID', message: 'code and name are required' } });
  const result = await query(
    'INSERT INTO tank_families (code, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
    [code.toUpperCase(), name, description || null, sort_order ?? 0]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/tank-families/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  const result = await query(
    'UPDATE tank_families SET name=$1, description=$2, sort_order=$3, updated_at=NOW() WHERE id::text=$4 RETURNING *',
    [name, description || null, sort_order ?? 0, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
  res.json(result.rows[0]);
});

router.delete('/tank-families/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT id FROM tank_families WHERE id::text=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
  await query('UPDATE product_masters SET tank_family_id=NULL WHERE tank_family_id::text=$1', [req.params.id]);
  await query('DELETE FROM tank_families WHERE id::text=$1', [req.params.id]);
  res.status(204).end();
});

// PRODUCT MASTERS
// Catalogue screens load the whole list at once (client-side family filter and counts), so the cap must
// stay above the catalogue size; 200 silently hid products once the ASW import took it to 300.
const PRODUCT_LIST_MAX_PAGE_SIZE = 1000;

router.get('/product-masters', authenticate, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const page_size = Math.min(parseInt(req.query.page_size as string) || 25, PRODUCT_LIST_MAX_PAGE_SIZE);
  const offset = (page - 1) * page_size;
  const filters: string[] = [];
  const params: any[] = [];

  // Status values have historically been entered through more than one
  // surface, so protect the default catalog view from casing/whitespace
  // variations as well as the canonical "Obsolete" value.
  if (req.query.include_obsolete !== 'true') {
    filters.push(`LOWER(BTRIM(COALESCE(pm.standard_status, ''))) <> 'obsolete'`);
  }
  if (req.query.family_id) { params.push(req.query.family_id); filters.push(`pm.product_family_id = $${params.length}`); }
  if (req.query.tank_family_id) { params.push(req.query.tank_family_id); filters.push(`pm.tank_family_id = $${params.length}`); }
  if (req.query.category) { params.push(req.query.category); filters.push(`pm.product_category = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`pm.standard_status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); const p = params.length; filters.push(`(pm.product_name ILIKE $${p} OR pm.product_code ILIKE $${p} OR pf.product_family_name ILIKE $${p} OR EXISTS (SELECT 1 FROM unnest(pm.synonyms) s WHERE s ILIKE $${p}))`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM product_masters pm LEFT JOIN product_families pf ON pm.product_family_id=pf.id ${where}`, params);
  params.push(page_size, offset);
  const result = await query(
    `SELECT pm.*, COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
       CASE
         WHEN pm.design_flow_m3h IS NOT NULL AND ph.design_flow_m3h IS NOT NULL
              AND pm.design_flow_m3h IS DISTINCT FROM ph.design_flow_m3h THEN 'conflict'
         WHEN pm.design_flow_m3h IS NULL AND ph.design_flow_m3h IS NULL THEN 'empty'
         ELSE 'synchronized'
       END AS design_flow_sync_status,
       pf.product_family_name, tf.name AS tank_family_name, pm.cost AS bom_or_custom_cost,
       COALESCE(
         pm.surface_area_m2,
         CASE
           WHEN pm.shape_type='Cylindrical' AND pm.width_mm IS NOT NULL
             THEN ROUND((PI() * POWER(pm.width_mm / 2.0, 2) / 1000000.0)::numeric, 4)
           WHEN pm.shape_type IS DISTINCT FROM 'Custom' AND pm.length_mm IS NOT NULL AND pm.width_mm IS NOT NULL
             THEN ROUND((pm.length_mm * pm.width_mm / 1000000.0)::numeric, 4)
           ELSE NULL
         END
       ) AS surface_area_m2,
       COALESCE(st.tank_code, pm.source_tank_snapshot->>'tank_code') AS source_tank_code,
       COALESCE(sp.project_code, pm.source_tank_snapshot->>'project_code') AS source_project_code,
       COALESCE(sp.project_name, pm.source_tank_snapshot->>'project_name') AS source_project_name
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     LEFT JOIN product_families pf ON pm.product_family_id=pf.id
     LEFT JOIN tank_families tf ON pm.tank_family_id=tf.id
     LEFT JOIN tanks st ON st.id=pm.source_tank_id
     LEFT JOIN projects sp ON sp.id=st.project_id
     ${where} ORDER BY pm.product_code LIMIT $${params.length-1} OFFSET $${params.length}`,
    params,
  );
  res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});

router.get('/product-masters/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT pm.*, COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
       CASE
         WHEN pm.design_flow_m3h IS NOT NULL AND ph.design_flow_m3h IS NOT NULL
              AND pm.design_flow_m3h IS DISTINCT FROM ph.design_flow_m3h THEN 'conflict'
         WHEN pm.design_flow_m3h IS NULL AND ph.design_flow_m3h IS NULL THEN 'empty'
         ELSE 'synchronized'
       END AS design_flow_sync_status,
       pm.design_flow_m3h AS product_design_flow_m3h,
       ph.design_flow_m3h AS hydraulic_design_flow_m3h,
        pf.product_family_name, m.material_name, pm.cost AS bom_or_custom_cost,
       COALESCE(
         pm.surface_area_m2,
         CASE
           WHEN pm.shape_type='Cylindrical' AND pm.width_mm IS NOT NULL
             THEN ROUND((PI() * POWER(pm.width_mm / 2.0, 2) / 1000000.0)::numeric, 4)
           WHEN pm.shape_type IS DISTINCT FROM 'Custom' AND pm.length_mm IS NOT NULL AND pm.width_mm IS NOT NULL
             THEN ROUND((pm.length_mm * pm.width_mm / 1000000.0)::numeric, 4)
           ELSE NULL
         END
       ) AS surface_area_m2,
       COALESCE(st.tank_code, pm.source_tank_snapshot->>'tank_code') AS source_tank_code,
       COALESCE(sp.project_code, pm.source_tank_snapshot->>'project_code') AS source_project_code,
       COALESCE(sp.project_name, pm.source_tank_snapshot->>'project_name') AS source_project_name
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     LEFT JOIN product_families pf ON pm.product_family_id=pf.id
     LEFT JOIN materials m ON pm.primary_material_code=m.material_code
     LEFT JOIN tanks st ON st.id=pm.source_tank_id
     LEFT JOIN projects sp ON sp.id=st.project_id
     WHERE pm.id::text=$1 OR pm.product_code=$1`,
    [req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const variants = await query('SELECT * FROM product_variants WHERE product_master_id=$1 ORDER BY variant_code', [result.rows[0].id]);
  const boms = await query('SELECT * FROM standard_boms WHERE product_master_id=$1 ORDER BY effective_from DESC', [result.rows[0].id]);
  const vendors = await query('SELECT * FROM vendor_options WHERE product_master_id=$1 ORDER BY vendor_option_code', [result.rows[0].id]);
  const projectUsage = await query(`SELECT DISTINCT p.project_code, p.project_name, p.project_status FROM product_usages pu JOIN projects p ON pu.project_id=p.id WHERE pu.product_master_id=$1`, [result.rows[0].id]);
  const documents = await query(`SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name FROM documents d LEFT JOIN users u ON d.created_by=u.id WHERE d.product_id=$1 ORDER BY d.document_type, d.document_code`, [result.rows[0].id]);
  res.json({ ...result.rows[0], variants: variants.rows, boms: boms.rows, vendors: vendors.rows, projects: projectUsage.rows, documents: documents.rows });
});

// Generated TDS documents use the normal document lifecycle. Each revision
// carries its own source snapshot so frozen review evidence is never rewritten.
router.post(
  '/product-masters/:id/generate-tds',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('pim'),
  requireModuleManage('documents'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
  const connect = (pool as any)?.connect;
  const client: DbClient = typeof connect === 'function'
    ? await connect.call(pool)
    : { query };
  try {
    await client.query('BEGIN');
    const { canonicalId, product, capturedAt, sourceSnapshot, content } =
      await readPimTdsSource(client, String(req.params.id));
    const existingDocument = await client.query(
      `SELECT * FROM documents
       WHERE product_id=$1 AND generated_source='pim_tds'
       FOR UPDATE`,
      [canonicalId],
    );
    let document: any;
    let revision: any;
    let action: 'created' | 'updated' | 'revision_created';

    if (!existingDocument.rows[0]) {
      const baseDocumentCode = `${product.product_code}-TDS`;
      const usedCodesResult = await client.query(
        'SELECT document_code FROM documents WHERE document_code LIKE $1',
        [`${baseDocumentCode}%`],
      );
      const usedCodes = new Set(usedCodesResult.rows.map(row => row.document_code));
      let documentCode = baseDocumentCode;
      if (usedCodes.has(documentCode)) {
        documentCode = `${baseDocumentCode}-PIM`;
        let suffix = 2;
        while (usedCodes.has(documentCode)) {
          documentCode = `${baseDocumentCode}-PIM-${suffix}`;
          suffix += 1;
        }
      }
      const documentResult = await client.query(
        `INSERT INTO documents
           (document_code, document_title, document_type, discipline, product_id,
            current_revision, status, owner, notes, generated_source, created_by)
         VALUES ($1,$2,'Technical Data Sheet',$3,$4,'A','Draft',$5,$6,'pim_tds',$7)
         RETURNING *`,
        [
          documentCode,
          `${product.product_name} Technical Data Sheet`,
          product.product_category || 'General',
          canonicalId,
          product.manufacturer || 'PIM Product Master',
          'Generated from the current Product Master data',
          req.user!.id,
        ],
      );
      document = documentResult.rows[0];
      const revisionResult = await client.query(
        `INSERT INTO document_revisions
           (document_id, revision_code, revision_purpose, status, issued_by,
            content, source_snapshot, generated_at, created_by, generated_source)
         VALUES ($1,'A','Generated from PIM Product Master','Draft',$2,$3,$4,$5,$2,'pim_tds')
         RETURNING *`,
        [document.id, req.user!.id, content, sourceSnapshot, capturedAt],
      );
      revision = revisionResult.rows[0];
      action = 'created';
      await client.query(
        `INSERT INTO lifecycle_transitions (entity_type, entity_id, to_state, actor_id, comment)
         VALUES ('document',$1,'Draft',$2,$3)`,
        [document.id, req.user!.id, 'Generated TDS from Product Master'],
      );
    } else {
      document = existingDocument.rows[0];
      const previousDocumentStatus = document.status;
      const revisionsResult = await client.query(
        `SELECT * FROM document_revisions
         WHERE document_id=$1 ORDER BY created_at DESC`,
        [document.id],
      );
      const revisions = revisionsResult.rows;
      const latest = revisions[0];
      if (latest && isEditableDocumentRevision(latest.status)) {
        const revisionResult = await client.query(
          `UPDATE document_revisions
           SET revision_purpose='Regenerated from current PIM Product Master',
               status='Draft', content=$1, source_snapshot=$2, generated_at=$3
           WHERE id=$4
           RETURNING *`,
          [content, sourceSnapshot, capturedAt, latest.id],
        );
        revision = revisionResult.rows[0];
        action = 'updated';
      } else {
        const revisionCode = nextRevisionCode(revisions.map(row => row.revision_code));
        const revisionResult = await client.query(
          `INSERT INTO document_revisions
             (document_id, revision_code, revision_purpose, status, issued_by,
               content, source_snapshot, generated_at, created_by, generated_source)
           VALUES ($1,$2,'Generated from updated PIM Product Master','Draft',$3,$4,$5,$6,$3,'pim_tds')
           RETURNING *`,
          [document.id, revisionCode, req.user!.id, content, sourceSnapshot, capturedAt],
        );
        revision = revisionResult.rows[0];
        action = 'revision_created';
      }
      const updatedDocument = await client.query(
        `UPDATE documents SET current_revision=$1, status='Draft', updated_at=NOW()
         WHERE id=$2 RETURNING *`,
        [revision.revision_code, document.id],
      );
      document = updatedDocument.rows[0] || { ...document, current_revision: revision.revision_code, status: 'Draft' };
      await client.query(
        `INSERT INTO lifecycle_transitions (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('document',$1,$2,'Draft',$3,$4)`,
        [document.id, previousDocumentStatus, req.user!.id, 'TDS regenerated from Product Master'],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details)
       VALUES ('document',$1,'GENERATE_TDS',$2,$3)`,
      [document.id, req.user!.id, {
        summary: `${action === 'created' ? 'Generated' : 'Regenerated'} TDS from Product Master`,
        source_product_id: canonicalId,
        source_product_code: product.product_code,
        revision_code: revision.revision_code,
        generation_action: action,
      }],
    );
    await client.query('COMMIT');
    const unavailableFields = Array.isArray((content as any).unavailable_fields)
      ? (content as any).unavailable_fields
      : [];
    res.status(action === 'created' ? 201 : 200).json({
      document,
      revision,
      generation: {
        action,
        generated_at: capturedAt,
        source_product_id: canonicalId,
        warnings: unavailableFields.length >= 8
          ? [`Product data is sparse; ${unavailableFields.length} TDS fields are marked unavailable.`]
          : [],
      },
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if ((error as any)?.code === '23505') {
      (error as any).status = 409;
      (error as any).code = 'TDS_CONFLICT';
      (error as any).message = 'A document conflict prevented TDS generation. Refresh the product and try again.';
    }
    next(error);
  } finally {
    client.release?.();
  }
  },
);

router.post('/product-masters/bulk-import', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = req.body as { rows: Array<{ product_code: string; product_name: string; application_type?: string; primary_material_code?: string; family_code?: string; standard_status?: string; dn_size?: string; pressure_rating?: string; notes?: string }> };
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'rows array required' } });

  const created: string[] = [];
  const linked: string[] = [];
  const errors: Array<{ code: string; message: string }> = [];

  for (const row of rows) {
    if (!row.product_code || !row.product_name) { errors.push({ code: row.product_code || '?', message: 'product_code and product_name required' }); continue; }
    try {
      const existing = await query('SELECT id FROM product_masters WHERE product_code=$1', [row.product_code]);
      if (existing.rows[0]) {
        linked.push(row.product_code);
        continue;
      }
      let family_id: string | null = null;
      if (row.family_code) {
        const fam = await query('SELECT id FROM product_families WHERE product_family_code=$1', [row.family_code]);
        if (fam.rows[0]) family_id = fam.rows[0].id;
      }
      const noteParts: string[] = [];
      if (row.dn_size) noteParts.push(`DN: ${row.dn_size}`);
      if (row.pressure_rating) noteParts.push(`Rating: ${row.pressure_rating}`);
      if (row.notes) noteParts.push(row.notes);
      const notes = noteParts.length ? noteParts.join(' | ') : null;
      await query(
        'INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, primary_material_code, standard_status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [row.product_code, family_id, row.product_name, 'Piping', row.application_type || null, row.primary_material_code || null, row.standard_status || 'Active', notes]
      );
      created.push(row.product_code);
    } catch (err: any) {
      errors.push({ code: row.product_code, message: err.message });
    }
  }

  res.json({ created: created.length, linked: linked.length, errors, created_codes: created, linked_codes: linked });
});

const TANK_CLASSIFICATIONS = [
  'Cylindrical atmospheric FRP tank',
  'Rectangular atmospheric FRP tank',
  'Atmospheric FRP steel tank',
] as const;

function validateTankEngineeringPayload(category: unknown, classification: unknown, input: unknown) {
  const hasTankPayload = Boolean(classification) ||
    (input != null && typeof input === 'object' && !Array.isArray(input) && Object.keys(input as object).length > 0);
  if (String(category || '').toLowerCase() !== 'tank' && hasTankPayload) {
    return { error: 'Tank classification and engineering details can only be saved on Tank products.', details: {} };
  }
  if (classification && !TANK_CLASSIFICATIONS.includes(classification as any)) {
    return { error: 'Unsupported tank classification.', details: {} };
  }
  if (input != null && (typeof input !== 'object' || Array.isArray(input))) {
    return { error: 'tank_engineering_details must be an object.', details: {} };
  }
  const details: Record<string, any> = input ? { ...(input as Record<string, any>) } : {};
  for (const key of ['operating_temperature_min_c', 'operating_temperature_max_c', 'max_operating_pressure_bar', 'max_possible_pressure_bar']) {
    if (details[key] != null && details[key] !== '' && !Number.isFinite(Number(details[key]))) {
      return { error: `${key} must be a finite number or blank.`, details };
    }
  }
  if (details.operating_temperature_min_c != null && details.operating_temperature_max_c != null &&
      Number(details.operating_temperature_min_c) > Number(details.operating_temperature_max_c)) {
    return { error: 'Minimum operating temperature cannot exceed maximum operating temperature.', details };
  }
  if ((details.max_operating_pressure_bar != null && Number(details.max_operating_pressure_bar) < 0) ||
      (details.max_possible_pressure_bar != null && Number(details.max_possible_pressure_bar) < 0)) {
    return { error: 'Tank pressures must be non-negative.', details };
  }
  if (details.max_operating_pressure_bar != null && details.max_possible_pressure_bar != null &&
      Number(details.max_operating_pressure_bar) > Number(details.max_possible_pressure_bar)) {
    return { error: 'Maximum operating pressure cannot exceed maximum possible pressure.', details };
  }
  return { error: null, details };
}

router.post('/product-masters', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const {
    product_code, product_family_id, tank_family_id, product_name, product_category, application_type,
    design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes,
     shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, ozone_production_capacity_g_h,
     manufacturer, model, configuration, control_type, signal_type, control_type_optional, lamp_count,
     product_description, tank_classification, tank_engineering_details,
  } = req.body;
  if (!product_code || !product_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'product_code and product_name required' } });
  const tankValidation = validateTankEngineeringPayload(product_category, tank_classification, tank_engineering_details);
  if (tankValidation.error) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: tankValidation.error } });
  const ozoneCapacity = ozone_production_capacity_g_h == null || ozone_production_capacity_g_h === '' ? null : Number(ozone_production_capacity_g_h);
  if (ozoneCapacity != null && (!Number.isFinite(ozoneCapacity) || ozoneCapacity <= 0)) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'ozone_production_capacity_g_h must be a positive number or blank' } });
  const surfaceAreaM2 = calculateWaterSurfaceAreaM2(
    shape_type,
    length_mm ? parseFloat(length_mm) : null,
    width_mm ? parseFloat(width_mm) : null,
  );
  try {
    const linkedFlow = normalizeDesignFlow(design_flow_m3h);
    const applyAatFrictionDefault = isAatSandFilter({ manufacturer, product_name, model });
    const created = await withProductTransaction(async client => {
      const result = await client.query(
        `INSERT INTO product_masters
          (product_code, product_family_id, tank_family_id, product_name, product_category, application_type,
           design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes,
           shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, surface_area_m2, cost,
               manufacturer, model, configuration, control_type, signal_type, control_type_optional, lamp_count, ozone_production_capacity_g_h,
               product_description, tank_classification, tank_engineering_details)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::jsonb) RETURNING *`,
        [
          product_code, product_family_id || null, tank_family_id || null, product_name, product_category, application_type,
          linkedFlow, design_pressure_bar || null, design_head_m || null, power_kw || null,
          primary_material_code || null, standard_status || 'Concept', notes || null,
          shape_type || null, length_mm || null, width_mm || null, height_mm || null,
          design_water_level_mm || null, gross_volume_m3 || null, operating_volume_m3 || null, surfaceAreaM2, 0,
          manufacturer || null, model || null, configuration || null, control_type || null,
           signal_type || null, Boolean(control_type_optional),
           lamp_count == null || lamp_count === '' ? null : Number(lamp_count),
           ozoneCapacity,
            product_description || null, tank_classification || null,
            JSON.stringify(tankValidation.details),
        ]);
      await client.query(
        'INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, friction_loss_mh2o, updated_at) VALUES ($1,$2,$3,NOW())',
        [result.rows[0].id, linkedFlow, applyAatFrictionDefault ? 5.0 : null],
      );
      if (applyAatFrictionDefault) {
        await client.query(
          `INSERT INTO product_hydraulic_catalog_defaults (product_master_id, default_key)
           VALUES ($1,$2)
           ON CONFLICT (product_master_id, default_key) DO NOTHING`,
          [result.rows[0].id, AAT_SAND_FILTER_FRICTION_DEFAULT_KEY],
        );
      }
      await insertAuditTx(client, req.user!.id, 'product', result.rows[0].id, 'CREATE', {
        summary: `Product ${product_code} created`,
        product_code,
        product_name,
        standard_status: standard_status || 'Concept',
      });
      await insertAuditTx(client, req.user!.id, 'product', result.rows[0].id, 'LINKED_DESIGN_FLOW_UPDATE',
        designFlowAuditDetails('product_create', linkedFlow, null, null));
      return { ...result.rows[0], design_flow_m3h: linkedFlow, design_flow_sync_status: linkedFlow == null ? 'empty' : 'synchronized' };
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.delete('/product-masters/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const inUse = await query(
    `SELECT 1 FROM tanks WHERE product_master_id=$1
     UNION ALL SELECT 1 FROM product_usages WHERE product_master_id=$1
     UNION ALL SELECT 1 FROM uv_engineering_catalogs WHERE product_master_id=$1
     LIMIT 1`, [id]);
  if (inUse.rows.length > 0) {
    return res.status(409).json({ error: { code: 'IN_USE', message: 'Cannot delete — product is linked to existing tanks, equipment, or usages. Remove those links first.' } });
  }
  await query('DELETE FROM bom_lines WHERE standard_bom_id IN (SELECT id FROM standard_boms WHERE product_master_id=$1)', [id]);
  await query('DELETE FROM standard_boms WHERE product_master_id=$1', [id]);
  await query('DELETE FROM entity_relationships WHERE source_id=$1 OR target_id=$1', [id]);
  await query('DELETE FROM documents WHERE product_id=$1', [id]);
  const result = await query('DELETE FROM product_masters WHERE id::text=$1 RETURNING id, product_code', [id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  await logAudit(req.user!.id, 'product', String(id), 'DELETE', {
    summary: `Product ${result.rows[0].product_code} deleted`,
    product_code: result.rows[0].product_code,
  });
  res.json({ deleted: true });
});

router.put('/product-masters/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { product_code, product_name, product_category, application_type, design_flow_m3h, design_head_m, power_kw, primary_material_code, standard_status, image_url, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, wall_thickness_mm, weight_kg, product_family_id, tank_family_id, synonyms, cost, sell_price, currency, manufacturer, model, configuration, control_type, signal_type, control_type_optional, status, lamp_count, ozone_production_capacity_g_h, product_description, tank_classification, tank_engineering_details } = req.body;
  const tankValidation = validateTankEngineeringPayload(product_category, tank_classification, tank_engineering_details);
  if (tankValidation.error) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: tankValidation.error } });
  const tankDetails = tankValidation.details;
  const hasPowerKw = Object.prototype.hasOwnProperty.call(req.body, 'power_kw');
  const hasLampCount = Object.prototype.hasOwnProperty.call(req.body, 'lamp_count');
  const hasOzoneCapacity = Object.prototype.hasOwnProperty.call(req.body, 'ozone_production_capacity_g_h');
  const ozoneCapacity = ozone_production_capacity_g_h == null || ozone_production_capacity_g_h === '' ? null : Number(ozone_production_capacity_g_h);
  if (hasOzoneCapacity && ozoneCapacity != null && (!Number.isFinite(ozoneCapacity) || ozoneCapacity <= 0)) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'ozone_production_capacity_g_h must be a positive number or blank' } });
  const lampCountValue = lamp_count == null || lamp_count === '' ? null : Number(lamp_count);
  if (hasLampCount && lampCountValue != null && (!Number.isInteger(lampCountValue) || lampCountValue <= 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'lamp_count must be a positive integer or blank' } });
  }
  const hasDesignFlow = Object.prototype.hasOwnProperty.call(req.body, 'design_flow_m3h');
  const synonymsArr = Array.isArray(synonyms) ? synonyms.filter(Boolean) : [];
  const costVal = (cost === null || cost === undefined || cost === '') ? 0 : parseFloat(String(cost));
  const sellVal = (sell_price === null || sell_price === undefined || sell_price === '') ? null : parseFloat(String(sell_price));
  const weightVal = weight_kg != null && weight_kg !== '' ? parseFloat(weight_kg) : null;
  // Normalise the incoming code — null means "don't change"
  const newCode = (product_code && String(product_code).trim()) ? String(product_code).trim().toUpperCase() : null;
  let previousProductFlow: unknown;
  let previousHydraulicFlow: unknown;
  let linkedDesignFlow: number | null | undefined;
  let updated: any;
  try {
    updated = await withProductTransaction(async client => {
      if (newCode) {
        const conflict = await client.query('SELECT id FROM product_masters WHERE product_code=$1 AND id::text!=$2', [newCode, req.params.id]);
        if (conflict.rows.length > 0) {
          const error: any = new Error(`Product code ${newCode} is already in use`);
          error.status = 409;
          error.code = 'CONFLICT';
          throw error;
        }
      }
      const current = await client.query(
        `SELECT pm.design_flow_m3h AS product_design_flow_m3h,pm.cost,pm.cost_is_override,pm.currency,
                ph.design_flow_m3h AS hydraulic_design_flow_m3h
         FROM product_masters pm
         LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
         WHERE pm.id=$1
         FOR UPDATE OF pm`,
        [req.params.id],
      );
      previousProductFlow = current.rows[0]?.product_design_flow_m3h;
      previousHydraulicFlow = current.rows[0]?.hydraulic_design_flow_m3h;
      if (flowsConflict(previousProductFlow, previousHydraulicFlow) && req.body.design_flow_conflict_resolution !== 'product_master') {
        const error: any = new Error('Conflicting populated design flows require an explicit product_master resolution');
        error.status = 409;
        error.code = 'DESIGN_FLOW_CONFLICT';
        throw error;
      }
      linkedDesignFlow = flowsConflict(previousProductFlow, previousHydraulicFlow)
        ? Number(previousProductFlow)
        : hasDesignFlow
          ? normalizeDesignFlow(design_flow_m3h)
          : previousHydraulicFlow != null
            ? Number(previousHydraulicFlow)
            : previousProductFlow != null
              ? Number(previousProductFlow)
              : null;
      const result = await client.query(
        `UPDATE product_masters SET product_code=COALESCE($32, product_code), product_name=$1, product_category=$2, application_type=$3, design_flow_m3h=$4, design_head_m=$5, power_kw=CASE WHEN $33 THEN $6 ELSE power_kw END, primary_material_code=$7, standard_status=$8, image_url=$9, notes=$10, shape_type=$11, length_mm=$12, width_mm=$13, height_mm=$14, design_water_level_mm=$15, gross_volume_m3=$16, operating_volume_m3=$17, product_family_id=$18, synonyms=$19, tank_family_id=$20, cost=$21, cost_is_override=CASE WHEN $21::numeric IS DISTINCT FROM cost THEN true ELSE cost_is_override END, sell_price=$22, currency=$23, wall_thickness_mm=$24, weight_kg=$25, manufacturer=$26, model=$27, configuration=$28, control_type=$29, status=COALESCE($30,status), lamp_count=CASE WHEN $34 THEN $35 ELSE lamp_count END, ozone_production_capacity_g_h=CASE WHEN $36 THEN $37 ELSE ozone_production_capacity_g_h END, updated_at=NOW() WHERE id=$31 RETURNING *`,
        [product_name, product_category, application_type, linkedDesignFlow, design_head_m || null, power_kw, primary_material_code, standard_status, image_url || null, notes, shape_type || null, length_mm || null, width_mm || null, height_mm || null, design_water_level_mm || null, gross_volume_m3 || null, operating_volume_m3 || null, product_family_id || null, synonymsArr, tank_family_id || null, costVal, sellVal, currency || 'USD', wall_thickness_mm || null, weightVal, manufacturer || null, model || null, configuration || null, control_type || null, status || null, req.params.id, newCode, hasPowerKw, hasLampCount, lampCountValue, hasOzoneCapacity, ozoneCapacity]);
      const metadataResult = await client.query(
        `UPDATE product_masters
         SET signal_type=CASE WHEN $2 THEN $3 ELSE signal_type END,
             control_type_optional=CASE WHEN $4 THEN $5 ELSE control_type_optional END,
             product_description=CASE WHEN $6 THEN $7 ELSE product_description END,
             tank_classification=CASE WHEN $8 THEN $9 ELSE tank_classification END,
             tank_engineering_details=CASE WHEN $10 THEN $11::jsonb ELSE tank_engineering_details END,
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [
          req.params.id,
          Object.prototype.hasOwnProperty.call(req.body, 'signal_type'),
          signal_type || null,
          Object.prototype.hasOwnProperty.call(req.body, 'control_type_optional'),
          Boolean(control_type_optional),
          Object.prototype.hasOwnProperty.call(req.body, 'product_description'),
          product_description || null,
          Object.prototype.hasOwnProperty.call(req.body, 'tank_classification'),
          tank_classification || null,
          Object.prototype.hasOwnProperty.call(req.body, 'tank_engineering_details'),
          JSON.stringify(tankDetails),
        ],
      );
      if (!result.rows[0]) {
        const error: any = new Error('Product not found');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      await client.query(
        `INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, updated_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (product_master_id) DO UPDATE SET design_flow_m3h=EXCLUDED.design_flow_m3h, updated_at=NOW()`,
        [req.params.id, linkedDesignFlow],
      );
      if (flowsConflict(previousProductFlow, previousHydraulicFlow)) {
        await client.query(
          `UPDATE product_design_flow_reconciliations
           SET status='resolved', resolution='product_master', resolved_value_m3h=$2,
               resolved_by=$3, resolved_at=NOW()
           WHERE product_master_id=$1 AND status='unresolved'`,
          [req.params.id, linkedDesignFlow, req.user!.id],
        );
      }
      if (hasDesignFlow || previousProductFlow !== previousHydraulicFlow) {
        await insertAuditTx(client, req.user!.id, 'product', String(req.params.id), 'LINKED_DESIGN_FLOW_UPDATE',
          designFlowAuditDetails('product_master', linkedDesignFlow ?? null, previousProductFlow, previousHydraulicFlow));
      }
      if (!result.rows[0].cost_is_override && result.rows[0].currency !== current.rows[0]?.currency) {
        await refreshDefaultBomCost({ query: client.query.bind(client) as typeof query }, String(req.params.id));
      }
      const finalResult = await client.query('SELECT * FROM product_masters WHERE id=$1', [req.params.id]);
      return { ...(finalResult.rows[0] || metadataResult.rows[0] || result.rows[0]), design_flow_m3h: linkedDesignFlow, design_flow_sync_status: linkedDesignFlow == null ? 'empty' : 'synchronized' };
    });
  } catch (error) {
    return next(error);
  }
  await logAudit(req.user!.id, 'product', String(req.params.id), 'UPDATE', {
    summary: 'Product details updated',
    product_code: product_code || undefined,
    product_name,
    standard_status,
    manufacturer: manufacturer || null,
    model: model || null,
    cost: costVal,
    sell_price: sellVal,
    primary_material_code: primary_material_code || null,
  });
  res.json(updated);
});

router.post('/product-masters/:id/duplicate', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orig = await query(
    `SELECT pm.*, ph.design_flow_m3h AS hydraulic_design_flow_m3h
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     WHERE pm.id=$1`,
    [req.params.id],
  );
  if (!orig.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const src = orig.rows[0];
  let newCode: string = req.body.product_code ? req.body.product_code.trim().toUpperCase() : '';
  if (!newCode) {
    newCode = `${src.product_code}-COPY`;
    let suffix = 1;
    while (true) {
      const exists = await query('SELECT id FROM product_masters WHERE product_code=$1', [newCode]);
      if (!exists.rows[0]) break;
      suffix++;
      newCode = `${src.product_code}-COPY-${suffix}`;
    }
  } else {
    const exists = await query('SELECT id FROM product_masters WHERE product_code=$1', [newCode]);
    if (exists.rows[0]) return res.status(409).json({ error: { code: 'CONFLICT', message: `Product code ${newCode} already exists` } });
  }
  const newName = req.body.product_name ? req.body.product_name.trim() : `Copy of ${src.product_name}`;
  const newFamilyId = ('product_family_id' in req.body) ? (req.body.product_family_id || null) : src.product_family_id;
  const newStatus = req.body.standard_status || src.standard_status;
  try {
    const linkedFlow = src.hydraulic_design_flow_m3h != null ? Number(src.hydraulic_design_flow_m3h) : normalizeDesignFlow(src.design_flow_m3h);
    const applyAatFrictionDefault = isAatSandFilter({ manufacturer: src.manufacturer, product_name: src.product_name, model: src.model });
    const created = await withProductTransaction(async client => {
      const result = await client.query(
        `INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, synonyms, manufacturer, model, wall_thickness_mm, weight_kg, tank_family_id, configuration, control_type, signal_type, control_type_optional, product_description, tank_classification, tank_engineering_details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32::jsonb) RETURNING *`,
        [newCode, newFamilyId, newName, src.product_category, src.application_type, linkedFlow, src.design_pressure_bar, src.design_head_m, src.power_kw, src.primary_material_code, newStatus, src.notes, src.shape_type, src.length_mm, src.width_mm, src.height_mm, src.design_water_level_mm, src.gross_volume_m3, src.operating_volume_m3, src.synonyms || [], src.manufacturer || null, src.model || null, src.wall_thickness_mm || null, src.weight_kg || null, src.tank_family_id || null, src.configuration || null, src.control_type || null, src.signal_type || null, Boolean(src.control_type_optional), src.product_description || null, src.tank_classification || null, JSON.stringify(src.tank_engineering_details || {})]);
      await client.query(
        `INSERT INTO product_hydraulic
           (product_master_id, design_flow_m3h, min_flow_m3h, max_flow_m3h, venturi_flow_m3h,
            friction_loss_mh2o, design_head_m, design_pressure_bar, max_pressure_bar, npsh_required_m, fluid_type,
            min_temperature_c, max_temperature_c, notes, updated_at)
         SELECT $1::uuid,$2::numeric,min_flow_m3h,max_flow_m3h,venturi_flow_m3h,friction_loss_mh2o,design_head_m,design_pressure_bar,
                max_pressure_bar,npsh_required_m,fluid_type,min_temperature_c,max_temperature_c,notes,NOW()
         FROM product_hydraulic WHERE product_master_id=$3
          UNION ALL
           SELECT $1::uuid,$2::numeric,NULL,NULL,NULL,$4::numeric,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NOW()
         WHERE NOT EXISTS (SELECT 1 FROM product_hydraulic WHERE product_master_id=$3)`,
         [result.rows[0].id, linkedFlow, req.params.id, applyAatFrictionDefault ? 5.0 : null],
      );
      if (String(src.product_category || '').toLowerCase() === 'pneumatic') {
        await client.query(
          `INSERT INTO product_pneumatic
             (product_master_id, gas_flow_value, gas_flow_unit, operating_temperature_value, operating_temperature_unit,
              dew_point_value, dew_point_unit, inlet_port_value, inlet_port_unit, outlet_port_value, outlet_port_unit, updated_at)
           SELECT $1::uuid, gas_flow_value, gas_flow_unit, operating_temperature_value, operating_temperature_unit,
                  dew_point_value, dew_point_unit, inlet_port_value, inlet_port_unit, outlet_port_value, outlet_port_unit, NOW()
           FROM product_pneumatic
           WHERE product_master_id=$2`,
          [result.rows[0].id, req.params.id],
        );
      }
      if (String(src.product_category || '').toLowerCase() === 'thermal') {
        await client.query(
          `INSERT INTO product_thermal
             (product_master_id, thermal_capacity_kw, thermal_capacity_unit, thermal_duty, fluid_type,
              operating_temperature_min_c, operating_temperature_max_c, design_temperature_c,
              flow_rate_m3h, pressure_rating_bar, efficiency_pct,
              primary_inlet_dn_mm, primary_outlet_dn_mm, secondary_inlet_dn_mm, secondary_outlet_dn_mm,
              flow_switch_status, notes, updated_at)
           SELECT $1::uuid, thermal_capacity_kw, thermal_capacity_unit, thermal_duty, fluid_type,
                  operating_temperature_min_c, operating_temperature_max_c, design_temperature_c,
                  flow_rate_m3h, pressure_rating_bar, efficiency_pct,
                  primary_inlet_dn_mm, primary_outlet_dn_mm, secondary_inlet_dn_mm, secondary_outlet_dn_mm,
                  flow_switch_status, notes, NOW()
           FROM product_thermal
           WHERE product_master_id=$2`,
          [result.rows[0].id, req.params.id],
        );
      }
      if (applyAatFrictionDefault) {
        await client.query(
          `INSERT INTO product_hydraulic_catalog_defaults (product_master_id, default_key)
           VALUES ($1,$2)
           ON CONFLICT (product_master_id, default_key) DO NOTHING`,
          [result.rows[0].id, AAT_SAND_FILTER_FRICTION_DEFAULT_KEY],
        );
      }
      await insertAuditTx(client, req.user!.id, 'product', result.rows[0].id, 'LINKED_DESIGN_FLOW_UPDATE',
        designFlowAuditDetails('product_duplicate', linkedFlow, src.design_flow_m3h, src.hydraulic_design_flow_m3h));
      return { ...result.rows[0], design_flow_m3h: linkedFlow, design_flow_sync_status: linkedFlow == null ? 'empty' : 'synchronized' };
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

// PRODUCT VARIANTS
router.get('/product-variants', authenticate, async (req: AuthRequest, res: Response) => {
  let where = '', params: any[] = [];
  if (req.query.product_master_id) { params.push(req.query.product_master_id); where = `WHERE pv.product_master_id=$1`; }
  const result = await query(`SELECT pv.*, pm.product_code, pm.product_name FROM product_variants pv JOIN product_masters pm ON pv.product_master_id=pm.id ${where} ORDER BY pv.variant_code`, params);
  res.json({ items: result.rows });
});

router.post('/product-variants', authenticate, async (req: AuthRequest, res: Response) => {
  const { variant_code, product_master_id, variant_name, variant_reason, override_material_code, override_power_kw, override_region } = req.body;
  const result = await query('INSERT INTO product_variants (variant_code, product_master_id, variant_name, variant_reason, override_material_code, override_power_kw, override_region) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [variant_code, product_master_id, variant_name, variant_reason, override_material_code, override_power_kw, override_region]);
  res.status(201).json(result.rows[0]);
});

// STANDARD BOMs
router.get('/product-boms', authenticate, async (req: AuthRequest, res: Response) => {
  let where = '', params: any[] = [];
  if (req.query.product_master_id) { params.push(req.query.product_master_id); where = `WHERE product_master_id=$1`; }
  const result = await query(`SELECT * FROM standard_boms ${where} ORDER BY effective_from DESC`, params);
  res.json({ items: result.rows });
});

router.get('/product-boms/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const bom = await query('SELECT sb.*, pm.product_code, pm.product_name FROM standard_boms sb JOIN product_masters pm ON sb.product_master_id=pm.id WHERE sb.id=$1', [req.params.id]);
  if (!bom.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM not found' } });
  const lines = await query(
    `SELECT bl.*, pm.product_code AS sub_product_code, pm.product_name AS sub_product_name
     FROM bom_lines bl
     LEFT JOIN product_masters pm ON bl.sub_product_id = pm.id
     WHERE bl.standard_bom_id=$1 ORDER BY bl.line_number`,
    [req.params.id]);
  res.json({ ...bom.rows[0], lines: lines.rows });
});

router.post('/product-boms', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const { bom_code, product_master_id, revision_code, effective_from } = req.body;
  const result = await query('INSERT INTO standard_boms (bom_code, product_master_id, revision_code, effective_from) VALUES ($1,$2,$3,$4) RETURNING *',
    [bom_code, product_master_id, revision_code || 'A', effective_from]);
  await refreshDefaultBomCost({ query }, product_master_id);
  res.status(201).json(result.rows[0]);
});

router.post('/product-boms/:id/lines', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const { line_number, component_id, sub_product_id, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks } = req.body;
  const result = await query(
    'INSERT INTO bom_lines (standard_bom_id, component_id, sub_product_id, line_number, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [req.params.id, component_id || null, sub_product_id || null, line_number, component_type, component_reference_code, component_name, quantity || 1, unit, is_optional || false, remarks]);
  const owner = await query('SELECT product_master_id FROM standard_boms WHERE id=$1', [req.params.id]);
  if (owner.rows[0]) await refreshDefaultBomCost({ query }, owner.rows[0].product_master_id);
  res.status(201).json(result.rows[0]);
});

router.delete('/product-boms/:bomId/lines/:lineId', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM bom_lines WHERE id=$1 AND standard_bom_id=$2', [req.params.lineId, req.params.bomId]);
  const owner = await query('SELECT product_master_id FROM standard_boms WHERE id=$1', [req.params.bomId]);
  if (owner.rows[0]) await refreshDefaultBomCost({ query }, owner.rows[0].product_master_id);
  res.status(204).end();
});

router.post('/product-masters/:id/reset-bom-cost', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const product = await query('UPDATE product_masters SET cost_is_override=false WHERE id::text=$1 OR product_code=$1 RETURNING id', [req.params.id]);
  if (!product.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  await refreshDefaultBomCost({ query }, product.rows[0].id);
  const updated = await query('SELECT cost,cost_is_override,currency FROM product_masters WHERE id=$1', [product.rows[0].id]);
  res.json(updated.rows[0]);
});

// PRODUCT RELATIONSHIPS
router.get('/product-masters/:id/relationships', authenticate, async (req: AuthRequest, res: Response) => {
  const product = await query('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
  if (!product.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const pid = product.rows[0].id;
  const result = await query(`
    SELECT er.id, er.edge_type, er.properties,
      er.source_id, er.target_id,
      CASE WHEN er.source_id=$1::text THEN 'outgoing' ELSE 'incoming' END as direction,
      CASE WHEN er.source_id=$1::text THEN tgt.product_code ELSE src.product_code END as related_code,
      CASE WHEN er.source_id=$1::text THEN tgt.product_name ELSE src.product_name END as related_name,
      CASE WHEN er.source_id=$1::text THEN tgt.id ELSE src.id END as related_id,
      CASE WHEN er.source_id=$1::text THEN tgt.standard_status ELSE src.standard_status END as related_status
    FROM entity_relationships er
    LEFT JOIN product_masters src ON er.source_id=src.id::text
    LEFT JOIN product_masters tgt ON er.target_id=tgt.id::text
    WHERE (er.source_id=$1::text OR er.target_id=$1::text)
      AND er.source_type='product' AND er.target_type='product'
    ORDER BY er.edge_type`, [pid]);
  res.json({ items: result.rows });
});

router.post('/product-masters/:id/relationships', authenticate, async (req: AuthRequest, res: Response) => {
  const { target_product_id, edge_type } = req.body;
  if (!target_product_id || !edge_type) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'target_product_id and edge_type required' } });
  const product = await query('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
  if (!product.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const result = await query(
    'INSERT INTO entity_relationships (source_id, source_type, target_id, target_type, edge_type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [product.rows[0].id, 'product', target_product_id, 'product', edge_type]);
  res.status(201).json(result.rows[0]);
});

// DELETE entity relationship (unlink)
router.delete('/entity-relationships/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('DELETE FROM entity_relationships WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Relationship not found' } });
  res.json({ success: true });
});

// COMPONENT VARIANTS (peer relationships via entity_relationships)
router.get('/components/:id/variants', authenticate, async (req: AuthRequest, res: Response) => {
  const comp = await query('SELECT id FROM components WHERE id::text=$1 OR component_code=$1', [req.params.id]);
  if (!comp.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  const cid = comp.rows[0].id;
  const result = await query(`
    SELECT er.id, er.edge_type, er.properties,
      CASE WHEN er.source_id=$1 THEN tgt.component_code ELSE src.component_code END as related_code,
      CASE WHEN er.source_id=$1 THEN tgt.component_name ELSE src.component_name END as related_name,
      CASE WHEN er.source_id=$1 THEN tgt.id ELSE src.id END as related_id,
      CASE WHEN er.source_id=$1 THEN tgt.status ELSE src.status END as related_status,
      CASE WHEN er.source_id=$1 THEN tgt.component_type ELSE src.component_type END as related_type
    FROM entity_relationships er
    LEFT JOIN components src ON er.source_id::text=src.id::text
    LEFT JOIN components tgt ON er.target_id::text=tgt.id::text
    WHERE (er.source_id=$1 OR er.target_id=$1)
      AND er.source_type='component' AND er.target_type='component'
      AND er.edge_type='variant'
    ORDER BY er.created_at DESC`, [cid]);
  res.json({ items: result.rows });
});

router.post('/components/:id/variants', authenticate, async (req: AuthRequest, res: Response) => {
  const { target_component_id } = req.body;
  if (!target_component_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'target_component_id required' } });
  const comp = await query('SELECT id FROM components WHERE id::text=$1 OR component_code=$1', [req.params.id]);
  if (!comp.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  const result = await query(
    'INSERT INTO entity_relationships (source_id, source_type, target_id, target_type, edge_type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [comp.rows[0].id, 'component', target_component_id, 'component', 'variant']);
  res.status(201).json(result.rows[0]);
});

// VENDOR OPTIONS
router.get('/vendor-options', authenticate, async (req: AuthRequest, res: Response) => {
  let where = '', params: any[] = [];
  if (req.query.product_master_id) { params.push(req.query.product_master_id); where = `WHERE vo.product_master_id=$1`; }
  const result = await query(`SELECT vo.*, pm.product_code FROM vendor_options vo LEFT JOIN product_masters pm ON vo.product_master_id=pm.id ${where} ORDER BY vo.vendor_option_code`, params);
  res.json({ items: result.rows });
});

router.post('/vendor-options', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const { product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status, lead_time_days, region_scope } = req.body;
  const unitPrice = req.body.unit_price === '' || req.body.unit_price == null ? null : Number(req.body.unit_price);
  const currency = String(req.body.currency || 'USD').trim().toUpperCase();
  if (!product_master_id || !String(vendor_name || '').trim()) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Product and vendor are required.' } });
  }
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    return res.status(400).json({ error: { code: 'INVALID_PRICE', message: 'Vendor price must be a non-negative number.' } });
  }
  if (!isSupportedCurrency(currency)) {
    return res.status(400).json({ error: { code: 'INVALID_CURRENCY', message: `Currency must be ${SUPPORTED_CURRENCY_TEXT}.` } });
  }
  try {
    const created = await withProductTransaction(async client => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('vendor-option-code'))`);
      const sequence = await client.query(
        `SELECT COALESCE(MAX((substring(vendor_option_code from '^VO-([0-9]+)$'))::integer),0)+1 AS next_number
         FROM vendor_options`,
      );
      const vendorOptionCode = `VO-${String(sequence.rows[0].next_number).padStart(6, '0')}`;
      const result = await client.query(
        `INSERT INTO vendor_options
          (vendor_option_code,product_master_id,vendor_name,manufacturer_name,vendor_item_code,approved_status,
           lead_time_days,region_scope,unit_price,currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [vendorOptionCode, product_master_id, String(vendor_name).trim(), manufacturer_name || null, vendor_item_code || null,
          approved_status || 'Approved', lead_time_days || null, region_scope || null, unitPrice, currency],
      );
      return result.rows[0];
    });
    res.status(201).json(created);
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'This vendor option code already exists.' } });
    throw error;
  }
});

router.put('/vendor-options/:id', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const unitPrice = req.body.unit_price === '' || req.body.unit_price == null ? null : Number(req.body.unit_price);
  const currency = String(req.body.currency || 'USD').trim().toUpperCase();
  if (!String(req.body.vendor_name || '').trim()) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Vendor is required.' } });
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) return res.status(400).json({ error: { code: 'INVALID_PRICE', message: 'Vendor price must be a non-negative number.' } });
  if (!isSupportedCurrency(currency)) return res.status(400).json({ error: { code: 'INVALID_CURRENCY', message: `Currency must be ${SUPPORTED_CURRENCY_TEXT}.` } });
  const result = await query(
    `UPDATE vendor_options SET vendor_name=$1,manufacturer_name=$2,vendor_item_code=$3,approved_status=$4,
       lead_time_days=$5,region_scope=$6,unit_price=$7,currency=$8,updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [String(req.body.vendor_name).trim(), req.body.manufacturer_name || null, req.body.vendor_item_code || null,
      req.body.approved_status || 'Approved', req.body.lead_time_days || null, req.body.region_scope || null,
      unitPrice, currency, req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Vendor option not found.' } });
  res.json(result.rows[0]);
});

router.delete('/vendor-options/:id', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const result = await query('DELETE FROM vendor_options WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Vendor option not found.' } });
  res.status(204).end();
});

// PRODUCT USAGES
router.get('/product-usages', authenticate, async (req: AuthRequest, res: Response) => {
  let where = '', params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); where = `WHERE pu.project_id=$1`; }
  const result = await query(`SELECT pu.*, pm.product_code, pm.product_name, p.project_code, ei.equipment_code FROM product_usages pu JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON pu.project_id=p.id LEFT JOIN equipment_instances ei ON pu.equipment_instance_id=ei.id ${where}`, params);
  res.json({ items: result.rows });
});

router.post('/product-usages', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, product_master_id, equipment_instance_id, usage_type } = req.body;
  const result = await query('INSERT INTO product_usages (project_id, product_master_id, equipment_instance_id, usage_type) VALUES ($1,$2,$3,$4) RETURNING *',
    [project_id, product_master_id, equipment_instance_id, usage_type || 'Standard']);
  res.status(201).json(result.rows[0]);
});

// COMPONENTS
router.get('/components', authenticate, async (req: AuthRequest, res: Response) => {
  let conditions: string[] = [];
  let params: any[] = [];
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    const p = params.length;
    conditions.push(`(c.component_code ILIKE $${p} OR c.component_name ILIKE $${p} OR c.description ILIKE $${p} OR EXISTS (SELECT 1 FROM unnest(c.synonyms) s WHERE s ILIKE $${p}))`);
  }
  if (req.query.component_type) { params.push(req.query.component_type); conditions.push(`c.component_type=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); conditions.push(`c.status=$${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT c.*, m.material_name FROM components c LEFT JOIN materials m ON c.primary_material_code=m.material_code ${where} ORDER BY c.component_code`,
    params);
  res.json({ items: result.rows });
});

router.get('/components/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT c.*, m.material_name FROM components c LEFT JOIN materials m ON c.primary_material_code=m.material_code WHERE c.id::text=$1 OR c.component_code=$1`,
    [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  const [usedIn, documents] = await Promise.all([
    query(
      `SELECT DISTINCT pm.id, pm.product_code, pm.product_name, pm.standard_status, bl.quantity, bl.unit
       FROM bom_lines bl JOIN standard_boms sb ON bl.standard_bom_id=sb.id JOIN product_masters pm ON sb.product_master_id=pm.id
       WHERE bl.component_id=$1 OR bl.component_reference_code=$2
       ORDER BY pm.product_code`,
      [result.rows[0].id, result.rows[0].component_code]),
    query(
      `SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM documents d LEFT JOIN users u ON d.created_by=u.id
       WHERE d.component_id=$1 ORDER BY d.document_type, d.document_code`,
      [result.rows[0].id]),
  ]);
  res.json({ ...result.rows[0], used_in: usedIn.rows, documents: documents.rows });
});

router.post('/components', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  try {
    const { component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, manufacturer, model, cost, sell_price } = req.body;
    if (!component_code || !component_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'component_code and component_name required' } });
    const pmCode = primary_material_code || null;
    const wkg = (weight_kg === '' || weight_kg === null || weight_kg === undefined) ? null : parseFloat(String(weight_kg));
    const costVal = (cost === '' || cost === null || cost === undefined) ? null : Number(cost);
    const sellVal = (sell_price === '' || sell_price === null || sell_price === undefined) ? null : Number(sell_price);
    const currency = String(req.body.currency || 'USD').toUpperCase();
    if ((costVal !== null && (!Number.isFinite(costVal) || costVal < 0)) || (sellVal !== null && (!Number.isFinite(sellVal) || sellVal < 0))) {
      return res.status(400).json({ error: { code: 'INVALID_PRICE', message: 'Cost and sell price must be non-negative numbers.' } });
    }
    if (!isSupportedCurrency(currency)) return res.status(400).json({ error: { code: 'INVALID_CURRENCY', message: 'Unsupported component currency.' } });
    const result = await query(
      'INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, created_by, cost, sell_price, currency, manufacturer, model) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',
      [component_code, component_name, component_type || 'Vessel', component_category || 'Mechanical', description || null, pmCode, standard_size || null, wkg, unit || 'EA', status || 'Active', notes || null, req.user!.id, costVal, sellVal, currency, manufacturer || null, model || null]);
    await logAudit(req.user!.id, 'component', result.rows[0].id, 'CREATE', {
      summary: `Component ${component_code} created`,
      component_code,
      component_name,
      component_type,
    });
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[POST /components] error:', err?.message || err);
    if (err?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: `Component code already exists` } });
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err?.message || 'Failed to create component' } });
  }
});

router.put('/components/:id', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  try {
    const { component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms, cost, sell_price, manufacturer, model } = req.body;
    const componentCode = component_code === undefined || component_code === null
      ? null
      : String(component_code).trim().toUpperCase();
    if (component_code !== undefined && !componentCode) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'component_code cannot be blank' } });
    }
    const synonymsArr = Array.isArray(synonyms) ? synonyms.filter(Boolean) : [];
    const costVal = (cost === null || cost === undefined || cost === '') ? null : parseFloat(String(cost));
    const sellVal = (sell_price === null || sell_price === undefined || sell_price === '') ? null : parseFloat(String(sell_price));
    const currency = String(req.body.currency || 'USD').toUpperCase();
    if ((costVal !== null && (!Number.isFinite(costVal) || costVal < 0)) || (sellVal !== null && (!Number.isFinite(sellVal) || sellVal < 0))) return res.status(400).json({ error: { code: 'INVALID_PRICE', message: 'Cost and sell price must be non-negative numbers.' } });
    if (!isSupportedCurrency(currency)) return res.status(400).json({ error: { code: 'INVALID_CURRENCY', message: 'Unsupported component currency.' } });
    const result = await query(
      'UPDATE components SET component_code=COALESCE($1, component_code), component_name=$2, component_type=$3, component_category=$4, description=$5, primary_material_code=$6, standard_size=$7, weight_kg=$8, unit=$9, status=$10, notes=$11, synonyms=$12, cost=$13, sell_price=$14, currency=$15, manufacturer=$16, model=$17, updated_at=NOW() WHERE id=$18 RETURNING *',
      [componentCode, component_name, component_type, component_category, description, primary_material_code || null, standard_size, weight_kg, unit, status, notes, synonymsArr, costVal, sellVal, currency, manufacturer || null, model || null, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    await logAudit(req.user!.id, 'component', String(req.params.id), 'UPDATE', {
      summary: 'Component details updated',
      component_code: result.rows[0].component_code,
      component_name,
      component_type,
      status,
      manufacturer: manufacturer || null,
      model: model || null,
      cost: costVal,
      primary_material_code: primary_material_code || null,
    });
    const products = await query(
      `SELECT DISTINCT sb.product_master_id FROM bom_lines bl
       JOIN standard_boms sb ON sb.id=bl.standard_bom_id
       WHERE bl.component_id=$1`,
      [req.params.id],
    );
    for (const product of products.rows) await refreshDefaultBomCost({ query }, product.product_master_id);
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Component code already exists' } });
    console.error('[PUT /components/:id] error:', err?.message || err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err?.message || 'Failed to update component' } });
  }
});

router.patch('/product-masters/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  const { standard_status } = req.body;
  if (!standard_status) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'standard_status required' } });
  const result = await query(
    'UPDATE product_masters SET standard_status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, standard_status',
    [standard_status, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  await logAudit(req.user!.id, 'product', String(req.params.id), 'STATUS_CHANGE', {
    summary: `Status changed to ${standard_status}`,
    from: undefined,
    to: standard_status,
  });
  res.json(result.rows[0]);
});

router.patch('/components/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'status required' } });
  const result = await query(
    'UPDATE components SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, status',
    [status, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  await logAudit(req.user!.id, 'component', String(req.params.id), 'STATUS_CHANGE', {
    summary: `Status changed to ${status}`,
    to: status,
  });
  res.json(result.rows[0]);
});

router.post('/components/:id/duplicate', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const orig = await query('SELECT * FROM components WHERE id=$1', [req.params.id]);
  if (!orig.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  const src = orig.rows[0];
  let newCode: string = req.body.component_code ? req.body.component_code.trim().toUpperCase() : '';
  if (!newCode) {
    newCode = `${src.component_code}-COPY`;
    let suffix = 1;
    while (true) {
      const exists = await query('SELECT id FROM components WHERE component_code=$1', [newCode]);
      if (!exists.rows[0]) break;
      suffix++;
      newCode = `${src.component_code}-COPY-${suffix}`;
    }
  } else {
    const exists = await query('SELECT id FROM components WHERE component_code=$1', [newCode]);
    if (exists.rows[0]) return res.status(409).json({ error: { code: 'CONFLICT', message: `Component code ${newCode} already exists` } });
  }
  const newName = req.body.component_name ? req.body.component_name.trim() : `Copy of ${src.component_name}`;
  const newType = req.body.component_type || src.component_type;
  const newCategory = req.body.component_category || src.component_category;
  const newStatus = req.body.status || src.status;
  const result = await query(
    `INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms, created_by, manufacturer, model, cost, sell_price, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [newCode, newName, newType, newCategory, src.description, src.primary_material_code, src.standard_size, src.weight_kg, src.unit, newStatus, src.notes, src.synonyms || [], req.user!.id, src.manufacturer || null, src.model || null, src.cost, src.sell_price, src.currency || 'USD']);
  res.status(201).json(result.rows[0]);
});

router.delete('/components/:id', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const inUse = await query(
    `SELECT 1 FROM bom_lines WHERE component_id=$1 LIMIT 1`, [id]);
  if (inUse.rows.length > 0) {
    return res.status(409).json({ error: { code: 'IN_USE', message: 'Cannot delete — component is linked to BOM lines. Remove those links first.' } });
  }
  await query('DELETE FROM documents WHERE component_id=$1', [id]);
  await query('DELETE FROM entity_relationships WHERE source_id=$1 OR target_id=$1', [id]);
  const result = await query('DELETE FROM components WHERE id::text=$1 RETURNING id, component_code', [id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  await logAudit(req.user!.id, 'component', String(id), 'DELETE', {
    summary: `Component ${result.rows[0].component_code} deleted`,
    component_code: result.rows[0].component_code,
  });
  res.json({ deleted: true });
});

// FAMILY CLASSIFIERS
router.get('/product-families/:id/classifiers', authenticate, async (req: AuthRequest, res: Response) => {
  const fam = await query('SELECT id FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
  if (!fam.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
  const result = await query('SELECT * FROM family_classifiers WHERE family_id=$1 ORDER BY sort_order, created_at', [fam.rows[0].id]);
  res.json({ items: result.rows });
});

router.post('/product-families/:id/classifiers', authenticate, async (req: AuthRequest, res: Response) => {
  const fam = await query('SELECT id FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
  if (!fam.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
  const { label, unit, field_type, sort_order } = req.body;
  const result = await query(
    'INSERT INTO family_classifiers (family_id, label, unit, field_type, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [fam.rows[0].id, label, unit || null, field_type || 'text', sort_order ?? 0]);
  res.status(201).json(result.rows[0]);
});

router.put('/family-classifiers/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { label, unit, field_type, sort_order } = req.body;
  const result = await query(
    'UPDATE family_classifiers SET label=$1, unit=$2, field_type=$3, sort_order=$4 WHERE id::text=$5 RETURNING *',
    [label, unit || null, field_type || 'text', sort_order ?? 0, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classifier not found' } });
  res.json(result.rows[0]);
});

router.delete('/family-classifiers/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('DELETE FROM family_classifiers WHERE id::text=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classifier not found' } });
  res.json({ deleted: true });
});

// PRODUCT SPEC TABLES (dimensions, electrical, hydraulic, pneumatic, thermal)
const resolveProductId = async (param: string): Promise<string | null> => {
  const r = await query('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [param]);
  return r.rows[0]?.id ?? null;
};

const nullableHydraulicValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;

const nullableDimensionValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;

router.get('/product-masters/:id/dimensions', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const r = await query('SELECT * FROM product_dimensions WHERE product_master_id=$1', [pid]);
  res.json(r.rows[0] || {});
});

router.put('/product-masters/:id/dimensions', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const body = req.body || {};
  const existing = await query('SELECT length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes FROM product_dimensions WHERE product_master_id=$1', [pid]);
  const current = existing.rows[0] || {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const rawDiameter = body.diameter_mm;
  const diameterBlank = rawDiameter === null || rawDiameter === undefined || (typeof rawDiameter === 'string' && rawDiameter.trim() === '');
  if (!diameterBlank && (typeof rawDiameter !== 'number' && typeof rawDiameter !== 'string' || !Number.isFinite(Number(rawDiameter)) || Number(rawDiameter) < 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'diameter_mm must be a finite, non-negative measurement' } });
  }
  const rawSandMediaPerFilter = body.sand_media_per_filter_kg;
  const sandMediaPerFilterBlank = rawSandMediaPerFilter === null || rawSandMediaPerFilter === undefined || (typeof rawSandMediaPerFilter === 'string' && rawSandMediaPerFilter.trim() === '');
  if (!sandMediaPerFilterBlank && (typeof rawSandMediaPerFilter !== 'number' && typeof rawSandMediaPerFilter !== 'string' || !Number.isFinite(Number(rawSandMediaPerFilter)) || Number(rawSandMediaPerFilter) < 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'sand_media_per_filter_kg must be a finite, non-negative measurement' } });
  }
  const diameter_mm = has('diameter_mm') ? (diameterBlank ? null : Number(rawDiameter)) : (current.diameter_mm ?? null);
  const sand_media_per_filter_kg = has('sand_media_per_filter_kg')
    ? (sandMediaPerFilterBlank ? null : Number(rawSandMediaPerFilter))
    : (current.sand_media_per_filter_kg ?? null);
  const length_mm = has('length_mm') ? nullableDimensionValue(body.length_mm) : (current.length_mm ?? null);
  const width_mm = has('width_mm') ? nullableDimensionValue(body.width_mm) : (current.width_mm ?? null);
  const height_mm = has('height_mm') ? nullableDimensionValue(body.height_mm) : (current.height_mm ?? null);
  const weight_kg = has('weight_kg') ? nullableDimensionValue(body.weight_kg) : (current.weight_kg ?? null);
  const inlet_dn_mm = has('inlet_dn_mm') ? nullableDimensionValue(body.inlet_dn_mm) : (current.inlet_dn_mm ?? null);
  const outlet_dn_mm = has('outlet_dn_mm') ? nullableDimensionValue(body.outlet_dn_mm) : (current.outlet_dn_mm ?? null);
  const notes = has('notes') ? nullableDimensionValue(body.notes) : (current.notes ?? null);
  const r = await query(`
    INSERT INTO product_dimensions (product_master_id, length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
    ON CONFLICT (product_master_id) DO UPDATE SET
      length_mm=$2, width_mm=$3, height_mm=$4, diameter_mm=$5, sand_media_per_filter_kg=$6, weight_kg=$7, inlet_dn_mm=$8, outlet_dn_mm=$9, notes=$10, updated_at=NOW()
    RETURNING *`, [pid, length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes]);
  res.json(r.rows[0]);
});

router.get('/product-masters/:id/electrical', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const r = await query('SELECT * FROM product_electrical WHERE product_master_id=$1', [pid]);
  res.json(r.rows[0] || {});
});

router.put('/product-masters/:id/electrical', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const body = req.body || {};
  const { rated_power_kw, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes, lamp_count } = body;
  const hasRatedPower = Object.prototype.hasOwnProperty.call(body, 'rated_power_kw');
  const hasLampCount = Object.prototype.hasOwnProperty.call(body, 'lamp_count');
  const hasLampPower = Object.prototype.hasOwnProperty.call(body, 'lamp_power_w');
  const ratedPowerValue = rated_power_kw == null || rated_power_kw === '' ? null : Number(rated_power_kw);
  const lampCountValue = lamp_count == null || lamp_count === '' ? null : Number(lamp_count);
  const lampPowerValue = body.lamp_power_w == null || body.lamp_power_w === '' ? null : Number(body.lamp_power_w);
  if (ratedPowerValue != null && (!Number.isFinite(ratedPowerValue) || ratedPowerValue <= 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'rated_power_kw must be a number greater than zero or blank' } });
  }
  if (lampCountValue != null && (!Number.isInteger(lampCountValue) || lampCountValue <= 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'lamp_count must be a positive integer or blank' } });
  }
  if (lampPowerValue != null && (!Number.isFinite(lampPowerValue) || lampPowerValue <= 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'lamp_power_w must be a number greater than zero or blank' } });
  }
  const saved = await withProductTransaction(async client => {
    const current = await client.query(
      `SELECT pm.lamp_count, pm.power_kw, pe.lamp_power_w
       FROM product_masters pm
       LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
       WHERE pm.id=$1
       FOR UPDATE OF pm`,
      [pid],
    );
    const currentProduct = current.rows[0] || {};
    const effectiveLampCount = hasLampCount ? lampCountValue : currentProduct.lamp_count;
    const effectiveLampPower = hasLampPower ? lampPowerValue : currentProduct.lamp_power_w;
    const hasLampInputs = hasLampCount || hasLampPower;
    const calculatedRatedPower = effectiveLampCount != null && effectiveLampPower != null
      ? Number(effectiveLampCount) * Number(effectiveLampPower) / 1000
      : null;
    const effectiveRatedPower = hasLampInputs
      ? calculatedRatedPower
      : hasRatedPower
        ? ratedPowerValue
        : currentProduct.power_kw;
    const electrical = await client.query(`
      INSERT INTO product_electrical (product_master_id, rated_power_kw, lamp_power_w, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT (product_master_id) DO UPDATE SET
        rated_power_kw=$2, lamp_power_w=$3, voltage_v=$4, phases=$5, frequency_hz=$6, full_load_current_a=$7, rated_speed_rpm=$8, motor_type=$9, insulation_class=$10, protection_class=$11, efficiency_class=$12, notes=$13, updated_at=NOW()
      RETURNING *`, [pid, effectiveRatedPower, effectiveLampPower, voltage_v||null, phases||null, frequency_hz||null, full_load_current_a||null, rated_speed_rpm||null, motor_type||null, insulation_class||null, protection_class||null, efficiency_class||null, notes||null]);
    await client.query(
      `UPDATE product_masters
       SET power_kw=CASE WHEN $2 THEN $3 ELSE power_kw END,
           lamp_count=CASE WHEN $4 THEN $5 ELSE lamp_count END,
           updated_at=NOW()
       WHERE id=$1`,
      [pid, hasRatedPower || hasLampInputs, effectiveRatedPower, hasLampCount, lampCountValue],
    );
    return electrical.rows[0];
  });
  res.json(saved);
});

const PNEUMATIC_UNIT_ALIASES: Record<string, Record<string, string>> = {
  gas_flow: { 'm3/h': 'm3/h', 'm³/h': 'm3/h', scfm: 'SCFM' },
  temperature: { c: '°C', '°c': '°C', f: '°F', '°f': '°F' },
  port: { dn: 'DN', mm: 'mm', in: 'in', inch: 'in' },
};

const isBlankPneumaticValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const readPneumaticPair = (
  body: Record<string, any>,
  current: Record<string, any>,
  valueKey: string,
  unitKey: string,
  unitKind: keyof typeof PNEUMATIC_UNIT_ALIASES,
  label: string,
  allowNegative: boolean,
) => {
  const hasValue = Object.prototype.hasOwnProperty.call(body, valueKey);
  const hasUnit = Object.prototype.hasOwnProperty.call(body, unitKey);
  const rawValue = hasValue ? body[valueKey] : current[valueKey];
  const rawUnit = hasUnit ? body[unitKey] : current[unitKey];

  if (isBlankPneumaticValue(rawValue)) {
    if (hasUnit && !isBlankPneumaticValue(rawUnit)) {
      const error: any = new Error(`${label} unit cannot be set without a value`);
      error.status = 400;
      error.code = 'INVALID_PNEUMATIC_SPEC';
      throw error;
    }
    return { value: null, unit: null };
  }

  const numericValue = typeof rawValue === 'number' || typeof rawValue === 'string'
    ? Number(rawValue)
    : Number.NaN;
  if (!Number.isFinite(numericValue) || (!allowNegative && numericValue < 0)) {
    const error: any = new Error(`${label} must be a finite, ${allowNegative ? '' : 'non-negative '}number`);
    error.status = 400;
    error.code = 'INVALID_PNEUMATIC_SPEC';
    throw error;
  }

  const normalizedUnit = PNEUMATIC_UNIT_ALIASES[unitKind][String(rawUnit ?? '').trim().toLowerCase()];
  if (!normalizedUnit) {
    const error: any = new Error(`${label} must use a supported unit`);
    error.status = 400;
    error.code = 'INVALID_PNEUMATIC_SPEC';
    throw error;
  }
  return { value: numericValue, unit: normalizedUnit };
};

router.get('/product-masters/:id/pneumatic', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const productResult = await query('SELECT product_category FROM product_masters WHERE id=$1', [pid]);
    if (String(productResult.rows[0]?.product_category || '').toLowerCase() !== 'pneumatic') {
      return res.status(400).json({
        error: { code: 'INVALID_PRODUCT_CATEGORY', message: 'Pneumatic specifications are only available for products in the Pneumatic category' },
      });
    }
    const r = await query('SELECT * FROM product_pneumatic WHERE product_master_id=$1', [pid]);
    res.json(r.rows[0] || {});
  } catch (error) {
    next(error);
  }
});

const THERMAL_FLOW_SWITCH_STATUSES = new Set(['included', 'optional', 'not_included']);
const THERMAL_CAPACITY_UNITS = new Set(['kW', 'BTU/h', 'TON']);
const thermalNumericFields = [
  'thermal_capacity_kw',
  'operating_temperature_min_c',
  'operating_temperature_max_c',
  'design_temperature_c',
  'flow_rate_m3h',
  'pressure_rating_bar',
  'efficiency_pct',
  'primary_inlet_dn_mm',
  'primary_outlet_dn_mm',
  'secondary_inlet_dn_mm',
  'secondary_outlet_dn_mm',
] as const;

const nullableThermalValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;

router.get('/product-masters/:id/thermal', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const productResult = await query('SELECT product_category FROM product_masters WHERE id=$1', [pid]);
    if (String(productResult.rows[0]?.product_category || '').toLowerCase() !== 'thermal') {
      return res.status(400).json({
        error: { code: 'INVALID_PRODUCT_CATEGORY', message: 'Thermal specifications are only available for products in the Thermal category' },
      });
    }
    const r = await query('SELECT * FROM product_thermal WHERE product_master_id=$1', [pid]);
    res.json(r.rows[0] || {});
  } catch (error) {
    next(error);
  }
});

router.put('/product-masters/:id/thermal', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const body = req.body || {};
    const saved = await withProductTransaction(async client => {
      const productResult = await client.query(
        'SELECT product_category FROM product_masters WHERE id=$1 FOR UPDATE',
        [pid],
      );
      if (!productResult.rows[0]) {
        const error: any = new Error('Product not found');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (String(productResult.rows[0].product_category || '').toLowerCase() !== 'thermal') {
        const error: any = new Error('Thermal specifications are only available for products in the Thermal category');
        error.status = 400;
        error.code = 'INVALID_PRODUCT_CATEGORY';
        throw error;
      }

      const existingResult = await client.query(
        'SELECT * FROM product_thermal WHERE product_master_id=$1 FOR UPDATE',
        [pid],
      );
      const current = existingResult.rows[0] || {};
      const values: Record<string, unknown> = {};
      for (const field of thermalNumericFields) {
        const raw = Object.prototype.hasOwnProperty.call(body, field) ? body[field] : current[field] ?? null;
        const value = nullableThermalValue(raw);
        if (value === null) {
          values[field] = null;
          continue;
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          const error: any = new Error(`${field} must be a finite number or blank`);
          error.status = 400;
          error.code = 'INVALID_THERMAL_SPEC';
          throw error;
        }
        values[field] = parsed;
      }
      if (values.thermal_capacity_kw !== null && Number(values.thermal_capacity_kw) < 0) {
        const error: any = new Error('Thermal capacity must be non-negative');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      if (values.flow_rate_m3h !== null && Number(values.flow_rate_m3h) < 0) {
        const error: any = new Error('Flow rate must be non-negative');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      if (values.pressure_rating_bar !== null && Number(values.pressure_rating_bar) < 0) {
        const error: any = new Error('Pressure rating must be non-negative');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      if (values.efficiency_pct !== null && (Number(values.efficiency_pct) < 0 || Number(values.efficiency_pct) > 100)) {
        const error: any = new Error('Efficiency must be between 0 and 100 percent');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      for (const field of ['primary_inlet_dn_mm', 'primary_outlet_dn_mm', 'secondary_inlet_dn_mm', 'secondary_outlet_dn_mm']) {
        if (values[field] !== null && Number(values[field]) <= 0) {
          const error: any = new Error(`${field} must be a positive number`);
          error.status = 400;
          error.code = 'INVALID_THERMAL_SPEC';
          throw error;
        }
      }
      if (values.operating_temperature_min_c !== null && values.operating_temperature_max_c !== null
        && Number(values.operating_temperature_min_c) > Number(values.operating_temperature_max_c)) {
        const error: any = new Error('Minimum operating temperature cannot exceed maximum operating temperature');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }

      const flowSwitch = Object.prototype.hasOwnProperty.call(body, 'flow_switch_status')
        ? nullableThermalValue(body.flow_switch_status)
        : current.flow_switch_status ?? null;
      if (flowSwitch !== null && !THERMAL_FLOW_SWITCH_STATUSES.has(String(flowSwitch))) {
        const error: any = new Error('Flow switch status must be Included, Optional, or Not included');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      const thermalCapacityUnit = String(
        Object.prototype.hasOwnProperty.call(body, 'thermal_capacity_unit')
          ? body.thermal_capacity_unit || 'kW'
          : current.thermal_capacity_unit || 'kW',
      );
      if (!THERMAL_CAPACITY_UNITS.has(thermalCapacityUnit)) {
        const error: any = new Error('Thermal capacity unit must be kW, BTU/h, or TON');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      const textValue = (field: string) => Object.prototype.hasOwnProperty.call(body, field)
        ? nullableThermalValue(body[field])
        : current[field] ?? null;
      const r = await client.query(
        `INSERT INTO product_thermal
           (product_master_id, thermal_capacity_kw, thermal_capacity_unit, thermal_duty, fluid_type,
            operating_temperature_min_c, operating_temperature_max_c, design_temperature_c,
            flow_rate_m3h, pressure_rating_bar, efficiency_pct,
            primary_inlet_dn_mm, primary_outlet_dn_mm, secondary_inlet_dn_mm, secondary_outlet_dn_mm,
            flow_switch_status, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
         ON CONFLICT (product_master_id) DO UPDATE SET
           thermal_capacity_kw=$2, thermal_capacity_unit=$3, thermal_duty=$4, fluid_type=$5,
           operating_temperature_min_c=$6, operating_temperature_max_c=$7, design_temperature_c=$8,
           flow_rate_m3h=$9, pressure_rating_bar=$10, efficiency_pct=$11,
           primary_inlet_dn_mm=$12, primary_outlet_dn_mm=$13, secondary_inlet_dn_mm=$14, secondary_outlet_dn_mm=$15,
           flow_switch_status=$16, notes=$17, updated_at=NOW()
         RETURNING *`,
        [pid, values.thermal_capacity_kw, thermalCapacityUnit, textValue('thermal_duty'), textValue('fluid_type'),
          values.operating_temperature_min_c, values.operating_temperature_max_c, values.design_temperature_c,
          values.flow_rate_m3h, values.pressure_rating_bar, values.efficiency_pct,
          values.primary_inlet_dn_mm, values.primary_outlet_dn_mm, values.secondary_inlet_dn_mm, values.secondary_outlet_dn_mm,
          flowSwitch, textValue('notes')],
      );
      if (!r.rows[0]) {
        const error: any = new Error('The server did not return the saved thermal specifications');
        error.status = 500;
        error.code = 'THERMAL_SAVE_FAILED';
        throw error;
      }
      await insertAuditTx(client, req.user!.id, 'product', pid, 'THERMAL_SPECIFICATION_UPDATE', {
        summary: 'Thermal specifications updated',
        before: current,
        after: r.rows[0],
      });
      return r.rows[0];
    });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.put('/product-masters/:id/pneumatic', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const body = req.body || {};
    const saved = await withProductTransaction(async client => {
      const productResult = await client.query(
        'SELECT product_category FROM product_masters WHERE id=$1 FOR UPDATE',
        [pid],
      );
      if (!productResult.rows[0]) {
        const error: any = new Error('Product not found');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (String(productResult.rows[0].product_category || '').toLowerCase() !== 'pneumatic') {
        const error: any = new Error('Pneumatic specifications are only available for products in the Pneumatic category');
        error.status = 400;
        error.code = 'INVALID_PRODUCT_CATEGORY';
        throw error;
      }

      const existingResult = await client.query(
        'SELECT * FROM product_pneumatic WHERE product_master_id=$1 FOR UPDATE',
        [pid],
      );
      const current = existingResult.rows[0] || {};
      const gasFlow = readPneumaticPair(body, current, 'gas_flow_value', 'gas_flow_unit', 'gas_flow', 'Gas flow', false);
      const operatingTemperature = readPneumaticPair(body, current, 'operating_temperature_value', 'operating_temperature_unit', 'temperature', 'Operating temperature', true);
      const dewPoint = readPneumaticPair(body, current, 'dew_point_value', 'dew_point_unit', 'temperature', 'Dew point', true);
      const inletPort = readPneumaticPair(body, current, 'inlet_port_value', 'inlet_port_unit', 'port', 'Inlet port', false);
      const outletPort = readPneumaticPair(body, current, 'outlet_port_value', 'outlet_port_unit', 'port', 'Outlet port', false);
      const r = await client.query(
        `INSERT INTO product_pneumatic
           (product_master_id, gas_flow_value, gas_flow_unit, operating_temperature_value, operating_temperature_unit,
            dew_point_value, dew_point_unit, inlet_port_value, inlet_port_unit, outlet_port_value, outlet_port_unit, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (product_master_id) DO UPDATE SET
           gas_flow_value=$2, gas_flow_unit=$3, operating_temperature_value=$4, operating_temperature_unit=$5,
           dew_point_value=$6, dew_point_unit=$7, inlet_port_value=$8, inlet_port_unit=$9,
           outlet_port_value=$10, outlet_port_unit=$11, updated_at=NOW()
         RETURNING *`,
        [pid, gasFlow.value, gasFlow.unit, operatingTemperature.value, operatingTemperature.unit,
          dewPoint.value, dewPoint.unit, inletPort.value, inletPort.unit, outletPort.value, outletPort.unit],
      );
      if (!r.rows[0]) {
        const error: any = new Error('The server did not return the saved pneumatic specifications');
        error.status = 500;
        error.code = 'PNEUMATIC_SAVE_FAILED';
        throw error;
      }
      await insertAuditTx(client, req.user!.id, 'product', pid, 'PNEUMATIC_SPECIFICATION_UPDATE', {
        summary: 'Pneumatic specifications updated',
        before: current,
        after: r.rows[0],
      });
      return r.rows[0];
    });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.get('/product-masters/:id/hydraulic', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const r = await query(
    `SELECT ph.*, pm.id AS product_master_id,
       COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
       CASE
         WHEN pm.design_flow_m3h IS NOT NULL AND ph.design_flow_m3h IS NOT NULL
              AND pm.design_flow_m3h IS DISTINCT FROM ph.design_flow_m3h THEN 'conflict'
         WHEN pm.design_flow_m3h IS NULL AND ph.design_flow_m3h IS NULL THEN 'empty'
         ELSE 'synchronized'
       END AS design_flow_sync_status,
       pm.design_flow_m3h AS product_design_flow_m3h,
       ph.design_flow_m3h AS hydraulic_design_flow_m3h
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     WHERE pm.id=$1`,
    [pid],
  );
  res.json(r.rows[0] || {});
});

router.put('/product-masters/:id/hydraulic', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const body = req.body || {};
  const { design_flow_m3h, venturi_flow_m3h, friction_loss_mh2o } = body;
  const parseDn = (value: unknown) => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
  };
  const suctionDn = parseDn(body.suction_dn_mm);
  const dischargeDn = parseDn(body.discharge_dn_mm);
  if (Number.isNaN(suctionDn) || Number.isNaN(dischargeDn)) {
    return res.status(400).json({
      error: { code: 'INVALID_DN_SIZE', message: 'Suction and discharge DN sizes must be positive numbers when provided.' },
    });
  }
  const venturiFlow = venturi_flow_m3h === null || venturi_flow_m3h === undefined ||
    (typeof venturi_flow_m3h === 'string' && venturi_flow_m3h.trim() === '')
    ? null
    : (typeof venturi_flow_m3h === 'number' || typeof venturi_flow_m3h === 'string')
      ? Number(venturi_flow_m3h)
      : Number.NaN;
  if (venturiFlow !== null && (!Number.isFinite(venturiFlow) || venturiFlow < 0)) {
    return res.status(400).json({
      error: { code: 'INVALID_VENTURI_FLOW', message: 'Venturi flow must be a finite, non-negative value in m³/h' },
    });
  }
  const frictionLoss = friction_loss_mh2o === null || friction_loss_mh2o === undefined ||
    (typeof friction_loss_mh2o === 'string' && friction_loss_mh2o.trim() === '')
    ? null
    : (typeof friction_loss_mh2o === 'number' || typeof friction_loss_mh2o === 'string')
      ? Number(friction_loss_mh2o)
      : Number.NaN;
  if (frictionLoss !== null && (!Number.isFinite(frictionLoss) || frictionLoss < 0)) {
    return res.status(400).json({
      error: { code: 'INVALID_FRICTION_LOSS', message: 'Friction loss must be a finite, non-negative value in mH₂O' },
    });
  }
  const fields = ['min_flow_m3h', 'max_flow_m3h', 'friction_loss_mh2o', 'design_head_m', 'design_pressure_bar', 'max_pressure_bar', 'npsh_required_m', 'fluid_type', 'min_temperature_c', 'max_temperature_c', 'notes', 'suction_dn_mm', 'discharge_dn_mm'] as const;
  let previousProductFlow: unknown;
  let previousHydraulicFlow: unknown;
  let linkedDesignFlow: number | null;
  let saved: any;
  try {
    saved = await withProductTransaction(async client => {
      const currentProduct = await client.query('SELECT design_flow_m3h FROM product_masters WHERE id=$1 FOR UPDATE', [pid]);
      const currentHydraulic = await client.query('SELECT * FROM product_hydraulic WHERE product_master_id=$1 FOR UPDATE', [pid]);
      const existing = currentHydraulic.rows[0] || {};
      previousProductFlow = currentProduct.rows[0]?.design_flow_m3h;
      previousHydraulicFlow = existing.design_flow_m3h;
      if (flowsConflict(previousProductFlow, previousHydraulicFlow) && body.design_flow_conflict_resolution !== 'hydraulic') {
        const error: any = new Error('Conflicting populated design flows require an explicit hydraulic resolution');
        error.status = 409;
        error.code = 'DESIGN_FLOW_CONFLICT';
        throw error;
      }
      linkedDesignFlow = flowsConflict(previousProductFlow, previousHydraulicFlow)
        ? Number(previousHydraulicFlow)
        : Object.prototype.hasOwnProperty.call(body, 'design_flow_m3h')
          ? normalizeDesignFlow(design_flow_m3h)
          : previousHydraulicFlow != null
            ? Number(previousHydraulicFlow)
            : previousProductFlow != null
              ? Number(previousProductFlow)
              : null;
      const merged = Object.fromEntries(fields.map(field => [
        field,
        Object.prototype.hasOwnProperty.call(body, field)
          ? field === 'friction_loss_mh2o' ? frictionLoss : nullableHydraulicValue(body[field])
          : existing[field] ?? null,
      ]));
      const mergedVenturi = Object.prototype.hasOwnProperty.call(body, 'venturi_flow_m3h')
        ? venturiFlow
        : existing.venturi_flow_m3h ?? null;
      const r = await client.query(`
        INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, min_flow_m3h, max_flow_m3h, venturi_flow_m3h, friction_loss_mh2o, design_head_m, design_pressure_bar, max_pressure_bar, npsh_required_m, fluid_type, min_temperature_c, max_temperature_c, notes, suction_dn_mm, discharge_dn_mm, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
        ON CONFLICT (product_master_id) DO UPDATE SET
          design_flow_m3h=$2, min_flow_m3h=$3, max_flow_m3h=$4, venturi_flow_m3h=$5, friction_loss_mh2o=$6, design_head_m=$7, design_pressure_bar=$8, max_pressure_bar=$9, npsh_required_m=$10, fluid_type=$11, min_temperature_c=$12, max_temperature_c=$13, notes=$14, suction_dn_mm=$15, discharge_dn_mm=$16, updated_at=NOW()
        RETURNING *`, [
          pid, linkedDesignFlow, merged.min_flow_m3h, merged.max_flow_m3h, mergedVenturi,
          merged.friction_loss_mh2o, merged.design_head_m, merged.design_pressure_bar,
          merged.max_pressure_bar, merged.npsh_required_m, merged.fluid_type,
          merged.min_temperature_c, merged.max_temperature_c, merged.notes,
          Object.prototype.hasOwnProperty.call(body, 'suction_dn_mm') ? suctionDn : existing.suction_dn_mm ?? null,
          Object.prototype.hasOwnProperty.call(body, 'discharge_dn_mm') ? dischargeDn : existing.discharge_dn_mm ?? null,
        ]);
      await client.query('UPDATE product_masters SET design_flow_m3h=$2, updated_at=NOW() WHERE id=$1', [pid, linkedDesignFlow]);
      if (flowsConflict(previousProductFlow, previousHydraulicFlow)) {
        await client.query(
          `UPDATE product_design_flow_reconciliations
           SET status='resolved', resolution='hydraulic', resolved_value_m3h=$2,
               resolved_by=$3, resolved_at=NOW()
           WHERE product_master_id=$1 AND status='unresolved'`,
          [pid, linkedDesignFlow, req.user!.id],
        );
      }
      if (Object.prototype.hasOwnProperty.call(body, 'design_flow_m3h') || previousProductFlow !== previousHydraulicFlow) {
        await insertAuditTx(client, req.user!.id, 'product', pid, 'LINKED_DESIGN_FLOW_UPDATE',
          designFlowAuditDetails('hydraulic_card', linkedDesignFlow, previousProductFlow, previousHydraulicFlow));
      }
      return { ...r.rows[0], design_flow_m3h: linkedDesignFlow, design_flow_sync_status: linkedDesignFlow == null ? 'empty' : 'synchronized' };
    });
  } catch (error) {
    return next(error);
  }
  await logAudit(req.user!.id, 'product', pid, 'UPDATE', {
    summary: 'Product hydraulic data updated',
    venturi_flow_m3h: venturiFlow,
    friction_loss_mh2o: frictionLoss,
  });
  res.json(saved);
});

router.post('/product-masters/design-flow/reconcile', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const requestedProduct = req.body?.product_id || req.body?.product_code || null;
  const resolution = req.body?.resolution;
  if (resolution != null && !['hydraulic', 'product_master'].includes(resolution)) {
    return res.status(400).json({ error: { code: 'INVALID_RESOLUTION', message: 'resolution must be hydraulic or product_master' } });
  }
  try {
    const outcome = await withProductTransaction(async client => {
      const params = requestedProduct ? [requestedProduct] : [];
      const result = await client.query(
        `SELECT pm.id, pm.product_code, pm.design_flow_m3h AS product_design_flow_m3h,
                ph.design_flow_m3h AS hydraulic_design_flow_m3h
         FROM product_masters pm
         LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
         ${requestedProduct ? 'WHERE pm.id::text=$1 OR pm.product_code=$1' : ''}
         ORDER BY pm.product_code
         FOR UPDATE OF pm`,
        params,
      );
      const conflicts: any[] = [];
      const reconciled: any[] = [];
      for (const row of result.rows) {
        const conflict = flowsConflict(row.product_design_flow_m3h, row.hydraulic_design_flow_m3h);
        if (conflict && !resolution) {
          await client.query(
            `INSERT INTO product_design_flow_reconciliations
               (product_master_id, product_flow_m3h, hydraulic_flow_m3h, status)
             SELECT $1,$2,$3,'unresolved'
             WHERE NOT EXISTS (
               SELECT 1 FROM product_design_flow_reconciliations
               WHERE product_master_id=$1 AND status='unresolved'
             )`,
            [row.id, row.product_design_flow_m3h, row.hydraulic_design_flow_m3h],
          );
          conflicts.push(row);
          continue;
        }
        const value = conflict
          ? Number(resolution === 'hydraulic' ? row.hydraulic_design_flow_m3h : row.product_design_flow_m3h)
          : row.hydraulic_design_flow_m3h != null
            ? Number(row.hydraulic_design_flow_m3h)
            : row.product_design_flow_m3h != null
              ? Number(row.product_design_flow_m3h)
              : null;
        await client.query('UPDATE product_masters SET design_flow_m3h=$2, updated_at=NOW() WHERE id=$1', [row.id, value]);
        await client.query(
          `INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, updated_at)
           VALUES ($1,$2,NOW())
           ON CONFLICT (product_master_id) DO UPDATE SET design_flow_m3h=EXCLUDED.design_flow_m3h, updated_at=NOW()`,
          [row.id, value],
        );
        if (conflict) {
          await client.query(
            `UPDATE product_design_flow_reconciliations
             SET status='resolved', resolution=$2, resolved_value_m3h=$3,
                 resolved_by=$4, resolved_at=NOW()
             WHERE product_master_id=$1 AND status='unresolved'`,
            [row.id, resolution, value, req.user!.id],
          );
        }
        await insertAuditTx(client, req.user!.id, 'product', row.id, 'LINKED_DESIGN_FLOW_UPDATE',
          designFlowAuditDetails('reconciliation', value, row.product_design_flow_m3h, row.hydraulic_design_flow_m3h));
        reconciled.push({ product_id: row.id, product_code: row.product_code, design_flow_m3h: value, resolution: conflict ? resolution : 'backfill' });
      }
      return { reconciled, conflicts };
    });
    if (outcome.conflicts.length) {
      return res.status(409).json({
        error: {
          code: 'DESIGN_FLOW_CONFLICT',
          message: 'Conflicting populated design flows require an explicit hydraulic or product_master resolution',
        },
        reconciled: outcome.reconciled,
        conflicts: outcome.conflicts,
      });
    }
    res.json({ reconciled: outcome.reconciled, conflicts: [] });
  } catch (error) {
    next(error);
  }
});

// PRODUCT CLASSIFIER VALUES
router.get('/product-masters/:id/classifier-values', authenticate, async (req: AuthRequest, res: Response) => {
  const pm = await query('SELECT id, product_family_id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
  if (!pm.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const { id, product_family_id } = pm.rows[0];
  if (!product_family_id) return res.json({ classifiers: [], values: {} });
  const classifiers = await query('SELECT * FROM family_classifiers WHERE family_id=$1 ORDER BY sort_order, created_at', [product_family_id]);
  const values = await query('SELECT classifier_id, value_text FROM product_classifier_values WHERE product_id=$1', [id]);
  const valueMap: Record<string, string> = {};
  for (const v of values.rows) valueMap[v.classifier_id] = v.value_text;
  res.json({ classifiers: classifiers.rows, values: valueMap });
});

router.put('/product-masters/:id/classifier-values', authenticate, async (req: AuthRequest, res: Response) => {
  const pm = await query('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
  if (!pm.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const productId = pm.rows[0].id;
  const { values } = req.body as { values: Record<string, string> };
  for (const [classifierId, valueText] of Object.entries(values)) {
    if (valueText === null || valueText === undefined || valueText === '') {
      await query('DELETE FROM product_classifier_values WHERE product_id=$1 AND classifier_id=$2', [productId, classifierId]);
    } else {
      await query(
        'INSERT INTO product_classifier_values (product_id, classifier_id, value_text) VALUES ($1,$2,$3) ON CONFLICT (product_id, classifier_id) DO UPDATE SET value_text=$3',
        [productId, classifierId, valueText]);
    }
  }
  res.json({ updated: true });
});

// PRODUCT IMAGE UPLOAD
router.post('/product-masters/:id/image', authenticate, uploadImage.single('image'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No image file provided' } });
  const imageUrl = `/uploads/${req.file.filename}`;
  const result = await query('UPDATE product_masters SET image_url=$1, updated_at=NOW() WHERE id::text=$2 OR product_code=$2 RETURNING id, image_url', [imageUrl, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  res.json({ image_url: imageUrl });
});

export default router;
