import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createNotification, notifyAdminsAndManagers } from '../db/notifications';

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const uploadDoc = multer({ storage: docStorage, limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();

const STAGES = ['draft', 'pending_approval', 'purchase_order', 'po_review', 'engineering_review', 'released'];

function nextStage(current: string): string | null {
  const idx = STAGES.indexOf(current);
  if (idx === -1 || idx >= STAGES.length - 1) return null;
  if (current === 'draft') return null;
  return STAGES[idx + 1];
}

async function isDesignated(poId: string, userId: string): Promise<boolean> {
  const r = await query('SELECT 1 FROM po_designated_users WHERE po_id=$1 AND user_id=$2', [poId, userId]);
  return r.rows.length > 0;
}

// Check whether a user may advance a PO from its current stage.
// purchase_order: creator OR hq_manager/admin OR in stage_assignees
// po_review / engineering_review: in stage_assignees only
async function canAdvanceStage(
  stage: string, userId: string, userRole: string, createdBy: string | null
): Promise<boolean> {
  if (stage === 'purchase_order') {
    if (userId === createdBy) return true;
    if (['hq_manager', 'admin'].includes(userRole)) return true;
  }
  const r = await query(
    'SELECT 1 FROM po_stage_assignees WHERE stage=$1 AND user_id=$2',
    [stage, userId]
  );
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

// EXCHANGE RATES PROXY — fetches live rates from Frankfurter server-side (no browser CORS issues)
router.get('/purchase-orders/exchange-rates', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=USD');
    if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
    const data = await response.json() as { rates: Record<string, number>; date: string };
    res.json({ rates: data.rates, date: data.date });
  } catch (err: any) {
    res.status(502).json({ error: 'Failed to fetch exchange rates', detail: err?.message });
  }
});

// SYSTEMS SEARCH (for system linking, accessible to all roles)
router.get('/purchase-orders/systems-search', authenticate, async (req: AuthRequest, res: Response) => {
  const { q = '', page_size = '50', project_id } = req.query as any;
  const conditions: string[] = [];
  const params: any[] = [];
  let p = 1;
  if (q) { conditions.push(`(s.system_code ILIKE $${p} OR s.system_name ILIKE $${p})`); params.push(`%${q}%`); p++; }
  if (project_id) { conditions.push(`s.project_id = $${p++}`); params.push(project_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const r = await query(
    `SELECT s.id, s.system_code, s.system_name, p.project_code FROM systems s JOIN projects p ON s.project_id=p.id
     ${where} ORDER BY s.system_code LIMIT $${p}`,
    [...params, parseInt(page_size)]
  );
  res.json({ items: r.rows });
});

// LIST
router.get('/purchase-orders', authenticate, async (req: AuthRequest, res: Response) => {
  const { status, project_id, q, mine, page = '1', page_size = '50' } = req.query as any;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  const conditions: string[] = [];
  const params: any[] = [];
  let p = 1;
  if (status) { conditions.push(`po.status = $${p++}`); params.push(status); }
  if (project_id) { conditions.push(`po.project_id = $${p++}`); params.push(project_id); }
  if (q) { conditions.push(`(po.po_code ILIKE $${p} OR proj.project_name ILIKE $${p})`); params.push(`%${q}%`); p++; }
  if (mine === 'true') { conditions.push(`(po.created_by = $${p} OR EXISTS (SELECT 1 FROM po_designated_users pdu WHERE pdu.po_id=po.id AND pdu.user_id=$${p}))`); params.push(req.user!.id); p++; }
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
      po.approved_at, po.stage_due_date,
      (SELECT COUNT(*) FROM po_items WHERE po_id=po.id) AS item_count,
      (SELECT COALESCE(SUM(CAST(pi.cost_price AS NUMERIC) * CAST(pi.quantity AS NUMERIC)), 0)
       FROM po_items pi WHERE pi.po_id=po.id) AS total_cost_usd
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

// CLONE
router.post('/purchase-orders/:id/clone', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const orig = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!orig.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const src = orig.rows[0];
  const yearSeq = await query(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('po_code_seq') AS seq`);
  const { yr, seq } = yearSeq.rows[0];
  const po_code = `PO-${yr}-${String(seq).padStart(4, '0')}`;
  const newPo = await query(
    `INSERT INTO purchase_orders (po_code,project_id,status,notes,created_by) VALUES ($1,$2,'draft',$3,$4) RETURNING *`,
    [po_code, src.project_id, src.notes ? `[Clone of ${src.po_code}] ${src.notes}` : `[Clone of ${src.po_code}]`, user.id]
  );
  const newId = newPo.rows[0].id;
  const items = await query('SELECT * FROM po_items WHERE po_id=$1 ORDER BY sort_order, created_at', [id]);
  for (const item of items.rows) {
    await query(
      `INSERT INTO po_items (po_id,product_master_id,quantity,cost_price,sell_price,currency,notes,sort_order,system_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [newId, item.product_master_id, item.quantity, item.cost_price, item.sell_price, item.currency, item.notes, item.sort_order, item.system_id]
    );
  }
  await query(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,null,'draft',$2,$3)`,
    [newId, user.id, `Cloned from ${src.po_code}`]);
  res.status(201).json(newPo.rows[0]);
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
  if (newStatus === 'pending_approval') {
    const actorRes = await query('SELECT first_name, last_name FROM users WHERE id=$1', [user.id]);
    const actor = actorRes.rows[0];
    const actorName = actor ? `${actor.first_name} ${actor.last_name}`.trim() : user.email;
    await notifyAdminsAndManagers({
      type: 'po_submitted',
      title: 'PO Pending Approval',
      body: `PO #${po.po_code} has been submitted for approval by ${actorName}.`,
      entityType: 'purchase_order',
      entityId: id,
      excludeUserId: user.id,
    });
  }
  res.json({ status: newStatus });
});

// APPROVE
router.post('/purchase-orders/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body ?? {};
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
  if (poRes.rows[0].created_by) {
    await createNotification({
      userId: poRes.rows[0].created_by,
      type: 'po_approved',
      title: 'PO Approved',
      body: `Your PO #${poRes.rows[0].po_code} has been approved.`,
      entityType: 'purchase_order',
      entityId: id,
    });
  }
  res.json({ status: 'purchase_order' });
});

// REJECT (send back to draft)
router.post('/purchase-orders/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body ?? {};
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
  if (poRes.rows[0].created_by) {
    await createNotification({
      userId: poRes.rows[0].created_by,
      type: 'po_rejected',
      title: 'PO Sent Back for Corrections',
      body: `Your PO #${poRes.rows[0].po_code} was sent back for corrections${comment ? `: ${comment}` : '.'}`,
      entityType: 'purchase_order',
      entityId: id,
    });
  }
  res.json({ status: 'draft' });
});

// STAGE ROLES — public read for inbox filtering (accessible to all authenticated users)
router.get('/purchase-orders/stage-roles', authenticate, async (_req: AuthRequest, res: Response) => {
  const r = await query(
    `SELECT psa.id, psa.stage, psa.user_id, u.first_name, u.last_name, u.email, u.role
     FROM po_stage_assignees psa JOIN users u ON u.id = psa.user_id ORDER BY psa.stage, u.first_name`,
    []
  );
  // Return as { stage: assignee[] } map
  const map: Record<string, any[]> = {};
  for (const row of r.rows) {
    if (!map[row.stage]) map[row.stage] = [];
    map[row.stage].push(row);
  }
  res.json(map);
});

// TRANSITION (advance to next stage)
router.post('/purchase-orders/:id/transition', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body ?? {};
  const user = req.user!;
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const po = poRes.rows[0];

  const allowed = await canAdvanceStage(po.status, user.id, user.role, po.created_by);
  if (!allowed) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised to advance this PO at this stage' } });

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
  if (po.created_by && po.created_by !== user.id) {
    await createNotification({
      userId: po.created_by,
      type: 'po_transitioned',
      title: 'PO Stage Updated',
      body: `Your PO #${po.po_code} has moved to stage: ${next.replace(/_/g, ' ')}.`,
      entityType: 'purchase_order',
      entityId: id,
    });
  }
  res.json({ status: next });
});

// BULK TRANSITION
router.post('/purchase-orders/bulk-transition', authenticate, async (req: AuthRequest, res: Response) => {
  const { ids } = req.body;
  const user = req.user!;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'No PO IDs provided' } });
  }
  const results: { id: string; po_code?: string; status?: string; error?: string }[] = [];
  for (const id of ids) {
    try {
      const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
      const po = poRes.rows[0];
      if (!po) { results.push({ id, error: 'Not found' }); continue; }
      const allowed = await canAdvanceStage(po.status, user.id, user.role, po.created_by);
      if (!allowed) { results.push({ id, po_code: po.po_code, error: 'Not authorised for this stage' }); continue; }
      if (['draft', 'pending_approval'].includes(po.status)) {
        results.push({ id, po_code: po.po_code, error: 'Submit or approve before transitioning' }); continue;
      }
      const next = nextStage(po.status);
      if (!next) { results.push({ id, po_code: po.po_code, error: 'Already at final stage' }); continue; }
      await query(`UPDATE purchase_orders SET status=$1, updated_at=now() WHERE id=$2`, [next, id]);
      await query(
        `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`,
        [id, po.status, next, user.id, 'Bulk transition']
      );
      if (po.created_by && po.created_by !== user.id) {
        await createNotification({
          userId: po.created_by,
          type: 'po_transitioned',
          title: 'PO Stage Updated',
          body: `Your PO #${po.po_code} has moved to stage: ${next.replace(/_/g, ' ')}.`,
          entityType: 'purchase_order',
          entityId: id,
        });
      }
      results.push({ id, po_code: po.po_code, status: next });
    } catch (e: any) {
      results.push({ id, error: e?.message || 'Failed' });
    }
  }
  res.json({ results });
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
  const { quantity, cost_price, sell_price, currency, notes, system_id, budget_amount } = req.body;
  const poRes = await query('SELECT status FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  if (poRes.rows[0].status !== 'draft') return res.status(400).json({ error: { code: 'LOCKED', message: 'Items can only be edited on draft POs' } });

  const r = await query(
    `UPDATE po_items SET quantity=$1,cost_price=$2,sell_price=$3,currency=$4,notes=$5,system_id=$6,budget_amount=$7 WHERE id=$8 AND po_id=$9 RETURNING *`,
    [quantity, cost_price || null, sell_price || null, currency || 'USD', notes || null, system_id || null, budget_amount != null ? budget_amount : null, itemId, id]
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

// BULK ASSIGN DESIGNATED USER
router.post('/purchase-orders/bulk-assign', authenticate, async (req: AuthRequest, res: Response) => {
  const { ids, userId } = req.body;
  const user = req.user!;
  if (!canTransition(user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
  if (!Array.isArray(ids) || ids.length === 0 || !userId) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'ids and userId are required' } });
  }
  const results: { id: string; po_code?: string; ok?: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      const poRes = await query('SELECT po_code FROM purchase_orders WHERE id=$1', [id]);
      if (!poRes.rows[0]) { results.push({ id, error: 'Not found' }); continue; }
      await query('INSERT INTO po_designated_users (po_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, userId]);
      await createNotification({
        userId,
        type: 'po_assigned',
        title: 'You have been assigned to a PO',
        body: `You have been assigned as a designated user on PO #${poRes.rows[0].po_code}.`,
        entityType: 'purchase_order',
        entityId: id,
      });
      results.push({ id, po_code: poRes.rows[0].po_code, ok: true });
    } catch (e: any) {
      results.push({ id, error: e?.message || 'Failed' });
    }
  }
  res.json({ results });
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

// COMMENTS — LIST
router.get('/purchase-orders/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const r = await query(
    `SELECT c.id, c.message, c.created_at,
       u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email, u.role AS author_role, c.user_id
     FROM po_comments c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.po_id = $1
     ORDER BY c.created_at ASC`,
    [id]
  );
  res.json({ items: r.rows });
});

// COMMENTS — ADD
router.post('/purchase-orders/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { message } = req.body;
  const user = req.user!;
  if (!message?.trim()) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Message is required' } });
  const r = await query(
    `INSERT INTO po_comments (po_id, user_id, message) VALUES ($1, $2, $3)
     RETURNING id, message, created_at`,
    [id, user.id, message.trim()]
  );
  res.status(201).json(r.rows[0]);
});

// COMMENTS — DELETE
router.delete('/purchase-orders/:id/comments/:commentId', authenticate, async (req: AuthRequest, res: Response) => {
  const { commentId } = req.params;
  const user = req.user!;
  const existing = await query('SELECT user_id FROM po_comments WHERE id=$1', [commentId]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } });
  if (existing.rows[0].user_id !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete another user\'s comment' } });
  }
  await query('DELETE FROM po_comments WHERE id=$1', [commentId]);
  res.json({ ok: true });
});

// ATTACHMENTS — LIST
router.get('/purchase-orders/:id/attachments', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const r = await query(
    `SELECT a.id, a.file_name, a.file_path, a.file_size, a.mime_type, a.created_at,
       u.first_name || ' ' || u.last_name AS uploader_name, a.uploaded_by
     FROM po_attachments a
     LEFT JOIN users u ON a.uploaded_by = u.id
     WHERE a.po_id = $1
     ORDER BY a.created_at ASC`,
    [id]
  );
  res.json({ items: r.rows });
});

// ATTACHMENTS — UPLOAD
router.post('/purchase-orders/:id/attachments', authenticate, uploadDoc.single('file'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file provided' } });
  const filePath = `/uploads/${req.file.filename}`;
  const r = await query(
    `INSERT INTO po_attachments (po_id, file_name, file_path, file_size, mime_type, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, req.file.originalname, filePath, req.file.size, req.file.mimetype, user.id]
  );
  res.status(201).json(r.rows[0]);
});

// ATTACHMENTS — DELETE
router.delete('/purchase-orders/:id/attachments/:attachmentId', authenticate, async (req: AuthRequest, res: Response) => {
  const { attachmentId } = req.params;
  const user = req.user!;
  const existing = await query('SELECT uploaded_by, file_path FROM po_attachments WHERE id=$1', [attachmentId]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
  if (existing.rows[0].uploaded_by !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete another user\'s attachment' } });
  }
  const filePath = path.join(__dirname, '../../', existing.rows[0].file_path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await query('DELETE FROM po_attachments WHERE id=$1', [attachmentId]);
  res.json({ ok: true });
});

// DUE DATE — SET
router.patch('/purchase-orders/:id/due-date', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { stage_due_date } = req.body;
  const user = req.user!;
  if (!canTransition(user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
  await query(
    'UPDATE purchase_orders SET stage_due_date=$1, updated_at=now() WHERE id=$2',
    [stage_due_date || null, id]
  );
  res.json({ ok: true });
});

// ATTACH DOCUMENT FILE
router.post('/purchase-orders/:id/document', authenticate, uploadDoc.single('document'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file provided' } });
  const docUrl = `/uploads/${req.file.filename}`;
  const docName = req.file.originalname;
  const result = await query(
    'UPDATE purchase_orders SET document_url=$1, document_name=$2, updated_at=NOW() WHERE id=$3 RETURNING id, document_url, document_name',
    [docUrl, docName, id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  res.json(result.rows[0]);
});

export default router;
