// Pure input validation for the planning module. Each validator returns { value } or { error }.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };
const has = (body: any, key: string) => Object.prototype.hasOwnProperty.call(body, key);
const isObject = (body: unknown) => !!body && typeof body === 'object' && !Array.isArray(body);
const validHours = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24;

export type CalendarInput = {
  name?: string; description?: string | null; week_hours?: number[]; is_default?: boolean; copy_days_from?: string;
};

export function validateCalendarInput(body: any, { creating }: { creating: boolean }): Result<CalendarInput> {
  if (!isObject(body)) return { error: 'Request body must be an object.' };
  const out: CalendarInput = {};
  if (has(body, 'name') || creating) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required.' };
    if (body.name.trim().length > 120) return { error: 'name must be at most 120 characters.' };
    out.name = body.name.trim();
  }
  if (has(body, 'description')) {
    if (body.description !== null && typeof body.description !== 'string') return { error: 'description must be text.' };
    out.description = body.description?.trim() || null;
  }
  if (has(body, 'week_hours')) {
    const w = body.week_hours;
    if (!Array.isArray(w) || w.length !== 7 || !w.every(validHours)) {
      return { error: 'week_hours must list 7 numbers of hours (Monday to Sunday), each from 0 to 24.' };
    }
    if (!w.some((h: number) => h > 0)) return { error: 'At least one day of the week must have working hours.' };
    out.week_hours = w.map((h: number) => Math.round(h * 100) / 100);
  }
  if (has(body, 'is_default')) {
    if (typeof body.is_default !== 'boolean') return { error: 'is_default must be true or false.' };
    out.is_default = body.is_default;
  }
  if (creating && has(body, 'copy_days_from')) {
    if (!isUuid(body.copy_days_from)) return { error: 'copy_days_from must be a calendar id.' };
    out.copy_days_from = body.copy_days_from;
  }
  if (!creating && Object.keys(out).length === 0) return { error: 'Nothing to update.' };
  return { value: out };
}

export type DayInput = { day: string; hours: number; name: string | null };

/** { days: [{ day, hours, name }] } — up to 400 days at once. */
export function validateDaysInput(body: any): Result<DayInput[]> {
  if (!isObject(body) || !Array.isArray(body.days) || !body.days.length) return { error: 'days must be a non-empty list.' };
  if (body.days.length > 400) return { error: 'At most 400 days at once.' };
  const out: DayInput[] = [];
  for (const d of body.days) {
    if (!isObject(d) || !isIsoDate(d.day)) return { error: 'Each day needs a date (YYYY-MM-DD).' };
    if (!validHours(d.hours)) return { error: 'hours must be a number from 0 to 24 (0 = holiday).' };
    if (d.name !== undefined && d.name !== null && (typeof d.name !== 'string' || d.name.length > 120)) {
      return { error: 'name must be text of at most 120 characters.' };
    }
    out.push({ day: d.day, hours: d.hours, name: d.name?.trim() || null });
  }
  return { value: out };
}

export type ResourceInput = { calendar_id?: string | null; capacity_pct?: number; notes?: string | null };

export function validateResourceInput(body: any): Result<ResourceInput> {
  if (!isObject(body)) return { error: 'Request body must be an object.' };
  const out: ResourceInput = {};
  if (has(body, 'calendar_id')) {
    if (body.calendar_id !== null && !isUuid(body.calendar_id)) return { error: 'calendar_id must be a calendar id or null (default calendar).' };
    out.calendar_id = body.calendar_id;
  }
  if (has(body, 'capacity_pct')) {
    if (!Number.isInteger(body.capacity_pct) || body.capacity_pct < 0 || body.capacity_pct > 100) return { error: 'capacity_pct must be a whole number from 0 to 100.' };
    out.capacity_pct = body.capacity_pct;
  }
  if (has(body, 'notes')) {
    if (body.notes !== null && typeof body.notes !== 'string') return { error: 'notes must be text.' };
    out.notes = body.notes?.trim() || null;
  }
  if (Object.keys(out).length === 0) return { error: 'Nothing to update.' };
  return { value: out };
}

export const WORK_STATUSES = ['not_started', 'in_progress', 'review', 'done'] as const;
export type WorkStatus = typeof WORK_STATUSES[number];

export type PersonalTaskInput = {
  title?: string; notes?: string | null; project_id?: string | null; initiative_id?: string | null; status?: WorkStatus; progress_pct?: number;
  start_date?: string | null; due_date?: string | null; planned_hours?: number | null;
};

function optionalDate(body: any, key: string, out: Record<string, unknown>): string | null {
  if (!has(body, key)) return null;
  if (body[key] !== null && body[key] !== '' && !isIsoDate(body[key])) return `${key} must be a date (YYYY-MM-DD) or empty.`;
  out[key] = body[key] || null;
  return null;
}

/** A person's own task: title required on create; dates, project, effort and progress optional. */
export function validatePersonalTaskInput(body: any, { creating }: { creating: boolean }): Result<PersonalTaskInput> {
  if (!isObject(body)) return { error: 'Request body must be an object.' };
  const out: PersonalTaskInput & Record<string, unknown> = {};
  if (has(body, 'title') || creating) {
    if (typeof body.title !== 'string' || !body.title.trim()) return { error: 'title is required.' };
    if (body.title.trim().length > 255) return { error: 'title must be at most 255 characters.' };
    out.title = body.title.trim();
  }
  if (has(body, 'notes')) {
    if (body.notes !== null && typeof body.notes !== 'string') return { error: 'notes must be text.' };
    out.notes = body.notes?.trim() || null;
  }
  if (has(body, 'project_id')) {
    if (body.project_id !== null && body.project_id !== '' && !isUuid(body.project_id)) return { error: 'project_id must be a project id or empty.' };
    out.project_id = body.project_id || null;
  }
  if (has(body, 'initiative_id')) {
    if (body.initiative_id !== null && body.initiative_id !== '' && !isUuid(body.initiative_id)) return { error: 'initiative_id must be an initiative id or empty.' };
    out.initiative_id = body.initiative_id || null;
  }
  if (out.project_id && out.initiative_id) return { error: 'A task belongs to a project or an initiative, not both.' };
  if (has(body, 'status')) {
    if (!(WORK_STATUSES as readonly string[]).includes(body.status)) return { error: `status must be one of: ${WORK_STATUSES.join(', ')}.` };
    out.status = body.status;
  }
  if (has(body, 'progress_pct')) {
    if (!Number.isInteger(body.progress_pct) || body.progress_pct < 0 || body.progress_pct > 100) return { error: 'progress_pct must be a whole number from 0 to 100.' };
    out.progress_pct = body.progress_pct;
  }
  const dateError = optionalDate(body, 'start_date', out) || optionalDate(body, 'due_date', out);
  if (dateError) return { error: dateError };
  if (out.start_date && out.due_date && out.due_date < out.start_date) return { error: 'The due date cannot be before the start date.' };
  if (has(body, 'planned_hours')) {
    const v = body.planned_hours;
    if (v !== null && v !== '' && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 2000)) return { error: 'planned_hours must be more than 0 and at most 2000, or empty.' };
    out.planned_hours = v === '' || v === null ? null : Math.round(v * 100) / 100;
  }
  if (!creating && Object.keys(out).length === 0) return { error: 'Nothing to update.' };
  return { value: out };
}

export const COMMITMENT_KINDS = ['meeting', 'role', 'other'] as const;
export type CommitmentInput = {
  title: string; kind: typeof COMMITMENT_KINDS[number]; start_date: string; end_date: string | null; project_id: string | null;
  /** Either weekdays + hours_per_day ... */
  weekdays: number[] | null; hours_per_day: number | null;
  /** ... or a share of the person's capacity. */
  capacity_pct: number | null;
};

/** A standing commitment, always sent whole (create and replace). */
export function validateCommitmentInput(body: any): Result<CommitmentInput> {
  if (!isObject(body)) return { error: 'Request body must be an object.' };
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) return { error: 'title is required (at most 200 characters).' };
  const kind = body.kind ?? 'meeting';
  if (!(COMMITMENT_KINDS as readonly string[]).includes(kind)) return { error: `kind must be one of: ${COMMITMENT_KINDS.join(', ')}.` };
  if (!isIsoDate(body.start_date)) return { error: 'start_date must be a date (YYYY-MM-DD).' };
  const end = body.end_date || null;
  if (end !== null && (!isIsoDate(end) || end < body.start_date)) return { error: 'end_date must be a date on or after start_date, or empty for ongoing.' };
  const project = body.project_id || null;
  if (project !== null && !isUuid(project)) return { error: 'project_id must be a project id or empty.' };
  const byShare = body.capacity_pct !== undefined && body.capacity_pct !== null && body.capacity_pct !== '';
  const out: CommitmentInput = {
    title: body.title.trim(), kind, start_date: body.start_date, end_date: end, project_id: project,
    weekdays: null, hours_per_day: null, capacity_pct: null,
  };
  if (byShare) {
    if (!Number.isInteger(body.capacity_pct) || body.capacity_pct < 1 || body.capacity_pct > 100) return { error: 'capacity_pct must be a whole number from 1 to 100.' };
    out.capacity_pct = body.capacity_pct;
  } else {
    const days = body.weekdays;
    if (!Array.isArray(days) || !days.length || !days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
      return { error: 'Choose the weekdays (0 = Monday ... 6 = Sunday) and the hours, or a share of time.' };
    }
    if (!validHours(body.hours_per_day) || body.hours_per_day === 0) return { error: 'hours_per_day must be more than 0 and at most 24.' };
    out.weekdays = [...new Set<number>(days)].sort();
    out.hours_per_day = Math.round(body.hours_per_day * 100) / 100;
  }
  return { value: out };
}

export type LeaveInput ={ start_date: string; end_date: string; hours_per_day?: number | null; reason?: string | null };

export function validateLeaveInput(body: any): Result<LeaveInput> {
  if (!isObject(body)) return { error: 'Request body must be an object.' };
  if (!isIsoDate(body.start_date) || !isIsoDate(body.end_date)) return { error: 'start_date and end_date must be dates (YYYY-MM-DD).' };
  if (body.end_date < body.start_date) return { error: 'end_date cannot be before start_date.' };
  const out: LeaveInput = { start_date: body.start_date, end_date: body.end_date };
  if (has(body, 'hours_per_day') && body.hours_per_day !== null) {
    if (!validHours(body.hours_per_day) || body.hours_per_day === 0) return { error: 'hours_per_day must be more than 0 and at most 24, or empty for whole days.' };
    out.hours_per_day = body.hours_per_day;
  }
  if (has(body, 'reason')) {
    if (body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 200)) return { error: 'reason must be text of at most 200 characters.' };
    out.reason = body.reason?.trim() || null;
  }
  return { value: out };
}
