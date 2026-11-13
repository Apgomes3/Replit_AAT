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

export type LeaveInput = { start_date: string; end_date: string; hours_per_day?: number | null; reason?: string | null };

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
