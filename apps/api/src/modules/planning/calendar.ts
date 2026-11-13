// Pure working-calendar arithmetic (no database). Dates are ISO 'YYYY-MM-DD' calendar days.

export type WorkCalendar = {
  /** Hours per weekday, Monday first; 0 = not a working day. */
  week_hours: number[];
  /** Exceptions by date: 0 = holiday, > 0 = working day with these hours. */
  days: Record<string, number>;
};

/** Every day a working day: plain calendar-day arithmetic, used when no calendar is known. */
export const FALLBACK_CALENDAR: WorkCalendar = { week_hours: [8, 8, 8, 8, 8, 8, 8], days: {} };

const DAY_MS = 86_400_000;
const LIMIT = 3660; // ten years of days: stops runaway loops on a calendar with no working days

const toDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / DAY_MS; };
export const addDays = (iso: string, n: number) => new Date((toDay(iso) + n) * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => toDay(to) - toDay(from);

export function hoursOn(cal: WorkCalendar, iso: string): number {
  const exception = cal.days[iso];
  if (exception !== undefined) return exception;
  const dow = (new Date(toDay(iso) * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0
  return Number(cal.week_hours[dow] ?? 0);
}

export const isWorkingDay = (cal: WorkCalendar, iso: string) => hoursOn(cal, iso) > 0;

const hasWorkingDays = (cal: WorkCalendar) =>
  cal.week_hours.some(h => Number(h) > 0) || Object.values(cal.days).some(h => h > 0);

/** The day itself if it is a working day, else the next (dir 1) or previous (dir -1) working day. */
export function snapToWorkingDay(cal: WorkCalendar, iso: string, dir: 1 | -1 = 1): string {
  if (!hasWorkingDays(cal)) return iso;
  let d = iso;
  for (let i = 0; i < LIMIT && !isWorkingDay(cal, d); i++) d = addDays(d, dir);
  return d;
}

/**
 * Moves n working days from a working day (n < 0 goes back). addWorkingDays(mon, 1) = tue;
 * a start that is not a working day is first snapped forward (or back for n < 0).
 */
export function addWorkingDays(cal: WorkCalendar, iso: string, n: number): string {
  if (!hasWorkingDays(cal)) return addDays(iso, n);
  const dir = n < 0 ? -1 : 1;
  let d = snapToWorkingDay(cal, iso, dir);
  for (let left = Math.abs(n), i = 0; left > 0 && i < LIMIT; i++) {
    d = addDays(d, dir);
    if (isWorkingDay(cal, d)) left--;
  }
  return d;
}

/** Working days from start to due, both included (0 if the span has none). */
export function workingDaysBetween(cal: WorkCalendar, start: string, due: string): number {
  if (due < start) return 0;
  let n = 0;
  for (let d = start, i = 0; d <= due && i < LIMIT; d = addDays(d, 1), i++) if (isWorkingDay(cal, d)) n++;
  return n;
}

/** Signed working-day difference: positive when `to` is later than `from` (0 when equal). */
export function workingDayShift(cal: WorkCalendar, from: string, to: string): number {
  if (from === to) return 0;
  return to > from ? workingDaysBetween(cal, addDays(from, 1), to) : -workingDaysBetween(cal, addDays(to, 1), from);
}
