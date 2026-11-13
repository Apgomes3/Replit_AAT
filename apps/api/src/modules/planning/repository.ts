// SQL for the shared planning engine: calendars, people (resources), leave and workload.
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db';
import { addDays, FALLBACK_CALENDAR, hoursOn, WorkCalendar } from './calendar';
import type { CalendarInput, LeaveInput, ResourceInput } from './validation';

type Db = Pick<PoolClient, 'query'>;
const defaultDb = { query } as Db;

export class PlanningRuleError extends Error {}

export type Calendar = {
  id: string; name: string; description: string | null; week_hours: number[]; is_default: boolean;
  exception_count: number; plan_count: number; people_count: number;
};
export type CalendarDay = { day: string; hours: number; name: string | null };

const CALENDAR_SELECT = `
  SELECT c.id, c.name, c.description, c.week_hours::float8[] AS week_hours, c.is_default,
    (SELECT COUNT(*)::int FROM planning_calendar_days d WHERE d.calendar_id = c.id) AS exception_count,
    (SELECT COUNT(*)::int FROM drafting_plans p WHERE p.calendar_id = c.id) AS plan_count,
    (SELECT COUNT(*)::int FROM planning_resources r WHERE r.calendar_id = c.id) AS people_count
  FROM planning_calendars c`;

// ---------- calendars ----------

export async function listCalendars(): Promise<Calendar[]> {
  return (await query(`${CALENDAR_SELECT} ORDER BY c.is_default DESC, c.name`)).rows;
}

export async function getCalendar(id: string, db: Db = defaultDb): Promise<Calendar | null> {
  return (await db.query(`${CALENDAR_SELECT} WHERE c.id = $1`, [id])).rows[0] ?? null;
}

export async function listCalendarDays(calendarId: string, year?: number): Promise<CalendarDay[]> {
  return (await query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, hours::float8 AS hours, name FROM planning_calendar_days
     WHERE calendar_id = $1 ${year ? 'AND EXTRACT(YEAR FROM day) = $2' : ''} ORDER BY day`,
    year ? [calendarId, year] : [calendarId],
  )).rows;
}

export async function createCalendar(input: CalendarInput, actorId: string): Promise<Calendar> {
  return withTransaction(async db => {
    if (input.is_default) await db.query(`UPDATE planning_calendars SET is_default = false WHERE is_default`);
    const r = await db.query(
      `INSERT INTO planning_calendars (name, description, week_hours, is_default, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [input.name, input.description ?? null, input.week_hours ?? [9, 9, 9, 9, 9, 8, 0], input.is_default ?? false, actorId],
    );
    if (input.copy_days_from) {
      await db.query(
        `INSERT INTO planning_calendar_days (calendar_id, day, hours, name)
         SELECT $1, day, hours, name FROM planning_calendar_days WHERE calendar_id = $2`,
        [r.rows[0].id, input.copy_days_from],
      );
    }
    return (await getCalendar(r.rows[0].id, db))!;
  });
}

export async function updateCalendar(id: string, input: CalendarInput, actorId: string): Promise<Calendar | null> {
  return withTransaction(async db => {
    const current = (await db.query(`SELECT is_default FROM planning_calendars WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!current) return null;
    if (input.is_default === false && current.is_default) {
      throw new PlanningRuleError('One calendar must stay the default. Make another calendar the default instead.');
    }
    if (input.is_default) await db.query(`UPDATE planning_calendars SET is_default = false WHERE is_default AND id <> $1`, [id]);
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of ['name', 'description', 'week_hours', 'is_default'] as const) {
      if (input[key] !== undefined) { values.push(input[key]); set.push(`${key} = $${values.length}`); }
    }
    values.push(actorId);
    await db.query(`UPDATE planning_calendars SET ${[...set, `updated_by = $${values.length}`, 'updated_at = NOW()'].join(', ')} WHERE id = $1`, values);
    return getCalendar(id, db);
  });
}

/** Deletes a calendar that is not the default; its plans and people fall back to the default. */
export async function deleteCalendar(id: string): Promise<boolean> {
  const cal = (await query(`SELECT is_default FROM planning_calendars WHERE id = $1`, [id])).rows[0];
  if (!cal) return false;
  if (cal.is_default) throw new PlanningRuleError('The default calendar cannot be deleted.');
  await query(`DELETE FROM planning_calendars WHERE id = $1`, [id]);
  return true;
}

/** Adds or replaces exception days (holidays: hours 0; make-up working days: hours > 0). */
export async function upsertCalendarDays(calendarId: string, days: CalendarDay[]): Promise<number> {
  return withTransaction(async db => {
    for (const d of days) {
      await db.query(
        `INSERT INTO planning_calendar_days (calendar_id, day, hours, name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (calendar_id, day) DO UPDATE SET hours = EXCLUDED.hours, name = EXCLUDED.name`,
        [calendarId, d.day, d.hours, d.name],
      );
    }
    return days.length;
  });
}

export async function deleteCalendarDays(calendarId: string, days: string[]): Promise<number> {
  return (await query(`DELETE FROM planning_calendar_days WHERE calendar_id = $1 AND day = ANY($2::date[])`, [calendarId, days])).rowCount ?? 0;
}

/** The working calendar a plan schedules on: its own, else the default, else plain calendar days. */
export async function loadPlanCalendar(db: Db, planId: string): Promise<WorkCalendar & { id: string | null; name: string }> {
  const cal = (await db.query(
    `SELECT c.id, c.name, c.week_hours::float8[] AS week_hours FROM planning_calendars c
     WHERE c.id = COALESCE((SELECT calendar_id FROM drafting_plans WHERE id = $1),
                           (SELECT id FROM planning_calendars WHERE is_default))`,
    [planId],
  )).rows[0];
  if (!cal) return { ...FALLBACK_CALENDAR, id: null, name: 'Every day' };
  return { id: cal.id, name: cal.name, week_hours: cal.week_hours, days: await loadDays(db, cal.id) };
}

async function loadDays(db: Db, calendarId: string): Promise<Record<string, number>> {
  const rows = (await db.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, hours::float8 AS hours FROM planning_calendar_days WHERE calendar_id = $1`, [calendarId],
  )).rows;
  return Object.fromEntries(rows.map(r => [r.day, Number(r.hours)]));
}

// ---------- people (resources) and leave ----------

/** A team a person belongs to (as a member or as its manager). */
export type PersonTeam = { id: string; name: string; department: string; is_manager: boolean };

export type Resource = {
  user_id: string; name: string; email: string; role: string;
  calendar_id: string | null; calendar_name: string; capacity_pct: number; notes: string | null;
  team_names: string[]; teams: PersonTeam[]; week_hours: number[];
};

/** Which people to include: one team, one department's teams, or (neither) every active user. */
export type PeopleScope = { teamId?: string; department?: string };

const PERSON_NAME = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)`;

// Active teams a person is in, as a member or as the manager.
const PERSON_TEAMS = `
  SELECT t.id, t.name, t.department, (t.manager_user_id = u.id) AS is_manager
  FROM drafting_teams t
  WHERE t.active AND (t.manager_user_id = u.id
    OR EXISTS (SELECT 1 FROM drafting_team_members m WHERE m.team_id = t.id AND m.user_id = u.id))`;

/** People with their planning settings and teams, limited to a team or a department when asked. */
export async function listResources(scope: PeopleScope = {}): Promise<Resource[]> {
  const values: unknown[] = [];
  let filter = '';
  if (scope.teamId) {
    values.push(scope.teamId);
    filter = `AND (u.id IN (SELECT user_id FROM drafting_team_members WHERE team_id = $1)
      OR u.id = (SELECT manager_user_id FROM drafting_teams WHERE id = $1))`;
  } else if (scope.department) {
    values.push(scope.department);
    filter = `AND EXISTS (SELECT 1 FROM drafting_teams t
      WHERE t.active AND LOWER(t.department) = LOWER($1) AND (t.manager_user_id = u.id
        OR EXISTS (SELECT 1 FROM drafting_team_members m WHERE m.team_id = t.id AND m.user_id = u.id)))`;
  }
  return (await query(
    `SELECT u.id AS user_id, ${PERSON_NAME} AS name, u.email, u.role,
       r.calendar_id, COALESCE(c.name, dc.name, 'Every day') AS calendar_name,
       COALESCE(c.week_hours, dc.week_hours, '{8,8,8,8,8,8,8}')::float8[] AS week_hours,
       COALESCE(r.capacity_pct, 100) AS capacity_pct, r.notes,
       COALESCE((SELECT array_agg(x.name ORDER BY x.name) FROM (${PERSON_TEAMS}) x), '{}') AS team_names,
       COALESCE((SELECT json_agg(x ORDER BY LOWER(x.department), x.name) FROM (${PERSON_TEAMS}) x), '[]'::json) AS teams
     FROM users u
     LEFT JOIN planning_resources r ON r.user_id = u.id
     LEFT JOIN planning_calendars c ON c.id = r.calendar_id
     LEFT JOIN planning_calendars dc ON dc.is_default
     WHERE u.is_active IS NOT FALSE ${filter}
     ORDER BY u.first_name, u.last_name, u.email`,
    values,
  )).rows;
}

export async function saveResource(userId: string, input: ResourceInput, actorId: string): Promise<void> {
  await query(
    `INSERT INTO planning_resources (user_id, calendar_id, capacity_pct, notes, updated_by)
     VALUES ($1, $2, COALESCE($3, 100), $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       calendar_id = CASE WHEN $6 THEN EXCLUDED.calendar_id ELSE planning_resources.calendar_id END,
       capacity_pct = COALESCE($3, planning_resources.capacity_pct),
       notes = CASE WHEN $7 THEN EXCLUDED.notes ELSE planning_resources.notes END,
       updated_by = $5, updated_at = NOW()`,
    [userId, input.calendar_id ?? null, input.capacity_pct ?? null, input.notes ?? null, actorId,
      input.calendar_id !== undefined, input.notes !== undefined],
  );
}

export type Leave = { id: string; user_id: string; start_date: string; end_date: string; hours_per_day: number | null; reason: string | null };

export async function listLeave(opts: { userIds?: string[]; from?: string; to?: string } = {}): Promise<Leave[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (opts.userIds) { values.push(opts.userIds); where.push(`user_id = ANY($${values.length}::uuid[])`); }
  if (opts.from) { values.push(opts.from); where.push(`end_date >= $${values.length}`); }
  if (opts.to) { values.push(opts.to); where.push(`start_date <= $${values.length}`); }
  return (await query(
    `SELECT id, user_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
       hours_per_day::float8 AS hours_per_day, reason
     FROM planning_leave ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY start_date`,
    values,
  )).rows;
}

export async function createLeave(userId: string, input: LeaveInput, actorId: string): Promise<Leave> {
  return (await query(
    `INSERT INTO planning_leave (user_id, start_date, end_date, hours_per_day, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
       hours_per_day::float8 AS hours_per_day, reason`,
    [userId, input.start_date, input.end_date, input.hours_per_day ?? null, input.reason ?? null, actorId],
  )).rows[0];
}

export async function deleteLeave(id: string): Promise<boolean> {
  return ((await query(`DELETE FROM planning_leave WHERE id = $1`, [id])).rowCount ?? 0) > 0;
}

// ---------- workload ----------

export type WorkloadTask = { id: string; title: string; plan_id: string; plan_code: string; project_code: string; hours: number };
export type WorkloadWeek = { week_start: string; capacity: number; booked: number; leave: number; tasks: WorkloadTask[] };
export type WorkloadRow = {
  user_id: string; name: string; calendar_name: string; capacity_pct: number; teams: PersonTeam[]; weeks: WorkloadWeek[];
};

/**
 * Hours each person is booked for, per week, across every plan of every project, against the
 * hours they can work (their calendar × capacity, minus leave). A task books its assignee on every
 * working day of its dates, at the assignment's allocation. Finished tasks and archived or
 * completed plans are left out.
 */
export async function getWorkload(opts: PeopleScope & { userIds?: string[]; from: string; weeks: number }): Promise<WorkloadRow[]> {
  const people = (await listResources({ teamId: opts.teamId, department: opts.department }))
    .filter(p => !opts.userIds || opts.userIds.includes(p.user_id));
  if (!people.length) return [];
  const to = addDays(opts.from, opts.weeks * 7 - 1);
  const ids = people.map(p => p.user_id);

  const calendars = new Map<string | null, WorkCalendar>();
  const calOf = async (calendarId: string | null): Promise<WorkCalendar> => {
    if (!calendars.has(calendarId)) {
      const row = calendarId
        ? (await query(`SELECT id, week_hours::float8[] AS week_hours FROM planning_calendars WHERE id = $1`, [calendarId])).rows[0]
        : (await query(`SELECT id, week_hours::float8[] AS week_hours FROM planning_calendars WHERE is_default`)).rows[0];
      calendars.set(calendarId, row ? { week_hours: row.week_hours, days: await loadDays(defaultDb, row.id) } : FALLBACK_CALENDAR);
    }
    return calendars.get(calendarId)!;
  };

  const assignments = (await query(
    `SELECT a.user_id, a.allocation_pct, t.id, t.title, t.plan_id, p.plan_code, pr.project_code,
       to_char(COALESCE(t.start_date, t.due_date), 'YYYY-MM-DD') AS start_date,
       to_char(COALESCE(t.due_date, t.start_date), 'YYYY-MM-DD') AS due_date
     FROM drafting_task_assignees a
     JOIN drafting_tasks t ON t.id = a.task_id
     JOIN drafting_plans p ON p.id = t.plan_id
     JOIN projects pr ON pr.id = p.project_id
     WHERE a.user_id = ANY($1::uuid[]) AND t.status <> 'done' AND p.status NOT IN ('archived', 'completed')
       AND COALESCE(t.start_date, t.due_date) <= $3 AND COALESCE(t.due_date, t.start_date) >= $2`,
    [ids, opts.from, to],
  )).rows;
  const leave = await listLeave({ userIds: ids, from: opts.from, to });

  const rows: WorkloadRow[] = [];
  for (const p of people) {
    const cal = await calOf(p.calendar_id);
    const factor = p.capacity_pct / 100;
    const weeks: WorkloadWeek[] = Array.from({ length: opts.weeks }, (_, i) => ({
      week_start: addDays(opts.from, i * 7), capacity: 0, booked: 0, leave: 0, tasks: [],
    }));
    const myLeave = leave.filter(l => l.user_id === p.user_id);
    for (let i = 0; i < opts.weeks * 7; i++) {
      const day = addDays(opts.from, i);
      const hours = hoursOn(cal, day) * factor;
      const off = myLeave.filter(l => l.start_date <= day && day <= l.end_date)
        .reduce((sum, l) => sum + (l.hours_per_day === null ? hours : Math.min(hours, l.hours_per_day * factor)), 0);
      const w = weeks[Math.floor(i / 7)]!;
      w.capacity += hours - Math.min(hours, off);
      w.leave += Math.min(hours, off);
    }
    for (const a of assignments.filter(x => x.user_id === p.user_id)) {
      for (let i = 0; i < opts.weeks * 7; i++) {
        const day = addDays(opts.from, i);
        if (day < a.start_date || day > a.due_date) continue;
        const h = hoursOn(cal, day) * factor * (a.allocation_pct / 100);
        if (!h) continue;
        const w = weeks[Math.floor(i / 7)]!;
        w.booked += h;
        const existing = w.tasks.find(t => t.id === a.id);
        if (existing) existing.hours += h;
        else w.tasks.push({ id: a.id, title: a.title, plan_id: a.plan_id, plan_code: a.plan_code, project_code: a.project_code, hours: h });
      }
    }
    for (const w of weeks) {
      w.capacity = Math.round(w.capacity * 10) / 10;
      w.booked = Math.round(w.booked * 10) / 10;
      w.leave = Math.round(w.leave * 10) / 10;
      w.tasks.forEach(t => { t.hours = Math.round(t.hours * 10) / 10; });
      w.tasks.sort((a, b) => b.hours - a.hours);
    }
    rows.push({ user_id: p.user_id, name: p.name, calendar_name: p.calendar_name, capacity_pct: p.capacity_pct, teams: p.teams, weeks });
  }
  return rows;
}
