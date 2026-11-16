import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ModuleAccessKey } from '../lib/moduleAccess';
import { isEditorRole } from '../lib/roles';

const router = Router();
type RecordType = 'project' | 'system' | 'equipment' | 'product' | 'component' | 'material' | 'document' | 'purchase_order' | 'client' | 'contact' | 'enquiry' | 'design_book' | 'drafting_plan' | 'person' | 'notification' | 'audit_event';
// 'people' (colleagues) is open to everyone signed in; 'admin' records only to editor roles.
type Adapter = { type: RecordType; module: ModuleAccessKey | 'admin' | 'people'; sql: string; searchOnly?: boolean };

// Each adapter returns the same columns. Keep predicates here (not in the browser):
// both the page and its count must operate on the same authorized set.
const adapters: Adapter[] = [
  { type: 'project', module: 'projects', sql: `SELECT p.id::text id, p.project_code::text code, CONCAT_WS(' · ', p.project_name, NULLIF(p.client_name, p.project_name))::text name, p.project_status::text status, NULL::text project_code, NULL::text system_id, p.created_by::text owner_id, NULL::date due_date, p.updated_at FROM projects p` },
  { type: 'system', module: 'projects', sql: `SELECT s.id::text, s.system_code::text, s.system_name::text, s.status::text, p.project_code::text, s.id::text, NULL::text, NULL::date, s.updated_at FROM systems s JOIN projects p ON p.id=s.project_id` },
  { type: 'equipment', module: 'projects', sql: `SELECT pei.id::text, pei.equip_code::text, COALESCE(pei.description,pm.product_name,pei.equip_code)::text, pei.status::text, p.project_code::text, COALESCE(pei.system_id::text,'project:' || pei.project_id::text), NULL::text, NULL::date, pei.updated_at FROM project_equipment_items pei JOIN projects p ON p.id=pei.project_id LEFT JOIN product_masters pm ON pm.id=pei.product_master_id` },
  { type: 'product', module: 'pim', sql: `SELECT pm.id::text, pm.product_code::text, CONCAT_WS(' · ', pm.product_name, NULLIF(CONCAT_WS(' ', pm.manufacturer, pm.model), ''))::text, pm.standard_status::text, NULL::text, NULL::text, NULL::text, NULL::date, pm.updated_at FROM product_masters pm` },
  { type: 'component', module: 'pim', sql: `SELECT co.id::text, co.component_code::text, CONCAT_WS(' · ', co.component_name, NULLIF(CONCAT_WS(' ', co.manufacturer, co.model), ''))::text, co.status::text, NULL::text, NULL::text, co.created_by::text, NULL::date, co.updated_at FROM components co` },
  { type: 'material', module: 'knowledge', sql: `SELECT m.id::text, m.material_code::text, m.material_name::text, m.status::text, NULL::text, NULL::text, NULL::text, NULL::date, m.updated_at FROM materials m` },
  { type: 'document', module: 'documents', sql: `SELECT d.id::text, d.document_code::text, d.document_title::text, d.status::text, NULL::text, NULL::text, d.created_by::text, NULL::date, d.updated_at FROM documents d` },
  { type: 'purchase_order', module: 'orders', sql: `SELECT po.id::text, po.po_code::text, COALESCE(proj.project_name,po.po_code)::text, po.status::text, proj.project_code::text, NULL::text, po.created_by::text, COALESCE(po.stage_due_date,po.required_by_date)::date, po.updated_at FROM purchase_orders po LEFT JOIN projects proj ON proj.id=po.project_id WHERE ($1::boolean OR po.created_by=$2::uuid OR EXISTS (SELECT 1 FROM po_designated_users pd WHERE pd.po_id=po.id AND pd.user_id=$2::uuid) OR EXISTS (SELECT 1 FROM po_stage_assignees psa WHERE psa.stage=po.status AND psa.user_id=$2::uuid))` },
  { type: 'client', module: 'clients', sql: `SELECT c.id::text, c.client_code::text, CONCAT_WS(' · ', c.name, NULLIF(c.legal_name, c.name), NULLIF(CONCAT_WS(', ', c.city, c.country), ''))::text, c.status::text, NULL::text, NULL::text, c.created_by::text, NULL::date, c.updated_at FROM clients c` },
  // A client's person: code is their email, name reads "Name · Job title · Company"; system_id carries the company id for the link.
  { type: 'contact', module: 'clients', sql: `SELECT cc.id::text, cc.email::text, CONCAT_WS(' · ', cc.name, cc.job_title, c.name)::text, CASE WHEN cc.left_on IS NULL THEN NULL ELSE 'left' END::text, NULL::text, cc.client_id::text, cc.created_by::text, NULL::date, cc.updated_at FROM client_contacts cc JOIN clients c ON c.id=cc.client_id` },
  // Colleagues: active users. code is the email, name reads "Name · Job position".
  { type: 'person', module: 'people', sql: `SELECT u.id::text, u.email::text, CONCAT_WS(' · ', NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.job_title)::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::date, u.updated_at FROM users u WHERE u.is_active IS NOT FALSE` },
  { type: 'drafting_plan', module: 'drafting', sql: `SELECT dp.id::text, dp.plan_code::text, dp.name::text, dp.status::text, p.project_code::text, NULL::text, dp.created_by::text, dp.target_date::date, dp.updated_at FROM drafting_plans dp LEFT JOIN projects p ON p.id=dp.project_id` },
  { type: 'enquiry', module: 'business_development', sql: `SELECT e.id::text, e.enquiry_number::text, e.title::text, e.status::text, NULL::text, NULL::text, e.created_by::text, e.due_date::date, e.updated_at FROM enquiries e` },
  { type: 'design_book', module: 'design_books', sql: `SELECT db.id::text, db.book_code::text, db.book_title::text, db.status::text, p.project_code::text, NULL::text, db.created_by::text, NULL::date, db.updated_at FROM design_books db LEFT JOIN projects p ON p.id=db.project_id` },
  // Only PO notifications whose target is still visible are searchable. A deleted or
  // subsequently restricted PO must not leak its old notification title.
  { type: 'notification', module: 'orders', searchOnly: true, sql: `SELECT n.id::text, po.po_code::text, n.title::text, CASE WHEN n.is_read THEN 'read' ELSE 'unread' END::text, NULL::text, po.id::text, n.user_id::text, NULL::date, n.created_at FROM notifications n JOIN purchase_orders po ON n.entity_type='purchase_order' AND n.entity_id=po.id::text WHERE n.user_id=$2::uuid AND ($1::boolean OR po.created_by=$2::uuid OR EXISTS (SELECT 1 FROM po_designated_users pd WHERE pd.po_id=po.id AND pd.user_id=$2::uuid) OR EXISTS (SELECT 1 FROM po_stage_assignees psa WHERE psa.stage=po.status AND psa.user_id=$2::uuid))` },
  { type: 'audit_event', module: 'admin', searchOnly: true, sql: `SELECT al.id::text, al.entity_id::text, al.action::text, al.action::text, NULL::text, al.entity_type::text, al.actor_id::text, NULL::date, al.created_at FROM audit_logs al` },
];

function pageNumber(value: unknown, fallback: number, max: number) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

async function access(req: AuthRequest) {
  const result = await query(
    `SELECT u.can_see_all_pos, rma.module_key, rma.access_level
     FROM users u LEFT JOIN roles r ON r.name=u.role
     LEFT JOIN role_module_access rma ON rma.role_id=r.id WHERE u.id=$1`,
    [req.user!.id],
  );
  return {
    allPOs: result.rows[0]?.can_see_all_pos === true,
    hidden: new Set(result.rows.filter(r => r.access_level === 'hidden').map(r => r.module_key)),
    readOnly: new Set(result.rows.filter(r => r.access_level === 'view').map(r => r.module_key)),
  };
}

// Shared search/work contract: type, module, id, code, name, status, project_code,
// system_id (equipment route), owner_id, due_date, updated_at and canonical href.
function source(available: Adapter[]) {
  return available.length ? available.map(a => `SELECT '${a.type}'::text AS type, '${a.module}'::text AS module, r.* FROM (${a.sql}) r(id,code,name,status,project_code,system_id,owner_id,due_date,updated_at)`).join(' UNION ALL ') :
    `SELECT NULL::text type, NULL::text module, NULL::text id, NULL::text code, NULL::text name, NULL::text status, NULL::text project_code, NULL::text system_id, NULL::text owner_id, NULL::date due_date, NULL::timestamptz updated_at WHERE false`;
}

function href(row: any): string {
  const roots: Record<RecordType, string> = {
    project: '/projects', system: '/systems', equipment: '/systems', product: '/products/masters',
    component: '/products/components', material: '/knowledge/materials', document: '/documents',
    purchase_order: '/purchase-orders', client: '/clients', contact: '/clients', enquiry: '/enquiries',
    design_book: '/design-books', drafting_plan: '/drafting/plans', person: '/admin/users',
    notification: '/purchase-orders', audit_event: '/admin/audit-log',
  };
  return row.type === 'equipment' ? row.system_id?.startsWith('project:') ? `/projects/${row.system_id.slice(8)}?equipment=${row.id}` : `/systems/${row.system_id}?equipment=${row.id}` :
    row.type === 'notification' ? `/purchase-orders/${row.system_id}` :
    row.type === 'contact' ? `/clients/${row.system_id}` :
    row.type === 'person' ? `/admin/users?q=${encodeURIComponent(row.code || '')}` :
    row.type === 'audit_event' ? `/admin/audit-log?entity_type=${encodeURIComponent(row.system_id || '')}&entity_id=${encodeURIComponent(row.code || '')}` :
    `${roots[row.type as RecordType]}/${row.id}`;
}

function filters(req: AuthRequest, allowed: Adapter[], work: boolean) {
  const q = String(req.query.q ?? '').trim().slice(0, 200);
  const type = String(req.query.type ?? '');
  const module = String(req.query.module ?? '');
  const status = String(req.query.status ?? '');
  const owner = String(req.query.owner ?? '');
  const due = String(req.query.due ?? '');
  const permitted = allowed.filter(a => (!type || a.type === type) && (!module || a.module === module));
  const conditions: string[] = [];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(code ILIKE $${params.length + 2} OR name ILIKE $${params.length + 2})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`LOWER(status)=LOWER($${params.length + 2})`);
  }
  if (owner === 'mine') conditions.push(`owner_id=$2::text`);
  if (owner === 'assigned') conditions.push(`(type='purchase_order' AND EXISTS (SELECT 1 FROM po_stage_assignees psa WHERE psa.stage=status AND psa.user_id=$2::uuid))`);
  else if (owner && /^[0-9a-f-]{36}$/i.test(owner)) {
    params.push(owner);
    conditions.push(`owner_id=$${params.length + 2}`);
  }
  if (due === 'overdue') conditions.push('due_date < CURRENT_DATE');
  if (due === 'today') conditions.push('due_date = CURRENT_DATE');
  if (due === 'upcoming') conditions.push('due_date > CURRENT_DATE');
  if (work) conditions.push(`(
    (type='purchase_order' AND (
      (status='draft' AND owner_id=$2::text AND $${params.length + 3}::boolean)
      OR (status='pending_approval' AND (
        EXISTS (SELECT 1 FROM po_stage_assignees WHERE stage='pending_approval' AND user_id=$2::uuid)
        OR (NOT EXISTS (SELECT 1 FROM po_stage_assignees WHERE stage='pending_approval') AND $${params.length + 4}::boolean)
      ))
      OR (status='purchase_order' AND (owner_id=$2::text OR $${params.length + 4}::boolean OR EXISTS (SELECT 1 FROM po_stage_assignees WHERE stage='purchase_order' AND user_id=$2::uuid)))
      OR (status IN ('po_review','engineering_review') AND EXISTS (SELECT 1 FROM po_stage_assignees WHERE stage=status AND user_id=$2::uuid))
    ))
    OR (type='design_book' AND (
      (status IN ('Draft','In Progress') AND owner_id=$2::text AND $${params.length + 3}::boolean)
      OR (status='For Review' AND $${params.length + 5}::boolean)
      OR (status='Approved' AND $${params.length + 5}::boolean)
    ))
    OR (type='enquiry' AND status IN ('new','in_review') AND owner_id=$2::text AND $${params.length + 6}::boolean)
    OR (type='document' AND LOWER(status)='draft' AND owner_id=$2::text AND $${params.length + 7}::boolean)
  )`);
  return { permitted, conditions, params, q };
}

async function listing(req: AuthRequest, res: Response, work: boolean) {
  try {
    const { hidden, readOnly, allPOs } = await access(req);
    const allowed = adapters.filter(a => !hidden.has(a.module) && (!work || !a.searchOnly) &&
      (a.module !== 'admin' || isEditorRole(req.user!.role)));
    const { permitted, conditions, params, q } = filters(req, allowed, work);
    const page = pageNumber(req.query.page, 1, 1000000);
    const page_size = pageNumber(req.query.page_size, 25, 100);
    if (!work && q.length < 2) return res.json({ results: [], query: q, total: 0, page, page_size });
    const manage = (key: ModuleAccessKey) => !hidden.has(key) && !readOnly.has(key);
    const baseValues = [allPOs, req.user!.id, ...params];
    const values = work ? [...baseValues, manage('orders') && (isEditorRole(req.user!.role) || req.user!.role === 'hq_manager'),
      ['admin','hq_manager'].includes(req.user!.role), ['admin','hq_manager','pmo'].includes(req.user!.role),
      manage('business_development'), manage('documents')] : baseValues;
    // Work predicates reference the trailing role flags by position; search never uses them.
    const offset = 3 + params.length;
    const sqlSource = source(permitted);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const cte = `WITH auth_params AS (SELECT $1::boolean AS all_pos, $2::uuid AS user_id), records AS (${sqlSource}), selected AS (SELECT * FROM records ${where})`;
    const count = await query(`${cte} SELECT COUNT(*)::int AS total FROM selected`, values);
    const order = work
      ? `ORDER BY (due_date < CURRENT_DATE) DESC NULLS LAST, due_date ASC NULLS LAST, updated_at DESC NULLS LAST, type, id`
      : `ORDER BY CASE WHEN LOWER(code)=LOWER($${offset}) THEN 0 WHEN LOWER(name)=LOWER($${offset}) THEN 1 WHEN code ILIKE $${offset + 1} THEN 2 ELSE 3 END, updated_at DESC NULLS LAST, type, id`;
    const orderValues = work ? values : [...values, q, `${q}%`];
    const rows = await query(`${cte} SELECT * FROM selected ${order} LIMIT $${orderValues.length + 1} OFFSET $${orderValues.length + 2}`,
      [...orderValues, page_size, (page - 1) * page_size]);
    const drafts = work ? rows.rows.filter(r => r.type === 'purchase_order' && r.status === 'draft').map(r => r.id) : [];
    const latest = drafts.length ? await query(
      `SELECT DISTINCT ON (po_id) po_id::text, from_status FROM po_lifecycle_history
       WHERE po_id=ANY($1::uuid[]) ORDER BY po_id, changed_at DESC, id DESC`,
      [drafts],
    ) : { rows: [] };
    const rejected = new Set(latest.rows.filter(r => r.from_status === 'pending_approval').map(r => r.po_id));
    res.json({ results: rows.rows.map(r => ({
      ...r, href: href(r),
      ...(work ? { attention: rejected.has(r.id) ? 'Rejected — revise draft' :
        r.type === 'purchase_order' && r.status === 'pending_approval' ? 'Approval needed' :
        r.type === 'design_book' && r.status === 'For Review' ? 'Review needed' :
        r.type === 'design_book' && r.status === 'Approved' ? 'Ready for release' : 'Needs attention' } : {}),
    })), query: q, total: count.rows[0].total, page, page_size });
  } catch (err) {
    // Express 5 propagates rejected async handlers, but keep this explicit for tests.
    throw err;
  }
}

router.get('/', authenticate, (req: AuthRequest, res: Response) => listing(req, res, false));
router.get('/my-work', authenticate, (req: AuthRequest, res: Response) => listing(req, res, true));

export default router;