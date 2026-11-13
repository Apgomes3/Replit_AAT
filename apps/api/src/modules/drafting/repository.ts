// All SQL for the drafting module lives here; routes never build queries.
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db';
import type { GroupInput, LinkInput, PlanInput, PlanStatus, TaskInput, TaskPriority, TaskStatus, TeamInput } from './validation';
import { computeFloat, DateChange, LinkType, pushSchedule, shortfallDays } from './schedule';
import { loadPlanCalendar } from '../planning/repository';
import { workingDaysBetween, workingDayShift } from '../planning/calendar';

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
  calendar_id: string | null;
  calendar_name: string | null;
  auto_schedule: boolean;
  baseline_set_at: string | null;
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
  progress_pct: number;
  is_milestone: boolean;
  baseline_start: string | null;
  baseline_due: string | null;
  assignees: Array<Pick<Person, 'id' | 'name' | 'email'> & { allocation_pct: number }>;
  updated_at: string;
};

/** Schedule figures worked out on the plan's calendar, added to each task on the board. */
export type TaskSchedule = {
  working_days: number | null;
  /** Working days the task can slip before the plan's end moves; null when undated. */
  float_days: number | null;
  critical: boolean;
  /** Working days the due date has moved since the baseline (positive = later). */
  slip_days: number | null;
};

export type TaskLink = {
  id: string;
  predecessor_id: string;
  successor_id: string;
  link_type: LinkType;
  lag_days: number;
  /** Working days the successor starts (or ends) too early for this link; only on the board. */
  early_days?: number;
};

export type BoardCalendar = { id: string | null; name: string; week_hours: number[]; days: Record<string, number> };

/** A task from another plan that one of this plan's tasks is linked to. */
export type ExternalTask = {
  id: string; title: string; status: TaskStatus; start_date: string | null; due_date: string | null;
  plan_id: string; plan_code: string;
};

export type Board = {
  plan: Plan; groups: TaskGroup[]; tasks: Array<Task & TaskSchedule>; links: TaskLink[]; external_tasks: ExternalTask[];
  calendar: BoardCalendar;
};

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
      WHERE dt.plan_id = p.id AND dt.status <> 'done' AND dt.due_date < CURRENT_DATE) AS late_count,
    p.calendar_id, COALESCE(pc.name, dc.name) AS calendar_name, p.auto_schedule, p.baseline_set_at
  FROM drafting_plans p
  JOIN projects pr ON pr.id = p.project_id
  JOIN drafting_teams t ON t.id = p.team_id
  LEFT JOIN users m ON m.id = t.manager_user_id
  LEFT JOIN planning_calendars pc ON pc.id = p.calendar_id
  LEFT JOIN planning_calendars dc ON dc.is_default`;

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
    dt.completed_at, dt.updated_at, dt.progress_pct, dt.is_milestone,
    to_char(dt.baseline_start, 'YYYY-MM-DD') AS baseline_start,
    to_char(dt.baseline_due, 'YYYY-MM-DD') AS baseline_due,
    COALESCE((
      SELECT json_agg(json_build_object('id', u.id, 'name', ${PERSON_NAME}, 'email', u.email, 'allocation_pct', a.allocation_pct)
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
  const tasks: Task[] = (await query(`${TASK_SELECT} WHERE dt.plan_id = $1 ORDER BY dt.sort_order, dt.created_at`, [planId])).rows;
  const links = await linksTouchingPlan({ query } as Db, planId);
  const external_tasks: ExternalTask[] = (await query(
    `SELECT dt.id, dt.title, dt.status, to_char(dt.start_date, 'YYYY-MM-DD') AS start_date,
       to_char(dt.due_date, 'YYYY-MM-DD') AS due_date, dt.plan_id, p.plan_code
     FROM drafting_tasks dt JOIN drafting_plans p ON p.id = dt.plan_id
     WHERE dt.plan_id <> $1 AND dt.id = ANY($2::uuid[])`,
    [planId, links.flatMap(l => [l.predecessor_id, l.successor_id])],
  )).rows;
  const calendar = await loadPlanCalendar({ query } as Db, planId);

  // Schedule figures on the plan's calendar: length, float / critical path, slip from baseline, links out of order.
  const own = new Set(tasks.map(t => t.id));
  const float = computeFloat(tasks, links.filter(l => own.has(l.predecessor_id) && own.has(l.successor_id)), calendar);
  const all = new Map<string, Task | ExternalTask>([...tasks, ...external_tasks].map(t => [t.id, t]));
  const scheduled = tasks.map(t => {
    const start = t.start_date ?? t.due_date, due = t.due_date ?? t.start_date;
    const f = float.get(t.id);
    return {
      ...t,
      working_days: start && due ? workingDaysBetween(calendar, start, due) : null,
      float_days: f?.float_days ?? null,
      critical: f?.critical ?? false,
      slip_days: t.baseline_due && due ? workingDayShift(calendar, t.baseline_due, due) : null,
    };
  });
  const checked = links.map(l => {
    const pred = all.get(l.predecessor_id), succ = all.get(l.successor_id);
    return { ...l, early_days: pred && succ && succ.status !== 'done' ? shortfallDays(l, pred, succ, calendar) : 0 };
  });
  return {
    plan, groups, tasks: scheduled, links: checked, external_tasks,
    calendar: { id: calendar.id, name: calendar.name, week_hours: calendar.week_hours, days: calendar.days },
  };
}

// ---------- task links (D.3) ----------

const LINK_COLUMNS = 'l.id, l.predecessor_id, l.successor_id, l.link_type, l.lag_days';

async function linksTouchingPlan(db: Db, planId: string): Promise<TaskLink[]> {
  return (await db.query(
    `SELECT ${LINK_COLUMNS} FROM drafting_task_links l
     JOIN drafting_tasks p ON p.id = l.predecessor_id
     JOIN drafting_tasks s ON s.id = l.successor_id
     WHERE p.plan_id = $1 OR s.plan_id = $1
     ORDER BY l.created_at`,
    [planId],
  )).rows;
}

/** True when `from` already leads (through links) to `to`, so a link to → from would close a loop. */
async function leadsTo(db: Db, from: string, to: string): Promise<boolean> {
  const r = await db.query(
    `WITH RECURSIVE reach(id) AS (
       SELECT successor_id FROM drafting_task_links WHERE predecessor_id = $1
       UNION
       SELECT l.successor_id FROM drafting_task_links l JOIN reach ON l.predecessor_id = reach.id
     ) SELECT 1 FROM reach WHERE id = $2 LIMIT 1`,
    [from, to],
  );
  return r.rowCount! > 0;
}

/** Plans the link's two tasks belong to (for audit and cache refresh), or null if the link does not exist. */
export async function getLinkPlanIds(id: string): Promise<string[] | null> {
  const r = await query(
    `SELECT p.plan_id AS a, s.plan_id AS b FROM drafting_task_links l
     JOIN drafting_tasks p ON p.id = l.predecessor_id JOIN drafting_tasks s ON s.id = l.successor_id WHERE l.id = $1`,
    [id],
  );
  return r.rows[0] ? [...new Set<string>([r.rows[0].a, r.rows[0].b])] : null;
}

export type LinkResult = TaskLink & { rescheduled: RescheduleChange[] };

/**
 * Makes `successorId` wait for input.predecessor_id. Refuses missing tasks, duplicates and loops.
 * When the successor's plan schedules automatically, the successor (and what follows) moves later as needed.
 */
export async function createLinkAndSchedule(successorId: string, input: LinkInput, actorId: string): Promise<LinkResult> {
  return withTransaction(async db => {
    const link = await createLink(successorId, input, actorId, db);
    return { ...link, rescheduled: await autoSchedule(db, await planOf(db, successorId), actorId) };
  });
}

async function planOf(db: Db, taskId: string): Promise<string> {
  return (await db.query(`SELECT plan_id FROM drafting_tasks WHERE id = $1`, [taskId])).rows[0].plan_id;
}

/** Creates a link without scheduling (the Planner import uses this so imported dates never move). */
export async function createLink(successorId: string, input: LinkInput, actorId: string | null, db?: Db): Promise<TaskLink> {
  const run = async (tx: Db) => {
    const pred = input.predecessor_id!;
    if (pred === successorId) throw new DraftingRuleError('A task cannot wait for itself.');
    const found = await tx.query(`SELECT id FROM drafting_tasks WHERE id = ANY($1::uuid[])`, [[pred, successorId]]);
    if (found.rowCount !== 2) throw new DraftingRuleError('One of the linked tasks no longer exists.');
    const existing = await tx.query(
      `SELECT 1 FROM drafting_task_links WHERE (predecessor_id = $1 AND successor_id = $2) OR (predecessor_id = $2 AND successor_id = $1)`,
      [pred, successorId],
    );
    if (existing.rowCount) throw new DraftingRuleError('These two tasks are already linked.');
    if (await leadsTo(tx, successorId, pred)) {
      throw new DraftingRuleError('This link would make a loop: the other task already waits (directly or indirectly) for this one.');
    }
    return (await tx.query(
      `INSERT INTO drafting_task_links (predecessor_id, successor_id, link_type, lag_days, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, predecessor_id, successor_id, link_type, lag_days`,
      [pred, successorId, input.link_type ?? 'FS', input.lag_days ?? 0, actorId],
    )).rows[0];
  };
  return db ? run(db) : withTransaction(run);
}

export async function updateLink(id: string, input: LinkInput, actorId: string | null = null): Promise<LinkResult | null> {
  return withTransaction(async db => {
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of ['link_type', 'lag_days'] as const) {
      if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
    }
    const link: TaskLink | undefined = (await db.query(
      `UPDATE drafting_task_links l SET ${set.join(', ')} WHERE l.id = $1 RETURNING ${LINK_COLUMNS}`, values,
    )).rows[0];
    if (!link) return null;
    return { ...link, rescheduled: await autoSchedule(db, await planOf(db, link.successor_id), actorId) };
  });
}

export async function deleteLink(id: string): Promise<boolean> {
  return (await query(`DELETE FROM drafting_task_links WHERE id = $1`, [id])).rowCount! > 0;
}

export type RescheduleChange = DateChange & { title: string; old_start_date: string | null; old_due_date: string | null };

/**
 * Moves this plan's unfinished tasks later until every link is respected (tasks in other plans
 * are read but never moved). With apply=false it only reports what would change.
 */
export async function reschedulePlan(planId: string, apply: boolean, actorId: string): Promise<RescheduleChange[]> {
  return withTransaction(db => runReschedule(db, planId, apply, actorId));
}

async function runReschedule(db: Db, planId: string, apply: boolean, actorId: string | null): Promise<RescheduleChange[]> {
  const links = await linksTouchingPlan(db, planId);
  const ids = [...new Set(links.flatMap(l => [l.predecessor_id, l.successor_id]))];
  if (!ids.length) return [];
  const tasks = (await db.query(
    `SELECT id, plan_id, title, status, is_milestone,
       to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(due_date, 'YYYY-MM-DD') AS due_date
     FROM drafting_tasks WHERE id = ANY($1::uuid[]) ORDER BY id ${apply ? 'FOR UPDATE' : ''}`,
    [ids],
  )).rows;
  const calendar = await loadPlanCalendar(db, planId);
  const movable = new Set<string>(tasks.filter(t => t.plan_id === planId).map(t => t.id));
  const changes = pushSchedule(tasks, links, movable, calendar);
  const byId = new Map(tasks.map(t => [t.id, t]));
  if (apply) {
    for (const c of changes) {
      await db.query(`UPDATE drafting_tasks SET start_date = $2, due_date = $3, updated_by = $4, updated_at = NOW() WHERE id = $1`,
        [c.id, c.start_date, c.due_date, actorId]);
    }
  }
  return changes.map(c => {
    const t = byId.get(c.id)!;
    return { ...c, title: t.title, old_start_date: t.start_date, old_due_date: t.due_date };
  });
}

/** Sets dates on tasks of one plan exactly as given (Undo of an automatic reschedule); no scheduling runs. */
export async function setTaskDates(planId: string, changes: Array<{ id: string; start_date: string | null; due_date: string | null }>, actorId: string): Promise<number> {
  return withTransaction(async db => {
    let n = 0;
    for (const c of changes) {
      n += (await db.query(
        `UPDATE drafting_tasks SET start_date = $3, due_date = $4, updated_by = $5, updated_at = NOW() WHERE id = $1 AND plan_id = $2`,
        [c.id, planId, c.start_date, c.due_date, actorId],
      )).rowCount ?? 0;
    }
    if (n !== changes.length) throw new DraftingRuleError('Some of these tasks are not in this plan any more.');
    return n;
  });
}

/** Saves every task's current dates as the plan's baseline (replacing any earlier one); clear = remove it. */
export async function setBaseline(planId: string, clear: boolean, actorId: string): Promise<Plan | null> {
  return withTransaction(async db => {
    const updated = await db.query(
      `UPDATE drafting_plans SET baseline_set_at = ${clear ? 'NULL' : 'NOW()'}, updated_by = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [planId, actorId],
    );
    if (!updated.rowCount) return null;
    await db.query(
      clear ? `UPDATE drafting_tasks SET baseline_start = NULL, baseline_due = NULL WHERE plan_id = $1`
        : `UPDATE drafting_tasks SET baseline_start = start_date, baseline_due = due_date WHERE plan_id = $1`,
      [planId],
    );
    return getPlan(planId, db);
  });
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

/** Sets allocation % for people already assigned to the task (others in the map are ignored). */
async function setAllocations(db: Db, taskId: string, allocations: Record<string, number>) {
  for (const [userId, pct] of Object.entries(allocations)) {
    await db.query(`UPDATE drafting_task_assignees SET allocation_pct = $3 WHERE task_id = $1 AND user_id = $2`, [taskId, userId, pct]);
  }
}

/** A milestone is a single day: its start and due date are the same. */
async function normaliseMilestone(db: Db, taskId: string) {
  await db.query(
    `UPDATE drafting_tasks SET start_date = COALESCE(start_date, due_date), due_date = COALESCE(start_date, due_date)
     WHERE id = $1 AND is_milestone AND start_date IS DISTINCT FROM due_date`,
    [taskId],
  );
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
          completed_at, created_by, updated_by, progress_pct, is_milestone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${status === 'done' ? 'NOW()' : 'NULL'}, $10, $10, $11, $12)
       RETURNING id`,
      [planId, input.group_id ?? null, input.title, status, input.priority ?? 'medium',
        input.start_date ?? null, input.due_date ?? null, input.notes ?? null, order, actorId,
        status === 'done' ? 100 : input.progress_pct ?? 0, input.is_milestone ?? false],
    );
    const id = inserted.rows[0].id;
    await replaceAssignees(db, id, input.assignee_ids ?? []);
    if (input.allocations) await setAllocations(db, id, input.allocations);
    await normaliseMilestone(db, id);
    return (await getTask(id, db))!;
  });
}

export type TaskUpdateResult = Task & {
  /** Tasks the automatic scheduler moved because of this change (with their dates before), for Undo. */
  rescheduled: RescheduleChange[];
};

export async function updateTask(id: string, input: TaskInput, actorId: string): Promise<TaskUpdateResult | null> {
  return withTransaction(async db => {
    const current = (await db.query(
      `SELECT plan_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(due_date, 'YYYY-MM-DD') AS due_date
       FROM drafting_tasks WHERE id = $1 FOR UPDATE`, [id],
    )).rows[0];
    if (!current) return null;
    if (input.group_id && !(await groupBelongsToPlan(db, input.group_id, current.plan_id))) {
      throw new DraftingRuleError('The selected group belongs to a different plan.');
    }
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of ['group_id', 'title', 'status', 'priority', 'start_date', 'due_date', 'notes', 'sort_order', 'progress_pct', 'is_milestone'] as const) {
      if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
    }
    if (input.status !== undefined) {
      // Record when a task is finished (keeping the first completion time); reopening clears it.
      set.push(input.status === 'done' ? 'completed_at = COALESCE(completed_at, NOW())' : 'completed_at = NULL');
      if (input.status === 'done' && input.progress_pct === undefined) set.push('progress_pct = 100');
    }
    values.push(actorId);
    await db.query(
      `UPDATE drafting_tasks SET ${[...set, `updated_by = $${values.length}`, 'updated_at = NOW()'].join(', ')} WHERE id = $1`,
      values,
    );
    if (input.assignee_ids) await replaceAssignees(db, id, input.assignee_ids);
    if (input.allocations) await setAllocations(db, id, input.allocations);
    await normaliseMilestone(db, id);

    // Automatic scheduling: when the dates change, push the tasks that wait for this one.
    const datesTouched = input.start_date !== undefined || input.due_date !== undefined || input.is_milestone !== undefined;
    const rescheduled = datesTouched ? await autoSchedule(db, current.plan_id, actorId) : [];
    if (rescheduled.length) {
      // Undo restores the edited task too, so it goes first in the list with its dates before the edit.
      const edited = (await getTask(id, db))!;
      rescheduled.unshift({ id, title: edited.title, start_date: edited.start_date, due_date: edited.due_date,
        old_start_date: current.start_date, old_due_date: current.due_date });
    }
    return { ...(await getTask(id, db))!, rescheduled };
  });
}

/** Runs the scheduler for a plan if it has automatic scheduling on. */
async function autoSchedule(db: Db, planId: string, actorId: string | null): Promise<RescheduleChange[]> {
  const plan = (await db.query(`SELECT auto_schedule FROM drafting_plans WHERE id = $1`, [planId])).rows[0];
  return plan?.auto_schedule ? runReschedule(db, planId, true, actorId) : [];
}

export async function deleteTask(id: string): Promise<boolean> {
  return (await query(`DELETE FROM drafting_tasks WHERE id = $1`, [id])).rowCount! > 0;
}

export async function updatePlan(id: string, input: PlanInput, actorId: string): Promise<Plan | null> {
  return withTransaction(async db => {
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of ['name', 'project_id', 'team_id', 'status', 'start_date', 'target_date', 'description', 'calendar_id', 'auto_schedule'] as const) {
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
