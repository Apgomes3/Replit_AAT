// Pure date helpers for drafting tasks (dates are ISO 'YYYY-MM-DD' strings, compared as calendar days).

const DAY_MS = 86_400_000;

function toDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calendar days from start to due, counting both ends (Planner style: 24 Feb → 27 Feb = 4 days). */
export function durationDays(start: string | null, due: string | null): number | null {
  if (!start || !due) return null;
  return toDay(due) - toDay(start) + 1;
}

/**
 * Share of the start→due window that has elapsed by `today`, 0–100.
 * Before the start it is 0; on or after the due date it is 100.
 */
export function timeElapsedPercent(start: string | null, due: string | null, today: string): number | null {
  if (!start || !due) return null;
  const s = toDay(start);
  const e = toDay(due) + 1; // the due day itself counts as available time
  const t = toDay(today);
  if (t <= s) return 0;
  if (t >= e) return 100;
  return Math.round(((t - s) / (e - s)) * 100);
}

export function addDays(iso: string, days: number): string {
  return new Date((toDay(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return toDay(to) - toDay(from);
}

type Dated = { start_date: string | null; due_date: string | null };

/**
 * Days a successor is too early for its link (0 when respected or not checkable).
 * Same rules as the API (modules/drafting/schedule.ts): FS start ≥ pred due + 1 + lag,
 * SS start ≥ pred start + lag, FF due ≥ pred due + lag, SF due ≥ pred start − 1 + lag.
 */
export function linkShortfall(link: { link_type: string; lag_days: number }, pred: Dated, succ: Dated): number {
  const lag = link.lag_days;
  const [base, offset, field] =
    link.link_type === 'FS' ? [pred.due_date, 1 + lag, 'start_date'] as const
    : link.link_type === 'SS' ? [pred.start_date, lag, 'start_date'] as const
    : link.link_type === 'FF' ? [pred.due_date, lag, 'due_date'] as const
    : [pred.start_date, lag - 1, 'due_date'] as const;
  const have = succ[field];
  return base && have ? Math.max(0, daysBetween(have, addDays(base, offset))) : 0;
}

/** A task is late when it is not done and its due date has passed. */
export function isLate(task: { status: string; due_date: string | null }, today: string): boolean {
  return task.status !== 'done' && !!task.due_date && task.due_date < today;
}
