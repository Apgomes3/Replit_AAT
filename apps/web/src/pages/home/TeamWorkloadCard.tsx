// Home page: a brief summary of the team's workload allocation — booked against available hours for
// the next four weeks, and each person's load this week. Hidden for people with no team.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, UsersRound } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

type Load = { capacity: number; booked: number };
export type TeamWorkload = {
  basis: 'manager' | 'member' | 'none';
  team_names: string[];
  weeks: Array<Load & { week_start: string }>;
  people: Array<{ user_id: string; name: string; weeks: Load[] }>;
};

/** Booked as a share of available hours; null when nothing is available (leave, no calendar). */
export const loadPct = (l: Load) => (l.capacity > 0 ? Math.round((l.booked / l.capacity) * 100) : null);
const tone = (pct: number | null) =>
  pct === null ? { bar: 'bg-stone-300', text: 'text-stone-400' }
    : pct > 100 ? { bar: 'bg-rose-500', text: 'text-rose-700' }
      : pct >= 85 ? { bar: 'bg-amber-500', text: 'text-amber-700' }
        : { bar: 'bg-emerald-500', text: 'text-emerald-700' };
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const h = (n: number) => `${Math.round(n)} h`;

export default function TeamWorkloadCard() {
  const user = useAuthStore(s => s.user);
  const [week, setWeek] = useState(0);
  const { data } = useQuery({
    queryKey: ['my-work', 'team-workload'],
    queryFn: () => api.get('/my-work/team-workload?weeks=4').then(r => r.data as TeamWorkload),
    staleTime: 60_000,
  });
  if (!data?.people?.length || !data.weeks?.length) return null;
  const canOpenResources = user?.role === 'admin' || (user?.moduleAccess?.resources ?? 'hidden') !== 'hidden';
  const title = data.basis === 'manager' ? 'Your team' : 'Your teams';
  const sub = data.team_names.length ? data.team_names.join(', ') : 'People who report to you';
  const people = [...data.people]
    .map(p => ({ ...p, load: p.weeks[week], pct: loadPct(p.weeks[week]) }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name));
  const over = people.filter(p => (p.pct ?? 0) > 100).length;
  const free = people.filter(p => p.pct !== null && p.pct < 50).length;

  return <section aria-label="Team workload" className="mb-8 bg-white rounded-2xl border border-stone-200/70 shadow-sm p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-sm font-bold text-stone-800 flex items-center gap-1.5"><UsersRound className="w-4 h-4 text-blue-600" /> {title} workload</h2>
        <p className="text-[11px] text-stone-500 mt-0.5">{sub} · {data.people.length} {data.people.length === 1 ? 'person' : 'people'} · booked against available hours</p>
      </div>
      {canOpenResources && <Link to="/resources" className="text-xs font-semibold text-blue-600 inline-flex items-center gap-1 hover:underline">Resources <ArrowRight className="w-3.5 h-3.5" /></Link>}
    </div>

    <div role="tablist" aria-label="Week" className="mt-3 grid grid-cols-4 gap-2">
      {data.weeks.map((w, i) => {
        const pct = loadPct(w); const t = tone(pct);
        return <button key={w.week_start} role="tab" aria-selected={i === week} onClick={() => setWeek(i)}
          className={`text-left rounded-lg border px-2.5 py-2 transition-colors ${i === week ? 'border-blue-300 bg-blue-50/60' : 'border-stone-100 hover:bg-stone-50'}`}>
          <div className="text-[11px] text-stone-500">{i === 0 ? 'This week' : `w/c ${weekLabel(w.week_start)}`}</div>
          <div className={`text-lg font-bold tabular-nums ${t.text}`}>{pct === null ? '–' : `${pct}%`}</div>
          <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className={`h-full ${t.bar}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} /></div>
          <div className="mt-1 text-[11px] text-stone-400 tabular-nums">{h(w.booked)} of {h(w.capacity)}</div>
        </button>;
      })}
    </div>

    <p className="mt-3 text-[11px] text-stone-500">
      {over ? <span className="text-rose-700 font-semibold">{over} over-booked</span> : 'Nobody over-booked'}
      {free ? ` · ${free} under half booked` : ''}
    </p>
    <ul aria-label="Load per person" className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 max-h-[9.5rem] overflow-y-auto overscroll-contain pr-1">
      {people.map(p => {
        const t = tone(p.pct);
        return <li key={p.user_id} className="flex items-center gap-2 text-xs">
          <Link to={`/people/${p.user_id}`} className="w-36 truncate text-stone-700 hover:text-blue-700">{p.name}</Link>
          <div className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden" title={`${h(p.load.booked)} of ${h(p.load.capacity)}`}>
            <div className={`h-full ${t.bar}`} style={{ width: `${Math.min(p.pct ?? 0, 100)}%` }} />
          </div>
          <span className={`w-11 text-right tabular-nums font-semibold ${t.text}`}>{p.pct === null ? '–' : `${p.pct}%`}</span>
        </li>;
      })}
    </ul>
  </section>;
}
