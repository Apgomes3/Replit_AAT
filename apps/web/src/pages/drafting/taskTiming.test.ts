import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, durationDays, isLate, timeElapsedPercent, todayIso } from './taskTiming';
import { buildSections, sortTasks } from './planViews';
import type { Task } from './draftingApi';
import { byDepartment, groupRowsByTeam, type WorkloadRow } from './planningApi';

describe('company resources grouping', () => {
  const team = (id: string, name: string, department: string) => ({ id, name, department, is_manager: false });
  const row = (user_id: string, teams: ReturnType<typeof team>[]): WorkloadRow =>
    ({ user_id, name: user_id, calendar_name: 'China office', capacity_pct: 100, teams, weeks: [] });
  const fab = team('t1', 'Drafting – Fabrication', 'Drafting');
  const asw = team('t2', 'ASW Engineering', 'Engineering');

  it('lists a person under every team they are in, with people in no team last', () => {
    const s = groupRowsByTeam([row('ann', [fab, asw]), row('bob', [fab]), row('cat', [])]);
    expect(s.map(x => [x.team?.name ?? null, x.rows.map(r => r.user_id)])).toEqual([
      ['Drafting – Fabrication', ['ann', 'bob']], ['ASW Engineering', ['ann']], [null, ['cat']],
    ]);
  });

  it('keeps only the chosen department\'s teams', () => {
    const s = groupRowsByTeam([row('ann', [fab, asw]), row('bob', [fab])], 'engineering');
    expect(s.map(x => [x.team?.name ?? null, x.rows.map(r => r.user_id)])).toEqual([['ASW Engineering', ['ann']], [null, ['bob']]]);
  });

  it('groups teams by department regardless of case', () => {
    const g = byDepartment([{ department: 'Engineering', n: 1 }, { department: 'Design', n: 2 }, { department: 'engineering', n: 3 }]);
    expect(g.map(x => [x.department, x.teams.map(t => t.n)])).toEqual([['Design', [2]], ['Engineering', [1, 3]]]);
  });
});

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

  it('adds and counts calendar days', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(daysBetween('2026-03-01', '2026-02-27')).toBe(-2);
  });
});

describe('plan view sections', () => {
  const t = (id: string, o: Partial<Task> = {}): Task => ({
    id, plan_id: 'p', group_id: null, title: id, status: 'not_started', priority: 'medium', start_date: null, due_date: null,
    notes: null, sort_order: 0, completed_at: null, assignees: [], progress_pct: 0, is_milestone: false, ...o,
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
