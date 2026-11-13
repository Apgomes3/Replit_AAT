import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Palmtree } from 'lucide-react';
import { groupRowsByTeam, usePlanningScope, useScopedTeams, useWorkload, WorkloadRow, WorkloadWeek } from './planningApi';
import PeopleFilterSelect, { parsePeopleFilter } from './PeopleFilterSelect';
import { addDays, todayIso } from './taskTiming';
import { useAuthStore } from '../../store/authStore';

const WEEKS = 8;

const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function load(w: WorkloadWeek) {
  if (!w.capacity) return w.booked ? 'over' : 'none';
  const p = w.booked / w.capacity;
  return p > 1.0001 ? 'over' : p >= 0.9 ? 'full' : 'free';
}
const CELL: Record<string, string> = {
  over: 'bg-rose-50 text-rose-700 border-rose-200',
  full: 'bg-amber-50 text-amber-800 border-amber-200',
  free: 'bg-[#e4f2ee] text-[#087f73] border-[#b8d9d0]',
  none: 'bg-stone-50 text-stone-400 border-stone-200',
};

/**
 * Each person's booked hours per week across every plan, against what they can work.
 * In Drafting it opens on the manager's own team; in Resources on the whole company, grouped by team.
 */
export default function WorkloadPanel() {
  const company = usePlanningScope() === 'company';
  const teams = useScopedTeams();
  const userId = useAuthStore(s => s.user?.id);
  const active = (teams.data ?? []).filter(t => t.active);
  const mine = active.find(t => t.manager?.id === userId) ?? active[0];
  // Drafting starts on "my team" once the teams are known; Resources starts on the whole company.
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? (company || !mine ? '' : `team:${mine.id}`);
  const filter = parsePeopleFilter(value);
  const team = filter.teamId ? active.find(t => t.id === filter.teamId) : undefined;
  const [from, setFrom] = useState(() => mondayOf(todayIso()));
  const workload = useWorkload(filter, from, WEEKS, company || picked !== null || !teams.isLoading);
  const [open, setOpen] = useState<{ user: string; week: string } | null>(null);
  const [showLoose, setShowLoose] = useState(false);

  const rows = workload.data?.data ?? [];
  // Drafting groups "Everyone" by its own teams only; Resources by every company team.
  const groupDept = filter.department ?? (company ? undefined : 'Drafting');
  const sections = useMemo(() => filter.teamId ? null : groupRowsByTeam(rows, groupDept), [rows, filter.teamId, groupDept]);
  const totals = useMemo(() => {
    const t = { capacity: 0, booked: 0, over: 0 };
    rows.forEach(r => r.weeks.slice(0, 4).forEach(w => { t.capacity += w.capacity; t.booked += w.booked; if (load(w) === 'over') t.over++; }));
    return { capacity: Math.round(t.capacity), booked: Math.round(t.booked), over: t.over };
  }, [rows]);
  const freeNext = useMemo(() => rows.map(r => ({ r, free: (r.weeks[1]?.capacity ?? 0) - (r.weeks[1]?.booked ?? 0) }))
    .filter(x => x.free > 0).sort((a, b) => b.free - a.free)[0], [rows]);

  const openRow = open && rows.find(r => r.user_id === open.user);
  const openWeek = openRow?.weeks.find(w => w.week_start === open!.week);

  return <div>
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <PeopleFilterSelect value={value} onChange={v => { setPicked(v); setOpen(null); }} />
      {team ? <span className="text-sm text-[#6f8082]">Manager: {team.manager?.name ?? '—'} · {rows.length} people</span>
        : workload.data && <span className="text-sm text-[#6f8082]">{rows.length} people</span>}
      <div className="ml-auto flex items-center gap-1">
        <button aria-label="Earlier weeks" onClick={() => setFrom(addDays(from, -7))} className="p-2 rounded-lg border border-[#dce7e2] bg-white"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => setFrom(mondayOf(todayIso()))} className="px-3 py-2 rounded-lg border border-[#dce7e2] bg-white text-xs font-bold">This week</button>
        <button aria-label="Later weeks" onClick={() => setFrom(addDays(from, 7))} className="p-2 rounded-lg border border-[#dce7e2] bg-white"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <Stat label="Capacity, next 4 weeks" value={`${totals.capacity} h`} />
      <Stat label="Booked, next 4 weeks" value={`${totals.booked} h`} />
      <Stat label="Overbooked weeks" value={String(totals.over)} tone={totals.over ? 'text-rose-700' : undefined} />
      <Stat label="Most free next week" value={freeNext ? `${freeNext.r.name.split(' ')[0]}, ${Math.round(freeNext.free)} h` : '—'} tone="text-[#087f73]" />
    </div>

    {workload.isLoading ? <div className="h-40 skeleton rounded-xl" />
      : workload.isError ? <p className="text-sm text-rose-700">The workload could not be loaded.</p>
      : !rows.length ? <p className="text-sm text-[#6f8082]">This team has no members yet. Add people in the Teams tab.</p>
      : <div className="bg-white rounded-xl border border-[#dce7e2] overflow-x-auto shadow-sm">
          <table className="w-full text-sm min-w-[900px]">
            <thead><tr className="bg-[#f2f7f4] border-b border-[#dce7e2]">
              <th className="text-left px-4 py-2 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold w-56">Person</th>
              {rows[0]!.weeks.map(w => <th key={w.week_start} className="px-2 py-2 text-[10px] uppercase tracking-[.1em] text-[#6f8082] font-extrabold">
                {w.week_start === mondayOf(todayIso()) ? 'This week' : `Wk ${fmtWeek(w.week_start)}`}</th>)}
            </tr></thead>
            <tbody>{sections
              ? sections.map(s => {
                  const hidden = !s.team && !showLoose;
                  return <Fragment key={s.key}>
                    <tr className="bg-[#f8fbf9] border-b border-[#edf2ef]">
                      <td colSpan={WEEKS + 1} className="px-4 py-1.5">
                        {s.team
                          ? <span className="text-xs font-extrabold text-[#20333a]">{s.team.name}
                              <span className="ml-2 font-semibold text-[#8a9b9a]">{s.team.department} · {s.rows.length} {s.rows.length === 1 ? 'person' : 'people'}</span></span>
                          : <button onClick={() => setShowLoose(v => !v)} className="inline-flex items-center gap-1 text-xs font-extrabold text-[#6f8082]">
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${hidden ? '-rotate-90' : ''}`} />
                              {company ? 'Not in a team' : 'Not in a drafting team'} · {s.rows.length} {s.rows.length === 1 ? 'person' : 'people'}</button>}
                      </td>
                    </tr>
                    {!hidden && s.rows.map(r => <PersonRow key={`${s.key}:${r.user_id}`} row={r} open={open} onOpen={setOpen} />)}
                  </Fragment>;
                })
              : rows.map(r => <PersonRow key={r.user_id} row={r} open={open} onOpen={setOpen} />)}</tbody>
          </table>
        </div>}

    <div className="flex flex-wrap gap-4 mt-2 text-xs text-[#6f8082]">
      <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-[#e4f2ee] border border-[#b8d9d0] mr-1 align-[-1px]" />Room left</span>
      <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-50 border border-amber-200 mr-1 align-[-1px]" />90–100%</span>
      <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-50 border border-rose-200 mr-1 align-[-1px]" />Overbooked</span>
      <span className="ml-auto">Booked hours come from every project's plans. Finished tasks and completed plans are not counted. Click a week to see its tasks.</span>
    </div>

    {openRow && openWeek && <div className="mt-4 bg-white rounded-xl border border-[#dce7e2] p-4 shadow-sm">
      <h3 className="font-extrabold text-sm">{openRow.name} · week of {fmtWeek(openWeek.week_start)}</h3>
      <p className="text-xs text-[#6f8082] mt-0.5">{openWeek.booked} h booked of {openWeek.capacity} h available{openWeek.leave ? ` (${openWeek.leave} h leave)` : ''} · calendar {openRow.calendar_name}{openRow.capacity_pct < 100 ? ` at ${openRow.capacity_pct}%` : ''}</p>
      {openWeek.tasks.length
        ? <ul className="mt-3 divide-y divide-[#edf2ef]">{openWeek.tasks.map(t => <li key={t.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="font-mono text-xs text-[#6f8082] w-20">{t.project_code}</span>
            <Link to={`/drafting/plans/${t.plan_id}`} className="flex-1 font-semibold hover:text-[#087f73] truncate">{t.title}</Link>
            <span className="text-xs text-[#6f8082]">{t.plan_code}</span>
            <span className="w-14 text-right tabular-nums font-bold">{t.hours} h</span>
          </li>)}</ul>
        : <p className="mt-3 text-sm text-[#6f8082]">No tasks booked this week.</p>}
    </div>}
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="bg-white rounded-xl border border-[#dce7e2] px-4 py-3">
    <div className="text-xs text-[#6f8082]">{label}</div>
    <div className={`text-xl font-extrabold mt-0.5 ${tone ?? ''}`}>{value}</div>
  </div>;
}

function PersonRow({ row, open, onOpen }: { row: WorkloadRow; open: { user: string; week: string } | null; onOpen: (o: { user: string; week: string } | null) => void }) {
  return <tr className="border-b border-[#edf2ef] last:border-0">
    <td className="px-4 py-2">
      <div className="font-semibold">{row.name}</div>
      <div className="text-[11px] text-[#8a9b9a]">{row.calendar_name}{row.capacity_pct < 100 ? ` · ${row.capacity_pct}%` : ''}</div>
    </td>
    {row.weeks.map(w => {
      const state = load(w);
      const selected = open?.user === row.user_id && open.week === w.week_start;
      return <td key={w.week_start} className="px-1.5 py-1.5">
        <button onClick={() => onOpen(selected ? null : { user: row.user_id, week: w.week_start })}
          title={`${w.booked} h booked of ${w.capacity} h${w.leave ? `, ${w.leave} h leave` : ''}`}
          className={`w-full rounded-md border px-2 py-1.5 text-xs font-bold tabular-nums ${CELL[state]} ${selected ? 'ring-2 ring-[#087f73]' : ''}`}>
          {Math.round(w.booked)} / {Math.round(w.capacity)} h
          {w.leave > 0 && <Palmtree className="inline w-3 h-3 ml-1 -mt-0.5" aria-label="Has leave" />}
        </button>
      </td>;
    })}
  </tr>;
}
