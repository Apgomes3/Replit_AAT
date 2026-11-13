// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addDays, pushSchedule, requirement, SchedLink, SchedTask, shortfallDays } from './schedule';

const task = (id: string, start: string | null, due: string | null, status = 'not_started'): SchedTask =>
  ({ id, status, start_date: start, due_date: due });
const link = (p: string, s: string, type: SchedLink['link_type'] = 'FS', lag = 0): SchedLink =>
  ({ predecessor_id: p, successor_id: s, link_type: type, lag_days: lag });

describe('task link rules', () => {
  const pred = task('a', '2026-03-02', '2026-03-06');

  it('works out what each link type asks of the successor', () => {
    expect(requirement({ link_type: 'FS', lag_days: 0 }, pred)).toEqual({ field: 'start_date', date: '2026-03-07' });
    expect(requirement({ link_type: 'FS', lag_days: 2 }, pred)).toEqual({ field: 'start_date', date: '2026-03-09' });
    expect(requirement({ link_type: 'SS', lag_days: 1 }, pred)).toEqual({ field: 'start_date', date: '2026-03-03' });
    expect(requirement({ link_type: 'FF', lag_days: 0 }, pred)).toEqual({ field: 'due_date', date: '2026-03-06' });
    expect(requirement({ link_type: 'SF', lag_days: 0 }, pred)).toEqual({ field: 'due_date', date: '2026-03-01' });
    expect(requirement({ link_type: 'FS', lag_days: 0 }, task('x', '2026-03-01', null))).toBeNull();
  });

  it('measures how many days a successor starts too early', () => {
    expect(shortfallDays({ link_type: 'FS', lag_days: 0 }, pred, task('b', '2026-03-05', '2026-03-10'))).toBe(2);
    expect(shortfallDays({ link_type: 'FS', lag_days: 0 }, pred, task('b', '2026-03-07', '2026-03-10'))).toBe(0);
    expect(shortfallDays({ link_type: 'FS', lag_days: 0 }, pred, task('b', null, null))).toBe(0);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('pushSchedule', () => {
  it('pushes a chain later, keeping each task length, and never pulls tasks earlier', () => {
    const tasks = [
      task('a', '2026-03-02', '2026-03-10'),
      task('b', '2026-03-05', '2026-03-06'), // 2 days, must start 03-11
      task('c', '2026-03-07', '2026-03-09'), // waits for b → after the push must start 03-13
      task('d', '2026-04-01', '2026-04-02'), // already well after a: unchanged
    ];
    const changes = pushSchedule(tasks, [link('a', 'b'), link('b', 'c'), link('a', 'd')], new Set(['a', 'b', 'c', 'd']));
    expect(changes).toEqual([
      { id: 'b', start_date: '2026-03-11', due_date: '2026-03-12' },
      { id: 'c', start_date: '2026-03-13', due_date: '2026-03-15' },
    ]);
  });

  it('uses the latest requirement when a task waits for several others', () => {
    const tasks = [task('a', '2026-03-01', '2026-03-03'), task('b', '2026-03-01', '2026-03-08'), task('c', '2026-03-02', '2026-03-02')];
    expect(pushSchedule(tasks, [link('a', 'c'), link('b', 'c')], new Set(['c'])))
      .toEqual([{ id: 'c', start_date: '2026-03-09', due_date: '2026-03-09' }]);
  });

  it('leaves finished tasks and tasks outside the movable set alone', () => {
    const tasks = [task('a', '2026-03-01', '2026-03-05'), task('b', '2026-03-02', '2026-03-03', 'done'), task('c', '2026-03-02', '2026-03-03')];
    expect(pushSchedule(tasks, [link('a', 'b'), link('a', 'c')], new Set(['a', 'b']))).toEqual([]);
  });
});
