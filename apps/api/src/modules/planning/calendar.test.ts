// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addWorkingDays, hoursOn, snapToWorkingDay, WorkCalendar, workingDaysBetween, workingDayShift } from './calendar';

// Mon-Fri 9 h, Sat 8 h, Sun off; Labour Day 1-5 May 2026 off; Sunday 20 Sep 2026 is a make-up working day.
const china: WorkCalendar = {
  week_hours: [9, 9, 9, 9, 9, 8, 0],
  days: { '2026-05-01': 0, '2026-05-02': 0, '2026-05-03': 0, '2026-05-04': 0, '2026-05-05': 0, '2026-09-20': 9 },
};

describe('working calendar', () => {
  it('reads hours from the week and from exceptions', () => {
    expect(hoursOn(china, '2026-11-13')).toBe(9); // Friday
    expect(hoursOn(china, '2026-11-14')).toBe(8); // Saturday
    expect(hoursOn(china, '2026-11-15')).toBe(0); // Sunday
    expect(hoursOn(china, '2026-05-04')).toBe(0); // holiday on a Monday
    expect(hoursOn(china, '2026-09-20')).toBe(9); // make-up Sunday
  });

  it('snaps to working days forwards and backwards', () => {
    expect(snapToWorkingDay(china, '2026-11-15')).toBe('2026-11-16');
    expect(snapToWorkingDay(china, '2026-11-15', -1)).toBe('2026-11-14');
    expect(snapToWorkingDay(china, '2026-05-01')).toBe('2026-05-06');
  });

  it('adds working days, skipping Sundays and holidays', () => {
    expect(addWorkingDays(china, '2026-11-13', 1)).toBe('2026-11-14');  // Fri → Sat
    expect(addWorkingDays(china, '2026-11-14', 1)).toBe('2026-11-16');  // Sat → Mon
    expect(addWorkingDays(china, '2026-04-30', 1)).toBe('2026-05-06');  // over Labour Day
    expect(addWorkingDays(china, '2026-05-06', -1)).toBe('2026-04-30');
    expect(addWorkingDays(china, '2026-09-19', 1)).toBe('2026-09-20');  // make-up Sunday counts
  });

  it('counts working days in a span and the signed shift between dates', () => {
    expect(workingDaysBetween(china, '2026-11-09', '2026-11-15')).toBe(6); // Mon..Sun = 6 working days
    expect(workingDaysBetween(china, '2026-05-01', '2026-05-05')).toBe(0);
    expect(workingDayShift(china, '2026-11-13', '2026-11-16')).toBe(2);
    expect(workingDayShift(china, '2026-11-16', '2026-11-13')).toBe(-2);
  });

  it('does not loop forever on a calendar without working days', () => {
    const none: WorkCalendar = { week_hours: [0, 0, 0, 0, 0, 0, 0], days: {} };
    expect(addWorkingDays(none, '2026-01-01', 3)).toBe('2026-01-04');
  });
});
