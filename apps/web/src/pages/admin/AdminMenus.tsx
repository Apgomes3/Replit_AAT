// Admin → Menus: the left menu's department menus. Admins add menus with their own links, and decide
// who sees each one (everyone, some departments, or named people), whether people outside see it
// folded or not at all, and per-person exceptions. Built-in menus keep their pages (set in code).
// Module access from the person's role still hides pages inside any menu.
import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, ListTree, Pencil, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { MENU_ICON_MAP, SYSTEM_AREAS } from '../../components/layout/LeftNav';
import { useAuthStore } from '../../store/authStore';
import type { NavMenu } from '../../types';

type Visibility = 'everyone' | 'departments' | 'people';
type Item = { label: string; path: string; icon: string | null; module_key: string | null };
type Override = { user_id: string; mode: 'show' | 'hide'; name?: string };
export type AdminMenu = {
  id: string; key: string; label: string; icon: string | null; sort_order: number; is_system: boolean; is_active: boolean;
  visibility: Visibility; department_keys: string[]; user_ids: string[]; include_unassigned: boolean; outside: 'hide' | 'fold';
  items: Item[]; overrides: Override[];
};
type Department = { id: string; key: string; name: string; parent_id: string | null; is_active: boolean };
type MenusResponse = {
  data: AdminMenu[]; people: Array<{ id: string; name: string; department: string | null }>; departments: Department[];
  icons: string[]; modules: Array<{ key: string; label: string }>;
};

const MENUS_KEY = ['admin-menus'] as const;
const errorText = (err: any, fallback: string) => err?.response?.data?.error?.message || fallback;
const field = 'w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

/** Refreshes the signed-in admin's own menu after a change. */
async function refreshOwnMenus() {
  try {
    const r = await api.get('/auth/me');
    useAuthStore.setState(s => ({ user: s.user ? { ...s.user, menus: r.data.menus ?? s.user.menus } : s.user }));
  } catch { /* the next sign-in picks it up */ }
}

/** "Engineering, Design" / "3 people" / "Everyone", plus how people outside see it. */
export function ruleSummary(m: Pick<AdminMenu, 'visibility' | 'department_keys' | 'user_ids' | 'include_unassigned' | 'outside'>, departments: Department[]): string {
  const names = (keys: string[]) => keys.map(k => departments.find(d => d.key === k)?.name ?? k).join(', ');
  const who = m.visibility === 'everyone' ? 'Everyone'
    : m.visibility === 'people' ? `${m.user_ids.length} ${m.user_ids.length === 1 ? 'person' : 'people'}`
    : [m.department_keys.length ? names(m.department_keys) : null, m.include_unassigned ? 'people with no department' : null].filter(Boolean).join(' + ');
  return m.visibility === 'everyone' ? who : `${who}; others ${m.outside === 'fold' ? 'see it folded' : "don't see it"}`;
}

function IconPicker({ value, icons, onChange, label }: { value: string | null; icons: string[]; onChange: (v: string | null) => void; label: string }) {
  return <select aria-label={label} className={field} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
    <option value="">No icon</option>
    {icons.map(i => <option key={i} value={i}>{i}</option>)}
  </select>;
}

function MenuForm({ menu, data, onClose }: { menu: AdminMenu | null; data: MenusResponse; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Omit<AdminMenu, 'id' | 'key' | 'sort_order' | 'is_system'>>(() => ({
    label: menu?.label ?? '', icon: menu?.icon ?? null, is_active: menu?.is_active ?? true,
    visibility: menu?.visibility ?? 'departments', department_keys: menu?.department_keys ?? [], user_ids: menu?.user_ids ?? [],
    include_unassigned: menu?.include_unassigned ?? false, outside: menu?.outside ?? 'hide',
    items: menu?.items.map(({ label, path, icon, module_key }) => ({ label, path, icon, module_key })) ?? [{ label: '', path: '', icon: null, module_key: null }],
    overrides: menu?.overrides ?? [],
  }));
  const [peopleFilter, setPeopleFilter] = useState('');
  const [exceptionPerson, setExceptionPerson] = useState('');
  const isSystem = !!menu?.is_system;
  const systemPages = isSystem ? SYSTEM_AREAS.find(a => a.id === menu!.key)?.items ?? [] : [];
  const deptLabel = (d: Department) => { const p = data.departments.find(x => x.id === d.parent_id); return p ? `${p.name} › ${d.name}` : d.name; };
  const departments = [...data.departments].filter(d => d.is_active || f.department_keys.includes(d.key)).sort((a, b) => deptLabel(a).localeCompare(deptLabel(b)));
  const personName = (id: string) => data.people.find(p => p.id === id)?.name ?? 'Former user';
  const toggle = (list: string[], v: string) => list.includes(v) ? list.filter(x => x !== v) : [...list, v];
  const setItem = (i: number, patch: Partial<Item>) => setF(s => ({ ...s, items: s.items.map((it, j) => j === i ? { ...it, ...patch } : it) }));
  const moveItem = (i: number, d: -1 | 1) => setF(s => {
    const items = [...s.items]; const j = i + d; if (j < 0 || j >= items.length) return s;
    [items[i], items[j]] = [items[j], items[i]]; return { ...s, items };
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, items: isSystem ? [] : f.items.filter(it => it.label.trim() || it.path.trim()) };
      return menu ? api.put(`/admin/menus/${menu.id}`, body) : api.post('/admin/menus', body);
    },
    onSuccess: () => {
      toast.success(menu ? 'Menu saved' : 'Menu added');
      qc.invalidateQueries({ queryKey: MENUS_KEY });
      qc.invalidateQueries({ queryKey: ['admin-menus-preview'] });
      refreshOwnMenus();
      onClose();
    },
    onError: err => toast.error(errorText(err, 'Could not save the menu')),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const filteredPeople = data.people.filter(p => !peopleFilter || p.name.toLowerCase().includes(peopleFilter.toLowerCase()));

  return <div role="dialog" aria-modal="true" aria-label={menu ? `Edit ${menu.label}` : 'New menu'}
    className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 bg-slate-900/30 overflow-y-auto" onClick={onClose}>
    <form onSubmit={submit} className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 mb-12" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <ListTree className="w-5 h-5 text-blue-600" />
        <h2 className="text-base font-bold text-slate-800">{menu ? `Edit ${menu.label}` : 'New menu'}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-5 py-4 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className={labelCls} htmlFor="menu-label">Name</label>
            <input id="menu-label" className={field} value={f.label} maxLength={80} required onChange={e => setF(s => ({ ...s, label: e.target.value }))} />
          </div>
          <div>
            <span className={labelCls}>Icon</span>
            <IconPicker label="Menu icon" value={f.icon} icons={data.icons} onChange={icon => setF(s => ({ ...s, icon }))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.is_active} onChange={e => setF(s => ({ ...s, is_active: e.target.checked }))} /> Switched on (off hides it from everyone)
        </label>

        <fieldset>
          <legend className={labelCls}>Who sees it</legend>
          <div className="flex gap-4 text-sm text-slate-700">
            {(['everyone', 'departments', 'people'] as const).map(v => <label key={v} className="flex items-center gap-1.5">
              <input type="radio" name="visibility" checked={f.visibility === v} onChange={() => setF(s => ({ ...s, visibility: v }))} />
              {v === 'everyone' ? 'Everyone' : v === 'departments' ? 'Departments' : 'Specific people'}
            </label>)}
          </div>
          {f.visibility === 'departments' && <div className="mt-2 rounded-lg border border-slate-200 p-3">
            <div className="grid grid-cols-2 gap-1.5">
              {departments.map(d => <label key={d.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={f.department_keys.includes(d.key)} onChange={() => setF(s => ({ ...s, department_keys: toggle(s.department_keys, d.key) }))} /> {deptLabel(d)}
              </label>)}
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={f.include_unassigned} onChange={e => setF(s => ({ ...s, include_unassigned: e.target.checked }))} /> Also people with no department
            </label>
            <p className="mt-1 text-xs text-slate-500">A sub-department counts as part of its parent.</p>
          </div>}
          {f.visibility === 'people' && <div className="mt-2 rounded-lg border border-slate-200 p-3">
            <input aria-label="Filter people" placeholder="Filter people…" className={field} value={peopleFilter} onChange={e => setPeopleFilter(e.target.value)} />
            <div className="mt-2 max-h-48 overflow-y-auto grid grid-cols-2 gap-1">
              {filteredPeople.map(p => <label key={p.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={f.user_ids.includes(p.id)} onChange={() => setF(s => ({ ...s, user_ids: toggle(s.user_ids, p.id) }))} /> {p.name}
              </label>)}
            </div>
            <p className="mt-1 text-xs text-slate-500">{f.user_ids.length} selected</p>
          </div>}
        </fieldset>

        {f.visibility !== 'everyone' && <fieldset>
          <legend className={labelCls}>Everyone else</legend>
          <div className="flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-1.5"><input type="radio" name="outside" checked={f.outside === 'hide'} onChange={() => setF(s => ({ ...s, outside: 'hide' }))} /> Doesn't see it</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="outside" checked={f.outside === 'fold'} onChange={() => setF(s => ({ ...s, outside: 'fold' }))} /> Sees it folded</label>
          </div>
        </fieldset>}

        <fieldset>
          <legend className={labelCls}>Pages</legend>
          {isSystem
            ? <p className="text-sm text-slate-600">{systemPages.map(p => p.label).join(', ') || 'Nothing here yet'}<span className="block text-xs text-slate-400 mt-1">Built-in menu: its pages are set in code.</span></p>
            : <div className="space-y-2">
              {f.items.map((it, i) => <div key={i} className="grid grid-cols-[1fr_1.4fr_7rem_8rem_auto] gap-1.5 items-center">
                <input aria-label={`Link ${i + 1} label`} placeholder="Label" className={field} value={it.label} onChange={e => setItem(i, { label: e.target.value })} />
                <input aria-label={`Link ${i + 1} path`} placeholder="/projects or https://…" className={field} value={it.path} onChange={e => setItem(i, { path: e.target.value })} />
                <IconPicker label={`Link ${i + 1} icon`} value={it.icon} icons={data.icons} onChange={icon => setItem(i, { icon })} />
                <select aria-label={`Link ${i + 1} module`} className={field} value={it.module_key ?? ''} onChange={e => setItem(i, { module_key: e.target.value || null })}>
                  <option value="">Any role</option>
                  {data.modules.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <div className="flex">
                  <button type="button" aria-label={`Move link ${i + 1} up`} onClick={() => moveItem(i, -1)} className="p-1 text-slate-400 hover:text-slate-700"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" aria-label={`Move link ${i + 1} down`} onClick={() => moveItem(i, 1)} className="p-1 text-slate-400 hover:text-slate-700"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button type="button" aria-label={`Remove link ${i + 1}`} onClick={() => setF(s => ({ ...s, items: s.items.filter((_, j) => j !== i) }))} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>)}
              <button type="button" onClick={() => setF(s => ({ ...s, items: [...s.items, { label: '', path: '', icon: null, module_key: null }] }))}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add link</button>
              <p className="text-xs text-slate-500">A module hides the link from roles without access to it.</p>
            </div>}
        </fieldset>

        <fieldset>
          <legend className={labelCls}>Exceptions for one person</legend>
          {f.overrides.length > 0 && <ul className="mb-2 space-y-1">
            {f.overrides.map(o => <li key={o.user_id} className="flex items-center gap-2 text-sm text-slate-700">
              <span className="flex-1">{o.name ?? personName(o.user_id)}</span>
              <select aria-label={`Exception for ${o.name ?? personName(o.user_id)}`} className="text-sm border border-slate-200 rounded px-1.5 py-0.5" value={o.mode}
                onChange={e => setF(s => ({ ...s, overrides: s.overrides.map(x => x.user_id === o.user_id ? { ...x, mode: e.target.value as 'show' | 'hide' } : x) }))}>
                <option value="show">Always show</option><option value="hide">Always hide</option>
              </select>
              <button type="button" aria-label={`Remove exception for ${o.name ?? personName(o.user_id)}`} onClick={() => setF(s => ({ ...s, overrides: s.overrides.filter(x => x.user_id !== o.user_id) }))}
                className="p-1 text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
            </li>)}
          </ul>}
          <div className="flex gap-2">
            <select aria-label="Person for a new exception" className={field} value={exceptionPerson} onChange={e => setExceptionPerson(e.target.value)}>
              <option value="">Pick a person…</option>
              {data.people.filter(p => !f.overrides.some(o => o.user_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" disabled={!exceptionPerson} onClick={() => {
              setF(s => ({ ...s, overrides: [...s.overrides, { user_id: exceptionPerson, mode: 'show', name: personName(exceptionPerson) }] }));
              setExceptionPerson('');
            }} className="shrink-0 px-3 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40">Add exception</button>
          </div>
        </fieldset>
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60 rounded-b-xl">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={save.isPending || !f.label.trim()} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {save.isPending ? 'Saving…' : menu ? 'Save' : 'Add menu'}
        </button>
      </div>
    </form>
  </div>;
}

/** What one person's left menu would show: their menus, open or folded, with the pages their role can open. */
function Preview({ data }: { data: MenusResponse }) {
  const [personId, setPersonId] = useState('');
  const preview = useQuery({
    queryKey: ['admin-menus-preview', personId], enabled: !!personId,
    queryFn: () => api.get(`/admin/menus/preview/${personId}`).then(r => r.data as { data: NavMenu[]; role: string; module_access: Record<string, string> }),
  });
  const pagesOf = (m: NavMenu): string[] => {
    const access = preview.data?.module_access ?? {};
    if (!m.is_system) return m.items.filter(it => !it.module_key || access[it.module_key] !== 'hidden').map(it => it.label);
    const area = SYSTEM_AREAS.find(a => a.id === m.key);
    return (area?.items ?? []).filter(it => !it.moduleKey || access[it.moduleKey] !== 'hidden').map(it => it.label);
  };
  const shown = (preview.data?.data ?? []).map(m => ({ m, pages: pagesOf(m) }))
    .filter(({ m, pages }) => pages.length > 0 || preview.data?.role === 'admin' || m.member);
  return <section className="rounded-xl border border-slate-200 bg-white p-4">
    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Eye className="w-4 h-4 text-blue-600" /> Preview as…</h2>
    <select aria-label="Preview as person" className={`${field} mt-2`} value={personId} onChange={e => setPersonId(e.target.value)}>
      <option value="">Pick a person…</option>
      {data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    {personId && preview.isLoading && <p className="mt-3 text-sm text-slate-400">Loading…</p>}
    {preview.data && <ul className="mt-3 space-y-2" aria-label="Preview">
      {shown.length === 0 && <li className="text-sm text-slate-500">No department menus.</li>}
      {shown.map(({ m, pages }) => <li key={m.key} className="text-sm">
        <span className="font-medium text-slate-800">{m.label}</span>
        <span className={`ml-2 text-xs ${m.state === 'open' ? 'text-emerald-600' : 'text-slate-400'}`}>{m.state === 'open' ? 'open' : 'folded'}</span>
        <p className="text-xs text-slate-500">{pages.join(', ') || 'Nothing here yet'}</p>
      </li>)}
    </ul>}
    <p className="mt-3 text-xs text-slate-400">Their own fold/unfold choices in the menu still win once they make one.</p>
  </section>;
}

export default function AdminMenus() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: MENUS_KEY, retry: false, queryFn: () => api.get('/admin/menus').then(r => r.data as MenusResponse) });
  const [editing, setEditing] = useState<AdminMenu | 'new' | null>(null);
  const menus = useMemo(() => data?.data ?? [], [data]);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put('/admin/menus/reorder', { ids }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: MENUS_KEY }); refreshOwnMenus(); },
    onError: err => toast.error(errorText(err, 'Could not reorder the menus')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/menus/${id}`),
    onSuccess: () => { toast.success('Menu removed'); qc.invalidateQueries({ queryKey: MENUS_KEY }); refreshOwnMenus(); },
    onError: err => toast.error(errorText(err, 'Could not remove the menu')),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = menus.map(m => m.id); const j = i + d; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; reorder.mutate(ids);
  };

  return <div className="p-6 max-w-6xl mx-auto space-y-4">
    <PageHeader title="Menus" subtitle="The department menus in the left menu, and who sees each one. A role without access to a page still doesn't see it."
      actions={<button type="button" onClick={() => setEditing('new')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
        <Plus className="w-4 h-4" /> New menu</button>} />
    {isError ? <p role="alert" className="text-sm text-red-600">Could not load the menus{(error as any)?.response?.status === 404 ? ': the API is running older code. Restart it (npm run dev) and reload.' : '.'}</p>
      : isLoading || !data ? <p className="text-sm text-slate-400">Loading…</p> :<div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-4 items-start">
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr><th className="px-4 py-2 w-16">Order</th><th className="px-4 py-2">Menu</th><th className="px-4 py-2">Who sees it</th><th className="px-4 py-2 w-24" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {menus.map((m, i) => {
              const Icon = MENU_ICON_MAP[m.icon ?? ''];
              return <tr key={m.id} className={m.is_active ? '' : 'opacity-50'}>
                <td className="px-4 py-2">
                  <button type="button" aria-label={`Move ${m.label} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" aria-label={`Move ${m.label} down`} disabled={i === menus.length - 1 || reorder.isPending} onClick={() => move(i, 1)} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                </td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-1.5 font-medium text-slate-800">{Icon && <Icon className="w-4 h-4 text-slate-400" />}{m.label}</span>
                  <span className="text-xs text-slate-400">{m.is_system ? 'Built-in' : `${m.items.length} link${m.items.length === 1 ? '' : 's'}`}{m.is_active ? '' : ' · switched off'}{m.overrides.length ? ` · ${m.overrides.length} exception${m.overrides.length === 1 ? '' : 's'}` : ''}</span>
                </td>
                <td className="px-4 py-2 text-slate-600">{ruleSummary(m, data.departments)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button type="button" aria-label={`Edit ${m.label}`} onClick={() => setEditing(m)} className="p-1 text-slate-400 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                  {!m.is_system && <button type="button" aria-label={`Remove ${m.label}`} onClick={() => { if (window.confirm(`Remove the ${m.label} menu? Its links go with it.`)) remove.mutate(m.id); }}
                    className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <Preview data={data} />
    </div>}
    {editing && data && <MenuForm menu={editing === 'new' ? null : editing} data={data} onClose={() => setEditing(null)} />}
  </div>;
}
