import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lightbulb, Plus, Search } from 'lucide-react';
import InitiativeFormModal from './InitiativeFormModal';
import { hours, Initiative, money, Stage, STAGES, STAGE_TONES, TYPES, useInitiatives } from './initiativesApi';

const COLUMNS: Stage[] = ['idea', 'approved', 'in_progress', 'on_hold', 'done'];
const PRIORITY_DOT = { high: 'bg-rose-500', medium: 'bg-amber-400', low: 'bg-stone-300' } as const;

function Card({ i }: { i: Initiative }) {
  const over = i.estimated_hours ? i.logged_hours > i.estimated_hours : false;
  return <Link to={`/initiatives/${i.id}`} className="block rounded-xl border border-stone-200 bg-white p-3 hover:border-teal-300 hover:shadow-sm">
    <div className="flex items-center gap-2 text-[11px] text-stone-500">
      <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[i.priority]}`} title={`${i.priority} priority`} />
      <span className="font-mono">{i.code}</span><span className="truncate">{TYPES[i.type]}</span>
    </div>
    <div className="mt-1 text-sm font-semibold text-stone-800 leading-snug">{i.title}</div>
    {i.goal && <div className="mt-0.5 text-xs text-stone-500 line-clamp-2">{i.goal}</div>}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500">
      {i.owner_name && <span>{i.owner_name}</span>}
      {i.target_date && <span>by {i.target_date.slice(0, 10)}</span>}
      {(i.logged_hours > 0 || i.estimated_hours) && <span className={over ? 'text-rose-600 font-semibold' : ''}>{hours(i.logged_hours)}{i.estimated_hours ? ` / ${hours(i.estimated_hours)}` : ''}</span>}
      {(i.cost_total > 0 || i.budget_amount) && <span>{money(i.cost_total, i.currency)}{i.budget_amount ? ` / ${money(i.budget_amount, i.currency)}` : ''}</span>}
      {i.task_count > 0 && <span>{i.tasks_done}/{i.task_count} tasks</span>}
    </div>
  </Link>;
}

/** Internal work by stage: ideas waiting for a decision, approved, running, on hold, done. */
export default function InitiativesBoard() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [mine, setMine] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const [proposing, setProposing] = useState(false);
  const list = useInitiatives({ search: search.trim(), type, mine });
  const rows = list.data ?? [];
  const columns = showDropped ? [...COLUMNS, 'dropped' as Stage] : COLUMNS;

  return <div className="p-6">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Internal work</div>
        <h1 className="text-2xl font-extrabold mt-2">Initiatives</h1>
        <p className="text-sm text-stone-500 mt-1">New products, better processes, standards, tools and training: work that is not a client project.</p>
      </div>
      <button onClick={() => setProposing(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#087f73] text-white text-sm font-bold"><Plus className="w-4 h-4" /> Propose an initiative</button>
    </header>

    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative w-full max-w-xs">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
        <input aria-label="Search initiatives" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, code or goal…" className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-lg bg-white text-sm" />
      </div>
      <select aria-label="Type" value={type} onChange={e => setType(e.target.value)} className="px-3 py-2 border border-stone-200 rounded-lg bg-white text-sm">
        <option value="">All types</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <label className="text-sm text-stone-600 inline-flex items-center gap-1.5"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Mine (owner, sponsor or proposer)</label>
      <label className="text-sm text-stone-600 inline-flex items-center gap-1.5"><input type="checkbox" checked={showDropped} onChange={e => setShowDropped(e.target.checked)} /> Show dropped</label>
    </div>

    {list.isError ? <p className="text-sm text-rose-700">Initiatives could not be loaded.</p>
      : list.isLoading ? <div className="grid md:grid-cols-5 gap-3">{COLUMNS.map(c => <div key={c} className="h-40 skeleton rounded-xl" />)}</div>
      : rows.length === 0 && !search && !type && !mine ? <div className="rounded-xl border border-dashed border-stone-300 p-12 text-center">
          <Lightbulb className="w-9 h-9 mx-auto text-stone-300 mb-3" />
          <p className="font-bold">No initiatives yet</p>
          <p className="text-sm text-stone-500 mt-1">Propose the first one: an improvement, a new product, a standard to write…</p>
        </div>
      : <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}>
          {columns.map(stage => {
            const items = rows.filter(i => i.stage === stage);
            return <section key={stage} aria-label={STAGES[stage]} className="rounded-xl bg-stone-50 border border-stone-200 p-2 min-h-[160px]">
              <div className="flex items-center justify-between px-1 pb-2">
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${STAGE_TONES[stage]}`}>{STAGES[stage]}</span>
                <span className="text-xs text-stone-400">{items.length}</span>
              </div>
              <div className="space-y-2">{items.map(i => <Card key={i.id} i={i} />)}</div>
            </section>;
          })}
        </div>}

    {proposing && <InitiativeFormModal onClose={() => setProposing(false)} onSaved={i => navigate(`/initiatives/${i.id}`)} />}
  </div>;
}
