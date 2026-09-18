import { Router, Response } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../middleware/auth';
import { query, withTransaction } from '../db';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('business_development'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const BOOK_STATUSES = ['active', 'on_hold', 'won', 'lost', 'closed'];
const OPPORTUNITY_STATUSES = ['draft', 'active', 'in_review', 'won', 'lost', 'withdrawn'];
const OPPORTUNITY_KINDS = ['package_scope', 'sales_attempt'];

function bad(res: Response, message: string, field?: string) {
  return res.status(400).json({ error: { code: 'VALIDATION', message, ...(field ? { field } : {}) } });
}
function id(value: unknown, field: string) {
  return typeof value === 'string' && UUID.test(value) ? null : `${field} must be a valid UUID.`;
}
function required(value: unknown, field: string) {
  return typeof value === 'string' && value.trim() ? null : `${field} is required.`;
}
function currency(value: unknown, field: string) {
  return typeof value === 'string' && CURRENCY.test(value) ? null : `${field} must be a three-letter uppercase currency code.`;
}
function dateValue(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    return `${field} must be a valid date in YYYY-MM-DD format.`;
  }
  return null;
}

async function validateDesignBook(client: any, designBookId: string, projectId?: string | null) {
  const result = await client.query('SELECT id, project_id FROM design_books WHERE id=$1', [designBookId]);
  if (!result.rows[0]) return 'Design Book not found.';
  if (projectId && result.rows[0].project_id && result.rows[0].project_id !== projectId) {
    return 'Design Book must belong to the linked Project.';
  }
  return null;
}

async function nextNumber(client: any, key: string, prefix: string, width = 4) {
  await client.query(
    `INSERT INTO business_number_counters(counter_key, next_value) VALUES ($1, 2)
     ON CONFLICT (counter_key) DO UPDATE SET next_value=business_number_counters.next_value+1`,
    [key],
  );
  const row = await client.query('SELECT next_value - 1 AS value FROM business_number_counters WHERE counter_key=$1 FOR UPDATE', [key]);
  return `${prefix}${String(row.rows[0].value).padStart(width, '0')}`;
}

async function projectSnapshot(client: any, projectId: string) {
  const result = await client.query(
    `SELECT id, project_name, client_name, site_name, country, city
       FROM projects WHERE id=$1`,
    [projectId],
  );
  if (!result.rows[0]) return null;
  const p = result.rows[0];
  return {
    project_name: p.project_name || '',
    client_name: p.client_name || '',
    client_details: { name: p.client_name || '', site_name: p.site_name || '' },
    project_location: { site_name: p.site_name || '', country: p.country || '', city: p.city || '' },
  };
}

async function activity(client: any, bookId: string, actorId: string, action: string, details: any = {}, opportunityId?: string) {
  await client.query(
    `INSERT INTO business_book_activities(business_book_id, opportunity_id, action, details, actor_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [bookId, opportunityId || null, action, details, actorId],
  );
}

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 25));
    const params: any[] = [];
    const where: string[] = [];
    const search = String(req.query.search || '').trim();
    if (search) {
      params.push(`%${search}%`);
      where.push(`(b.book_number ILIKE $${params.length} OR b.title ILIKE $${params.length} OR b.client_name ILIKE $${params.length})`);
    }
    if (req.query.status) { params.push(String(req.query.status)); where.push(`b.status=$${params.length}`); }
    if (req.query.owner_id) { const error = id(req.query.owner_id, 'owner_id'); if (error) return bad(res, error, 'owner_id'); params.push(req.query.owner_id); where.push(`b.owner_id=$${params.length}`); }
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await query(`SELECT COUNT(*)::int AS count FROM business_books b ${predicate}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await query(
       `SELECT b.*, p.project_code, p.project_name, d.book_code AS design_book_code,
               (SELECT COUNT(*)::int FROM business_opportunities o WHERE o.business_book_id=b.id) AS opportunity_count,
               COALESCE((SELECT json_agg(json_build_object(
                 'id', o.id,
                 'status', o.status,
                 'expected_value', o.expected_value,
                 'expected_currency', o.expected_currency
               )) FROM business_opportunities o WHERE o.business_book_id=b.id), '[]'::json) AS opportunities
         FROM business_books b
         LEFT JOIN projects p ON p.id=b.project_id
         LEFT JOIN design_books d ON d.id=b.design_book_id
         ${predicate} ORDER BY b.updated_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: rows.rows, pagination: { page, page_size: pageSize, total: count.rows[0].count } });
  } catch (error) { next(error); }
});

router.post('/', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    const body = req.body || {};
    if (!body.project_id) {
      const titleError = required(body.title, 'title'); if (titleError) return bad(res, titleError, 'title');
      const clientError = required(body.client_name, 'client_name'); if (clientError) return bad(res, clientError, 'client_name');
    }
    if (body.reporting_currency && currency(body.reporting_currency, 'reporting_currency')) return bad(res, currency(body.reporting_currency, 'reporting_currency')!, 'reporting_currency');
    if (body.status && !BOOK_STATUSES.includes(body.status)) return bad(res, 'Invalid Business Book status.', 'status');
    if (body.project_id && id(body.project_id, 'project_id')) return bad(res, id(body.project_id, 'project_id')!, 'project_id');
    if (body.design_book_id && id(body.design_book_id, 'design_book_id')) return bad(res, id(body.design_book_id, 'design_book_id')!, 'design_book_id');
    if (body.owner_id && id(body.owner_id, 'owner_id')) return bad(res, id(body.owner_id, 'owner_id')!, 'owner_id');
    const result = await withTransaction(async client => {
      let title = typeof body.title === 'string' ? body.title.trim() : '';
      let clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
      let details = body.client_details || {};
      let location = body.project_location || {};
      if (body.project_id) {
        const snapshot = await projectSnapshot(client, body.project_id);
        if (!snapshot) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'NOT_FOUND' });
        title = snapshot.project_name || title;
        clientName = snapshot.client_name || clientName; details = snapshot.client_details; location = snapshot.project_location;
      }
      if (body.design_book_id) {
        const designError = await validateDesignBook(client, body.design_book_id, body.project_id || null);
        if (designError) throw Object.assign(new Error(designError), { status: 400, code: 'INVALID_REFERENCE' });
      }
      const year = new Date().getUTCFullYear();
      const bookNumber = await nextNumber(client, `book:${year}`, `BD-${year}-`);
      const inserted = await client.query(
        `INSERT INTO business_books(book_number,title,project_id,design_book_id,client_name,client_details,project_location,owner_id,reporting_currency,status,notes,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
        [bookNumber, title, body.project_id || null, body.design_book_id || null, clientName, details, location, body.owner_id || req.user!.id, body.reporting_currency || 'USD', body.status || 'active', body.notes || null, req.user!.id],
      );
      await activity(client, inserted.rows[0].id, req.user!.id, 'created', { linked_project_id: body.project_id || null });
      return inserted.rows[0];
    });
    res.status(201).json(result);
  } catch (error: any) { if (error.status) return res.status(error.status).json({ error: { code: error.code || 'ERROR', message: error.message } }); next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (id(req.params.id, 'id')) return bad(res, id(req.params.id, 'id')!, 'id');
    const book = await query(
      `SELECT b.*, p.project_code, p.project_name, d.book_code AS design_book_code, d.book_title AS design_book_title
         FROM business_books b LEFT JOIN projects p ON p.id=b.project_id LEFT JOIN design_books d ON d.id=b.design_book_id WHERE b.id=$1`,
      [req.params.id],
    );
    if (!book.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Business Book not found.' } });
    const opportunities = await query('SELECT * FROM business_opportunities WHERE business_book_id=$1 ORDER BY created_at', [req.params.id]);
    const activities = await query('SELECT * FROM business_book_activities WHERE business_book_id=$1 ORDER BY created_at DESC LIMIT 100', [req.params.id]);
    res.json({ ...book.rows[0], opportunities: opportunities.rows, activities: activities.rows });
  } catch (error) { next(error); }
});

router.patch('/:id', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    if (id(req.params.id, 'id')) return bad(res, id(req.params.id, 'id')!, 'id');
    const body = req.body || {};
    if (body.title !== undefined && required(body.title, 'title')) return bad(res, required(body.title, 'title')!, 'title');
    if (body.status !== undefined && !BOOK_STATUSES.includes(body.status)) return bad(res, 'Invalid Business Book status.', 'status');
    if (body.reporting_currency !== undefined && currency(body.reporting_currency, 'reporting_currency')) return bad(res, currency(body.reporting_currency, 'reporting_currency')!, 'reporting_currency');
    if (body.project_id && id(body.project_id, 'project_id')) return bad(res, id(body.project_id, 'project_id')!, 'project_id');
    if (body.design_book_id && id(body.design_book_id, 'design_book_id')) return bad(res, id(body.design_book_id, 'design_book_id')!, 'design_book_id');
    if (body.owner_id && id(body.owner_id, 'owner_id')) return bad(res, id(body.owner_id, 'owner_id')!, 'owner_id');
    const result = await withTransaction(async client => {
      const current = await client.query('SELECT * FROM business_books WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rows[0]) throw Object.assign(new Error('Business Book not found.'), { status: 404, code: 'NOT_FOUND' });
      const changes: any = { ...body };
      let snapshotDetails = current.rows[0].client_details, snapshotLocation = current.rows[0].project_location, clientName = body.client_name ?? current.rows[0].client_name;
      let projectTitle: string | null = null;
      if (body.project_id !== undefined && body.project_id !== current.rows[0].project_id) {
        if (body.project_id) {
          if (id(body.project_id, 'project_id')) throw Object.assign(new Error('project_id must be a valid UUID.'), { status: 400, code: 'VALIDATION' });
          const snapshot = await projectSnapshot(client, body.project_id);
          if (!snapshot) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'NOT_FOUND' });
          projectTitle = snapshot.project_name || current.rows[0].title;
          clientName = snapshot.client_name || clientName; snapshotDetails = snapshot.client_details; snapshotLocation = snapshot.project_location;
        }
        changes.project_id = body.project_id || null;
      }
      const effectiveProjectId = body.project_id !== undefined ? body.project_id : current.rows[0].project_id;
      if (body.design_book_id !== undefined && body.design_book_id !== null) {
        const designError = await validateDesignBook(client, body.design_book_id, effectiveProjectId);
        if (designError) throw Object.assign(new Error(designError), { status: 400, code: 'INVALID_REFERENCE' });
      } else if (body.design_book_id === undefined && effectiveProjectId && current.rows[0].design_book_id) {
        const designError = await validateDesignBook(client, current.rows[0].design_book_id, effectiveProjectId);
        if (designError) throw Object.assign(new Error(designError), { status: 400, code: 'INVALID_REFERENCE' });
      }
      const set: string[] = [], values: any[] = [req.params.id];
      const put = (column: string, value: any) => { values.push(value); set.push(`${column}=$${values.length}`); };
      if (projectTitle !== null) put('title', projectTitle);
      else if (body.title !== undefined) put('title', body.title.trim());
      if (body.project_id !== undefined) put('project_id', body.project_id);
      if (body.design_book_id !== undefined) put('design_book_id', body.design_book_id);
      if (body.project_id !== undefined && body.project_id) { put('client_name', clientName); put('client_details', snapshotDetails); put('project_location', snapshotLocation); }
      else {
        if (body.client_name !== undefined) put('client_name', clientName);
        if (body.client_details !== undefined) put('client_details', body.client_details ?? {});
        if (body.project_location !== undefined) put('project_location', body.project_location ?? {});
      }
      if (body.owner_id !== undefined) put('owner_id', body.owner_id);
      if (body.reporting_currency !== undefined) put('reporting_currency', body.reporting_currency);
      if (body.status !== undefined) put('status', body.status);
      if (body.notes !== undefined) put('notes', body.notes);
      put('updated_by', req.user!.id);
      set.push('updated_at=NOW()');
      const updated = await client.query(`UPDATE business_books SET ${set.join(', ')} WHERE id=$1 RETURNING *`, values);
      await activity(client, String(req.params.id), req.user!.id, body.status && body.status !== current.rows[0].status ? 'status_changed' : (body.project_id !== undefined && body.project_id !== current.rows[0].project_id ? 'linked' : 'updated'), { changes });
      return updated.rows[0];
    });
    res.json(result);
  } catch (error: any) { if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } }); next(error); }
});

router.post('/:id/opportunities', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    if (id(req.params.id, 'id')) return bad(res, id(req.params.id, 'id')!, 'id');
    const body = req.body || {};
    const requiredError = required(body.title, 'title'); if (requiredError) return bad(res, requiredError, 'title');
    if (body.kind && !OPPORTUNITY_KINDS.includes(body.kind)) return bad(res, 'Invalid opportunity kind.', 'kind');
    if (body.status && !OPPORTUNITY_STATUSES.includes(body.status)) return bad(res, 'Invalid opportunity status.', 'status');
    const probability = body.probability === undefined ? 0 : Number(body.probability);
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) return bad(res, 'Probability must be between 0 and 100.', 'probability');
    if (body.expected_currency && currency(body.expected_currency, 'expected_currency')) return bad(res, currency(body.expected_currency, 'expected_currency')!, 'expected_currency');
    if (body.owner_id && id(body.owner_id, 'owner_id')) return bad(res, id(body.owner_id, 'owner_id')!, 'owner_id');
    if (body.expected_value !== undefined && (body.expected_value === '' || !Number.isFinite(Number(body.expected_value)))) return bad(res, 'Expected value must be a number.', 'expected_value');
    if (body.expected_decision_date && dateValue(body.expected_decision_date, 'expected_decision_date')) return bad(res, dateValue(body.expected_decision_date, 'expected_decision_date')!, 'expected_decision_date');
    const result = await withTransaction(async client => {
      const book = await client.query('SELECT book_number FROM business_books WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!book.rows[0]) throw Object.assign(new Error('Business Book not found.'), { status: 404, code: 'NOT_FOUND' });
      const number = await nextNumber(client, `opportunity:${req.params.id}`, `${book.rows[0].book_number}-OP`, 2);
      const inserted = await client.query(
        `INSERT INTO business_opportunities(business_book_id,opportunity_number,title,description,kind,status,owner_id,probability,expected_decision_date,expected_value,expected_currency,outcome_notes,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [req.params.id, number, body.title.trim(), body.description || null, body.kind || 'package_scope', body.status || 'draft', body.owner_id || req.user!.id, probability, body.expected_decision_date || null, body.expected_value ?? null, body.expected_currency || null, body.outcome_notes || null, req.user!.id],
      );
      await activity(client, String(req.params.id), req.user!.id, 'opportunity_created', { opportunity_number: number }, inserted.rows[0].id);
      return inserted.rows[0];
    });
    res.status(201).json(result);
  } catch (error: any) { if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } }); next(error); }
});

router.patch('/:id/opportunities/:opportunityId', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    if (id(req.params.id, 'id')) return bad(res, id(req.params.id, 'id')!, 'id');
    if (id(req.params.opportunityId, 'opportunityId')) return bad(res, id(req.params.opportunityId, 'opportunityId')!, 'opportunityId');
    const result = await withTransaction(async client => {
      const current = await client.query('SELECT * FROM business_opportunities WHERE id=$1 AND business_book_id=$2 FOR UPDATE', [req.params.opportunityId, req.params.id]);
      if (!current.rows[0]) throw Object.assign(new Error('Opportunity not found.'), { status: 404, code: 'NOT_FOUND' });
      const body = req.body || {};
      if (body.title !== undefined && required(body.title, 'title')) throw Object.assign(new Error('title is required.'), { status: 400, code: 'VALIDATION' });
      if (body.status !== undefined && !OPPORTUNITY_STATUSES.includes(body.status)) throw Object.assign(new Error('Invalid opportunity status.'), { status: 400, code: 'VALIDATION' });
      if (body.kind !== undefined && !OPPORTUNITY_KINDS.includes(body.kind)) throw Object.assign(new Error('Invalid opportunity kind.'), { status: 400, code: 'VALIDATION' });
      if (body.expected_currency !== undefined && body.expected_currency !== null && currency(body.expected_currency, 'expected_currency')) throw Object.assign(new Error(currency(body.expected_currency, 'expected_currency')!), { status: 400, code: 'VALIDATION' });
      if (body.expected_decision_date !== undefined && body.expected_decision_date !== null && dateValue(body.expected_decision_date, 'expected_decision_date')) throw Object.assign(new Error(dateValue(body.expected_decision_date, 'expected_decision_date')!), { status: 400, code: 'VALIDATION' });
      if (body.expected_value !== undefined && body.expected_value !== null && (body.expected_value === '' || !Number.isFinite(Number(body.expected_value)))) throw Object.assign(new Error('Expected value must be a number.'), { status: 400, code: 'VALIDATION' });
      const probability = body.probability === undefined ? current.rows[0].probability : Number(body.probability);
      if (!Number.isFinite(probability) || probability < 0 || probability > 100) throw Object.assign(new Error('Probability must be between 0 and 100.'), { status: 400, code: 'VALIDATION' });
      const set: string[] = [], values: any[] = [req.params.opportunityId, req.params.id];
      const put = (column: string, value: any) => { values.push(value); set.push(`${column}=$${values.length}`); };
      if (body.title !== undefined) put('title', body.title.trim());
      if (body.description !== undefined) put('description', body.description);
      if (body.kind !== undefined) put('kind', body.kind);
      if (body.status !== undefined) put('status', body.status);
      if (body.owner_id !== undefined) put('owner_id', body.owner_id);
      if (body.probability !== undefined) put('probability', probability);
      if (body.expected_decision_date !== undefined) put('expected_decision_date', body.expected_decision_date);
      if (body.expected_value !== undefined) put('expected_value', body.expected_value);
      if (body.expected_currency !== undefined) put('expected_currency', body.expected_currency);
      if (body.outcome_notes !== undefined) put('outcome_notes', body.outcome_notes);
      put('updated_by', req.user!.id); set.push('updated_at=NOW()');
      const updated = await client.query(
        `UPDATE business_opportunities SET ${set.join(', ')} WHERE id=$1 AND business_book_id=$2 RETURNING *`, values,
      );
      await activity(client, String(req.params.id), req.user!.id, body.status && body.status !== current.rows[0].status ? 'status_changed' : 'opportunity_updated', { changes: body }, String(req.params.opportunityId));
      return updated.rows[0];
    });
    res.json(result);
  } catch (error: any) { if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } }); next(error); }
});

export default router;