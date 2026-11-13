// Pure scheduling rules for task links (no database access).
// Dates are ISO 'YYYY-MM-DD' calendar days; a task occupies start..due inclusive.

export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type LinkType = typeof LINK_TYPES[number];

export type SchedTask = { id: string; status: string; start_date: string | null; due_date: string | null };
export type SchedLink = { predecessor_id: string; successor_id: string; link_type: LinkType; lag_days: number };
export type DateChange = { id: string; start_date: string | null; due_date: string | null };

const DAY_MS = 86_400_000;

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const t = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / DAY_MS; };
  return t(to) - t(from);
}

/**
 * What a link asks of its successor: the earliest allowed start or due date.
 * FS: start the day after the predecessor is due. SS: start no earlier than it starts.
 * FF: be due no earlier than it is due. SF: be due no earlier than the day before it starts.
 * Returns null when the predecessor lacks the date the rule needs.
 */
export function requirement(link: Pick<SchedLink, 'link_type' | 'lag_days'>, pred: SchedTask): { field: 'start_date' | 'due_date'; date: string } | null {
  const lag = link.lag_days;
  switch (link.link_type) {
    case 'FS': return pred.due_date ? { field: 'start_date', date: addDays(pred.due_date, 1 + lag) } : null;
    case 'SS': return pred.start_date ? { field: 'start_date', date: addDays(pred.start_date, lag) } : null;
    case 'FF': return pred.due_date ? { field: 'due_date', date: addDays(pred.due_date, lag) } : null;
    case 'SF': return pred.start_date ? { field: 'due_date', date: addDays(pred.start_date, lag - 1) } : null;
  }
}

/** Days the successor is too early by (0 when the link is respected or cannot be checked). */
export function shortfallDays(link: Pick<SchedLink, 'link_type' | 'lag_days'>, pred: SchedTask, succ: SchedTask): number {
  const need = requirement(link, pred);
  const have = need && succ[need.field];
  return need && have ? Math.max(0, daysBetween(have, need.date)) : 0;
}

/**
 * Moves successors later (never earlier) until every link is respected, keeping each task's length.
 * Only tasks in `movable` move; finished tasks never move. Walks the links in dependency order,
 * so a pushed task pushes the tasks that wait for it. Returns only the tasks whose dates changed.
 */
export function pushSchedule(tasks: SchedTask[], links: SchedLink[], movable: Set<string>): DateChange[] {
  const byId = new Map(tasks.map(t => [t.id, { ...t }]));
  const incoming = new Map<string, SchedLink[]>();
  const outgoing = new Map<string, SchedLink[]>();
  const indegree = new Map<string, number>(tasks.map(t => [t.id, 0]));
  for (const l of links) {
    if (!byId.has(l.predecessor_id) || !byId.has(l.successor_id)) continue;
    incoming.set(l.successor_id, [...(incoming.get(l.successor_id) ?? []), l]);
    outgoing.set(l.predecessor_id, [...(outgoing.get(l.predecessor_id) ?? []), l]);
    indegree.set(l.successor_id, indegree.get(l.successor_id)! + 1);
  }

  const queue = tasks.filter(t => indegree.get(t.id) === 0).map(t => t.id);
  const changed = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    const task = byId.get(id)!;
    if (movable.has(id) && task.status !== 'done') {
      const shift = Math.max(0, ...(incoming.get(id) ?? []).map(l => shortfallDays(l, byId.get(l.predecessor_id)!, task)));
      if (shift > 0) {
        task.start_date = task.start_date && addDays(task.start_date, shift);
        task.due_date = task.due_date && addDays(task.due_date, shift);
        changed.add(id);
      }
    }
    for (const l of outgoing.get(id) ?? []) {
      const left = indegree.get(l.successor_id)! - 1;
      indegree.set(l.successor_id, left);
      if (left === 0) queue.push(l.successor_id);
    }
  }
  return [...changed].map(id => { const t = byId.get(id)!; return { id, start_date: t.start_date, due_date: t.due_date }; });
}
