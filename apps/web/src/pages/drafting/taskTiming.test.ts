import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, durationDays, isLate, linkShortfall, timeElapsedPercent, todayIso } from './taskTiming';
import { buildSections, sortTasks } from './planViews';
import type { Task } from './draftingApi';

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

  it('checks task links with the same rules as the API', () => {
    const pred = { start_date: '2026-03-02', due_date: '2026-03-06' };
    expect(linkShortfall({ link_type: 'FS', lag_days: 0 }, pred, { start_date: '2026-03-05', due_date: '2026-03-09' })).toBe(2);
    expect(linkShortfall({ link_type: 'FS', lag_days: 0 }, pred, { start_date: '2026-03-07', due_date: '2026-03-09' })).toBe(0);
    expect(linkShortfall({ link_type: 'SS', lag_days: 1 }, pred, { start_date: '2026-03-02', due_date: '2026-03-03' })).toBe(1);
    expect(linkShortfall({ link_type: 'FF', lag_days: 0 }, pred, { start_date: '2026-03-01', due_date: '2026-03-04' })).toBe(2);
    expect(linkShortfall({ link_type: 'FS', lag_days: 0 }, pred, { start_date: null, due_date: null })).toBe(0);
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(daysBetween('2026-03-01', '2026-02-27')).toBe(-2);
  });
});

describe('plan view sections', () => {
  const t = (id: string, o: Partial<Task> = {}): Task => ({
    id, plan_id: 'p', group_id: null, title: id, status: 'not_started', priority: 'medium', start_date: null, due_date: null,
    notes: null, sort_order: 0, completed_at: null, assignees: [], ...o,
  });
  const ann = { id: 'u1', name: 'Ann', email: 'a@x' };
  const bob = { id: 'u2', name: 'Bob', email: 'b@x' };

  it('sorts by date with undated tasks last in both directions', () => {
    const tasks = [t('a', { due_date: '2026-03-05' }), t('b'), t('c', { due_date: '2026-03-01' })];
    expect(sortTasks(tasks, { key: 'due', desc: false }).map(x => x.id)).toEqual(['c', 'a', 'b']);
    expect(sortTasks(tasks, { key: 'due', desc: true }).map(x => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('groups by person (a shared task under each person) and gives quick-add defaults', () => {
    const tasks = [t('a', { assignees: [bob, ann] }), t('b', { assignees: [bob] }), t('c')];
    const s = buildSections(tasks, [], 'person', { key: 'manual', desc: false });
    expect(s.map(x => [x.label, x.tasks.map(y => y.id)])).toEqual([['Ann', ['a']], ['Bob', ['a', 'b']], ['Unassigned', ['c']]]);
    expect(s[0]!.defaults).toEqual({ assignee_ids: ['u1'] });
  });

  it('keeps tasks of deleted groups under "No group"', () => {
    const g = { id: 'g1', plan_id: 'p', name: 'Tanks', sort_order: 0 };
    const s = buildSections([t('a', { group_id: 'g1' }), t('b', { group_id: 'gone' })], [g], 'group', { key: 'manual', desc: false });
    expect(s.map(x => [x.label, x.tasks.map(y => y.id)])).toEqual([['Tanks', ['a']], ['No group', ['b']]]);
  });
});
