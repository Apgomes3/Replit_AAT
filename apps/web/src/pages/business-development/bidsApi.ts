// Bids (the tender side of enquiries): labels and queries, mirroring apps/api/src/modules/bids.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export const STAGES = ['new', 'qualifying', 'bidding', 'submitted', 'won', 'lost', 'closed'] as const;
export type Stage = typeof STAGES[number];
export const OPEN_STAGES: Stage[] = ['new', 'qualifying', 'bidding', 'submitted'];
export const STAGE_LABELS: Record<Stage, string> = {
  new: 'New', qualifying: 'Qualifying', bidding: 'Preparing bid', submitted: 'Submitted', won: 'Won', lost: 'Lost', closed: 'Closed',
};
export const STAGE_TONES: Record<Stage, string> = {
  new: 'bg-stone-100 text-stone-600', qualifying: 'bg-violet-50 text-violet-700', bidding: 'bg-sky-50 text-sky-700',
  submitted: 'bg-amber-50 text-amber-800', won: 'bg-emerald-50 text-emerald-700', lost: 'bg-rose-50 text-rose-700', closed: 'bg-stone-100 text-stone-500',
};
export const OUTCOME_REASONS = {
  price: 'Price', technical: 'Technical', delivery_time: 'Delivery time', relationship: 'Relationship', scope_changed: 'Scope changed',
  client_cancelled: 'Client cancelled', no_decision: 'No decision', no_bid: 'We did not bid', other: 'Other',
} as const;
export type OutcomeReason = keyof typeof OUTCOME_REASONS;
export const CURRENCIES = ['USD', 'AUD', 'CNY', 'NZD', 'EUR', 'GBP', 'SGD', 'CAD', 'JPY', 'TWD', 'AED', 'SAR', 'ZAR'];

export interface BidDetails {
  id: string; status: Stage; enquiry_type: 'direct' | 'tender';
  estimated_value: number | null; value_currency: string; win_probability: number | null; probability: number;
  bid_decision: 'pending' | 'bid' | 'no_bid'; bid_decided_at: string | null; bid_decision_note: string | null;
  bid_decided_by: { id: string; name: string } | null; owner: { id: string; name: string; job_title: string | null } | null;
  team: Array<{ user_id: string; name: string; job_title: string | null; role: string | null }>;
  submitted_on: string | null; outcome_reason: OutcomeReason | null; outcome_note: string | null;
}
export interface PipelineRow {
  id: string; enquiry_number: string; title: string; status: Stage; enquiry_type: 'direct' | 'tender'; bid_decision: string;
  estimated_value: number | null; value_currency: string; value_usd: number | null; probability: number;
  due_date: string | null; client_id: string; client_name: string; bid_owner_user_id: string | null; owner_name: string | null;
  outcome_reason: OutcomeReason | null; project_id: string | null; team_size: number;
}
export interface Pipeline { data: PipelineRow[]; summary: Array<{ stage: Stage; count: number; value_usd: number; weighted_usd: number; unvalued: number }> }

export const apiError = (err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;
export const money = (n: number | null | undefined, currency = 'USD') =>
  n == null ? '—' : `${currency} ${n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : Math.round(n)}`;

export const useBid = (id: string | undefined) => useQuery({
  queryKey: ['bids', 'detail', id], enabled: !!id,
  queryFn: () => api.get(`/bids/${id}`).then(r => r.data as BidDetails),
});
export const usePipeline = (mine: boolean) => useQuery({
  queryKey: ['bids', 'pipeline', mine],
  queryFn: () => api.get('/bids/pipeline', { params: { mine: mine ? '1' : undefined } }).then(r => r.data as Pipeline),
});

function useBidMutation<V>(id: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bids'] });
      qc.invalidateQueries({ queryKey: ['enquiry', id] });
      qc.invalidateQueries({ queryKey: ['enquiries'] });
    },
  });
}
export const useSaveBid = (id: string) => useBidMutation(id, (b: Partial<Pick<BidDetails, 'enquiry_type' | 'estimated_value' | 'value_currency' | 'win_probability'>> & { bid_owner_user_id?: string | null }) =>
  api.patch(`/bids/${id}`, b));
export const useDecide = (id: string) => useBidMutation(id, (b: { decision: 'bid' | 'no_bid' | 'pending'; note?: string }) => api.post(`/bids/${id}/decision`, b));
export const useMoveStage = (id: string) => useBidMutation(id, (b: { stage: Stage; reason?: string | null; note?: string }) => api.post(`/bids/${id}/stage`, b));
export const useSaveTeam = (id: string) => useBidMutation(id, (members: Array<{ user_id: string; role?: string | null }>) => api.put(`/bids/${id}/team`, { members }));
