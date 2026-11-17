// Bids API (/api/v1/bids): the pipeline, and per enquiry the bid details, the bid/no-bid decision,
// stage changes with their rules, and the bid team. Business Development access to look; manage
// to change.
import { NextFunction, Response, Router } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../../middleware/auth';
import { query, withTransaction } from '../../db';
import {
  DECISIONS, DEFAULT_PROBABILITY, effectiveProbability, isUuid, OPEN_STAGES, OUTCOME_REASONS, Stage, stageProblem, STAGES, validateBidInput,
} from './rules';

const router = Router();
router.use(authenticate, requireModuleAccess('business_development'));
const manage = requireModuleManage('business_development');

class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
function handle(res: Response, next: NextFunction, e: any) {
  if (e instanceof HttpError) return fail(res, e.status, e.code, e.message);
  if (e?.code === '23503') return fail(res, 400, 'VALIDATION', 'The chosen person no longer exists.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'Those values are not allowed.');
  return next(e);
}
const NAME = (a: string) => `NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.last_name)), '')`;
const activity = (db: { query: (s: string, p?: any[]) => Promise<unknown> }, enquiryId: string, actor: string, action: string, details: Record<string, unknown>) =>
  db.query('INSERT INTO enquiry_activities (enquiry_id, action, details, actor_id) VALUES ($1,$2,$3,$4)', [enquiryId, action, details, actor]);

async function loadEnquiry(id: string, db: { query: (s: string, p?: any[]) => Promise<{ rows: any[] }> } = { query }, lock = false) {
  if (!isUuid(id)) throw new HttpError(400, 'VALIDATION', 'Not a valid enquiry');
  const row = (await db.query(`SELECT * FROM enquiries WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Enquiry not found');
  return row;
}

router.get('/options', (_req, res) => {
  res.json({ stages: STAGES, open_stages: OPEN_STAGES, decisions: DECISIONS, outcome_reasons: OUTCOME_REASONS, default_probability: DEFAULT_PROBABILITY });
});

/**
 * The pipeline: open enquiries and those decided in the last 90 days, with value in USD (platform
 * rates) and the weighted value (value × win chance). ?mine=1: ones I own or am on the team of.
 */
router.get('/pipeline', async (req: AuthRequest, res, next) => {
  try {
    const params: any[] = [];
    let mine = '';
    if (req.query.mine === '1') { params.push(req.user!.id); mine = `AND (e.bid_owner_user_id = $1 OR EXISTS (SELECT 1 FROM enquiry_bid_team t WHERE t.enquiry_id = e.id AND t.user_id = $1))`; }
    const rows = (await query(`
      SELECT e.id, e.enquiry_number, e.title, e.status, e.enquiry_type, e.bid_decision, e.win_probability,
        e.estimated_value::float8 AS estimated_value, e.value_currency, to_char(e.due_date, 'YYYY-MM-DD') AS due_date,
        to_char(e.submitted_on, 'YYYY-MM-DD') AS submitted_on, e.outcome_reason, e.project_id, e.updated_at,
        e.client_id, c.name AS client_name, e.bid_owner_user_id, ${NAME('o')} AS owner_name,
        CASE WHEN e.estimated_value IS NULL THEN NULL
             WHEN e.value_currency = 'USD' THEN e.estimated_value::float8
             WHEN r.rate_per_usd IS NULL THEN NULL
             ELSE (e.estimated_value / r.rate_per_usd)::float8 END AS value_usd,
        (SELECT COUNT(*) FROM enquiry_bid_team t WHERE t.enquiry_id = e.id)::int AS team_size
      FROM enquiries e
      JOIN clients c ON c.id = e.client_id
      LEFT JOIN users o ON o.id = e.bid_owner_user_id
      LEFT JOIN platform_exchange_rates r ON r.currency_code = e.value_currency
      WHERE (e.status IN ('new','qualifying','bidding','submitted') OR e.updated_at >= NOW() - INTERVAL '90 days') ${mine}
      ORDER BY e.due_date NULLS LAST, e.enquiry_number`, params)).rows
      .map(r => ({ ...r, probability: effectiveProbability(r.status as Stage, r.win_probability) }));
    const summary = STAGES.map(stage => {
      const inStage = rows.filter(r => r.status === stage);
      const valued = inStage.filter(r => r.value_usd != null);
      return {
        stage, count: inStage.length,
        value_usd: Math.round(valued.reduce((s, r) => s + r.value_usd, 0)),
        weighted_usd: Math.round(valued.reduce((s, r) => s + r.value_usd * r.probability / 100, 0)),
        unvalued: inStage.length - valued.length,
      };
    });
    res.json({ data: rows, summary });
  } catch (e) { next(e); }
});

/** Bid details for one enquiry: decision with who and when, owner, team. */
router.get('/:id', async (req, res, next) => {
  try {
    const e = await loadEnquiry(String(req.params.id));
    const [decider, owner, team] = await Promise.all([
      e.bid_decided_by ? query(`SELECT u.id, ${NAME('u')} AS name FROM users u WHERE u.id = $1`, [e.bid_decided_by]) : Promise.resolve({ rows: [] as any[] }),
      e.bid_owner_user_id ? query(`SELECT u.id, ${NAME('u')} AS name, u.job_title FROM users u WHERE u.id = $1`, [e.bid_owner_user_id]) : Promise.resolve({ rows: [] as any[] }),
      query(`SELECT t.user_id, ${NAME('u')} AS name, u.job_title, t.role FROM enquiry_bid_team t JOIN users u ON u.id = t.user_id WHERE t.enquiry_id = $1 ORDER BY 2`, [e.id]),
    ]);
    res.json({
      id: e.id, status: e.status, enquiry_type: e.enquiry_type,
      estimated_value: e.estimated_value == null ? null : Number(e.estimated_value), value_currency: e.value_currency,
      win_probability: e.win_probability, probability: effectiveProbability(e.status, e.win_probability),
      bid_decision: e.bid_decision, bid_decided_at: e.bid_decided_at, bid_decision_note: e.bid_decision_note, bid_decided_by: decider.rows[0] ?? null,
      owner: owner.rows[0] ?? null, team: team.rows,
      submitted_on: e.submitted_on ? new Date(e.submitted_on).toISOString().slice(0, 10) : null,
      outcome_reason: e.outcome_reason, outcome_note: e.outcome_note,
    });
  } catch (e) { handle(res, next, e); }
});

router.patch('/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    const v = validateBidInput(req.body);
    if ('error' in v) return fail(res, 400, 'VALIDATION', v.error);
    const keys = Object.keys(v.value) as Array<keyof typeof v.value>;
    if (!keys.length) return fail(res, 400, 'VALIDATION', 'Nothing to change');
    await withTransaction(async db => {
      const e = await loadEnquiry(String(req.params.id), db, true);
      const values: any[] = [e.id]; const set = keys.map(k => { values.push(v.value[k]); return `${k} = $${values.length}`; });
      values.push(req.user!.id);
      await db.query(`UPDATE enquiries SET ${set.join(', ')}, updated_by = $${values.length}, updated_at = NOW() WHERE id = $1`, values);
      await activity(db, e.id, req.user!.id, 'bid_updated', { changes: v.value });
    });
    res.json({ ok: true });
  } catch (e) { handle(res, next, e); }
});

/** Bid or no-bid. No-bid closes the enquiry with that reason; pending clears the decision. */
router.post('/:id/decision', manage, async (req: AuthRequest, res, next) => {
  try {
    const decision = req.body?.decision;
    if (!(DECISIONS as readonly string[]).includes(decision)) return fail(res, 400, 'VALIDATION', 'Choose bid, no_bid or pending');
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 2000) : null;
    if (decision === 'no_bid' && !note) return fail(res, 400, 'VALIDATION', 'Say why we are not bidding');
    await withTransaction(async db => {
      const e = await loadEnquiry(String(req.params.id), db, true);
      if (!OPEN_STAGES.includes(e.status) && decision !== 'pending') throw new HttpError(400, 'VALIDATION', 'This enquiry is already decided (won, lost or closed)');
      await db.query(
        `UPDATE enquiries SET bid_decision = $2::text, bid_decision_note = $3,
           bid_decided_by = CASE WHEN $2::text = 'pending' THEN NULL ELSE $4::uuid END,
           bid_decided_at = CASE WHEN $2::text = 'pending' THEN NULL ELSE NOW() END,
           status = CASE WHEN $2::text = 'no_bid' THEN 'closed' WHEN $2::text = 'bid' AND status IN ('new','qualifying') THEN 'bidding' ELSE status END,
           outcome_reason = CASE WHEN $2::text = 'no_bid' THEN 'no_bid' ELSE outcome_reason END,
           outcome_note = CASE WHEN $2::text = 'no_bid' THEN $3 ELSE outcome_note END,
           updated_by = $4, updated_at = NOW()
         WHERE id = $1`, [e.id, decision, note, req.user!.id]);
      await activity(db, e.id, req.user!.id, 'bid_decision', { decision, note, from_status: e.status });
    });
    res.json({ ok: true });
  } catch (e) { handle(res, next, e); }
});

/** Move to a stage. Lost and closed need a reason; tenders need the bid decision before bidding. */
router.post('/:id/stage', manage, async (req: AuthRequest, res, next) => {
  try {
    const to = req.body?.stage as Stage;
    const reason = req.body?.reason || null;
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 2000) : null;
    await withTransaction(async db => {
      const e = await loadEnquiry(String(req.params.id), db, true);
      const problem = stageProblem(e.status, to, { type: e.enquiry_type, decision: e.bid_decision, reason });
      if (problem) throw new HttpError(400, 'VALIDATION', problem);
      const closing = to === 'lost' || to === 'closed' || to === 'won';
      await db.query(
        `UPDATE enquiries SET status = $2::text,
           submitted_on = CASE WHEN $2::text = 'submitted' THEN COALESCE(submitted_on, CURRENT_DATE) ELSE submitted_on END,
           outcome_reason = CASE WHEN $3::boolean THEN $4::text ELSE NULL END,
           outcome_note = CASE WHEN $3::boolean THEN $5::text ELSE NULL END,
           updated_by = $6, updated_at = NOW()
         WHERE id = $1`, [e.id, to, closing, closing ? reason : null, closing ? note : null, req.user!.id]);
      await activity(db, e.id, req.user!.id, 'stage_changed', { from: e.status, to, reason, note });
    });
    res.json({ ok: true });
  } catch (e) { handle(res, next, e); }
});

/** Replace the bid team: [{ user_id, role? }]. */
router.put('/:id/team', manage, async (req: AuthRequest, res, next) => {
  try {
    const members = req.body?.members;
    if (!Array.isArray(members) || members.length > 50) return fail(res, 400, 'VALIDATION', 'members must be a list');
    for (const m of members) {
      if (!isUuid(m?.user_id)) return fail(res, 400, 'VALIDATION', 'Each member needs a user_id');
      if (m.role != null && (typeof m.role !== 'string' || m.role.length > 80)) return fail(res, 400, 'VALIDATION', 'Role must be short text');
    }
    await withTransaction(async db => {
      const e = await loadEnquiry(String(req.params.id), db, true);
      await db.query('DELETE FROM enquiry_bid_team WHERE enquiry_id = $1', [e.id]);
      for (const m of members) {
        await db.query('INSERT INTO enquiry_bid_team (enquiry_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (enquiry_id, user_id) DO UPDATE SET role = EXCLUDED.role',
          [e.id, m.user_id, m.role?.trim() || null]);
      }
      await activity(db, e.id, req.user!.id, 'bid_team_changed', { members: members.length });
    });
    res.json({ ok: true });
  } catch (e) { handle(res, next, e); }
});

export default router;
