// All SQL for the drafting module lives here; routes never build queries.
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db';
import type { GroupInput, PlanInput, PlanStatus, TaskInput, TaskPriority, TaskStatus, TeamInput } from './validation';

type Db = Pick<PoolClient, 'query'>;

export type Person = { id: string; name: string; email: string; role: string };

export type Team = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  manager: Person | null;
  members: Person[];
  plan_count: number;
  created_at: string;
  updated_at: string;
};

export type Plan = {
  id: string;
  plan_code: string;
  name: string;
  status: PlanStatus;
  start_date: string | null;
  target_date: string | null;
  description: string | null;
  project: { id: string; code: string; name: string };
  team: { id: string; name: string; manager_name: string | null };
  task_count: number;
  done_count: number;
  late_count: number;
  created_at: string;
  updated_at: string;
};

export type TaskGroup = { id: string; plan_id: string; name: string; sort_order: number };

export type Task = {
  id: string;
  plan_id: string;
  group_id: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  notes: string | null;
  sort_order: number;
  completed_at: string | null;
  assignees: Array<Pick<Person, 'id' | 'name' | 'email'>>;
  updated_at: string;
};

export type Board = { plan: Plan; groups: TaskGroup[]; tasks: Task[] };

const PERSON_NAME = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)`;

const TEAM_SELECT = `
  SELECT t.id, t.name, t.description, t.active, t.created_at, t.updated_at,
    CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object(
      'id', m.id, 'email', m.email, 'role', m.role,
      'name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), ''), m.email)
    ) END AS manager,
    COALESCE((
      SELECT json_agg(json_build_object('id', u.id, 'name', ${PERSON_NAME}, 'email', u.email, 'role', u.role)
                      ORDER BY u.first_name, u.last_name, u.email)
      FROM drafting_team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = t.id
    ), '[]'::json) AS members,
    (SELECT COUNT(*)::int FROM drafting_plans p WHERE p.team_id = t.id AND p.status <> 'archived') AS plan_count
  FROM drafting_teams t
  LEFT JOIN users m ON m.id = t.manager_user_id`;

const PLAN_SELECT = `
  SELECT p.id, p.plan_code, p.name, p.status, p.description, p.created_at, p.updated_at,
    to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
    to_char(p.target_date, 'YYYY-MM-DD') AS target_date,
    json_build_object('id', pr.id, 'code', pr.project_code, 'name', pr.project_name) AS project,
    json_build_object('id', t.id, 'name', t.name,
      'manager_name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), ''), m.email)) AS team,
    (SELECT COUNT(*)::int FROM drafting_tasks dt WHERE dt.plan_id = p.id) AS task_count,
    (SELECT COUNT(*)::int FROM drafting_tasks dt WHERE dt.plan_id = p.id AND dt.status = 'done') AS done_count,
    (SELECT COUNT(*)::int FROM drafting_tasks dt
      WHERE dt.plan_id = p.id AND dt.status <> 'done' AND dt.due_date < CURRENT_DATE) AS late_count
  FROM drafting_plans p
  JOIN projects pr ON pr.id = p.project_id
  JOIN drafting_teams t ON t.id = p.team_id
  LEFT JOIN users m ON m.id = t.manager_user_id`;

// ---------- lookups for pickers ----------

export async function listPeople(): Promise<Person[]> {
  const r = await query(
    `SELECT u.id, ${PERSON_NAME} AS name, u.email, u.role
     FROM users u WHERE u.is_active IS NOT FALSE
     ORDER BY u.first_name, u.last_name, u.email`,
  );
  return r.rows;
}

export async function listProjectOptions(): Promise<Array<{ id: string; code: string; name: string }>> {
  const r = await query(`SELECT id, project_code AS code, project_name AS name FROM projects ORDER BY project_code`);
  return r.rows;
}

/** Returns the ids from `ids` that are NOT active users. */
export async function findUnknownUsers(ids: string[], db: Db = { query } as Db): Promise<string[]> {
  if (!ids.length) return [];
  const r = await db.query(`SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active IS NOT FALSE`, [ids]);
  const found = new Set(r.rows.map((row: any) => row.id));
  return ids.filter(id => !found.has(id));
}

// ---------- teams ----------

export async function listTeams(): Promise<Team[]> {
  return (await query(`${TEAM_SELECT} ORDER BY t.active DESC, t.name`)).rows;
}

export async function getTeam(id: string, db: Db = { query } as Db): Promise<Team | null> {
  return (await db.query(`${TEAM_SELECT} WHERE t.id = $1`, [id])).rows[0] ?? null;
}

async function replaceMembers(db: Db, teamId: string, memberIds: string[]) {
  await db.query(`DELETE FROM drafting_team_members WHERE team_id = $1 AND NOT (user_id = ANY($2::uuid[]))`, [teamId, memberIds]);
  if (memberIds.length) {
    await db.query(
      `INSERT INTO drafting_team_members (team_id, user_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [teamId, memberIds],
    );
  }
}

export async function createTeam(input: TeamInput, actorId: string): Promise<Team> {
  return withTransaction(async db => {
    const inserted = await db.query(
      `INSERT INTO drafting_teams (name, description, manager_user_id, active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [input.name, input.description ?? null, input.manager_user_id ?? null, input.active ?? true, actorId],
    );
    const id = inserted.rows[0].id;
    await replaceMembers(db, id, input.member_ids ?? []);
    return (await getTeam(id, db))!;
  });
}

export async function updateTeam(id: string, input: TeamInput, actorId: string): Promise<Team | null> {
  return withTransaction(async db => {
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of ['name', 'description', 'manager_user_id', 'active'] as const) {
      if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
    }
    values.push(actorId);
    const updated = await db.query(
      `UPDATE drafting_teams SET ${[...set, `updated_by = $${values.length}`, 'updated_at = NOW()'].join(', ')}
       WHERE id = $1 RETURNING id`,
      values,
    );
    if (!updated.rows[0]) return null;
    if (input.member_ids) await replaceMembers(db, id, input.member_ids);
    return getTeam(id, db);
  });
}

// ---------- plans ----------

export type PlanFilters = { team_id?: string; project_id?: string; status?: string };

export async function listPlans(filters: PlanFilters = {}): Promise<Plan[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of [['team_id', 'p.team_id'], ['project_id', 'p.project_id'], ['status', 'p.status']] as const) {
    if (filters[key]) { values.push(filters[key]); where.push(`${column} = $${values.length}`); }
  }
  const r = await query(
    `${PLAN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (p.status = 'archived'), pr.project_code, p.name`,
    values,
  );
  return r.rows;
}

export async function getPlan(id: string, db: Db = { query } as Db): Promise<Plan | null> {
  return (await db.query(`${PLAN_SELECT} WHERE p.id = $1`, [id])).rows[0] ?? null;
}

export async function createPlan(input: PlanInput, actorId: string): Promise<Plan> {
  return withTransaction(async db => {
    const seq = await db.query(`SELECT to_char(NOW(), 'YYYY') AS year, nextval('drafting_plan_code_seq') AS n`);
    const code = `DP-${seq.rows[0].year}-${String(seq.rows[0].n).padStart(4, '0')}`;
    const inserted = await db.query(
      `INSERT INTO drafting_plans
         (plan_code, name, project_id, team_id, status, start_date, target_date, description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
      [code, input.name, input.project_id, input.team_id, input.status ?? 'active',
        input.start_date ?? null, input.target_date ?? null, input.description ?? null, actorId],
    );
    return (await getPlan(inserted.rows[0].id, db))!;
  });
}

// ---------- groups and tasks (D.2) ----------

const TASK_SELECT = `
  SELECT dt.id, dt.plan_id, dt.group_id, dt.title, dt.status, dt.priority, dt.notes, dt.sort_order,
    to_char(dt.start_date, 'YYYY-MM-DD') AS start_date,
    to_char(dt.due_date, 'YYYY-MM-DD') AS due_date,
    dt.completed_at, dt.updated_at,
    COALESCE((
      SELECT json_agg(json_build_object('id', u.id, 'name', ${PERSON_NAME}, 'email', u.email)
                      ORDER BY u.first_name, u.last_name, u.email)
      FROM drafting_task_assignees a JOIN users u ON u.id = a.user_id
      WHERE a.task_id = dt.id
    ), '[]'::json) AS assignees
  FROM drafting_tasks dt`;

export async function getBoard(planId: string): Promise<Board | null> {
  const plan = await getPlan(planId);
  if (!plan) return null;
  const groups = (await query(
    `SELECT id, plan_id, name, sort_order FROM drafting_task_groups WHERE plan_id = $1 ORDER BY sort_order, created_at`,
    [planId],
  )).rows;
  const tasks = (await query(`${TASK_SELECT} WHERE dt.plan_id = $1 ORDER BY dt.sort_order, dt.created_at`, [planId])).rows;
  return { plan, groups, tasks };
}

async function nextSortOrder(db: Db, table: 'drafting_task_groups' | 'drafting_tasks', planId: string) {
  const r = await db.query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM ${table} WHERE plan_id = $1`, [planId]);
  return Number(r.rows[0].n);
}

/** Groups must belong to the same plan as the task. */
async function groupBelongsToPlan(db: Db, groupId: string, planId: string) {
  return (await db.query(`SELECT 1 FROM drafting_task_groups WHERE id = $1 AND plan_id = $2`, [groupId, planId])).rowCount! > 0;
}

export class DraftingRuleError extends Error {}

export async function createGroup(planId: string, input: GroupInput, actorId: string): Promise<TaskGroup> {
  return withTransaction(async db => {
    const order = input.sort_order ?? await nextSortOrder(db, 'drafting_task_groups', planId);
    return (await db.query(
      `INSERT INTO drafting_task_groups (plan_id, name, sort_order, created_by) VALUES ($1, $2, $3, $4)
       RETURNING id, plan_id, name, sort_order`,
      [planId, input.name, order, actorId],
    )).rows[0];
  });
}

export async function updateGroup(id: string, input: GroupInput): Promise<TaskGroup | null> {
  const set: string[] = [];
  const values: unknown[] = [id];
  for (const key of ['name', 'sort_order'] as const) {
    if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
  }
  return (await query(
    `UPDATE drafting_task_groups SET ${[...set, 'updated_at = NOW()'].join(', ')} WHERE id = $1
     RETURNING id, plan_id, name, sort_order`,
    values,
  )).rows[0] ?? null;
}

/** Deletes the group; its tasks stay in the plan, ungrouped. Returns false if not found. */
export async function deleteGroup(id: string): Promise<boolean> {
  return (await query(`DELETE FROM drafting_task_groups WHERE id = $1`, [id])).rowCount! > 0;
}

async function replaceAssignees(db: Db, taskId: string, userIds: string[]) {
  await db.query(`DELETE FROM drafting_task_assignees WHERE task_id = $1 AND NOT (user_id = ANY($2::uuid[]))`, [taskId, userIds]);
  if (userIds.length) {
    await db.query(
      `INSERT INTO drafting_task_assignees (task_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [taskId, userIds],
    );
  }
}

async function getTask(id: string, db: Db = { query } as Db): Promise<Task | null> {
  return (await db.query(`${TASK_SELECT} WHERE dt.id = $1`, [id])).rows[0] ?? null;
}

export async function getTaskPlanId(id: string): Promise<string | null> {
  return (await query(`SELECT plan_id FROM drafting_tasks WHERE id = $1`, [id])).rows[0]?.plan_id ?? null;
}

export async function createTask(planId: string, input: TaskInput, actorId: string): Promise<Task> {
  return withTransaction(async db => {
    if (input.group_id && !(await groupBelongsToPlan(db, input.group_id, planId))) {
      throw new DraftingRuleError('The selected group belongs to a different plan.');
    }
    const order = input.sort_order ?? await nextSortOrder(db, 'drafting_tasks', planId);
    const status = input.status ?? 'not_started';
    const inserted = await db.query(
      `INSERT INTO drafting_tasks
         (plan_id, group_id, title, status, priority, start_date, due_date, notes, sort_order,
          completed_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${status === 'done' ? 'NOW()' : 'NULL'}, $10, $10)
       RETURNING id`,
      [planId, input.group_id ?? null, input.title, status, input.priority ?? 'medium',
        input.start_date ?? null, input.due_date ?? null, input.notes ?? null, order, actorId],
    );
    const id = inserted.rows[0].id;
    await replaceAssignees(db, id, input.assignee_ids ?? []);
    return (await getTask(id, db))!;
  });
}

export async function updateTask(id: string, input: TaskInput, actorId: string): Promise<Task | null> {
  return withTransaction(async db => {
    const current = (await db.query(`SELECT plan_id FROM drafting_tasks WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!current) return null;
    if (input.group_id && !(await groupBelongsToPlan(db, input.group_id, current.plan_id))) {
      throw new DraftingRuleError('The selected group belongs to a different plan.');
    }
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of ['group_id', 'title', 'status', 'priority', 'start_date', 'due_date', 'notes', 'sort_order'] as const) {
      if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
    }
    if (input.status !== undefined) {
      // Record when a task is finished (keeping the first completion time); reopening clears it.
      set.push(input.status === 'done' ? 'completed_at = COALESCE(completed_at, NOW())' : 'completed_at = NULL');
    }
    values.push(actorId);
    await db.query(
      `UPDATE drafting_tasks SET ${[...set, `updated_by = $${values.length}`, 'updated_at = NOW()'].join(', ')} WHERE id = $1`,
      values,
    );
    if (input.assignee_ids) await replaceAssignees(db, id, input.assignee_ids);
    return getTask(id, db);
  });
}

export async function deleteTask(id: string): Promise<boolean> {
  return (await query(`DELETE FROM drafting_tasks WHERE id = $1`, [id])).rowCount! > 0;
}

export async function updatePlan(id: string, input: PlanInput, actorId: string): Promise<Plan | null> {
  return withTransaction(async db => {
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of ['name', 'project_id', 'team_id', 'status', 'start_date', 'target_date', 'description'] as const) {
      if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
    }
    values.push(actorId);
    const updated = await db.query(
      `UPDATE drafting_plans SET ${[...set, `updated_by = $${values.length}`, 'updated_at = NOW()'].join(', ')}
       WHERE id = $1 RETURNING id`,
      values,
    );
    if (!updated.rows[0]) return null;
    return getPlan(id, db);
  });
}
