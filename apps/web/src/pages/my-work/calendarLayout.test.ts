import { describe, expect, it } from 'vitest';
import { commitmentOn, dayAgenda, hourBlocks, hourSpan, eventsOn, meetingHours, monthGrid, regularMeetings, shiftDates, stackRows, weekSpan } from './calendarLayout';

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

  it('does not count a Google meeting twice when it is also a regular commitment', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m).toISOString();
    const ev = (id: string, title: string, s: number, e: number) => ({ id, title, start: at(s), end: at(e), all_day: false, location: null, link: null, busy: true });
    const events = [ev('a', 'Daily Standup', 9, 10), ev('b', 'QA sign-off', 14, 15), ev('c', 'Daily standup', 16, 17)];
    const base = { weekdays: [0], hours_per_day: 1, capacity_pct: null, start_date: '2026-11-01', end_date: null };
    const commitments = [{ ...base, id: 's', title: 'Standup' }, { ...base, id: 'q', title: 'QA' }];
    // "Standup" matches the first standup only; "QA" is too short a name to claim "QA sign-off".
    expect([...regularMeetings(events, commitments, MON)]).toEqual([['a', 's']]);
    expect(meetingHours(events, MON, commitments)).toBe(2);
    // On a day the commitment does not fall on, the meeting counts.
    expect(regularMeetings(events, commitments, '2026-11-17').size).toBe(0);
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

describe('day agenda', () => {
  const base = { start_date: '2026-01-01', end_date: null, capacity_pct: null, hours_per_day: 1 };
  const task = (id: string, start_time: string | null, due_date = '2026-11-16') => ({
    key: `task:${id}`, kind: 'task' as const, id, title: id, status: 'not_started' as const, progress_pct: 0, start_date: null, due_date,
    is_milestone: false, project: null, initiative: null, enquiry: null, design_book: null, plan: null, planned_hours: null, notes: null, start_time,
  });
  const ev = (id: string, title: string, start: string, end: string, all_day = false) => ({ id, title, start, end, all_day, location: null, link: null, busy: true });

  it('lists all-day events, then timed meetings, commitments and tasks by time, then untimed commitments', () => {
    const list = dayAgenda(
      [ev('g1', 'Client call', '2026-11-16T14:00:00', '2026-11-16T15:00:00'), ev('g2', 'Holiday', '2026-11-16', '2026-11-17', true)],
      [
        { ...base, id: 'c1', title: 'Team meeting', weekdays: [0], start_time: '09:00' },
        { ...base, id: 'c2', title: 'Admin', weekdays: [0], start_time: null },
        { ...base, id: 'c3', title: 'Tuesday only', weekdays: [1], start_time: '08:00' },
      ],
      [task('Report', '11:30'), task('Untimed', null), task('Tomorrow', '08:00', '2026-11-17')],
      MON,
    );
    expect(list.map(e => [e.kind, e.time])).toEqual([
      ['event', null], ['commitment', '09:00'], ['task', '11:30'], ['event', '14:00'], ['commitment', null],
    ]);
  });

  it('shows a Google meeting that is also a regular commitment once, as the meeting', () => {
    const list = dayAgenda([ev('g1', 'Weekly team meeting', '2026-11-16T09:00:00', '2026-11-16T10:00:00')],
      [{ ...base, id: 'c1', title: 'Team meeting', weekdays: [0], start_time: '09:00' }], [], MON);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'event', regular: { id: 'c1' } });
  });

  it('puts all-day commitments and tasks at the top, on every day a task covers, with the day\'s hours', () => {
    const visit = { ...task('Site visit', null, '2026-11-18'), start_date: MON, all_day: true };
    const list = dayAgenda([ev('g1', 'Client call', '2026-11-17T08:00:00', '2026-11-17T09:00:00')],
      [{ ...base, id: 'c1', title: 'Factory', weekdays: [1], hours_per_day: null, all_day: true, start_time: null }],
      [visit, task('Report', '07:30', '2026-11-17')], '2026-11-17', 9);
    expect(list.map(e => [e.kind, e.allDay, e.time])).toEqual([
      ['commitment', true, null], ['task', true, null], ['task', false, '07:30'], ['event', false, '08:00'],
    ]);
    expect(list[0]).toMatchObject({ hours: 9 });
    expect(dayAgenda([], [], [visit], '2026-11-19').length).toBe(0);
  });
});

describe('hour grid', () => {
  const base = { start_date: '2026-01-01', end_date: null, capacity_pct: null, hours_per_day: 1 };
  const ev = (id: string, start: string, end: string) => ({ id, title: id, start, end, all_day: false, location: null, link: null, busy: true });
  const task = (id: string, start_time: string, planned_hours: number | null, start_date: string | null = null) => ({
    key: `task:${id}`, kind: 'task' as const, id, title: id, status: 'not_started' as const, progress_pct: 0, start_date, due_date: MON,
    is_milestone: false, project: null, initiative: null, enquiry: null, design_book: null, plan: null, planned_hours, notes: null, start_time,
  });

  it('places blocks by time and length, side by side when they overlap', () => {
    const entries = dayAgenda(
      [ev('call', '2026-11-16T09:30:00', '2026-11-16T10:30:00')],
      [{ ...base, id: 'c1', title: 'Team meeting', weekdays: [0], hours_per_day: 1.5, start_time: '09:00' }],
      [task('Report', '14:00', 2), { ...task('Long job', '16:00', 20, MON), due_date: '2026-11-20' }], MON,
    );
    const blocks = hourBlocks(entries, MON).map(b => [b.entry.key, b.start, b.end, b.col, b.cols]);
    expect(blocks).toEqual([
      ['c:c1', 540, 630, 0, 2], ['e:call', 570, 630, 1, 2],
      ['t:Report', 840, 960, 0, 1], ['t:Long job', 960, 1020, 0, 1], // a multi-day task shows one hour
    ]);
  });

  it('shows 07:00 to 19:00, wider when something falls outside', () => {
    expect(hourSpan([])).toEqual([7, 19]);
    expect(hourSpan([{ start: 6 * 60 + 30, end: 7 * 60 }, { start: 19 * 60, end: 20 * 60 + 15 }])).toEqual([6, 21]);
  });
});
