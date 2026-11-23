// My Work: everything one person has to do, across every plan, plus their own tasks and standing
// commitments, with their booked hours against what they can work.
import { query } from '../../db';
import { getWorkload, WorkloadWeek } from './repository';
import { TASK_LINKS } from './validation';
import type { CommitmentInput, PersonalTaskInput, TaskLink, WorkStatus } from './validation';

type ProjectRef = { id: string; code: string; name: string } | null;

export type MyPlanTask = {
  id: string; title: string; status: WorkStatus; progress_pct: number; is_milestone: boolean; allocation_pct: number;
  start_date: string | null; due_date: string | null;
  plan: { id: string; code: string; name: string }; project: ProjectRef;
};
export type PersonalTask = {
  id: string; title: string; notes: string | null; status: WorkStatus; progress_pct: number;
  start_date: string | null; due_date: string | null; planned_hours: number | null; project: ProjectRef; completed_at: string | null;
  /** Time of day (HH:MM) it starts on its first day, or null. */
  start_time: string | null;
  /** Takes the whole working day on each day it covers. */
  all_day: boolean;
  initiative: ProjectRef; enquiry: ProjectRef; design_book: ProjectRef;
};
export type Commitment = {
  id: string; title: string; kind: 'meeting' | 'role' | 'other'; weekdays: number[] | null; hours_per_day: number | null;
  capacity_pct: number | null; start_date: string; end_date: string | null; project: ProjectRef;
  /** Time of day (HH:MM) a weekday commitment starts, or null. */
  start_time: string | null;
  /** Takes the whole working day on its weekdays. */
  all_day: boolean;
};
export type MyWork = {
  from: string; calendar_name: string; capacity_pct: number; weeks: WorkloadWeek[];
  plan_tasks: MyPlanTask[]; tasks: PersonalTask[]; commitments: Commitment[];
};

const PROJECT = `CASE WHEN pr.id IS NULL THEN NULL ELSE json_build_object('id', pr.id, 'code', pr.project_code, 'name', pr.project_name) END`;
const D = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;

// Finished work stays visible for a week so it can be reopened if ticked by mistake.
const RECENTLY_DONE = `(t.status <> 'done' OR t.completed_at >= NOW() - INTERVAL '7 days')`;

const PERSONAL_SELECT = `
  SELECT t.id, t.title, t.notes, t.status, t.progress_pct, ${D('t.start_date')} AS start_date, ${D('t.due_date')} AS due_date,
    t.planned_hours::float8 AS planned_hours, t.completed_at, ${PROJECT} AS project, to_char(t.start_time, 'HH24:MI') AS start_time, t.all_day,
    CASE WHEN ini.id IS NULL THEN NULL ELSE json_build_object('id', ini.id, 'code', ini.code, 'name', ini.title) END AS initiative,
    CASE WHEN enq.id IS NULL THEN NULL ELSE json_build_object('id', enq.id, 'code', enq.enquiry_number, 'name', enq.title) END AS enquiry,
    CASE WHEN dbk.id IS NULL THEN NULL ELSE json_build_object('id', dbk.id, 'code', dbk.book_code, 'name', dbk.book_title) END AS design_book
  FROM planning_personal_tasks t LEFT JOIN projects pr ON pr.id = t.project_id LEFT JOIN initiatives ini ON ini.id = t.initiative_id
  LEFT JOIN enquiries enq ON enq.id = t.enquiry_id LEFT JOIN design_books dbk ON dbk.id = t.design_book_id`;

const COMMITMENT_SELECT = `
  SELECT c.id, c.title, c.kind, c.weekdays, c.hours_per_day::float8 AS hours_per_day, c.capacity_pct,
    ${D('c.start_date')} AS start_date, ${D('c.end_date')} AS end_date, ${PROJECT} AS project, to_char(c.start_time, 'HH24:MI') AS start_time, c.all_day
  FROM planning_commitments c LEFT JOIN projects pr ON pr.id = c.project_id`;

export async function getMyWork(userId: string, from: string, weeks: number): Promise<MyWork> {
  const [row] = await getWorkload({ userIds: [userId], from, weeks });
  const planTasks = (await query(
    `SELECT t.id, t.title, t.status, t.progress_pct, t.is_milestone, a.allocation_pct,
       ${D('t.start_date')} AS start_date, ${D('t.due_date')} AS due_date,
       json_build_object('id', p.id, 'code', p.plan_code, 'name', p.name) AS plan, ${PROJECT} AS project
     FROM drafting_task_assignees a
     JOIN drafting_tasks t ON t.id = a.task_id
     JOIN drafting_plans p ON p.id = t.plan_id
     LEFT JOIN projects pr ON pr.id = p.project_id
     WHERE a.user_id = $1 AND p.status NOT IN ('archived', 'completed') AND ${RECENTLY_DONE}
     ORDER BY COALESCE(t.due_date, t.start_date) NULLS LAST, t.title`,
    [userId],
  )).rows;
  const tasks = (await query(
    `${PERSONAL_SELECT} WHERE t.user_id = $1 AND ${RECENTLY_DONE}
     ORDER BY COALESCE(t.due_date, t.start_date) NULLS LAST, t.created_at`, [userId],
  )).rows;
  const commitments = (await query(
    `${COMMITMENT_SELECT} WHERE c.user_id = $1 AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
     ORDER BY c.kind, c.title`, [userId],
  )).rows;
  return {
    from, calendar_name: row?.calendar_name ?? '', capacity_pct: row?.capacity_pct ?? 100, weeks: row?.weeks ?? [],
    plan_tasks: planTasks, tasks, commitments,
  };
}

export async function listProjectOptions(): Promise<Array<{ id: string; code: string; name: string }>> {
  return (await query(`SELECT id, project_code AS code, project_name AS name FROM projects ORDER BY project_code`)).rows;
}

type LinkOption = { id: string; code: string; name: string };
export type LinkOptions = { projects: LinkOption[]; initiatives: LinkOption[]; enquiries: LinkOption[]; design_books: LinkOption[] };

/**
 * What a task can be for, limited to the modules the person can see: projects, initiatives that
 * are approved / running / on hold, open enquiries, and design books.
 */
export async function listLinkOptions(visible: Record<'projects' | 'initiatives' | 'enquiries' | 'design_books', boolean>): Promise<LinkOptions> {
  const none = Promise.resolve({ rows: [] as LinkOption[] });
  const [projects, initiatives, enquiries, books] = await Promise.all([
    visible.projects ? query(`SELECT id, project_code AS code, project_name AS name FROM projects ORDER BY project_code`) : none,
    visible.initiatives ? query(`SELECT id, code, title AS name FROM initiatives WHERE stage IN ('approved','in_progress','on_hold') ORDER BY code`) : none,
    visible.enquiries ? query(`SELECT id, enquiry_number AS code, title AS name FROM enquiries WHERE status NOT IN ('won','lost','closed') ORDER BY enquiry_number DESC`) : none,
    visible.design_books ? query(`SELECT id, book_code AS code, book_title AS name FROM design_books ORDER BY book_code`) : none,
  ]);
  return { projects: projects.rows, initiatives: initiatives.rows, enquiries: enquiries.rows, design_books: books.rows };
}

export type LinkedTask = {
  id: string; title: string; status: WorkStatus; progress_pct: number; start_date: string | null; due_date: string | null;
  planned_hours: number | null; user_id: string; user_name: string;
};

/** Everyone's own tasks for one enquiry, design book, project or initiative (open first). */
export async function listLinkedTasks(link: TaskLink, id: string): Promise<LinkedTask[]> {
  return (await query(
    `SELECT t.id, t.title, t.status, t.progress_pct, ${D('t.start_date')} AS start_date, ${D('t.due_date')} AS due_date,
       t.planned_hours::float8 AS planned_hours, t.user_id,
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS user_name
     FROM planning_personal_tasks t JOIN users u ON u.id = t.user_id
     WHERE t.${link} = $1
     ORDER BY (t.status = 'done'), COALESCE(t.due_date, t.start_date) NULLS LAST, t.created_at`, [id],
  )).rows;
}

// ---------- own tasks ----------

export async function createPersonalTask(userId: string, input: PersonalTaskInput, actorId: string): Promise<PersonalTask> {
  const done = input.status === 'done';
  const r = await query(
    `INSERT INTO planning_personal_tasks (user_id, title, notes, project_id, status, progress_pct, start_date, due_date, planned_hours, completed_at, created_by,
       initiative_id, enquiry_id, design_book_id, start_time, all_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${done ? 'NOW()' : 'NULL'}, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [userId, input.title, input.notes ?? null, input.project_id ?? null, input.status ?? 'not_started',
      input.progress_pct ?? (done ? 100 : 0), input.start_date ?? null, input.due_date ?? null, input.planned_hours ?? null, actorId,
      input.initiative_id ?? null, input.enquiry_id ?? null, input.design_book_id ?? null, input.start_time ?? null, input.all_day ?? false],
  );
  return (await getPersonalTask(r.rows[0].id))!;
}

export async function getPersonalTask(id: string): Promise<(PersonalTask & { user_id: string }) | null> {
  return (await query(`${PERSONAL_SELECT.replace('SELECT t.id,', 'SELECT t.user_id, t.id,')} WHERE t.id = $1`, [id])).rows[0] ?? null;
}

export async function updatePersonalTask(id: string, input: PersonalTaskInput): Promise<PersonalTask | null> {
  const set: string[] = [];
  const values: unknown[] = [id];
  for (const key of ['title', 'notes', ...TASK_LINKS, 'status', 'progress_pct', 'start_date', 'due_date', 'planned_hours', 'start_time', 'all_day'] as const) {
    if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
  }
  // A task is for one thing: choosing a project, initiative, enquiry or design book clears the others.
  if (TASK_LINKS.some(k => input[k])) {
    for (const k of TASK_LINKS) if (input[k] === undefined) set.push(`${k} = NULL`);
  }
  if (input.status !== undefined) {
    set.push(input.status === 'done' ? 'completed_at = COALESCE(completed_at, NOW())' : 'completed_at = NULL');
    if (input.status === 'done' && input.progress_pct === undefined) set.push('progress_pct = 100');
  }
  const r = await query(
    // A due date before the start date is refused by the table's CHECK (23514 in the route).
    `UPDATE planning_personal_tasks SET ${[...set, 'updated_at = NOW()'].join(', ')} WHERE id = $1 RETURNING id`,
    values,
  );
  return r.rows[0] ? getPersonalTask(id) : null;
}

export async function deletePersonalTask(id: string): Promise<boolean> {
  return ((await query(`DELETE FROM planning_personal_tasks WHERE id = $1`, [id])).rowCount ?? 0) > 0;
}

// ---------- plan tasks assigned to me ----------

/** True when the user is assigned to the plan task. */
export async function isAssigned(taskId: string, userId: string): Promise<boolean> {
  return (await query(`SELECT 1 FROM drafting_task_assignees WHERE task_id = $1 AND user_id = $2`, [taskId, userId])).rows.length > 0;
}

// ---------- standing commitments ----------

export async function getCommitment(id: string): Promise<(Commitment & { user_id: string }) | null> {
  return (await query(`${COMMITMENT_SELECT.replace('SELECT c.id,', 'SELECT c.user_id, c.id,')} WHERE c.id = $1`, [id])).rows[0] ?? null;
}

export async function saveCommitment(userId: string, input: CommitmentInput, actorId: string, id?: string): Promise<Commitment | null> {
  const values = [input.title, input.kind, input.weekdays, input.hours_per_day, input.capacity_pct, input.start_date, input.end_date, input.project_id, input.start_time ?? null, input.all_day ?? false];
  const r = id
    ? await query(
      `UPDATE planning_commitments SET title = $2, kind = $3, weekdays = $4, hours_per_day = $5, capacity_pct = $6,
         start_date = $7, end_date = $8, project_id = $9, start_time = $10, all_day = $11, updated_at = NOW() WHERE id = $1 RETURNING id`, [id, ...values])
    : await query(
      `INSERT INTO planning_commitments (title, kind, weekdays, hours_per_day, capacity_pct, start_date, end_date, project_id, start_time, all_day, user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`, [...values, userId, actorId]);
  return r.rows[0] ? getCommitment(r.rows[0].id) : null;
}

export async function deleteCommitment(id: string): Promise<boolean> {
  return ((await query(`DELETE FROM planning_commitments WHERE id = $1`, [id])).rowCount ?? 0) > 0;
}
