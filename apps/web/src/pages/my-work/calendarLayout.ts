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

/** A regular commitment on a given day: its hours on its weekdays (share-of-time ones are spread, so shown apart). */
export function commitmentOn(c: Pick<Commitment, 'weekdays' | 'hours_per_day' | 'capacity_pct' | 'start_date' | 'end_date'>, day: string): number {
  if (day < c.start_date || (c.end_date && day > c.end_date) || c.capacity_pct) return 0;
  return c.weekdays?.includes(weekdayOf(day)) && c.hours_per_day ? Number(c.hours_per_day) : 0;
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

/** Hours of busy, timed meetings on a local day (the part inside that day). All-day events do not count. */
export function meetingHours(events: CalendarEvent[], day: string): number {
  const dayStart = new Date(`${day}T00:00:00`).getTime(), dayEnd = new Date(`${addDays(day, 1)}T00:00:00`).getTime();
  const ms = events.filter(e => e.busy && !e.all_day).reduce((sum, e) => {
    const s = Math.max(dayStart, new Date(e.start).getTime()), en = Math.min(dayEnd, new Date(e.end).getTime());
    return sum + Math.max(0, en - s);
  }, 0);
  return Math.round(ms / 360_000) / 10;
}

export const isLocalToday = (day: string) => day === localDay(new Date());

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
