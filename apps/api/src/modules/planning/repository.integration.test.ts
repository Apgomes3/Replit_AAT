// @vitest-environment node
// Runs the planning repository against the PostgreSQL test database (TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import * as drafting from '../drafting/repository';
import * as repo from './repository';
import { HolidayDay, loadHolidaySets } from './holidays';

const withDb = () => ({ query } as unknown as Parameters<typeof loadHolidaySets>[0]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ids: Record<string, string> = {};

describe.skipIf(!process.env.DATABASE_URL)('planning repository (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.user = (await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Plan', 'Tester', 'engineer') RETURNING id`,
      [`planning-${suffix}@example.test`],
    )).rows[0].id;
    ids.project = (await query(`INSERT INTO projects (project_code, project_name) VALUES ($1, 'Planning test') RETURNING id`, [`PLN-${suffix}`])).rows[0].id;
    ids.team = (await drafting.createTeam({ name: `Planning team ${suffix}`, member_ids: [ids.user] }, ids.user)).id;
    ids.plan = (await drafting.createPlan({ name: 'Workload plan', project_id: ids.project, team_id: ids.team }, ids.user)).id;
  });

  afterAll(async () => {
    if (ids.plan) await query('DELETE FROM drafting_plans WHERE id = $1', [ids.plan]);
    if (ids.team) await query('DELETE FROM drafting_teams WHERE id = $1', [ids.team]);
    if (ids.team2) await query('DELETE FROM drafting_teams WHERE id = $1', [ids.team2]);
    if (ids.project) await query('DELETE FROM projects WHERE id = $1', [ids.project]);
    if (ids.calendar) await query('DELETE FROM planning_calendars WHERE id = $1', [ids.calendar]);
    if (ids.user) await query('DELETE FROM users WHERE id = $1', [ids.user]);
  });

  it('has one default calendar with the 2026 mainland China holidays', async () => {
    const def = (await repo.listCalendars()).find(c => c.is_default)!;
    expect(def.week_hours).toEqual([9, 9, 9, 9, 9, 8, 0]);
    const days = await repo.listCalendarDays(def.id, 2026);
    expect(days.find(d => d.day === '2026-10-01')).toMatchObject({ hours: 0, name: 'National Day' });
    expect(days.find(d => d.day === '2026-09-20')!.hours).toBe(9);
    await expect(repo.deleteCalendar(def.id)).rejects.toThrow(/default/);
  });

  it('applies each holiday set once, creating its calendar and keeping later edits', async () => {
    const calendar = { name: `Holiday test ${suffix}`, description: 'test', week_hours: [8, 8, 8, 8, 8, 0, 0] };
    const set = { key: `T-${suffix}`.slice(0, 30), calendar, days: [['2027-03-01', 0, 'A'], ['2027-03-02', 0, 'B']] as HolidayDay[] };
    try {
      expect(await loadHolidaySets(withDb(), [set])).toEqual([set.key]);
      const cal = (await repo.listCalendars()).find(c => c.name === calendar.name)!;
      ids.holidayCal = cal.id;
      expect(cal.is_default).toBe(false);
      expect((await repo.listCalendarDays(cal.id)).map(d => d.day)).toEqual(['2027-03-01', '2027-03-02']);
      // A manager removes one day; loading again changes nothing.
      await repo.deleteCalendarDays(cal.id, ['2027-03-01']);
      expect(await loadHolidaySets(withDb(), [set])).toEqual([]);
      expect((await repo.listCalendarDays(cal.id)).map(d => d.day)).toEqual(['2027-03-02']);
    } finally {
      await query('DELETE FROM planning_holiday_sets WHERE set_key = $1', [set.key]);
      if (ids.holidayCal) await query('DELETE FROM planning_calendars WHERE id = $1', [ids.holidayCal]);
    }
  });

  it('manages calendars and exception days', async () => {
    const cal = await repo.createCalendar({ name: `Part-time ${suffix}`, week_hours: [4, 4, 4, 4, 4, 0, 0] }, ids.user);
    ids.calendar = cal.id;
    await repo.upsertCalendarDays(cal.id, [{ day: '2026-12-25', hours: 0, name: 'Office closed' }]);
    expect(await repo.listCalendarDays(cal.id)).toEqual([{ day: '2026-12-25', hours: 0, name: 'Office closed' }]);
    expect(await repo.deleteCalendarDays(cal.id, ['2026-12-25'])).toBe(1);
    await expect(repo.updateCalendar(cal.id, { is_default: false }, ids.user)).resolves.toMatchObject({ is_default: false });
  });

  it('works out weekly workload against capacity, leave and allocation, across plans', async () => {
    // Person on the part-time calendar (4 h Mon-Fri) at 100%, one day of leave on Wed 18 Nov.
    await repo.saveResource(ids.user, { calendar_id: ids.calendar, capacity_pct: 100 }, ids.user);
    await repo.createLeave(ids.user, { start_date: '2026-11-18', end_date: '2026-11-18' }, ids.user);
    // Task Mon 16 – Sun 22 Nov at 50% → 5 working days × 4 h × 50% = 10 h.
    await drafting.createTask(ids.plan, {
      title: 'Workload task', start_date: '2026-11-16', due_date: '2026-11-22', assignee_ids: [ids.user], allocations: { [ids.user]: 50 },
    }, ids.user);

    const [row] = await repo.getWorkload({ userIds: [ids.user], from: '2026-11-16', weeks: 2 });
    expect(row!.calendar_name).toBe(`Part-time ${suffix}`);
    expect(row!.weeks[0]).toMatchObject({ week_start: '2026-11-16', capacity: 16, leave: 4, booked: 10 });
    expect(row!.weeks[0]!.tasks).toEqual([expect.objectContaining({ title: 'Workload task', hours: 10 })]);
    expect(row!.weeks[1]).toMatchObject({ week_start: '2026-11-23', capacity: 20, booked: 0 });

    const team = await repo.listResources({ teamId: ids.team });
    expect(team.map(p => p.user_id)).toEqual([ids.user]);
  });

  it('keeps company teams by department, with people in more than one team', async () => {
    const department = `Engineering ${suffix}`;
    const eng = await drafting.createTeam({ name: `ASW engineering ${suffix}`, department, member_ids: [ids.user] }, ids.user);
    ids.team2 = eng.id;
    expect(eng.department).toBe(department);
    // The drafting team keeps the Drafting department by default.
    expect((await drafting.getTeam(ids.team))!.department).toBe('Drafting');
    expect((await drafting.listTeams({ department: department.toUpperCase() })).map(t => t.id)).toEqual([eng.id]);
    expect((await drafting.listTeams({ department: 'Drafting' })).map(t => t.id)).not.toContain(eng.id);

    const people = await repo.listResources({ department });
    expect(people.map(p => p.user_id)).toEqual([ids.user]);
    expect(people[0]!.teams.map(t => t.name).sort()).toEqual([`ASW engineering ${suffix}`, `Planning team ${suffix}`].sort());

    const [row] = await repo.getWorkload({ department, from: '2026-11-16', weeks: 1 });
    expect(row!.teams).toHaveLength(2);
    expect(row!.weeks[0]!.booked).toBe(10);

    // Inactive teams drop out of the department.
    await drafting.updateTeam(eng.id, { active: false }, ids.user);
    expect(await repo.listResources({ department })).toEqual([]);
  });
});
