// Admin › Departments, the Org chart tab: who reports to whom, from the top (the CEO) down, using each
// person's "Reports to" on the Users page, with departments mixed in: every box carries its department's
// colour, department heads are marked, and picking a department in the legend highlights its people
// (sub-departments included) and opens the branches that lead to them.
// It opens fitted to the screen: the deepest levels fold away until the chart is readable at that size.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Maximize2, Minus, Plus, UnfoldVertical, X } from 'lucide-react';
import api from '../../lib/api';
import { departmentLabels, useDepartmentOptions, type DepartmentOption } from '../../lib/departments';

export type OrgPerson = {
  id: string; name: string; job_title: string | null; manager_id: string | null;
  department_id: string | null; department: string | null; department_colour: string | null; office: string | null;
  heads: string[];
};
export type OrgNode = OrgPerson & { reports: OrgNode[]; below: number; depth: number };
export type OrgTree = { tops: OrgNode[]; loose: OrgNode[]; maxDepth: number; people: number; byId: Map<string, OrgNode> };

/** Below this the boxes are too small to read, so the chart folds a level instead of shrinking further. */
const MIN_READABLE = 0.6;

/** Build the reporting tree. Tops are people with no manager who have reports; people with neither are "loose". */
export function buildOrgTree(people: OrgPerson[]): OrgTree {
  const byId = new Map<string, OrgNode>(people.map(p => [p.id, { ...p, heads: p.heads ?? [], reports: [], below: 0, depth: 0 }]));
  for (const n of byId.values()) if (n.manager_id && !byId.has(n.manager_id)) n.manager_id = null;
  // A loop (A reports to B, B reports to A) would hide everyone in it: the first person found in it becomes a top.
  for (const n of byId.values()) {
    const seen = new Set<string>([n.id]);
    for (let cur = n.manager_id; cur; cur = byId.get(cur)!.manager_id) {
      if (seen.has(cur)) { n.manager_id = null; break; }
      seen.add(cur);
    }
  }
  const roots: OrgNode[] = [];
  for (const n of byId.values()) (n.manager_id ? byId.get(n.manager_id)!.reports : roots).push(n);
  let maxDepth = 0;
  const finish = (n: OrgNode, depth: number): number => {
    n.depth = depth; maxDepth = Math.max(maxDepth, depth);
    // People who manage others first (they open into branches), then by department so colours sit together, then name.
    n.reports.sort((a, b) => Number(b.reports.length > 0) - Number(a.reports.length > 0)
      || (a.department ?? '￿').localeCompare(b.department ?? '￿') || a.name.localeCompare(b.name));
    n.below = n.reports.reduce((s, r) => s + 1 + finish(r, depth + 1), 0);
    return n.below;
  };
  roots.forEach(r => finish(r, 0));
  const tops = roots.filter(r => r.reports.length).sort((a, b) => b.below - a.below || a.name.localeCompare(b.name));
  const loose = roots.filter(r => !r.reports.length).sort((a, b) => a.name.localeCompare(b.name));
  return { tops, loose, maxDepth, people: people.length, byId };
}

const NAMED: Record<string, string> = {
  blue: '#3b82f6', sky: '#0ea5e9', indigo: '#6366f1', violet: '#8b5cf6', emerald: '#10b981',
  amber: '#f59e0b', orange: '#f97316', rose: '#f43f5e', teal: '#14b8a6',
};
/** For departments still on the default grey: distinct colours, used on the chart only. */
const SPARE = ['#0891b2', '#65a30d', '#c026d3', '#dc2626', '#ca8a04', '#2563eb', '#db2777', '#16a34a', '#9333ea', '#ea580c', '#0d9488', '#4f46e5', '#be123c', '#4d7c0f', '#7c2d12', '#0369a1'];

/** A colour per department: its own colour, or a spare one when it is still the default grey (or already taken). */
export function departmentPalette(options: DepartmentOption[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const ordered = departmentLabels(options);
  for (const d of ordered) {
    const c = NAMED[d.colour];
    if (c && !used.has(c)) { out.set(d.id, c); used.add(c); }
  }
  const spare = SPARE.filter(c => !used.has(c));
  let i = 0;
  for (const d of ordered) if (!out.has(d.id)) out.set(d.id, spare[i++ % spare.length]);
  return out;
}

// Connector lines: each child draws its half of the horizontal bar and a short drop to its box.
const CSS = `
.org ul { display: flex; justify-content: center; padding-top: 1.25rem; position: relative; }
.org li { display: flex; flex-direction: column; align-items: center; position: relative; padding: 1.25rem 0.375rem 0; }
.org li::before, .org li::after { content: ''; position: absolute; top: 0; width: 50%; height: 1.25rem; border-top: 2px solid #cbd5e1; }
.org li::before { right: 50%; }
.org li::after { left: 50%; border-left: 2px solid #cbd5e1; }
.org li:first-child::before, .org li:last-child::after { border-top: 0; }
.org li:last-child::before { border-right: 2px solid #cbd5e1; border-top: 2px solid #cbd5e1; border-top-right-radius: 8px; }
.org li:last-child::after { border-left: 0; }
.org li:first-child::after { border-top-left-radius: 8px; }
.org li:only-child::before { border: 0; }
.org li:only-child::after { border-top: 0; border-left: 2px solid #cbd5e1; border-radius: 0; }
.org ul ul::before { content: ''; position: absolute; top: 0; left: 50%; height: 1.25rem; border-left: 2px solid #cbd5e1; }
.org-root > li { padding-top: 0; }
.org-root > li::before, .org-root > li::after { display: none; }
.org-root { padding-top: 0 !important; gap: 2rem; }
`;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

type Ctx = {
  isOpen: (n: OrgNode) => boolean; toggle: (n: OrgNode) => void;
  colourOf: (n: OrgNode) => string | null; dim: (n: OrgNode) => boolean;
};

function Card({ n, ctx, top }: { n: OrgNode; ctx: Ctx; top?: boolean }) {
  const open = n.reports.length > 0 && ctx.isOpen(n);
  const colour = ctx.colourOf(n);
  return <div className={`w-48 rounded-lg border bg-white text-left shadow-sm transition-opacity ${top ? 'border-slate-700 ring-2 ring-slate-700/10' : 'border-slate-200'} ${ctx.dim(n) ? 'opacity-25' : ''}`}
    style={colour ? { borderLeft: `4px solid ${colour}` } : undefined}>
    <div className="flex items-start gap-2 px-2.5 py-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: colour ?? '#94a3b8' }}>{initials(n.name)}</span>
      <div className="min-w-0 flex-1">
        <Link to={`/people/${n.id}`} className="block truncate text-xs font-bold text-slate-800 hover:text-blue-700" title={n.name}>{n.name}</Link>
        <div className={`truncate text-[11px] ${n.job_title ? 'text-slate-600' : 'italic text-slate-400'}`} title={n.job_title ?? undefined}>{n.job_title || 'No position set'}</div>
        {(n.department || n.office) && <div className="truncate text-[10px] text-slate-400" title={[n.department, n.office].filter(Boolean).join(' · ')}>
          {n.department && <span className="font-semibold" style={colour ? { color: colour } : undefined}>{n.department}</span>}
          {n.department && n.office && ' · '}{n.office}
        </div>}
        {n.heads.length > 0 && <div className="mt-1 flex flex-wrap gap-1">
          {n.heads.map(h => <span key={h} className="rounded bg-slate-800 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-white">Head · {h}</span>)}
        </div>}
      </div>
    </div>
    {n.reports.length > 0 && <button type="button" onClick={() => ctx.toggle(n)} aria-expanded={open}
      aria-label={`${open ? 'Fold' : 'Open'} ${n.name}'s reports`}
      className="flex w-full items-center gap-1 rounded-b-lg border-t border-slate-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50">
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {n.reports.length} {n.reports.length === 1 ? 'report' : 'reports'}
      {n.below > n.reports.length && <span className="font-normal text-slate-400">· {n.below} in all</span>}
    </button>}
  </div>;
}

/** People with nobody open under them, in a compact grid (at most 6 rows) instead of one long row. */
function Group({ people, ctx }: { people: OrgNode[]; ctx: Ctx }) {
  const cols = Math.ceil(people.length / 6);
  const rows = Math.ceil(people.length / cols);
  return <div className="grid grid-flow-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 p-1.5" style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
    {people.map(p => <Card key={p.id} n={p} ctx={ctx} />)}
  </div>;
}

function Branch({ n, ctx, top }: { n: OrgNode; ctx: Ctx; top?: boolean }) {
  const open = n.reports.length > 0 && ctx.isOpen(n);
  const branches = open ? n.reports.filter(r => r.reports.length > 0 && ctx.isOpen(r)) : [];
  const rest = open ? n.reports.filter(r => !branches.includes(r)) : [];
  return <li>
    <Card n={n} ctx={ctx} top={top} />
    {open && <ul>
      {rest.length > 0 && <li><Group people={rest} ctx={ctx} /></li>}
      {branches.map(r => <Branch key={r.id} n={r} ctx={ctx} />)}
    </ul>}
  </li>;
}

/** Departments with people on the chart, sub-departments after their parent; click one to highlight it. */
function Legend({ options, palette, counts, selected, onSelect }: {
  options: DepartmentOption[]; palette: Map<string, string>; counts: Map<string | null, number>;
  selected: string | null; onSelect: (id: string | null) => void;
}) {
  const shown = departmentLabels(options).filter(d => counts.get(d.id));
  const chip = (id: string, label: string, n: number, colour: string | null, sub: boolean) =>
    <button key={id} type="button" aria-pressed={selected === id} onClick={() => onSelect(selected === id ? null : id)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${selected === id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'} ${selected && selected !== id ? 'opacity-60' : ''}`}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour ?? '#94a3b8' }} />
      {sub && <span className="text-slate-400">›</span>}{label}<span className={selected === id ? 'text-slate-300' : 'text-slate-400'}>{n}</span>
    </button>;
  return <div className="mb-3 flex flex-wrap items-center gap-1.5">
    {shown.map(d => chip(d.id, d.name, counts.get(d.id)!, palette.get(d.id) ?? null, !!d.parent_id))}
    {!!counts.get(null) && chip('none', 'No department', counts.get(null)!, null, false)}
    {selected && <button type="button" onClick={() => onSelect(null)} className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline"><X className="h-3 w-3" />Clear</button>}
  </div>;
}

/** Fitting: 'depth' folds whole levels, 'grow' opens the biggest folded branches while it still fits, 'zoom' only scales. */
type Fit = { phase: 'depth' } | { phase: 'grow'; queue: string[]; trial: string | null } | { phase: 'zoom' } | null;

function Chart({ tree, options }: { tree: OrgTree; options: DepartmentOption[] }) {
  const [openDepth, setOpenDepth] = useState(tree.maxDepth);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<Fit>({ phase: 'depth' });
  const [colours, setColours] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const everyone = useMemo(() => {
    const all: OrgNode[] = [];
    const walk = (n: OrgNode) => { all.push(n); n.reports.forEach(walk); };
    tree.tops.forEach(walk);
    return all;
  }, [tree]);
  const palette = useMemo(() => departmentPalette(options), [options]);
  const counts = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const n of tree.byId.values()) m.set(n.department_id, (m.get(n.department_id) ?? 0) + 1);
    return m;
  }, [tree]);
  /** The picked department and every department under it. */
  const family = useMemo(() => {
    if (!selected || selected === 'none') return null;
    const ids = new Set([selected]);
    for (let grew = true; grew;) { grew = false; for (const d of options) if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) { ids.add(d.id); grew = true; } }
    return ids;
  }, [selected, options]);
  const matches = (n: OrgNode) => !selected || (selected === 'none' ? !n.department_id : !!n.department_id && !!family?.has(n.department_id));

  // Each step changes what is open, React re-renders at 100%, and this measures again (hidden until done).
  useLayoutEffect(() => {
    if (!fit || !view.current || !inner.current) return;
    const availW = view.current.clientWidth - 8;
    const availH = Math.max(360, window.innerHeight - view.current.getBoundingClientRect().top - 24);
    const scale = Math.min(1, availW / inner.current.scrollWidth, availH / inner.current.scrollHeight);
    const finish = (s: number) => { setZoom(Math.max(0.3, Math.floor(s * 20) / 20)); setFit(null); view.current!.scrollLeft = 0; };
    const next = (queue: string[]) => {
      if (!queue.length) return finish(scale);
      const [id, ...rest] = queue;
      setOverrides(o => ({ ...o, [id]: true }));
      setFit({ phase: 'grow', queue: rest, trial: id });
    };
    if (fit.phase === 'zoom') return finish(scale);
    if (fit.phase === 'depth') {
      if (scale < MIN_READABLE && openDepth > 1) return setOpenDepth(d => d - 1);
      if (scale < MIN_READABLE || openDepth >= tree.maxDepth) return finish(scale);
      return next(everyone.filter(n => n.depth === openDepth && n.reports.length).sort((a, b) => b.below - a.below).map(n => n.id));
    }
    if (fit.trial && scale < MIN_READABLE) {
      const trial = fit.trial;
      setOverrides(o => { const c = { ...o }; delete c[trial]; return c; });
      return setFit({ phase: 'grow', queue: fit.queue, trial: null });
    }
    next(fit.queue);
  }, [fit, openDepth, overrides, everyone, tree.maxDepth]);

  const isOpen = (n: OrgNode) => overrides[n.id] ?? n.depth < openDepth;
  const ctx: Ctx = {
    isOpen, toggle: n => setOverrides(o => ({ ...o, [n.id]: !isOpen(n) })),
    colourOf: n => (colours && n.department_id ? palette.get(n.department_id) ?? null : null),
    dim: n => !matches(n),
  };
  const refit = () => { setOverrides({}); setOpenDepth(tree.maxDepth); setZoom(1); setFit({ phase: 'depth' }); };
  // Highlight a department: open just the branches that lead to its people, fold the rest, and fit that.
  const pick = (id: string | null) => {
    setSelected(id);
    if (!id) return refit();
    const ids = id === 'none' ? null : new Set([id]);
    if (ids) for (let grew = true; grew;) { grew = false; for (const d of options) if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) { ids.add(d.id); grew = true; } }
    const open: Record<string, boolean> = {};
    for (const n of everyone) {
      if (ids ? !(n.department_id && ids.has(n.department_id)) : !!n.department_id) continue;
      for (let m = n.manager_id ? tree.byId.get(n.manager_id) : undefined; m; m = m.manager_id ? tree.byId.get(m.manager_id) : undefined) open[m.id] = true;
    }
    setOverrides(open); setOpenDepth(0); setZoom(1); setFit({ phase: 'zoom' });
  };
  const step = (d: number) => setZoom(z => Math.min(1.25, Math.max(0.3, Math.round((z + d) * 100) / 100)));
  const btn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40';
  const shown = selected ? everyone.filter(matches).length : 0;

  return <div>
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <button type="button" aria-label="Zoom out" className={btn} disabled={zoom <= 0.3} onClick={() => step(-0.1)}><Minus className="h-3.5 w-3.5" /></button>
      <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" className={btn} disabled={zoom >= 1.25} onClick={() => step(0.1)}><Plus className="h-3.5 w-3.5" /></button>
      <button type="button" className={`${btn} ml-1`} onClick={() => (selected ? pick(selected) : refit())}><Maximize2 className="h-3.5 w-3.5" />Fit to screen</button>
      <button type="button" className={btn} onClick={() => { setOverrides({}); setOpenDepth(tree.maxDepth); }}><UnfoldVertical className="h-3.5 w-3.5" />Open everyone</button>
      <label className="ml-2 inline-flex items-center gap-1.5 text-slate-600"><input type="checkbox" checked={colours} onChange={e => setColours(e.target.checked)} />Department colours</label>
      <span className="ml-2">{tree.people} people · {tree.maxDepth + 1} levels{selected ? ` · ${shown} highlighted` : ''}</span>
    </div>
    <p className="mb-2 max-w-3xl text-xs text-slate-500">
      Who reports to whom, set with "Reports to" on the Users page; the colour is the person's department. Click "reports" on a box to open or fold that branch.
      Pick a department below to highlight its people (sub-departments included) and open the lines that lead to them.
    </p>
    {colours && <Legend options={options} palette={palette} counts={counts} selected={selected} onSelect={pick} />}
    <style>{CSS}</style>
    <div ref={view} className="overflow-auto pb-4">
      <div ref={inner} className="org mx-auto w-max" style={{ zoom, visibility: fit ? 'hidden' : undefined }}>
        <ul className="org-root">{tree.tops.map(n => <Branch key={n.id} n={n} ctx={ctx} top />)}</ul>
      </div>
    </div>
    {tree.loose.length > 0 && <div className="mt-2 max-w-3xl text-xs text-slate-500">
      <span className="font-semibold text-slate-600">Not in a reporting line</span> (no manager and nobody reporting to them):{' '}
      {tree.loose.map((p, i) => <span key={p.id}>{i > 0 && ', '}<Link to={`/people/${p.id}`} className="text-blue-700 hover:underline">{p.name}</Link></span>)}
    </div>}
  </div>;
}

export default function OrgChart() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['people', 'org-chart'], staleTime: 60_000,
    queryFn: () => api.get('/people/org-chart').then(r => r.data.data as OrgPerson[]),
  });
  const departments = useDepartmentOptions();
  const tree = useMemo(() => (data ? buildOrgTree(data) : null), [data]);
  if (isLoading || departments.isLoading) return <p className="py-6 text-sm text-slate-500">Loading…</p>;
  if (isError || !tree) return <p role="alert" className="py-6 text-sm text-rose-700">The org chart could not be loaded.</p>;
  if (!tree.tops.length) return <p className="py-6 text-sm text-slate-500">Nobody has "Reports to" set yet. Set it on the Users page to build the chart.</p>;
  return <Chart tree={tree} options={departments.data ?? []} />;
}
