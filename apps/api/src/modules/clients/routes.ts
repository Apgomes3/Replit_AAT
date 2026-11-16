// Client directory API (/api/v1/clients): companies and their people, shared by every module.
// Everyone with the Clients & contacts module can look; managing needs "manage" on that module.
import { NextFunction, Response, Router } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../../middleware/auth';
import { query, withTransaction } from '../../db';
import { logAudit } from '../../db/audit';
import {
  CLIENT_KINDS, ClientInput, isUuid, namesLookAlike, validateClientInput, validateContactInput,
} from './validation';

const router = Router();
router.use(authenticate, requireModuleAccess('clients'));
const manage = requireModuleManage('clients');

type DbRunner = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}
function fail(res: Response, status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return res.status(status).json({ error: { code, message, ...extra } });
}
function handle(res: Response, next: NextFunction, e: any) {
  if (e instanceof HttpError) return fail(res, e.status, e.code, e.message, e.extra);
  if (e?.code === '23505') return fail(res, 409, 'CONFLICT', 'That already exists.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'Those details are not allowed together.');
  return next(e);
}

/** Address is stored as JSON for history; the directory reads and writes it as one line of text. */
const addressText = (a: any) => (typeof a === 'string' ? a : a?.display_name ?? '');

function companyOut(row: any) {
  return {
    ...row,
    address: addressText(row.address),
    active: row.active ?? row.status === 'active',
    contact_count: row.contact_count == null ? undefined : Number(row.contact_count),
  };
}

/** Companies whose names look like `name` (for "did you mean…?"). */
async function lookAlikes(db: DbRunner, name: string, exceptId?: string) {
  const rows = (await db.query('SELECT id, name, client_code, country, active FROM clients ORDER BY name')).rows;
  return rows.filter(r => r.id !== exceptId && namesLookAlike(r.name, name)).slice(0, 5);
}

/** Why `parentId` cannot be the parent of `clientId` (missing, itself, or below it), or null. */
async function parentProblem(db: DbRunner, clientId: string | null, parentId: string): Promise<string | null> {
  if (clientId && parentId === clientId) return 'A company cannot be its own parent';
  const parent = (await db.query('SELECT id FROM clients WHERE id=$1', [parentId])).rows[0];
  if (!parent) return 'The parent company does not exist';
  if (!clientId) return null;
  const loop = await db.query(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT parent_client_id, 1 FROM clients WHERE id = $1
       UNION ALL SELECT c.parent_client_id, up.depth + 1 FROM clients c JOIN up ON c.id = up.id
       WHERE up.id IS NOT NULL AND up.depth < 50)
     SELECT 1 FROM up WHERE id = $2 LIMIT 1`, [parentId, clientId]);
  return loop.rows.length ? 'That would make a loop: the chosen parent belongs to this company' : null;
}

async function nextClientCode(db: DbRunner) {
  const year = new Date().getUTCFullYear();
  await db.query(`INSERT INTO enquiry_number_counters(counter_key,next_value) VALUES ($1,2)
    ON CONFLICT (counter_key) DO UPDATE SET next_value=enquiry_number_counters.next_value+1`, [`client:${year}`]);
  const n = await db.query('SELECT next_value-1 AS value FROM enquiry_number_counters WHERE counter_key=$1', [`client:${year}`]);
  return `CL-${year}-${String(n.rows[0].value).padStart(4, '0')}`;
}

async function insertContact(db: DbRunner, clientId: string, c: any, userId: string) {
  if (c.is_primary) await db.query('UPDATE client_contacts SET is_primary=false WHERE client_id=$1 AND is_primary', [clientId]);
  return (await db.query(
    `INSERT INTO client_contacts(client_id,name,email,phone,mobile,job_title,notes,is_primary,left_on,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
    [clientId, c.name, c.email ?? null, c.phone ?? null, c.mobile ?? null, c.job_title ?? null, c.notes ?? null,
      c.is_primary === true, c.left_on ?? null, userId])).rows[0];
}

const LIST_SQL = `
  SELECT c.*, p.name AS parent_name,
    (SELECT COUNT(*) FROM client_contacts cc WHERE cc.client_id=c.id AND cc.left_on IS NULL)::int AS contact_count,
    (SELECT COUNT(*) FROM enquiries e WHERE e.client_id=c.id)::int AS enquiry_count,
    (SELECT COUNT(*) FROM projects pr WHERE pr.client_id=c.id)::int AS project_count,
    pc.id AS primary_contact_id, pc.name AS primary_contact_name, pc.email AS primary_contact_email,
    COALESCE(pc.phone, pc.mobile) AS primary_contact_phone
  FROM clients c
  LEFT JOIN clients p ON p.id = c.parent_client_id
  LEFT JOIN client_contacts pc ON pc.client_id = c.id AND pc.is_primary`;

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const kind = String(req.query.kind || '').trim();
    const status = String(req.query.status || 'all');
    const params: any[] = []; const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      where.push(`(c.name ILIKE $${i} OR c.legal_name ILIKE $${i} OR c.client_code ILIKE $${i} OR c.country ILIKE $${i} OR c.city ILIKE $${i}
        OR EXISTS (SELECT 1 FROM client_contacts sc WHERE sc.client_id=c.id AND (sc.name ILIKE $${i} OR sc.email ILIKE $${i})))`);
    }
    if (kind) {
      if (!(CLIENT_KINDS as readonly string[]).includes(kind)) return fail(res, 400, 'VALIDATION', `Unknown kind "${kind}"`);
      params.push(kind); where.push(`$${params.length} = ANY(c.kinds)`);
    }
    if (status === 'active') where.push('c.active');
    else if (status === 'inactive') where.push('NOT c.active');
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(500, Math.max(1, Number(req.query.page_size) || 25));
    const count = await query(`SELECT COUNT(*)::int AS count FROM clients c ${predicate}`, params);
    const rows = await query(`${LIST_SQL} ${predicate} ORDER BY c.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (page - 1) * size]);
    res.json({ data: rows.rows.map(companyOut), pagination: { page, page_size: size, total: count.rows[0].count } });
  } catch (e) { next(e); }
});

/** Companies whose name looks like ?name= — for the duplicate warning while typing. */
router.get('/similar', async (req, res, next) => {
  try {
    const name = String(req.query.name || '').trim();
    const except = isUuid(req.query.except) ? String(req.query.except) : undefined;
    res.json({ data: name ? await lookAlikes({ query }, name, except) : [] });
  } catch (e) { next(e); }
});

router.post('/', manage, async (req: AuthRequest, res, next) => {
  try {
    const v = validateClientInput(req.body, 'create');
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const c: ClientInput = v.value;
    const initialContacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const contacts = [];
    for (const [i, raw] of initialContacts.entries()) {
      const cv = validateContactInput(raw);
      if ('error' in cv) return fail(res, 400, 'VALIDATION', `Person ${i + 1}: ${cv.error}`);
      contacts.push(cv.value);
    }
    if (contacts.filter(x => x.is_primary).length > 1) return fail(res, 400, 'VALIDATION', 'Only one primary contact is allowed');
    const created = await withTransaction(async db => {
      if (req.body?.allow_duplicate !== true) {
        const matches = await lookAlikes(db, c.name!);
        if (matches.length) {
          throw new HttpError(409, 'POSSIBLE_DUPLICATE', `${matches[0].name} is already in the directory. Is it the same company?`, { matches });
        }
      }
      if (c.parent_client_id) {
        const problem = await parentProblem(db, null, c.parent_client_id);
        if (problem) throw new HttpError(400, 'VALIDATION', problem);
      }
      const code = await nextClientCode(db);
      const active = c.active !== false;
      const row = (await db.query(
        `INSERT INTO clients(client_code,name,legal_name,website,country,city,address,notes,kinds,parent_client_id,active,status,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [code, c.name, c.legal_name ?? null, c.website ?? null, c.country ?? null, c.city ?? null,
          c.address ? { display_name: c.address } : {}, c.notes ?? null, c.kinds, c.parent_client_id ?? null,
          active, active ? 'active' : 'inactive', req.user!.id])).rows[0];
      if (contacts.length && !contacts.some(x => x.is_primary)) contacts[0].is_primary = true;
      for (const contact of contacts) await insertContact(db, row.id, contact, req.user!.id);
      return row;
    });
    await logAudit(req.user!.id, 'client', created.id, 'CREATE', { summary: `Company ${created.name} added (${created.client_code})` });
    res.status(201).json(companyOut(created));
  } catch (e) { handle(res, next, e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return fail(res, 400, 'VALIDATION', 'id must be a company id');
    const company = (await query(`${LIST_SQL} WHERE c.id=$1`, [id])).rows[0];
    if (!company) return fail(res, 404, 'NOT_FOUND', 'Company not found');
    const [contacts, children, enquiries, projects, designBooks, involvements] = await Promise.all([
      query(`SELECT * FROM client_contacts WHERE client_id=$1 ORDER BY (left_on IS NOT NULL), is_primary DESC, name, id`, [id]),
      query(`SELECT id, name, client_code, kinds, country, city, active FROM clients WHERE parent_client_id=$1 ORDER BY name`, [id]),
      query(`SELECT e.id, e.enquiry_number, e.title, e.status, e.received_date, e.due_date, p.project_code
             FROM enquiries e LEFT JOIN projects p ON p.id=e.project_id WHERE e.client_id=$1 ORDER BY e.updated_at DESC`, [id]),
      query(`SELECT id, project_code, project_name, project_status, country, city, project_manager, target_completion_date
             FROM projects WHERE client_id=$1 ORDER BY project_code`, [id]),
      query(`SELECT d.id, d.book_code, d.book_title, d.status, d.revision, p.project_code
             FROM design_books d JOIN projects p ON p.id=d.project_id WHERE p.client_id=$1 ORDER BY p.project_code, d.book_code`, [id]),
      // Projects where this company or its people have a role (consultant, site contact…).
      query(`SELECT pp.id, pp.role, pp.contact_id, cc.name AS contact_name, p.id AS project_id, p.project_code, p.project_name, p.client_name
             FROM project_parties pp JOIN projects p ON p.id=pp.project_id LEFT JOIN client_contacts cc ON cc.id=pp.contact_id
             WHERE pp.client_id=$1 ORDER BY p.project_code, cc.name NULLS FIRST, pp.role`, [id]),
    ]);
    res.json({
      ...companyOut(company), contacts: contacts.rows, children: children.rows, enquiries: enquiries.rows,
      projects: projects.rows, design_books: designBooks.rows, involvements: involvements.rows,
    });
  } catch (e) { next(e); }
});

router.patch('/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return fail(res, 400, 'VALIDATION', 'id must be a company id');
    const v = validateClientInput(req.body, 'update');
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const c = v.value;
    if (!Object.keys(c).length) return fail(res, 400, 'VALIDATION', 'Nothing to change');
    const updated = await withTransaction(async db => {
      const before = (await db.query('SELECT * FROM clients WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!before) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
      if (c.name && c.name !== before.name && req.body?.allow_duplicate !== true) {
        const matches = await lookAlikes(db, c.name, id);
        if (matches.length) throw new HttpError(409, 'POSSIBLE_DUPLICATE', `${matches[0].name} is already in the directory. Is it the same company?`, { matches });
      }
      if (c.parent_client_id) {
        const problem = await parentProblem(db, id, c.parent_client_id);
        if (problem) throw new HttpError(400, 'VALIDATION', problem);
      }
      const set: string[] = []; const values: any[] = [id];
      const put = (col: string, val: unknown) => { values.push(val); set.push(`${col}=$${values.length}`); };
      for (const key of ['name', 'legal_name', 'website', 'country', 'city', 'notes', 'kinds', 'parent_client_id'] as const) {
        if (c[key] !== undefined) put(key, c[key]);
      }
      if (c.address !== undefined) put('address', c.address ? { display_name: c.address } : {});
      if (c.active !== undefined) { put('active', c.active); put('status', c.active ? 'active' : 'inactive'); }
      put('updated_by', req.user!.id);
      const row = (await db.query(`UPDATE clients SET ${set.join(', ')}, updated_at=NOW() WHERE id=$1 RETURNING *`, values)).rows[0];
      // Projects keep the company's current name as their client_name.
      if (c.name && c.name !== before.name) await db.query('UPDATE projects SET client_name=$2 WHERE client_id=$1', [id, c.name]);
      return row;
    });
    await logAudit(req.user!.id, 'client', id, 'UPDATE', { summary: `Company ${updated.name} updated`, fields: Object.keys(c) });
    res.json(companyOut(updated));
  } catch (e) { handle(res, next, e); }
});

// ── People ───────────────────────────────────────────────────────────────────

router.post('/:id/contacts', manage, async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return fail(res, 400, 'VALIDATION', 'id must be a company id');
    const v = validateContactInput(req.body);
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const contact = await withTransaction(async db => {
      if (!(await db.query('SELECT 1 FROM clients WHERE id=$1', [id])).rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
      const hasPrimary = (await db.query('SELECT 1 FROM client_contacts WHERE client_id=$1 AND is_primary', [id])).rows[0];
      const input = { ...v.value, is_primary: v.value.is_primary ?? (!hasPrimary && !v.value.left_on) };
      return insertContact(db, id, input, req.user!.id);
    });
    await logAudit(req.user!.id, 'client', id, 'UPDATE', { summary: `${contact.name} added as a contact` });
    res.status(201).json(contact);
  } catch (e) { handle(res, next, e); }
});

router.patch('/:id/contacts/:contactId', manage, async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id); const contactId = String(req.params.contactId);
    if (!isUuid(id) || !isUuid(contactId)) return fail(res, 400, 'VALIDATION', 'Not a valid contact');
    const contact = await withTransaction(async db => {
      const current = (await db.query('SELECT * FROM client_contacts WHERE id=$1 AND client_id=$2 FOR UPDATE', [contactId, id])).rows[0];
      if (!current) throw new HttpError(404, 'NOT_FOUND', 'Contact not found');
      const v = validateContactInput(req.body, {
        email: current.email, phone: current.phone, mobile: current.mobile,
        left_on: current.left_on ? new Date(current.left_on).toISOString().slice(0, 10) : null,
      });
      if ('error' in v) throw new HttpError(400, 'VALIDATION', v.error);
      const c = v.value;
      if (c.is_primary && (c.left_on ?? (c.left_on === undefined ? current.left_on : null))) {
        throw new HttpError(400, 'VALIDATION', 'Someone who has left cannot be the primary contact');
      }
      if (c.left_on) c.is_primary = false;
      if (c.is_primary) await db.query('UPDATE client_contacts SET is_primary=false WHERE client_id=$1 AND is_primary AND id<>$2', [id, contactId]);
      const set: string[] = []; const values: any[] = [contactId];
      for (const key of ['name', 'email', 'phone', 'mobile', 'job_title', 'notes', 'is_primary', 'left_on'] as const) {
        if (c[key] !== undefined) { values.push(c[key]); set.push(`${key}=$${values.length}`); }
      }
      if (!set.length) throw new HttpError(400, 'VALIDATION', 'Nothing to change');
      values.push(req.user!.id);
      return (await db.query(`UPDATE client_contacts SET ${set.join(', ')}, updated_by=$${values.length}, updated_at=NOW() WHERE id=$1 RETURNING *`, values)).rows[0];
    });
    const what = req.body?.left === true ? 'marked as left' : req.body?.left === false ? 'marked as back' : 'updated';
    await logAudit(req.user!.id, 'client', id, 'UPDATE', { summary: `Contact ${contact.name} ${what}` });
    res.json(contact);
  } catch (e) { handle(res, next, e); }
});

router.delete('/:id/contacts/:contactId', manage, async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id); const contactId = String(req.params.contactId);
    if (!isUuid(id) || !isUuid(contactId)) return fail(res, 400, 'VALIDATION', 'Not a valid contact');
    const removed = (await query('DELETE FROM client_contacts WHERE id=$1 AND client_id=$2 RETURNING name', [contactId, id])).rows[0];
    if (!removed) return fail(res, 404, 'NOT_FOUND', 'Contact not found');
    await logAudit(req.user!.id, 'client', id, 'DELETE', { summary: `Contact ${removed.name} removed` });
    res.status(204).end();
  } catch (e) { handle(res, next, e); }
});

export default router;
