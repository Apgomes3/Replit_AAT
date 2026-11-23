// Pure helpers for the My Work Week and Month views: which days a task covers, what a commitment
// takes on a day, meeting hours from Google events, and moving a task by whole days.
import { addDays } from '../drafting/taskTiming';
import type { Commitment, WorkItem } from './myWorkApi';

export type CalendarEvent = { id: string; title: string; start: string; end: string; all_day: boolean; location: string | null; link: string | null; busy: boolean };

export const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** First and last day a task covers (one date alone means that day), or null when it has no date. */
export function taskRange(item: Pick<WorkItem, 'start_date' | 'due_date'>): [string, string] | null {
  const start = item.start_date ?? item.due_date;
  const due = item.due_date ?? item.start_date;
  return start && due ? [start, due] : null;
}

/**
 * Where a task sits in a week: columns 0–6 it covers, and whether it carries on before or after
 * the week. Null when it is not in this week.
 */
export function weekSpan(item: Pick<WorkItem, 'start_date' | 'due_date'>, monday: string) {
  const range = taskRange(item);
  if (!range) return null;
  const sunday = addDays(monday, 6);
  if (range[1] < monday || range[0] > sunday) return null;
  return {
    first: Math.max(0, daysBetween(monday, range[0])),
    last: Math.min(6, daysBetween(monday, range[1])),
    before: range[0] < monday,
    after: range[1] > sunday,
  };
}

/** New dates for a task moved by `days`, keeping its length; a task with one date keeps one date. */
export function shiftDates(item: Pick<WorkItem, 'start_date' | 'due_date'>, days: number): { start_date: string | null; due_date: string | null } {
  return {
    start_date: item.start_date ? addDays(item.start_date, days) : null,
    due_date: item.due_date ? addDays(item.due_date, days) : null,
  };
}

/** True when a weekday commitment (timed or all day) falls on the day. Share-of-time ones never do. */
export function commitmentFalls(c: Pick<Commitment, 'weekdays' | 'capacity_pct' | 'start_date' | 'end_date'>, day: string): boolean {
  if (day < c.start_date || (c.end_date && day > c.end_date) || c.capacity_pct) return false;
  return !!c.weekdays?.includes(weekdayOf(day));
}

/**
 * A regular commitment on a given day: its hours on its weekdays, or for an all-day one the hours
 * you can work that day (`dayHours`). Share-of-time ones are spread, so shown apart.
 */
export function commitmentOn(c: Pick<Commitment, 'weekdays' | 'hours_per_day' | 'capacity_pct' | 'start_date' | 'end_date' | 'all_day'>, day: string, dayHours = 0): number {
  if (!commitmentFalls(c, day)) return 0;
  if (c.all_day) return dayHours;
  return c.hours_per_day ? Number(c.hours_per_day) : 0;
}

/** Local calendar day (YYYY-MM-DD) of a Date. */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Events on a local day: all-day ones covering it and timed ones that overlap it, in start order. */
export function eventsOn(events: CalendarEvent[], day: string): CalendarEvent[] {
  return events.filter(e => {
    if (e.all_day) return e.start <= day && day < e.end; // Google's all-day end date is exclusive
    const s = new Date(e.start), en = new Date(e.end);
    const dayStart = new Date(`${day}T00:00:00`), dayEnd = new Date(`${addDays(day, 1)}T00:00:00`);
    return s < dayEnd && en > dayStart;
  }).sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
}

type DayCommitment = Pick<Commitment, 'id' | 'title' | 'weekdays' | 'hours_per_day' | 'capacity_pct' | 'start_date' | 'end_date' | 'all_day'>;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameName = (a: string, b: string) => {
  const [x, y] = [norm(a), norm(b)].sort((p, q) => p.length - q.length);
  return !!x && (x === y || (x.length >= 6 && y.includes(x)));
};

/**
 * Google events on a day that are a regular commitment already counted in booked hours: a timed
 * event whose name matches a commitment falling on that day (e.g. "Standup" and "Daily standup").
 * Each commitment matches at most one event a day. Returns event id → commitment id.
 */
export function regularMeetings(events: CalendarEvent[], commitments: DayCommitment[], day: string): Map<string, string> {
  // All-day commitments are not meetings, so they never match a Google event.
  const due = commitments.filter(c => !c.all_day && commitmentOn(c, day) > 0);
  const matched = new Map<string, string>();
  for (const e of eventsOn(events, day)) {
    if (e.all_day) continue;
    const c = due.find(x => ![...matched.values()].includes(x.id) && sameName(x.title, e.title));
    if (c) matched.set(e.id, c.id);
  }
  return matched;
}

/**
 * Hours of busy, timed meetings on a local day (the part inside that day). All-day events do not
 * count, nor do events that are a regular commitment (those are already in booked hours).
 */
export function meetingHours(events: CalendarEvent[], day: string, commitments: DayCommitment[] = []): number {
  const dayStart = new Date(`${day}T00:00:00`).getTime(), dayEnd = new Date(`${addDays(day, 1)}T00:00:00`).getTime();
  const regular = regularMeetings(events, commitments, day);
  const ms = events.filter(e => e.busy && !e.all_day && !regular.has(e.id)).reduce((sum, e) => {
    const s = Math.max(dayStart, new Date(e.start).getTime()), en = Math.min(dayEnd, new Date(e.end).getTime());
    return sum + Math.max(0, en - s);
  }, 0);
  return Math.round(ms / 360_000) / 10;
}

export const isLocalToday = (day: string) => day === localDay(new Date());

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export type AgendaEntry =
  | { kind: 'event'; key: string; time: string | null; allDay: boolean; event: CalendarEvent; regular?: DayCommitment }
  | { kind: 'commitment'; key: string; time: string | null; allDay: boolean; commitment: DayCommitment & Pick<Commitment, 'start_time'>; hours: number }
  | { kind: 'task'; key: string; time: string | null; allDay: boolean; item: WorkItem };

/**
 * One day's list in time order: all-day items first (Google all-day events, all-day commitments and
 * all-day own tasks on every day they cover), then timed Google events, commitments with a start
 * time and own tasks with a start time (on their first day), then commitments without a time.
 * A Google meeting that is also a regular commitment shows once, as the meeting. `dayHours` is what
 * you can work that day, which an all-day commitment takes.
 */
export function dayAgenda(
  events: CalendarEvent[], commitments: Array<DayCommitment & Pick<Commitment, 'start_time'>>, items: WorkItem[], day: string, dayHours = 0,
): AgendaEntry[] {
  const matched = regularMeetings(events, commitments, day);
  const dayStart = new Date(`${day}T00:00:00`);
  const entries: AgendaEntry[] = eventsOn(events, day).map(e => ({
    kind: 'event', key: `e:${e.id}`, event: e, allDay: e.all_day,
    time: e.all_day ? null : hhmm(new Date(Math.max(dayStart.getTime(), new Date(e.start).getTime()))),
    regular: matched.has(e.id) ? commitments.find(c => c.id === matched.get(e.id)) : undefined,
  }));
  const used = new Set(matched.values());
  for (const c of commitments) {
    if (!commitmentFalls(c, day) || used.has(c.id)) continue;
    entries.push({ kind: 'commitment', key: `c:${c.id}`, time: c.all_day ? null : c.start_time ?? null, allDay: !!c.all_day, commitment: c, hours: commitmentOn(c, day, dayHours) });
  }
  for (const i of items) {
    if (i.kind !== 'task' || i.status === 'done') continue;
    const range = taskRange(i);
    if (!range) continue;
    if (i.all_day && range[0] <= day && day <= range[1]) entries.push({ kind: 'task', key: `t:${i.id}`, time: null, allDay: true, item: i });
    else if (!i.all_day && i.start_time && range[0] === day) entries.push({ kind: 'task', key: `t:${i.id}`, time: i.start_time, allDay: false, item: i });
  }
  // All-day first, then by time; untimed commitments last.
  const rank = (e: AgendaEntry) => e.allDay ? 0 : e.time ? 1 : 2;
  return entries.sort((a, b) => rank(a) - rank(b) || (a.time ?? '').localeCompare(b.time ?? ''));
}

// ---------- hour by hour ----------

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** A timed entry placed on the hour grid: minutes from midnight, and its column among overlaps. */
export type HourBlock = { entry: AgendaEntry; start: number; end: number; col: number; cols: number };

/**
 * Where a day's timed entries sit on the hour grid. A Google event runs from its start to its end
 * (the part inside the day); a commitment for its hours; an own task for its effort when it is a
 * one-day task, else one hour. Overlapping blocks share the width side by side.
 */
export function hourBlocks(entries: AgendaEntry[], day: string): HourBlock[] {
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const blocks = entries.filter(e => e.time && !e.allDay).map(e => {
    const start = minutesOf(e.time!);
    let end = start + 60;
    if (e.kind === 'event') end = Math.round((Math.min(new Date(e.event.end).getTime(), dayStart + 86_400_000) - dayStart) / 60_000);
    else if (e.kind === 'commitment') end = start + Math.round(e.hours * 60);
    else {
      const r = taskRange(e.item);
      if (r && r[0] === r[1] && e.item.planned_hours) end = start + Math.round(Number(e.item.planned_hours) * 60);
    }
    return { entry: e, start, end: Math.min(24 * 60, Math.max(end, start + 15)), col: 0, cols: 1 };
  }).sort((a, b) => a.start - b.start || b.end - a.end);

  // Group blocks that overlap (directly or through each other), then give each the first free column.
  let group: HourBlock[] = [];
  let groupEnd = -1;
  const close = () => { const cols = Math.max(1, ...group.map(b => b.col + 1)); group.forEach(b => { b.cols = cols; }); group = []; };
  for (const b of blocks) {
    if (b.start >= groupEnd) { close(); groupEnd = -1; }
    const taken = new Set(group.filter(o => o.end > b.start).map(o => o.col));
    while (taken.has(b.col)) b.col++;
    group.push(b);
    groupEnd = Math.max(groupEnd, b.end);
  }
  close();
  return blocks;
}

/** Hours the grid shows: 07:00–19:00, widened to whole hours to fit every block. */
export function hourSpan(blocks: Array<Pick<HourBlock, 'start' | 'end'>>, from = 7, to = 19): [number, number] {
  const first = Math.min(from, ...blocks.map(b => Math.floor(b.start / 60)));
  const last = Math.max(to, ...blocks.map(b => Math.ceil(b.end / 60)));
  return [first, Math.min(24, last)];
}

/** The Monday-first 6-week grid that shows a month. */
export function monthGrid(anyDayInMonth: string): { month: string; days: string[] } {
  const month = anyDayInMonth.slice(0, 7);
  const first = mondayOf(`${month}-01`);
  return { month, days: Array.from({ length: 42 }, (_, i) => addDays(first, i)) };
}

/** Stacks spans into rows so bars in the same row never overlap (first fit). */
export function stackRows<T extends { first: number; last: number }>(spans: T[]): T[][] {
  const rows: T[][] = [];
  for (const s of [...spans].sort((a, b) => a.first - b.first || b.last - a.last)) {
    const row = rows.find(r => r.every(o => s.first > o.last || s.last < o.first));
    if (row) row.push(s); else rows.push([s]);
  }
  return rows;
}
