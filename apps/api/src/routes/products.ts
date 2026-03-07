import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

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

// PRODUCT MASTERS
router.get('/product-masters', authenticate, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const page_size = Math.min(parseInt(req.query.page_size as string) || 25, 200);
  const offset = (page - 1) * page_size;
  const filters: string[] = [];
  const params: any[] = [];

  if (req.query.family_id) { params.push(req.query.family_id); filters.push(`pm.product_family_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`pm.standard_status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); filters.push(`(pm.product_name ILIKE $${params.length} OR pm.product_code ILIKE $${params.length})`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM product_masters pm ${where}`, params);
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

router.post('/product-masters', authenticate, async (req: AuthRequest, res: Response) => {
  const { product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes } = req.body;
  if (!product_code || !product_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'product_code and product_name required' } });
  const result = await query(
    'INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
    [product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status || 'Concept', notes]);
  res.status(201).json(result.rows[0]);
});

router.put('/product-masters/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { product_name, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status, notes } = req.body;
  const result = await query('UPDATE product_masters SET product_name=$1, product_category=$2, application_type=$3, design_flow_m3h=$4, power_kw=$5, primary_material_code=$6, standard_status=$7, notes=$8, updated_at=NOW() WHERE id=$9 RETURNING *',
    [product_name, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status, notes, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  res.json(result.rows[0]);
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
    conditions.push(`(c.component_code ILIKE $${params.length} OR c.component_name ILIKE $${params.length} OR c.description ILIKE $${params.length})`);
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
  const usedIn = await query(
    `SELECT DISTINCT pm.id, pm.product_code, pm.product_name, pm.standard_status, bl.quantity, bl.unit
     FROM bom_lines bl JOIN standard_boms sb ON bl.standard_bom_id=sb.id JOIN product_masters pm ON sb.product_master_id=pm.id
     WHERE bl.component_id=$1 OR bl.component_reference_code=$2
     ORDER BY pm.product_code`,
    [result.rows[0].id, result.rows[0].component_code]);
  res.json({ ...result.rows[0], used_in: usedIn.rows });
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
  const { component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes } = req.body;
  const result = await query(
    'UPDATE components SET component_name=$1, component_type=$2, component_category=$3, description=$4, primary_material_code=$5, standard_size=$6, weight_kg=$7, unit=$8, status=$9, notes=$10, updated_at=NOW() WHERE id=$11 RETURNING *',
    [component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
  res.json(result.rows[0]);
});

export default router;
