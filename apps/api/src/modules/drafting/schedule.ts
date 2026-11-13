// Pure scheduling rules for task links (no database access), on a working calendar.
// Dates are ISO 'YYYY-MM-DD'; a task occupies start..due inclusive; lengths and lags are in working days.
import {
  addDays, addWorkingDays, FALLBACK_CALENDAR, snapToWorkingDay, WorkCalendar, workingDaysBetween, workingDayShift,
} from '../planning/calendar';

export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type LinkType = typeof LINK_TYPES[number];

export type SchedTask = { id: string; status: string; start_date: string | null; due_date: string | null; is_milestone?: boolean };
export type SchedLink = { predecessor_id: string; successor_id: string; link_type: LinkType; lag_days: number };
export type DateChange = { id: string; start_date: string | null; due_date: string | null };

/** The days a task covers; a task with one date covers that day. */
const span = (t: SchedTask) => {
  const start = t.start_date ?? t.due_date, due = t.is_milestone ? start : t.due_date ?? t.start_date;
  return start && due ? { start, due } : null;
};

/** Working days a task lasts (at least 1). */
export const lengthOf = (t: SchedTask, cal: WorkCalendar) => {
  const s = span(t);
  return s ? Math.max(1, workingDaysBetween(cal, s.start, s.due)) : 1;
};

/**
 * What a link asks of its successor: the earliest allowed start or due date.
 * FS: start on the first working day after the predecessor is due. SS: start no earlier than it starts.
 * FF: be due no earlier than it is due. SF: be due no earlier than the working day before it starts.
 * The lag then moves that date by working days. Null when the predecessor lacks the date the rule needs.
 */
export function requirement(link: Pick<SchedLink, 'link_type' | 'lag_days'>, pred: SchedTask, cal: WorkCalendar = FALLBACK_CALENDAR):
  { field: 'start_date' | 'due_date'; date: string } | null {
  const s = span(pred);
  if (!s) return null;
  const lag = link.lag_days;
  switch (link.link_type) {
    case 'FS': return { field: 'start_date', date: addWorkingDays(cal, snapToWorkingDay(cal, addDays(s.due, 1), 1), lag) };
    case 'SS': return { field: 'start_date', date: addWorkingDays(cal, snapToWorkingDay(cal, s.start, 1), lag) };
    case 'FF': return { field: 'due_date', date: addWorkingDays(cal, snapToWorkingDay(cal, s.due, -1), lag) };
    case 'SF': return { field: 'due_date', date: addWorkingDays(cal, snapToWorkingDay(cal, addDays(s.start, -1), -1), lag) };
  }
}

/** Working days the successor is too early by (0 when the link is respected or cannot be checked). */
export function shortfallDays(link: Pick<SchedLink, 'link_type' | 'lag_days'>, pred: SchedTask, succ: SchedTask, cal: WorkCalendar = FALLBACK_CALENDAR): number {
  const need = requirement(link, pred, cal);
  const s = span(succ);
  if (!need || !s) return 0;
  const have = need.field === 'start_date' ? s.start : s.due;
  return have < need.date ? Math.max(1, workingDayShift(cal, have, need.date)) : 0;
}

/** Topological order of `ids` along `links` (ids in a loop are left out). */
function topoOrder(ids: string[], links: SchedLink[]): string[] {
  const set = new Set(ids);
  const indegree = new Map(ids.map(id => [id, 0]));
  const out = new Map<string, string[]>();
  for (const l of links) {
    if (!set.has(l.predecessor_id) || !set.has(l.successor_id)) continue;
    out.set(l.predecessor_id, [...(out.get(l.predecessor_id) ?? []), l.successor_id]);
    indegree.set(l.successor_id, indegree.get(l.successor_id)! + 1);
  }
  const queue = ids.filter(id => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const left = indegree.get(next)! - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  return order;
}

/**
 * Moves successors later (never earlier) until every link is respected, keeping each task's
 * length in working days. Only tasks in `movable` move; finished tasks never move. Walks the links
 * in dependency order, so a pushed task pushes the tasks that wait for it. Returns the changed tasks.
 */
export function pushSchedule(tasks: SchedTask[], links: SchedLink[], movable: Set<string>, cal: WorkCalendar = FALLBACK_CALENDAR): DateChange[] {
  const byId = new Map(tasks.map(t => [t.id, { ...t }]));
  const incoming = new Map<string, SchedLink[]>();
  for (const l of links) {
    if (byId.has(l.predecessor_id) && byId.has(l.successor_id)) incoming.set(l.successor_id, [...(incoming.get(l.successor_id) ?? []), l]);
  }
  const changed = new Set<string>();
  for (const id of topoOrder(tasks.map(t => t.id), links)) {
    const task = byId.get(id)!;
    if (!movable.has(id) || task.status === 'done' || !span(task)) continue;
    const len = lengthOf(task, cal);
    let { start, due } = span(task)!;
    for (const l of incoming.get(id) ?? []) {
      const need = requirement(l, byId.get(l.predecessor_id)!, cal);
      if (!need) continue;
      if (need.field === 'start_date' && start < need.date) { start = need.date; due = addWorkingDays(cal, start, len - 1); }
      if (need.field === 'due_date' && due < need.date) { due = need.date; start = addWorkingDays(cal, due, -(len - 1)); }
    }
    const before = span(task)!;
    if (start !== before.start || due !== before.due) {
      // Keep the shape of the task: a one-date task keeps one date; a milestone keeps start = due.
      if (task.is_milestone) { task.start_date = start; task.due_date = start; }
      else { task.start_date = task.start_date ? start : null; task.due_date = task.due_date ? due : null; }
      changed.add(id);
    }
  }
  return [...changed].map(id => { const t = byId.get(id)!; return { id, start_date: t.start_date, due_date: t.due_date }; });
}

export type FloatInfo = { float_days: number; critical: boolean };

/**
 * Total float per dated task: how many working days it can slip before the plan's last task
 * finishes later (following the links between these tasks). Critical = no float and not finished.
 */
export function computeFloat(tasks: SchedTask[], links: SchedLink[], cal: WorkCalendar = FALLBACK_CALENDAR): Map<string, FloatInfo> {
  const dated = tasks.filter(t => span(t));
  const byId = new Map(dated.map(t => [t.id, t]));
  const result = new Map<string, FloatInfo>();
  if (!dated.length) return result;
  const finish = dated.map(t => span(t)!.due).sort().at(-1)!;
  const outgoing = new Map<string, SchedLink[]>();
  for (const l of links) {
    if (byId.has(l.predecessor_id) && byId.has(l.successor_id)) outgoing.set(l.predecessor_id, [...(outgoing.get(l.predecessor_id) ?? []), l]);
  }
  const late = new Map<string, { ls: string; lf: string }>();
  for (const id of topoOrder(dated.map(t => t.id), links).reverse()) {
    const t = byId.get(id)!;
    const len = lengthOf(t, cal);
    let lf = finish;
    for (const l of outgoing.get(id) ?? []) {
      const s = late.get(l.successor_id);
      if (!s) continue;
      let limit: string;
      switch (l.link_type) {
        case 'FS': limit = addWorkingDays(cal, snapToWorkingDay(cal, addDays(s.ls, -1), -1), -l.lag_days); break;
        case 'SS': limit = addWorkingDays(cal, addWorkingDays(cal, s.ls, -l.lag_days), len - 1); break;
        case 'FF': limit = addWorkingDays(cal, s.lf, -l.lag_days); break;
        case 'SF': limit = addWorkingDays(cal, addWorkingDays(cal, snapToWorkingDay(cal, addDays(s.lf, 1), 1), -l.lag_days), len - 1); break;
      }
      if (limit < lf) lf = limit;
    }
    late.set(id, { lf, ls: addWorkingDays(cal, lf, -(len - 1)) });
    const float = workingDayShift(cal, span(t)!.due, lf);
    result.set(id, { float_days: float, critical: float <= 0 && t.status !== 'done' });
  }
  return result;
}
