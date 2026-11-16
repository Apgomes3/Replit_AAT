// PIM product routes: Components, and status changes for products and components.
// Mounted by ./index.ts behind authentication and PIM module access, in the original order.
import { Router, Response } from 'express';
import { query } from '../../../db';
import { logAudit } from '../../../db/audit';
import { authenticate, requireModuleManage, AuthRequest } from '../../../middleware/auth';
import { isSupportedCurrency } from '../../../lib/currencies';
import { refreshDefaultBomCost } from './shared';

const router = Router();

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

export default router;
