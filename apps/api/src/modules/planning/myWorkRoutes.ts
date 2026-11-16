// HTTP layer for My Work (/api/v1/my-work). Open to every signed-in user, for their own work only:
// their own tasks and commitments, and progress on plan tasks they are assigned to.
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { logAudit } from '../../db/audit';
import * as repo from './myWork';
import { updateTask } from '../drafting/repository';
import { addDays } from './calendar';
import { isIsoDate, isUuid, validateCommitmentInput, validatePersonalTaskInput, WORK_STATUSES, WorkStatus } from './validation';

const router = Router();
router.use(authenticate);

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const pid = (req: Request) => String(req.params.id);
const me = (req: AuthRequest) => req.user!.id;

function handleDbError(e: any, res: Response, next: NextFunction) {
  if (e?.code === '23503') return fail(res, 400, 'VALIDATION', 'The selected project or initiative no longer exists.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'The due date cannot be before the start date.');
  return next(e);
}

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const weeks = req.query.weeks ? Number(req.query.weeks) : 4;
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) return fail(res, 400, 'VALIDATION', 'weeks must be from 1 to 12.');
    let from = typeof req.query.from === 'string' ? req.query.from : new Date().toISOString().slice(0, 10);
    if (!isIsoDate(from)) return fail(res, 400, 'VALIDATION', 'from must be a date (YYYY-MM-DD).');
    from = addDays(from, -((new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7)); // weeks start on Monday
    res.json(await repo.getMyWork(me(req), from, weeks));
  } catch (e) { next(e); }
});

router.get('/projects', async (_req, res, next) => {
  try { res.json({ data: await repo.listProjectOptions() }); } catch (e) { next(e); }
});

// ---------- own tasks ----------

router.post('/tasks', async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validatePersonalTaskInput(req.body, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const task = await repo.createPersonalTask(me(req), value!, me(req));
    res.status(201).json(task);
  } catch (e) { handleDbError(e, res, next); }
});

router.patch('/tasks/:id', async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const { value, error } = validatePersonalTaskInput(req.body, { creating: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const current = await repo.getPersonalTask(pid(req));
    if (!current || current.user_id !== me(req)) return fail(res, 404, 'NOT_FOUND', 'Task not found.');
    res.json(await repo.updatePersonalTask(pid(req), value!));
  } catch (e) { handleDbError(e, res, next); }
});

router.delete('/tasks/:id', async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const current = await repo.getPersonalTask(pid(req));
    if (!current || current.user_id !== me(req)) return fail(res, 404, 'NOT_FOUND', 'Task not found.');
    await repo.deletePersonalTask(pid(req));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- plan tasks assigned to me: status and progress only ----------

router.patch('/plan-tasks/:id', async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const body = req.body ?? {};
    const input: { status?: WorkStatus; progress_pct?: number } = {};
    if (body.status !== undefined) {
      if (!(WORK_STATUSES as readonly string[]).includes(body.status)) return fail(res, 400, 'VALIDATION', `status must be one of: ${WORK_STATUSES.join(', ')}.`);
      input.status = body.status;
    }
    if (body.progress_pct !== undefined) {
      if (!Number.isInteger(body.progress_pct) || body.progress_pct < 0 || body.progress_pct > 100) return fail(res, 400, 'VALIDATION', 'progress_pct must be a whole number from 0 to 100.');
      input.progress_pct = body.progress_pct;
    }
    if (!Object.keys(input).length) return fail(res, 400, 'VALIDATION', 'Send status and/or progress_pct.');
    if (!(await repo.isAssigned(pid(req), me(req)))) return fail(res, 404, 'NOT_FOUND', 'Task not found among your tasks.');
    const task = await updateTask(pid(req), input, me(req));
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Task not found.');
    await logAudit(me(req), 'drafting_task', task.id, 'UPDATE', { fields: Object.keys(input), via: 'my-work' });
    res.json({ id: task.id, status: task.status, progress_pct: task.progress_pct });
  } catch (e) { next(e); }
});

// ---------- standing commitments ----------

router.post('/commitments', async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateCommitmentInput(req.body);
    if (error) return fail(res, 400, 'VALIDATION', error);
    res.status(201).json(await repo.saveCommitment(me(req), value!, me(req)));
  } catch (e) { handleDbError(e, res, next); }
});

router.put('/commitments/:id', async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const { value, error } = validateCommitmentInput(req.body);
    if (error) return fail(res, 400, 'VALIDATION', error);
    const current = await repo.getCommitment(pid(req));
    if (!current || current.user_id !== me(req)) return fail(res, 404, 'NOT_FOUND', 'Commitment not found.');
    res.json(await repo.saveCommitment(me(req), value!, me(req), pid(req)));
  } catch (e) { handleDbError(e, res, next); }
});

router.delete('/commitments/:id', async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const current = await repo.getCommitment(pid(req));
    if (!current || current.user_id !== me(req)) return fail(res, 404, 'NOT_FOUND', 'Commitment not found.');
    await repo.deleteCommitment(pid(req));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
