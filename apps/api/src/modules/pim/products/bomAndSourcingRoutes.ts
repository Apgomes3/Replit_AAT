// PIM product routes: Variants, BOMs, relationships, component variants, vendor options and usages.
// Mounted by ./index.ts behind authentication and PIM module access, in the original order.
import { Router, Response } from 'express';
import { query } from '../../../db';
import { authenticate, requireModuleManage, AuthRequest } from '../../../middleware/auth';
import { isSupportedCurrency, SUPPORTED_CURRENCY_TEXT } from '../../../lib/currencies';
import { refreshDefaultBomCost, withProductTransaction } from './shared';

const router = Router();

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

export default router;
