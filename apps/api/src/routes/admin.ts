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
  const [projs, products, docs, equip, mats, systems, docByStatus, equipByStatus, recentDocs] = await Promise.all([
    query('SELECT COUNT(*) FROM projects'),
    query('SELECT COUNT(*) FROM product_masters'),
    query('SELECT COUNT(*) FROM documents'),
    query('SELECT COUNT(*) FROM equipment_instances'),
    query('SELECT COUNT(*) FROM materials'),
    query('SELECT COUNT(*) FROM systems'),
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
    document_by_status: docByStatus.rows,
    equipment_by_status: equipByStatus.rows,
    recent_documents: recentDocs.rows,
  });
});

export default router;
