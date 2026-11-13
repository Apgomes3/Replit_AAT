// Typed data access for the shared planning engine (mirrors apps/api/src/modules/planning).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type Calendar = {
  id: string; name: string; description: string | null; week_hours: number[]; is_default: boolean;
  exception_count: number; plan_count: number; people_count: number;
};
export type CalendarDay = { day: string; hours: number; name: string | null };
export type Resource = {
  user_id: string; name: string; email: string; role: string; calendar_id: string | null; calendar_name: string;
  capacity_pct: number; notes: string | null; team_names: string[]; week_hours: number[];
};
export type Leave = { id: string; user_id: string; start_date: string; end_date: string; hours_per_day: number | null; reason: string | null };
export type WorkloadTask = { id: string; title: string; plan_id: string; plan_code: string; project_code: string; hours: number };
export type WorkloadWeek = { week_start: string; capacity: number; booked: number; leave: number; tasks: WorkloadTask[] };
export type WorkloadRow = { user_id: string; name: string; calendar_name: string; capacity_pct: number; weeks: WorkloadWeek[] };

const keys = {
  calendars: ['planning', 'calendars'] as const,
  days: (id: string) => ['planning', 'calendar-days', id] as const,
  resources: (teamId?: string) => ['planning', 'resources', teamId ?? 'all'] as const,
  leave: ['planning', 'leave'] as const,
  workload: (teamId: string | undefined, from: string, weeks: number) => ['planning', 'workload', teamId ?? 'all', from, weeks] as const,
};

export const useCalendars = () => useQuery({ queryKey: keys.calendars, queryFn: () => api.get('/planning/calendars').then(r => r.data.data as Calendar[]) });

export const useCalendarDays = (id: string | undefined) => useQuery({
  queryKey: keys.days(id ?? ''), enabled: !!id,
  queryFn: () => api.get(`/planning/calendars/${id}/days`).then(r => r.data.data as CalendarDay[]),
});

export const useResources = (teamId?: string) => useQuery({
  queryKey: keys.resources(teamId),
  queryFn: () => api.get('/planning/resources', { params: teamId ? { team_id: teamId } : {} }).then(r => r.data.data as Resource[]),
});

export const useLeave = (from?: string) => useQuery({
  queryKey: [...keys.leave, from ?? ''],
  queryFn: () => api.get('/planning/leave', { params: from ? { from } : {} }).then(r => r.data.data as Leave[]),
});

export const useWorkload = (teamId: string | undefined, from: string, weeks: number) => useQuery({
  queryKey: keys.workload(teamId, from, weeks),
  queryFn: () => api.get('/planning/workload', { params: { ...(teamId ? { team_id: teamId } : {}), from, weeks } })
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

/** Hours in a week from a week_hours list. */
export const weekTotal = (w: number[]) => Math.round(w.reduce((a, b) => a + Number(b), 0) * 10) / 10;
