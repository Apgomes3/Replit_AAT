// Typed data access for the Drafting module (mirrors apps/api/src/modules/drafting).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { showRescheduleToast } from './rescheduleToast';

export const PLAN_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export type PlanStatus = typeof PLAN_STATUSES[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

export const PLAN_VISIBILITIES = ['private', 'team', 'everyone'] as const;
export type PlanVisibility = typeof PLAN_VISIBILITIES[number];
export const PLAN_VISIBILITY_LABELS: Record<PlanVisibility, string> = {
  private: 'Private – me, people I share with and assignees',
  team: 'Team – everyone in the team',
  everyone: 'Everyone in the company',
};

export type Person = { id: string; name: string; email: string; role: string };
export type ProjectOption = { id: string; code: string; name: string };

export type Team = {
  id: string;
  name: string;
  description: string | null;
  /** Company department (Drafting, Engineering, Design, ...). */
  department: string;
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
  /** Links: a plan may be on a project, a design book (and its project) or an enquiry, or stand alone. */
  project: ProjectOption | null;
  team: { id: string; name: string; department: string; manager_name: string | null } | null;
  design_book: { id: string; code: string; title: string } | null;
  enquiry: { id: string; number: string; title: string } | null;
  initiative?: { id: string; code: string; title: string } | null;
  owner: { id: string; name: string } | null;
  visibility: PlanVisibility;
  members: Array<{ id: string; name: string }>;
  task_count: number;
  done_count: number;
  late_count: number;
  /** null = the default calendar. */
  calendar_id: string | null;
  calendar_name: string | null;
  auto_schedule: boolean;
  baseline_set_at: string | null;
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
  progress_pct: number;
  is_milestone: boolean;
  baseline_start?: string | null;
  baseline_due?: string | null;
  assignees: Array<{ id: string; name: string; email: string; allocation_pct?: number }>;
  // Schedule figures from the plan's calendar (present on board tasks).
  working_days?: number | null;
  /** Working days the task can slip before the plan end moves. */
  float_days?: number | null;
  critical?: boolean;
  /** Working days the due date moved since the baseline (positive = later). */
  slip_days?: number | null;
};

export type BoardCalendar = { id: string | null; name: string; week_hours: number[]; days: Record<string, number> };

export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type LinkType = typeof LINK_TYPES[number];
export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  FS: 'Starts after it finishes',
  SS: 'Starts when it starts',
  FF: 'Finishes when it finishes',
  SF: 'Finishes when it starts',
};

/** successor waits for predecessor. */
export type TaskLink = {
  id: string; predecessor_id: string; successor_id: string; link_type: LinkType; lag_days: number;
  /** Working days the successor is too early for this link (0 = in order). */
  early_days?: number;
};

/** A task in another plan that a task of this plan is linked to. */
export type ExternalTask = {
  id: string; title: string; status: TaskStatus; start_date: string | null; due_date: string | null; plan_id: string; plan_code: string;
};

export type Board = {
  plan: Plan; groups: TaskGroup[]; tasks: Task[]; links: TaskLink[]; external_tasks: ExternalTask[]; calendar: BoardCalendar;
  /** Whether this user may change the plan (owner, shared people, team manager, Drafting managers, admins). */
  can_edit?: boolean;
};

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
  progress_pct: number;
  is_milestone: boolean;
  /** Allocation % per assigned user id. */
  allocations: Record<string, number>;
}>;

export type TeamPayload = {
  name: string;
  description: string | null;
  manager_user_id: string | null;
  member_ids: string[];
  active?: boolean;
  /** Only used in Resources; Drafting teams always stay in Drafting. */
  department?: string;
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
// Active people from the global planner (open to everyone, so non-Drafting plans can assign too).
export const usePeople = () => useQuery({ queryKey: keys.people, queryFn: () => api.get('/planner/options').then(r => r.data.people as Person[]), staleTime: 0, refetchOnMount: 'always' });
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
      (id ? api.patch(`/planner/plans/${id}`, body) : api.post('/drafting/plans', body)).then(r => r.data as Plan),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.plans }); qc.invalidateQueries({ queryKey: keys.teams }); },
  });
}

export const boardKey = (planId: string) => ['drafting', 'board', planId] as const;

export const useBoard = (planId: string) => useQuery({
  queryKey: boardKey(planId),
  queryFn: () => api.get(`/planner/plans/${planId}/board`).then(r => r.data as Board),
  enabled: !!planId,
});

/** Settings of one plan (calendar, automatic scheduling, …) changed from the board. */
export function usePatchPlan(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<PlanPayload & { calendar_id: string | null; auto_schedule: boolean }>) =>
      api.patch(`/planner/plans/${planId}`, body).then(r => r.data as Plan),
    onSuccess: () => { qc.invalidateQueries({ queryKey: boardKey(planId) }); qc.invalidateQueries({ queryKey: keys.plans }); },
  });
}

/** Save the plan's current dates as its baseline, or clear it. */
export const useSetBaseline = (planId: string) => useBoardMutation(planId, (clear: boolean) =>
  api.post(`/planner/plans/${planId}/baseline`, { clear }).then(r => r.data as Plan));

/**
 * Mutations on one plan's board refresh the board and the plan list counts. When the automatic
 * scheduler moved tasks (`rescheduled` in the response), an Undo message is shown.
 */
function useBoardMutation<TVars, TResult = unknown>(planId: string, fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: boardKey(planId) });
    qc.invalidateQueries({ queryKey: keys.plans });
    qc.invalidateQueries({ queryKey: ['planning', 'workload'] });
  };
  return useMutation({
    mutationFn: fn,
    onSuccess: (result: TResult) => {
      refresh();
      const r = result as { id?: string; rescheduled?: RescheduleChange[]; successor_id?: string } | undefined;
      if (r?.rescheduled?.length) {
        showRescheduleToast(r.rescheduled, r.successor_id ? null : r.id ?? null, async changes => {
          await api.post(`/planner/plans/${planId}/dates`, {
            changes: changes.map(c => ({ id: c.id, start_date: c.old_start_date, due_date: c.old_due_date })),
          });
          refresh();
        });
      }
    },
  });
}

export const useSaveTask = (planId: string) => useBoardMutation(planId, ({ id, body }: { id?: string; body: TaskPayload }) =>
  (id ? api.patch(`/planner/tasks/${id}`, body) : api.post(`/planner/plans/${planId}/tasks`, body))
    .then(r => r.data as Task & { rescheduled?: RescheduleChange[] }));

export const useDeleteTask = (planId: string) => useBoardMutation(planId, (id: string) => api.delete(`/planner/tasks/${id}`));

export const useSaveGroup = (planId: string) => useBoardMutation(planId, ({ id, name }: { id?: string; name: string }) =>
  (id ? api.patch(`/planner/groups/${id}`, { name }) : api.post(`/planner/plans/${planId}/groups`, { name })).then(r => r.data as TaskGroup));

export const useDeleteGroup = (planId: string) => useBoardMutation(planId, (id: string) => api.delete(`/planner/groups/${id}`));

export const useCreateLink = (planId: string) => useBoardMutation(planId,
  ({ successorId, predecessorId, link_type = 'FS', lag_days = 0 }: { successorId: string; predecessorId: string; link_type?: LinkType; lag_days?: number }) =>
    api.post(`/planner/tasks/${successorId}/links`, { predecessor_id: predecessorId, link_type, lag_days }).then(r => r.data as TaskLink));

export const useUpdateLink = (planId: string) => useBoardMutation(planId,
  ({ id, ...body }: { id: string; link_type?: LinkType; lag_days?: number }) => api.patch(`/planner/links/${id}`, body).then(r => r.data as TaskLink));

export const useDeleteLink = (planId: string) => useBoardMutation(planId, (id: string) => api.delete(`/planner/links/${id}`));

/** apply=false previews which tasks would move; apply=true moves them. */
export const useReschedule = (planId: string) => useBoardMutation(planId, (apply: boolean) =>
  api.post(`/planner/plans/${planId}/reschedule`, { apply }).then(r => r.data.data as RescheduleChange[]));

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
