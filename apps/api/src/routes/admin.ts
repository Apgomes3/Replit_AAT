import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const router = Router();

router.get('/users', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT id, email, first_name, last_name, role, is_active, created_at FROM users ORDER BY created_at');
  res.json({ items: result.rows });
});

router.post('/users', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { email, password, first_name, last_name, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email and password required' } });
  const hash = await bcrypt.hash(password, 10);
  const result = await query('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, first_name, last_name, role, created_at',
    [email, hash, first_name, last_name, role || 'viewer']);
  res.status(201).json(result.rows[0]);
});

router.put('/users/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { first_name, last_name, role, is_active } = req.body;
  const result = await query('UPDATE users SET first_name=$1, last_name=$2, role=$3, is_active=$4, updated_at=NOW() WHERE id=$5 RETURNING id, email, first_name, last_name, role, is_active',
    [first_name, last_name, role, is_active, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  res.json(result.rows[0]);
});

router.get('/audit-logs', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const page_size = Math.min(parseInt(req.query.page_size as string) || 50, 200);
  const offset = (page - 1) * page_size;
  const result = await query(
    `SELECT al.*, u.first_name || ' ' || u.last_name as actor_name
     FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id
     ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`, [page_size, offset]);
  res.json({ items: result.rows, pagination: { page, page_size } });
});

router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  const [projs, products, docs, equip, mats, systems, comps, docByStatus, equipByStatus, recentDocs] = await Promise.all([
    query('SELECT COUNT(*) FROM projects'),
    query('SELECT COUNT(*) FROM product_masters'),
    query('SELECT COUNT(*) FROM documents'),
    query('SELECT COUNT(*) FROM equipment_instances'),
    query('SELECT COUNT(*) FROM materials'),
    query('SELECT COUNT(*) FROM systems'),
    query('SELECT COUNT(*) FROM components'),
    query('SELECT status, COUNT(*) as count FROM documents GROUP BY status ORDER BY status'),
    query('SELECT status, COUNT(*) as count FROM equipment_instances GROUP BY status ORDER BY status'),
    query(`SELECT d.id, d.document_code, d.document_title, d.document_type, d.status, d.created_at,
             u.first_name || ' ' || u.last_name as created_by_name
           FROM documents d LEFT JOIN users u ON d.created_by=u.id
           ORDER BY d.created_at DESC LIMIT 5`),
  ]);
  res.json({
    projects: parseInt(projs.rows[0].count),
    products: parseInt(products.rows[0].count),
    documents: parseInt(docs.rows[0].count),
    equipment: parseInt(equip.rows[0].count),
    materials: parseInt(mats.rows[0].count),
    systems: parseInt(systems.rows[0].count),
    components: parseInt(comps.rows[0].count),
    document_by_status: docByStatus.rows,
    equipment_by_status: equipByStatus.rows,
    recent_documents: recentDocs.rows,
  });
});

// PRODUCT CATEGORIES
router.get('/categories', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM product_categories ORDER BY sort_order, name');
  res.json({ items: result.rows });
});

router.post('/categories', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { name, code, description, sort_order } = req.body;
  if (!name || !code) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'name and code required' } });
  try {
    const result = await query(
      'INSERT INTO product_categories (name, code, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, code.toUpperCase(), description || null, sort_order || 0]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Category name or code already exists' } });
    throw err;
  }
});

router.put('/categories/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { name, code, description, sort_order } = req.body;
  const result = await query(
    'UPDATE product_categories SET name=$1, code=$2, description=$3, sort_order=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
    [name, code?.toUpperCase(), description || null, sort_order ?? 0, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
  res.json(result.rows[0]);
});

router.delete('/categories/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT is_system FROM product_categories WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
  if (existing.rows[0].is_system) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete a built-in category' } });
  await query('DELETE FROM product_categories WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

// ROLES
router.get('/roles', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM roles ORDER BY sort_order, name');
  res.json({ items: result.rows });
});

router.post('/roles', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'name is required' } });
  try {
    const result = await query(
      'INSERT INTO roles (name, description, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [name.trim().toLowerCase(), description || null, sort_order || 0]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Role name already exists' } });
    throw err;
  }
});

router.put('/roles/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  const existing = await query('SELECT is_system FROM roles WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
  if (existing.rows[0].is_system && name !== existing.rows[0].name) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot rename a built-in role' } });
  }
  try {
    const result = await query(
      'UPDATE roles SET name=$1, description=$2, sort_order=$3, updated_at=NOW() WHERE id=$4 RETURNING *',
      [name.trim().toLowerCase(), description || null, sort_order ?? 0, req.params.id]);
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Role name already exists' } });
    throw err;
  }
});

router.delete('/roles/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT is_system FROM roles WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
  if (existing.rows[0].is_system) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete a built-in role' } });
  await query('DELETE FROM roles WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

// PENDING APPROVALS (admin/engineer only)
router.get('/pending-approvals', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const [pendingProjects, pendingProducts, pendingDocs] = await Promise.all([
    query(`SELECT id, project_code as code, project_name as name, project_status as status, 'Project' as type, updated_at
           FROM projects WHERE project_status IN ('Draft','Internal Review','Pending Approval')
           ORDER BY updated_at DESC LIMIT 10`),
    query(`SELECT id, product_code as code, product_name as name, status, 'Product' as type, updated_at
           FROM product_masters WHERE status IN ('Draft','Internal Review','Pending Approval')
           ORDER BY updated_at DESC LIMIT 10`),
    query(`SELECT id, document_code as code, document_title as name, status, 'Document' as type, updated_at
           FROM documents WHERE status IN ('Draft','Internal Review')
           ORDER BY updated_at DESC LIMIT 10`),
  ]);
  const items = [
    ...pendingProjects.rows,
    ...pendingProducts.rows,
    ...pendingDocs.rows,
  ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 15);
  res.json({ items });
});

// TO-DOs (per-user)
router.get('/todos', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM todos WHERE user_id=$1 ORDER BY created_at ASC', [req.user!.id]);
  res.json({ items: result.rows });
});

router.post('/todos', authenticate, async (req: AuthRequest, res: Response) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'text required' } });
  const result = await query('INSERT INTO todos (user_id, text) VALUES ($1,$2) RETURNING *', [req.user!.id, text.trim()]);
  res.status(201).json(result.rows[0]);
});

router.patch('/todos/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { done } = req.body;
  const result = await query('UPDATE todos SET done=$1 WHERE id=$2 AND user_id=$3 RETURNING *', [done, req.params.id, req.user!.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Todo not found' } });
  res.json(result.rows[0]);
});

router.delete('/todos/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM todos WHERE id=$1 AND user_id=$2', [req.params.id, req.user!.id]);
  res.status(204).end();
});

export default router;
