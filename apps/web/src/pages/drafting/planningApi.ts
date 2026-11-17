// Typed data access for the shared planning engine (mirrors apps/api/src/modules/planning).
import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import type { Team, TeamPayload } from './draftingApi';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Where the shared planning panels are shown: inside Drafting (its own teams, Drafting access)
 * or in Resources (every company team, Resources access).
 */
export type PlanningScope = 'drafting' | 'company';
export const PlanningScopeContext = createContext<PlanningScope>('drafting');
export const usePlanningScope = () => useContext(PlanningScopeContext);

/** Departments offered when creating a company team (others can be typed). */
export const SUGGESTED_DEPARTMENTS = ['Drafting', 'Design', 'Engineering', 'Management', 'Business Development'] as const;

/** Teams grouped by department (case-insensitive), departments in name order. */
export function byDepartment<T extends { department: string }>(teams: T[]): Array<{ department: string; teams: T[] }> {
  const groups = new Map<string, T[]>();
  for (const t of teams) {
    const key = [...groups.keys()].find(k => k.toLowerCase() === t.department.toLowerCase()) ?? t.department;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([department, list]) => ({ department, teams: list }));
}

/** Can the user change calendars, people and leave (and, in Resources, company teams) here? */
export function useCanManagePlanning() {
  const scope = usePlanningScope();
  const user = useAuthStore(s => s.user);
  if (user?.role === 'admin') return true;
  return scope === 'company' ? user?.moduleAccess?.resources === 'manage' : user?.moduleAccess?.drafting === 'manage';
}

/** The teams the current screen works with: Drafting's teams, or every company team. */
export function useScopedTeams() {
  const scope = usePlanningScope();
  const path = scope === 'company' ? '/planning/teams' : '/drafting/teams';
  return useQuery({
    queryKey: scope === 'company' ? ['planning', 'teams'] : ['drafting', 'teams'],
    queryFn: () => api.get(path).then(r => r.data.data as Team[]),
  });
}

export function useSaveScopedTeam() {
  const scope = usePlanningScope();
  const qc = useQueryClient();
  const base = scope === 'company' ? '/planning/teams' : '/drafting/teams';
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: TeamPayload }) =>
      (id ? api.patch(`${base}/${id}`, body) : api.post(base, body)).then(r => r.data as Team),
    // Teams appear in both places, and plans show the team name and manager.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planning'] });
      qc.invalidateQueries({ queryKey: ['drafting', 'teams'] });
      qc.invalidateQueries({ queryKey: ['drafting', 'plans'] });
    },
  });
}

/** Which people a list covers: one team, one department, or everyone. */
export type PeopleFilter = { teamId?: string; department?: string };
const filterParams = (f: PeopleFilter) => ({
  ...(f.teamId ? { team_id: f.teamId } : {}), ...(f.department ? { department: f.department } : {}),
});
const filterKey = (f: PeopleFilter) => f.teamId ? `team:${f.teamId}` : f.department ? `dept:${f.department}` : 'all';

export type Calendar = {
  id: string; name: string; description: string | null; week_hours: number[]; is_default: boolean;
  exception_count: number; plan_count: number; people_count: number;
};
export type CalendarDay = { day: string; hours: number; name: string | null };
/** A team a person is in (as member or manager). */
export type PersonTeam = { id: string; name: string; department: string; is_manager: boolean };
export type Resource = {
  user_id: string; name: string; email: string; role: string; calendar_id: string | null; calendar_name: string;
  capacity_pct: number; notes: string | null; team_names: string[]; teams: PersonTeam[]; week_hours: number[];
};
export type Leave = { id: string; user_id: string; start_date: string; end_date: string; hours_per_day: number | null; reason: string | null };
/** What books the hours: a plan task, the person's own task, or a standing commitment. */
export type WorkloadTask = {
  id: string; title: string; kind: 'plan' | 'task' | 'commitment';
  plan_id: string | null; plan_code: string | null; project_code: string | null; hours: number;
};
export type WorkloadDay = { date: string; capacity: number; booked: number; leave: number };
export type WorkloadWeek = { week_start: string; capacity: number; booked: number; leave: number; tasks: WorkloadTask[]; days?: WorkloadDay[] };
export type WorkloadRow = {
  user_id: string; name: string; calendar_name: string; capacity_pct: number; teams: PersonTeam[]; weeks: WorkloadWeek[];
};

const keys = {
  calendars: ['planning', 'calendars'] as const,
  days: (id: string) => ['planning', 'calendar-days', id] as const,
  resources: (f: PeopleFilter) => ['planning', 'resources', filterKey(f)] as const,
  leave: ['planning', 'leave'] as const,
  workload: (f: PeopleFilter, from: string, weeks: number) => ['planning', 'workload', filterKey(f), from, weeks] as const,
};

export const useCalendars = () => useQuery({ queryKey: keys.calendars, queryFn: () => api.get('/planning/calendars').then(r => r.data.data as Calendar[]) });

export const useCalendarDays = (id: string | undefined) => useQuery({
  queryKey: keys.days(id ?? ''), enabled: !!id,
  queryFn: () => api.get(`/planning/calendars/${id}/days`).then(r => r.data.data as CalendarDay[]),
});

export const useResources = (filter: PeopleFilter = {}) => useQuery({
  queryKey: keys.resources(filter),
  queryFn: () => api.get('/planning/resources', { params: filterParams(filter) }).then(r => r.data.data as Resource[]),
});

export const useLeave = (from?: string) => useQuery({
  queryKey: [...keys.leave, from ?? ''],
  queryFn: () => api.get('/planning/leave', { params: from ? { from } : {} }).then(r => r.data.data as Leave[]),
});

export const useWorkload = (filter: PeopleFilter, from: string, weeks: number, enabled = true) => useQuery({
  queryKey: keys.workload(filter, from, weeks),
  enabled,
  queryFn: () => api.get('/planning/workload', { params: { ...filterParams(filter), from, weeks } })
    .then(r => r.data as { from: string; weeks: number; data: WorkloadRow[] }),
});

/** Any change here can change working days, capacity and the boards, so refresh all planning data and boards. */
function usePlanningMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planning'] });
      qc.invalidateQueries({ queryKey: ['drafting', 'board'] });
      qc.invalidateQueries({ queryKey: ['drafting', 'plans'] });
    },
  });
}

export type CalendarPayload = Partial<{ name: string; description: string | null; week_hours: number[]; is_default: boolean; copy_days_from: string }>;

export const useSaveCalendar = () => usePlanningMutation(({ id, body }: { id?: string; body: CalendarPayload }) =>
  (id ? api.patch(`/planning/calendars/${id}`, body) : api.post('/planning/calendars', body)).then(r => r.data as Calendar));
export const useDeleteCalendar = () => usePlanningMutation((id: string) => api.delete(`/planning/calendars/${id}`));
export const useSaveCalendarDays = () => usePlanningMutation(({ id, days }: { id: string; days: CalendarDay[] }) =>
  api.put(`/planning/calendars/${id}/days`, { days }));
export const useDeleteCalendarDays = () => usePlanningMutation(({ id, days }: { id: string; days: string[] }) =>
  api.delete(`/planning/calendars/${id}/days`, { data: { days } }));
export const useSaveResource = () => usePlanningMutation(({ userId, body }: { userId: string; body: Partial<{ calendar_id: string | null; capacity_pct: number; notes: string | null }> }) =>
  api.patch(`/planning/resources/${userId}`, body));
export const useAddLeave = () => usePlanningMutation(({ userId, body }: { userId: string; body: { start_date: string; end_date: string; hours_per_day: number | null; reason: string | null } }) =>
  api.post(`/planning/resources/${userId}/leave`, body).then(r => r.data as Leave));
export const useDeleteLeave = () => usePlanningMutation((id: string) => api.delete(`/planning/leave/${id}`));

export type WorkloadSection = { key: string; team: PersonTeam | null; rows: WorkloadRow[] };

/**
 * Splits workload rows into one section per team (by department, then team name). Someone in two
 * teams appears in both; people in no team (or none in `department`) go last, under team null.
 */
export function groupRowsByTeam(rows: WorkloadRow[], department?: string): WorkloadSection[] {
  const sections = new Map<string, WorkloadSection>();
  const loose: WorkloadRow[] = [];
  for (const row of rows) {
    const teams = row.teams.filter(t => !department || t.department.toLowerCase() === department.toLowerCase());
    if (!teams.length) loose.push(row);
    for (const t of teams) {
      if (!sections.has(t.id)) sections.set(t.id, { key: t.id, team: t, rows: [] });
      sections.get(t.id)!.rows.push(row);
    }
  }
  const ordered = [...sections.values()].sort((a, b) =>
    a.team!.department.localeCompare(b.team!.department) || a.team!.name.localeCompare(b.team!.name));
  return loose.length ? [...ordered, { key: 'none', team: null, rows: loose }] : ordered;
}

/** Hours in a week from a week_hours list. */
export const weekTotal = (w: number[]) => Math.round(w.reduce((a, b) => a + Number(b), 0) * 10) / 10;
