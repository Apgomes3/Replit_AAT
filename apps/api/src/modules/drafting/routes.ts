// HTTP layer for the drafting module: auth, validation, status codes.
// Data access lives in ./repository, input rules in ./validation.
import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../../middleware/auth';
import { logAudit } from '../../db/audit';
import * as repo from './repository';
import { isUuid, PLAN_STATUSES, validatePlanInput, validateTeamInput } from './validation';
import { planItemRoutes } from '../planning/plansRoutes';

const router = Router();
router.use(authenticate, requireModuleAccess('drafting'));
const manage = requireModuleManage('drafting');

const fail = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });

/** Map Postgres constraint errors to client errors; anything else goes to the global handler. */
function handleDbError(e: any, res: Response, next: NextFunction) {
  if (e instanceof repo.DraftingRuleError) return fail(res, 400, 'VALIDATION', e.message);
  if (e?.code === '23505') return fail(res, 409, 'CONFLICT', 'A team with this name already exists.');
  if (e?.code === '23503') return fail(res, 400, 'VALIDATION', 'The selected project, team or user no longer exists.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'The end date cannot be before the start date.');
  return next(e);
}

async function checkPeople(managerId: string | null | undefined, memberIds: string[] | undefined) {
  const ids = [...(managerId ? [managerId] : []), ...(memberIds ?? [])];
  const unknown = await repo.findUnknownUsers([...new Set(ids)]);
  return unknown.length ? 'One or more selected people are not active users.' : null;
}

// ---------- pickers ----------

router.get('/people', async (_req, res, next) => {
  try { res.json({ data: await repo.listPeople() }); } catch (e) { next(e); }
});

router.get('/projects', async (_req, res, next) => {
  try { res.json({ data: await repo.listProjectOptions() }); } catch (e) { next(e); }
});

// ---------- teams ----------

// Drafting only sees and edits the Drafting department's teams; the other company teams
// are managed in Resources (/api/v1/planning/teams).
const isDraftingTeam = (team: repo.Team | null): team is repo.Team =>
  !!team && team.department.toLowerCase() === repo.DRAFTING_DEPARTMENT.toLowerCase();

router.get('/teams', async (_req, res, next) => {
  try { res.json({ data: await repo.listTeams({ department: repo.DRAFTING_DEPARTMENT }) }); } catch (e) { next(e); }
});

router.get('/teams/:id', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const team = await repo.getTeam(req.params.id);
    if (!isDraftingTeam(team)) return fail(res, 404, 'NOT_FOUND', 'Team not found.');
    res.json(team);
  } catch (e) { next(e); }
});

router.post('/teams', manage, async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateTeamInput({ ...req.body, department: repo.DRAFTING_DEPARTMENT }, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const peopleError = await checkPeople(value!.manager_user_id, value!.member_ids);
    if (peopleError) return fail(res, 400, 'VALIDATION', peopleError);
    const team = await repo.createTeam(value!, req.user!.id);
    await logAudit(req.user!.id, 'drafting_team', team.id, 'CREATE', { name: team.name });
    res.status(201).json(team);
  } catch (e) { handleDbError(e, res, next); }
});

router.patch('/teams/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    if (!isUuid(req.params.id)) return fail(res, 400, 'VALIDATION', 'id must be a valid id.');
    const { department: _ignored, ...body } = req.body ?? {};
    const { value, error } = validateTeamInput(body, { creating: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    if (!isDraftingTeam(await repo.getTeam(req.params.id))) return fail(res, 404, 'NOT_FOUND', 'Team not found.');
    const peopleError = await checkPeople(value!.manager_user_id, value!.member_ids);
    if (peopleError) return fail(res, 400, 'VALIDATION', peopleError);
    const team = await repo.updateTeam(req.params.id, value!, req.user!.id);
    if (!team) return fail(res, 404, 'NOT_FOUND', 'Team not found.');
    await logAudit(req.user!.id, 'drafting_team', team.id, 'UPDATE', { fields: Object.keys(value!) });
    res.json(team);
  } catch (e) { handleDbError(e, res, next); }
});

// ---------- plans ----------

router.get('/plans', async (req, res, next) => {
  try {
    const team_id = typeof req.query.team_id === 'string' ? req.query.team_id : undefined;
    const project_id = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if ((team_id && !isUuid(team_id)) || (project_id && !isUuid(project_id))) {
      return fail(res, 400, 'VALIDATION', 'team_id and project_id must be valid ids.');
    }
    if (status && !(PLAN_STATUSES as readonly string[]).includes(status)) {
      return fail(res, 400, 'VALIDATION', `status must be one of: ${PLAN_STATUSES.join(', ')}.`);
    }
    // Drafting lists its department's team plans; personal and other teams' plans live in My plans.
    res.json({ data: await repo.listPlans({ team_id, project_id, status, department: repo.DRAFTING_DEPARTMENT }) });
  } catch (e) { next(e); }
});

router.post('/plans', manage, async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validatePlanInput(req.body, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    if (!isDraftingTeam(await repo.getTeam(value!.team_id!))) return fail(res, 400, 'VALIDATION', 'Pick a Drafting team.');
    const plan = await repo.createPlan(value!, req.user!.id);
    await logAudit(req.user!.id, 'drafting_plan', plan.id, 'CREATE', { plan_code: plan.plan_code, project_id: plan.project?.id ?? null });
    res.status(201).json(plan);
  } catch (e) { handleDbError(e, res, next); }
});

// One plan, its board, groups, tasks and links: the global plan routes, checked per plan
// (Drafting managers can change Drafting team plans; see ../planning/planAccess).
router.use(planItemRoutes);

export default router;
