// @vitest-environment node
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'actor-1', role: 'engineer' }; next(); },
  getModuleAccessLevel: async () => 'hidden',
}));
vi.mock('../../db/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../drafting/repository', () => ({
  DraftingRuleError: class DraftingRuleError extends Error {},
  findUnknownUsers: vi.fn(), listPeople: vi.fn(), listProjectOptions: vi.fn(), listDesignBookOptions: vi.fn(),
  listEnquiryOptions: vi.fn(), listInitiativeOptions: vi.fn(), listTeams: vi.fn(),
  listPlans: vi.fn(), getPlan: vi.fn(), createPlan: vi.fn(), updatePlan: vi.fn(), getBoard: vi.fn(),
  getPlanAccessFacts: vi.fn(), getGroupPlanId: vi.fn(), getTaskPlanId: vi.fn(), getLinkSuccessorPlanId: vi.fn(),
  createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(),
}));

import * as repo from '../drafting/repository';
import router from './plansRoutes';

const PLAN = '11111111-1111-4111-8111-111111111111';
const BOOK = '22222222-2222-4222-8222-222222222222';
const ENQ = '33333333-3333-4333-8333-333333333333';
const mocked = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const facts = (over = {}) => ({
  visibility: 'private', department: null, is_owner: false, is_member: false, is_assignee: false,
  is_team_member: false, is_team_manager: false, ...over,
});

async function call(method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/planner', router);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: { code: 'INTERNAL', message: String(err?.message) } }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address() as any;
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/planner${path}`, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as any };
  } finally {
    server.close();
  }
}

describe('global plan routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.findUnknownUsers.mockResolvedValue([]);
  });

  it('lets anyone create a standalone private plan with a PL code', async () => {
    mocked.createPlan.mockResolvedValue({ id: PLAN, plan_code: 'PL-2026-0001', project: null, visibility: 'private' });
    const r = await call('POST', '/plans', { name: 'My checklist' });
    expect(r.status).toBe(201);
    expect(mocked.createPlan).toHaveBeenCalledWith({ name: 'My checklist', visibility: 'private' }, 'actor-1', { codePrefix: 'PL' });
  });

  it('refuses a team plan without a team, and a plan on both a design book and an enquiry', async () => {
    expect((await call('POST', '/plans', { name: 'P', visibility: 'team' })).status).toBe(400);
    expect((await call('POST', '/plans', { name: 'P', design_book_id: BOOK, enquiry_id: ENQ })).status).toBe(400);
    expect(mocked.createPlan).not.toHaveBeenCalled();
  });

  it('lists only plans the user can see, optionally only their own', async () => {
    mocked.listPlans.mockResolvedValue([]);
    await call('GET', `/plans?design_book_id=${BOOK}&mine=1`);
    expect(mocked.listPlans).toHaveBeenCalledWith({ design_book_id: BOOK, involving: 'actor-1', visibleTo: 'actor-1' });
    expect((await call('GET', '/plans?enquiry_id=nope')).status).toBe(400);
  });

  it('hides a private plan from others and lets assignees look but not change it', async () => {
    mocked.getPlanAccessFacts.mockResolvedValue(facts());
    expect((await call('GET', `/plans/${PLAN}`)).status).toBe(404);

    mocked.getPlanAccessFacts.mockResolvedValue(facts({ is_assignee: true }));
    mocked.getPlan.mockResolvedValue({ id: PLAN });
    expect((await call('GET', `/plans/${PLAN}`)).status).toBe(200);
    const r = await call('PATCH', `/plans/${PLAN}`, { name: 'X' });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('PLAN_READ_ONLY');
    expect(mocked.updatePlan).not.toHaveBeenCalled();
  });

  it('lets the owner add tasks and share the plan', async () => {
    mocked.getPlanAccessFacts.mockResolvedValue(facts({ is_owner: true }));
    mocked.createTask.mockResolvedValue({ id: 't1', plan_id: PLAN, title: 'Call supplier' });
    expect((await call('POST', `/plans/${PLAN}/tasks`, { title: 'Call supplier' })).status).toBe(201);
    mocked.updatePlan.mockResolvedValue({ id: PLAN });
    expect((await call('PATCH', `/plans/${PLAN}`, { member_ids: [BOOK], visibility: 'everyone' })).status).toBe(200);
    expect(mocked.updatePlan).toHaveBeenCalledWith(PLAN, { member_ids: [BOOK], visibility: 'everyone' }, 'actor-1');
  });

  it('checks the task\'s plan for task changes', async () => {
    mocked.getTaskPlanId.mockResolvedValue(PLAN);
    mocked.getPlanAccessFacts.mockResolvedValue(facts({ visibility: 'everyone' }));
    expect((await call('PATCH', `/tasks/${BOOK}`, { status: 'done' })).status).toBe(403);
    mocked.getTaskPlanId.mockResolvedValue(null);
    expect((await call('PATCH', `/tasks/${BOOK}`, { status: 'done' })).status).toBe(404);
    expect(mocked.updateTask).not.toHaveBeenCalled();
  });
});
