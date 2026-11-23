// Client directory: types, queries and helpers shared by the Clients pages, the client picker and
// every page that shows a client.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

export const CLIENT_KINDS = ['client', 'consultant', 'contractor', 'partner', 'supplier'] as const;
export type ClientKind = typeof CLIENT_KINDS[number];
export const KIND_LABELS: Record<ClientKind, string> = {
  client: 'Client', consultant: 'Consultant', contractor: 'Contractor', partner: 'Partner', supplier: 'Supplier',
};

export interface Company {
  id: string;
  client_code: string;
  name: string;
  legal_name: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  address: string;
  notes: string | null;
  kinds: ClientKind[];
  parent_client_id: string | null;
  parent_name?: string | null;
  active: boolean;
  /** Company logo (/uploads/...); its projects show it unless they have their own. */
  logo_url?: string | null;
  contact_count?: number;
  enquiry_count?: number;
  project_count?: number;
  primary_contact_id?: string | null;
  primary_contact_name?: string | null;
  primary_contact_email?: string | null;
  primary_contact_phone?: string | null;
}

export interface Contact {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  job_title: string | null;
  notes: string | null;
  is_primary: boolean;
  left_on: string | null;
}

export interface CompanyDetail extends Company {
  contacts: Contact[];
  children: Array<Pick<Company, 'id' | 'name' | 'client_code' | 'kinds' | 'country' | 'city' | 'active'>>;
  enquiries: Array<{ id: string; enquiry_number: string; title: string; status: string; received_date: string | null; due_date: string | null; project_code: string | null }>;
  projects: Array<{ id: string; project_code: string; project_name: string; project_status: string | null; country: string | null; city: string | null; project_manager: string | null; target_completion_date: string | null }>;
  design_books: Array<{ id: string; book_code: string; book_title: string | null; status: string | null; revision: string | null; project_code: string }>;
  involvements: Array<{ id: string; role: string; contact_id: string | null; contact_name: string | null; project_id: string; project_code: string; project_name: string; client_name: string | null }>;
}

export interface CompanyFilter { search?: string; kind?: ClientKind | ''; status?: 'all' | 'active' | 'inactive'; pageSize?: number }

/** Server rule: a missing access row means manage, so only an explicit view/hidden takes it away. */
export function useCanManageClients(): boolean {
  const user = useAuthStore(s => s.user);
  if (!user) return false;
  if (user.role === 'admin') return true;
  return ((user as any).moduleAccess?.clients ?? 'manage') === 'manage';
}

export function useCompanies(filter: CompanyFilter, enabled = true) {
  return useQuery({
    queryKey: ['clients', 'list', filter.search ?? '', filter.kind ?? '', filter.status ?? 'all', filter.pageSize ?? 200],
    queryFn: () => api.get('/clients', {
      params: { search: filter.search || undefined, kind: filter.kind || undefined, status: filter.status ?? 'all', page_size: filter.pageSize ?? 200 },
    }).then(r => r.data as { data: Company[]; pagination: { total: number } }),
    enabled,
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['clients', 'detail', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data as CompanyDetail),
    enabled: !!id,
  });
}

/** Companies that look like `name` (for "did you mean…?" while typing). */
export function useSimilarCompanies(name: string, exceptId?: string) {
  const trimmed = name.trim();
  return useQuery({
    queryKey: ['clients', 'similar', trimmed.toLowerCase(), exceptId ?? ''],
    queryFn: () => api.get('/clients/similar', { params: { name: trimmed, except: exceptId } }).then(r => r.data.data as Company[]),
    enabled: trimmed.length >= 3,
    staleTime: 30_000,
  });
}

export type CompanyInput = Partial<Pick<Company, 'name' | 'legal_name' | 'website' | 'country' | 'city' | 'address' | 'notes' | 'kinds' | 'parent_client_id' | 'active'>> & { allow_duplicate?: boolean };

export function useSaveCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CompanyInput }) =>
      (id ? api.patch(`/clients/${id}`, input) : api.post('/clients', input)).then(r => r.data as Company),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

/** Sets (a file) or removes (null) a company's logo. Projects of the company show it too, so they refresh. */
export function useCompanyLogo(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File | null) => {
      if (!file) return api.delete(`/clients/${clientId}/logo`).then(r => r.data as Company);
      const fd = new FormData();
      fd.append('logo', file);
      return api.post(`/clients/${clientId}/logo`, fd, { headers: { 'Content-Type': undefined } }).then(r => r.data as Company);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ predicate: q => q.queryKey.some(k => typeof k === 'string' && k.startsWith('project')) });
    },
  });
}

export type ContactInput =Partial<Pick<Contact, 'name' | 'email' | 'phone' | 'mobile' | 'job_title' | 'notes' | 'is_primary'>> & { left?: boolean };

export function useContactActions(clientId: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['clients'] });
  const save = useMutation({
    mutationFn: ({ contactId, input }: { contactId?: string; input: ContactInput }) =>
      (contactId ? api.patch(`/clients/${clientId}/contacts/${contactId}`, input) : api.post(`/clients/${clientId}/contacts`, input)).then(r => r.data as Contact),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (contactId: string) => api.delete(`/clients/${clientId}/contacts/${contactId}`),
    onSuccess: done,
  });
  return { save, remove };
}

export interface ProjectParty {
  id: string;
  project_id: string;
  client_id: string;
  client_name: string;
  client_code: string;
  kinds: ClientKind[];
  contact_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  left_on: string | null;
  role: string;
  notes: string | null;
}

export function useProjectParties(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-parties', projectId],
    queryFn: () => api.get(`/projects/${projectId}/parties`).then(r => r.data as { data: ProjectParty[]; company_roles: string[]; person_roles: string[] }),
    enabled: !!projectId,
  });
}

export function useProjectPartyActions(projectId: string) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ['project-parties', projectId] }); qc.invalidateQueries({ queryKey: ['clients'] }); };
  const add = useMutation({
    mutationFn: (input: { client_id: string; contact_id?: string | null; role: string; notes?: string }) =>
      api.post(`/projects/${projectId}/parties`, input).then(r => r.data as ProjectParty),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (partyId: string) => api.delete(`/projects/${projectId}/parties/${partyId}`),
    onSuccess: done,
  });
  return { add, remove };
}

/** Projects or Clients & contacts "manage" lets someone change who is on a project. */
export function useCanManageProjectParties(): boolean {
  const user = useAuthStore(s => s.user);
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = (user as any).moduleAccess ?? {};
  return (access.projects ?? 'manage') === 'manage' || (access.clients ?? 'manage') === 'manage';
}

export const apiError =(err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;

/** "Brisbane, Australia" style location. */
export const placeOf = (c: Pick<Company, 'city' | 'country'>) => [c.city, c.country].filter(Boolean).join(', ');

/** Best way to reach a person, for one-line display. */
export const reachOf = (p: Pick<Contact, 'email' | 'phone' | 'mobile'>) => [p.email, p.phone, p.mobile].filter(Boolean).join(' · ');
