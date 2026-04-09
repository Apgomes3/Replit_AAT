import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const STAGES = ['draft', 'pending_approval', 'purchase_order', 'po_review', 'engineering_review', 'released'];

function nextStage(current: string): string | null {
  const idx = STAGES.indexOf(current);
  if (idx === -1 || idx >= STAGES.length - 1) return null;
  if (current === 'draft') return null;
  return STAGES[idx + 1];
}

function canTransition(role: string): boolean {
  return ['admin', 'engineer', 'hq_manager'].includes(role);
}

async function isDesignated(poId: string, userId: string): Promise<boolean> {
  const r = await query('SELECT 1 FROM po_designated_users WHERE po_id=$1 AND user_id=$2', [poId, userId]);
  return r.rows.length > 0;
}

// USERS LIST (for designated-user picker, accessible to all roles)
router.get('/purchase-orders/users', authenticate, async (_req: AuthRequest, res: Response) => {
  const r = await query(
    `SELECT id, first_name, last_name, email, role FROM users WHERE is_active=true ORDER BY first_name, last_name`,
    []
  );
  res.json({ items: r.rows });
});

// SYSTEMS SEARCH (for system linking, accessible to all roles)
router.get('/purchase-orders/systems-search', authenticate, async (req: AuthRequest, res: Response) => {
  const { q = '', page_size = '50' } = req.query as any;
  const r = await query(
    `SELECT s.id, s.system_code, s.system_name, p.project_code FROM systems s JOIN projects p ON s.project_id=p.id
     WHERE s.system_code ILIKE $1 OR s.system_name ILIKE $1 ORDER BY s.system_code LIMIT $2`,
    [`%${q}%`, parseInt(page_size)]
  );
  res.json({ items: r.rows });
});

// LIST
router.get('/purchase-orders', authenticate, async (req: AuthRequest, res: Response) => {
  const { status, project_id, q, page = '1', page_size = '50' } = req.query as any;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  const conditions: string[] = [];
  const params: any[] = [];
  let p = 1;
  if (status) { conditions.push(`po.status = $${p++}`); params.push(status); }
  if (project_id) { conditions.push(`po.project_id = $${p++}`); params.push(project_id); }
  if (q) { conditions.push(`(po.po_code ILIKE $${p} OR proj.project_name ILIKE $${p})`); params.push(`%${q}%`); p++; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRes = await query(
    `SELECT COUNT(*) FROM purchase_orders po LEFT JOIN projects proj ON po.project_id=proj.id ${where}`,
    params
  );
  const rows = await query(
    `SELECT po.id, po.po_code, po.status, po.notes, po.created_at, po.updated_at,
      proj.project_code, proj.project_name,
      u.first_name || ' ' || u.last_name AS created_by_name,
      a.first_name || ' ' || a.last_name AS approved_by_name,
      po.approved_at,
      (SELECT COUNT(*) FROM po_items WHERE po_id=po.id) AS item_count
     FROM purchase_orders po
     LEFT JOIN projects proj ON po.project_id=proj.id
     LEFT JOIN users u ON po.created_by=u.id
     LEFT JOIN users a ON po.approved_by=a.id
     ${where}
     ORDER BY po.created_at DESC
     LIMIT $${p} OFFSET $${p+1}`,
    [...params, parseInt(page_size), offset]
  );
  res.json({ items: rows.rows, pagination: { total: parseInt(countRes.rows[0].count), page: parseInt(page), page_size: parseInt(page_size) } });
});

// CREATE
router.post('/purchase-orders', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, notes, system_ids } = req.body;
  const user = req.user!;
  const yearSeq = await query(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('po_code_seq') AS seq`);
  const { yr, seq } = yearSeq.rows[0];
  const po_code = `PO-${yr}-${String(seq).padStart(4, '0')}`;
  const initialStatus = user.role === 'hq_manager' ? 'purchase_order' : 'draft';
  const approved_by = user.role === 'hq_manager' ? user.id : null;
  const approved_at = user.role === 'hq_manager' ? 'now()' : null;

  let poRes;
  if (user.role === 'hq_manager') {
    poRes = await query(
      `INSERT INTO purchase_orders (po_code, project_id, status, notes, created_by, approved_by, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING *`,
      [po_code, project_id || null, initialStatus, notes || null, user.id, approved_by]
    );
  } else {
    poRes = await query(
      `INSERT INTO purchase_orders (po_code, project_id, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [po_code, project_id || null, initialStatus, notes || null, user.id]
    );
  }
  const po = poRes.rows[0];

  if (Array.isArray(system_ids) && system_ids.length) {
    for (const sid of system_ids) {
      await query('INSERT INTO po_systems (po_id,system_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [po.id, sid]);
    }
  }

  await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,null,$2,$3,$4)`,
    [po.id, initialStatus, user.id, user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'PO created']
  );

  res.status(201).json(po);
});

// DETAIL
router.get('/purchase-orders/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const poRes = await query(
    `SELECT po.*, proj.project_code, proj.project_name,
      u.first_name || ' ' || u.last_name AS created_by_name,
      u.email AS created_by_email,
      a.first_name || ' ' || a.last_name AS approved_by_name
     FROM purchase_orders po
     LEFT JOIN projects proj ON po.project_id=proj.id
     LEFT JOIN users u ON po.created_by=u.id
     LEFT JOIN users a ON po.approved_by=a.id
     WHERE po.id=$1`,
    [id]
  );
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const po = poRes.rows[0];

  const [items, systems, history, designated] = await Promise.all([
    query(
      `SELECT pi.*, pm.product_code, pm.product_name,
              s.system_code, s.system_name
       FROM po_items pi
       LEFT JOIN product_masters pm ON pi.product_master_id=pm.id
       LEFT JOIN systems s ON pi.system_id=s.id
       WHERE pi.po_id=$1 ORDER BY pi.sort_order, pi.created_at`,
      [id]
    ),
    query(
      `SELECT s.id, s.system_code, s.system_name FROM po_systems ps JOIN systems s ON ps.system_id=s.id WHERE ps.po_id=$1`,
      [id]
    ),
    query(
      `SELECT plh.*, u.first_name || ' ' || u.last_name AS actor_name
       FROM po_lifecycle_history plh LEFT JOIN users u ON plh.changed_by=u.id
       WHERE plh.po_id=$1 ORDER BY plh.changed_at DESC`,
      [id]
    ),
    query(
      `SELECT pdu.user_id, u.first_name || ' ' || u.last_name AS full_name, u.email, u.role
       FROM po_designated_users pdu JOIN users u ON pdu.user_id=u.id WHERE pdu.po_id=$1`,
      [id]
    ),
  ]);

  res.json({
    ...po,
    items: items.rows,
    systems: systems.rows,
    history: history.rows,
    designated_users: designated.rows,
  });
});

// UPDATE (draft only)
router.put('/purchase-orders/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { project_id, notes, system_ids } = req.body;
  const existing = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  if (existing.rows[0].status !== 'draft') return res.status(400).json({ error: { code: 'LOCKED', message: 'Only draft POs can be edited' } });

  await query(
    `UPDATE purchase_orders SET project_id=$1, notes=$2, updated_at=now() WHERE id=$3`,
    [project_id || null, notes || null, id]
  );
  if (Array.isArray(system_ids)) {
    await query('DELETE FROM po_systems WHERE po_id=$1', [id]);
    for (const sid of system_ids) {
      await query('INSERT INTO po_systems (po_id,system_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, sid]);
    }
  }
  res.json({ ok: true });
});

// SUBMIT for approval
router.post('/purchase-orders/:id/submit', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const po = poRes.rows[0];
  if (po.status !== 'draft') return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is not in draft' } });

  const newStatus = user.role === 'hq_manager' ? 'purchase_order' : 'pending_approval';
  const approvedBy = user.role === 'hq_manager' ? user.id : null;

  if (user.role === 'hq_manager') {
    await query(`UPDATE purchase_orders SET status=$1, approved_by=$2, approved_at=now(), updated_at=now() WHERE id=$3`, [newStatus, approvedBy, id]);
  } else {
    await query(`UPDATE purchase_orders SET status=$1, updated_at=now() WHERE id=$2`, [newStatus, id]);
  }
  await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`,
    [id, 'draft', newStatus, user.id, user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'Submitted for approval']
  );
  res.json({ status: newStatus });
});

// APPROVE
router.post('/purchase-orders/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body;
  const user = req.user!;
  if (user.role !== 'hq_manager' && user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only HQ managers or admins can approve POs' } });
  }
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  if (poRes.rows[0].status !== 'pending_approval') {
    return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is not pending approval' } });
  }
  await query(
    `UPDATE purchase_orders SET status='purchase_order', approved_by=$1, approved_at=now(), updated_at=now() WHERE id=$2`,
    [user.id, id]
  );
  await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`,
    [id, 'pending_approval', 'purchase_order', user.id, comment || 'Approved']
  );
  res.json({ status: 'purchase_order' });
});

// REJECT (send back to draft)
router.post('/purchase-orders/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body;
  const user = req.user!;
  if (user.role !== 'hq_manager' && user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only HQ managers or admins can reject POs' } });
  }
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const fromStatus = poRes.rows[0].status;
  await query(`UPDATE purchase_orders SET status='draft', updated_at=now() WHERE id=$1`, [id]);
  await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,'draft',$3,$4)`,
    [id, fromStatus, user.id, comment || 'Sent back for corrections']
  );
  res.json({ status: 'draft' });
});

// TRANSITION (advance to next stage)
router.post('/purchase-orders/:id/transition', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body;
  const user = req.user!;
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const po = poRes.rows[0];

  const allowed = canTransition(user.role) || await isDesignated(id, user.id);
  if (!allowed) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised to transition this PO' } });

  if (['draft', 'pending_approval'].includes(po.status)) {
    return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Submit or approve this PO before advancing stages' } });
  }
  const next = nextStage(po.status);
  if (!next) return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is already at the final stage' } });

  await query(`UPDATE purchase_orders SET status=$1, updated_at=now() WHERE id=$2`, [next, id]);
  await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`,
    [id, po.status, next, user.id, comment || null]
  );
  res.json({ status: next });
});

// ADD ITEM
router.post('/purchase-orders/:id/items', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { product_master_id, quantity, cost_price, sell_price, currency, notes, system_id } = req.body;
  const poRes = await query('SELECT status FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  if (poRes.rows[0].status !== 'draft') return res.status(400).json({ error: { code: 'LOCKED', message: 'Items can only be added to draft POs' } });

  const maxSort = await query('SELECT COALESCE(MAX(sort_order),0) AS m FROM po_items WHERE po_id=$1', [id]);
  const sortOrder = parseInt(maxSort.rows[0].m) + 10;

  const r = await query(
    `INSERT INTO po_items (po_id,product_master_id,quantity,cost_price,sell_price,currency,notes,sort_order,system_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, product_master_id || null, quantity || 1, cost_price || null, sell_price || null, currency || 'USD', notes || null, sortOrder, system_id || null]
  );
  res.status(201).json(r.rows[0]);
});

// UPDATE ITEM
router.put('/purchase-orders/:id/items/:itemId', authenticate, async (req: AuthRequest, res: Response) => {
  const { id, itemId } = req.params;
  const { quantity, cost_price, sell_price, currency, notes, system_id } = req.body;
  const poRes = await query('SELECT status FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  if (poRes.rows[0].status !== 'draft') return res.status(400).json({ error: { code: 'LOCKED', message: 'Items can only be edited on draft POs' } });

  const r = await query(
    `UPDATE po_items SET quantity=$1,cost_price=$2,sell_price=$3,currency=$4,notes=$5,system_id=$6 WHERE id=$7 AND po_id=$8 RETURNING *`,
    [quantity, cost_price || null, sell_price || null, currency || 'USD', notes || null, system_id || null, itemId, id]
  );
  res.json(r.rows[0]);
});

// DELETE ITEM
router.delete('/purchase-orders/:id/items/:itemId', authenticate, async (req: AuthRequest, res: Response) => {
  const { id, itemId } = req.params;
  const poRes = await query('SELECT status FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  if (poRes.rows[0].status !== 'draft') return res.status(400).json({ error: { code: 'LOCKED', message: 'Items can only be removed from draft POs' } });
  await query('DELETE FROM po_items WHERE id=$1 AND po_id=$2', [itemId, id]);
  res.json({ ok: true });
});

// ADD DESIGNATED USER
router.post('/purchase-orders/:id/designated-users', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.body;
  const user = req.user!;
  if (!canTransition(user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
  await query('INSERT INTO po_designated_users (po_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, user_id]);
  res.json({ ok: true });
});

// REMOVE DESIGNATED USER
router.delete('/purchase-orders/:id/designated-users/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  const { id, userId } = req.params;
  const user = req.user!;
  if (!canTransition(user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
  await query('DELETE FROM po_designated_users WHERE po_id=$1 AND user_id=$2', [id, userId]);
  res.json({ ok: true });
});

export default router;
