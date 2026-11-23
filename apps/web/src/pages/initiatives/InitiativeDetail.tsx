import Breadcrumb from '../../components/ui/Breadcrumb';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, Coins, Link2, Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import InitiativeFormModal from './InitiativeFormModal';
import { LinkedPlans } from '../plans/MyPlansPage';
import LinkedArticles from '../library/LinkedArticles';
import {
  apiError, COST_CATEGORIES, CURRENCIES, hours, InitiativeDetail as Detail, LINK_TYPES, money, NEXT_STAGES, Stage, STAGES, STAGE_TONES, TYPES,
  useAddCost, useAddLink, useDeleteCost, useDeleteLink, useDeleteTime, useInitiative, useLogTime, useMoveStage,
} from './initiativesApi';

const card = 'bg-white border border-stone-200 rounded-xl';
const h2 = 'text-xs font-bold uppercase tracking-wide text-stone-400';
const input = 'border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm bg-white';
const today = () => new Date().toISOString().slice(0, 10);
const STAGE_VERB: Record<Stage, string> = { idea: 'Back to idea', approved: 'Approve', in_progress: 'Start', on_hold: 'Put on hold', done: 'Mark done', dropped: 'Drop' };

function Bar({ value, of, tone = 'bg-teal-600' }: { value: number; of: number | null; tone?: string }) {
  if (!of) return null;
  const pct = value / of;
  return <div className="mt-1.5 h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className={`h-full ${pct > 1 ? 'bg-rose-500' : tone}`} style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>;
}

/** One initiative: what and why, its stage and decisions, hours, costs, tasks and what it produced. */
export default function InitiativeDetail() {
  const { id } = useParams();
  const q = useInitiative(id);
  const [editing, setEditing] = useState(false);
  const move = useMoveStage(id ?? '');
  if (q.isLoading) return <div className="p-6 text-sm text-stone-500">Loading…</div>;
  if (q.isError || !q.data) return <div role="alert" className="p-6 text-sm text-rose-700">This initiative could not be loaded.</div>;
  const i = q.data;

  const changeStage = async (stage: Stage) => {
    const asksReason = stage === 'dropped' || stage === 'on_hold';
    const note = asksReason ? window.prompt(`${STAGE_VERB[stage]}: reason (optional)`, '') : '';
    if (note === null) return; // cancelled
    try { await move.mutateAsync({ stage, note: note || undefined }); toast.success(`${i.code}: ${STAGES[stage]}`); }
    catch (err) { toast.error(apiError(err, 'Could not change the stage')); }
  };
  const nextStages = (i.can.edit || i.can.decide) ? NEXT_STAGES[i.stage] : [];

  return <div className="p-6 max-w-6xl mx-auto">
    <div className="mb-4"><Breadcrumb items={[{ label: 'Initiatives', href: '/initiatives' }, { label: i.code }]} /></div>
    <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-teal-700">{i.code}</span>
          <span className={`px-2 py-0.5 rounded font-bold uppercase ${STAGE_TONES[i.stage]}`}>{STAGES[i.stage]}</span>
          <span className="text-stone-500">{TYPES[i.type]} · {i.priority} priority</span>
        </div>
        <h1 className="text-xl font-semibold text-stone-800 leading-tight mt-1">{i.title}</h1>
        {i.goal && <p className="text-stone-600 mt-1">{i.goal}</p>}
        <p className="text-sm text-stone-500 mt-2">
          Owner {i.owner_user_id ? <Link to={`/people/${i.owner_user_id}`} className="font-semibold text-stone-700 hover:text-teal-700">{i.owner_name}</Link> : 'not decided'}
          {' · '}Sponsor {i.sponsor_user_id ? <Link to={`/people/${i.sponsor_user_id}`} className="font-semibold text-stone-700 hover:text-teal-700">{i.sponsor_name}</Link> : 'any manager'}
          {i.target_date && <> · target {i.target_date.slice(0, 10)}</>}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {nextStages.map(s => <button key={s} onClick={() => changeStage(s)} disabled={move.isPending}
          className={`px-3 py-2 rounded-lg text-sm font-bold ${s === 'dropped' ? 'border border-stone-200 text-stone-600 bg-white' : s === 'on_hold' ? 'border border-amber-200 text-amber-800 bg-amber-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>{STAGE_VERB[s]}</button>)}
        {i.can.edit && <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm font-bold"><Pencil className="w-3.5 h-3.5" /> Edit</button>}
      </div>
    </header>
    {i.stage === 'idea' && <p className="mb-5 rounded-lg bg-violet-50 border border-violet-100 px-4 py-2 text-sm text-violet-800">
      Waiting for a decision. {i.sponsor_name ? `${i.sponsor_name} (sponsor)` : 'A manager'} approves or drops it; hours can be logged once it is approved.
    </p>}

    <div className="grid lg:grid-cols-3 gap-5">
      <div className="space-y-5">
        <section className={`${card} p-5`} aria-labelledby="ini-hours">
          <h2 id="ini-hours" className={h2}>Hours</h2>
          <div className="mt-2 text-2xl font-bold tabular-nums">{hours(i.logged_hours)} <span className="text-sm font-normal text-stone-500">logged{i.estimated_hours ? ` of ${hours(i.estimated_hours)} estimated` : ''}</span></div>
          <Bar value={i.logged_hours} of={i.estimated_hours} />
          {i.task_hours > 0 && <p className="mt-2 text-xs text-stone-500">{hours(i.task_hours)} planned in {i.task_count} task{i.task_count === 1 ? '' : 's'}</p>}
          {i.hours_by_person.length > 0 && <ul className="mt-3 space-y-1 text-sm">{i.hours_by_person.map(p => <li key={p.user_id} className="flex justify-between"><Link to={`/people/${p.user_id}`} className="hover:text-teal-700">{p.user_name}</Link><span className="tabular-nums text-stone-600">{hours(p.hours)}</span></li>)}</ul>}
        </section>
        <section className={`${card} p-5`} aria-labelledby="ini-money">
          <h2 id="ini-money" className={h2}>Costs</h2>
          <div className="mt-2 text-2xl font-bold tabular-nums">{money(i.cost_total, i.currency)} <span className="text-sm font-normal text-stone-500">{i.budget_amount != null ? `of ${money(i.budget_amount, i.currency)} budget` : 'spent'}</span></div>
          <Bar value={i.cost_total} of={i.budget_amount} tone="bg-sky-600" />
          {i.cost_unconverted > 0 && <p className="mt-2 text-xs text-amber-700">{i.cost_unconverted} cost line{i.cost_unconverted === 1 ? '' : 's'} in a currency without an exchange rate {i.cost_unconverted === 1 ? 'is' : 'are'} not in the total (set it in Admin › Exchange Rates).</p>}
          <p className="mt-2 text-xs text-stone-400">Labour is the hours above; costs are what was paid (materials, services, travel…).</p>
        </section>
        <History events={i.events} />
      </div>

      <div className="lg:col-span-2 space-y-5">
        {(i.description || i.outcome) && <section className={`${card} p-5 space-y-4`}>
          {i.description && <div><h2 className={h2}>Description</h2><p className="mt-2 text-sm text-stone-700 whitespace-pre-line">{i.description}</p></div>}
          {i.outcome && <div><h2 className={h2}>Outcome</h2><p className="mt-2 text-sm text-stone-700 whitespace-pre-line">{i.outcome}</p></div>}
        </section>}
        <section className={`${card} p-5`} aria-labelledby="ini-plans">
          <h2 id="ini-plans" className={h2}>Plans</h2>
          <p className="mt-1 mb-3 text-xs text-stone-500">Task plans with dates, dependencies and people (Gantt); their tasks count in everyone's workload.</p>
          <LinkedPlans initiativeId={i.id} />
        </section>
        <TimePanel i={i} />
        <CostsPanel i={i} />
        <TasksPanel i={i} />
        <LinksPanel i={i} />
        <LinkedArticles type="initiative" id={i.id} className="rounded-2xl" />
      </div>
    </div>
    {editing && <InitiativeFormModal initiative={i} onClose={() => setEditing(false)} />}
  </div>;
}

function History({ events }: { events: Detail['events'] }) {
  return <section className={`${card} p-5`} aria-labelledby="ini-history">
    <h2 id="ini-history" className={h2}>History</h2>
    <ol className="mt-3 space-y-2.5 text-sm">{events.map(e => <li key={e.id} className="border-l-2 border-stone-200 pl-3">
      <div className="text-stone-700">{e.from_stage ? <>{STAGES[e.from_stage]} → <strong>{STAGES[e.to_stage]}</strong></> : <strong>{e.note ?? 'Created'}</strong>}</div>
      {e.from_stage && e.note && <div className="text-xs text-stone-600">“{e.note}”</div>}
      <div className="text-[11px] text-stone-400">{e.actor_name ?? 'Someone'} · {e.created_at.slice(0, 10)}</div>
    </li>)}</ol>
  </section>;
}

function TimePanel({ i }: { i: Detail }) {
  const me = useAuthStore(s => s.user);
  const log = useLogTime(i.id);
  const del = useDeleteTime(i.id);
  const [f, setF] = useState({ work_date: today(), hours: '', note: '' });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = Number(f.hours);
    if (!h || h <= 0 || h > 24) return toast.error('Hours must be more than 0 and at most 24');
    try { await log.mutateAsync({ work_date: f.work_date, hours: h, note: f.note.trim() || undefined }); setF({ ...f, hours: '', note: '' }); toast.success('Hours logged'); }
    catch (err) { toast.error(apiError(err, 'Could not log hours')); }
  };
  return <section className={`${card}`} aria-labelledby="ini-time">
    <div className="px-5 pt-4 flex items-center gap-2"><Clock className="w-4 h-4 text-stone-400" /><h2 id="ini-time" className={h2}>Log hours</h2></div>
    {i.can.log_time ? <form onSubmit={submit} className="px-5 py-3 flex flex-wrap items-center gap-2">
      <input aria-label="Date" type="date" max={today()} value={f.work_date} onChange={e => setF({ ...f, work_date: e.target.value })} className={input} />
      <input aria-label="Hours" type="number" min={0.25} max={24} step={0.25} value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} placeholder="Hours" className={`${input} w-24`} />
      <input aria-label="What was done" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="What was done (optional)" className={`${input} flex-1 min-w-[180px]`} />
      <button disabled={log.isPending} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold">Log</button>
    </form> : <p className="px-5 py-3 text-sm text-stone-500">{i.stage === 'idea' ? 'Hours can be logged once the idea is approved.' : 'This initiative was dropped.'}</p>}
    {i.time_entries.length > 0 && <ul className="border-t border-stone-100 divide-y divide-stone-100 text-sm max-h-72 overflow-auto">{i.time_entries.map(t => <li key={t.id} className="px-5 py-2 flex items-center gap-3">
      <span className="w-24 text-stone-500 tabular-nums">{t.work_date}</span>
      <span className="w-14 font-semibold tabular-nums">{hours(t.hours)}</span>
      <span className="w-36 truncate">{t.user_name}</span>
      <span className="flex-1 truncate text-stone-500">{t.note}</span>
      {(t.user_id === me?.id || i.can.manage) && <button aria-label="Remove these hours" onClick={() => del.mutateAsync(t.id).catch(err => toast.error(apiError(err, 'Could not remove')))} className="text-stone-300 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>}
    </li>)}</ul>}
  </section>;
}

function CostsPanel({ i }: { i: Detail }) {
  const add = useAddCost(i.id);
  const del = useDeleteCost(i.id);
  const [f, setF] = useState({ cost_date: today(), category: 'materials', description: '', amount: '', currency: i.currency });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.description.trim() || !f.amount) return toast.error('Describe the cost and enter the amount');
    try { await add.mutateAsync({ ...f, description: f.description.trim(), amount: Number(f.amount) }); setF({ ...f, description: '', amount: '' }); toast.success('Cost recorded'); }
    catch (err) { toast.error(apiError(err, 'Could not record the cost')); }
  };
  return <section className={card} aria-labelledby="ini-costs">
    <div className="px-5 pt-4 flex items-center gap-2"><Coins className="w-4 h-4 text-stone-400" /><h2 id="ini-costs" className={h2}>Costs</h2></div>
    {i.can.edit && <form onSubmit={submit} className="px-5 py-3 flex flex-wrap items-center gap-2">
      <input aria-label="Date" type="date" value={f.cost_date} onChange={e => setF({ ...f, cost_date: e.target.value })} className={input} />
      <select aria-label="Category" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} className={input}>{Object.entries(COST_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input aria-label="Description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Description" className={`${input} flex-1 min-w-[160px]`} />
      <input aria-label="Amount" type="number" min={0} step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="Amount" className={`${input} w-28`} />
      <select aria-label="Currency" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} className={input}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
      <button disabled={add.isPending} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold">Add</button>
    </form>}
    {i.costs.length === 0 ? <p className="px-5 pb-4 text-sm text-stone-500">No costs recorded.</p>
      : <ul className="border-t border-stone-100 divide-y divide-stone-100 text-sm">{i.costs.map(c => <li key={c.id} className="px-5 py-2 flex items-center gap-3">
        <span className="w-24 text-stone-500 tabular-nums">{c.cost_date}</span>
        <span className="w-32 text-stone-500">{COST_CATEGORIES[c.category]}</span>
        <span className="flex-1 truncate">{c.description}{c.supplier_name ? ` · ${c.supplier_name}` : ''}</span>
        <span className="font-semibold tabular-nums">{money(c.amount, c.currency)}</span>
        {i.can.edit && <button aria-label={`Remove ${c.description}`} onClick={() => del.mutateAsync(c.id).catch(err => toast.error(apiError(err, 'Could not remove')))} className="text-stone-300 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>}
      </li>)}</ul>}
  </section>;
}

function TasksPanel({ i }: { i: Detail }) {
  return <section className={`${card} p-5`} aria-labelledby="ini-tasks">
    <h2 id="ini-tasks" className={h2}>Tasks <span className="font-normal">({i.tasks_done}/{i.task_count} done)</span></h2>
    {i.tasks.length === 0 ? <p className="mt-2 text-sm text-stone-500">No tasks yet. In My Work (Home), add a task and choose this initiative under “For”.</p>
      : <ul className="mt-3 divide-y divide-stone-100 text-sm">{i.tasks.map(t => <li key={t.id} className="py-2 flex flex-wrap items-center gap-3">
        <span className={`flex-1 min-w-[160px] ${t.status === 'done' ? 'line-through text-stone-400' : 'text-stone-800'}`}>{t.title}</span>
        <Link to={`/people/${t.user_id}`} className="text-xs text-stone-500 hover:text-teal-700">{t.user_name}</Link>
        {t.planned_hours ? <span className="text-xs text-stone-500">{hours(t.planned_hours)}</span> : null}
        <span className="text-xs text-stone-500 w-24 text-right">{t.due_date ?? '—'}</span>
        <span className="text-xs text-stone-500 w-10 text-right">{t.progress_pct}%</span>
      </li>)}</ul>}
  </section>;
}

const LINK_HREF: Record<string, (id: string) => string> = {
  product: id => `/products/masters/${id}`, product_family: id => `/products`, document: id => `/documents/${id}`,
  project: id => `/projects/${id}`, client: id => `/clients/${id}`,
};
const SEARCH_TYPE: Record<string, string> = { product: 'product', document: 'document', project: 'project', client: 'client' };

function LinksPanel({ i }: { i: Detail }) {
  const add = useAddLink(i.id);
  const del = useDeleteLink(i.id);
  const [type, setType] = useState('product');
  const [text, setText] = useState('');
  const found = useQuery({
    queryKey: ['initiative-link-search', type, text.trim()],
    queryFn: () => api.get('/search', { params: { q: text.trim(), type: SEARCH_TYPE[type], page_size: 8 } }).then(r => r.data.results as Array<{ id: string; code: string | null; name: string }>),
    enabled: text.trim().length >= 2,
  });
  const pick = async (entityId: string) => {
    try { await add.mutateAsync({ entity_type: type, entity_id: entityId }); setText(''); toast.success('Linked'); }
    catch (err) { toast.error(apiError(err, 'Could not link')); }
  };
  return <section className={`${card} p-5`} aria-labelledby="ini-links">
    <div className="flex items-center gap-2"><Link2 className="w-4 h-4 text-stone-400" /><h2 id="ini-links" className={h2}>What it produced or relates to</h2></div>
    {i.links.length === 0 ? <p className="mt-2 text-sm text-stone-500">Nothing linked yet: the products it creates, documents it writes, projects or companies involved.</p>
      : <ul className="mt-3 space-y-1.5 text-sm">{i.links.map(l => <li key={l.id} className="flex items-center gap-2">
        <span className="text-xs w-24 text-stone-500">{LINK_TYPES[l.entity_type]}</span>
        <Link to={LINK_HREF[l.entity_type](l.entity_id)} className="font-semibold hover:text-teal-700">{l.code && <span className="font-mono text-xs text-stone-500 mr-1.5">{l.code}</span>}{l.label ?? 'Removed record'}</Link>
        {i.can.edit && <button aria-label={`Unlink ${l.label}`} onClick={() => del.mutateAsync(l.id).catch(err => toast.error(apiError(err, 'Could not unlink')))} className="ml-auto text-stone-300 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>}
      </li>)}</ul>}
    {i.can.edit && <div className="mt-4 flex flex-wrap items-start gap-2">
      <select aria-label="Link type" value={type} onChange={e => setType(e.target.value)} className={input}>
        {Object.keys(SEARCH_TYPE).map(k => <option key={k} value={k}>{LINK_TYPES[k as keyof typeof LINK_TYPES]}</option>)}
      </select>
      <div className="relative flex-1 min-w-[200px]">
        <input aria-label="Find a record to link" value={text} onChange={e => setText(e.target.value)} placeholder="Search by name or code…" className={`${input} w-full`} />
        {text.trim().length >= 2 && <ul className="absolute z-20 mt-1 w-full rounded-lg border border-stone-200 bg-white shadow-lg text-sm max-h-64 overflow-auto">
          {found.isLoading && <li className="px-3 py-2 text-stone-500">Searching…</li>}
          {found.data?.length === 0 && <li className="px-3 py-2 text-stone-500">Nothing found</li>}
          {found.data?.map(r => <li key={r.id}><button type="button" onClick={() => pick(r.id)} className="w-full text-left px-3 py-2 hover:bg-teal-50">
            {r.code && <span className="font-mono text-xs text-stone-500 mr-2">{r.code}</span>}{r.name}
          </button></li>)}
        </ul>}
      </div>
    </div>}
  </section>;
}
