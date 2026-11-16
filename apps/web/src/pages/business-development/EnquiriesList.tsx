import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ClipboardList, Filter, Plus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import ProtectedDraftBar, { clearRecoveryDraft } from '../../components/ui/ProtectedDraftBar';
import { draftCreateKey, persistCreateDraft } from '../../lib/createDraftKey';
import ClientPicker from '../../components/clients/ClientPicker';
import ClientLink from '../../components/clients/ClientLink';

const statuses = ['new', 'in_review', 'quoted', 'won', 'lost', 'closed'];
const pretty = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const list = (data: any) => data?.items || data?.data || data || [];
const EMPTY_ENQUIRY = { title: '', description: '', client_id: '', client_name: '', project_id: '', design_book_id: '', status: 'new', received_date: '', due_date: '', source: '', contact_name: '', contact_email: '', contact_phone: '' };

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
  const storageKey = `enquiry:${user?.id || 'unknown'}:create`;
  const [idempotencyKey, setIdempotencyKey] = useState(() => draftCreateKey(storageKey));
  const enquiriesQ = useQuery({ queryKey: ['enquiries', search, status], queryFn: () => api.get('/enquiries', { params: { search, status, page: 1, page_size: 100 } }).then(r => r.data) });
  const projectsQ = useQuery({ queryKey: ['projects', 'enquiry-form'], queryFn: () => api.get('/projects', { params: { page_size: 200 } }).then(r => r.data), enabled: open && canViewProjects });
  const projectId = form.project_id || '';
  const booksQ = useQuery({ queryKey: ['design-books', 'enquiry-form', projectId], queryFn: () => api.get('/design-books', { params: { page_size: 200, project_id: projectId || undefined } }).then(r => r.data), enabled: open && canViewDesignBooks });
  const projects: any[] = list(projectsQ.data);
  const books: any[] = list(booksQ.data);
  const rows: any[] = list(enquiriesQ.data);

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

  return <div className="p-6 max-w-7xl mx-auto">
    <header className="flex flex-wrap justify-between gap-4 mb-6"><div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Commercial register</div><h1 className="text-2xl font-extrabold mt-2">Enquiries</h1><p className="text-sm text-[#6f8082] mt-1">Every request, scoped and ready for a considered response.</p></div>{canManage && <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#087f73] text-white text-sm font-bold"><Plus className="w-4 h-4" /> New enquiry</button>}</header>
    <div className="flex flex-wrap gap-3 mb-4"><div className="relative w-full max-w-md"><Search className="absolute left-3 top-2.5 w-4 h-4 text-[#8da09d]" /><input value={search} onChange={e => { setSearch(e.target.value); setParams(p => { e.target.value ? p.set('search', e.target.value) : p.delete('search'); return p; }); }} placeholder="Search number, title, client…" className="w-full pl-9 pr-3 py-2 border border-[#dce7e2] rounded-lg bg-white text-sm" /></div><div className="relative"><Filter className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#8da09d]" /><select value={status} onChange={e => { setStatus(e.target.value); setParams(p => { e.target.value ? p.set('status', e.target.value) : p.delete('status'); return p; }); }} className="pl-8 pr-8 py-2 border border-[#dce7e2] rounded-lg bg-white text-sm"><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{pretty(s)}</option>)}</select></div></div>
    <div className="bg-white rounded-xl border border-[#dce7e2] overflow-hidden shadow-sm">{enquiriesQ.isError ? <div className="p-8 text-rose-700 text-sm">Enquiries could not be loaded. <button className="underline font-bold" onClick={() => enquiriesQ.refetch()}>Try again</button></div> : enquiriesQ.isLoading ? <div className="p-5 space-y-3">{[1, 2, 3, 4].map(i => <div className="h-12 skeleton" key={i} />)}</div> : rows.length === 0 ? <div className="p-16 text-center"><ClipboardList className="mx-auto w-9 h-9 text-[#b8d9d0] mb-3" /><p className="font-bold">No enquiries match this view</p></div> : <table className="w-full text-sm"><thead className="bg-[#f2f7f4] border-b border-[#dce7e2]"><tr>{['Enquiry', 'Client', 'Due', 'Status', ''].map(h => <th key={h} className="text-left px-5 py-3 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">{h}</th>)}</tr></thead><tbody>{rows.map(e => <tr key={e.id} className="border-b border-[#edf2ef] last:border-0 hover:bg-[#f4faf7]"><td className="px-5 py-4"><Link to={`/enquiries/${e.id}`} className="font-bold hover:text-[#087f73]">{e.title}</Link><div className="text-xs font-mono text-[#6f8082] mt-1">{e.enquiry_number || `ENQ-${e.id}`}</div></td><td className="px-5 py-4 text-[#53686b]"><ClientLink id={e.client_id} name={e.client?.name || e.client_name} /></td><td className="px-5 py-4 text-[#53686b]">{e.due_date || '—'}</td><td className="px-5 py-4"><span className="px-2 py-1 rounded-md bg-[#e4f2ee] text-[#087f73] text-[10px] uppercase font-extrabold">{pretty(e.status)}</span></td><td className="px-5 py-4 text-right text-[#8da09d]">Open →</td></tr>)}</tbody></table>}</div>
    {open && canManage && <div className="fixed inset-0 z-50 bg-[#20333a]/40 p-4 flex items-center justify-center"><form onSubmit={create} className="bg-white w-full max-w-2xl max-h-[92vh] overflow-auto rounded-2xl shadow-2xl"><div className="p-5 border-b border-[#edf2ef] flex justify-between"><div><h2 className="font-extrabold">New enquiry</h2><p className="text-xs text-[#6f8082] mt-1">Capture the request and its engineering context.</p></div><button type="button" onClick={() => setOpen(false)}><X className="w-5 h-5 text-[#80908f]" /></button></div><ProtectedDraftBar storageKey={storageKey} value={{ ...form, idempotencyKey }} baseline={{ ...EMPTY_ENQUIRY, idempotencyKey }} enabled={open} saving={saving} error={saveError} savedAt={draftSavedAt} onRestore={(draft) => { setForm(draft); setIdempotencyKey(draft.idempotencyKey || crypto.randomUUID()); }} onDiscard={() => setIdempotencyKey(crypto.randomUUID())} onSave={() => create()} /><div className="p-5 grid sm:grid-cols-2 gap-4">{[['title', 'Title'], ['contact_name', 'Contact name'], ['contact_email', 'Contact email'], ['contact_phone', 'Contact phone'], ['received_date', 'Received date'], ['due_date', 'Due date'], ['source', 'Source']].map(([k, l]) => <label key={k} className="text-xs font-bold text-[#53686b]">{l}<input type={k.includes('date') ? 'date' : 'text'} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal" /></label>)}<div className="text-xs font-bold text-[#53686b]">Client<ClientPicker className="mt-1.5" value={form.client_id || null} valueLabel={form.client_name || null} placeholder="Search or add a company…" onChange={c => setForm({ ...form, client_id: c?.id ?? '', client_name: c?.name ?? '' })} /></div>{canViewProjects && <label className="text-xs font-bold text-[#53686b]">Project<select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value, design_book_id: '' })} className="mt-1.5 w-full border rounded-lg px-3 py-2 text-sm font-normal"><option value="">Standalone enquiry</option>{projects.map(p => <option key={p.id} value={p.id}>{p.project_code || p.project_name} — {p.project_name || ''}</option>)}</select></label>}{canViewDesignBooks && <label className="text-xs font-bold text-[#53686b]">Design Book<select value={form.design_book_id} onChange={e => setForm({ ...form, design_book_id: e.target.value })} className="mt-1.5 w-full border rounded-lg px-3 py-2 text-sm font-normal"><option value="">No design book</option>{books.filter(b => !projectId || !b.project_id || b.project_id === projectId).map(b => <option key={b.id} value={b.id}>{b.book_code || b.book_title || b.book_number || b.title}</option>)}</select></label>}<label className="sm:col-span-2 text-xs font-bold text-[#53686b]">Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal" /></label></div><div className="p-5 bg-[#f5f8f6] flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold">{saving ? 'Creating…' : 'Create enquiry'}</button></div></form></div>}
  </div>;
}