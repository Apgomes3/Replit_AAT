// Initiatives (internal work): types, labels and queries (mirrors apps/api/src/modules/initiatives).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export const TYPES = {
  product_development: 'Product development', process_improvement: 'Process improvement', standards_knowledge: 'Standards & knowledge',
  it_tools: 'IT & tools', training: 'Training', facility: 'Facility', sales_marketing: 'Sales & marketing', other: 'Other',
} as const;
export type InitiativeType = keyof typeof TYPES;
export const STAGES = {
  idea: 'Idea', approved: 'Approved', in_progress: 'In progress', on_hold: 'On hold', done: 'Done', dropped: 'Dropped',
} as const;
export type Stage = keyof typeof STAGES;
export const STAGE_TONES: Record<Stage, string> = {
  idea: 'bg-violet-50 text-violet-700', approved: 'bg-sky-50 text-sky-700', in_progress: 'bg-teal-50 text-teal-700',
  on_hold: 'bg-amber-50 text-amber-700', done: 'bg-emerald-50 text-emerald-700', dropped: 'bg-stone-100 text-stone-500',
};
export const COST_CATEGORIES = {
  materials: 'Materials', external_services: 'External services', equipment: 'Equipment', travel: 'Travel',
  software: 'Software', training: 'Training', other: 'Other',
} as const;
export const LINK_TYPES = { product: 'Product', product_family: 'Product family', document: 'Document', project: 'Project', client: 'Company' } as const;
export const CURRENCIES = ['USD', 'AUD', 'CNY', 'NZD', 'EUR', 'GBP', 'SGD', 'CAD', 'JPY', 'TWD', 'AED', 'SAR', 'ZAR'];

export interface Initiative {
  id: string; code: string; title: string; goal: string | null; description: string | null; type: InitiativeType; stage: Stage;
  priority: 'low' | 'medium' | 'high'; owner_user_id: string | null; owner_name: string | null; sponsor_user_id: string | null;
  sponsor_name: string | null; team_id: string | null; team_name: string | null; department: string | null;
  start_date: string | null; target_date: string | null; completed_at: string | null; estimated_hours: number | null;
  budget_amount: number | null; currency: string; outcome: string | null; created_by: string | null;
  logged_hours: number; task_hours: number; task_count: number; tasks_done: number; cost_total: number; cost_unconverted: number;
}
export interface InitiativeDetail extends Initiative {
  events: Array<{ id: string; from_stage: Stage | null; to_stage: Stage; note: string | null; actor_name: string | null; created_at: string }>;
  time_entries: Array<{ id: string; work_date: string; hours: number; note: string | null; user_id: string; user_name: string | null }>;
  hours_by_person: Array<{ user_id: string; user_name: string | null; hours: number }>;
  costs: Array<{ id: string; cost_date: string; category: keyof typeof COST_CATEGORIES; description: string; amount: number; currency: string; supplier_name: string | null }>;
  links: Array<{ id: string; entity_type: keyof typeof LINK_TYPES; entity_id: string; note: string | null; label: string | null; code: string | null }>;
  tasks: Array<{ id: string; title: string; status: string; progress_pct: number; due_date: string | null; planned_hours: number | null; user_id: string; user_name: string | null }>;
  can: { edit: boolean; decide: boolean; log_time: boolean; manage: boolean };
}
export type InitiativeInput = Partial<Pick<Initiative, 'title' | 'goal' | 'description' | 'type' | 'priority' | 'owner_user_id' | 'sponsor_user_id' |
  'team_id' | 'start_date' | 'target_date' | 'estimated_hours' | 'budget_amount' | 'currency' | 'outcome'>> & { stage?: Stage };

const KEY = ['initiatives'] as const;
export const apiError = (err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;

export function useInitiatives(filter: { search?: string; type?: string; mine?: boolean }) {
  return useQuery({
    queryKey: [...KEY, 'list', filter.search ?? '', filter.type ?? '', !!filter.mine],
    queryFn: () => api.get('/initiatives', { params: { search: filter.search || undefined, type: filter.type || undefined, mine: filter.mine ? '1' : undefined } })
      .then(r => r.data.data as Initiative[]),
  });
}
export const useInitiative = (id: string | undefined) => useQuery({
  queryKey: [...KEY, 'detail', id], enabled: !!id,
  queryFn: () => api.get(`/initiatives/${id}`).then(r => r.data as InitiativeDetail),
});
export const usePeople = () => useQuery({
  queryKey: ['people', 'list'], staleTime: 300_000,
  queryFn: () => api.get('/people').then(r => r.data.data as Array<{ id: string; name: string; job_title: string | null }>),
});

function useInitiativeMutation<V>(fn: (v: V) => Promise<any>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['my-work'] }); } });
}
export const useSaveInitiative = () => useInitiativeMutation(({ id, input }: { id?: string; input: InitiativeInput }) =>
  (id ? api.patch(`/initiatives/${id}`, input) : api.post('/initiatives', input)).then(r => r.data as Initiative));
export const useMoveStage = (id: string) => useInitiativeMutation(({ stage, note }: { stage: Stage; note?: string }) => api.post(`/initiatives/${id}/stage`, { stage, note }));
export const useLogTime = (id: string) => useInitiativeMutation((b: { work_date: string; hours: number; note?: string }) => api.post(`/initiatives/${id}/time`, b));
export const useDeleteTime = (id: string) => useInitiativeMutation((entryId: string) => api.delete(`/initiatives/${id}/time/${entryId}`));
export const useAddCost = (id: string) => useInitiativeMutation((b: { description: string; amount: number; currency: string; category: string; cost_date: string; supplier_client_id?: string | null }) =>
  api.post(`/initiatives/${id}/costs`, b));
export const useDeleteCost = (id: string) => useInitiativeMutation((costId: string) => api.delete(`/initiatives/${id}/costs/${costId}`));
export const useAddLink = (id: string) => useInitiativeMutation((b: { entity_type: string; entity_id: string }) => api.post(`/initiatives/${id}/links`, b));
export const useDeleteLink = (id: string) => useInitiativeMutation((linkId: string) => api.delete(`/initiatives/${id}/links/${linkId}`));

/** "1,250" style amount with the currency code. */
export const money = (n: number | null | undefined, currency: string) =>
  n == null ? '—' : `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
export const hours = (n: number | null | undefined) => n == null ? '—' : `${Math.round(n * 10) / 10} h`;

/** The next stages offered from a stage, in the order the buttons appear. */
export const NEXT_STAGES: Record<Stage, Stage[]> = {
  idea: ['approved', 'dropped'], approved: ['in_progress', 'on_hold', 'dropped'], in_progress: ['done', 'on_hold', 'dropped'],
  on_hold: ['in_progress', 'dropped'], done: ['in_progress'], dropped: ['approved'],
};
