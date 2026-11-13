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

  it('links tasks, refuses duplicates and loops, and pushes later tasks on request', async () => {
    const a = await repo.createTask(ids.plan, { title: 'Link A', start_date: '2026-05-04', due_date: '2026-05-08' }, ids.user);
    const b = await repo.createTask(ids.plan, { title: 'Link B', start_date: '2026-05-06', due_date: '2026-05-07' }, ids.user);
    const c = await repo.createTask(ids.otherPlan, { title: 'Link C (other plan)', start_date: '2026-05-01', due_date: '2026-05-01' }, ids.user);

    const ab = await repo.createLink(b.id, { predecessor_id: a.id }, ids.user);
    expect(ab).toMatchObject({ predecessor_id: a.id, successor_id: b.id, link_type: 'FS', lag_days: 0 });
    await expect(repo.createLink(b.id, { predecessor_id: a.id }, ids.user)).rejects.toThrow(/already linked/);
    await expect(repo.createLink(a.id, { predecessor_id: b.id }, ids.user)).rejects.toThrow(/already linked/);
    await repo.createLink(c.id, { predecessor_id: b.id, link_type: 'SS' }, ids.user);
    await expect(repo.createLink(a.id, { predecessor_id: c.id }, ids.user)).rejects.toThrow(/loop/);

    const board = await repo.getBoard(ids.plan);
    expect(board!.links).toHaveLength(2);
    expect(board!.external_tasks.map(t => t.id)).toEqual([c.id]);

    const preview = await repo.reschedulePlan(ids.plan, false, ids.user);
    expect(preview).toEqual([expect.objectContaining({ id: b.id, start_date: '2026-05-09', due_date: '2026-05-10', old_start_date: '2026-05-06' })]);
    expect((await repo.getBoard(ids.plan))!.tasks.find(t => t.id === b.id)!.start_date).toBe('2026-05-06'); // preview only
    await repo.reschedulePlan(ids.plan, true, ids.user);
    const after = await repo.getBoard(ids.plan);
    expect(after!.tasks.find(t => t.id === b.id)).toMatchObject({ start_date: '2026-05-09', due_date: '2026-05-10' });
    // Tasks in other plans are never moved, even when out of order.
    expect((await repo.getBoard(ids.otherPlan))!.tasks.find(t => t.id === c.id)!.start_date).toBe('2026-05-01');

    expect(await repo.updateLink(ab.id, { lag_days: 2 })).toMatchObject({ lag_days: 2 });
    expect(await repo.deleteLink(ab.id)).toBe(true);
    await repo.deleteTask(b.id); // removes its remaining link too
    expect((await repo.getBoard(ids.plan))!.links).toHaveLength(0);
  });

  it('enforces due date after start date in the database', async () => {
    await expect(repo.createTask(ids.plan, { title: 'Bad dates', start_date: '2026-03-10', due_date: '2026-03-01' }, ids.user))
      .rejects.toMatchObject({ code: '23514' });
  });
});
