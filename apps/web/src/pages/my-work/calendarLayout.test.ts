import { describe, expect, it } from 'vitest';
import { commitmentOn, eventsOn, meetingHours, monthGrid, shiftDates, stackRows, weekSpan } from './calendarLayout';

const MON = '2026-11-16';

describe('week layout', () => {
  it('places a task in the columns it covers and marks when it runs on', () => {
    expect(weekSpan({ start_date: '2026-11-17', due_date: '2026-11-19' }, MON)).toEqual({ first: 1, last: 3, before: false, after: false });
    expect(weekSpan({ start_date: '2026-11-10', due_date: '2026-11-25' }, MON)).toEqual({ first: 0, last: 6, before: true, after: true });
    expect(weekSpan({ start_date: null, due_date: '2026-11-20' }, MON)).toEqual({ first: 4, last: 4, before: false, after: false });
    expect(weekSpan({ start_date: null, due_date: '2026-11-30' }, MON)).toBeNull();
    expect(weekSpan({ start_date: null, due_date: null }, MON)).toBeNull();
  });

  it('moves a task by whole days and keeps a single date single', () => {
    expect(shiftDates({ start_date: '2026-11-17', due_date: '2026-11-19' }, 2)).toEqual({ start_date: '2026-11-19', due_date: '2026-11-21' });
    expect(shiftDates({ start_date: null, due_date: '2026-11-30' }, -1)).toEqual({ start_date: null, due_date: '2026-11-29' });
  });

  it('stacks overlapping bars into separate rows', () => {
    const rows = stackRows([{ first: 0, last: 2 }, { first: 1, last: 1 }, { first: 3, last: 6 }]);
    expect(rows).toEqual([[{ first: 0, last: 2 }, { first: 3, last: 6 }], [{ first: 1, last: 1 }]]);
  });
});

describe('commitments and meetings', () => {
  it('counts a weekday commitment on its days only, inside its dates', () => {
    const standup = { weekdays: [0, 2], hours_per_day: 0.5, capacity_pct: null, start_date: '2026-11-01', end_date: null };
    expect(commitmentOn(standup, MON)).toBe(0.5);
    expect(commitmentOn(standup, '2026-11-17')).toBe(0);
    expect(commitmentOn({ ...standup, end_date: '2026-11-15' }, MON)).toBe(0);
    expect(commitmentOn({ ...standup, weekdays: null, hours_per_day: null, capacity_pct: 20 }, MON)).toBe(0);
  });

  it('adds up busy timed meetings for a day and lists all-day events on every day they cover', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m).toISOString();
    const events = [
      { id: 'a', title: 'Standup', start: at(9), end: at(9, 30), all_day: false, location: null, link: null, busy: true },
      { id: 'b', title: 'Review', start: at(14), end: at(15, 30), all_day: false, location: null, link: null, busy: true },
      { id: 'c', title: 'Lunch?', start: at(12), end: at(13), all_day: false, location: null, link: null, busy: false },
      { id: 'd', title: 'Trade show', start: '2026-11-16', end: '2026-11-18', all_day: true, location: null, link: null, busy: true },
    ];
    expect(meetingHours(events, MON)).toBe(2);
    expect(eventsOn(events, MON).map(e => e.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(eventsOn(events, '2026-11-17').map(e => e.id)).toEqual(['d']);
    expect(eventsOn(events, '2026-11-18')).toEqual([]);
  });
});

describe('month grid', () => {
  it('starts on the Monday on or before the 1st and shows six weeks', () => {
    const g = monthGrid('2026-11-17');
    expect(g.month).toBe('2026-11');
    expect(g.days[0]).toBe('2026-10-26');
    expect(g.days).toHaveLength(42);
  });
});
