import { describe, expect, it } from 'vitest';
import { durationDays, isLate, timeElapsedPercent, todayIso } from './taskTiming';

describe('drafting task timing', () => {
  it('counts duration in calendar days including both ends, like Planner', () => {
    expect(durationDays('2026-02-24', '2026-02-27')).toBe(4);
    expect(durationDays('2026-04-13', '2026-04-13')).toBe(1);
    expect(durationDays('2026-02-28', '2026-03-01')).toBe(2);
    expect(durationDays(null, '2026-03-01')).toBeNull();
  });

  it('reports elapsed time across the start-to-due window', () => {
    expect(timeElapsedPercent('2026-03-01', '2026-03-10', '2026-02-20')).toBe(0);
    expect(timeElapsedPercent('2026-03-01', '2026-03-10', '2026-03-01')).toBe(0);
    expect(timeElapsedPercent('2026-03-01', '2026-03-10', '2026-03-06')).toBe(50);
    expect(timeElapsedPercent('2026-03-01', '2026-03-10', '2026-03-11')).toBe(100);
    expect(timeElapsedPercent('2026-03-01', null, '2026-03-05')).toBeNull();
  });

  it('flags late only for unfinished tasks past their due date', () => {
    expect(isLate({ status: 'in_progress', due_date: '2026-03-10' }, '2026-03-11')).toBe(true);
    expect(isLate({ status: 'in_progress', due_date: '2026-03-10' }, '2026-03-10')).toBe(false);
    expect(isLate({ status: 'done', due_date: '2026-03-10' }, '2026-04-01')).toBe(false);
    expect(isLate({ status: 'review', due_date: null }, '2026-04-01')).toBe(false);
  });

  it('formats today as a local calendar date', () => {
    expect(todayIso(new Date(2026, 10, 12, 23, 30))).toBe('2026-11-12');
  });
});
