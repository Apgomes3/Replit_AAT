// @vitest-environment node
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({ manage: true }));

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'actor-1', role: 'engineer' }; next(); },
  requireModuleAccess: () => (_req: any, _res: any, next: any) => next(),
  requireModuleManage: () => (_req: any, res: any, next: any) =>
    access.manage ? next() : res.status(403).json({ error: { code: 'MODULE_READ_ONLY', message: 'Manage access is required for this module.' } }),
}));
vi.mock('../../db/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('./repository', () => ({
  listPeople: vi.fn(), listProjectOptions: vi.fn(), findUnknownUsers: vi.fn(),
  listTeams: vi.fn(), getTeam: vi.fn(), createTeam: vi.fn(), updateTeam: vi.fn(),
  listPlans: vi.fn(), getPlan: vi.fn(), createPlan: vi.fn(), updatePlan: vi.fn(),
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
    return { status: r.status, json: await r.json() };
  } finally {
    server.close();
  }
}

describe('drafting routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.manage = true;
    mocked.findUnknownUsers.mockResolvedValue([]);
  });

  it('creates a team with a manager and members and records an audit entry', async () => {
    mocked.createTeam.mockResolvedValue({ id: TEAM, name: 'Fabrication' });
    const r = await call('POST', '/teams', { name: ' Fabrication ', manager_user_id: USER, member_ids: [USER] });
    expect(r.status).toBe(201);
    expect(mocked.createTeam).toHaveBeenCalledWith({ name: 'Fabrication', manager_user_id: USER, member_ids: [USER] }, 'actor-1');
    expect(mocked.findUnknownUsers).toHaveBeenCalledWith([USER]);
    expect(logAudit).toHaveBeenCalledWith('actor-1', 'drafting_team', TEAM, 'CREATE', { name: 'Fabrication' });
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
      { name: 'Fabrication drawings', project_id: PROJECT, team_id: TEAM, start_date: '2026-02-13' }, 'actor-1');
  });

  it('returns 400 for a plan without a project and 404 for an unknown plan', async () => {
    expect((await call('POST', '/plans', { name: 'P', team_id: TEAM })).status).toBe(400);
    mocked.updatePlan.mockResolvedValue(null);
    expect((await call('PATCH', `/plans/${PROJECT}`, { status: 'on_hold' })).status).toBe(404);
  });

  it('validates plan list filters before querying', async () => {
    expect((await call('GET', '/plans?status=bogus')).status).toBe(400);
    mocked.listPlans.mockResolvedValue([]);
    const ok = await call('GET', `/plans?team_id=${TEAM}&status=active`);
    expect(ok.status).toBe(200);
    expect(mocked.listPlans).toHaveBeenCalledWith({ team_id: TEAM, project_id: undefined, status: 'active' });
  });
});
