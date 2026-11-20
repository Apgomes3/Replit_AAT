import { useQuery, useQueryClient } from '@tanstack/react-query';
import SkeletonTable from '../../components/ui/SkeletonTable';
import EmptyState from '../../components/ui/EmptyState';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import DataTable from '../../components/ui/DataTable';
import { useState } from 'react';
import { ClipboardList, Filter, Plus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import ProtectedDraftBar, { clearRecoveryDraft } from '../../components/ui/ProtectedDraftBar';
import { draftCreateKey, persistCreateDraft } from '../../lib/createDraftKey';
import ClientPicker from '../../components/clients/ClientPicker';
import ClientLink from '../../components/clients/ClientLink';
import ClientPersonSelect from '../../components/clients/ClientPersonSelect';
import { Stage, STAGE_LABELS, STAGES } from './bidsApi';
import { usePeople } from '../initiatives/initiativesApi';

const statuses: Stage[] = [...STAGES];
const pretty = (s: string) => STAGE_LABELS[s as Stage] ?? (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const list = (data: any) => data?.items || data?.data || data || [];
const EMPTY_ENQUIRY = { title: '', description: '', enquiry_type: 'direct', client_id: '', client_name: '', contact_id: '', project_id: '', design_book_id: '', status: 'new', received_date: '', due_date: '', source: '', bid_owner_user_id: '' };

export default function EnquiriesList() {
  const user = useAuthStore(s => s.user);
  const canManage = user?.role === 'admin' || user?.moduleAccess?.business_development === 'manage';
  const canViewProjects = user?.role === 'admin' || user?.moduleAccess?.projects === 'view' || user?.moduleAccess?.projects === 'manage';
  const canViewDesignBooks = user?.role === 'admin' || user?.moduleAccess?.design_books === 'view' || user?.moduleAccess?.design_books === 'manage';
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_ENQUIRY });
  const people = usePeople();
  const ownerId = form.bid_owner_user_id || user?.id || '';
  const storageKey = `enquiry:${user?.id || 'unknown'}:create`;
  const [idempotencyKey, setIdempotencyKey] = useState(() => draftCreateKey(storageKey));
  const enquiriesQ = useQuery({ queryKey: ['enquiries', search, status], queryFn: () => api.get('/enquiries', { params: { search, status, page: 1, page_size: 100 } }).then(r => r.data) });
  const projectsQ = useQuery({ queryKey: ['projects', 'enquiry-form'], queryFn: () => api.get('/projects', { params: { page_size: 200 } }).then(r => r.data), enabled: open && canViewProjects });
  const projectId = form.project_id || '';
  const booksQ = useQuery({ queryKey: ['design-books', 'enquiry-form', projectId], queryFn: () => api.get('/design-books', { params: { page_size: 200, project_id: projectId || undefined } }).then(r => r.data), enabled: open && canViewDesignBooks });
  const projects: any[] = list(projectsQ.data);
  const books: any[] = list(booksQ.data);
  const rows: any[] = list(enquiriesQ.data);
  const navigate = useNavigate();

  const create = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canManage) return toast.error('You do not have permission to create enquiries');
    if (!form.title.trim() || !form.client_id) return toast.error('Title and client are required');
    setSaveError(null);
    setSaving(true);
    try {
      const body: any = { ...form };
      delete body.idempotencyKey;
      delete body.client_name;
      if (!body.contact_id) delete body.contact_id;
      body.bid_owner_user_id = ownerId || undefined;
      if (form.received_date) body.received_date = form.received_date;
      else delete body.received_date;
      if (form.due_date) body.due_date = form.due_date;
      else delete body.due_date;
      if (!canViewProjects) delete body.project_id;
      else if (!body.project_id) delete body.project_id;
      if (!canViewDesignBooks) delete body.design_book_id;
      else if (!body.design_book_id) delete body.design_book_id;
      body.idempotency_key = idempotencyKey;
      persistCreateDraft(storageKey, { ...form, idempotencyKey });
      const r = await api.post('/enquiries', body);
      toast.success('Enquiry created');
      setDraftSavedAt(Date.now());
      clearRecoveryDraft(storageKey);
      setOpen(false);
      setForm({ ...EMPTY_ENQUIRY });
      setIdempotencyKey(crypto.randomUUID());
      qc.invalidateQueries({ queryKey: ['enquiries'] });
      window.location.href = `/enquiries/${r.data.id}`;
    } catch (err: any) {
      setSaveError(err);
      toast.error(err?.response?.data?.error?.message || 'Could not create enquiry');
    } finally {
      setSaving(false);
    }
  };

  return <div>
    <PageHeader
      crumbs={[{ label: 'Business Development', href: '/business-development' }, { label: 'Enquiries' }]}
      title="Enquiries"
      subtitle="Every request, scoped and ready for a considered response."
      actions={canManage && <Button variant="primary" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> New enquiry</Button>}
    />
    <div className="p-6">
    
    <div className="flex flex-wrap gap-3 mb-4"><div className="relative w-full max-w-md"><Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" /><input value={search} onChange={e => { setSearch(e.target.value); setParams(p => { e.target.value ? p.set('search', e.target.value) : p.delete('search'); return p; }); }} placeholder="Search number, title, client…" className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-lg bg-white text-sm" /></div><div className="relative"><Filter className="absolute left-3 top-2.5 w-3.5 h-3.5 text-stone-400" /><select value={status} onChange={e => { setStatus(e.target.value); setParams(p => { e.target.value ? p.set('status', e.target.value) : p.delete('status'); return p; }); }} className="pl-8 pr-8 py-2 border border-stone-200 rounded-lg bg-white text-sm"><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{pretty(s)}</option>)}</select></div></div>
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">{enquiriesQ.isError ? <div className="p-8 text-rose-700 text-sm">Enquiries could not be loaded. <button className="underline font-bold" onClick={() => enquiriesQ.refetch()}>Try again</button></div> : enquiriesQ.isLoading ? <SkeletonTable rows={6} columns={4} /> : rows.length === 0 ? <EmptyState icon={ClipboardList} title="No enquiries match this view" description="Change the search or status filter, or log a new enquiry." /> : <DataTable<any> tableId="enquiries" data={rows} onRowClick={e => navigate(`/enquiries/${e.id}`)} columns={[
      { key: 'title', header: 'Enquiry', className: 'min-w-[16rem]', filterValue: e => `${e.title} ${e.enquiry_number || ''}`, render: e => <><Link to={`/enquiries/${e.id}`} onClick={ev => ev.stopPropagation()} className="font-semibold text-stone-800 hover:text-blue-600">{e.title}</Link>{e.enquiry_type === 'tender' && <span className="ml-2 px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] uppercase font-bold align-middle">Tender</span>}<div className="text-xs font-mono text-stone-500 mt-1 whitespace-nowrap">{e.enquiry_number || `ENQ-${e.id}`}</div></> },
      { key: 'client', header: 'Client', sortValue: e => e.client?.name || e.client_name || '', render: e => <span onClick={ev => ev.stopPropagation()}><ClientLink id={e.client_id} name={e.client?.name || e.client_name} /></span> },
      { key: 'due_date', header: 'Due', className: 'whitespace-nowrap tabular-nums', render: e => e.due_date || '—' },
      { key: 'status', header: 'Status', render: e => <span className="whitespace-nowrap px-2 py-1 rounded-md bg-blue-50 text-blue-600 text-[10px] uppercase font-bold">{pretty(e.status)}</span> },
    ]} />}</div>
    {open && canManage && <div className="fixed inset-0 z-50 bg-stone-800/40 p-4 flex items-center justify-center"><form onSubmit={create} className="bg-white w-full max-w-2xl max-h-[92vh] overflow-auto rounded-2xl shadow-2xl"><div className="p-5 border-b border-stone-100 flex justify-between"><div><h2 className="font-extrabold">New enquiry</h2><p className="text-xs text-stone-500 mt-1">Capture the request and its engineering context.</p></div><button type="button" onClick={() => setOpen(false)}><X className="w-5 h-5 text-stone-400" /></button></div><ProtectedDraftBar storageKey={storageKey} value={{ ...form, idempotencyKey }} baseline={{ ...EMPTY_ENQUIRY, idempotencyKey }} enabled={open} saving={saving} error={saveError} savedAt={draftSavedAt} onRestore={(draft) => { setForm(draft); setIdempotencyKey(draft.idempotencyKey || crypto.randomUUID()); }} onDiscard={() => setIdempotencyKey(crypto.randomUUID())} onSave={() => create()} /><div className="p-5 grid sm:grid-cols-2 gap-4">{[['title', 'Title'], ['received_date', 'Received date'], ['due_date', 'Due date (submission)'], ['source', 'Source']].map(([k, l]) => <label key={k} className="text-xs font-bold text-stone-600">{l}<input type={k.includes('date') ? 'date' : 'text'} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} className="mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal" /></label>)}<label className="text-xs font-bold text-stone-600">Type<select value={form.enquiry_type} onChange={e => setForm({ ...form, enquiry_type: e.target.value })} className="mt-1.5 w-full border rounded-lg px-3 py-2 text-sm font-normal"><option value="direct">Direct request</option><option value="tender">Tender / bid</option></select></label><div className="text-xs font-bold text-stone-600">Client<ClientPicker className="mt-1.5" value={form.client_id || null} valueLabel={form.client_name || null} placeholder="Search or add a company…" onChange={c => setForm({ ...form, client_id: c?.id ?? '', client_name: c?.name ?? '', contact_id: '' })} /></div>{form.client_id && <ClientPersonSelect allowAdd clientId={form.client_id} value={form.contact_id} onChange={p => setForm((f: any) => ({ ...f, contact_id: p?.id ?? '' }))} />}<label className="text-xs font-bold text-stone-600">AAT owner<select value={ownerId} onChange={e => setForm({ ...form, bid_owner_user_id: e.target.value })} className="mt-1.5 w-full border rounded-lg px-3 py-2 text-sm font-normal bg-white">{!(people.data ?? []).some(p => p.id === ownerId) && <option value={ownerId}>Me</option>}{(people.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}{p.id === user?.id ? ' (me)' : ''}{p.job_title ? ` — ${p.job_title}` : ''}</option>)}</select><span className="block mt-1 font-normal text-[11px] text-stone-400">Responsible at AAT. Add the rest of the team on the enquiry page.</span></label>{canViewProjects && <label className="text-xs font-bold text-stone-600">Project<select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value, design_book_id: '' })} className="mt-1.5 w-full border rounded-lg px-3 py-2 text-sm font-normal"><option value="">Standalone enquiry</option>{projects.map(p => <option key={p.id} value={p.id}>{p.project_code || p.project_name} — {p.project_name || ''}</option>)}</select></label>}{canViewDesignBooks && <label className="text-xs font-bold text-stone-600">Design Book<select value={form.design_book_id} onChange={e => setForm({ ...form, design_book_id: e.target.value })} className="mt-1.5 w-full border rounded-lg px-3 py-2 text-sm font-normal"><option value="">No design book</option>{books.filter(b => !projectId || !b.project_id || b.project_id === projectId).map(b => <option key={b.id} value={b.id}>{b.book_code || b.book_title || b.book_number || b.title}</option>)}</select></label>}<label className="sm:col-span-2 text-xs font-bold text-stone-600">Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} className="mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal" /></label></div><div className="p-5 bg-stone-50 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold">{saving ? 'Creating…' : 'Create enquiry'}</button></div></form></div>}
    </div>
  </div>;
}