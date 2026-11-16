import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, ClipboardList, ExternalLink, FolderPlus, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import ProtectedDraftBar, { readRecoveryDraft } from '../../components/ui/ProtectedDraftBar';
import FollowRecordButton from '../../components/ui/FollowRecordButton';
import EnquiryQuoteWorkspace from './EnquiryQuoteWorkspace';
import ClientLink from '../../components/clients/ClientLink';

const pretty = (s: string) => s?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';
const list = (data: any) => data?.items || data?.data || data || [];
function Link(props: any) {
  const user = useAuthStore(s => s.user);
  const canViewProjects = user?.role === 'admin' || user?.moduleAccess?.projects === 'view' || user?.moduleAccess?.projects === 'manage';
  const canViewDesignBooks = user?.role === 'admin' || user?.moduleAccess?.design_books === 'view' || user?.moduleAccess?.design_books === 'manage';
  const isProject = String(props.to || '').startsWith('/projects/');
  const isDesignBook = String(props.to || '').startsWith('/design-books/');
  if ((isProject && !canViewProjects) || (isDesignBook && !canViewDesignBooks)) {
    return <span className={props.className}>{isProject ? 'Project unavailable' : 'Design Book unavailable'}</span>;
  }
  return <RouterLink {...props} />;
}
export default function EnquiryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const canManage = user?.role === 'admin' || user?.moduleAccess?.business_development === 'manage';
  const canCreateProject = user?.role === 'admin' || (user?.moduleAccess?.business_development === 'manage' && user?.moduleAccess?.projects === 'manage');
  const canImportEquipmentAccess = user?.role === 'admin' || (user?.moduleAccess?.business_development === 'manage' && (user?.moduleAccess?.design_books === 'view' || user?.moduleAccess?.design_books === 'manage'));
  const canViewProjects = user?.role === 'admin' || user?.moduleAccess?.projects === 'view' || user?.moduleAccess?.projects === 'manage';
  const canViewDesignBooks = user?.role === 'admin' || user?.moduleAccess?.design_books === 'view' || user?.moduleAccess?.design_books === 'manage';
  const [tab, setTab] = useState<'info' | 'quote'>('info');
  const [editing, setEditing] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [editBaseline, setEditBaseline] = useState<any>(null);
  const [editVersion, setEditVersion] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<any>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [projectForm, setProjectForm] = useState<any>({
    project_code: '',
    project_name: '',
    site_name: '',
    country: '',
    city: '',
    notes: '',
  });
  const enquiry = useQuery({
    queryKey: ['enquiry', id],
    queryFn: () => api.get(`/enquiries/${id}`).then(r => r.data),
    enabled: !!id,
  });
  const d: any = enquiry.data;
  const projects = useQuery({
    queryKey: ['projects', 'enquiry-selector'],
    queryFn: () => api.get('/projects', { params: { page_size: 200 } }).then(r => r.data),
    enabled: (editing || projectOpen) && canViewProjects,
  });
  const selectedProjectId = form?.project_id || d?.project_id || d?.project?.id;
  const books = useQuery({
    queryKey: ['design-books', 'enquiry-selector', selectedProjectId],
    queryFn: () => api.get('/design-books', {
      params: { page_size: 200, project_id: selectedProjectId || undefined },
    }).then(r => r.data),
    enabled: (editing || projectOpen) && canViewDesignBooks,
  });
  if (enquiry.isLoading) return <div className="p-6 space-y-4"><div className="h-8 w-72 skeleton" /><div className="h-36 skeleton" /><div className="h-72 skeleton" /></div>;
  if (enquiry.isError || !d) return <div className="p-8 text-sm text-rose-700">Enquiry could not be loaded. <button onClick={() => enquiry.refetch()} className="underline font-bold">Try again</button></div>;
  const projectLabel = canViewProjects ? d.project?.project_name || d.project_name || d.project?.project_code || d.project_code || 'Not linked' : 'Project unavailable';
  const designBookLabel = canViewDesignBooks ? d.design_book_code || d.design_book?.book_code || d.design_book?.book_title || d.design_book?.title || 'Not linked' : 'Design Book unavailable';
  const enquiryFormFromData = (data: any) => ({ ...data, status: data.status || 'new', project_id: data.project_id || data.project?.id || null, design_book_id: data.design_book_id || data.design_book?.id || null });
  const beginEdit = () => {
    const baseline = enquiryFormFromData(d);
    setForm(baseline);
    setEditBaseline(baseline);
    const pending = readRecoveryDraft(`enquiry:${user?.id || 'unknown'}:${id}:edit`);
    // A recovered draft must keep its original revision, not the newly fetched
    // record's token. Even the form's own Save button then receives a 409.
    setEditVersion(pending ? pending.version ?? null :
      d.version == null && d.updated_at == null ? null : String(d.version ?? d.updated_at));
    setConflictError(null);
    setEditing(true);
  };
  const reloadConflict = async () => {
    const response = await api.get(`/enquiries/${id}`);
    const latest = response.data;
    const latestForm = enquiryFormFromData(latest);
    qc.setQueryData(['enquiry', id], latest);
    setForm(latestForm);
    setEditBaseline(latestForm);
    setEditVersion(latest.version == null && latest.updated_at == null ? null : String(latest.version ?? latest.updated_at));
    setConflictError(null);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setConflictError(null);
    try {
      const body: any = { ...form, expected_version: editVersion };
      if (canViewProjects) body.project_id = form.project_id || null; else delete body.project_id;
      if (canViewDesignBooks) body.design_book_id = form.design_book_id || null; else delete body.design_book_id;
      await api.patch(`/enquiries/${id}`, body);
      toast.success('Enquiry updated');
      setDraftSavedAt(Date.now());
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['enquiry', id] });
    } catch (err: any) {
      const response = err?.response;
      if (response?.status === 409) {
        setConflictError(err);
      } else {
        setConflictError(err);
        toast.error(response?.data?.error?.message || 'Could not update enquiry');
      }
    } finally {
      setSaving(false);
    }
  };
  const createProject = async (event: React.FormEvent) => { event.preventDefault(); if (!canManage || !projectForm.project_code.trim() || !projectForm.project_name.trim()) return toast.error('Project code and name are required'); setSaving(true); try { const response = await api.post(`/enquiries/${id}/create-project`, { ...projectForm, site_name: projectForm.site_name || null, country: projectForm.country || null, city: projectForm.city || null, notes: projectForm.notes || null }); toast.success('Project created'); setProjectOpen(false); qc.invalidateQueries({ queryKey: ['enquiry', id] }); if (response.data?.project?.id) navigate(`/projects/${response.data.project.id}`); } catch (err: any) { toast.error(err?.response?.data?.error?.message || 'Could not create project'); } finally { setSaving(false); } };
  return <div className="p-6 max-w-7xl mx-auto">
    <button onClick={() => navigate('/enquiries')} className="flex items-center gap-1.5 text-xs font-bold text-[#6f8082] hover:text-[#087f73] mb-5"><ArrowLeft className="w-4 h-4" /> Enquiries</button>
     <header className="flex flex-wrap justify-between gap-4 mb-6">
       <div className="flex gap-3">
         <div className="w-11 h-11 rounded-xl bg-[#087f73] flex items-center justify-center">
           <ClipboardList className="w-5 h-5 text-white" />
         </div>
         <div>
           <div className="font-mono text-xs text-[#087f73]">{d.enquiry_number || `ENQ-${d.id}`}</div>
           <h1 className="text-2xl font-extrabold mt-1">{d.title}</h1>
           <p className="text-sm text-[#6f8082] mt-1"><ClientLink id={d.client_id} name={d.client?.name || d.client_name || 'No client'} /> · due {d.due_date || 'not set'}</p>
         </div>
       </div>
       <div className="flex gap-2">
         <FollowRecordButton entityType="enquiry" entityId={d.id} />
         {canManage && <button onClick={beginEdit} className="px-3 py-2 rounded-lg border border-[#dce7e2] bg-white text-sm font-bold">Edit enquiry</button>}
          {d.project_id || d.project ? canViewProjects ? (
           <Link to={`/projects/${d.project_id || d.project.id}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#20333a] text-white text-sm font-bold">
             Open project <ExternalLink className="w-3.5 h-3.5" />
           </Link>
          ) : <span className="px-3 py-2 rounded-lg bg-[#f3f5f4] text-[#75817e] text-sm font-medium">Project unavailable</span> : canCreateProject && (
           <button onClick={() => setProjectOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#c36f3d] text-white text-sm font-bold">
             <FolderPlus className="w-4 h-4" /> Create project
           </button>
         )}
       </div>
     </header>
    <div className="flex gap-1 border-b border-[#dce7e2] mb-5"><button onClick={() => setTab('info')} className={`px-4 py-3 text-sm font-bold border-b-2 ${tab === 'info' ? 'border-[#087f73] text-[#087f73]' : 'border-transparent text-[#6f8082]'}`}>Enquiry Information</button><button onClick={() => setTab('quote')} className={`px-4 py-3 text-sm font-bold border-b-2 ${tab === 'quote' ? 'border-[#087f73] text-[#087f73]' : 'border-transparent text-[#6f8082]'}`}>Quote {d.quote?.quote_number && <span className="font-mono ml-1">#{d.quote.quote_number}</span>}</button></div>
    {tab === 'info' ? <div className="grid lg:grid-cols-[1.4fr_.6fr] gap-5"><section className="bg-white rounded-xl border border-[#dce7e2] p-5 shadow-sm"><div className="flex justify-between"><h2 className="font-extrabold">Request brief</h2><span className="px-2 py-1 rounded-md bg-[#e4f2ee] text-[#087f73] text-[10px] uppercase font-extrabold">{pretty(d.status)}</span></div><p className="whitespace-pre-wrap text-sm text-[#53686b] mt-5 leading-6">{d.description || 'No description recorded.'}</p><div className="grid sm:grid-cols-2 gap-5 mt-6 pt-5 border-t border-[#edf2ef]">{[['Contact', d.contact_id && d.contact_name ? <RouterLink to={`/clients/${d.client_id}`} className="font-semibold text-[#087f73] hover:underline">{d.contact_name}</RouterLink> : d.contact_name], ['Email', d.contact_email], ['Phone', d.contact_phone], ['Source', d.source], ['Received', d.received_date], ['Due', d.due_date]].map(([label, value]) => <div key={label as string}><div className="text-[10px] uppercase tracking-wider font-extrabold text-[#8a9b9a]">{label}</div><div className="text-sm text-[#53686b] mt-1">{value || '—'}</div></div>)}</div></section><aside className="space-y-5"><section className="bg-[#e4f2ee] border border-[#c9e3dc] rounded-xl p-5"><div className="text-[10px] uppercase tracking-wider font-extrabold text-[#087f73]">Linked records</div><div className="mt-4 text-sm"><div className="text-[#6f8082]">Project</div><div className="font-bold mt-1">{projectLabel}</div><div className="text-[#6f8082] mt-4">Design Book</div>{d.design_book_id || d.design_book || d.design_book_code ? <Link to={`/design-books/${d.design_book_id || d.design_book?.id}`} className="font-bold text-[#087f73] mt-1 inline-flex items-center gap-1">{designBookLabel} <ExternalLink className="w-3 h-3" /></Link> : <div className="font-bold mt-1">Not linked</div>}</div></section><section className="bg-white border border-[#dce7e2] rounded-xl p-5"><h2 className="font-extrabold">Activity</h2>{(d.activity || d.activities || []).length === 0 ? <p className="text-sm text-[#8a9b9a] mt-4">No activity recorded yet.</p> : <div className="mt-4 space-y-3">{(d.activity || d.activities).map((a: any, i: number) => <div key={a.id || i} className="text-xs text-[#53686b] border-l-2 border-[#b8d9d0] pl-3">{a.description || a.action}<div className="text-[10px] text-[#8a9b9a] mt-1">{a.created_at || ''}</div></div>)}</div>}</section></aside></div> : <EnquiryQuoteWorkspace enquiryId={String(id)} enquiry={d} canManage={canManage} canImportEquipmentAccess={canImportEquipmentAccess} />}
      {editing && <div className="fixed inset-0 z-50 bg-[#20333a]/40 p-4 flex items-center justify-center"><form data-enquiry-edit-form onSubmit={save} className="bg-white rounded-2xl max-w-xl w-full p-5 shadow-2xl"><h2 className="font-extrabold mb-4">Edit enquiry</h2><ProtectedDraftBar storageKey={`enquiry:${user?.id || 'unknown'}:${id}:edit`} value={form} baseline={editBaseline} version={editVersion} enabled={editing} saving={saving} error={conflictError} savedAt={draftSavedAt} onRestore={setForm} onSave={() => { const formElement = document.querySelector<HTMLFormElement>('[data-enquiry-edit-form]'); formElement?.requestSubmit(); }} onConflictReload={reloadConflict} />{conflictError?.response?.status === 409 && <details className="my-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><summary className="cursor-pointer font-bold">Server version evidence</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(conflictError.response.data?.error?.current_record || conflictError.response.data?.current || conflictError.response.data, null, 2)}</pre></details>}<div className="grid sm:grid-cols-2 gap-4"><label className="text-xs font-bold">Title<input value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} className="mt-1 w-full border rounded-lg p-2 text-sm" /></label><label className="text-xs font-bold">Status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="mt-1 w-full border rounded-lg p-2 text-sm">{['new', 'in_review', 'quoted', 'won', 'lost', 'closed'].map(s => <option key={s}>{s}</option>)}</select></label><label className="sm:col-span-2 text-xs font-bold">Description<textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} className="mt-1 w-full border rounded-lg p-2 text-sm" /></label>{canViewProjects && <label className="text-xs font-bold">Project<select value={form.project_id || ''} onChange={e => setForm({ ...form, project_id: e.target.value || null })} className="mt-1 w-full border rounded-lg p-2 text-sm"><option value="">Not linked</option>{list(projects.data).map((p: any) => <option key={p.id} value={p.id}>{p.project_code || p.project_name}</option>)}</select></label>}{canViewDesignBooks && <label className="text-xs font-bold">Design Book<select value={form.design_book_id || ''} onChange={e => setForm({ ...form, design_book_id: e.target.value || null })} className="mt-1 w-full border rounded-lg p-2 text-sm"><option value="">Not linked</option>{list(books.data).map((b: any) => <option key={b.id} value={b.id}>{b.book_code || b.book_title || b.book_number || b.title}</option>)}</select></label>}</div><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={() => setEditing(false)} className="px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold"><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save changes'}</button></div></form></div>}
    {projectOpen && canCreateProject && <div className="fixed inset-0 z-50 bg-[#20333a]/40 p-4 flex items-center justify-center"><form onSubmit={createProject} className="bg-white rounded-2xl max-w-xl w-full p-5 shadow-2xl"><h2 className="font-extrabold">Create project from enquiry</h2><div className="grid sm:grid-cols-2 gap-3 mt-5">{[['project_code','Project code'],['project_name','Project name'],['site_name','Site'],['country','Country'],['city','City']].map(([key,label]) => <label key={key} className="text-xs font-bold">{label}{(key==='project_code'||key==='project_name')&&' *'}<input required={key==='project_code'||key==='project_name'} value={projectForm[key]} onChange={e => setProjectForm({ ...projectForm, [key]: e.target.value })} className="mt-1 w-full border rounded-lg p-2 text-sm" /></label>)}<label className="sm:col-span-2 text-xs font-bold">Notes<textarea value={projectForm.notes} onChange={e => setProjectForm({ ...projectForm, notes: e.target.value })} rows={3} className="mt-1 w-full border rounded-lg p-2 text-sm" /></label></div><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={() => setProjectOpen(false)} className="px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="px-4 py-2 rounded-lg bg-[#c36f3d] text-white text-sm font-bold">{saving ? 'Creating…' : 'Create project'}</button></div></form></div>}
  </div>;
}