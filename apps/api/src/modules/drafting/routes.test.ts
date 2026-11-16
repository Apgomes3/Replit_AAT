// @vitest-environment node
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({ manage: true }));

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'actor-1', role: 'engineer' }; next(); },
  requireModuleAccess: () => (_req: any, _res: any, next: any) => next(),
  getModuleAccessLevel: async () => (access.manage ? 'manage' : 'view'),
  requireModuleManage: () => (_req: any, res: any, next: any) =>
    access.manage ? next() : res.status(403).json({ error: { code: 'MODULE_READ_ONLY', message: 'Manage access is required for this module.' } }),
}));
vi.mock('../../db/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('./repository', () => ({
  DraftingRuleError: class DraftingRuleError extends Error {},
  listPeople: vi.fn(), listProjectOptions: vi.fn(), findUnknownUsers: vi.fn(),
  listTeams: vi.fn(), getTeam: vi.fn(), createTeam: vi.fn(), updateTeam: vi.fn(),
  listPlans: vi.fn(), getPlan: vi.fn(), createPlan: vi.fn(), updatePlan: vi.fn(),
  getBoard: vi.fn(), createGroup: vi.fn(), updateGroup: vi.fn(), deleteGroup: vi.fn(),
  createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), getTaskPlanId: vi.fn(),
  createLinkAndSchedule: vi.fn(), updateLink: vi.fn(), deleteLink: vi.fn(), getLinkPlanIds: vi.fn(), reschedulePlan: vi.fn(),
  setTaskDates: vi.fn(), setBaseline: vi.fn(),
  getPlanAccessFacts: vi.fn(), getGroupPlanId: vi.fn(), getLinkSuccessorPlanId: vi.fn(),
  DRAFTING_DEPARTMENT: 'Drafting',
}));

import * as repo from './repository';
import { logAudit } from '../../db/audit';
import router from './routes';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const mocked = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;

async function call(method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/drafting', router);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: { code: 'INTERNAL', message: String(err?.message) } }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address() as any;
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/drafting${path}`, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as any };
  } finally {
    server.close();
  }
}

describe('drafting routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.manage = true;
    mocked.findUnknownUsers.mockResolvedValue([]);
    // A Drafting team plan the actor is not personally on: access comes from the Drafting module role.
    mocked.getPlanAccessFacts.mockResolvedValue({
      visibility: 'team', department: 'Drafting', is_owner: false, is_member: false, is_assignee: false,
      is_team_member: false, is_team_manager: false,
    });
    mocked.getTaskPlanId.mockResolvedValue(PROJECT);
    mocked.getLinkSuccessorPlanId.mockResolvedValue(PROJECT);
    mocked.getTeam.mockResolvedValue({ id: TEAM, department: 'Drafting' });
  });

  it('creates a team with a manager and members and records an audit entry', async () => {
    mocked.createTeam.mockResolvedValue({ id: TEAM, name: 'Fabrication' });
    const r = await call('POST', '/teams', { name: ' Fabrication ', manager_user_id: USER, member_ids: [USER] });
    expect(r.status).toBe(201);
    expect(mocked.createTeam).toHaveBeenCalledWith({ name: 'Fabrication', manager_user_id: USER, member_ids: [USER], department: 'Drafting' }, 'actor-1');
    expect(mocked.findUnknownUsers).toHaveBeenCalledWith([USER]);
    expect(logAudit).toHaveBeenCalledWith('actor-1', 'drafting_team', TEAM, 'CREATE', { name: 'Fabrication' });
  });

  it('only lists and edits Drafting department teams, and never moves a team out of Drafting', async () => {
    mocked.listTeams.mockResolvedValue([]);
    await call('GET', '/teams');
    expect(mocked.listTeams).toHaveBeenCalledWith({ department: 'Drafting' });

    mocked.getTeam.mockResolvedValue({ id: TEAM, department: 'Engineering' });
    expect((await call('PATCH', `/teams/${TEAM}`, { name: 'X' })).status).toBe(404);
    expect(mocked.updateTeam).not.toHaveBeenCalled();

    mocked.getTeam.mockResolvedValue({ id: TEAM, department: 'Drafting' });
    mocked.updateTeam.mockResolvedValue({ id: TEAM, department: 'Drafting' });
    expect((await call('PATCH', `/teams/${TEAM}`, { name: 'X', department: 'Sales' })).status).toBe(200);
    expect(mocked.updateTeam).toHaveBeenCalledWith(TEAM, { name: 'X' }, 'actor-1');
  });

  it('rejects members who are not active users', async () => {
    mocked.findUnknownUsers.mockResolvedValue([USER]);
    const r = await call('POST', '/teams', { name: 'Fabrication', member_ids: [USER] });
    expect(r.status).toBe(400);
    expect(mocked.createTeam).not.toHaveBeenCalled();
  });

  it('maps a duplicate team name to 409', async () => {
    mocked.createTeam.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    const r = await call('POST', '/teams', { name: 'Fabrication' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('CONFLICT');
  });

  it('blocks mutations for view-only roles', async () => {
    access.manage = false;
    const r = await call('POST', '/plans', { name: 'P', project_id: PROJECT, team_id: TEAM });
    expect(r.status).toBe(403);
    expect(mocked.createPlan).not.toHaveBeenCalled();
  });

  it('creates a plan linked to a project and team', async () => {
    mocked.createPlan.mockResolvedValue({ id: 'plan-1', plan_code: 'DP-2026-0001', project: { id: PROJECT } });
    const r = await call('POST', '/plans', { name: 'Fabrication drawings', project_id: PROJECT, team_id: TEAM, start_date: '2026-02-13' });
    expect(r.status).toBe(201);
    expect(mocked.createPlan).toHaveBeenCalledWith(
      { name: 'Fabrication drawings', project_id: PROJECT, team_id: TEAM, visibility: 'team', start_date: '2026-02-13' }, 'actor-1');
  });

  it('returns 400 for a plan without a project and 404 for an unknown plan', async () => {
    expect((await call('POST', '/plans', { name: 'P', team_id: TEAM })).status).toBe(400);
    mocked.getPlanAccessFacts.mockResolvedValueOnce(null);
    expect((await call('PATCH', `/plans/${PROJECT}`, { status: 'on_hold' })).status).toBe(404);
  });

  it('creates a task with assignees in an existing plan and audits it', async () => {
    mocked.getPlan.mockResolvedValue({ id: PROJECT });
    mocked.createTask.mockResolvedValue({ id: 'task-1', plan_id: PROJECT, title: 'LSS-02 drawing' });
    const r = await call('POST', `/plans/${PROJECT}/tasks`, {
      title: ' LSS-02 drawing ', priority: 'important', assignee_ids: [USER], start_date: '2026-02-13', due_date: '2026-03-07',
    });
    expect(r.status).toBe(201);
    expect(mocked.createTask).toHaveBeenCalledWith(PROJECT, {
      title: 'LSS-02 drawing', priority: 'important', assignee_ids: [USER], start_date: '2026-02-13', due_date: '2026-03-07',
    }, 'actor-1');
    expect(logAudit).toHaveBeenCalledWith('actor-1', 'drafting_task', 'task-1', 'CREATE', { plan_id: PROJECT, title: 'LSS-02 drawing' });
  });

  it('returns 404 when adding a task to a missing plan', async () => {
    mocked.getPlanAccessFacts.mockResolvedValueOnce(null);
    expect((await call('POST', `/plans/${PROJECT}/tasks`, { title: 'x' })).status).toBe(404);
    expect(mocked.createTask).not.toHaveBeenCalled();
  });

  it('turns a cross-plan group into a 400 instead of a server error', async () => {
    const { DraftingRuleError } = await import('./repository');
    mocked.updateTask.mockRejectedValue(new (DraftingRuleError as any)('The selected group belongs to a different plan.'));
    const r = await call('PATCH', `/tasks/${TEAM}`, { group_id: PROJECT });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/different plan/);
  });

  it('changes only the status and reports it in the audit entry', async () => {
    mocked.updateTask.mockResolvedValue({ id: TEAM, status: 'review' });
    const r = await call('PATCH', `/tasks/${TEAM}`, { status: 'review' });
    expect(r.status).toBe(200);
    expect(mocked.updateTask).toHaveBeenCalledWith(TEAM, { status: 'review' }, 'actor-1');
    expect(logAudit).toHaveBeenCalledWith('actor-1', 'drafting_task', TEAM, 'UPDATE', { fields: ['status'], status: 'review' });
  });

  it('deletes a task and returns 404 for an unknown one', async () => {
    mocked.deleteTask.mockResolvedValueOnce(true);
    expect((await call('DELETE', `/tasks/${TEAM}`)).status).toBe(200);
    mocked.getTaskPlanId.mockResolvedValueOnce(null);
    expect((await call('DELETE', `/tasks/${TEAM}`)).status).toBe(404);
  });

  it('validates plan list filters before querying', async () => {
    expect((await call('GET', '/plans?status=bogus')).status).toBe(400);
    mocked.listPlans.mockResolvedValue([]);
    const ok = await call('GET', `/plans?team_id=${TEAM}&status=active`);
    expect(ok.status).toBe(200);
    expect(mocked.listPlans).toHaveBeenCalledWith({ team_id: TEAM, project_id: undefined, status: 'active', department: 'Drafting' });
  });

  it('links two tasks, validating the type and lag, and turns a loop into a 400', async () => {
    expect((await call('POST', `/tasks/${TEAM}/links`, { predecessor_id: 'nope' })).status).toBe(400);
    expect((await call('POST', `/tasks/${TEAM}/links`, { predecessor_id: USER, link_type: 'XX' })).status).toBe(400);
    expect((await call('POST', `/tasks/${TEAM}/links`, { predecessor_id: USER, lag_days: 1.5 })).status).toBe(400);

    mocked.createLinkAndSchedule.mockResolvedValueOnce({ id: 'l1', predecessor_id: USER, successor_id: TEAM, link_type: 'SS', lag_days: 2 });
    const ok = await call('POST', `/tasks/${TEAM}/links`, { predecessor_id: USER, link_type: 'SS', lag_days: 2 });
    expect(ok.status).toBe(201);
    expect(mocked.createLinkAndSchedule).toHaveBeenCalledWith(TEAM, { predecessor_id: USER, link_type: 'SS', lag_days: 2 }, 'actor-1');

    const { DraftingRuleError } = await import('./repository');
    mocked.createLinkAndSchedule.mockRejectedValueOnce(new (DraftingRuleError as any)('This link would make a loop.'));
    const loop = await call('POST', `/tasks/${TEAM}/links`, { predecessor_id: USER });
    expect(loop.status).toBe(400);
    expect(loop.json.error.message).toMatch(/loop/);
  });

  it('previews a reschedule by default and applies it only when asked', async () => {
    mocked.getPlan.mockResolvedValue({ id: PROJECT });
    mocked.reschedulePlan.mockResolvedValue([{ id: TEAM, start_date: '2026-05-09', due_date: '2026-05-10', old_start_date: '2026-05-06' }]);
    const preview = await call('POST', `/plans/${PROJECT}/reschedule`, {});
    expect(preview.json).toMatchObject({ applied: false, data: [{ id: TEAM }] });
    expect(mocked.reschedulePlan).toHaveBeenLastCalledWith(PROJECT, false, 'actor-1');
    expect(logAudit).not.toHaveBeenCalled();
    await call('POST', `/plans/${PROJECT}/reschedule`, { apply: true });
    expect(mocked.reschedulePlan).toHaveBeenLastCalledWith(PROJECT, true, 'actor-1');
    expect(logAudit).toHaveBeenCalledWith('actor-1', 'drafting_plan', PROJECT, 'RESCHEDULE', expect.anything());
  });

  it('refuses a plan for a team outside Drafting', async () => {
    mocked.getTeam.mockResolvedValue({ id: TEAM, department: 'Engineering' });
    expect((await call('POST', '/plans', { name: 'P', project_id: PROJECT, team_id: TEAM })).status).toBe(400);
    expect(mocked.createPlan).not.toHaveBeenCalled();
  });

  it('refuses link changes without manage access', async () => {
    access.manage = false;
    expect((await call('DELETE', `/links/${TEAM}`)).status).toBe(403);
    expect(mocked.deleteLink).not.toHaveBeenCalled();
  });
});
