// Admin › Departments, the Org chart tab: who reports to whom, from the top (the CEO) down, using each
// person's "Reports to" on the Users page. It opens fitted to the screen: the deepest levels fold away
// until the chart is readable at that size, and any branch can be opened or folded again.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Maximize2, Minus, Plus, UnfoldVertical } from 'lucide-react';
import api from '../../lib/api';
import { colourClasses } from '../../lib/departments';

export type OrgPerson = {
  id: string; name: string; job_title: string | null; manager_id: string | null;
  department: string | null; department_colour: string | null; office: string | null;
};
export type OrgNode = OrgPerson & { reports: OrgNode[]; below: number; depth: number };
export type OrgTree = { tops: OrgNode[]; loose: OrgNode[]; maxDepth: number; people: number };

/** Below this the boxes are too small to read, so the chart folds a level instead of shrinking further. */
const MIN_READABLE = 0.6;

/** Build the reporting tree. Tops are people with no manager who have reports; people with neither are "loose". */
export function buildOrgTree(people: OrgPerson[]): OrgTree {
  const byId = new Map<string, OrgNode>(people.map(p => [p.id, { ...p, reports: [], below: 0, depth: 0 }]));
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
    // People who manage others first (they open into branches), then by name.
    n.reports.sort((a, b) => Number(b.reports.length > 0) - Number(a.reports.length > 0) || a.name.localeCompare(b.name));
    n.below = n.reports.reduce((s, r) => s + 1 + finish(r, depth + 1), 0);
    return n.below;
  };
  roots.forEach(r => finish(r, 0));
  const tops = roots.filter(r => r.reports.length).sort((a, b) => b.below - a.below || a.name.localeCompare(b.name));
  const loose = roots.filter(r => !r.reports.length).sort((a, b) => a.name.localeCompare(b.name));
  return { tops, loose, maxDepth, people: people.length };
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
.org li:only-child::after { border-left: 2px solid #cbd5e1; border-radius: 0; }
.org li:only-child::before { border: 0; }
.org li:only-child::after { border-top: 0; border-left: 2px solid #cbd5e1; border-radius: 0; }
.org ul ul::before { content: ''; position: absolute; top: 0; left: 50%; height: 1.25rem; border-left: 2px solid #cbd5e1; }
.org-root > li { padding-top: 0; }
.org-root > li::before, .org-root > li::after { display: none; }
.org-root { padding-top: 0 !important; gap: 2rem; }
`;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

type Ctx = { isOpen: (n: OrgNode) => boolean; toggle: (n: OrgNode) => void };

function Card({ n, ctx, top }: { n: OrgNode; ctx: Ctx; top?: boolean }) {
  const open = n.reports.length > 0 && ctx.isOpen(n);
  const avatar = n.department_colour ? colourClasses(n.department_colour).dot : 'bg-slate-400';
  return <div className={`w-48 rounded-lg border bg-white text-left shadow-sm ${top ? 'border-slate-700 ring-2 ring-slate-700/10' : 'border-slate-200'}`}>
    <div className="flex items-start gap-2 px-2.5 py-2">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${avatar}`}>{initials(n.name)}</span>
      <div className="min-w-0 flex-1">
        <Link to={`/people/${n.id}`} className="block truncate text-xs font-bold text-slate-800 hover:text-blue-700" title={n.name}>{n.name}</Link>
        <div className={`truncate text-[11px] ${n.job_title ? 'text-slate-600' : 'italic text-slate-400'}`} title={n.job_title ?? undefined}>{n.job_title || 'No position set'}</div>
        {(n.department || n.office) && <div className="truncate text-[10px] text-slate-400">{[n.department, n.office].filter(Boolean).join(' · ')}</div>}
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

/** Fitting on open: first fold whole levels ('depth'), then open the biggest folded branches one by one while it still fits ('grow'). */
type Fit = { phase: 'depth' } | { phase: 'grow'; queue: string[]; trial: string | null } | null;

function Chart({ tree }: { tree: OrgTree }) {
  const [openDepth, setOpenDepth] = useState(tree.maxDepth);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<Fit>({ phase: 'depth' });
  const view = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const everyone = useMemo(() => {
    const all: OrgNode[] = [];
    const walk = (n: OrgNode) => { all.push(n); n.reports.forEach(walk); };
    tree.tops.forEach(walk);
    return all;
  }, [tree]);

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
  const ctx: Ctx = { isOpen, toggle: n => setOverrides(o => ({ ...o, [n.id]: !isOpen(n) })) };
  const refit = (depth: number) => { setOverrides({}); setOpenDepth(depth); setZoom(1); setFit({ phase: 'depth' }); };
  const step = (d: number) => setZoom(z => Math.min(1.25, Math.max(0.3, Math.round((z + d) * 100) / 100)));
  const btn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40';

  return <div>
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <button type="button" aria-label="Zoom out" className={btn} disabled={zoom <= 0.3} onClick={() => step(-0.1)}><Minus className="h-3.5 w-3.5" /></button>
      <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" className={btn} disabled={zoom >= 1.25} onClick={() => step(0.1)}><Plus className="h-3.5 w-3.5" /></button>
      <button type="button" className={`${btn} ml-1`} onClick={() => refit(tree.maxDepth)}><Maximize2 className="h-3.5 w-3.5" />Fit to screen</button>
      <button type="button" className={btn} onClick={() => { setOverrides({}); setOpenDepth(tree.maxDepth); }}><UnfoldVertical className="h-3.5 w-3.5" />Open everyone</button>
      <span className="ml-2">{tree.people} people · {tree.maxDepth + 1} levels</span>
    </div>
    <p className="mb-3 max-w-3xl text-xs text-slate-500">
      Who reports to whom, set with "Reports to" on the Users page. Click "reports" on a box to open or fold that branch; people with nobody under them are grouped in a box under their manager.
    </p>
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
  const tree = useMemo(() => (data ? buildOrgTree(data) : null), [data]);
  if (isLoading) return <p className="py-6 text-sm text-slate-500">Loading…</p>;
  if (isError || !tree) return <p role="alert" className="py-6 text-sm text-rose-700">The org chart could not be loaded.</p>;
  if (!tree.tops.length) return <p className="py-6 text-sm text-slate-500">Nobody has "Reports to" set yet. Set it on the Users page to build the chart.</p>;
  return <Chart tree={tree} />;
}
