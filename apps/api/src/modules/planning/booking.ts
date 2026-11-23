// How a person's own tasks and standing commitments take up their working hours, day by day.
// Pure functions on a working calendar; the workload adds these to the hours booked by plan tasks.
import { hoursOn, WorkCalendar, workingDaysBetween } from './calendar';

export type BookablePersonalTask = { start_date: string | null; due_date: string | null; planned_hours: number | null; all_day?: boolean };
export type BookableCommitment = {
  start_date: string; end_date: string | null;
  weekdays: number[] | null; hours_per_day: number | null; capacity_pct: number | null; all_day?: boolean;
};

/** Monday = 0 ... Sunday = 6. */
export const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

/**
 * Planned hours spread evenly over the working days from start to due (a task with only one
 * date sits on that day). Tasks without planned hours or dates book nothing. An all-day task takes
 * `dayCapacity` (what the person can work that day) on each working day it covers.
 */
export function personalTaskHours(cal: WorkCalendar, task: BookablePersonalTask, day: string, dayCapacity = 0): number {
  if (!task.planned_hours && !task.all_day) return 0;
  const start = task.start_date ?? task.due_date;
  const due = task.due_date ?? task.start_date;
  if (!start || !due || day < start || day > due || hoursOn(cal, day) <= 0) return 0;
  if (task.all_day) return Math.max(0, dayCapacity);
  const days = workingDaysBetween(cal, start, due);
  return days > 0 ? Number(task.planned_hours) / days : 0;
}

/**
 * Hours a commitment takes on a day: its hours on the chosen weekdays, or its share of the day's
 * capacity. Never more than the person can work that day; nothing on days off and holidays.
 * `dayCapacity` is the person's hours that day (calendar × capacity %).
 */
export function commitmentHours(c: BookableCommitment, day: string, dayCapacity: number): number {
  if (dayCapacity <= 0 || day < c.start_date || (c.end_date && day > c.end_date)) return 0;
  if (c.capacity_pct) return dayCapacity * (c.capacity_pct / 100);
  if (c.all_day) return c.weekdays?.includes(weekdayOf(day)) ? dayCapacity : 0;
  if (c.weekdays?.includes(weekdayOf(day)) && c.hours_per_day) return Math.min(Number(c.hours_per_day), dayCapacity);
  return 0;
}
