// Admin › Departments: the company's departments, with a head, an optional parent (sub-departments
// such as Design and Drafting under Engineering), a colour and code, the menu areas their people
// see open by default, their teams and how many people they have.
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Layers, Pencil, Plus, Trash2, UserRound, Users, UsersRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { colourClasses, DEPARTMENT_OPTIONS_KEY } from '../../lib/departments';
import { DepartmentHeadcount, DepartmentWorkload } from './DepartmentOverview';
import { DepartmentOrgChart } from './DepartmentOrgChart';

const TABS = [
  { id: 'departments', label: 'Departments' },
  { id: 'org', label: 'Org chart' },
  { id: 'workload', label: 'Workload' },
  { id: 'headcount', label: 'Headcount by office' },
] as const;
type Tab = typeof TABS[number]['id'];

type Department = {
  id: string; key: string; name: string; code: string | null; colour: string; description: string | null;
  head_user_id: string | null; head_name: string | null; parent_id: string | null; parent_name: string | null;
  nav_areas: string[] | null; is_active: boolean; people: number;
  teams: Array<{ id: string; name: string; active: boolean; manager_name: string | null; members: number }>;
};
type DepartmentsResponse = { data: Department[]; people: Array<{ id: string; name: string }>; nav_areas: string[]; colours: string[] };
type FormState = {
  name: string; code: string; colour: string; description: string; head_user_id: string; parent_id: string;
  allAreas: boolean; nav_areas: string[]; is_active: boolean;
};

const KEY = ['admin-departments'] as const;
const errorText = (err: any, fallback: string) => err?.response?.data?.error?.message || fallback;
const field = 'w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const label = 'block text-xs font-semibold text-slate-600 mb-1';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Top-level departments by name, each followed by its sub-departments (any depth). */
function treeOrder(list: Department[]): Array<Department & { depth: number }> {
  const children = new Map<string | null, Department[]>();
  const ids = new Set(list.map(d => d.id));
  for (const d of list) {
    const parent = d.parent_id && ids.has(d.parent_id) ? d.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), d]);
  }
  const out: Array<Department & { depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const d of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ ...d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A department and everything under it (cannot be chosen as its parent). */
function selfAndBelow(list: Department[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of list) if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) { out.add(d.id); grew = true; }
  }
  return out;
}

function DepartmentForm({ dept, data, onClose }: { dept: Department | null; data: DepartmentsResponse; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>({
    name: dept?.name ?? '', code: dept?.code ?? '', colour: dept?.colour ?? 'slate', description: dept?.description ?? '',
    head_user_id: dept?.head_user_id ?? '', parent_id: dept?.parent_id ?? '',
    allAreas: dept ? dept.nav_areas === null : false, nav_areas: dept?.nav_areas ?? [], is_active: dept?.is_active ?? true,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const blocked = useMemo(() => dept ? selfAndBelow(data.data, dept.id) : new Set<string>(), [data.data, dept]);
  const parents = treeOrder(data.data).filter(d => !blocked.has(d.id) && (d.is_active || d.id === f.parent_id));
  const locked = dept?.key === 'drafting';
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(), code: f.code.trim() || null, colour: f.colour, description: f.description.trim() || null,
        head_user_id: f.head_user_id || null, parent_id: f.parent_id || null,
        nav_areas: f.allAreas ? null : f.nav_areas, is_active: f.is_active,
      };
      return dept ? api.put(`/admin/departments/${dept.id}`, body) : api.post('/admin/departments', body);
    },
    onSuccess: () => {
      toast.success(dept ? 'Department saved' : 'Department added');
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: DEPARTMENT_OPTIONS_KEY });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: err => toast.error(errorText(err, 'Could not save the department')),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (f.name.trim()) save.mutate(); };

  return <div role="dialog" aria-modal="true" aria-label={dept ? `Edit ${dept.name}` : 'New department'}
    className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 bg-slate-900/30 overflow-y-auto" onClick={onClose}>
    <form onSubmit={submit} className="w-full max-w-xl mb-12 bg-white rounded-xl shadow-2xl border border-slate-200" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <Layers className="w-5 h-5 text-blue-600" />
        <h2 className="text-base font-bold text-slate-800">{dept ? `Edit ${dept.name}` : 'New department'}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-5 py-4 grid gap-3 sm:grid-cols-[1fr_7rem]">
        <div>
          <label className={label} htmlFor="dept-name">Name</label>
          <input id="dept-name" autoFocus={!dept} value={f.name} disabled={locked} onChange={e => setF({ ...f, name: e.target.value })} maxLength={100} placeholder="e.g. Quality" className={`${field} disabled:bg-slate-50`} />
          {locked && <p className="mt-1 text-[11px] text-slate-500">Drafting keeps its name: the Drafting screen finds its teams by it.</p>}
        </div>
        <div>
          <label className={label} htmlFor="dept-code">Code</label>
          <input id="dept-code" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={10} placeholder="QA" className={field} />
        </div>
        <div className="sm:col-span-2">
          <span className={label}>Colour</span>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            {data.colours.map(c => <button key={c} type="button" role="radio" aria-checked={f.colour === c} aria-label={c} onClick={() => setF({ ...f, colour: c })}
              className={`w-7 h-7 rounded-full border-2 ${f.colour === c ? 'border-slate-800' : 'border-transparent'}`}>
              <span className={`block w-full h-full rounded-full ${colourClasses(c).dot}`} />
            </button>)}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="dept-description">Description</label>
          <textarea id="dept-description" rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} maxLength={1000} placeholder="What this department does" className={field} />
        </div>
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="dept-head">Head of department</label>
            <select id="dept-head" value={f.head_user_id} onChange={e => setF({ ...f, head_user_id: e.target.value })} className={field}>
              <option value="">Not set</option>
              {dept?.head_user_id && !data.people.some(p => p.id === dept.head_user_id) && <option value={dept.head_user_id}>{dept.head_name} (blocked)</option>}
              {data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="dept-parent">Part of</label>
            <select id="dept-parent" value={f.parent_id} onChange={e => setF({ ...f, parent_id: e.target.value })} className={field}>
              <option value="">Nothing (top level)</option>
              {parents.map(d => <option key={d.id} value={d.id}>{'  '.repeat(d.depth)}{d.name}</option>)}
            </select>
          </div>
        </div>
        <p className="sm:col-span-2 text-[11px] text-slate-500">
          Which menus this department sees is set on <Link to="/admin/menus" className="text-blue-700 hover:underline">Admin › Menus</Link>.
        </p>
        {dept && !locked && <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} /> Active (an archived department keeps its people but is no longer offered)
        </label>}
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
        <button disabled={!f.name.trim() || save.isPending} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-40">
          {save.isPending ? 'Saving…' : dept ? 'Save' : 'Add department'}
        </button>
      </div>
    </form>
  </div>;
}

function DepartmentCard({ d, onEdit }: { d: Department & { depth: number }; onEdit: () => void }) {
  const qc = useQueryClient();
  const c = colourClasses(d.colour);
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/departments/${d.id}`),
    onSuccess: () => { toast.success('Department removed'); qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: DEPARTMENT_OPTIONS_KEY }); },
    onError: err => toast.error(errorText(err, 'Could not remove the department'), { duration: 6000 }),
  });
  return <li className={`rounded-xl border bg-white p-4 shadow-sm ${d.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-75'}`}
    style={{ marginLeft: d.depth ? `${Math.min(d.depth, 3) * 1.5}rem` : undefined }}>
    <div className="flex flex-wrap items-start gap-2">
      <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-slate-800">{d.name}</h2>
          {d.code && <span className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${c.chip}`}>{d.code}</span>}
          {d.parent_name && <span className="text-xs text-slate-500">part of {d.parent_name}</span>}
          {!d.is_active && <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"><Archive className="w-3 h-3" />Archived</span>}
        </div>
        {d.description && <p className="mt-0.5 text-sm text-slate-600">{d.description}</p>}
      </div>
      <button type="button" aria-label={`Edit ${d.name}`} onClick={onEdit} className="p-1.5 text-slate-400 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
      {d.key !== 'drafting' && <button type="button" aria-label={`Remove ${d.name}`} onClick={() => { if (window.confirm(`Remove the department "${d.name}"? This cannot be undone.`)) remove.mutate(); }}
        className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
    </div>
    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Head</div>
        {d.head_user_id
          ? <Link to={`/people/${d.head_user_id}`} className="inline-flex items-center gap-1 text-slate-700 hover:text-blue-700"><UserRound className="w-3.5 h-3.5" />{d.head_name}</Link>
          : <span className="text-slate-400">Not set</span>}
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">People</div>
        <Link to={`/admin/users?department=${encodeURIComponent(d.key)}`} className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">
          <Users className="w-3.5 h-3.5" />{plural(d.people, 'person', 'people')}
        </Link>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Menus</div>
        <Link to="/admin/menus" className="text-blue-700 hover:underline">Set on Admin › Menus</Link>
      </div>
    </div>
    <div className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Teams</div>
      {d.teams.length
        ? <ul className="mt-1 flex flex-wrap gap-1.5">
          {d.teams.map(t => <li key={t.id} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${t.active ? 'border-slate-200 text-slate-700' : 'border-dashed border-slate-200 text-slate-400'}`}>
            <UsersRound className="w-3.5 h-3.5 text-slate-400" /><span className="font-semibold">{t.name}</span>
            <span className="text-slate-500">· {plural(t.members, 'member', 'members')}{t.manager_name ? ` · ${t.manager_name}` : ''}{t.active ? '' : ' · inactive'}</span>
          </li>)}
        </ul>
        : <p className="mt-1 text-xs text-slate-400">No teams. Teams are created in <Link to="/resources" className="text-blue-700 hover:underline">Teams &amp; Workload</Link>.</p>}
    </div>
  </li>;
}

export default function AdminDepartments() {
  const { data, isLoading, isError } = useQuery({ queryKey: KEY, queryFn: () => api.get('/admin/departments').then(r => r.data as DepartmentsResponse) });
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTabState] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return TABS.some(x => x.id === t) ? t as Tab : 'departments';
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    if (t === 'departments') url.searchParams.delete('tab'); else url.searchParams.set('tab', t);
    window.history.replaceState(window.history.state, '', url);
  };
  const all = data ? treeOrder(data.data) : [];
  const archived = all.filter(d => !d.is_active).length;
  const shown = showArchived ? all : all.filter(d => d.is_active);
  const total = data?.data.reduce((s, d) => s + d.people, 0) ?? 0;

  return <div className="h-full flex flex-col">
    <PageHeader
      title="Departments"
      subtitle="Departments, their heads, sub-departments, teams and people"
      actions={<button type="button" onClick={() => setEditing('new')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold"><Plus className="w-4 h-4" />New department</button>}
    />
    <div role="tablist" aria-label="Departments view" className="flex gap-1 px-4 border-b border-slate-200 bg-white">
      {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
        className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t.label}</button>)}
    </div>
    {tab === 'org' && <div className="flex-1 overflow-auto px-4 py-4">{data && <DepartmentOrgChart departments={data.data} showArchived={showArchived} />}</div>}
    {tab === 'workload' && <div className="flex-1 overflow-auto px-4 py-4"><DepartmentWorkload departments={all} /></div>}
    {tab === 'headcount' && <div className="flex-1 overflow-auto px-4 py-4"><DepartmentHeadcount departments={all} /></div>}
    {tab === 'departments' && <div className="flex-1 overflow-auto px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
        <p className="max-w-3xl">
          Give people a department on the <Link to="/admin/users" className="text-blue-700 hover:underline">Users</Link> page. A department decides which menu areas
          its people see open; access to modules stays with their role.{data && ` ${plural(total, 'person has', 'people have')} a department.`}
        </p>
        {archived > 0 && <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived ({archived})</label>}
      </div>
      {isLoading && <p className="py-6 text-sm text-slate-500">Loading…</p>}
      {isError && <p role="alert" className="py-6 text-sm text-rose-700">Departments could not be loaded.</p>}
      {data && (shown.length
        ? <ul className="grid gap-3 max-w-5xl">{shown.map(d => <DepartmentCard key={d.id} d={d} onEdit={() => setEditing(d)} />)}</ul>
        : <p className="py-6 text-sm text-slate-400">No departments yet.</p>)}
    </div>}
    {editing && data && <DepartmentForm dept={editing === 'new' ? null : editing} data={data} onClose={() => setEditing(null)} />}
  </div>;
}
