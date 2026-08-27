import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState, lazy, Suspense, useRef, useEffect, useId } from 'react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Project } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import CountryCombobox from '../../components/ui/CountryCombobox';
import { Plus, List, Map, Download, X, Search, User, ImagePlus, FolderOpen } from 'lucide-react';
import { exportCsv, csvDate } from '../../lib/exportCsv';
import toast from 'react-hot-toast';
import QueryError from '../../components/ui/QueryError';
import EmptyState from '../../components/ui/EmptyState';

const ProjectsMap = lazy(() => import('../../components/ui/ProjectsMap'));

const EMPTY_FORM = { project_code: '', project_name: '', client_name: '', country: '', city: '', project_manager: '' };

const ALL_SCOPES = [
  { key: 'LSS', label: 'LSS', description: 'Life Support Systems' },
  { key: 'Tanks', label: 'Tanks', description: 'Tank engineering' },
  { key: 'Waterproofing', label: 'Waterproofing', description: 'Waterproofing scope' },
  { key: 'Theming', label: 'Theming', description: 'Theming & decoration' },
  { key: 'Acrylic', label: 'Acrylic', description: 'Acrylic panels & viewing windows' },
] as const;

export default function ProjectsList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isPrivileged = user?.role === 'admin' || user?.role === 'engineer';
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<'table' | 'map'>('table');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [selectedScopes, setSelectedScopes] = useState<string[]>(['LSS', 'Tanks', 'Waterproofing', 'Theming', 'Acrylic']);

  const [pmMode, setPmMode] = useState<'pick' | 'manual'>('pick');
  const [pmSearch, setPmSearch] = useState('');
  const [pmOpen, setPmOpen] = useState(false);
  const [pmActiveIndex, setPmActiveIndex] = useState(-1);
  const pmRef = useRef<HTMLDivElement>(null);
  const pmInputRef = useRef<HTMLInputElement>(null);
  const pmTriggerRef = useRef<HTMLButtonElement>(null);
  const pmRestoreFocus = useRef(false);
  const pmListboxId = useId();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['projects', search],
    queryFn: () => api.get(`/projects${search ? `?q=${search}` : ''}`).then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: () => api.get('/admin/users', { params: { page_size: 1000 } }).then(r => r.data),
    enabled: showNew && isPrivileged,
    staleTime: 60_000,
  });
  const allUsers: any[] = usersData?.items || [];
  const pmFiltered = pmSearch.trim()
    ? allUsers.filter(u => `${u.first_name} ${u.last_name}`.toLowerCase().includes(pmSearch.toLowerCase()))
    : allUsers;

  const closePm = (shouldRestoreFocus: boolean) => {
    setPmOpen(false);
    setPmSearch('');
    setPmActiveIndex(-1);
    if (shouldRestoreFocus) pmRestoreFocus.current = true;
  };

  useEffect(() => {
    if (!pmOpen && pmRestoreFocus.current) {
      pmRestoreFocus.current = false;
      pmTriggerRef.current?.focus();
    }
  }, [pmOpen]);

  useEffect(() => {
    if (!pmOpen) return;
    pmInputRef.current?.focus();
    const handleMouseDown = (e: MouseEvent) => {
      if (!pmRef.current?.contains(e.target as Node)) closePm(false);
    };
    const handleFocusIn = (e: FocusEvent) => {
      if (!pmRef.current?.contains(e.target as Node)) closePm(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [pmOpen]);

  const columns: Column<Project>[] = [
    {
      key: 'logo_url', header: '', className: 'py-1.5 w-[72px]', render: r => r.logo_url
        ? <img src={r.logo_url} alt="" className="w-16 h-12 rounded-md object-contain bg-slate-50 border border-slate-100" />
        : <div className="w-16 h-12 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-lg font-bold text-slate-400 uppercase">{(r.project_name?.[0] ?? r.project_code?.[0] ?? '?')}</div>
    },
    { key: 'project_code', header: 'Code', sortable: true, render: r => <EntityCode code={r.project_code} /> },
    { key: 'project_name', header: 'Project Name', sortable: true, filterable: true, render: r => <span className="font-medium">{r.project_name}</span> },
    { key: 'client_name', header: 'Client', sortable: true, filterable: true },
    { key: 'country', header: 'Country or Region', sortable: true, filterable: true },
    { key: 'project_status', header: 'Status', sortable: true, filterable: true, filterValue: r => r.project_status ?? '', render: r => <StatusBadge status={r.project_status} /> },
    { key: 'project_manager', header: 'PM', sortable: true, filterable: true },
    { key: 'target_completion_date', header: 'Target', sortable: true, sortValue: r => r.target_completion_date ?? '', render: r => r.target_completion_date ? r.target_completion_date.split('T')[0] : '—' },
  ];

  const openNew = () => { setForm(EMPTY_FORM); setPmMode('pick'); setPmSearch(''); setLogoFile(null); setSelectedScopes(['LSS', 'Tanks', 'Waterproofing', 'Theming', 'Acrylic']); setShowNew(true); };
  const closeNew = () => { setShowNew(false); setLogoFile(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project_code.trim() || !form.project_name.trim()) return;
    setSaving(true);
    try {
      const res = await api.post('/projects', { ...form, scopes: selectedScopes });
      const newProject = res.data;
      if (logoFile) {
        const fd = new FormData();
        fd.append('logo', logoFile);
        await api.post(`/projects/${newProject.id}/logo`, fd, { headers: { 'Content-Type': undefined } });
      }
      toast.success('Project created');
      closeNew();
      navigate(`/projects/${newProject.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Projects" crumbs={[{ label: 'Project Management', href: '/project-management' }, { label: 'Projects' }]} subtitle={`${data?.pagination?.total ?? 0} projects`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setView('table')} className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${view === 'table' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button onClick={() => setView('map')} className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${view === 'map' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                <Map className="w-3.5 h-3.5" /> Map
              </button>
            </div>
            <button
              onClick={() => exportCsv(`projects-${new Date().toISOString().slice(0, 10)}.csv`, [
                { header: 'Code',        value: r => r.project_code ?? '' },
                { header: 'Name',        value: r => r.project_name ?? '' },
                { header: 'Client',      value: r => r.client_name ?? '' },
                { header: 'Country or Region', value: r => r.country ?? '' },
                { header: 'Status',      value: r => r.project_status ?? '' },
                { header: 'PM',          value: r => r.project_manager ?? '' },
                { header: 'Target Date', value: r => csvDate(r.target_completion_date) },
              ], (data?.items ?? []) as Project[])}
              disabled={!data?.items?.length}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <Button variant="primary" onClick={openNew}><Plus className="w-4 h-4" />New Project</Button>
          </div>
        }
      />

      {view === 'table' && (
        <>
          <div className="p-4 border-b border-slate-200 bg-white">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-600" />
          </div>
           <div className="flex-1 bg-white overflow-auto">
             {isError ? (
               <QueryError message="Could not load projects" onRetry={() => refetch()} />
             ) : !isLoading && data?.items?.length === 0 && !search ? (
               <EmptyState
                 icon={FolderOpen}
                 title="No projects"
                 description="Create a project to organize systems, equipment, and engineering deliverables."
                 actionLabel="Create a project"
                 onAction={openNew}
               />
             ) : (
               <DataTable columns={columns} data={data?.items || []} loading={isLoading} onRowClick={r => navigate(`/projects/${r.id}`)} />
             )}
          </div>
        </>
      )}

      {view === 'map' && (
         <div className="flex-1 overflow-auto p-4">
           {isError ? (
             <QueryError message="Could not load projects" onRetry={() => refetch()} />
           ) : (
             <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading map...</div>}>
               <ProjectsMap projects={data?.items || []} height="calc(100vh - 180px)" />
             </Suspense>
           )}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-800">New Project</h2>
              <button aria-label="Close new project form" title="Close new project form" onClick={closeNew} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Project Code <span className="text-red-400">*</span></label>
                <input autoFocus required value={form.project_code} onChange={e => setForm(f => ({ ...f, project_code: e.target.value }))}
                  placeholder="PRJ-TY-002"
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Project Name <span className="text-red-400">*</span></label>
                <input required value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))}
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Client</label>
                <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Country or Region</label>
                <CountryCombobox label="country or region" value={form.country} onChange={v => setForm(f => ({ ...f, country: v }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">City</label>
                <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600" />
              </div>

              {/* Project Manager picker */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Project Manager</label>
                  <button type="button" onClick={() => { setPmMode(m => m === 'pick' ? 'manual' : 'pick'); setForm(f => ({ ...f, project_manager: '' })); closePm(false); }}
                    className="text-[11px] text-blue-600 hover:underline">
                    {pmMode === 'pick' ? 'Type name manually' : 'Pick from users'}
                  </button>
                </div>
                {pmMode === 'manual' ? (
                  <input value={form.project_manager} onChange={e => setForm(f => ({ ...f, project_manager: e.target.value }))}
                    placeholder="Enter full name…"
                    className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600" />
                ) : (
                  <div ref={pmRef} className="relative">
                    <div className="flex items-center border border-slate-300 rounded px-3 py-1.5 text-sm focus-within:border-blue-600">
                      <User className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                      {pmOpen ? (
                        <input ref={pmInputRef} autoFocus value={pmSearch} onChange={e => { setPmSearch(e.target.value); setPmActiveIndex(e.target.value.trim() ? 0 : -1); }}
                          placeholder={form.project_manager || 'Search users…'}
                          aria-label="Search project managers"
                          role="combobox"
                          aria-expanded="true"
                          aria-controls={pmListboxId}
                          aria-autocomplete="list"
                          aria-activedescendant={pmActiveIndex >= 0 && pmFiltered[pmActiveIndex] ? `${pmListboxId}-option-${pmActiveIndex}` : undefined}
                          className="flex-1 outline-none text-sm bg-transparent"
                          onKeyDown={e => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              closePm(true);
                            } else if (e.key === 'Enter' && pmActiveIndex >= 0 && pmFiltered[pmActiveIndex]) {
                              e.preventDefault();
                              const u = pmFiltered[pmActiveIndex];
                              const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
                              setForm(f => ({ ...f, project_manager: name }));
                              closePm(true);
                            } else if (e.key === 'ArrowDown' && pmFiltered.length > 0) {
                              e.preventDefault();
                              setPmActiveIndex(index => index < pmFiltered.length - 1 ? index + 1 : 0);
                            } else if (e.key === 'ArrowUp' && pmFiltered.length > 0) {
                              e.preventDefault();
                              setPmActiveIndex(index => index <= 0 ? pmFiltered.length - 1 : index - 1);
                            } else if (e.key === 'Home' && pmFiltered.length > 0) {
                              e.preventDefault();
                              setPmActiveIndex(0);
                            } else if (e.key === 'End' && pmFiltered.length > 0) {
                              e.preventDefault();
                              setPmActiveIndex(pmFiltered.length - 1);
                            } else if (e.key === 'Tab') {
                              closePm(false);
                            }
                          }} />
                      ) : (
                        <button
                          ref={pmTriggerRef}
                          type="button"
                          aria-label={form.project_manager ? `Select project manager, currently ${form.project_manager}` : 'Select project manager'}
                          aria-haspopup="listbox"
                          aria-expanded="false"
                          onClick={() => {
                            setPmOpen(true);
                            setPmActiveIndex(form.project_manager ? Math.max(allUsers.findIndex(u => {
                              const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
                              return name === form.project_manager;
                            }), 0) : -1);
                          }}
                          onKeyDown={e => {
                            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !pmOpen) {
                              e.preventDefault();
                              setPmOpen(true);
                              setPmActiveIndex(form.project_manager ? Math.max(allUsers.findIndex(u => {
                                const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
                                return name === form.project_manager;
                              }), 0) : 0);
                            }
                          }}
                          className={`flex-1 min-w-0 text-left truncate outline-none ${form.project_manager ? 'text-slate-800' : 'text-slate-400'}`}
                        >
                          {form.project_manager || 'Select project manager…'}
                        </button>
                      )}
                      {form.project_manager && !pmOpen && (
                        <button type="button" aria-label="Clear project manager" title="Clear project manager" onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, project_manager: '' })); setPmActiveIndex(-1); }}
                          className="text-slate-300 hover:text-slate-500 ml-1"><X className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                    {pmOpen && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        <div id={pmListboxId} role="listbox" aria-label="Project manager options">
                          {pmFiltered.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-400">No users found</div>
                          ) : (
                            pmFiltered.map((u: any, index: number) => {
                              const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
                              return (
                                <button key={u.id} type="button"
                                  id={`${pmListboxId}-option-${index}`}
                                  role="option"
                                  aria-selected={name === form.project_manager}
                                  tabIndex={-1}
                                  onMouseDown={e => e.preventDefault()}
                                  onMouseEnter={() => setPmActiveIndex(index)}
                                  onClick={() => { setForm(f => ({ ...f, project_manager: name })); closePm(true); }}
                                  className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-3 border-b border-slate-50 last:border-0 ${index === pmActiveIndex ? 'bg-slate-50' : ''}`}>
                                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                                    {(u.first_name?.[0] || u.email[0]).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="text-sm font-medium text-slate-800">{name}</div>
                                    <div className="text-xs text-slate-400">{u.role}</div>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                        <button type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setPmMode('manual'); closePm(false); setForm(f => ({ ...f, project_manager: '' })); }}
                          className="w-full text-left px-4 py-2.5 text-xs text-blue-600 hover:bg-blue-50 border-t border-slate-100 font-medium">
                          + Enter a name not in the system
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Logo upload */}
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                  Client Logo <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { setLogoFile(e.target.files?.[0] || null); if (logoInputRef.current) logoInputRef.current.value = ''; }} />
                {logoFile ? (
                  <div className="flex items-center gap-3 border border-slate-200 rounded-lg p-3 bg-slate-50">
                    <img src={URL.createObjectURL(logoFile)} alt="preview" className="h-12 w-20 object-contain rounded bg-white border border-slate-100 p-1" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-700 font-medium truncate">{logoFile.name}</div>
                      <div className="text-[11px] text-slate-400">{(logoFile.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <button type="button" aria-label="Remove client logo" title="Remove client logo" onClick={() => setLogoFile(null)}
                      className="text-slate-300 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => logoInputRef.current?.click()}
                    className="flex items-center gap-2 w-full border-2 border-dashed border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
                    <ImagePlus className="w-4 h-4" /> Upload client logo
                  </button>
                )}
              </div>

              {/* Scope selection */}
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Project Scopes <span className="text-red-400">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {ALL_SCOPES.map(scope => {
                    const active = selectedScopes.includes(scope.key);
                    return (
                      <button key={scope.key} type="button"
                        onClick={() => setSelectedScopes(prev => active ? prev.filter(s => s !== scope.key) : [...prev, scope.key])}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-300 hover:border-blue-400 hover:text-blue-600'
                        }`}>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${active ? 'bg-white border-white' : 'border-slate-300'}`}>
                          {active && <span className="w-2 h-2 rounded-full bg-blue-600 block" />}
                        </span>
                        {scope.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">Tabs inside the project only appear for selected scopes</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" onClick={closeNew}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saving || !form.project_code.trim() || !form.project_name.trim() || selectedScopes.length === 0}>
                  {saving ? 'Creating…' : 'Create Project'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
