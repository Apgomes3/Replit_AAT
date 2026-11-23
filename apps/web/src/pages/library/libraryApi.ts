// Typed access to the Knowledge Library API (/api/v1/library). Mirrors apps/api/src/modules/library.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export type ArticleKind = 'howto' | 'procedure' | 'lesson' | 'faq' | 'reference';
export const KINDS: Array<{ value: ArticleKind; label: string; hint: string }> = [
  { value: 'howto', label: 'How-to', hint: 'Steps to get something done' },
  { value: 'procedure', label: 'Procedure', hint: 'The approved way to do it; the pool owner approves each version' },
  { value: 'lesson', label: 'Lesson learned', hint: 'What happened, what we learned, what to do next time' },
  { value: 'faq', label: 'FAQ', hint: 'A question and its answer' },
  { value: 'reference', label: 'Reference', hint: 'Facts, tables and data to look up' },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.value, k.label])) as Record<ArticleKind, string>;
export const KIND_TONE: Record<ArticleKind, string> = {
  howto: 'bg-sky-50 text-sky-800', procedure: 'bg-violet-50 text-violet-800', lesson: 'bg-amber-50 text-amber-800',
  faq: 'bg-emerald-50 text-emerald-800', reference: 'bg-stone-100 text-stone-700',
};

export type PoolRights = { read: boolean; write: boolean; approve: boolean; members: boolean; settings: boolean };
export type Pool = {
  id: string; slug: string; name: string; description: string | null; icon: string; restricted: boolean;
  owner_user_id: string | null; owner_name: string | null; archived_at: string | null; rights: PoolRights;
  counts?: { published: number; drafts: number; in_review: number; overdue_review: number; last_update: string | null };
  structured?: { materials: number; specifications: number; design_rules: number; calculation_templates: number } | null;
};
export type PoolMember = { id: string; role: 'editor' | 'reader'; user_id: string | null; team_id: string | null; user_name: string | null; job_title: string | null; team_name: string | null };
export type PoolDetail = Pool & { members: PoolMember[]; categories: Array<{ category: string; count: number }> };

export type ArticleSummary = {
  id: string; code: string; pool_id: string; pool_slug: string; pool_name: string; pool_restricted: boolean;
  kind: ArticleKind; category: string | null; tags: string[]; status: 'draft' | 'published' | 'archived'; in_review: boolean;
  review_by: string | null; owner_name: string | null; title: string; summary: string | null; excerpt: string | null;
  updated_at: string; has_unpublished_changes: boolean;
};
export type Revision = { id: string; rev_no: number; title: string; summary: string | null; body_html: string; note: string | null; created_at: string; created_by_name: string | null };
export type ArticleLink = { entity_type: LinkType; entity_id: string; label: string };
export type LinkType = 'project' | 'initiative' | 'product' | 'client' | 'enquiry' | 'design_book';
export type Article = {
  id: string; code: string; pool_id: string; kind: ArticleKind; kind_label: string; category: string | null; tags: string[];
  status: 'draft' | 'published' | 'archived'; in_review: boolean; review_note: string | null; review_by: string | null;
  owner_user_id: string | null; owner_name: string | null; latest_revision_id: string; published_revision_id: string | null;
  published_at: string | null; updated_at: string; has_unpublished_changes: boolean;
  pool: { id: string; slug: string; name: string; restricted: boolean; owner_name: string | null };
  rights: { write: boolean; approve: boolean };
  revision: Revision;
  links: ArticleLink[];
  files: Array<{ id: string; file_name: string; mime_type: string | null; size_bytes: number; created_at: string; uploaded_by_name: string | null }>;
  revisions: Array<{ id: string; rev_no: number; title: string; note: string | null; created_at: string; created_by_name: string | null }>;
  events: Array<{ action: string; note: string | null; created_at: string; actor_name: string | null }>;
};
export type Overview = {
  awaiting_approval: Array<ArticleSummary & { submitted_by: string | null }>;
  due_for_review: ArticleSummary[];
  recent: ArticleSummary[];
};
export type ArticleFilter = { pool?: string; q?: string; kind?: string; category?: string; tag?: string; status?: string; due?: boolean; mine?: boolean };
export type ArticleInput = {
  pool?: string; title?: string; summary?: string | null; body_html?: string; kind?: ArticleKind; category?: string | null;
  tags?: string[]; review_by?: string | null; owner_user_id?: string | null; publish?: boolean; note?: string | null;
};

const KEY = ['library'] as const;
export const apiError = (err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;

export const usePools = () => useQuery({ queryKey: [...KEY, 'pools'], queryFn: () => api.get('/library/pools').then(r => r.data.data as Pool[]) });
export const usePool = (slug: string | undefined) => useQuery({
  queryKey: [...KEY, 'pool', slug], enabled: !!slug, retry: false,
  queryFn: () => api.get(`/library/pools/${slug}`).then(r => r.data as PoolDetail),
});
export const useOverview = () => useQuery({ queryKey: [...KEY, 'overview'], queryFn: () => api.get('/library/overview').then(r => r.data as Overview) });
export const useArticles = (f: ArticleFilter, enabled = true) => useQuery({
  queryKey: [...KEY, 'articles', f], enabled,
  queryFn: () => api.get('/library/articles', { params: { ...f, due: f.due ? 1 : undefined, mine: f.mine ? 1 : undefined } }).then(r => r.data.data as ArticleSummary[]),
});
export const useArticle = (id: string | undefined) => useQuery({
  queryKey: [...KEY, 'article', id], enabled: !!id, retry: false,
  queryFn: () => api.get(`/library/articles/${id}`).then(r => r.data as Article),
});
export const useRevision = (articleId: string, revId: string | null) => useQuery({
  queryKey: [...KEY, 'revision', articleId, revId], enabled: !!revId,
  queryFn: () => api.get(`/library/articles/${articleId}/revisions/${revId}`).then(r => r.data as Revision),
});
export const useLinkedArticles = (type: LinkType, id: string | undefined) => useQuery({
  queryKey: [...KEY, 'linked', type, id], enabled: !!id, retry: false,
  queryFn: () => api.get('/library/linked', { params: { entity_type: type, entity_id: id } }).then(r => r.data.data as ArticleSummary[]),
});

function useLibraryMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useCreateArticle = () => useLibraryMutation((body: ArticleInput) =>
  api.post('/library/articles', body).then(r => r.data as { id: string; code: string; outcome: 'draft' | 'publish' | 'review' }));
export const useSaveArticle = (id: string) => useLibraryMutation((body: ArticleInput) =>
  api.put(`/library/articles/${id}`, body).then(r => r.data as { id: string; outcome: 'saved' | 'draft' | 'publish' | 'review' }));
export const useArticleAction = (id: string) => useLibraryMutation(({ action, note }: { action: 'approve' | 'send-back' | 'archive' | 'restore'; note?: string }) =>
  api.post(`/library/articles/${id}/${action}`, { note }));
export const useDeleteArticle = () => useLibraryMutation((id: string) => api.delete(`/library/articles/${id}`));
export const useSaveLinks = (id: string) => useLibraryMutation((links: Array<{ entity_type: LinkType; entity_id: string }>) =>
  api.put(`/library/articles/${id}/links`, { links }));
export const useUploadFile = (id: string) => useLibraryMutation((file: File) => {
  const form = new FormData(); form.append('file', file);
  return api.post(`/library/articles/${id}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
});
export const useDeleteFile = () => useLibraryMutation((fileId: string) => api.delete(`/library/files/${fileId}`));
export const useSavePool = (slug: string) => useLibraryMutation((body: Partial<{ name: string; description: string | null; restricted: boolean; owner_user_id: string | null; archived: boolean }>) =>
  api.patch(`/library/pools/${slug}`, body));
export const useSaveMembers = (slug: string) => useLibraryMutation((body: { editors?: Array<{ user_id?: string; team_id?: string }>; readers?: Array<{ user_id?: string; team_id?: string }> }) =>
  api.put(`/library/pools/${slug}/members`, body));
export const useCreatePool = () => useLibraryMutation((body: { name: string; description?: string; restricted?: boolean }) =>
  api.post('/library/pools', body).then(r => r.data as Pool));

/** Downloads an attachment with the signed-in session (a plain link would not carry it). */
export async function downloadFile(fileId: string, name: string) {
  const r = await api.get(`/library/files/${fileId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const fmtDate = (iso: string | null | undefined) => iso
  ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const reviewState = (reviewBy: string | null): 'overdue' | 'soon' | null => {
  if (!reviewBy) return null;
  const today = new Date().toLocaleDateString('en-CA');
  const soon = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA');
  return reviewBy < today ? 'overdue' : reviewBy <= soon ? 'soon' : null;
};
