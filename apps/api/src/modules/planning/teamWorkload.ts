// Home page: a short summary of how loaded the signed-in person's team is, week by week.
// "Your team" is the people who report to you plus the members of teams you manage; if there are
// none, the other members of the teams you belong to. Only hours are shown, never task titles.
import { query } from '../../db';
import { getWorkload } from './repository';

export type TeamWorkloadPerson = {
  user_id: string; name: string;
  weeks: Array<{ capacity: number; booked: number }>;
};
export type TeamWorkload = {
  basis: 'manager' | 'member' | 'none';
  team_names: string[];
  weeks: Array<{ week_start: string; capacity: number; booked: number }>;
  people: TeamWorkloadPerson[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The people in the person's team, and whether they lead it or belong to it. */
export async function findTeam(userId: string): Promise<{ basis: TeamWorkload['basis']; ids: string[]; team_names: string[] }> {
  const led = (await query(
    `SELECT u.id FROM users u WHERE u.reports_to_user_id = $1 AND u.is_active IS NOT FALSE
     UNION
     SELECT m.user_id FROM drafting_teams t JOIN drafting_team_members m ON m.team_id = t.id JOIN users u ON u.id = m.user_id
     WHERE t.manager_user_id = $1 AND t.active AND u.is_active IS NOT FALSE AND m.user_id <> $1`, [userId],
  )).rows.map(r => r.id as string);
  const ledTeams = (await query(`SELECT name FROM drafting_teams WHERE manager_user_id = $1 AND active ORDER BY LOWER(name)`, [userId])).rows.map(r => r.name);
  if (led.length) return { basis: 'manager', ids: led, team_names: ledTeams };

  const teams = (await query(
    `SELECT t.id, t.name FROM drafting_teams t JOIN drafting_team_members m ON m.team_id = t.id
     WHERE m.user_id = $1 AND t.active ORDER BY LOWER(t.name)`, [userId],
  )).rows;
  if (!teams.length) return { basis: 'none', ids: [], team_names: [] };
  const members = (await query(
    `SELECT DISTINCT m.user_id FROM drafting_team_members m JOIN users u ON u.id = m.user_id
     WHERE m.team_id = ANY($1::uuid[]) AND u.is_active IS NOT FALSE`, [teams.map(t => t.id)],
  )).rows.map(r => r.user_id as string);
  return { basis: 'member', ids: members, team_names: teams.map(t => t.name) };
}

export async function getTeamWorkload(userId: string, from: string, weeks: number): Promise<TeamWorkload> {
  const team = await findTeam(userId);
  if (!team.ids.length) return { basis: team.basis, team_names: team.team_names, weeks: [], people: [] };
  const rows = await getWorkload({ userIds: team.ids, from, weeks });
  const people = rows.map(r => ({
    user_id: r.user_id, name: r.name,
    weeks: r.weeks.map(w => ({ capacity: round1(w.capacity), booked: round1(w.booked) })),
  }));
  const totals = (rows[0]?.weeks ?? []).map((w, i) => ({
    week_start: w.week_start,
    capacity: round1(rows.reduce((s, r) => s + r.weeks[i].capacity, 0)),
    booked: round1(rows.reduce((s, r) => s + r.weeks[i].booked, 0)),
  }));
  return { basis: team.basis, team_names: team.team_names, weeks: totals, people };
}
