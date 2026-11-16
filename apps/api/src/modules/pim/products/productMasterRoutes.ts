// PIM product routes: Product masters: list, read, create, bulk import, update, delete, duplicate.
// Mounted by ./index.ts behind authentication and PIM module access, in the original order.
import { Router, NextFunction, Response } from 'express';
import pool, { query } from '../../../db';
import { logAudit } from '../../../db/audit';
import { authenticate, requireModuleManage, requireRole, AuthRequest } from '../../../middleware/auth';
import { calculateWaterSurfaceAreaM2 } from '../../../lib/tankCalculations';
import { EDITOR_ROLES } from '../../../lib/roles';
import { refreshDefaultBomCost, DbClient, AAT_SAND_FILTER_FRICTION_DEFAULT_KEY, withProductTransaction, normalizeDesignFlow, isAatSandFilter, flowsConflict, insertAuditTx, designFlowAuditDetails, nextRevisionCode, isEditableDocumentRevision, readPimTdsSource, PRODUCT_LIST_MAX_PAGE_SIZE, validateTankEngineeringPayload } from './shared';

const router = Router();

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
  requireRole(...EDITOR_ROLES),
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

export default router;
