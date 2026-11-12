// @vitest-environment node
// Runs the drafting repository against a real PostgreSQL test database (TEST_DATABASE_URL),
// so SQL type and constraint errors are caught — the route tests mock the repository.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import * as repo from './repository';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ids: Record<string, string> = {};

describe.skipIf(!process.env.DATABASE_URL)('drafting repository (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.user = (await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, 'x', 'Draft', 'Tester', 'engineer') RETURNING id`, [`drafting-${suffix}@example.test`],
    )).rows[0].id;
    ids.project = (await query(
      `INSERT INTO projects (project_code, project_name) VALUES ($1, 'Drafting test project') RETURNING id`, [`DRF-${suffix}`],
    )).rows[0].id;
    const team = await repo.createTeam({ name: `Team ${suffix}`, manager_user_id: ids.user, member_ids: [ids.user] }, ids.user);
    ids.team = team.id;
    const plan = await repo.createPlan({ name: 'Plan A', project_id: ids.project, team_id: ids.team }, ids.user);
    ids.plan = plan.id;
    ids.otherPlan = (await repo.createPlan({ name: 'Plan B', project_id: ids.project, team_id: ids.team }, ids.user)).id;
  });

  afterAll(async () => {
    if (ids.plan) await query('DELETE FROM drafting_plans WHERE id = ANY($1::uuid[])', [[ids.plan, ids.otherPlan]]);
    if (ids.team) await query('DELETE FROM drafting_teams WHERE id = $1', [ids.team]);
    if (ids.project) await query('DELETE FROM projects WHERE id = $1', [ids.project]);
    if (ids.user) await query('DELETE FROM users WHERE id = $1', [ids.user]);
  });

  it('creates tasks with assignees and completion time, and reports plan progress', async () => {
    const group = await repo.createGroup(ids.plan, { name: 'LSS' }, ids.user);
    const open = await repo.createTask(ids.plan, {
      title: 'LSS-02 drawing', group_id: group.id, priority: 'important', assignee_ids: [ids.user],
      start_date: '2026-02-13', due_date: '2026-03-07',
    }, ids.user);
    expect(open).toMatchObject({ status: 'not_started', priority: 'important', group_id: group.id, completed_at: null,
      start_date: '2026-02-13', due_date: '2026-03-07' });
    expect(open.assignees.map(a => a.id)).toEqual([ids.user]);

    const done = await repo.createTask(ids.plan, { title: 'Already finished', status: 'done' }, ids.user);
    expect(done.completed_at).not.toBeNull();

    const plan = await repo.getPlan(ids.plan);
    expect(plan).toMatchObject({ task_count: 2, done_count: 1, late_count: 1 }); // LSS-02 is past due and open
  });

  it('sets and clears completion when the status changes', async () => {
    const task = await repo.createTask(ids.plan, { title: 'Status cycle' }, ids.user);
    const finished = await repo.updateTask(task.id, { status: 'done' }, ids.user);
    expect(finished!.completed_at).not.toBeNull();
    const reopened = await repo.updateTask(task.id, { status: 'review', assignee_ids: [] }, ids.user);
    expect(reopened).toMatchObject({ status: 'review', completed_at: null, assignees: [] });
  });

  it('rejects a group from another plan and keeps tasks when their group is deleted', async () => {
    const foreign = await repo.createGroup(ids.otherPlan, { name: 'Other plan group' }, ids.user);
    await expect(repo.createTask(ids.plan, { title: 'Wrong group', group_id: foreign.id }, ids.user))
      .rejects.toBeInstanceOf(repo.DraftingRuleError);

    const group = await repo.createGroup(ids.plan, { name: 'Temporary' }, ids.user);
    const task = await repo.createTask(ids.plan, { title: 'Survives group deletion', group_id: group.id }, ids.user);
    expect(await repo.deleteGroup(group.id)).toBe(true);
    const board = await repo.getBoard(ids.plan);
    expect(board!.tasks.find(t => t.id === task.id)!.group_id).toBeNull();
  });

  it('enforces due date after start date in the database', async () => {
    await expect(repo.createTask(ids.plan, { title: 'Bad dates', start_date: '2026-03-10', due_date: '2026-03-01' }, ids.user))
      .rejects.toMatchObject({ code: '23514' });
  });
});
