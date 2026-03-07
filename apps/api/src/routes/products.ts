import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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

// PRODUCT FAMILIES
router.get('/product-families', authenticate, async (req: AuthRequest, res: Response) => {
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

// PRODUCT MASTERS
router.get('/product-masters', authenticate, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const page_size = Math.min(parseInt(req.query.page_size as string) || 25, 200);
  const offset = (page - 1) * page_size;
  const filters: string[] = [];
  const params: any[] = [];

  if (req.query.family_id) { params.push(req.query.family_id); filters.push(`pm.product_family_id = $${params.length}`); }
  if (req.query.category) { params.push(req.query.category); filters.push(`pm.product_category = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`pm.standard_status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); const p = params.length; filters.push(`(pm.product_name ILIKE $${p} OR pm.product_code ILIKE $${p} OR pf.product_family_name ILIKE $${p} OR EXISTS (SELECT 1 FROM unnest(pm.synonyms) s WHERE s ILIKE $${p}))`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM product_masters pm LEFT JOIN product_families pf ON pm.product_family_id=pf.id ${where}`, params);
  params.push(page_size, offset);
  const result = await query(`SELECT pm.*, pf.product_family_name FROM product_masters pm LEFT JOIN product_families pf ON pm.product_family_id=pf.id ${where} ORDER BY pm.product_code LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});

router.get('/product-masters/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT pm.*, pf.product_family_name, m.material_name FROM product_masters pm LEFT JOIN product_families pf ON pm.product_family_id=pf.id LEFT JOIN materials m ON pm.primary_material_code=m.material_code WHERE pm.id::text=$1 OR pm.product_code=$1', [req.params.id]);
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

router.post('/product-masters', authenticate, async (req: AuthRequest, res: Response) => {
  const { product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes } = req.body;
  if (!product_code || !product_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'product_code and product_name required' } });
  const result = await query(
    'INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
    [product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status || 'Concept', notes]);
  res.status(201).json(result.rows[0]);
});

router.put('/product-masters/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { product_name, product_category, application_type, design_flow_m3h, design_head_m, power_kw, primary_material_code, standard_status, image_url, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, product_family_id, synonyms } = req.body;
  const synonymsArr = Array.isArray(synonyms) ? synonyms.filter(Boolean) : [];
  const result = await query(
    'UPDATE product_masters SET product_name=$1, product_category=$2, application_type=$3, design_flow_m3h=$4, design_head_m=$5, power_kw=$6, primary_material_code=$7, standard_status=$8, image_url=$9, notes=$10, shape_type=$11, length_mm=$12, width_mm=$13, height_mm=$14, design_water_level_mm=$15, gross_volume_m3=$16, operating_volume_m3=$17, product_family_id=$18, synonyms=$19, updated_at=NOW() WHERE id=$20 RETURNING *',
    [product_name, product_category, application_type, design_flow_m3h, design_head_m || null, power_kw, primary_material_code, standard_status, image_url || null, notes, shape_type || null, length_mm || null, width_mm || null, height_mm || null, design_water_level_mm || null, gross_volume_m3 || null, operating_volume_m3 || null, product_family_id || null, synonymsArr, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  res.json(result.rows[0]);
});

router.post('/product-masters/:id/duplicate', authenticate, async (req: AuthRequest, res: Response) => {
  const orig = await query('SELECT * FROM product_masters WHERE id=$1', [req.params.id]);
  if (!orig.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const src = orig.rows[0];
  let newCode = `${src.product_code}-COPY`;
  let suffix = 1;
  while (true) {
    const exists = await query('SELECT id FROM product_masters WHERE product_code=$1', [newCode]);
    if (!exists.rows[0]) break;
    suffix++;
    newCode = `${src.product_code}-COPY-${suffix}`;
  }
  const result = await query(
    `INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, synonyms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [newCode, src.product_family_id, `Copy of ${src.product_name}`, src.product_category, src.application_type, src.design_flow_m3h, src.design_pressure_bar, src.design_head_m, src.power_kw, src.primary_material_code, src.standard_status, src.notes, src.shape_type, src.length_mm, src.width_mm, src.height_mm, src.design_water_level_mm, src.gross_volume_m3, src.operating_volume_m3, src.synonyms || []]);
  res.status(201).json(result.rows[0]);
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
  const lines = await query('SELECT * FROM bom_lines WHERE standard_bom_id=$1 ORDER BY line_number', [req.params.id]);
  res.json({ ...bom.rows[0], lines: lines.rows });
});

router.post('/product-boms', authenticate, async (req: AuthRequest, res: Response) => {
  const { bom_code, product_master_id, revision_code, effective_from } = req.body;
  const result = await query('INSERT INTO standard_boms (bom_code, product_master_id, revision_code, effective_from) VALUES ($1,$2,$3,$4) RETURNING *',
    [bom_code, product_master_id, revision_code || 'A', effective_from]);
  res.status(201).json(result.rows[0]);
});

router.post('/product-boms/:id/lines', authenticate, async (req: AuthRequest, res: Response) => {
  const { line_number, component_id, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks } = req.body;
  const result = await query(
    'INSERT INTO bom_lines (standard_bom_id, component_id, line_number, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [req.params.id, component_id || null, line_number, component_type, component_reference_code, component_name, quantity || 1, unit, is_optional || false, remarks]);
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
      CASE WHEN er.source_id=$1 THEN 'outgoing' ELSE 'incoming' END as direction,
      CASE WHEN er.source_id=$1 THEN tgt.product_code ELSE src.product_code END as related_code,
      CASE WHEN er.source_id=$1 THEN tgt.product_name ELSE src.product_name END as related_name,
      CASE WHEN er.source_id=$1 THEN tgt.id ELSE src.id END as related_id,
      CASE WHEN er.source_id=$1 THEN tgt.standard_status ELSE src.standard_status END as related_status
    FROM entity_relationships er
    LEFT JOIN product_masters src ON er.source_id=src.id
    LEFT JOIN product_masters tgt ON er.target_id=tgt.id
    WHERE (er.source_id=$1 OR er.target_id=$1)
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
  const { component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes } = req.body;
  if (!component_code || !component_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'component_code and component_name required' } });
  const result = await query(
    'INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
    [component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit || 'EA', status || 'Active', notes, req.user!.id]);
  res.status(201).json(result.rows[0]);
});

router.put('/components/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms } = req.body;
  const synonymsArr = Array.isArray(synonyms) ? synonyms.filter(Boolean) : [];
  const result = await query(
    'UPDATE components SET component_name=$1, component_type=$2, component_category=$3, description=$4, primary_material_code=$5, standard_size=$6, weight_kg=$7, unit=$8, status=$9, notes=$10, synonyms=$11, updated_at=NOW() WHERE id=$12 RETURNING *',
    [component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonymsArr, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  res.json(result.rows[0]);
});

router.post('/components/:id/duplicate', authenticate, async (req: AuthRequest, res: Response) => {
  const orig = await query('SELECT * FROM components WHERE id=$1', [req.params.id]);
  if (!orig.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  const src = orig.rows[0];
  let newCode = `${src.component_code}-COPY`;
  let suffix = 1;
  while (true) {
    const exists = await query('SELECT id FROM components WHERE component_code=$1', [newCode]);
    if (!exists.rows[0]) break;
    suffix++;
    newCode = `${src.component_code}-COPY-${suffix}`;
  }
  const result = await query(
    `INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [newCode, `Copy of ${src.component_name}`, src.component_type, src.component_category, src.description, src.primary_material_code, src.standard_size, src.weight_kg, src.unit, src.status, src.notes, src.synonyms || [], req.user!.id]);
  res.status(201).json(result.rows[0]);
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
