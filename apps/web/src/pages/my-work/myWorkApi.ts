// Typed data access for My Work (mirrors apps/api/src/modules/planning/myWork.ts) and the pure
// grouping used by the planner.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import type { WorkloadWeek } from '../drafting/planningApi';
import { addDays } from '../drafting/taskTiming';

export type WorkStatus = 'not_started' | 'in_progress' | 'review' | 'done';
export type ProjectRef = { id: string; code: string; name: string } | null;

export type MyPlanTask = {
  id: string; title: string; status: WorkStatus; progress_pct: number; is_milestone: boolean; allocation_pct: number;
  start_date: string | null; due_date: string | null; plan: { id: string; code: string; name: string }; project: ProjectRef;
};
export type PersonalTask = {
  id: string; title: string; notes: string | null; status: WorkStatus; progress_pct: number;
  start_date: string | null; due_date: string | null; planned_hours: number | null; project: ProjectRef; initiative?: ProjectRef;
  enquiry?: ProjectRef; design_book?: ProjectRef;
};
export type CommitmentKind = 'meeting' | 'role' | 'other';
export type Commitment = {
  id: string; title: string; kind: CommitmentKind; weekdays: number[] | null; hours_per_day: number | null;
  capacity_pct: number | null; start_date: string; end_date: string | null; project: ProjectRef;
};
export type MyWork = {
  from: string; calendar_name: string; capacity_pct: number; weeks: WorkloadWeek[];
  plan_tasks: MyPlanTask[]; tasks: PersonalTask[]; commitments: Commitment[];
};

export type PersonalTaskPayload = Partial<{
  title: string; notes: string | null; project_id: string | null; initiative_id: string | null; enquiry_id: string | null;
  design_book_id: string | null; status: WorkStatus; progress_pct: number;
  start_date: string | null; due_date: string | null; planned_hours: number | null;
}>;
export type CommitmentPayload = {
  title: string; kind: CommitmentKind; start_date: string; end_date: string | null; project_id: string | null;
  weekdays: number[] | null; hours_per_day: number | null; capacity_pct: number | null;
};

const KEY = ['my-work'] as const;

export const useMyWork = (from: string, weeks = 4) => useQuery({
  queryKey: [...KEY, from, weeks],
  queryFn: () => api.get('/my-work', { params: { from, weeks } }).then(r => r.data as MyWork),
});

export const useMyProjects = () => useQuery({
  queryKey: [...KEY, 'projects'], staleTime: 60_000,
  queryFn: () => api.get('/my-work/projects').then(r => r.data.data as Array<{ id: string; code: string; name: string }>),
});

/** Initiatives a task can be booked to: approved, running or on hold. */
export const useMyInitiatives = () => useQuery({
  queryKey: [...KEY, 'initiatives'], staleTime: 60_000,
  queryFn: () => api.get('/initiatives').then(r => (r.data.data as Array<{ id: string; code: string; title: string; stage: string }>)
    .filter(i => ['approved', 'in_progress', 'on_hold'].includes(i.stage)).map(i => ({ id: i.id, code: i.code, name: i.title }))),
  retry: false,
});

type LinkOption = { id: string; code: string; name: string };
export type LinkOptions = { projects: LinkOption[]; initiatives: LinkOption[]; enquiries: LinkOption[]; design_books: LinkOption[] };

/** What a task can be for (only modules you can see): projects, active initiatives, open enquiries, design books. */
export const useLinkOptions = () => useQuery({
  queryKey: [...KEY, 'link-options'], staleTime: 60_000,
  queryFn: () => api.get('/my-work/link-options').then(r => r.data as LinkOptions),
});

export type TaskLinkKey = 'project_id' | 'initiative_id' | 'enquiry_id' | 'design_book_id';
export type LinkedTask = {
  id: string; title: string; status: WorkStatus; progress_pct: number; start_date: string | null; due_date: string | null;
  planned_hours: number | null; user_id: string; user_name: string;
};
/** Everyone's own tasks for one project, initiative, enquiry or design book. */
export const useLinkedTasks = (link: TaskLinkKey, id: string | undefined) => useQuery({
  queryKey: [...KEY, 'linked', link, id], enabled: !!id,
  queryFn: () => api.get('/my-work/linked-tasks', { params: { [link]: id } }).then(r => r.data.data as LinkedTask[]),
});

/** Every change can move booked hours, so refresh My Work and any workload or board on screen. */
function useMyWorkMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['planning', 'workload'] });
      qc.invalidateQueries({ queryKey: ['drafting', 'board'] });
    },
  });
}

export const useSavePersonalTask = () => useMyWorkMutation(({ id, body }: { id?: string; body: PersonalTaskPayload }) =>
  id ? api.patch(`/my-work/tasks/${id}`, body) : api.post('/my-work/tasks', body));
export const useDeletePersonalTask = () => useMyWorkMutation((id: string) => api.delete(`/my-work/tasks/${id}`));
export const useUpdatePlanTask = () => useMyWorkMutation(({ id, body }: { id: string; body: { status?: WorkStatus; progress_pct?: number } }) =>
  api.patch(`/my-work/plan-tasks/${id}`, body));
export const useSaveCommitment = () => useMyWorkMutation(({ id, body }: { id?: string; body: CommitmentPayload }) =>
  id ? api.put(`/my-work/commitments/${id}`, body) : api.post('/my-work/commitments', body));
export const useDeleteCommitment = () => useMyWorkMutation((id: string) => api.delete(`/my-work/commitments/${id}`));

// ---------- planner grouping ----------

/** One row in the planner: a plan task assigned to me or one of my own tasks. */
export type WorkItem = {
  key: string; kind: 'plan' | 'task'; id: string; title: string; status: WorkStatus; progress_pct: number;
  start_date: string | null; due_date: string | null; is_milestone: boolean; project: ProjectRef; initiative: ProjectRef;
  enquiry: ProjectRef; design_book: ProjectRef;
  plan: MyPlanTask['plan'] | null; planned_hours: number | null; notes: string | null;
};

export const toWorkItems = (w: Partial<Pick<MyWork, 'plan_tasks' | 'tasks'>>): WorkItem[] => [
  ...(w.plan_tasks ?? []).map(t => ({
    key: `plan:${t.id}`, kind: 'plan' as const, id: t.id, title: t.title, status: t.status, progress_pct: t.progress_pct,
    start_date: t.start_date, due_date: t.due_date, is_milestone: t.is_milestone, project: t.project, initiative: null, enquiry: null, design_book: null, plan: t.plan,
    planned_hours: null, notes: null,
  })),
  ...(w.tasks ?? []).map(t => ({
    key: `task:${t.id}`, kind: 'task' as const, id: t.id, title: t.title, status: t.status, progress_pct: t.progress_pct,
    start_date: t.start_date, due_date: t.due_date, is_milestone: false, project: t.project, initiative: t.initiative ?? null, enquiry: t.enquiry ?? null, design_book: t.design_book ?? null, plan: null,
    planned_hours: t.planned_hours, notes: t.notes,
  })),
];

export type BucketId = 'overdue' | 'this_week' | 'next_week' | 'later' | 'no_date' | 'done';
export const BUCKET_LABELS: Record<BucketId, string> = {
  overdue: 'Overdue', this_week: 'This week', next_week: 'Next week', later: 'Later', no_date: 'No date', done: 'Done recently',
};

const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Puts each item in the first bucket it belongs to: finished → done; due before today → overdue;
 * running or due by Sunday → this week; starting or due by next Sunday → next week; else later.
 */
export function bucketOf(item: Pick<WorkItem, 'status' | 'start_date' | 'due_date'>, today: string): BucketId {
  if (item.status === 'done') return 'done';
  const start = item.start_date ?? item.due_date;
  const due = item.due_date ?? item.start_date;
  if (!start || !due) return 'no_date';
  if (due < today) return 'overdue';
  const endThisWeek = addDays(mondayOf(today), 6);
  if (start <= endThisWeek) return 'this_week';
  if (start <= addDays(endThisWeek, 7)) return 'next_week';
  return 'later';
}

export function groupWork(items: WorkItem[], today: string): Array<{ id: BucketId; items: WorkItem[] }> {
  const order: BucketId[] = ['overdue', 'this_week', 'next_week', 'later', 'no_date', 'done'];
  const byDue = (a: WorkItem, b: WorkItem) =>
    (a.due_date ?? a.start_date ?? '9999').localeCompare(b.due_date ?? b.start_date ?? '9999') || a.title.localeCompare(b.title);
  return order.map(id => ({ id, items: items.filter(i => bucketOf(i, today) === id).sort(byDue) })).filter(g => g.items.length);
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** "Mon, Wed · 1 h" or "40% of time". */
export function describeCommitment(c: Pick<Commitment, 'weekdays' | 'hours_per_day' | 'capacity_pct'>): string {
  if (c.capacity_pct) return `${c.capacity_pct}% of time`;
  const days = (c.weekdays ?? []).map(d => WEEKDAY_SHORT[d]).join(', ');
  return `${days} · ${c.hours_per_day} h`;
}
