// PIM product routes: Product families and tank families.
// Mounted by ./index.ts behind authentication and PIM module access, in the original order.
import { Router, Response } from 'express';
import { query } from '../../../db';
import { authenticate, requireRole, AuthRequest } from '../../../middleware/auth';
import { EDITOR_ROLES } from '../../../lib/roles';

const router = Router();

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

router.delete('/product-families/:id', authenticate, requireRole(...EDITOR_ROLES), async (req: AuthRequest, res: Response) => {
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

export default router;
