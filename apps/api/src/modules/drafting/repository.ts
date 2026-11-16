// All SQL for the drafting module lives here; routes never build queries.
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db';
import type { GroupInput, LinkInput, PlanInput, PlanStatus, PlanVisibility, TaskInput, TaskPriority, TaskStatus, TeamInput } from './validation';
import { computeFloat, DateChange, LinkType, pushSchedule, shortfallDays } from './schedule';
import { loadPlanCalendar } from '../planning/repository';
import { workingDaysBetween, workingDayShift } from '../planning/calendar';

type Db = Pick<PoolClient, 'query'>;

export type Person = { id: string; name: string; email: string; role: string };

export type Team = {
  id: string;
  name: string;
  description: string | null;
  department: string;
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
  project: { id: string; code: string; name: string } | null;
  team: { id: string; name: string; department: string; manager_name: string | null } | null;
  design_book: { id: string; code: string; title: string } | null;
  enquiry: { id: string; number: string; title: string } | null;
  /** Internal work this plan is for (initiatives module). */
  initiative: { id: string; code: string; title: string } | null;
  owner: { id: string; name: string } | null;
  visibility: PlanVisibility;
  members: Array<{ id: string; name: string }>;
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
  SELECT t.id, t.name, t.description, t.department, t.active, t.created_at, t.updated_at,
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
    CASE WHEN pr.id IS NULL THEN NULL ELSE json_build_object('id', pr.id, 'code', pr.project_code, 'name', pr.project_name) END AS project,
    CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object('id', t.id, 'name', t.name, 'department', t.department,
      'manager_name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), ''), m.email)) END AS team,
    CASE WHEN db.id IS NULL THEN NULL ELSE json_build_object('id', db.id, 'code', db.book_code, 'title', db.book_title) END AS design_book,
    CASE WHEN e.id IS NULL THEN NULL ELSE json_build_object('id', e.id, 'number', e.enquiry_number, 'title', e.title) END AS enquiry,
    CASE WHEN ini.id IS NULL THEN NULL ELSE json_build_object('id', ini.id, 'code', ini.code, 'title', ini.title) END AS initiative,
    CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id,
      'name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', o.first_name, o.last_name)), ''), o.email)) END AS owner,
    p.visibility,
    COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', ${PERSON_NAME}) ORDER BY u.first_name, u.last_name)
      FROM planning_plan_members pm JOIN users u ON u.id = pm.user_id WHERE pm.plan_id = p.id), '[]'::json) AS members,
    (SELECT COUNT(*)::int FROM drafting_tasks dt WHERE dt.plan_id = p.id) AS task_count,
    (SELECT COUNT(*)::int FROM drafting_tasks dt WHERE dt.plan_id = p.id AND dt.status = 'done') AS done_count,
    (SELECT COUNT(*)::int FROM drafting_tasks dt
      WHERE dt.plan_id = p.id AND dt.status <> 'done' AND dt.due_date < CURRENT_DATE) AS late_count,
    p.calendar_id, COALESCE(pc.name, dc.name) AS calendar_name, p.auto_schedule, p.baseline_set_at
  FROM drafting_plans p
  LEFT JOIN projects pr ON pr.id = p.project_id
  LEFT JOIN drafting_teams t ON t.id = p.team_id
  LEFT JOIN users m ON m.id = t.manager_user_id
  LEFT JOIN design_books db ON db.id = p.design_book_id
  LEFT JOIN enquiries e ON e.id = p.enquiry_id
  LEFT JOIN initiatives ini ON ini.id = p.initiative_id
  LEFT JOIN users o ON o.id = p.owner_user_id
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

/** The department whose teams the Drafting screens show and create. */
export const DRAFTING_DEPARTMENT = 'Drafting';

/** Company teams; with a department, only that department's teams (case-insensitive). */
export async function listTeams(opts: { department?: string } = {}): Promise<Team[]> {
  return opts.department
    ? (await query(`${TEAM_SELECT} WHERE LOWER(t.department) = LOWER($1) ORDER BY t.active DESC, t.name`, [opts.department])).rows
    : (await query(`${TEAM_SELECT} ORDER BY LOWER(t.department), t.active DESC, t.name`)).rows;
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
      `INSERT INTO drafting_teams (name, description, manager_user_id, active, department, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [input.name, input.description ?? null, input.manager_user_id ?? null, input.active ?? true, input.department ?? DRAFTING_DEPARTMENT, actorId],
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
    for (const key of ['name', 'description', 'manager_user_id', 'active', 'department'] as const) {
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

export type PlanFilters = {
  team_id?: string; project_id?: string; design_book_id?: string; enquiry_id?: string; initiative_id?: string; status?: string;
  /** Only plans in this team department (Drafting's screen). */
  department?: string;
  /** Only plans this user may see (see planAccess.ts); omitted = no visibility filter. */
  visibleTo?: string;
  /** Only plans this user owns, is shared on or has tasks in. */
  involving?: string;
};

/** SQL condition: user $n is the owner, a shared member or assigned to a task of plan p. */
const involves = (n: number) => `(p.owner_user_id = $${n}
  OR EXISTS (SELECT 1 FROM planning_plan_members pm WHERE pm.plan_id = p.id AND pm.user_id = $${n})
  OR EXISTS (SELECT 1 FROM drafting_task_assignees a JOIN drafting_tasks dt ON dt.id = a.task_id
             WHERE dt.plan_id = p.id AND a.user_id = $${n}))`;

/** SQL condition matching canViewPlan in ../planning/planAccess.ts (admins are not filtered). */
const visibleTo = (n: number) => `(p.visibility = 'everyone' OR ${involves(n)}
  OR (p.visibility = 'team' AND (t.manager_user_id = $${n}
      OR EXISTS (SELECT 1 FROM drafting_team_members tm WHERE tm.team_id = p.team_id AND tm.user_id = $${n}))))`;

export async function listPlans(filters: PlanFilters = {}): Promise<Plan[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of [
    ['team_id', 'p.team_id'], ['project_id', 'p.project_id'], ['design_book_id', 'p.design_book_id'],
    ['enquiry_id', 'p.enquiry_id'], ['initiative_id', 'p.initiative_id'], ['status', 'p.status'],
  ] as const) {
    if (filters[key]) { values.push(filters[key]); where.push(`${column} = $${values.length}`); }
  }
  if (filters.department) { values.push(filters.department); where.push(`LOWER(t.department) = LOWER($${values.length})`); }
  if (filters.visibleTo) { values.push(filters.visibleTo); where.push(visibleTo(values.length)); }
  if (filters.involving) { values.push(filters.involving); where.push(involves(values.length)); }
  const r = await query(
    `${PLAN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (p.status = 'archived'), pr.project_code NULLS LAST, p.name`,
    values,
  );
  return r.rows;
}

/** What a user is to a plan, for planAccess.ts. null when the plan does not exist. */
export type PlanAccessFacts = {
  visibility: PlanVisibility;
  department: string | null;
  is_owner: boolean;
  is_member: boolean;
  is_assignee: boolean;
  is_team_member: boolean;
  is_team_manager: boolean;
};

export async function getPlanAccessFacts(planId: string, userId: string): Promise<PlanAccessFacts | null> {
  return (await query(
    `SELECT p.visibility, t.department,
       (p.owner_user_id = $2) AS is_owner,
       EXISTS (SELECT 1 FROM planning_plan_members pm WHERE pm.plan_id = p.id AND pm.user_id = $2) AS is_member,
       EXISTS (SELECT 1 FROM drafting_task_assignees a JOIN drafting_tasks dt ON dt.id = a.task_id
               WHERE dt.plan_id = p.id AND a.user_id = $2) AS is_assignee,
       EXISTS (SELECT 1 FROM drafting_team_members tm WHERE tm.team_id = p.team_id AND tm.user_id = $2) AS is_team_member,
       COALESCE(t.manager_user_id = $2, false) AS is_team_manager
     FROM drafting_plans p LEFT JOIN drafting_teams t ON t.id = p.team_id
     WHERE p.id = $1`,
    [planId, userId],
  )).rows[0] ?? null;
}

/** Plan of a task group, or null. */
export async function getGroupPlanId(id: string): Promise<string | null> {
  return (await query(`SELECT plan_id FROM drafting_task_groups WHERE id = $1`, [id])).rows[0]?.plan_id ?? null;
}

/** Successor plan of a link (the side that owns it), or null. */
export async function getLinkSuccessorPlanId(id: string): Promise<string | null> {
  return (await query(
    `SELECT s.plan_id FROM drafting_task_links l JOIN drafting_tasks s ON s.id = l.successor_id WHERE l.id = $1`, [id],
  )).rows[0]?.plan_id ?? null;
}

/** Pickers for plan links. */
export async function listDesignBookOptions(): Promise<Array<{ id: string; code: string; title: string; project_id: string | null }>> {
  return (await query(`SELECT id, book_code AS code, book_title AS title, project_id FROM design_books ORDER BY book_code`)).rows;
}

export async function listEnquiryOptions(): Promise<Array<{ id: string; number: string; title: string }>> {
  return (await query(
    `SELECT id, enquiry_number AS number, title FROM enquiries ORDER BY created_at DESC LIMIT 500`,
  )).rows;
}

/** Initiatives a plan can be for: not dropped, newest code first. */
export async function listInitiativeOptions(): Promise<Array<{ id: string; code: string; title: string; stage: string }>> {
  return (await query(
    `SELECT id, code, title, stage FROM initiatives WHERE stage <> 'dropped' ORDER BY code DESC LIMIT 500`,
  )).rows;
}

async function replacePlanMembers(db: Db, planId: string, userIds: string[]) {
  await db.query(`DELETE FROM planning_plan_members WHERE plan_id = $1 AND NOT (user_id = ANY($2::uuid[]))`, [planId, userIds]);
  if (userIds.length) {
    await db.query(
      `INSERT INTO planning_plan_members (plan_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [planId, userIds],
    );
  }
}

/** A plan linked to a design book is on that book's project unless a project was chosen. */
async function bookProject(db: Db, input: PlanInput): Promise<string | null | undefined> {
  if (input.project_id || !input.design_book_id) return input.project_id;
  return (await db.query(`SELECT project_id FROM design_books WHERE id = $1`, [input.design_book_id])).rows[0]?.project_id ?? input.project_id;
}

export async function getPlan(id: string, db: Db = { query } as Db): Promise<Plan | null> {
  return (await db.query(`${PLAN_SELECT} WHERE p.id = $1`, [id])).rows[0] ?? null;
}

/**
 * Drafting plans keep their DP- codes; plans made with the global tool get PL- codes.
 * The creator owns the plan.
 */
export async function createPlan(input: PlanInput, actorId: string, opts: { codePrefix?: 'DP' | 'PL' } = {}): Promise<Plan> {
  const prefix = opts.codePrefix ?? 'DP';
  return withTransaction(async db => {
    const sequence = prefix === 'DP' ? 'drafting_plan_code_seq' : 'planning_plan_code_seq';
    const seq = await db.query(`SELECT to_char(NOW(), 'YYYY') AS year, nextval('${sequence}') AS n`);
    const code = `${prefix}-${seq.rows[0].year}-${String(seq.rows[0].n).padStart(4, '0')}`;
    const inserted = await db.query(
      `INSERT INTO drafting_plans
         (plan_code, name, project_id, team_id, design_book_id, enquiry_id, visibility, owner_user_id,
          status, start_date, target_date, description, created_by, updated_by, initiative_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $8, $8, $13) RETURNING id`,
      [code, input.name, await bookProject(db, input) ?? null, input.team_id ?? null, input.design_book_id ?? null,
        input.enquiry_id ?? null, input.visibility ?? (input.team_id ? 'team' : 'private'), actorId,
        input.status ?? 'active', input.start_date ?? null, input.target_date ?? null, input.description ?? null,
        input.initiative_id ?? null],
    );
    if (input.member_ids?.length) await replacePlanMembers(db, inserted.rows[0].id, input.member_ids);
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
    const fields = { ...input, project_id: await bookProject(db, input) };
    for (const key of [
      'name', 'project_id', 'team_id', 'design_book_id', 'enquiry_id', 'initiative_id', 'visibility',
      'status', 'start_date', 'target_date', 'description', 'calendar_id', 'auto_schedule',
    ] as const) {
      if (fields[key] !== undefined) { values.push(fields[key]); set.push(`${key} = $${values.length}`); }
    }
    // A link to a design book replaces a link to an enquiry and the other way round; a link to an
    // initiative (internal work) replaces any client-side link, and a client-side link replaces it.
    if (input.design_book_id && input.enquiry_id === undefined) set.push('enquiry_id = NULL');
    if (input.enquiry_id && input.design_book_id === undefined) set.push('design_book_id = NULL');
    if (input.initiative_id) {
      for (const key of ['project_id', 'design_book_id', 'enquiry_id'] as const) if (fields[key] === undefined) set.push(`${key} = NULL`);
    } else if ((fields.project_id || input.design_book_id || input.enquiry_id) && input.initiative_id === undefined) {
      set.push('initiative_id = NULL');
    }
    values.push(actorId);
    const updated = await db.query(
      `UPDATE drafting_plans SET ${[...set, `updated_by = $${values.length}`, 'updated_at = NOW()'].join(', ')}
       WHERE id = $1 RETURNING id, visibility, team_id`,
      values,
    );
    if (!updated.rows[0]) return null;
    if (updated.rows[0].visibility === 'team' && !updated.rows[0].team_id) {
      throw new DraftingRuleError('A team plan needs a team. Pick a team or make the plan private.');
    }
    if (input.member_ids) await replacePlanMembers(db, id, input.member_ids);
    return getPlan(id, db);
  });
}
