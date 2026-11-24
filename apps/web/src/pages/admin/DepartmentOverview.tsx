// Admin › Departments, the Workload and Headcount tabs: booked against available hours per department
// for the next four weeks, and how many people each department has in each office.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { colourClasses } from '../../lib/departments';

type Load = { capacity: number; booked: number };
type Overview = {
  weeks: string[];
  workload: Array<{ key: string | null; people: number; weeks: Load[] }>;
  offices: Array<{ id: string; name: string }>;
  headcount: Array<{ key: string | null; office_id: string | null; people: number }>;
};
/** A department row in tree order (depth = how far under its top-level department). */
export type DepartmentRow = { key: string; name: string; colour: string; is_active: boolean; depth: number };

export const useDepartmentOverview = (enabled: boolean) => useQuery({
  queryKey: ['admin-departments', 'overview'], enabled, staleTime: 60_000,
  queryFn: () => api.get('/admin/departments/overview?weeks=4').then(r => r.data as Overview),
});

const pctOf = (l: Load) => (l.capacity > 0 ? Math.round((l.booked / l.capacity) * 100) : null);
const tone = (pct: number | null) =>
  pct === null ? { bar: 'bg-slate-300', text: 'text-slate-400' }
    : pct > 100 ? { bar: 'bg-rose-500', text: 'text-rose-700' }
      : pct >= 85 ? { bar: 'bg-amber-500', text: 'text-amber-700' }
        : { bar: 'bg-emerald-500', text: 'text-emerald-700' };
const weekLabel = (iso: string, i: number) => i === 0 ? 'This week' : `w/c ${new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap';
const sum = (loads: Load[][], i: number): Load => loads.reduce((s, w) => ({ capacity: s.capacity + w[i].capacity, booked: s.booked + w[i].booked }), { capacity: 0, booked: 0 });

/** Department rows that matter here: active ones, plus archived ones still holding people. */
function rowsFor(departments: DepartmentRow[], hasPeople: (key: string) => boolean) {
  return departments.filter(d => d.is_active || hasPeople(d.key));
}

function NameCell({ d }: { d: DepartmentRow | null }) {
  if (!d) return <td className="px-3 py-2 text-slate-500 italic">No department</td>;
  return <td className="px-3 py-2 whitespace-nowrap" style={{ paddingLeft: `${0.75 + d.depth * 1.25}rem` }}>
    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${colourClasses(d.colour).dot}`} />
    <span className="font-semibold text-slate-800">{d.name}</span>{!d.is_active && <span className="ml-1 text-xs text-slate-400">(archived)</span>}
  </td>;
}

function LoadCell({ l }: { l: Load }) {
  const pct = pctOf(l); const t = tone(pct);
  return <td className="px-3 py-2 min-w-[7.5rem]">
    <div className="flex items-baseline justify-between gap-2">
      <span className={`font-bold tabular-nums ${t.text}`}>{pct === null ? '–' : `${pct}%`}</span>
      <span className="text-[11px] text-slate-400 tabular-nums">{Math.round(l.booked)}/{Math.round(l.capacity)} h</span>
    </div>
    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${t.bar}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} /></div>
  </td>;
}

export function DepartmentWorkload({ departments }: { departments: DepartmentRow[] }) {
  const { data, isLoading, isError } = useDepartmentOverview(true);
  if (isLoading) return <p className="py-6 text-sm text-slate-500">Loading…</p>;
  if (isError || !data) return <p role="alert" className="py-6 text-sm text-rose-700">Workload could not be loaded.</p>;
  const byKey = new Map(data.workload.map(w => [w.key, w]));
  const empty = { people: 0, weeks: data.weeks.map(() => ({ capacity: 0, booked: 0 })) };
  const rows = rowsFor(departments, k => !!byKey.get(k)?.people);
  const none = byKey.get(null);
  const all = data.workload;
  return <div>
    <p className="mb-3 max-w-3xl text-xs text-slate-500">
      Hours booked (plan tasks, own tasks and regular commitments) against hours available (working calendar, capacity and leave), for each department's own people.
      Sub-departments are counted on their own row. Red is over-booked, amber 85% or more.
    </p>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200"><tr>
          <th className={th}>Department</th><th className={`${th} text-right`}>People</th>
          {data.weeks.map((w, i) => <th key={w} className={th}>{weekLabel(w, i)}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(d => { const w = byKey.get(d.key) ?? empty; return <tr key={d.key} className="border-b border-slate-100">
            <NameCell d={d} /><td className="px-3 py-2 text-right tabular-nums text-slate-600">{w.people}</td>
            {w.weeks.map((l, i) => <LoadCell key={i} l={l} />)}
          </tr>; })}
          {none && <tr className="border-b border-slate-100">
            <NameCell d={null} /><td className="px-3 py-2 text-right tabular-nums text-slate-600">{none.people}</td>
            {none.weeks.map((l, i) => <LoadCell key={i} l={l} />)}
          </tr>}
          <tr className="bg-slate-50 font-semibold">
            <td className="px-3 py-2 text-slate-700">Everyone</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-700">{all.reduce((s, w) => s + w.people, 0)}</td>
            {data.weeks.map((_, i) => <LoadCell key={i} l={sum(all.map(w => w.weeks), i)} />)}
          </tr>
        </tbody>
      </table>
    </div>
  </div>;
}

export function DepartmentHeadcount({ departments }: { departments: DepartmentRow[] }) {
  const { data, isLoading, isError } = useDepartmentOverview(true);
  if (isLoading) return <p className="py-6 text-sm text-slate-500">Loading…</p>;
  if (isError || !data) return <p role="alert" className="py-6 text-sm text-rose-700">Headcount could not be loaded.</p>;
  const count = (key: string | null, office: string | null | undefined) => data.headcount
    .filter(h => h.key === key && (office === undefined || h.office_id === office)).reduce((s, h) => s + h.people, 0);
  const columns: Array<{ id: string | null; name: string }> = [...data.offices, { id: null, name: 'No office' }]
    .filter(o => o.id !== null || data.headcount.some(h => h.office_id === null));
  const rows: Array<DepartmentRow | null> = [...rowsFor(departments, k => count(k, undefined) > 0)];
  if (data.headcount.some(h => h.key === null)) rows.push(null);
  const link = (key: string | null, office: string | null | undefined) => {
    const q = new URLSearchParams({ department: key ?? 'none' });
    if (office !== undefined) q.set('office', office ?? 'none');
    return `/admin/users?${q}`;
  };
  const cell = (n: number, to: string) => n
    ? <Link to={to} className="font-semibold text-blue-700 hover:underline tabular-nums">{n}</Link>
    : <span className="text-slate-300">·</span>;
  const total = data.headcount.reduce((s, h) => s + h.people, 0);
  return <div>
    <p className="mb-3 max-w-3xl text-xs text-slate-500">Active people in each department and office. Click a number to see those people on the Users page.</p>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200"><tr>
          <th className={th}>Department</th>
          {columns.map(o => <th key={o.id ?? 'none'} className={`${th} text-center`}>{o.name}</th>)}
          <th className={`${th} text-center`}>Total</th>
        </tr></thead>
        <tbody>
          {rows.map(d => { const key = d?.key ?? null; return <tr key={key ?? 'none'} className="border-b border-slate-100">
            <NameCell d={d} />
            {columns.map(o => <td key={o.id ?? 'none'} className="px-3 py-2 text-center">{cell(count(key, o.id), link(key, o.id))}</td>)}
            <td className="px-3 py-2 text-center bg-slate-50/60">{cell(count(key, undefined), link(key, undefined))}</td>
          </tr>; })}
          <tr className="bg-slate-50 font-semibold">
            <td className="px-3 py-2 text-slate-700">Everyone</td>
            {columns.map(o => { const n = data.headcount.filter(h => h.office_id === o.id).reduce((s, h) => s + h.people, 0);
              return <td key={o.id ?? 'none'} className="px-3 py-2 text-center tabular-nums text-slate-700">{n || '·'}</td>; })}
            <td className="px-3 py-2 text-center tabular-nums text-slate-800">{total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>;
}
