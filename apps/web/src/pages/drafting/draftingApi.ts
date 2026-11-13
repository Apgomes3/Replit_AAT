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
  task_count: number;
  done_count: number;
  late_count: number;
};

export const TASK_STATUSES = ['not_started', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
};

export const TASK_PRIORITIES = ['urgent', 'important', 'medium', 'low'] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  important: 'Important',
  medium: 'Medium',
  low: 'Low',
};

export type TaskGroup = { id: string; plan_id: string; name: string; sort_order: number };

export type Task = {
  id: string;
  plan_id: string;
  group_id: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  notes: string | null;
  sort_order: number;
  completed_at: string | null;
  assignees: Array<{ id: string; name: string; email: string }>;
};

export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type LinkType = typeof LINK_TYPES[number];
export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  FS: 'Starts after it finishes',
  SS: 'Starts when it starts',
  FF: 'Finishes when it finishes',
  SF: 'Finishes when it starts',
};

/** successor waits for predecessor. */
export type TaskLink = { id: string; predecessor_id: string; successor_id: string; link_type: LinkType; lag_days: number };

/** A task in another plan that a task of this plan is linked to. */
export type ExternalTask = {
  id: string; title: string; status: TaskStatus; start_date: string | null; due_date: string | null; plan_id: string; plan_code: string;
};

export type Board = { plan: Plan; groups: TaskGroup[]; tasks: Task[]; links: TaskLink[]; external_tasks: ExternalTask[] };

export type RescheduleChange = {
  id: string; title: string; start_date: string | null; due_date: string | null;
  old_start_date: string | null; old_due_date: string | null;
};

export type TaskPayload = Partial<{
  title: string;
  group_id: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  notes: string | null;
  assignee_ids: string[];
}>;

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

const boardKey = (planId: string) => ['drafting', 'board', planId] as const;

export const useBoard = (planId: string) => useQuery({
  queryKey: boardKey(planId),
  queryFn: () => api.get(`/drafting/plans/${planId}/board`).then(r => r.data as Board),
  enabled: !!planId,
});

/** Mutations on one plan's board refresh the board and the plan list counts. */
function useBoardMutation<TVars, TResult = unknown>(planId: string, fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: boardKey(planId) });
      qc.invalidateQueries({ queryKey: keys.plans });
    },
  });
}

export const useSaveTask = (planId: string) => useBoardMutation(planId, ({ id, body }: { id?: string; body: TaskPayload }) =>
  (id ? api.patch(`/drafting/tasks/${id}`, body) : api.post(`/drafting/plans/${planId}/tasks`, body)).then(r => r.data as Task));

export const useDeleteTask = (planId: string) => useBoardMutation(planId, (id: string) => api.delete(`/drafting/tasks/${id}`));

export const useSaveGroup = (planId: string) => useBoardMutation(planId, ({ id, name }: { id?: string; name: string }) =>
  (id ? api.patch(`/drafting/groups/${id}`, { name }) : api.post(`/drafting/plans/${planId}/groups`, { name })).then(r => r.data as TaskGroup));

export const useDeleteGroup = (planId: string) => useBoardMutation(planId, (id: string) => api.delete(`/drafting/groups/${id}`));

export const useCreateLink = (planId: string) => useBoardMutation(planId,
  ({ successorId, predecessorId, link_type = 'FS', lag_days = 0 }: { successorId: string; predecessorId: string; link_type?: LinkType; lag_days?: number }) =>
    api.post(`/drafting/tasks/${successorId}/links`, { predecessor_id: predecessorId, link_type, lag_days }).then(r => r.data as TaskLink));

export const useUpdateLink = (planId: string) => useBoardMutation(planId,
  ({ id, ...body }: { id: string; link_type?: LinkType; lag_days?: number }) => api.patch(`/drafting/links/${id}`, body).then(r => r.data as TaskLink));

export const useDeleteLink = (planId: string) => useBoardMutation(planId, (id: string) => api.delete(`/drafting/links/${id}`));

/** apply=false previews which tasks would move; apply=true moves them. */
export const useReschedule = (planId: string) => useBoardMutation(planId, (apply: boolean) =>
  api.post(`/drafting/plans/${planId}/reschedule`, { apply }).then(r => r.data.data as RescheduleChange[]));

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
