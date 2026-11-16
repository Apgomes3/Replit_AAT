// HTTP layer for plans (/api/v1/planner): the global planning tool.
// Any signed-in user can make a plan, link it to a project, design book or enquiry (or nothing),
// and share it. Who can see or change each plan is decided per plan (./planAccess).
// `planItemRoutes` (one plan, its board, groups, tasks and links) is also mounted by Drafting.
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest, getModuleAccessLevel } from '../../middleware/auth';
import { logAudit } from '../../db/audit';
import * as repo from '../drafting/repository';
import {
  isUuid, PLAN_STATUSES, validateDateChanges, validateGroupInput, validateLinkInput, validatePlanInput, validateTaskInput,
} from '../drafting/validation';
import { canEditPlan, canViewPlan, PlanViewer } from './planAccess';

const fail = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });
const pid = (req: Request) => String(req.params.id);

/** Compact audit record of tasks the scheduler moved: id and start date before → after. */
const movedSummary = (changes: repo.RescheduleChange[] | undefined) =>
  (changes ?? []).map(c => ({ id: c.id, from: c.old_start_date ?? c.old_due_date, to: c.start_date ?? c.due_date }));

function handleDbError(e: any, res: Response, next: NextFunction) {
  if (e instanceof repo.DraftingRuleError) return fail(res, 400, 'VALIDATION', e.message);
  if (e?.code === '23503') return fail(res, 400, 'VALIDATION', 'The selected project, design book, enquiry, initiative, team or user no longer exists.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'The end date cannot be before the start date.');
  return next(e);
}

async function checkPeople(ids: string[] | undefined) {
  if (!ids?.length) return null;
  const unknown = await repo.findUnknownUsers([...new Set(ids)]);
  return unknown.length ? 'One or more selected people are not active users.' : null;
}

async function viewer(req: AuthRequest): Promise<PlanViewer> {
  return { role: req.user!.role, drafting: await getModuleAccessLevel(req.user!.id, 'drafting') };
}

async function canSee(req: AuthRequest, planId: string): Promise<boolean> {
  const facts = await repo.getPlanAccessFacts(planId, req.user!.id);
  return !!facts && canViewPlan(facts, await viewer(req));
}

type Kind = 'plan' | 'group' | 'task' | 'link';
const NOT_FOUND: Record<Kind, string> = { plan: 'Plan not found.', group: 'Group not found.', task: 'Task not found.', link: 'Link not found.' };
const PLAN_OF: Record<Kind, (id: string) => Promise<string | null>> = {
  plan: async id => id,
  group: repo.getGroupPlanId,
  task: repo.getTaskPlanId,
  link: repo.getLinkSuccessorPlanId,
};

/**
 * Checks :id, finds its plan and lets the request through when the user may see (or edit) it.
 * Plans the user cannot see answer 404, so their existence is not revealed.
 */
const guard = (kind: Kind, need: 'view' | 'edit') => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isUuid(pid(req))) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const planId = await PLAN_OF[kind](pid(req));
    const facts = planId ? await repo.getPlanAccessFacts(planId, req.user!.id) : null;
    const who = await viewer(req);
    if (!facts || !canViewPlan(facts, who)) return fail(res, 404, 'NOT_FOUND', NOT_FOUND[kind]);
    if (need === 'edit' && !canEditPlan(facts, who)) {
      return fail(res, 403, 'PLAN_READ_ONLY', 'Only the plan owner, people it is shared with and the team manager can change this plan.');
    }
    res.locals.planId = planId;
    res.locals.canEdit = canEditPlan(facts, who);
    next();
  } catch (e) { next(e); }
};

// ---------- one plan: details, board, groups, tasks, links ----------

export const planItemRoutes = Router();
const r = planItemRoutes;

r.get('/plans/:id', guard('plan', 'view'), async (req, res, next) => {
  try {
    const plan = await repo.getPlan(pid(req));
    if (!plan) return fail(res, 404, 'NOT_FOUND', 'Plan not found.');
    res.json(plan);
  } catch (e) { next(e); }
});

r.patch('/plans/:id', guard('plan', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validatePlanInput(req.body, { creating: false, required: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const peopleError = await checkPeople(value!.member_ids);
    if (peopleError) return fail(res, 400, 'VALIDATION', peopleError);
    const plan = await repo.updatePlan(pid(req), value!, req.user!.id);
    if (!plan) return fail(res, 404, 'NOT_FOUND', 'Plan not found.');
    await logAudit(req.user!.id, 'drafting_plan', plan.id, 'UPDATE', { fields: Object.keys(value!) });
    res.json(plan);
  } catch (e) { handleDbError(e, res, next); }
});

r.get('/plans/:id/board', guard('plan', 'view'), async (req, res, next) => {
  try {
    const board = await repo.getBoard(pid(req));
    if (!board) return fail(res, 404, 'NOT_FOUND', 'Plan not found.');
    // can_edit tells the board whether to offer editing to this user.
    res.json({ ...board, can_edit: res.locals.canEdit === true });
  } catch (e) { next(e); }
});

r.post('/plans/:id/groups', guard('plan', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateGroupInput(req.body, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    res.status(201).json(await repo.createGroup(pid(req), value!, req.user!.id));
  } catch (e) { handleDbError(e, res, next); }
});

r.patch('/groups/:id', guard('group', 'edit'), async (req, res, next) => {
  try {
    const { value, error } = validateGroupInput(req.body, { creating: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const group = await repo.updateGroup(pid(req), value!);
    if (!group) return fail(res, 404, 'NOT_FOUND', 'Group not found.');
    res.json(group);
  } catch (e) { handleDbError(e, res, next); }
});

r.delete('/groups/:id', guard('group', 'edit'), async (req, res, next) => {
  try {
    if (!(await repo.deleteGroup(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Group not found.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

r.post('/plans/:id/tasks', guard('plan', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateTaskInput(req.body, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const peopleError = await checkPeople(value!.assignee_ids);
    if (peopleError) return fail(res, 400, 'VALIDATION', peopleError);
    const task = await repo.createTask(pid(req), value!, req.user!.id);
    await logAudit(req.user!.id, 'drafting_task', task.id, 'CREATE', { plan_id: task.plan_id, title: task.title });
    res.status(201).json(task);
  } catch (e) { handleDbError(e, res, next); }
});

r.patch('/tasks/:id', guard('task', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateTaskInput(req.body, { creating: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const peopleError = await checkPeople(value!.assignee_ids);
    if (peopleError) return fail(res, 400, 'VALIDATION', peopleError);
    const task = await repo.updateTask(pid(req), value!, req.user!.id);
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Task not found.');
    await logAudit(req.user!.id, 'drafting_task', task.id, 'UPDATE', {
      fields: Object.keys(value!), ...(value!.status ? { status: value!.status } : {}),
      ...(task.rescheduled?.length ? { moved: movedSummary(task.rescheduled) } : {}),
    });
    res.json(task);
  } catch (e) { handleDbError(e, res, next); }
});

r.delete('/tasks/:id', guard('task', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    if (!(await repo.deleteTask(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Task not found.');
    await logAudit(req.user!.id, 'drafting_task', pid(req), 'DELETE', { plan_id: res.locals.planId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Links may cross plans: the successor's plan must be editable, the predecessor's visible.
r.post('/tasks/:id/links', guard('task', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateLinkInput(req.body, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const predecessorPlan = await repo.getTaskPlanId(value!.predecessor_id!);
    if (!predecessorPlan || !(await canSee(req, predecessorPlan))) return fail(res, 400, 'VALIDATION', 'The predecessor task was not found.');
    const link = await repo.createLinkAndSchedule(pid(req), value!, req.user!.id);
    await logAudit(req.user!.id, 'drafting_task', link.successor_id, 'LINK', {
      predecessor_id: link.predecessor_id, link_type: link.link_type, lag_days: link.lag_days, moved: movedSummary(link.rescheduled),
    });
    res.status(201).json(link);
  } catch (e) { handleDbError(e, res, next); }
});

r.patch('/links/:id', guard('link', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateLinkInput(req.body, { creating: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const link = await repo.updateLink(pid(req), value!, req.user!.id);
    if (!link) return fail(res, 404, 'NOT_FOUND', 'Link not found.');
    await logAudit(req.user!.id, 'drafting_task', link.successor_id, 'UPDATE_LINK', { link_id: link.id, ...value, moved: movedSummary(link.rescheduled) });
    res.json(link);
  } catch (e) { handleDbError(e, res, next); }
});

r.delete('/links/:id', guard('link', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const planIds = await repo.getLinkPlanIds(pid(req));
    if (!planIds || !(await repo.deleteLink(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Link not found.');
    await logAudit(req.user!.id, 'drafting_link', pid(req), 'DELETE', { plan_ids: planIds });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Push this plan's later tasks so every link is respected. { apply: false } previews the changes. */
r.post('/plans/:id/reschedule', guard('plan', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const apply = req.body?.apply === true;
    const changes = await repo.reschedulePlan(pid(req), apply, req.user!.id);
    if (apply && changes.length) {
      await logAudit(req.user!.id, 'drafting_plan', pid(req), 'RESCHEDULE', {
        moved: changes.map(c => ({ id: c.id, from: c.old_start_date, to: c.start_date })),
      });
    }
    res.json({ data: changes, applied: apply });
  } catch (e) { handleDbError(e, res, next); }
});

/** Undo of an automatic reschedule: put tasks back on the given dates (no scheduling runs). */
r.post('/plans/:id/dates', guard('plan', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateDateChanges(req.body);
    if (error) return fail(res, 400, 'VALIDATION', error);
    const updated = await repo.setTaskDates(pid(req), value!, req.user!.id);
    await logAudit(req.user!.id, 'drafting_plan', pid(req), 'RESTORE_DATES', { tasks: value!.map(c => c.id) });
    res.json({ updated });
  } catch (e) { handleDbError(e, res, next); }
});

/** Save the plan's current dates as its baseline ({ clear: true } removes it). */
r.post('/plans/:id/baseline', guard('plan', 'edit'), async (req: AuthRequest, res, next) => {
  try {
    const clear = req.body?.clear === true;
    const plan = await repo.setBaseline(pid(req), clear, req.user!.id);
    if (!plan) return fail(res, 404, 'NOT_FOUND', 'Plan not found.');
    await logAudit(req.user!.id, 'drafting_plan', plan.id, clear ? 'CLEAR_BASELINE' : 'SET_BASELINE', {});
    res.json(plan);
  } catch (e) { next(e); }
});

// ---------- /api/v1/planner: lists, pickers and new plans ----------

const router = Router();
router.use(authenticate);

router.get('/options', async (_req, res, next) => {
  try {
    const [people, projects, design_books, enquiries, initiatives, teams] = await Promise.all([
      repo.listPeople(), repo.listProjectOptions(), repo.listDesignBookOptions(), repo.listEnquiryOptions(),
      repo.listInitiativeOptions(), repo.listTeams(),
    ]);
    res.json({
      people, projects, design_books, enquiries, initiatives,
      teams: teams.filter(t => t.active).map(t => ({ id: t.id, name: t.name, department: t.department })),
    });
  } catch (e) { next(e); }
});

/**
 * Plans the user can see. Filters: project_id, design_book_id, enquiry_id, team_id, status,
 * mine=1 (plans they own, are shared on or have tasks in).
 */
router.get('/plans', async (req: AuthRequest, res, next) => {
  try {
    const filters: repo.PlanFilters = {};
    for (const key of ['project_id', 'design_book_id', 'enquiry_id', 'initiative_id', 'team_id'] as const) {
      const v = req.query[key];
      if (typeof v !== 'string' || !v) continue;
      if (!isUuid(v)) return fail(res, 400, 'VALIDATION', `${key} must be a valid id.`);
      filters[key] = v;
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status) {
      if (!(PLAN_STATUSES as readonly string[]).includes(status)) return fail(res, 400, 'VALIDATION', `status must be one of: ${PLAN_STATUSES.join(', ')}.`);
      filters.status = status;
    }
    if (req.query.mine === '1' || req.query.mine === 'true') filters.involving = req.user!.id;
    if (req.user!.role !== 'admin') filters.visibleTo = req.user!.id;
    res.json({ data: await repo.listPlans(filters) });
  } catch (e) { next(e); }
});

router.post('/plans', async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validatePlanInput(req.body, { creating: true, required: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const peopleError = await checkPeople(value!.member_ids);
    if (peopleError) return fail(res, 400, 'VALIDATION', peopleError);
    const plan = await repo.createPlan(value!, req.user!.id, { codePrefix: 'PL' });
    await logAudit(req.user!.id, 'drafting_plan', plan.id, 'CREATE', {
      plan_code: plan.plan_code, project_id: plan.project?.id ?? null, visibility: plan.visibility,
    });
    res.status(201).json(plan);
  } catch (e) { handleDbError(e, res, next); }
});

router.use(planItemRoutes);

export default router;
