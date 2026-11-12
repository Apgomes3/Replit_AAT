// Typed data access for the Drafting module (mirrors apps/api/src/modules/drafting).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

export const PLAN_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export type PlanStatus = typeof PLAN_STATUSES[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

export type Person = { id: string; name: string; email: string; role: string };
export type ProjectOption = { id: string; code: string; name: string };

export type Team = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  manager: Person | null;
  members: Person[];
  plan_count: number;
};

export type Plan = {
  id: string;
  plan_code: string;
  name: string;
  status: PlanStatus;
  start_date: string | null;
  target_date: string | null;
  description: string | null;
  project: ProjectOption;
  team: { id: string; name: string; manager_name: string | null };
};

export type TeamPayload = {
  name: string;
  description: string | null;
  manager_user_id: string | null;
  member_ids: string[];
  active?: boolean;
};

export type PlanPayload = {
  name: string;
  project_id: string;
  team_id: string;
  status: PlanStatus;
  start_date: string | null;
  target_date: string | null;
  description: string | null;
};

const keys = {
  teams: ['drafting', 'teams'] as const,
  plans: ['drafting', 'plans'] as const,
  people: ['drafting', 'people'] as const,
  projects: ['drafting', 'projects'] as const,
};

const list = <T,>(path: string) => () => api.get(path).then(r => r.data.data as T[]);

export const useTeams = () => useQuery({ queryKey: keys.teams, queryFn: list<Team>('/drafting/teams') });
export const usePlans = () => useQuery({ queryKey: keys.plans, queryFn: list<Plan>('/drafting/plans') });
// Pickers refetch every time a form opens: users and projects are created elsewhere
// (Admin › Users, Projects), so a cached list would hide newly added people/projects.
export const usePeople = () => useQuery({ queryKey: keys.people, queryFn: list<Person>('/drafting/people'), staleTime: 0, refetchOnMount: 'always' });
export const useProjectOptions = () => useQuery({ queryKey: keys.projects, queryFn: list<ProjectOption>('/drafting/projects'), staleTime: 0, refetchOnMount: 'always' });

export function useSaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: TeamPayload }) =>
      (id ? api.patch(`/drafting/teams/${id}`, body) : api.post('/drafting/teams', body)).then(r => r.data as Team),
    // Plans show the team name and manager, so refresh both lists.
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.teams }); qc.invalidateQueries({ queryKey: keys.plans }); },
  });
}

export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PlanPayload }) =>
      (id ? api.patch(`/drafting/plans/${id}`, body) : api.post('/drafting/plans', body)).then(r => r.data as Plan),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.plans }); qc.invalidateQueries({ queryKey: keys.teams }); },
  });
}

export function useCanManageDrafting() {
  const user = useAuthStore(s => s.user);
  return user?.role === 'admin' || user?.moduleAccess?.drafting === 'manage';
}

export function apiErrorMessage(err: any, fallback: string) {
  return err?.response?.data?.error?.message || fallback;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
}
