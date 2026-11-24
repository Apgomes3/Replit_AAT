// @vitest-environment node
// Home "team workload": who counts as your team, and the hours summed per week.
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { findTeam, getTeamWorkload } from './teamWorkload';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ids: Record<string, string> = {};
const addUser = async (key: string, reportsTo?: string) => {
  ids[key] = (await query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, reports_to_user_id) VALUES ($1, 'x', $2, 'Team', 'user', $3) RETURNING id`,
    [`team-${key}-${tag}@example.test`, key, reportsTo ?? null],
  )).rows[0].id;
};

describe.skipIf(!process.env.DATABASE_URL)('team workload (PostgreSQL)', () => {
  beforeAll(async () => {
    await addUser('boss');
    await addUser('direct', ids.boss);
    await addUser('member');
    await addUser('loner');
    await addUser('gone', ids.boss);
    await query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [ids.gone]);
    ids.team = (await query(`INSERT INTO drafting_teams (name, manager_user_id) VALUES ($1, $2) RETURNING id`, [`Team ${tag}`, ids.boss])).rows[0].id;
    await query(`INSERT INTO drafting_team_members (team_id, user_id) VALUES ($1, $2), ($1, $3), ($1, $4)`, [ids.team, ids.boss, ids.member, ids.direct]);
    await query(`INSERT INTO planning_personal_tasks (user_id, title, start_date, due_date, planned_hours) VALUES ($1, 'Work', '2026-11-23', '2026-11-27', 10)`, [ids.direct]);
  });

  afterAll(async () => {
    await query(`DELETE FROM planning_personal_tasks WHERE user_id = $1`, [ids.direct]);
    await query(`DELETE FROM drafting_teams WHERE id = $1`, [ids.team]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(ids).filter(id => id !== ids.team)]);
  });

  it('a manager sees their reports and the members of teams they lead, not themselves or blocked people', async () => {
    const t = await findTeam(ids.boss);
    expect(t.basis).toBe('manager');
    expect(t.ids.sort()).toEqual([ids.direct, ids.member].sort());
    expect(t.team_names).toEqual([`Team ${tag}`]);
  });

  it('a member sees their team; someone with no team sees nothing', async () => {
    const t = await findTeam(ids.member);
    expect(t.basis).toBe('member');
    expect(t.ids.sort()).toEqual([ids.boss, ids.direct, ids.member].sort());
    expect(await getTeamWorkload(ids.loner, '2026-11-23', 2)).toEqual({ basis: 'none', team_names: [], weeks: [], people: [] });
  });

  it('adds up booked and available hours per week', async () => {
    const w = await getTeamWorkload(ids.boss, '2026-11-23', 2);
    expect(w.weeks).toHaveLength(2);
    expect(w.weeks[0].week_start).toBe('2026-11-23');
    const direct = w.people.find(p => p.user_id === ids.direct)!;
    expect(direct.weeks[0].booked).toBe(10);
    expect(w.weeks[0].booked).toBeCloseTo(w.people.reduce((s, p) => s + p.weeks[0].booked, 0), 1);
    expect(w.weeks[0].capacity).toBeGreaterThan(0);
  });
});
