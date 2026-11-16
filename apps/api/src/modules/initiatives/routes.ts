// Initiatives API (/api/v1/initiatives): internal work with owner, sponsor, stage, hours and costs.
// Anyone with the Initiatives module can look and propose an idea; changes follow ./validation rules.
import { NextFunction, Response, Router } from 'express';
import { authenticate, AuthRequest, requireModuleAccess } from '../../middleware/auth';
import { query, withTransaction } from '../../db';
import { logAudit } from '../../db/audit';
import {
  acceptsTime, Actor, canEdit, COST_CATEGORIES, INITIATIVE_TYPES, isUuid, LINK_TYPES, Stage, stageChangeProblem, STAGES,
  validateCost, validateInitiativeInput, validateTimeEntry,
} from './validation';

const router = Router();
router.use(authenticate, requireModuleAccess('initiatives'));

class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
function handle(res: Response, next: NextFunction, e: any) {
  if (e instanceof HttpError) return fail(res, e.status, e.code, e.message);
  if (e?.code === '23503') return fail(res, 400, 'VALIDATION', 'The chosen person, team or company no longer exists.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'Those values are not allowed (check dates and amounts).');
  if (e?.code === '23505') return fail(res, 409, 'CONFLICT', 'That is already linked.');
  return next(e);
}

const NAME = (a: string) => `NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.last_name)), '')`;
/**
 * Cost lines converted to the initiative's currency with the platform rates (per USD). A line in
 * another currency without a rate is left out of the total and counted in cost_unconverted.
 */
const COST_FROM = `FROM initiative_costs c
  LEFT JOIN platform_exchange_rates rc ON rc.currency_code = c.currency
  LEFT JOIN platform_exchange_rates ri ON ri.currency_code = i.currency
  WHERE c.initiative_id = i.id`;
const CONVERTIBLE = `(c.currency = i.currency OR (rc.rate_per_usd IS NOT NULL AND ri.rate_per_usd IS NOT NULL))`;
const COST_TOTAL = `(SELECT COALESCE(SUM(CASE WHEN c.currency = i.currency THEN c.amount
    WHEN ${CONVERTIBLE} THEN c.amount / rc.rate_per_usd * ri.rate_per_usd ELSE 0 END), 0)::float8 ${COST_FROM}) AS cost_total,
  (SELECT COUNT(*) FILTER (WHERE NOT ${CONVERTIBLE})::int ${COST_FROM}) AS cost_unconverted`;
const SUMMARY = `
  SELECT i.*,
    -- Plain dates as text: as Date objects they would shift a day in time zones ahead of UTC.
    to_char(i.start_date, 'YYYY-MM-DD') AS start_date, to_char(i.target_date, 'YYYY-MM-DD') AS target_date,
    ${NAME('o')} AS owner_name, ${NAME('s')} AS sponsor_name, t.name AS team_name, t.department,
    (SELECT COALESCE(SUM(hours), 0)::float8 FROM initiative_time_entries te WHERE te.initiative_id = i.id) AS logged_hours,
    (SELECT COALESCE(SUM(planned_hours), 0)::float8 FROM planning_personal_tasks pt WHERE pt.initiative_id = i.id) AS task_hours,
    (SELECT COUNT(*) FROM planning_personal_tasks pt WHERE pt.initiative_id = i.id)::int AS task_count,
    (SELECT COUNT(*) FROM planning_personal_tasks pt WHERE pt.initiative_id = i.id AND pt.status = 'done')::int AS tasks_done,
    ${COST_TOTAL}
  FROM initiatives i
  LEFT JOIN users o ON o.id = i.owner_user_id
  LEFT JOIN users s ON s.id = i.sponsor_user_id
  LEFT JOIN drafting_teams t ON t.id = i.team_id`;

async function managesInitiatives(req: AuthRequest): Promise<boolean> {
  if (req.user!.role === 'admin') return true;
  const r = await query(`SELECT rma.access_level FROM role_module_access rma JOIN roles r ON r.id = rma.role_id
    WHERE r.name = $1 AND rma.module_key = 'initiatives'`, [req.user!.role]);
  return (r.rows[0]?.access_level ?? 'manage') === 'manage';
}

async function load(id: string) {
  if (!isUuid(id)) throw new HttpError(400, 'VALIDATION', 'Not a valid initiative');
  const row = (await query(`${SUMMARY} WHERE i.id = $1`, [id])).rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Initiative not found');
  return row;
}

async function actorFor(req: AuthRequest, row: any): Promise<Actor> {
  const me = req.user!.id;
  return {
    isAdmin: req.user!.role === 'admin', manages: await managesInitiatives(req),
    isOwner: row.owner_user_id === me, isSponsor: row.sponsor_user_id === me, isCreator: row.created_by === me,
  };
}

async function nextCode(db: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }) {
  const year = new Date().getUTCFullYear();
  await db.query(`INSERT INTO enquiry_number_counters(counter_key,next_value) VALUES ($1,2)
    ON CONFLICT (counter_key) DO UPDATE SET next_value=enquiry_number_counters.next_value+1`, [`initiative:${year}`]);
  const n = await db.query('SELECT next_value-1 AS value FROM enquiry_number_counters WHERE counter_key=$1', [`initiative:${year}`]);
  return `INT-${year}-${String(n.rows[0].value).padStart(3, '0')}`;
}

router.get('/options', (_req, res) => {
  res.json({ types: INITIATIVE_TYPES, stages: STAGES, cost_categories: COST_CATEGORIES, link_types: LINK_TYPES });
});

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const where: string[] = []; const params: any[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace(/\$\?/g, `$${params.length}`)); };
    const s = String(req.query.search ?? '').trim();
    if (s) add('(i.title ILIKE $? OR i.code ILIKE $? OR i.goal ILIKE $?)', `%${s}%`);
    if (req.query.type && (INITIATIVE_TYPES as readonly string[]).includes(String(req.query.type))) add('i.type = $?', req.query.type);
    if (req.query.stage && (STAGES as readonly string[]).includes(String(req.query.stage))) add('i.stage = $?', req.query.stage);
    if (req.query.mine === '1') add('($?::uuid IN (i.owner_user_id, i.sponsor_user_id, i.created_by))', req.user!.id);
    if (isUuid(req.query.team_id)) add('i.team_id = $?', req.query.team_id);
    const rows = (await query(`${SUMMARY} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.target_date NULLS LAST, i.code`, params)).rows;
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const v = validateInitiativeInput(req.body, true);
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const i = v.value;
    const manages = await managesInitiatives(req);
    // Managers may start work straight away; everyone else proposes an idea.
    const stage: Stage = manages && (['approved', 'in_progress'] as string[]).includes(req.body?.stage) ? req.body.stage : 'idea';
    const created = await withTransaction(async db => {
      const code = await nextCode(db);
      const row = (await db.query(
        `INSERT INTO initiatives (code, title, goal, description, type, priority, stage, owner_user_id, sponsor_user_id, team_id,
           start_date, target_date, estimated_hours, budget_amount, currency, outcome, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id, code, title`,
        [code, i.title, i.goal ?? null, i.description ?? null, i.type ?? 'process_improvement', i.priority ?? 'medium', stage,
          i.owner_user_id === undefined ? req.user!.id : i.owner_user_id, i.sponsor_user_id ?? null, i.team_id ?? null,
          i.start_date ?? null, i.target_date ?? null, i.estimated_hours ?? null, i.budget_amount ?? null, i.currency ?? 'USD',
          i.outcome ?? null, req.user!.id])).rows[0];
      await db.query(`INSERT INTO initiative_events (initiative_id, from_stage, to_stage, note, actor_id) VALUES ($1, NULL, $2, $3, $4)`,
        [row.id, stage, stage === 'idea' ? 'Proposed' : 'Created', req.user!.id]);
      return row;
    });
    await logAudit(req.user!.id, 'initiative', created.id, 'CREATE', { summary: `${created.code} ${created.title} ${stage === 'idea' ? 'proposed' : 'created'}` });
    res.status(201).json(await load(created.id));
  } catch (e) { handle(res, next, e); }
});

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    const id = row.id;
    const [events, time, costs, links, tasks, byPerson] = await Promise.all([
      query(`SELECT e.*, ${NAME('u')} AS actor_name FROM initiative_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.initiative_id = $1 ORDER BY e.created_at DESC`, [id]),
      query(`SELECT te.id, to_char(te.work_date, 'YYYY-MM-DD') AS work_date, te.hours::float8 AS hours, te.note, te.user_id, ${NAME('u')} AS user_name
             FROM initiative_time_entries te JOIN users u ON u.id = te.user_id WHERE te.initiative_id = $1 ORDER BY te.work_date DESC, te.created_at DESC LIMIT 200`, [id]),
      query(`SELECT c.id, to_char(c.cost_date, 'YYYY-MM-DD') AS cost_date, c.category, c.description, c.amount::float8 AS amount, c.currency,
               c.supplier_client_id, cl.name AS supplier_name FROM initiative_costs c LEFT JOIN clients cl ON cl.id = c.supplier_client_id
             WHERE c.initiative_id = $1 ORDER BY c.cost_date DESC, c.created_at DESC`, [id]),
      query(`SELECT l.id, l.entity_type, l.entity_id, l.note,
               COALESCE(pm.product_name, pf.product_family_name, d.document_title, p.project_name, cl.name) AS label,
               COALESCE(pm.product_code, d.document_code, p.project_code, cl.client_code) AS code
             FROM initiative_links l
             LEFT JOIN product_masters pm ON l.entity_type = 'product' AND pm.id = l.entity_id
             LEFT JOIN product_families pf ON l.entity_type = 'product_family' AND pf.id = l.entity_id
             LEFT JOIN documents d ON l.entity_type = 'document' AND d.id = l.entity_id
             LEFT JOIN projects p ON l.entity_type = 'project' AND p.id = l.entity_id
             LEFT JOIN clients cl ON l.entity_type = 'client' AND cl.id = l.entity_id
             WHERE l.initiative_id = $1 ORDER BY l.created_at`, [id]),
      query(`SELECT t.id, t.title, t.status, t.progress_pct, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.planned_hours::float8 AS planned_hours,
               t.user_id, ${NAME('u')} AS user_name
             FROM planning_personal_tasks t JOIN users u ON u.id = t.user_id WHERE t.initiative_id = $1 ORDER BY t.status = 'done', t.due_date NULLS LAST`, [id]),
      query(`SELECT te.user_id, ${NAME('u')} AS user_name, SUM(te.hours)::float8 AS hours
             FROM initiative_time_entries te JOIN users u ON u.id = te.user_id WHERE te.initiative_id = $1 GROUP BY 1, 2 ORDER BY 3 DESC`, [id]),
    ]);
    const a = await actorFor(req, row);
    res.json({
      ...row, events: events.rows, time_entries: time.rows, hours_by_person: byPerson.rows, costs: costs.rows,
      links: links.rows, tasks: tasks.rows,
      can: { edit: canEdit(a, row.stage), decide: a.isAdmin || a.manages || a.isSponsor, log_time: acceptsTime(row.stage), manage: a.isAdmin || a.manages },
    });
  } catch (e) { handle(res, next, e); }
});

router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    if (!canEdit(await actorFor(req, row), row.stage)) throw new HttpError(403, 'FORBIDDEN', 'Only the owner, the sponsor or a manager can change this initiative');
    const v = validateInitiativeInput(req.body, false);
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const keys = Object.keys(v.value) as Array<keyof typeof v.value>;
    if (!keys.length) return fail(res, 400, 'VALIDATION', 'Nothing to change');
    const values: any[] = [row.id]; const set = keys.map(k => { values.push(v.value[k]); return `${k} = $${values.length}`; });
    values.push(req.user!.id);
    await query(`UPDATE initiatives SET ${set.join(', ')}, updated_by = $${values.length}, updated_at = NOW() WHERE id = $1`, values);
    await logAudit(req.user!.id, 'initiative', row.id, 'UPDATE', { summary: `${row.code} updated`, fields: keys });
    res.json(await load(row.id));
  } catch (e) { handle(res, next, e); }
});

router.post('/:id/stage', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    const to = req.body?.stage as Stage;
    if (!(STAGES as readonly string[]).includes(to)) return fail(res, 400, 'VALIDATION', 'Choose a stage');
    const problem = stageChangeProblem(row.stage, to, await actorFor(req, row));
    if (problem) throw new HttpError(problem.startsWith('Only') ? 403 : 400, problem.startsWith('Only') ? 'FORBIDDEN' : 'VALIDATION', problem);
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 2000) : null;
    await withTransaction(async db => {
      await db.query(`UPDATE initiatives SET stage = $2::text, updated_by = $3, updated_at = NOW(),
          completed_at = CASE WHEN $2::text = 'done' THEN COALESCE(completed_at, NOW()) WHEN $2::text = 'dropped' THEN completed_at ELSE NULL END,
          start_date = CASE WHEN $2::text = 'in_progress' THEN COALESCE(start_date, CURRENT_DATE) ELSE start_date END
        WHERE id = $1`, [row.id, to, req.user!.id]);
      await db.query(`INSERT INTO initiative_events (initiative_id, from_stage, to_stage, note, actor_id) VALUES ($1,$2,$3,$4,$5)`, [row.id, row.stage, to, note, req.user!.id]);
    });
    await logAudit(req.user!.id, 'initiative', row.id, 'UPDATE', { summary: `${row.code} moved from ${row.stage} to ${to}${note ? `: ${note}` : ''}` });
    res.json(await load(row.id));
  } catch (e) { handle(res, next, e); }
});

// ── Hours ──
router.post('/:id/time', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    if (!acceptsTime(row.stage)) throw new HttpError(400, 'VALIDATION', row.stage === 'idea' ? 'Hours can be logged once the idea is approved' : 'This initiative was dropped');
    const v = validateTimeEntry(req.body);
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const entry = (await query(`INSERT INTO initiative_time_entries (initiative_id, user_id, work_date, hours, note) VALUES ($1,$2,$3,$4,$5)
      RETURNING id, to_char(work_date, 'YYYY-MM-DD') AS work_date, hours::float8 AS hours, note`,
      [row.id, req.user!.id, v.value.work_date, v.value.hours, v.value.note])).rows[0];
    res.status(201).json(entry);
  } catch (e) { handle(res, next, e); }
});

router.delete('/:id/time/:entryId', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    const entryId = String(req.params.entryId);
    if (!isUuid(entryId)) return fail(res, 400, 'VALIDATION', 'Not a valid entry');
    const a = await actorFor(req, row);
    const r = await query(`DELETE FROM initiative_time_entries WHERE id = $1 AND initiative_id = $2 AND ($3 OR user_id = $4) RETURNING id`,
      [entryId, row.id, a.isAdmin || a.manages, req.user!.id]);
    if (!r.rows[0]) return fail(res, 404, 'NOT_FOUND', 'Entry not found (you can remove your own hours)');
    res.status(204).end();
  } catch (e) { handle(res, next, e); }
});

// ── Costs ──
router.post('/:id/costs', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    if (!canEdit(await actorFor(req, row), row.stage)) throw new HttpError(403, 'FORBIDDEN', 'Only the owner, the sponsor or a manager can record costs');
    const v = validateCost(req.body, row.currency);
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const c = v.value;
    const cost = (await query(`INSERT INTO initiative_costs (initiative_id, cost_date, category, description, amount, currency, supplier_client_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [row.id, c.cost_date, c.category, c.description, c.amount, c.currency, c.supplier_client_id, req.user!.id])).rows[0];
    await logAudit(req.user!.id, 'initiative', row.id, 'UPDATE', { summary: `${row.code}: cost ${c.amount} ${c.currency} (${c.description})` });
    res.status(201).json(cost);
  } catch (e) { handle(res, next, e); }
});

router.delete('/:id/costs/:costId', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    if (!canEdit(await actorFor(req, row), row.stage)) throw new HttpError(403, 'FORBIDDEN', 'Only the owner, the sponsor or a manager can remove costs');
    const r = await query('DELETE FROM initiative_costs WHERE id = $1 AND initiative_id = $2 RETURNING description', [String(req.params.costId), row.id]);
    if (!r.rows[0]) return fail(res, 404, 'NOT_FOUND', 'Cost not found');
    res.status(204).end();
  } catch (e) { handle(res, next, e); }
});

// ── Outcomes and related records ──
const LINK_TABLE: Record<string, string> = { product: 'product_masters', product_family: 'product_families', document: 'documents', project: 'projects', client: 'clients' };
router.post('/:id/links', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    if (!canEdit(await actorFor(req, row), row.stage)) throw new HttpError(403, 'FORBIDDEN', 'Only the owner, the sponsor or a manager can link records');
    const type = String(req.body?.entity_type ?? '');
    if (!(LINK_TYPES as readonly string[]).includes(type)) return fail(res, 400, 'VALIDATION', 'Choose what to link');
    if (!isUuid(req.body?.entity_id)) return fail(res, 400, 'VALIDATION', 'Choose the record to link');
    if (!(await query(`SELECT 1 FROM ${LINK_TABLE[type]} WHERE id = $1`, [req.body.entity_id])).rows[0]) return fail(res, 404, 'NOT_FOUND', 'That record does not exist');
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;
    const link = (await query(`INSERT INTO initiative_links (initiative_id, entity_type, entity_id, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [row.id, type, req.body.entity_id, note, req.user!.id])).rows[0];
    res.status(201).json(link);
  } catch (e) { handle(res, next, e); }
});

router.delete('/:id/links/:linkId', async (req: AuthRequest, res, next) => {
  try {
    const row = await load(String(req.params.id));
    if (!canEdit(await actorFor(req, row), row.stage)) throw new HttpError(403, 'FORBIDDEN', 'Only the owner, the sponsor or a manager can unlink records');
    const r = await query('DELETE FROM initiative_links WHERE id = $1 AND initiative_id = $2 RETURNING id', [String(req.params.linkId), row.id]);
    if (!r.rows[0]) return fail(res, 404, 'NOT_FOUND', 'Link not found');
    res.status(204).end();
  } catch (e) { handle(res, next, e); }
});

export default router;
