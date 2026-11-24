// Admin › Departments, the Org chart tab: the company at the top, its departments below it and each
// department's sub-departments below that, with the head, people and teams on every box.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Minus, Plus, UserRound, Users, UsersRound } from 'lucide-react';
import { colourClasses } from '../../lib/departments';

export type OrgDepartment = {
  id: string; key: string; name: string; code: string | null; colour: string; parent_id: string | null;
  head_user_id: string | null; head_name: string | null; is_active: boolean; people: number;
  teams: Array<{ id: string; name: string; active: boolean; members: number }>;
};
type Node = OrgDepartment & { children: Node[]; total: number };

// Connector lines: each child draws its half of the horizontal bar and a short drop to its box.
const CSS = `
.org ul { display: flex; justify-content: center; padding-top: 1.5rem; position: relative; }
.org li { display: flex; flex-direction: column; align-items: center; position: relative; padding: 1.5rem 0.5rem 0; }
.org li::before, .org li::after { content: ''; position: absolute; top: 0; width: 50%; height: 1.5rem; border-top: 2px solid #cbd5e1; }
.org li::before { right: 50%; }
.org li::after { left: 50%; border-left: 2px solid #cbd5e1; }
.org li:only-child::before, .org li:only-child::after { border-top: 0; }
.org li:first-child::before, .org li:last-child::after { border-top: 0; }
.org li:last-child::before { border-right: 2px solid #cbd5e1; border-top: 2px solid #cbd5e1; border-top-right-radius: 8px; }
.org li:last-child::after { border-left: 0; }
.org li:first-child::after { border-top-left-radius: 8px; }
.org li:only-child::after { border-left: 2px solid #cbd5e1; border-radius: 0; }
.org ul ul::before { content: ''; position: absolute; top: 0; left: 50%; height: 1.5rem; border-left: 2px solid #cbd5e1; }
.org > ul { padding-top: 0; }
.org > ul > li { padding-top: 0; }
.org > ul > li::before, .org > ul > li::after { display: none; }
`;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

function build(list: OrgDepartment[]): Node[] {
  const ids = new Set(list.map(d => d.id));
  const nodes = new Map(list.map(d => [d.id, { ...d, children: [] as Node[], total: 0 }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) {
    const parent = n.parent_id && ids.has(n.parent_id) ? nodes.get(n.parent_id)! : null;
    (parent ? parent.children : roots).push(n);
  }
  const finish = (n: Node): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.total = n.people + n.children.reduce((s, c) => s + finish(c), 0);
    return n.total;
  };
  roots.sort((a, b) => a.name.localeCompare(b.name)).forEach(finish);
  return roots;
}

function Box({ n }: { n: Node }) {
  const c = colourClasses(n.colour);
  const teams = n.teams.filter(t => t.active);
  return <div className={`w-56 rounded-xl border bg-white shadow-sm overflow-hidden text-left ${n.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
    <div className={`h-1.5 ${c.dot}`} />
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-1.5">
        <h3 className="flex-1 text-sm font-bold leading-tight text-slate-800">{n.name}</h3>
        {n.code && <span className={`shrink-0 rounded border px-1 py-px text-[10px] font-bold ${c.chip}`}>{n.code}</span>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {n.head_user_id
          ? <><span className={`grid place-items-center w-7 h-7 rounded-full text-[11px] font-bold text-white ${c.dot}`}>{initials(n.head_name ?? '?')}</span>
            <Link to={`/people/${n.head_user_id}`} className="min-w-0 text-xs leading-tight">
              <span className="block truncate font-semibold text-slate-700 hover:text-blue-700">{n.head_name}</span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Head</span>
            </Link></>
          : <><span className="grid place-items-center w-7 h-7 rounded-full bg-slate-100 text-slate-400"><UserRound className="w-3.5 h-3.5" /></span>
            <span className="text-xs text-slate-400">No head set</span></>}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs">
        <Link to={`/admin/users?department=${encodeURIComponent(n.key)}`} className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline" title="People in this department">
          <Users className="w-3.5 h-3.5" />{n.people}
        </Link>
        {n.children.length > 0 && <span className="text-slate-500" title="Including sub-departments">{n.total} incl. sub</span>}
        {!n.is_active && <span className="ml-auto text-[10px] font-semibold uppercase text-slate-400">Archived</span>}
      </div>
      {teams.length > 0 && <div className="mt-2 flex flex-wrap gap-1">
        {teams.map(t => <span key={t.id} className="inline-flex items-center gap-1 rounded bg-slate-50 border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
          <UsersRound className="w-3 h-3 text-slate-400" />{t.name} · {t.members}
        </span>)}
      </div>}
    </div>
  </div>;
}

function Branch({ n }: { n: Node }) {
  return <li>
    <Box n={n} />
    {n.children.length > 0 && <ul>{n.children.map(c => <Branch key={c.id} n={c} />)}</ul>}
  </li>;
}

export function DepartmentOrgChart({ departments, showArchived, unassigned }: { departments: OrgDepartment[]; showArchived: boolean; unassigned?: number }) {
  const roots = build(departments.filter(d => showArchived || d.is_active));
  const total = departments.reduce((s, d) => s + d.people, 0);
  const [zoom, setZoom] = useState(() => (window.innerWidth < 1400 ? 0.75 : 1));
  const scroller = useRef<HTMLDivElement>(null);
  // Start with the company box in the middle of the view.
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; }, [zoom, roots.length]);
  const step = (d: number) => setZoom(z => Math.min(1.25, Math.max(0.4, Math.round((z + d) * 100) / 100)));
  const btn = 'p-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40';
  return <div>
    <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
      <button type="button" aria-label="Zoom out" className={btn} disabled={zoom <= 0.4} onClick={() => step(-0.15)}><Minus className="w-3.5 h-3.5" /></button>
      <button type="button" className="w-12 tabular-nums hover:text-slate-800" title="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" className={btn} disabled={zoom >= 1.25} onClick={() => step(0.15)}><Plus className="w-3.5 h-3.5" /></button>
    </div>
    <p className="mb-3 max-w-3xl text-xs text-slate-500">
      The company and its departments, top down. Each box shows the head, its people (click to list them) and its teams. Set who sits under whom with "Part of" when editing a department.
    </p>
    <style>{CSS}</style>
    <div ref={scroller} className="org overflow-x-auto pb-6">
      <ul className="min-w-max mx-auto" style={{ zoom }}>
        <li>
          <div className="w-64 rounded-2xl bg-slate-800 text-white shadow-md px-4 py-3 text-center">
            <Building2 className="w-6 h-6 mx-auto text-slate-300" />
            <div className="mt-1 text-base font-bold">Company</div>
            <div className="text-xs text-slate-300">{roots.length} departments · {total} people{unassigned ? ` · ${unassigned} without a department` : ''}</div>
          </div>
          {roots.length > 0 && <ul>{roots.map(n => <Branch key={n.id} n={n} />)}</ul>}
        </li>
      </ul>
    </div>
  </div>;
}
