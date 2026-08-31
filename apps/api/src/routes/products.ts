import { NextFunction, Router, Response } from 'express';
import pool, { query } from '../db';
import { logAudit } from '../db/audit';
import { authenticate, requireModuleAccess, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { calculateWaterSurfaceAreaM2 } from '../lib/tankCalculations';

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
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
  const { product_family_name, category_code, description, status } = req.body;
  const result = await query(
    'UPDATE product_families SET product_family_name=$1, category_code=$2, description=$3, status=COALESCE($4, status), updated_at=NOW() WHERE id::text=$5 RETURNING *',
    [product_family_name, category_code, description, status || null, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
  res.json(result.rows[0]);
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
router.get('/product-masters', authenticate, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const page_size = Math.min(parseInt(req.query.page_size as string) || 25, 200);
  const offset = (page - 1) * page_size;
  const filters: string[] = [];
  const params: any[] = [];

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
       pf.product_family_name, tf.name AS tank_family_name,
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
       pf.product_family_name, m.material_name,
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

router.post('/product-masters', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const {
    product_code, product_family_id, tank_family_id, product_name, product_category, application_type,
    design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes,
    shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3,
     manufacturer, model, configuration, control_type,
  } = req.body;
  if (!product_code || !product_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'product_code and product_name required' } });
  const surfaceAreaM2 = calculateWaterSurfaceAreaM2(
    shape_type,
    length_mm ? parseFloat(length_mm) : null,
    width_mm ? parseFloat(width_mm) : null,
  );
  try {
    const linkedFlow = normalizeDesignFlow(design_flow_m3h);
    const created = await withProductTransaction(async client => {
      const result = await client.query(
        `INSERT INTO product_masters
          (product_code, product_family_id, tank_family_id, product_name, product_category, application_type,
           design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes,
           shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, surface_area_m2, cost,
            manufacturer, model, configuration, control_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
        [
          product_code, product_family_id || null, tank_family_id || null, product_name, product_category, application_type,
          linkedFlow, design_pressure_bar || null, design_head_m || null, power_kw || null,
          primary_material_code || null, standard_status || 'Concept', notes || null,
          shape_type || null, length_mm || null, width_mm || null, height_mm || null,
          design_water_level_mm || null, gross_volume_m3 || null, operating_volume_m3 || null, surfaceAreaM2, 0,
          manufacturer || null, model || null, configuration || null, control_type || null,
        ]);
      await client.query(
        'INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, updated_at) VALUES ($1,$2,NOW())',
        [result.rows[0].id, linkedFlow],
      );
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
  const { product_code, product_name, product_category, application_type, design_flow_m3h, design_head_m, power_kw, primary_material_code, standard_status, image_url, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, wall_thickness_mm, weight_kg, product_family_id, tank_family_id, synonyms, cost, sell_price, currency, manufacturer, model, configuration, control_type, status } = req.body;
  const hasPowerKw = Object.prototype.hasOwnProperty.call(req.body, 'power_kw');
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
        `SELECT pm.design_flow_m3h AS product_design_flow_m3h,
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
        `UPDATE product_masters SET product_code=COALESCE($32, product_code), product_name=$1, product_category=$2, application_type=$3, design_flow_m3h=$4, design_head_m=$5, power_kw=CASE WHEN $33 THEN $6 ELSE power_kw END, primary_material_code=$7, standard_status=$8, image_url=$9, notes=$10, shape_type=$11, length_mm=$12, width_mm=$13, height_mm=$14, design_water_level_mm=$15, gross_volume_m3=$16, operating_volume_m3=$17, product_family_id=$18, synonyms=$19, tank_family_id=$20, cost=$21, sell_price=$22, currency=$23, wall_thickness_mm=$24, weight_kg=$25, manufacturer=$26, model=$27, configuration=$28, control_type=$29, status=COALESCE($30,status), updated_at=NOW() WHERE id=$31 RETURNING *`,
        [product_name, product_category, application_type, linkedDesignFlow, design_head_m || null, power_kw, primary_material_code, standard_status, image_url || null, notes, shape_type || null, length_mm || null, width_mm || null, height_mm || null, design_water_level_mm || null, gross_volume_m3 || null, operating_volume_m3 || null, product_family_id || null, synonymsArr, tank_family_id || null, costVal, sellVal, currency || 'USD', wall_thickness_mm || null, weightVal, manufacturer || null, model || null, configuration || null, control_type || null, status || null, req.params.id, newCode, hasPowerKw]);
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
      return { ...result.rows[0], design_flow_m3h: linkedDesignFlow, design_flow_sync_status: linkedDesignFlow == null ? 'empty' : 'synchronized' };
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

router.post('/product-masters/:id/duplicate', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    const created = await withProductTransaction(async client => {
      const result = await client.query(
        `INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, synonyms, manufacturer, model, wall_thickness_mm, weight_kg, tank_family_id, configuration, control_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`,
        [newCode, newFamilyId, newName, src.product_category, src.application_type, linkedFlow, src.design_pressure_bar, src.design_head_m, src.power_kw, src.primary_material_code, newStatus, src.notes, src.shape_type, src.length_mm, src.width_mm, src.height_mm, src.design_water_level_mm, src.gross_volume_m3, src.operating_volume_m3, src.synonyms || [], src.manufacturer || null, src.model || null, src.wall_thickness_mm || null, src.weight_kg || null, src.tank_family_id || null, src.configuration || null, src.control_type || null]);
      await client.query(
        `INSERT INTO product_hydraulic
           (product_master_id, design_flow_m3h, min_flow_m3h, max_flow_m3h, venturi_flow_m3h,
            design_head_m, design_pressure_bar, max_pressure_bar, npsh_required_m, fluid_type,
            min_temperature_c, max_temperature_c, notes, updated_at)
         SELECT $1,$2,min_flow_m3h,max_flow_m3h,venturi_flow_m3h,design_head_m,design_pressure_bar,
                max_pressure_bar,npsh_required_m,fluid_type,min_temperature_c,max_temperature_c,notes,NOW()
         FROM product_hydraulic WHERE product_master_id=$3
         UNION ALL
         SELECT $1,$2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NOW()
         WHERE NOT EXISTS (SELECT 1 FROM product_hydraulic WHERE product_master_id=$3)`,
        [result.rows[0].id, linkedFlow, req.params.id],
      );
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

router.post('/product-boms', authenticate, async (req: AuthRequest, res: Response) => {
  const { bom_code, product_master_id, revision_code, effective_from } = req.body;
  const result = await query('INSERT INTO standard_boms (bom_code, product_master_id, revision_code, effective_from) VALUES ($1,$2,$3,$4) RETURNING *',
    [bom_code, product_master_id, revision_code || 'A', effective_from]);
  res.status(201).json(result.rows[0]);
});

router.post('/product-boms/:id/lines', authenticate, async (req: AuthRequest, res: Response) => {
  const { line_number, component_id, sub_product_id, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks } = req.body;
  const result = await query(
    'INSERT INTO bom_lines (standard_bom_id, component_id, sub_product_id, line_number, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [req.params.id, component_id || null, sub_product_id || null, line_number, component_type, component_reference_code, component_name, quantity || 1, unit, is_optional || false, remarks]);
  res.status(201).json(result.rows[0]);
});

router.delete('/product-boms/:bomId/lines/:lineId', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM bom_lines WHERE id=$1 AND standard_bom_id=$2', [req.params.lineId, req.params.bomId]);
  res.status(204).end();
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

router.post('/vendor-options', authenticate, async (req: AuthRequest, res: Response) => {
  const { vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status, lead_time_days, region_scope } = req.body;
  const result = await query('INSERT INTO vendor_options (vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status, lead_time_days, region_scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status || 'Approved', lead_time_days, region_scope]);
  res.status(201).json(result.rows[0]);
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

router.post('/components', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, manufacturer, model } = req.body;
    if (!component_code || !component_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'component_code and component_name required' } });
    const pmCode = primary_material_code || null;
    const wkg = (weight_kg === '' || weight_kg === null || weight_kg === undefined) ? null : parseFloat(String(weight_kg));
    const result = await query(
      'INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, created_by, cost, manufacturer, model) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
      [component_code, component_name, component_type || 'Vessel', component_category || 'Mechanical', description || null, pmCode, standard_size || null, wkg, unit || 'EA', status || 'Active', notes || null, req.user!.id, 0, manufacturer || null, model || null]);
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

router.put('/components/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms, cost, sell_price, manufacturer, model } = req.body;
  const synonymsArr = Array.isArray(synonyms) ? synonyms.filter(Boolean) : [];
  const costVal = (cost === null || cost === undefined || cost === '') ? 0 : parseFloat(String(cost));
  const sellVal = (sell_price === null || sell_price === undefined || sell_price === '') ? null : parseFloat(String(sell_price));
  const result = await query(
    'UPDATE components SET component_name=$1, component_type=$2, component_category=$3, description=$4, primary_material_code=$5, standard_size=$6, weight_kg=$7, unit=$8, status=$9, notes=$10, synonyms=$11, cost=$12, sell_price=$13, manufacturer=$14, model=$15, updated_at=NOW() WHERE id=$16 RETURNING *',
    [component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonymsArr, costVal, sellVal, manufacturer || null, model || null, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  await logAudit(req.user!.id, 'component', String(req.params.id), 'UPDATE', {
    summary: 'Component details updated',
    component_name,
    component_type,
    status,
    manufacturer: manufacturer || null,
    model: model || null,
    cost: costVal,
    primary_material_code: primary_material_code || null,
  });
  res.json(result.rows[0]);
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

router.post('/components/:id/duplicate', authenticate, async (req: AuthRequest, res: Response) => {
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
    `INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms, created_by, manufacturer, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [newCode, newName, newType, newCategory, src.description, src.primary_material_code, src.standard_size, src.weight_kg, src.unit, newStatus, src.notes, src.synonyms || [], req.user!.id, src.manufacturer || null, src.model || null]);
  res.status(201).json(result.rows[0]);
});

router.delete('/components/:id', authenticate, async (req: AuthRequest, res: Response) => {
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

// PRODUCT SPEC TABLES (dimensions, electrical, hydraulic)
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
  const { rated_power_kw, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes } = req.body;
  const r = await query(`
    INSERT INTO product_electrical (product_master_id, rated_power_kw, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (product_master_id) DO UPDATE SET
      rated_power_kw=$2, voltage_v=$3, phases=$4, frequency_hz=$5, full_load_current_a=$6, rated_speed_rpm=$7, motor_type=$8, insulation_class=$9, protection_class=$10, efficiency_class=$11, notes=$12, updated_at=NOW()
    RETURNING *`, [pid, rated_power_kw||null, voltage_v||null, phases||null, frequency_hz||null, full_load_current_a||null, rated_speed_rpm||null, motor_type||null, insulation_class||null, protection_class||null, efficiency_class||null, notes||null]);
  res.json(r.rows[0]);
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
  const { design_flow_m3h, venturi_flow_m3h } = body;
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
  const fields = ['min_flow_m3h', 'max_flow_m3h', 'design_head_m', 'design_pressure_bar', 'max_pressure_bar', 'npsh_required_m', 'fluid_type', 'min_temperature_c', 'max_temperature_c', 'notes'] as const;
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
        Object.prototype.hasOwnProperty.call(body, field) ? nullableHydraulicValue(body[field]) : existing[field] ?? null,
      ]));
      const mergedVenturi = Object.prototype.hasOwnProperty.call(body, 'venturi_flow_m3h')
        ? venturiFlow
        : existing.venturi_flow_m3h ?? null;
      const r = await client.query(`
        INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, min_flow_m3h, max_flow_m3h, venturi_flow_m3h, design_head_m, design_pressure_bar, max_pressure_bar, npsh_required_m, fluid_type, min_temperature_c, max_temperature_c, notes, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (product_master_id) DO UPDATE SET
          design_flow_m3h=$2, min_flow_m3h=$3, max_flow_m3h=$4, venturi_flow_m3h=$5, design_head_m=$6, design_pressure_bar=$7, max_pressure_bar=$8, npsh_required_m=$9, fluid_type=$10, min_temperature_c=$11, max_temperature_c=$12, notes=$13, updated_at=NOW()
        RETURNING *`, [pid, linkedDesignFlow, merged.min_flow_m3h, merged.max_flow_m3h, mergedVenturi, merged.design_head_m, merged.design_pressure_bar, merged.max_pressure_bar, merged.npsh_required_m, merged.fluid_type, merged.min_temperature_c, merged.max_temperature_c, merged.notes]);
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
