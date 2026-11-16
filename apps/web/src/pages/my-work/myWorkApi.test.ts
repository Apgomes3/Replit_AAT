import { describe, expect, it } from 'vitest';
import { bucketOf, describeCommitment, groupWork, toWorkItems } from './myWorkApi';

// Thursday 12 Nov 2026: this week runs to Sun 15 Nov, next week to Sun 22 Nov.
const TODAY = '2026-11-12';
const b = (status: 'not_started' | 'done', start: string | null, due: string | null) => bucketOf({ status, start_date: start, due_date: due }, TODAY);

describe('My Work planner grouping', () => {
  it('puts each task in the right bucket', () => {
    expect(b('not_started', null, '2026-11-10')).toBe('overdue');
    expect(b('not_started', '2026-11-01', '2026-11-30')).toBe('this_week'); // running now
    expect(b('not_started', null, '2026-11-15')).toBe('this_week');
    expect(b('not_started', '2026-11-16', '2026-11-25')).toBe('next_week');
    expect(b('not_started', '2026-11-23', null)).toBe('later');
    expect(b('not_started', null, null)).toBe('no_date');
    expect(b('done', null, '2026-11-01')).toBe('done');
  });

  it('merges plan tasks and own tasks, ordered by date within a bucket', () => {
    const items = toWorkItems({
      plan_tasks: [{ id: 'p1', title: 'Drawing', status: 'in_progress', progress_pct: 50, is_milestone: false, allocation_pct: 100,
        start_date: null, due_date: '2026-11-14', plan: { id: 'pl', code: 'DP-1', name: 'Plan' }, project: null }],
      tasks: [{ id: 't1', title: 'Call client', notes: null, status: 'not_started', progress_pct: 0, start_date: null,
        due_date: '2026-11-13', planned_hours: 1, project: null }],
    });
    const groups = groupWork(items, TODAY);
    expect(groups.map(g => [g.id, g.items.map(i => i.key)])).toEqual([['this_week', ['task:t1', 'plan:p1']]]);
  });

  it('describes commitments', () => {
    expect(describeCommitment({ weekdays: [0, 2], hours_per_day: 1, capacity_pct: null })).toBe('Mon, Wed · 1 h');
    expect(describeCommitment({ weekdays: null, hours_per_day: null, capacity_pct: 40 })).toBe('40% of time');
  });
});
