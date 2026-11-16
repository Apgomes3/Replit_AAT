// Typed data access for the global planner (mirrors apps/api/src/modules/planning/plansRoutes.ts).
// Any signed-in user can make plans; the board itself reuses the Drafting board (pages/drafting).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import type { Person, Plan, PlanStatus, PlanVisibility, ProjectOption } from '../drafting/draftingApi';

export type PlanLinkFilter = { project_id?: string; design_book_id?: string; enquiry_id?: string; initiative_id?: string; mine?: boolean };

export type PlannerOptions = {
  people: Person[];
  projects: ProjectOption[];
  design_books: Array<{ id: string; code: string; title: string; project_id: string | null }>;
  enquiries: Array<{ id: string; number: string; title: string }>;
  initiatives?: Array<{ id: string; code: string; title: string; stage: string }>;
  teams: Array<{ id: string; name: string; department: string }>;
};

export type GlobalPlanPayload = {
  name: string;
  project_id: string | null;
  design_book_id: string | null;
  enquiry_id: string | null;
  initiative_id: string | null;
  team_id: string | null;
  visibility: PlanVisibility;
  member_ids: string[];
  status: PlanStatus;
  start_date: string | null;
  target_date: string | null;
  description: string | null;
};

const plansKey = ['planner', 'plans'] as const;

export function usePlannerPlans(filter: PlanLinkFilter = {}) {
  const params = new URLSearchParams();
  for (const k of ['project_id', 'design_book_id', 'enquiry_id', 'initiative_id'] as const) if (filter[k]) params.set(k, filter[k]!);
  if (filter.mine) params.set('mine', '1');
  return useQuery({
    queryKey: [...plansKey, params.toString()],
    queryFn: () => api.get(`/planner/plans?${params}`).then(r => r.data.data as Plan[]),
  });
}

export const usePlannerOptions = (enabled = true) => useQuery({
  queryKey: ['planner', 'options'],
  queryFn: () => api.get('/planner/options').then(r => r.data as PlannerOptions),
  enabled,
});

export function useSaveGlobalPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: GlobalPlanPayload }) =>
      (id ? api.patch(`/planner/plans/${id}`, body) : api.post('/planner/plans', body)).then(r => r.data as Plan),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: plansKey });
      qc.invalidateQueries({ queryKey: ['drafting', 'plans'] });
    },
  });
}

/** Editing form values for an existing plan, or a new one with the given links. */
export function planToPayload(p: Plan | null, links: Partial<GlobalPlanPayload> = {}): GlobalPlanPayload {
  if (!p) {
    return {
      name: '', project_id: null, design_book_id: null, enquiry_id: null, initiative_id: null, team_id: null, visibility: 'private',
      member_ids: [], status: 'active', start_date: null, target_date: null, description: null, ...links,
    };
  }
  return {
    name: p.name, project_id: p.project?.id ?? null, design_book_id: p.design_book?.id ?? null, enquiry_id: p.enquiry?.id ?? null,
    initiative_id: p.initiative?.id ?? null,
    team_id: p.team?.id ?? null, visibility: p.visibility, member_ids: p.members.map(m => m.id), status: p.status,
    start_date: p.start_date, target_date: p.target_date, description: p.description,
  };
}

/** Short description of what a plan is linked to. */
export function planLinkLabel(p: Plan): string {
  if (p.design_book) return `Design book ${p.design_book.code}`;
  if (p.enquiry) return `Enquiry ${p.enquiry.number}`;
  if (p.initiative) return `Initiative ${p.initiative.code} · ${p.initiative.title}`;
  if (p.project) return `${p.project.code} · ${p.project.name}`;
  return 'Standalone';
}
