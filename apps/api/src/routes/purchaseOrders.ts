import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query, withTransaction } from '../db';
import { authenticate, requireModuleAccess, AuthRequest } from '../middleware/auth';
import { createNotification, emitNotification } from '../db/notifications';
import { logAudit } from '../db/audit';
import { versionMatches, versionConflict, withVersion } from '../lib/concurrency';
import { createKeyError, findCreateRetry } from '../lib/createIdempotency';

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const uploadDoc = multer({ storage: docStorage, limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();
router.use(authenticate, requireModuleAccess('orders'));

async function notifyPOFollowers(
  historyId: string, poId: string, actorId: string, title: string, body: string,
  recipientIds: string[] = [], type = 'po_transitioned',
) {
  await withTransaction(db => emitNotification(db, {
    eventKey: `po-transition:${historyId}`,
    type,
    title,
    body,
    entityType: 'purchase_order',
    entityId: poId,
    actorId,
    recipientIds,
  }));
}

const STAGES = ['draft', 'pending_approval', 'purchase_order', 'po_review', 'engineering_review', 'released'];

function humanizeStatus(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function statusChangeSummary(from: string | null | undefined, to: string): string {
  return `Status changed from ${humanizeStatus(from)} → ${humanizeStatus(to)}`;
}

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

// Roles that may perform PO management actions (assign users, set due dates, update procurement meta, etc.)
function canTransition(role: string): boolean {
  return ['admin', 'engineer', 'hq_manager'].includes(role);
}

// ─── Procurement field allowlists ────────────────────────────────────────────
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_UOMS = new Set(['EA', 'm', 'kg', 'm²', 'm³', 'L', 'pcs', 'set', 'pack', 'roll', 'lot', 'hr']);

function validateProcurementFields(fields: {
  priority?: string | null;
  vendor_name?: string | null;
  payment_terms?: string | null;
  shipping_terms?: string | null;
  required_by_date?: string | null;
}): string | null {
  if (fields.priority != null && !VALID_PRIORITIES.has(fields.priority)) {
    return `Invalid priority "${fields.priority}". Must be one of: ${[...VALID_PRIORITIES].join(', ')}.`;
  }
  if (fields.vendor_name != null && fields.vendor_name.length > 255) {
    return 'Vendor name must be 255 characters or fewer.';
  }
  if (fields.payment_terms != null && fields.payment_terms.length > 100) {
    return 'Payment terms must be 100 characters or fewer.';
  }
  if (fields.shipping_terms != null && fields.shipping_terms.length > 100) {
    return 'Shipping terms must be 100 characters or fewer.';
  }
  if (fields.required_by_date != null) {
    const d = new Date(fields.required_by_date);
    if (isNaN(d.getTime())) return 'required_by_date must be a valid ISO date (YYYY-MM-DD) or null.';
  }
  return null;
}

function validateItemFields(fields: { uom?: string | null; quantity?: any; cost_price?: any }): string | null {
  if (fields.uom != null && !VALID_UOMS.has(fields.uom)) {
    return `Invalid UOM "${fields.uom}". Must be one of: ${[...VALID_UOMS].join(', ')}.`;
  }
  if (fields.quantity !== undefined) {
    const q = parseFloat(String(fields.quantity));
    if (isNaN(q) || q <= 0) return 'Quantity must be a positive number.';
  }
  if (fields.cost_price !== undefined && fields.cost_price !== null && fields.cost_price !== '') {
    const c = parseFloat(String(fields.cost_price));
    if (isNaN(c) || c < 0) return 'Cost price must be a non-negative number.';
  }
  return null;
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

// EXCHANGE RATES — the app's own rates (Admin › Exchange Rates, units per 1 USD), the same source every
// other module uses. Replaces the former live Frankfurter feed (decided 2026-11-12). Currencies without
// a rate are omitted so the screen shows "—" instead of a guessed conversion.
router.get('/purchase-orders/exchange-rates', authenticate, async (_req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT currency_code, rate_per_usd::float AS rate, updated_at FROM platform_exchange_rates WHERE rate_per_usd IS NOT NULL`,
  );
  const rates = Object.fromEntries(result.rows.map((r: any) => [r.currency_code, r.rate]));
  const latest = result.rows.reduce((max: Date | null, r: any) => (!max || r.updated_at > max ? r.updated_at : max), null);
  res.json({ rates, date: latest ? new Date(latest).toISOString().slice(0, 10) : null, source: 'app' });
});

// VENDOR SEARCH (known vendors from visible purchase orders)
router.get('/purchase-orders/vendors', authenticate, async (req: AuthRequest, res: Response) => {
  const search = String(req.query.q || '').trim();
  const visRes = await query('SELECT can_see_all_pos FROM users WHERE id=$1', [req.user!.id]);
  const canSeeAll = visRes.rows[0]?.can_see_all_pos ?? false;

  const conditions = [
    'po.vendor_name IS NOT NULL',
    "BTRIM(po.vendor_name) <> ''",
    'po.vendor_name ILIKE $1',
  ];
  const params: any[] = [`%${search}%`];

  if (!canSeeAll) {
    conditions.push(`(
      po.created_by = $2
      OR EXISTS (SELECT 1 FROM po_designated_users pdu WHERE pdu.po_id=po.id AND pdu.user_id=$2)
      OR EXISTS (SELECT 1 FROM po_stage_assignees psa WHERE psa.stage=po.status AND psa.user_id=$2)
    )`);
    params.push(req.user!.id);
  }

  const vendors = await query(
    `SELECT DISTINCT BTRIM(po.vendor_name) AS vendor_name
     FROM purchase_orders po
     WHERE ${conditions.join(' AND ')}
     ORDER BY vendor_name
     LIMIT 20`,
    params
  );
  res.json({ items: vendors.rows });
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

  // Visibility: check if user can see all POs or only their own/relevant ones
  const visRes = await query('SELECT can_see_all_pos FROM users WHERE id=$1', [req.user!.id]);
  const canSeeAll = visRes.rows[0]?.can_see_all_pos ?? false;
  if (!canSeeAll) {
    conditions.push(`(
      po.created_by = $${p}
      OR EXISTS (SELECT 1 FROM po_designated_users pdu WHERE pdu.po_id=po.id AND pdu.user_id=$${p})
      OR EXISTS (SELECT 1 FROM po_stage_assignees psa WHERE psa.stage=po.status AND psa.user_id=$${p})
    )`);
    params.push(req.user!.id); p++;
  }

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
    `SELECT po.id, po.po_code, po.status, po.notes, po.created_at, po.updated_at, po.xmin::text AS version,
      proj.project_code, proj.project_name,
      u.first_name || ' ' || u.last_name AS created_by_name,
      a.first_name || ' ' || a.last_name AS approved_by_name,
      po.approved_at, po.stage_due_date, po.fo_number,
      po.vendor_name, po.required_by_date, po.payment_terms, po.shipping_terms, po.priority,
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
  res.json({ items: rows.rows.map(withVersion), pagination: { total: parseInt(countRes.rows[0].count), page: parseInt(page), page_size: parseInt(page_size) } });
});

// CREATE
router.post('/purchase-orders', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, notes, system_ids, vendor_name, required_by_date, payment_terms, shipping_terms, priority, idempotency_key } = req.body || {};
  const user = req.user!;
  if (createKeyError(idempotency_key)) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: createKeyError(idempotency_key) } });
  const procError = validateProcurementFields({ priority, vendor_name, payment_terms, shipping_terms, required_by_date });
  if (procError) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: procError } });
  try {
    const result = await withTransaction(async db => {
      const existing = await findCreateRetry(db, 'purchase_orders', user.id, idempotency_key || null);
      if (existing) return { po: existing, replayed: true };
      const yearSeq = await db.query(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('po_code_seq') AS seq`);
      const { yr, seq } = yearSeq.rows[0];
      const po_code = `PO-${yr}-${String(seq).padStart(4, '0')}`;
      const initialStatus = user.role === 'hq_manager' ? 'purchase_order' : 'draft';
      const approved_by = user.role === 'hq_manager' ? user.id : null;

      let poRes;
      if (user.role === 'hq_manager') {
        poRes = await db.query(
          `INSERT INTO purchase_orders (po_code, project_id, status, notes, created_by, approved_by, approved_at, vendor_name, required_by_date, payment_terms, shipping_terms, priority, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12) RETURNING *`,
          [po_code, project_id || null, initialStatus, notes || null, user.id, approved_by,
            vendor_name || null, required_by_date || null, payment_terms || null, shipping_terms || null, priority || 'normal', idempotency_key || null]
        );
      } else {
        poRes = await db.query(
          `INSERT INTO purchase_orders (po_code, project_id, status, notes, created_by, vendor_name, required_by_date, payment_terms, shipping_terms, priority, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [po_code, project_id || null, initialStatus, notes || null, user.id,
            vendor_name || null, required_by_date || null, payment_terms || null, shipping_terms || null, priority || 'normal', idempotency_key || null]
        );
      }
      const po = poRes.rows[0];

      if (Array.isArray(system_ids) && system_ids.length) {
        for (const sid of system_ids) {
          await db.query('INSERT INTO po_systems (po_id,system_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [po.id, sid]);
        }
      }
      await db.query(
        `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,null,$2,$3,$4)`,
        [po.id, initialStatus, user.id, user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'PO created']
      );
      return { po, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result.po);
  } catch (error) {
    res.status(500).json({ error: { code: 'CREATE_FAILED', message: 'Could not create purchase order.' } });
  }
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
    `INSERT INTO purchase_orders (po_code,project_id,status,notes,created_by,vendor_name,required_by_date,payment_terms,shipping_terms,priority)
     VALUES ($1,$2,'draft',$3,$4,$5,NULL,$6,$7,$8) RETURNING *`,
    [
      po_code,
      src.project_id,
      src.notes ? `[Clone of ${src.po_code}] ${src.notes}` : `[Clone of ${src.po_code}]`,
      user.id,
      src.vendor_name,
      src.payment_terms,
      src.shipping_terms,
      src.priority,
    ]
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
    `SELECT po.*, po.xmin::text AS version, proj.project_code, proj.project_name,
      u.first_name || ' ' || u.last_name AS created_by_name,
      u.email AS created_by_email,
      a.first_name || ' ' || a.last_name AS approved_by_name
     FROM purchase_orders po
     LEFT JOIN projects proj ON po.project_id=proj.id
     LEFT JOIN users u ON po.created_by=u.id
     LEFT JOIN users a ON po.approved_by=a.id
     JOIN users viewer ON viewer.id=$2
     WHERE po.id=$1 AND (viewer.can_see_all_pos OR po.created_by=$2
       OR EXISTS (SELECT 1 FROM po_designated_users d WHERE d.po_id=po.id AND d.user_id=$2)
       OR EXISTS (SELECT 1 FROM po_stage_assignees a WHERE a.stage=po.status AND a.user_id=$2))`,
    [id, req.user!.id]
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
    ...withVersion(po),
    items: items.rows,
    systems: systems.rows,
    history: history.rows,
    designated_users: designated.rows,
  });
});

// UPDATE (draft only)
router.put('/purchase-orders/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { project_id, notes, system_ids, vendor_name, required_by_date, payment_terms, shipping_terms, priority } = req.body;
  const procError = validateProcurementFields({ priority, vendor_name, payment_terms, shipping_terms, required_by_date });
  if (procError) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: procError } });
  let updated: any;
  try {
    updated = await withTransaction(async db => {
      const existing = (await db.query('SELECT *, xmin::text AS version FROM purchase_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!existing) throw Object.assign(new Error('PO not found'), { status: 404, code: 'NOT_FOUND' });
      if (req.body?.expected_version !== undefined && !versionMatches(existing, req.body.expected_version)) {
        throw Object.assign(new Error('Purchase order has changed.'), { status: 409, code: 'VERSION_CONFLICT', current_record: existing });
      }
      if (existing.status !== 'draft') throw Object.assign(new Error('Only draft POs can be edited'), { status: 400, code: 'LOCKED' });
      const saved = (await db.query(
        `UPDATE purchase_orders SET project_id=$1, notes=$2, vendor_name=$3, required_by_date=$4, payment_terms=$5, shipping_terms=$6, priority=$7, updated_at=now() WHERE id=$8 RETURNING *, xmin::text AS version`,
        [project_id || null, notes || null, vendor_name || null, required_by_date || null, payment_terms || null, shipping_terms || null, priority || 'normal', id]
      )).rows[0];
      if (Array.isArray(system_ids)) {
        await db.query('DELETE FROM po_systems WHERE po_id=$1', [id]);
        for (const sid of system_ids) {
          await db.query('INSERT INTO po_systems (po_id,system_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, sid]);
        }
      }
      return saved;
    });
  } catch (error: any) {
    if (error.status === 409 && error.code === 'VERSION_CONFLICT') return res.status(409).json(versionConflict(error.current_record));
    if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    throw error;
  }
  await logAudit(req.user!.id, 'purchase_order', String(id), 'UPDATE', {
    summary: 'Purchase order details updated',
    project_id: project_id || null,
    vendor_name: vendor_name || null,
    required_by_date: required_by_date || null,
    priority: priority || 'normal',
  });
  res.json({ ok: true, version: withVersion(updated).version });
});

// PATCH PROCUREMENT META (vendor, dates, terms, priority — editable regardless of status)
router.patch('/purchase-orders/:id/procurement-meta', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  if (!canTransition(user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
  const { vendor_name, required_by_date, payment_terms, shipping_terms, priority } = req.body;
  const procError = validateProcurementFields({ priority, vendor_name, payment_terms, shipping_terms, required_by_date });
  if (procError) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: procError } });
  let updated: any;
  try {
    updated = await withTransaction(async db => {
      const existing = (await db.query('SELECT *, xmin::text AS version FROM purchase_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!existing) throw Object.assign(new Error('PO not found'), { status: 404, code: 'NOT_FOUND' });
      if (req.body?.expected_version !== undefined && !versionMatches(existing, req.body.expected_version)) {
        throw Object.assign(new Error('Purchase order has changed.'), { status: 409, code: 'VERSION_CONFLICT', current_record: existing });
      }
      return (await db.query(
        `UPDATE purchase_orders SET vendor_name=$1, required_by_date=$2, payment_terms=$3, shipping_terms=$4, priority=$5, updated_at=now() WHERE id=$6 RETURNING *, xmin::text AS version`,
        [vendor_name ?? null, required_by_date ?? null, payment_terms ?? null, shipping_terms ?? null, priority ?? 'normal', id]
      )).rows[0];
    });
  } catch (error: any) {
    if (error.status === 409 && error.code === 'VERSION_CONFLICT') return res.status(409).json(versionConflict(error.current_record));
    if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    throw error;
  }
  await logAudit(user.id, 'purchase_order', String(id), 'UPDATE', {
    summary: 'Procurement details updated',
    vendor_name: vendor_name ?? null,
    required_by_date: required_by_date ?? null,
    payment_terms: payment_terms ?? null,
    shipping_terms: shipping_terms ?? null,
    priority: priority ?? 'normal',
  });
  res.json({ ok: true, version: withVersion(updated).version });
});

// SUBMIT for approval
router.post('/purchase-orders/:id/submit', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const po = poRes.rows[0];
  if (po.status !== 'draft') return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is not in draft' } });

  // Stage gate validation
  const itemsRes = await query('SELECT id, cost_price FROM po_items WHERE po_id=$1', [id]);
  if (itemsRes.rows.length === 0) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'PO must have at least one item before submitting.' } });
  }
  const missingCost = itemsRes.rows.filter((r: any) => !r.cost_price || parseFloat(r.cost_price) === 0);
  if (missingCost.length > 0) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${missingCost.length} item(s) are missing a cost price. Set all costs before submitting.` } });
  }

  const newStatus = user.role === 'hq_manager' ? 'purchase_order' : 'pending_approval';
  const approvedBy = user.role === 'hq_manager' ? user.id : null;

  if (user.role === 'hq_manager') {
    await query(`UPDATE purchase_orders SET status=$1, approved_by=$2, approved_at=now(), stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$3`, [newStatus, approvedBy, id]);
  } else {
    await query(`UPDATE purchase_orders SET status=$1, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`, [newStatus, id]);
  }
  const followEvent = await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [id, 'draft', newStatus, user.id, user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'Submitted for approval']
  );
  await logAudit(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
    summary: statusChangeSummary('draft', newStatus),
    from: 'draft',
    to: newStatus,
    comment: user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'Submitted for approval',
  });
  if (newStatus === 'pending_approval') {
    const actorRes = await query('SELECT first_name, last_name FROM users WHERE id=$1', [user.id]);
    const actor = actorRes.rows[0];
    const actorName = actor ? `${actor.first_name} ${actor.last_name}`.trim() : user.email;
    const approvers = await query("SELECT id FROM users WHERE role IN ('admin','hq_manager') AND is_active=true AND id <> $1", [user.id]);
    await notifyPOFollowers(followEvent.rows[0].id, String(id), user.id, 'PO Pending Approval',
      `PO #${po.po_code} has been submitted for approval by ${actorName}.`,
      approvers.rows.map(row => row.id), 'po_submitted');
  } else {
    await notifyPOFollowers(followEvent.rows[0].id, String(id), user.id, 'PO Stage Updated',
      `PO #${po.po_code} moved to ${newStatus.replace(/_/g, ' ')}.`);
  }
  res.json({ status: newStatus });
});

// APPROVE
router.post('/purchase-orders/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body ?? {};
  const user = req.user!;
  // Check configured approvers; fall back to hq_manager/admin if none configured
  const approverRows = await query('SELECT user_id FROM po_stage_assignees WHERE stage=$1', ['pending_approval']);
  if (approverRows.rows.length > 0) {
    const allowed = approverRows.rows.some((r: any) => r.user_id === user.id);
    if (!allowed) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised to approve at this stage' } });
  } else {
    if (user.role !== 'hq_manager' && user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only HQ managers or admins can approve POs' } });
    }
  }
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  if (poRes.rows[0].status !== 'pending_approval') {
    return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is not pending approval' } });
  }
  await query(
    `UPDATE purchase_orders SET status='purchase_order', approved_by=$1, approved_at=now(), stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`,
    [user.id, id]
  );
  const followEvent = await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [id, 'pending_approval', 'purchase_order', user.id, comment || 'Approved']
  );
  await logAudit(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
    summary: statusChangeSummary('pending_approval', 'purchase_order'),
    from: 'pending_approval',
    to: 'purchase_order',
    comment: comment || 'Approved',
  });
  await notifyPOFollowers(followEvent.rows[0].id, String(id), user.id, 'PO Approved',
    `PO #${poRes.rows[0].po_code} has been approved.`, [poRes.rows[0].created_by].filter(Boolean), 'po_approved');
  res.json({ status: 'purchase_order' });
});

// REJECT (send back to draft)
router.post('/purchase-orders/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body ?? {};
  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'A rejection reason is required so the creator knows what to fix.' } });
  }
  const user = req.user!;
  const approverRows = await query('SELECT user_id FROM po_stage_assignees WHERE stage=$1', ['pending_approval']);
  if (approverRows.rows.length > 0) {
    const allowed = approverRows.rows.some((r: any) => r.user_id === user.id);
    if (!allowed) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised to reject at this stage' } });
  } else {
    if (user.role !== 'hq_manager' && user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only HQ managers or admins can reject POs' } });
    }
  }
  const poRes = await query('SELECT * FROM purchase_orders WHERE id=$1', [id]);
  if (!poRes.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
  const fromStatus = poRes.rows[0].status;
  await query(`UPDATE purchase_orders SET status='draft', updated_at=now() WHERE id=$1`, [id]);
  const followEvent = await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,'draft',$3,$4) RETURNING id`,
    [id, fromStatus, user.id, comment || 'Sent back for corrections']
  );
  await logAudit(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
    summary: statusChangeSummary(fromStatus, 'draft'),
    from: fromStatus,
    to: 'draft',
    comment: comment || 'Sent back for corrections',
  });
  await notifyPOFollowers(followEvent.rows[0].id, String(id), user.id, 'PO Sent Back for Corrections',
    `PO #${poRes.rows[0].po_code} was sent back for corrections${comment ? `: ${comment}` : '.'}`,
    [poRes.rows[0].created_by].filter(Boolean), 'po_rejected');
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

  // Stage gate validation
  const gateItems = await query('SELECT id, cost_price FROM po_items WHERE po_id=$1', [id]);
  if (gateItems.rows.length === 0) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'PO must have at least one item before advancing.' } });
  }
  const gateMissing = gateItems.rows.filter((r: any) => !r.cost_price || parseFloat(r.cost_price) === 0);
  if (gateMissing.length > 0) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${gateMissing.length} item(s) are missing a cost price. Set all costs before advancing.` } });
  }

  if (next === 'released') {
    const foSeq = await query(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('fo_code_seq') AS seq`);
    const { yr, seq } = foSeq.rows[0];
    const fo_number = `FO-${yr}-${String(seq).padStart(4, '0')}`;
    await query(`UPDATE purchase_orders SET status=$1, fo_number=$2, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$3`, [next, fo_number, id]);
  } else {
    await query(`UPDATE purchase_orders SET status=$1, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`, [next, id]);
  }
  const followEvent = await query(
    `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [id, po.status, next, user.id, comment || null]
  );
  await logAudit(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
    summary: statusChangeSummary(po.status, next),
    from: po.status,
    to: next,
    comment: comment || null,
  });
  await notifyPOFollowers(followEvent.rows[0].id, String(id), user.id, 'PO Stage Updated',
    `PO #${po.po_code} moved to ${next.replace(/_/g, ' ')}.`, [po.created_by].filter(Boolean));
  const updated = await query('SELECT fo_number FROM purchase_orders WHERE id=$1', [id]);
  res.json({ status: next, fo_number: updated.rows[0]?.fo_number ?? null });
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
      if (next === 'released') {
        const foSeq = await query(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('fo_code_seq') AS seq`);
        const { yr, seq } = foSeq.rows[0];
        const fo_number = `FO-${yr}-${String(seq).padStart(4, '0')}`;
        await query(`UPDATE purchase_orders SET status=$1, fo_number=$2, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$3`, [next, fo_number, id]);
      } else {
        await query(`UPDATE purchase_orders SET status=$1, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`, [next, id]);
      }
      const followEvent = await query(
        `INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [id, po.status, next, user.id, 'Bulk transition']
      );
      await logAudit(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
        summary: statusChangeSummary(po.status, next),
        from: po.status,
        to: next,
        comment: 'Bulk transition',
      });
      await notifyPOFollowers(followEvent.rows[0].id, String(id), user.id, 'PO Stage Updated',
        `PO #${po.po_code} moved to ${next.replace(/_/g, ' ')}.`, [po.created_by].filter(Boolean));
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
  const { product_master_id, quantity, cost_price, sell_price, currency, notes, system_id, project_equipment_item_id, tank_id, uom } = req.body;
  const itemError = validateItemFields({ uom, quantity, cost_price });
  if (itemError) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: itemError } });
  try {
    const item = await withTransaction(async db => {
      const po = (await db.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!po) throw Object.assign(new Error('PO not found'), { status: 404, code: 'NOT_FOUND' });
      if (po.status !== 'draft') throw Object.assign(new Error('Items can only be added to draft POs'), { status: 400, code: 'LOCKED' });
      const maxSort = await db.query('SELECT COALESCE(MAX(sort_order),0) AS m FROM po_items WHERE po_id=$1', [id]);
      const sortOrder = parseInt(maxSort.rows[0].m) + 10;
      const inserted = await db.query(
        `INSERT INTO po_items (po_id,product_master_id,quantity,cost_price,sell_price,currency,notes,sort_order,system_id,project_equipment_item_id,tank_id,uom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [id, product_master_id || null, quantity || 1, cost_price || null, sell_price || null, currency || 'USD', notes || null, sortOrder, system_id || null, project_equipment_item_id || null, tank_id || null, uom || 'EA']
      );
      const bumped = await db.query('UPDATE purchase_orders SET updated_at=now() WHERE id=$1 RETURNING xmin::text AS version', [id]);
      return { ...inserted.rows[0], version: bumped.rows[0]?.version };
    });
    res.status(201).json(item);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    throw error;
  }
});

// UPDATE ITEM
router.put('/purchase-orders/:id/items/:itemId', authenticate, async (req: AuthRequest, res: Response) => {
  const { id, itemId } = req.params;
  const { quantity, cost_price, sell_price, currency, notes, system_id, budget_amount, uom } = req.body;
  const itemError = validateItemFields({ uom, quantity, cost_price });
  if (itemError) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: itemError } });
  try {
    const saved = await withTransaction(async db => {
      const po = (await db.query('SELECT *, xmin::text AS version FROM purchase_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!po) throw Object.assign(new Error('PO not found'), { status: 404, code: 'NOT_FOUND' });
      if (req.body?.expected_version !== undefined && !versionMatches(po, req.body.expected_version)) {
        throw Object.assign(new Error('Purchase order has changed.'), { status: 409, code: 'VERSION_CONFLICT', current_record: po });
      }
      if (po.status !== 'draft') throw Object.assign(new Error('Items can only be edited on draft POs'), { status: 400, code: 'LOCKED' });
      const item = await db.query(
        `UPDATE po_items SET quantity=$1,cost_price=$2,sell_price=$3,currency=$4,notes=$5,system_id=$6,budget_amount=$7,uom=COALESCE($8, uom) WHERE id=$9 AND po_id=$10 RETURNING *`,
        [quantity, cost_price || null, sell_price || null, currency || 'USD', notes || null, system_id || null, budget_amount != null ? budget_amount : null, uom ?? null, itemId, id]
      );
      if (!item.rows[0]) throw Object.assign(new Error('PO item not found'), { status: 404, code: 'NOT_FOUND' });
      const bumped = await db.query('UPDATE purchase_orders SET updated_at=now() WHERE id=$1 RETURNING xmin::text AS version', [id]);
      return { ...item.rows[0], version: bumped.rows[0]?.version };
    });
    res.json(saved);
  } catch (error: any) {
    if (error.status === 409 && error.code === 'VERSION_CONFLICT') return res.status(409).json(versionConflict(error.current_record));
    if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    throw error;
  }
});

// DELETE ITEM
router.delete('/purchase-orders/:id/items/:itemId', authenticate, async (req: AuthRequest, res: Response) => {
  const { id, itemId } = req.params;
  try {
    await withTransaction(async db => {
      const po = (await db.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!po) throw Object.assign(new Error('PO not found'), { status: 404, code: 'NOT_FOUND' });
      if (po.status !== 'draft') throw Object.assign(new Error('Items can only be removed from draft POs'), { status: 400, code: 'LOCKED' });
      await db.query('DELETE FROM po_items WHERE id=$1 AND po_id=$2', [itemId, id]);
      await db.query('UPDATE purchase_orders SET updated_at=now() WHERE id=$1', [id]);
    });
    res.json({ ok: true });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    throw error;
  }
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
// These subresources include author/uploader identities; access must not depend
// on whether the caller happens to load the parent detail page first.
router.use(['/purchase-orders/:id/comments', '/purchase-orders/:id/attachments'], async (req: AuthRequest, res: Response, next) => {
  try {
    const visible = await query(
      `SELECT 1 FROM purchase_orders po JOIN users viewer ON viewer.id=$2
       WHERE po.id=$1 AND (viewer.can_see_all_pos OR po.created_by=$2
         OR EXISTS (SELECT 1 FROM po_designated_users d WHERE d.po_id=po.id AND d.user_id=$2)
         OR EXISTS (SELECT 1 FROM po_stage_assignees a WHERE a.stage=po.status AND a.user_id=$2))`,
      [req.params.id, req.user!.id],
    );
    if (!visible.rowCount) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    next();
  } catch (error) { next(error); }
});

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
