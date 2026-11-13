// HTTP layer for the shared planning engine (/api/v1/planning).
// Drafting is its only user so far, so access follows the Drafting module setting:
// anyone who can see Drafting can read, Drafting managers can change calendars, people and leave.
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../../middleware/auth';
import { logAudit } from '../../db/audit';
import * as repo from './repository';
import { addDays } from './calendar';
import {
  isIsoDate, isUuid, validateCalendarInput, validateDaysInput, validateLeaveInput, validateResourceInput,
} from './validation';

const router = Router();
router.use(authenticate, requireModuleAccess('drafting'));
const manage = requireModuleManage('drafting');

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const pid = (req: Request) => String(req.params.id);

function handleDbError(e: any, res: Response, next: NextFunction) {
  if (e instanceof repo.PlanningRuleError) return fail(res, 400, 'VALIDATION', e.message);
  if (e?.code === '23505') return fail(res, 409, 'CONFLICT', 'A calendar with this name already exists.');
  if (e?.code === '23503') return fail(res, 400, 'VALIDATION', 'The selected calendar or person no longer exists.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'A value is out of range.');
  return next(e);
}

// ---------- calendars ----------

router.get('/calendars', async (_req, res, next) => {
  try { res.json({ data: await repo.listCalendars() }); } catch (e) { next(e); }
});

router.post('/calendars', manage, async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateCalendarInput(req.body, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const cal = await repo.createCalendar(value!, req.user!.id);
    await logAudit(req.user!.id, 'planning_calendar', cal.id, 'CREATE', { name: cal.name });
    res.status(201).json(cal);
  } catch (e) { handleDbError(e, res, next); }
});

router.patch('/calendars/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const { value, error } = validateCalendarInput(req.body, { creating: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const cal = await repo.updateCalendar(pid(req), value!, req.user!.id);
    if (!cal) return fail(res, 404, 'NOT_FOUND', 'Calendar not found.');
    await logAudit(req.user!.id, 'planning_calendar', cal.id, 'UPDATE', value!);
    res.json(cal);
  } catch (e) { handleDbError(e, res, next); }
});

router.delete('/calendars/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    if (!(await repo.deleteCalendar(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Calendar not found.');
    await logAudit(req.user!.id, 'planning_calendar', pid(req), 'DELETE', {});
    res.json({ ok: true });
  } catch (e) { handleDbError(e, res, next); }
});

router.get('/calendars/:id/days', async (req, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const year = req.query.year ? Number(req.query.year) : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 2000 || year > 2100)) return fail(res, 400, 'VALIDATION', 'year must be a year such as 2026.');
    res.json({ data: await repo.listCalendarDays(pid(req), year) });
  } catch (e) { next(e); }
});

router.put('/calendars/:id/days', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const { value, error } = validateDaysInput(req.body);
    if (error) return fail(res, 400, 'VALIDATION', error);
    if (!(await repo.getCalendar(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Calendar not found.');
    const saved = await repo.upsertCalendarDays(pid(req), value!);
    await logAudit(req.user!.id, 'planning_calendar', pid(req), 'UPDATE_DAYS', { days: value!.map(d => `${d.day}=${d.hours}`) });
    res.json({ saved });
  } catch (e) { handleDbError(e, res, next); }
});

router.delete('/calendars/:id/days', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const days = req.body?.days;
    if (!Array.isArray(days) || !days.length || !days.every(isIsoDate)) return fail(res, 400, 'VALIDATION', 'days must be a list of dates.');
    const removed = await repo.deleteCalendarDays(pid(req), days);
    await logAudit(req.user!.id, 'planning_calendar', pid(req), 'DELETE_DAYS', { days });
    res.json({ removed });
  } catch (e) { next(e); }
});

// ---------- people and leave ----------

router.get('/resources', async (req, res, next) => {
  try {
    const teamId = typeof req.query.team_id === 'string' ? req.query.team_id : undefined;
    if (teamId && !isUuid(teamId)) return fail(res, 400, 'VALIDATION', 'team_id must be a valid id.');
    res.json({ data: await repo.listResources(teamId) });
  } catch (e) { next(e); }
});

router.patch('/resources/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid user id.');
    const { value, error } = validateResourceInput(req.body);
    if (error) return fail(res, 400, 'VALIDATION', error);
    await repo.saveResource(pid(req), value!, req.user!.id);
    await logAudit(req.user!.id, 'planning_resource', pid(req), 'UPDATE', value!);
    res.json({ ok: true });
  } catch (e) { handleDbError(e, res, next); }
});

router.get('/leave', async (req, res, next) => {
  try {
    const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
    if (userId && !isUuid(userId)) return fail(res, 400, 'VALIDATION', 'user_id must be a valid id.');
    const from = typeof req.query.from === 'string' && isIsoDate(req.query.from) ? req.query.from : undefined;
    res.json({ data: await repo.listLeave({ userIds: userId ? [userId] : undefined, from }) });
  } catch (e) { next(e); }
});

router.post('/resources/:id/leave', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid user id.');
    const { value, error } = validateLeaveInput(req.body);
    if (error) return fail(res, 400, 'VALIDATION', error);
    const leave = await repo.createLeave(pid(req), value!, req.user!.id);
    await logAudit(req.user!.id, 'planning_leave', leave.id, 'CREATE', { user_id: pid(req), ...value! });
    res.status(201).json(leave);
  } catch (e) { handleDbError(e, res, next); }
});

router.delete('/leave/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    if (!(await repo.deleteLeave(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Leave not found.');
    await logAudit(req.user!.id, 'planning_leave', pid(req), 'DELETE', {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- workload ----------

router.get('/workload', async (req, res, next) => {
  try {
    const teamId = typeof req.query.team_id === 'string' ? req.query.team_id : undefined;
    if (teamId && !isUuid(teamId)) return fail(res, 400, 'VALIDATION', 'team_id must be a valid id.');
    const weeks = req.query.weeks ? Number(req.query.weeks) : 8;
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) return fail(res, 400, 'VALIDATION', 'weeks must be from 1 to 26.');
    let from = typeof req.query.from === 'string' ? req.query.from : new Date().toISOString().slice(0, 10);
    if (!isIsoDate(from)) return fail(res, 400, 'VALIDATION', 'from must be a date (YYYY-MM-DD).');
    const dow = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
    from = addDays(from, -dow); // weeks start on Monday
    res.json({ from, weeks, data: await repo.getWorkload({ teamId, from, weeks }) });
  } catch (e) { next(e); }
});

export default router;
