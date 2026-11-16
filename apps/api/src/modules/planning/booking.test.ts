// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { commitmentHours, personalTaskHours, weekdayOf } from './booking';
import type { WorkCalendar } from './calendar';

// Mon-Fri 8 h, weekends off, Wed 18 Nov 2026 a holiday.
const cal: WorkCalendar = { week_hours: [8, 8, 8, 8, 8, 0, 0], days: { '2026-11-18': 0 } };

describe('booking own tasks and commitments', () => {
  it('spreads planned hours over the working days from start to due', () => {
    const t = { start_date: '2026-11-16', due_date: '2026-11-20', planned_hours: 12 }; // 4 working days (Wed is a holiday)
    expect(personalTaskHours(cal, t, '2026-11-16')).toBe(3);
    expect(personalTaskHours(cal, t, '2026-11-18')).toBe(0);
    expect(personalTaskHours(cal, t, '2026-11-21')).toBe(0);
    expect(personalTaskHours(cal, { ...t, start_date: null }, '2026-11-20')).toBe(12);
    expect(personalTaskHours(cal, { ...t, planned_hours: null }, '2026-11-16')).toBe(0);
  });

  it('books meetings on their weekdays and roles as a share of the day, never on days off', () => {
    expect(weekdayOf('2026-11-16')).toBe(0);
    const meeting = { start_date: '2026-11-01', end_date: null, weekdays: [0, 2], hours_per_day: 1.5, capacity_pct: null };
    expect(commitmentHours(meeting, '2026-11-16', 8)).toBe(1.5);
    expect(commitmentHours(meeting, '2026-11-17', 8)).toBe(0);
    expect(commitmentHours(meeting, '2026-11-18', 0)).toBe(0); // holiday
    expect(commitmentHours({ ...meeting, hours_per_day: 10 }, '2026-11-16', 8)).toBe(8);
    const role = { start_date: '2026-11-16', end_date: '2026-11-30', weekdays: null, hours_per_day: null, capacity_pct: 40 };
    expect(commitmentHours(role, '2026-11-16', 9)).toBeCloseTo(3.6);
    expect(commitmentHours(role, '2026-12-01', 9)).toBe(0);
    expect(commitmentHours(role, '2026-11-15', 9)).toBe(0);
  });
});
