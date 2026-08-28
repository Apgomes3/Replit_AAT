"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const notifications_1 = require("../db/notifications");
const audit_1 = require("../db/audit");
const uploadDir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
const docStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const uploadDoc = (0, multer_1.default)({ storage: docStorage, limits: { fileSize: 20 * 1024 * 1024 } });
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('orders'));
const STAGES = ['draft', 'pending_approval', 'purchase_order', 'po_review', 'engineering_review', 'released'];
function humanizeStatus(status) {
    if (!status)
        return 'Unknown';
    return status.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
function statusChangeSummary(from, to) {
    return `Status changed from ${humanizeStatus(from)} → ${humanizeStatus(to)}`;
}
function nextStage(current) {
    const idx = STAGES.indexOf(current);
    if (idx === -1 || idx >= STAGES.length - 1)
        return null;
    if (current === 'draft')
        return null;
    return STAGES[idx + 1];
}
async function isDesignated(poId, userId) {
    const r = await (0, db_1.query)('SELECT 1 FROM po_designated_users WHERE po_id=$1 AND user_id=$2', [poId, userId]);
    return r.rows.length > 0;
}
// Roles that may perform PO management actions (assign users, set due dates, update procurement meta, etc.)
function canTransition(role) {
    return ['admin', 'engineer', 'hq_manager'].includes(role);
}
// ─── Procurement field allowlists ────────────────────────────────────────────
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_UOMS = new Set(['EA', 'm', 'kg', 'm²', 'm³', 'L', 'pcs', 'set', 'pack', 'roll', 'lot', 'hr']);
function validateProcurementFields(fields) {
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
        if (isNaN(d.getTime()))
            return 'required_by_date must be a valid ISO date (YYYY-MM-DD) or null.';
    }
    return null;
}
function validateItemFields(fields) {
    if (fields.uom != null && !VALID_UOMS.has(fields.uom)) {
        return `Invalid UOM "${fields.uom}". Must be one of: ${[...VALID_UOMS].join(', ')}.`;
    }
    if (fields.quantity !== undefined) {
        const q = parseFloat(String(fields.quantity));
        if (isNaN(q) || q <= 0)
            return 'Quantity must be a positive number.';
    }
    if (fields.cost_price !== undefined && fields.cost_price !== null && fields.cost_price !== '') {
        const c = parseFloat(String(fields.cost_price));
        if (isNaN(c) || c < 0)
            return 'Cost price must be a non-negative number.';
    }
    return null;
}
// Check whether a user may advance a PO from its current stage.
// purchase_order: creator OR hq_manager/admin OR in stage_assignees
// po_review / engineering_review: in stage_assignees only
async function canAdvanceStage(stage, userId, userRole, createdBy) {
    if (stage === 'purchase_order') {
        if (userId === createdBy)
            return true;
        if (['hq_manager', 'admin'].includes(userRole))
            return true;
    }
    const r = await (0, db_1.query)('SELECT 1 FROM po_stage_assignees WHERE stage=$1 AND user_id=$2', [stage, userId]);
    return r.rows.length > 0;
}
// USERS LIST (for designated-user picker, accessible to all roles)
router.get('/purchase-orders/users', auth_1.authenticate, async (_req, res) => {
    const r = await (0, db_1.query)(`SELECT id, first_name, last_name, email, role FROM users WHERE is_active=true ORDER BY first_name, last_name`, []);
    res.json({ items: r.rows });
});
// EXCHANGE RATES PROXY — fetches live rates from Frankfurter server-side (no browser CORS issues)
router.get('/purchase-orders/exchange-rates', auth_1.authenticate, async (_req, res) => {
    try {
        const response = await fetch('https://api.frankfurter.app/latest?from=USD');
        if (!response.ok)
            throw new Error(`Frankfurter returned ${response.status}`);
        const data = await response.json();
        res.json({ rates: data.rates, date: data.date });
    }
    catch (err) {
        res.status(502).json({ error: 'Failed to fetch exchange rates', detail: err?.message });
    }
});
// VENDOR SEARCH (known vendors from visible purchase orders)
router.get('/purchase-orders/vendors', auth_1.authenticate, async (req, res) => {
    const search = String(req.query.q || '').trim();
    const visRes = await (0, db_1.query)('SELECT can_see_all_pos FROM users WHERE id=$1', [req.user.id]);
    const canSeeAll = visRes.rows[0]?.can_see_all_pos ?? false;
    const conditions = [
        'po.vendor_name IS NOT NULL',
        "BTRIM(po.vendor_name) <> ''",
        'po.vendor_name ILIKE $1',
    ];
    const params = [`%${search}%`];
    if (!canSeeAll) {
        conditions.push(`(
      po.created_by = $2
      OR EXISTS (SELECT 1 FROM po_designated_users pdu WHERE pdu.po_id=po.id AND pdu.user_id=$2)
      OR EXISTS (SELECT 1 FROM po_stage_assignees psa WHERE psa.stage=po.status AND psa.user_id=$2)
    )`);
        params.push(req.user.id);
    }
    const vendors = await (0, db_1.query)(`SELECT DISTINCT BTRIM(po.vendor_name) AS vendor_name
     FROM purchase_orders po
     WHERE ${conditions.join(' AND ')}
     ORDER BY vendor_name
     LIMIT 20`, params);
    res.json({ items: vendors.rows });
});
// SYSTEMS SEARCH (for system linking, accessible to all roles)
router.get('/purchase-orders/systems-search', auth_1.authenticate, async (req, res) => {
    const { q = '', page_size = '50', project_id } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;
    if (q) {
        conditions.push(`(s.system_code ILIKE $${p} OR s.system_name ILIKE $${p})`);
        params.push(`%${q}%`);
        p++;
    }
    if (project_id) {
        conditions.push(`s.project_id = $${p++}`);
        params.push(project_id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await (0, db_1.query)(`SELECT s.id, s.system_code, s.system_name, p.project_code FROM systems s JOIN projects p ON s.project_id=p.id
     ${where} ORDER BY s.system_code LIMIT $${p}`, [...params, parseInt(page_size)]);
    res.json({ items: r.rows });
});
// LIST
router.get('/purchase-orders', auth_1.authenticate, async (req, res) => {
    const { status, project_id, q, mine, page = '1', page_size = '50' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const conditions = [];
    const params = [];
    let p = 1;
    // Visibility: check if user can see all POs or only their own/relevant ones
    const visRes = await (0, db_1.query)('SELECT can_see_all_pos FROM users WHERE id=$1', [req.user.id]);
    const canSeeAll = visRes.rows[0]?.can_see_all_pos ?? false;
    if (!canSeeAll) {
        conditions.push(`(
      po.created_by = $${p}
      OR EXISTS (SELECT 1 FROM po_designated_users pdu WHERE pdu.po_id=po.id AND pdu.user_id=$${p})
      OR EXISTS (SELECT 1 FROM po_stage_assignees psa WHERE psa.stage=po.status AND psa.user_id=$${p})
    )`);
        params.push(req.user.id);
        p++;
    }
    if (status) {
        conditions.push(`po.status = $${p++}`);
        params.push(status);
    }
    if (project_id) {
        conditions.push(`po.project_id = $${p++}`);
        params.push(project_id);
    }
    if (q) {
        conditions.push(`(po.po_code ILIKE $${p} OR proj.project_name ILIKE $${p})`);
        params.push(`%${q}%`);
        p++;
    }
    if (mine === 'true') {
        conditions.push(`(po.created_by = $${p} OR EXISTS (SELECT 1 FROM po_designated_users pdu WHERE pdu.po_id=po.id AND pdu.user_id=$${p}))`);
        params.push(req.user.id);
        p++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM purchase_orders po LEFT JOIN projects proj ON po.project_id=proj.id ${where}`, params);
    const rows = await (0, db_1.query)(`SELECT po.id, po.po_code, po.status, po.notes, po.created_at, po.updated_at,
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
     LIMIT $${p} OFFSET $${p + 1}`, [...params, parseInt(page_size), offset]);
    res.json({ items: rows.rows, pagination: { total: parseInt(countRes.rows[0].count), page: parseInt(page), page_size: parseInt(page_size) } });
});
// CREATE
router.post('/purchase-orders', auth_1.authenticate, async (req, res) => {
    const { project_id, notes, system_ids, vendor_name, required_by_date, payment_terms, shipping_terms, priority } = req.body;
    const user = req.user;
    const procError = validateProcurementFields({ priority, vendor_name, payment_terms, shipping_terms, required_by_date });
    if (procError)
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: procError } });
    const yearSeq = await (0, db_1.query)(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('po_code_seq') AS seq`);
    const { yr, seq } = yearSeq.rows[0];
    const po_code = `PO-${yr}-${String(seq).padStart(4, '0')}`;
    const initialStatus = user.role === 'hq_manager' ? 'purchase_order' : 'draft';
    const approved_by = user.role === 'hq_manager' ? user.id : null;
    let poRes;
    if (user.role === 'hq_manager') {
        poRes = await (0, db_1.query)(`INSERT INTO purchase_orders (po_code, project_id, status, notes, created_by, approved_by, approved_at, vendor_name, required_by_date, payment_terms, shipping_terms, priority)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11) RETURNING *`, [po_code, project_id || null, initialStatus, notes || null, user.id, approved_by,
            vendor_name || null, required_by_date || null, payment_terms || null, shipping_terms || null, priority || 'normal']);
    }
    else {
        poRes = await (0, db_1.query)(`INSERT INTO purchase_orders (po_code, project_id, status, notes, created_by, vendor_name, required_by_date, payment_terms, shipping_terms, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [po_code, project_id || null, initialStatus, notes || null, user.id,
            vendor_name || null, required_by_date || null, payment_terms || null, shipping_terms || null, priority || 'normal']);
    }
    const po = poRes.rows[0];
    if (Array.isArray(system_ids) && system_ids.length) {
        for (const sid of system_ids) {
            await (0, db_1.query)('INSERT INTO po_systems (po_id,system_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [po.id, sid]);
        }
    }
    await (0, db_1.query)(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,null,$2,$3,$4)`, [po.id, initialStatus, user.id, user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'PO created']);
    res.status(201).json(po);
});
// CLONE
router.post('/purchase-orders/:id/clone', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    const orig = await (0, db_1.query)('SELECT * FROM purchase_orders WHERE id=$1', [id]);
    if (!orig.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    const src = orig.rows[0];
    const yearSeq = await (0, db_1.query)(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('po_code_seq') AS seq`);
    const { yr, seq } = yearSeq.rows[0];
    const po_code = `PO-${yr}-${String(seq).padStart(4, '0')}`;
    const newPo = await (0, db_1.query)(`INSERT INTO purchase_orders (po_code,project_id,status,notes,created_by,vendor_name,required_by_date,payment_terms,shipping_terms,priority)
     VALUES ($1,$2,'draft',$3,$4,$5,NULL,$6,$7,$8) RETURNING *`, [
        po_code,
        src.project_id,
        src.notes ? `[Clone of ${src.po_code}] ${src.notes}` : `[Clone of ${src.po_code}]`,
        user.id,
        src.vendor_name,
        src.payment_terms,
        src.shipping_terms,
        src.priority,
    ]);
    const newId = newPo.rows[0].id;
    const items = await (0, db_1.query)('SELECT * FROM po_items WHERE po_id=$1 ORDER BY sort_order, created_at', [id]);
    for (const item of items.rows) {
        await (0, db_1.query)(`INSERT INTO po_items (po_id,product_master_id,quantity,cost_price,sell_price,currency,notes,sort_order,system_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [newId, item.product_master_id, item.quantity, item.cost_price, item.sell_price, item.currency, item.notes, item.sort_order, item.system_id]);
    }
    await (0, db_1.query)(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,null,'draft',$2,$3)`, [newId, user.id, `Cloned from ${src.po_code}`]);
    res.status(201).json(newPo.rows[0]);
});
// DETAIL
router.get('/purchase-orders/:id', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const poRes = await (0, db_1.query)(`SELECT po.*, proj.project_code, proj.project_name,
      u.first_name || ' ' || u.last_name AS created_by_name,
      u.email AS created_by_email,
      a.first_name || ' ' || a.last_name AS approved_by_name
     FROM purchase_orders po
     LEFT JOIN projects proj ON po.project_id=proj.id
     LEFT JOIN users u ON po.created_by=u.id
     LEFT JOIN users a ON po.approved_by=a.id
     WHERE po.id=$1`, [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    const po = poRes.rows[0];
    const [items, systems, history, designated] = await Promise.all([
        (0, db_1.query)(`SELECT pi.*, pm.product_code, pm.product_name,
              s.system_code, s.system_name
       FROM po_items pi
       LEFT JOIN product_masters pm ON pi.product_master_id=pm.id
       LEFT JOIN systems s ON pi.system_id=s.id
       WHERE pi.po_id=$1 ORDER BY pi.sort_order, pi.created_at`, [id]),
        (0, db_1.query)(`SELECT s.id, s.system_code, s.system_name FROM po_systems ps JOIN systems s ON ps.system_id=s.id WHERE ps.po_id=$1`, [id]),
        (0, db_1.query)(`SELECT plh.*, u.first_name || ' ' || u.last_name AS actor_name
       FROM po_lifecycle_history plh LEFT JOIN users u ON plh.changed_by=u.id
       WHERE plh.po_id=$1 ORDER BY plh.changed_at DESC`, [id]),
        (0, db_1.query)(`SELECT pdu.user_id, u.first_name || ' ' || u.last_name AS full_name, u.email, u.role
       FROM po_designated_users pdu JOIN users u ON pdu.user_id=u.id WHERE pdu.po_id=$1`, [id]),
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
router.put('/purchase-orders/:id', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { project_id, notes, system_ids, vendor_name, required_by_date, payment_terms, shipping_terms, priority } = req.body;
    const procError = validateProcurementFields({ priority, vendor_name, payment_terms, shipping_terms, required_by_date });
    if (procError)
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: procError } });
    const existing = await (0, db_1.query)('SELECT * FROM purchase_orders WHERE id=$1', [id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    if (existing.rows[0].status !== 'draft')
        return res.status(400).json({ error: { code: 'LOCKED', message: 'Only draft POs can be edited' } });
    await (0, db_1.query)(`UPDATE purchase_orders SET project_id=$1, notes=$2, vendor_name=$3, required_by_date=$4, payment_terms=$5, shipping_terms=$6, priority=$7, updated_at=now() WHERE id=$8`, [project_id || null, notes || null, vendor_name || null, required_by_date || null, payment_terms || null, shipping_terms || null, priority || 'normal', id]);
    if (Array.isArray(system_ids)) {
        await (0, db_1.query)('DELETE FROM po_systems WHERE po_id=$1', [id]);
        for (const sid of system_ids) {
            await (0, db_1.query)('INSERT INTO po_systems (po_id,system_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, sid]);
        }
    }
    await (0, audit_1.logAudit)(req.user.id, 'purchase_order', String(id), 'UPDATE', {
        summary: 'Purchase order details updated',
        project_id: project_id || null,
        vendor_name: vendor_name || null,
        required_by_date: required_by_date || null,
        priority: priority || 'normal',
    });
    res.json({ ok: true });
});
// PATCH PROCUREMENT META (vendor, dates, terms, priority — editable regardless of status)
router.patch('/purchase-orders/:id/procurement-meta', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!canTransition(user.role))
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
    const existing = await (0, db_1.query)('SELECT id FROM purchase_orders WHERE id=$1', [id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    const { vendor_name, required_by_date, payment_terms, shipping_terms, priority } = req.body;
    const procError = validateProcurementFields({ priority, vendor_name, payment_terms, shipping_terms, required_by_date });
    if (procError)
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: procError } });
    await (0, db_1.query)(`UPDATE purchase_orders SET vendor_name=$1, required_by_date=$2, payment_terms=$3, shipping_terms=$4, priority=$5, updated_at=now() WHERE id=$6`, [vendor_name ?? null, required_by_date ?? null, payment_terms ?? null, shipping_terms ?? null, priority ?? 'normal', id]);
    await (0, audit_1.logAudit)(user.id, 'purchase_order', String(id), 'UPDATE', {
        summary: 'Procurement details updated',
        vendor_name: vendor_name ?? null,
        required_by_date: required_by_date ?? null,
        payment_terms: payment_terms ?? null,
        shipping_terms: shipping_terms ?? null,
        priority: priority ?? 'normal',
    });
    res.json({ ok: true });
});
// SUBMIT for approval
router.post('/purchase-orders/:id/submit', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    const poRes = await (0, db_1.query)('SELECT * FROM purchase_orders WHERE id=$1', [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    const po = poRes.rows[0];
    if (po.status !== 'draft')
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is not in draft' } });
    // Stage gate validation
    const itemsRes = await (0, db_1.query)('SELECT id, cost_price FROM po_items WHERE po_id=$1', [id]);
    if (itemsRes.rows.length === 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'PO must have at least one item before submitting.' } });
    }
    const missingCost = itemsRes.rows.filter((r) => !r.cost_price || parseFloat(r.cost_price) === 0);
    if (missingCost.length > 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${missingCost.length} item(s) are missing a cost price. Set all costs before submitting.` } });
    }
    const newStatus = user.role === 'hq_manager' ? 'purchase_order' : 'pending_approval';
    const approvedBy = user.role === 'hq_manager' ? user.id : null;
    if (user.role === 'hq_manager') {
        await (0, db_1.query)(`UPDATE purchase_orders SET status=$1, approved_by=$2, approved_at=now(), stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$3`, [newStatus, approvedBy, id]);
    }
    else {
        await (0, db_1.query)(`UPDATE purchase_orders SET status=$1, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`, [newStatus, id]);
    }
    await (0, db_1.query)(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`, [id, 'draft', newStatus, user.id, user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'Submitted for approval']);
    await (0, audit_1.logAudit)(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
        summary: statusChangeSummary('draft', newStatus),
        from: 'draft',
        to: newStatus,
        comment: user.role === 'hq_manager' ? 'Self-approved by HQ Manager' : 'Submitted for approval',
    });
    if (newStatus === 'pending_approval') {
        const actorRes = await (0, db_1.query)('SELECT first_name, last_name FROM users WHERE id=$1', [user.id]);
        const actor = actorRes.rows[0];
        const actorName = actor ? `${actor.first_name} ${actor.last_name}`.trim() : user.email;
        await (0, notifications_1.notifyAdminsAndManagers)({
            type: 'po_submitted',
            title: 'PO Pending Approval',
            body: `PO #${po.po_code} has been submitted for approval by ${actorName}.`,
            entityType: 'purchase_order',
            entityId: String(id),
            excludeUserId: user.id,
        });
    }
    res.json({ status: newStatus });
});
// APPROVE
router.post('/purchase-orders/:id/approve', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body ?? {};
    const user = req.user;
    // Check configured approvers; fall back to hq_manager/admin if none configured
    const approverRows = await (0, db_1.query)('SELECT user_id FROM po_stage_assignees WHERE stage=$1', ['pending_approval']);
    if (approverRows.rows.length > 0) {
        const allowed = approverRows.rows.some((r) => r.user_id === user.id);
        if (!allowed)
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised to approve at this stage' } });
    }
    else {
        if (user.role !== 'hq_manager' && user.role !== 'admin') {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only HQ managers or admins can approve POs' } });
        }
    }
    const poRes = await (0, db_1.query)('SELECT * FROM purchase_orders WHERE id=$1', [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    if (poRes.rows[0].status !== 'pending_approval') {
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is not pending approval' } });
    }
    await (0, db_1.query)(`UPDATE purchase_orders SET status='purchase_order', approved_by=$1, approved_at=now(), stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`, [user.id, id]);
    await (0, db_1.query)(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`, [id, 'pending_approval', 'purchase_order', user.id, comment || 'Approved']);
    await (0, audit_1.logAudit)(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
        summary: statusChangeSummary('pending_approval', 'purchase_order'),
        from: 'pending_approval',
        to: 'purchase_order',
        comment: comment || 'Approved',
    });
    if (poRes.rows[0].created_by) {
        await (0, notifications_1.createNotification)({
            userId: poRes.rows[0].created_by,
            type: 'po_approved',
            title: 'PO Approved',
            body: `Your PO #${poRes.rows[0].po_code} has been approved.`,
            entityType: 'purchase_order',
            entityId: String(id),
        });
    }
    res.json({ status: 'purchase_order' });
});
// REJECT (send back to draft)
router.post('/purchase-orders/:id/reject', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body ?? {};
    if (!comment || !comment.trim()) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'A rejection reason is required so the creator knows what to fix.' } });
    }
    const user = req.user;
    const approverRows = await (0, db_1.query)('SELECT user_id FROM po_stage_assignees WHERE stage=$1', ['pending_approval']);
    if (approverRows.rows.length > 0) {
        const allowed = approverRows.rows.some((r) => r.user_id === user.id);
        if (!allowed)
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised to reject at this stage' } });
    }
    else {
        if (user.role !== 'hq_manager' && user.role !== 'admin') {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only HQ managers or admins can reject POs' } });
        }
    }
    const poRes = await (0, db_1.query)('SELECT * FROM purchase_orders WHERE id=$1', [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    const fromStatus = poRes.rows[0].status;
    await (0, db_1.query)(`UPDATE purchase_orders SET status='draft', updated_at=now() WHERE id=$1`, [id]);
    await (0, db_1.query)(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,'draft',$3,$4)`, [id, fromStatus, user.id, comment || 'Sent back for corrections']);
    await (0, audit_1.logAudit)(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
        summary: statusChangeSummary(fromStatus, 'draft'),
        from: fromStatus,
        to: 'draft',
        comment: comment || 'Sent back for corrections',
    });
    if (poRes.rows[0].created_by) {
        await (0, notifications_1.createNotification)({
            userId: poRes.rows[0].created_by,
            type: 'po_rejected',
            title: 'PO Sent Back for Corrections',
            body: `Your PO #${poRes.rows[0].po_code} was sent back for corrections${comment ? `: ${comment}` : '.'}`,
            entityType: 'purchase_order',
            entityId: String(id),
        });
    }
    res.json({ status: 'draft' });
});
// STAGE ROLES — public read for inbox filtering (accessible to all authenticated users)
router.get('/purchase-orders/stage-roles', auth_1.authenticate, async (_req, res) => {
    const r = await (0, db_1.query)(`SELECT psa.id, psa.stage, psa.user_id, u.first_name, u.last_name, u.email, u.role
     FROM po_stage_assignees psa JOIN users u ON u.id = psa.user_id ORDER BY psa.stage, u.first_name`, []);
    // Return as { stage: assignee[] } map
    const map = {};
    for (const row of r.rows) {
        if (!map[row.stage])
            map[row.stage] = [];
        map[row.stage].push(row);
    }
    res.json(map);
});
// TRANSITION (advance to next stage)
router.post('/purchase-orders/:id/transition', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body ?? {};
    const user = req.user;
    const poRes = await (0, db_1.query)('SELECT * FROM purchase_orders WHERE id=$1', [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    const po = poRes.rows[0];
    const allowed = await canAdvanceStage(po.status, user.id, user.role, po.created_by);
    if (!allowed)
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised to advance this PO at this stage' } });
    if (['draft', 'pending_approval'].includes(po.status)) {
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Submit or approve this PO before advancing stages' } });
    }
    const next = nextStage(po.status);
    if (!next)
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'PO is already at the final stage' } });
    // Stage gate validation
    const gateItems = await (0, db_1.query)('SELECT id, cost_price FROM po_items WHERE po_id=$1', [id]);
    if (gateItems.rows.length === 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'PO must have at least one item before advancing.' } });
    }
    const gateMissing = gateItems.rows.filter((r) => !r.cost_price || parseFloat(r.cost_price) === 0);
    if (gateMissing.length > 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${gateMissing.length} item(s) are missing a cost price. Set all costs before advancing.` } });
    }
    if (next === 'released') {
        const foSeq = await (0, db_1.query)(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('fo_code_seq') AS seq`);
        const { yr, seq } = foSeq.rows[0];
        const fo_number = `FO-${yr}-${String(seq).padStart(4, '0')}`;
        await (0, db_1.query)(`UPDATE purchase_orders SET status=$1, fo_number=$2, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$3`, [next, fo_number, id]);
    }
    else {
        await (0, db_1.query)(`UPDATE purchase_orders SET status=$1, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`, [next, id]);
    }
    await (0, db_1.query)(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`, [id, po.status, next, user.id, comment || null]);
    await (0, audit_1.logAudit)(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
        summary: statusChangeSummary(po.status, next),
        from: po.status,
        to: next,
        comment: comment || null,
    });
    if (po.created_by && po.created_by !== user.id) {
        await (0, notifications_1.createNotification)({
            userId: po.created_by,
            type: 'po_transitioned',
            title: 'PO Stage Updated',
            body: `Your PO #${po.po_code} has moved to stage: ${next.replace(/_/g, ' ')}.`,
            entityType: 'purchase_order',
            entityId: String(id),
        });
    }
    const updated = await (0, db_1.query)('SELECT fo_number FROM purchase_orders WHERE id=$1', [id]);
    res.json({ status: next, fo_number: updated.rows[0]?.fo_number ?? null });
});
// BULK TRANSITION
router.post('/purchase-orders/bulk-transition', auth_1.authenticate, async (req, res) => {
    const { ids } = req.body;
    const user = req.user;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'No PO IDs provided' } });
    }
    const results = [];
    for (const id of ids) {
        try {
            const poRes = await (0, db_1.query)('SELECT * FROM purchase_orders WHERE id=$1', [id]);
            const po = poRes.rows[0];
            if (!po) {
                results.push({ id, error: 'Not found' });
                continue;
            }
            const allowed = await canAdvanceStage(po.status, user.id, user.role, po.created_by);
            if (!allowed) {
                results.push({ id, po_code: po.po_code, error: 'Not authorised for this stage' });
                continue;
            }
            if (['draft', 'pending_approval'].includes(po.status)) {
                results.push({ id, po_code: po.po_code, error: 'Submit or approve before transitioning' });
                continue;
            }
            const next = nextStage(po.status);
            if (!next) {
                results.push({ id, po_code: po.po_code, error: 'Already at final stage' });
                continue;
            }
            if (next === 'released') {
                const foSeq = await (0, db_1.query)(`SELECT TO_CHAR(now(),'YYYY') AS yr, nextval('fo_code_seq') AS seq`);
                const { yr, seq } = foSeq.rows[0];
                const fo_number = `FO-${yr}-${String(seq).padStart(4, '0')}`;
                await (0, db_1.query)(`UPDATE purchase_orders SET status=$1, fo_number=$2, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$3`, [next, fo_number, id]);
            }
            else {
                await (0, db_1.query)(`UPDATE purchase_orders SET status=$1, stage_due_date=now()+interval '1 day', updated_at=now() WHERE id=$2`, [next, id]);
            }
            await (0, db_1.query)(`INSERT INTO po_lifecycle_history (po_id,from_status,to_status,changed_by,comment) VALUES ($1,$2,$3,$4,$5)`, [id, po.status, next, user.id, 'Bulk transition']);
            await (0, audit_1.logAudit)(user.id, 'purchase_order', String(id), 'STATE_TRANSITION', {
                summary: statusChangeSummary(po.status, next),
                from: po.status,
                to: next,
                comment: 'Bulk transition',
            });
            if (po.created_by && po.created_by !== user.id) {
                await (0, notifications_1.createNotification)({
                    userId: po.created_by,
                    type: 'po_transitioned',
                    title: 'PO Stage Updated',
                    body: `Your PO #${po.po_code} has moved to stage: ${next.replace(/_/g, ' ')}.`,
                    entityType: 'purchase_order',
                    entityId: id,
                });
            }
            results.push({ id, po_code: po.po_code, status: next });
        }
        catch (e) {
            results.push({ id, error: e?.message || 'Failed' });
        }
    }
    res.json({ results });
});
// ADD ITEM
router.post('/purchase-orders/:id/items', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { product_master_id, quantity, cost_price, sell_price, currency, notes, system_id, project_equipment_item_id, tank_id, uom } = req.body;
    const itemError = validateItemFields({ uom, quantity, cost_price });
    if (itemError)
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: itemError } });
    const poRes = await (0, db_1.query)('SELECT status FROM purchase_orders WHERE id=$1', [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    if (poRes.rows[0].status !== 'draft')
        return res.status(400).json({ error: { code: 'LOCKED', message: 'Items can only be added to draft POs' } });
    const maxSort = await (0, db_1.query)('SELECT COALESCE(MAX(sort_order),0) AS m FROM po_items WHERE po_id=$1', [id]);
    const sortOrder = parseInt(maxSort.rows[0].m) + 10;
    const r = await (0, db_1.query)(`INSERT INTO po_items (po_id,product_master_id,quantity,cost_price,sell_price,currency,notes,sort_order,system_id,project_equipment_item_id,tank_id,uom)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [id, product_master_id || null, quantity || 1, cost_price || null, sell_price || null, currency || 'USD', notes || null, sortOrder, system_id || null, project_equipment_item_id || null, tank_id || null, uom || 'EA']);
    res.status(201).json(r.rows[0]);
});
// UPDATE ITEM
router.put('/purchase-orders/:id/items/:itemId', auth_1.authenticate, async (req, res) => {
    const { id, itemId } = req.params;
    const { quantity, cost_price, sell_price, currency, notes, system_id, budget_amount, uom } = req.body;
    const itemError = validateItemFields({ uom, quantity, cost_price });
    if (itemError)
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: itemError } });
    const poRes = await (0, db_1.query)('SELECT status FROM purchase_orders WHERE id=$1', [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    if (poRes.rows[0].status !== 'draft')
        return res.status(400).json({ error: { code: 'LOCKED', message: 'Items can only be edited on draft POs' } });
    const r = await (0, db_1.query)(`UPDATE po_items SET quantity=$1,cost_price=$2,sell_price=$3,currency=$4,notes=$5,system_id=$6,budget_amount=$7,uom=COALESCE($8, uom) WHERE id=$9 AND po_id=$10 RETURNING *`, [quantity, cost_price || null, sell_price || null, currency || 'USD', notes || null, system_id || null, budget_amount != null ? budget_amount : null, uom ?? null, itemId, id]);
    res.json(r.rows[0]);
});
// DELETE ITEM
router.delete('/purchase-orders/:id/items/:itemId', auth_1.authenticate, async (req, res) => {
    const { id, itemId } = req.params;
    const poRes = await (0, db_1.query)('SELECT status FROM purchase_orders WHERE id=$1', [id]);
    if (!poRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    if (poRes.rows[0].status !== 'draft')
        return res.status(400).json({ error: { code: 'LOCKED', message: 'Items can only be removed from draft POs' } });
    await (0, db_1.query)('DELETE FROM po_items WHERE id=$1 AND po_id=$2', [itemId, id]);
    res.json({ ok: true });
});
// BULK ASSIGN DESIGNATED USER
router.post('/purchase-orders/bulk-assign', auth_1.authenticate, async (req, res) => {
    const { ids, userId } = req.body;
    const user = req.user;
    if (!canTransition(user.role))
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
    if (!Array.isArray(ids) || ids.length === 0 || !userId) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'ids and userId are required' } });
    }
    const results = [];
    for (const id of ids) {
        try {
            const poRes = await (0, db_1.query)('SELECT po_code FROM purchase_orders WHERE id=$1', [id]);
            if (!poRes.rows[0]) {
                results.push({ id, error: 'Not found' });
                continue;
            }
            await (0, db_1.query)('INSERT INTO po_designated_users (po_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, userId]);
            await (0, notifications_1.createNotification)({
                userId,
                type: 'po_assigned',
                title: 'You have been assigned to a PO',
                body: `You have been assigned as a designated user on PO #${poRes.rows[0].po_code}.`,
                entityType: 'purchase_order',
                entityId: id,
            });
            results.push({ id, po_code: poRes.rows[0].po_code, ok: true });
        }
        catch (e) {
            results.push({ id, error: e?.message || 'Failed' });
        }
    }
    res.json({ results });
});
// ADD DESIGNATED USER
router.post('/purchase-orders/:id/designated-users', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { user_id } = req.body;
    const user = req.user;
    if (!canTransition(user.role))
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
    await (0, db_1.query)('INSERT INTO po_designated_users (po_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, user_id]);
    res.json({ ok: true });
});
// REMOVE DESIGNATED USER
router.delete('/purchase-orders/:id/designated-users/:userId', auth_1.authenticate, async (req, res) => {
    const { id, userId } = req.params;
    const user = req.user;
    if (!canTransition(user.role))
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
    await (0, db_1.query)('DELETE FROM po_designated_users WHERE po_id=$1 AND user_id=$2', [id, userId]);
    res.json({ ok: true });
});
// COMMENTS — LIST
router.get('/purchase-orders/:id/comments', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const r = await (0, db_1.query)(`SELECT c.id, c.message, c.created_at,
       u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email, u.role AS author_role, c.user_id
     FROM po_comments c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.po_id = $1
     ORDER BY c.created_at ASC`, [id]);
    res.json({ items: r.rows });
});
// COMMENTS — ADD
router.post('/purchase-orders/:id/comments', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    const user = req.user;
    if (!message?.trim())
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Message is required' } });
    const r = await (0, db_1.query)(`INSERT INTO po_comments (po_id, user_id, message) VALUES ($1, $2, $3)
     RETURNING id, message, created_at`, [id, user.id, message.trim()]);
    res.status(201).json(r.rows[0]);
});
// COMMENTS — DELETE
router.delete('/purchase-orders/:id/comments/:commentId', auth_1.authenticate, async (req, res) => {
    const { commentId } = req.params;
    const user = req.user;
    const existing = await (0, db_1.query)('SELECT user_id FROM po_comments WHERE id=$1', [commentId]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } });
    if (existing.rows[0].user_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete another user\'s comment' } });
    }
    await (0, db_1.query)('DELETE FROM po_comments WHERE id=$1', [commentId]);
    res.json({ ok: true });
});
// ATTACHMENTS — LIST
router.get('/purchase-orders/:id/attachments', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const r = await (0, db_1.query)(`SELECT a.id, a.file_name, a.file_path, a.file_size, a.mime_type, a.created_at,
       u.first_name || ' ' || u.last_name AS uploader_name, a.uploaded_by
     FROM po_attachments a
     LEFT JOIN users u ON a.uploaded_by = u.id
     WHERE a.po_id = $1
     ORDER BY a.created_at ASC`, [id]);
    res.json({ items: r.rows });
});
// ATTACHMENTS — UPLOAD
router.post('/purchase-orders/:id/attachments', auth_1.authenticate, uploadDoc.single('file'), async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!req.file)
        return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file provided' } });
    const filePath = `/uploads/${req.file.filename}`;
    const r = await (0, db_1.query)(`INSERT INTO po_attachments (po_id, file_name, file_path, file_size, mime_type, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [id, req.file.originalname, filePath, req.file.size, req.file.mimetype, user.id]);
    res.status(201).json(r.rows[0]);
});
// ATTACHMENTS — DELETE
router.delete('/purchase-orders/:id/attachments/:attachmentId', auth_1.authenticate, async (req, res) => {
    const { attachmentId } = req.params;
    const user = req.user;
    const existing = await (0, db_1.query)('SELECT uploaded_by, file_path FROM po_attachments WHERE id=$1', [attachmentId]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
    if (existing.rows[0].uploaded_by !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete another user\'s attachment' } });
    }
    const filePath = path_1.default.join(__dirname, '../../', existing.rows[0].file_path);
    if (fs_1.default.existsSync(filePath))
        fs_1.default.unlinkSync(filePath);
    await (0, db_1.query)('DELETE FROM po_attachments WHERE id=$1', [attachmentId]);
    res.json({ ok: true });
});
// DUE DATE — SET
router.patch('/purchase-orders/:id/due-date', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const { stage_due_date } = req.body;
    const user = req.user;
    if (!canTransition(user.role))
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorised' } });
    await (0, db_1.query)('UPDATE purchase_orders SET stage_due_date=$1, updated_at=now() WHERE id=$2', [stage_due_date || null, id]);
    res.json({ ok: true });
});
// ATTACH DOCUMENT FILE
router.post('/purchase-orders/:id/document', auth_1.authenticate, uploadDoc.single('document'), async (req, res) => {
    const { id } = req.params;
    if (!req.file)
        return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file provided' } });
    const docUrl = `/uploads/${req.file.filename}`;
    const docName = req.file.originalname;
    const result = await (0, db_1.query)('UPDATE purchase_orders SET document_url=$1, document_name=$2, updated_at=NOW() WHERE id=$3 RETURNING id, document_url, document_name', [docUrl, docName, id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO not found' } });
    res.json(result.rows[0]);
});
exports.default = router;
