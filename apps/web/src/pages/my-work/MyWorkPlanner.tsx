import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Diamond, Inbox, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiErrorMessage } from '../drafting/draftingApi';
import { addDays, todayIso } from '../drafting/taskTiming';
import type { WorkloadWeek } from '../drafting/planningApi';
import {
  BUCKET_LABELS, Commitment, CommitmentKind, CommitmentPayload, describeCommitment, groupWork, toWorkItems, useDeleteCommitment,
  useDeletePersonalTask, useLinkOptions, useMyProjects, useMyWork, useSaveCommitment, useSavePersonalTask, useUpdatePlanTask, WEEKDAY_SHORT,
  WorkItem,
} from './myWorkApi';
import GoogleCalendarCard from './GoogleCalendarCard';

const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
const fmt = (iso: string | null) => iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
const input = 'border border-[#dce7e2] rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#087f73]/30';

/** The signed-in person's planner: their week, every task they have (plans and their own), and standing commitments. */
export default function MyWorkPlanner() {
  const today = todayIso();
  const [from, setFrom] = useState(() => mondayOf(today));
  const work = useMyWork(from);
  const items = useMemo(() => work.data ? toWorkItems(work.data) : [], [work.data]);
  const groups = useMemo(() => groupWork(items, today), [items, today]);
  const [showDone, setShowDone] = useState(false);

  return <section aria-labelledby="my-work-title" className="mb-10 animate-fade-in-up">
    <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
      <div>
        <h2 id="my-work-title" className="text-lg font-bold text-stone-800">My work</h2>
        <p className="text-xs text-stone-500">Everything assigned to you across all plans, your own tasks and your regular commitments.
          {work.data && <> Calendar: {work.data.calendar_name}{work.data.capacity_pct < 100 ? ` at ${work.data.capacity_pct}%` : ''}.</>}</p>
      </div>
      <Link to="/my-work" className="text-xs font-semibold text-[#087f73] hover:underline">Approvals and records assigned to me →</Link>
    </div>

    <WeekStrip weeks={work.data?.weeks ?? []} loading={work.isLoading} from={from} today={today}
      onShift={d => setFrom(addDays(from, d * 7))} onToday={() => setFrom(mondayOf(today))} />

    <div className="grid lg:grid-cols-[1fr_320px] gap-5 mt-4">
      <div className="bg-white rounded-2xl border border-stone-200/70 shadow-sm">
        <QuickAdd />
        {work.isLoading ? <div className="p-5"><div className="h-24 skeleton rounded-lg" /></div>
          : work.isError ? <p className="p-5 text-sm text-rose-700">Your work could not be loaded. <button className="underline font-semibold" onClick={() => work.refetch()}>Try again</button></p>
          : !groups.length ? <div className="p-10 text-center text-sm text-stone-500"><Inbox className="mx-auto w-8 h-8 text-stone-300 mb-2" />Nothing assigned to you yet. Add a task above.</div>
          : groups.map(g => {
              const collapsed = g.id === 'done' && !showDone;
              return <div key={g.id} className="border-t border-stone-100">
                <button type="button" onClick={() => g.id === 'done' && setShowDone(v => !v)}
                  className={`w-full flex items-center gap-2 px-5 pt-3 pb-1.5 text-[11px] font-bold uppercase tracking-[.12em] ${g.id === 'overdue' ? 'text-rose-600' : 'text-stone-500'} ${g.id === 'done' ? 'cursor-pointer' : 'cursor-default'}`}>
                  {g.id === 'done' && <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />}
                  {BUCKET_LABELS[g.id]} <span className="font-semibold text-stone-400">{g.items.length}</span>
                </button>
                {!collapsed && <ul>{g.items.map(i => <WorkRow key={i.key} item={i} today={today} />)}</ul>}
              </div>;
            })}
      </div>
      <div className="space-y-5 self-start">
        <Commitments list={work.data?.commitments ?? []} />
        <GoogleCalendarCard from={from} />
      </div>
    </div>
  </section>;
}

function WeekStrip({ weeks, loading, from, today, onShift, onToday }: {
  weeks: WorkloadWeek[]; loading: boolean; from: string; today: string; onShift: (d: number) => void; onToday: () => void;
}) {
  const thisMonday = mondayOf(today);
  return <div className="flex items-stretch gap-2">
    <button aria-label="Earlier weeks" onClick={() => onShift(-1)} className="px-2 rounded-xl border border-stone-200 bg-white text-stone-500 hover:text-[#087f73]"><ChevronLeft className="w-4 h-4" /></button>
    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
      {loading ? [0, 1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)
        : weeks.map(w => {
            const pct = w.capacity ? w.booked / w.capacity : w.booked ? 2 : 0;
            const tone = pct > 1.0001 ? 'bg-rose-500' : pct >= 0.9 ? 'bg-amber-500' : 'bg-[#087f73]';
            return <div key={w.week_start} className={`rounded-xl border bg-white px-3 py-2 ${w.week_start === thisMonday ? 'border-[#087f73]/50' : 'border-stone-200'}`}>
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-stone-500">{w.week_start === thisMonday ? 'This week' : `Week of ${fmt(w.week_start)}`}</div>
              <div className="text-sm font-bold text-stone-800 tabular-nums">{Math.round(w.booked)} <span className="font-normal text-stone-500">/ {Math.round(w.capacity)} h</span>
                {w.leave > 0 && <span className="ml-1 text-[11px] font-normal text-amber-700">· {Math.round(w.leave)} h leave</span>}</div>
              <div className="mt-1 h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} /></div>
            </div>;
          })}
    </div>
    <div className="flex flex-col gap-1">
      <button aria-label="Later weeks" onClick={() => onShift(1)} className="flex-1 px-2 rounded-xl border border-stone-200 bg-white text-stone-500 hover:text-[#087f73]"><ChevronRight className="w-4 h-4" /></button>
      {from !== thisMonday && <button onClick={onToday} className="px-2 py-1 rounded-lg border border-stone-200 bg-white text-[10px] font-bold">Today</button>}
    </div>
  </div>;
}

function ProjectSelect({ value, onChange, label = 'Project' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const projects = useMyProjects();
  return <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className={`${input} max-w-[200px]`}>
    <option value="">No project</option>
    {(projects.data ?? []).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
  </select>;
}

/**
 * What a task is for, as "<kind>:<id>" — p: project, i: initiative, e: enquiry, d: design book — or ""
 * for nothing. Only the modules the person can see are offered.
 */
const FOR_GROUPS = [
  ['projects', 'p', 'Projects'], ['enquiries', 'e', 'Enquiries (business development)'],
  ['design_books', 'd', 'Design books'], ['initiatives', 'i', 'Initiatives (internal work)'],
] as const;
function WorkForSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = useLinkOptions();
  return <select aria-label="For" value={value} onChange={e => onChange(e.target.value)} className={`${input} max-w-[240px]`}>
    <option value="">Not for anything in particular</option>
    {FOR_GROUPS.map(([key, prefix, label]) => (options.data?.[key] ?? []).length > 0 && <optgroup key={key} label={label}>
      {options.data![key].map(o => <option key={o.id} value={`${prefix}:${o.id}`}>{o.code} · {o.name}</option>)}
    </optgroup>)}
  </select>;
}
const workForValue = (item: Pick<WorkItem, 'project' | 'initiative' | 'enquiry' | 'design_book'>) =>
  item.initiative ? `i:${item.initiative.id}` : item.enquiry ? `e:${item.enquiry.id}` : item.design_book ? `d:${item.design_book.id}`
    : item.project ? `p:${item.project.id}` : '';
const workForBody = (v: string) => {
  const [kind, id] = v.includes(':') ? v.split(':') : ['', ''];
  return {
    project_id: kind === 'p' ? id : null, initiative_id: kind === 'i' ? id : null,
    enquiry_id: kind === 'e' ? id : null, design_book_id: kind === 'd' ? id : null,
  };
};

function QuickAdd() {
  const save = useSavePersonalTask();
  const [f, setF] = useState({ title: '', work_for: '', start_date: '', due_date: '', planned_hours: '' });
  const [more, setMore] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    if (f.start_date && f.due_date && f.due_date < f.start_date) return toast.error('The due date cannot be before the start date');
    try {
      await save.mutateAsync({ body: {
        title: f.title.trim(), ...workForBody(f.work_for), start_date: f.start_date || null, due_date: f.due_date || null,
        planned_hours: f.planned_hours ? Number(f.planned_hours) : null,
      } });
      setF({ title: '', work_for: f.work_for, start_date: '', due_date: '', planned_hours: '' });
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not add the task')); }
  };
  return <form onSubmit={submit} className="p-4 flex flex-wrap items-center gap-2">
    <Plus className="w-4 h-4 text-[#087f73]" />
    <input aria-label="New task" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Add a task… (Enter to save)"
      className="flex-1 min-w-[200px] text-sm px-2 py-1.5 rounded-lg focus:outline-none focus:bg-stone-50" />
    <input aria-label="Due date" type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} className={input} />
    <button type="button" onClick={() => setMore(v => !v)} className="text-xs font-semibold text-stone-500 hover:text-[#087f73]">{more ? 'Less' : 'More'}</button>
    <button disabled={save.isPending || !f.title.trim()} className="px-3 py-1.5 rounded-lg bg-[#087f73] text-white text-sm font-bold disabled:opacity-50">Add</button>
    {more && <div className="basis-full flex flex-wrap items-center gap-2 pl-6">
      <WorkForSelect value={f.work_for} onChange={v => setF({ ...f, work_for: v })} />
      <label className="text-xs text-stone-500 flex items-center gap-1">Start<input aria-label="Start date" type="date" value={f.start_date} max={f.due_date || undefined} onChange={e => setF({ ...f, start_date: e.target.value })} className={input} /></label>
      <label className="text-xs text-stone-500 flex items-center gap-1">Effort<input aria-label="Planned hours" type="number" min={0.5} step={0.5} value={f.planned_hours} onChange={e => setF({ ...f, planned_hours: e.target.value })} placeholder="h" className={`${input} w-20`} /> h</label>
      <span className="text-[11px] text-stone-400">Effort is spread over the working days from start to due and shows in your week.</span>
    </div>}
  </form>;
}

function WorkRow({ item, today }: { item: WorkItem; today: string }) {
  const savePlan = useUpdatePlanTask();
  const saveOwn = useSavePersonalTask();
  const remove = useDeletePersonalTask();
  const [editing, setEditing] = useState(false);
  const done = item.status === 'done';
  const late = !done && !!item.due_date && item.due_date < today;

  const update = async (body: { status?: WorkItem['status']; progress_pct?: number }) => {
    try {
      if (item.kind === 'plan') await savePlan.mutateAsync({ id: item.id, body });
      else await saveOwn.mutateAsync({ id: item.id, body });
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not update the task')); }
  };

  if (editing && item.kind === 'task') return <li className="px-5 py-2 border-t border-stone-50"><EditOwnTask item={item} onClose={() => setEditing(false)} /></li>;

  return <li className="group flex items-center gap-3 px-5 py-2 hover:bg-stone-50/70">
    <button aria-label={done ? `Reopen ${item.title}` : `Mark ${item.title} done`} onClick={() => update({ status: done ? 'in_progress' : 'done' })}
      className={`w-5 h-5 shrink-0 rounded-full border flex items-center justify-center ${done ? 'bg-[#087f73] border-[#087f73] text-white' : 'border-stone-300 hover:border-[#087f73]'}`}>
      {done && <Check className="w-3 h-3" />}
    </button>
    <div className="flex-1 min-w-0">
      <div className={`text-sm truncate ${done ? 'line-through text-stone-400' : 'text-stone-800 font-medium'}`}>
        {item.is_milestone && <Diamond className="inline w-3 h-3 mr-1 -mt-0.5 text-[#087f73]" aria-label="Milestone" />}{item.title}
      </div>
      <div className="text-[11px] text-stone-500 truncate">
        {item.plan ? <Link to={`/drafting/plans/${item.plan.id}`} className="hover:text-[#087f73]">{item.plan.code}</Link> : <span>Own task</span>}
        {item.project && <> · <span className="font-mono">{item.project.code}</span> {item.project.name}</>}
        {item.initiative && <> · <Link to={`/initiatives/${item.initiative.id}`} className="hover:text-[#087f73]"><span className="font-mono">{item.initiative.code}</span> {item.initiative.name}</Link></>}
        {item.enquiry && <> · <Link to={`/enquiries/${item.enquiry.id}`} className="hover:text-[#087f73]"><span className="font-mono">{item.enquiry.code}</span> {item.enquiry.name}</Link></>}
        {item.design_book && <> · <Link to={`/design-books/${item.design_book.id}`} className="hover:text-[#087f73]"><span className="font-mono">{item.design_book.code}</span> {item.design_book.name}</Link></>}
        {item.planned_hours ? <> · {item.planned_hours} h</> : null}
      </div>
    </div>
    <select aria-label={`Progress of ${item.title}`} value={Math.round(item.progress_pct / 10) * 10} disabled={done}
      onChange={e => { const v = Number(e.target.value); update(v === 100 ? { status: 'done', progress_pct: 100 } : { progress_pct: v, ...(item.status === 'not_started' && v > 0 ? { status: 'in_progress' } : {}) }); }}
      className="text-xs border border-stone-200 rounded-md px-1 py-0.5 bg-white text-stone-600 disabled:opacity-50">
      {Array.from({ length: 11 }, (_, i) => i * 10).map(v => <option key={v} value={v}>{v}%</option>)}
    </select>
    <div className={`w-28 text-right text-xs tabular-nums ${late ? 'text-rose-600 font-semibold' : 'text-stone-500'}`}>
      {item.start_date && item.due_date && item.start_date !== item.due_date ? `${fmt(item.start_date)} – ${fmt(item.due_date)}` : fmt(item.due_date ?? item.start_date) || '—'}
    </div>
    <div className="w-12 flex justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
      {item.kind === 'task' && <>
        <button aria-label={`Edit ${item.title}`} onClick={() => setEditing(true)} className="p-1 text-stone-400 hover:text-[#087f73]"><Pencil className="w-3.5 h-3.5" /></button>
        <button aria-label={`Delete ${item.title}`} onClick={() => { if (window.confirm(`Delete "${item.title}"?`)) remove.mutateAsync(item.id).catch(err => toast.error(apiErrorMessage(err, 'Could not delete'))); }}
          className="p-1 text-stone-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
      </>}
    </div>
  </li>;
}

function EditOwnTask({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const save = useSavePersonalTask();
  const [f, setF] = useState({
    title: item.title, notes: item.notes ?? '', work_for: workForValue(item), start_date: item.start_date ?? '',
    due_date: item.due_date ?? '', planned_hours: item.planned_hours ? String(item.planned_hours) : '',
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('Title is required');
    if (f.start_date && f.due_date && f.due_date < f.start_date) return toast.error('The due date cannot be before the start date');
    try {
      await save.mutateAsync({ id: item.id, body: {
        title: f.title.trim(), notes: f.notes.trim() || null, ...workForBody(f.work_for), start_date: f.start_date || null,
        due_date: f.due_date || null, planned_hours: f.planned_hours ? Number(f.planned_hours) : null,
      } });
      onClose();
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not save the task')); }
  };
  return <form onSubmit={submit} className="flex flex-wrap items-center gap-2 py-1">
    <input aria-label="Title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} className={`${input} flex-1 min-w-[200px]`} />
    <WorkForSelect value={f.work_for} onChange={v => setF({ ...f, work_for: v })} />
    <input aria-label="Start date" type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} className={input} />
    <input aria-label="Due date" type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} className={input} />
    <input aria-label="Planned hours" type="number" min={0.5} step={0.5} placeholder="h" value={f.planned_hours} onChange={e => setF({ ...f, planned_hours: e.target.value })} className={`${input} w-20`} />
    <input aria-label="Notes" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="Notes" className={`${input} basis-full`} />
    <button disabled={save.isPending} className="px-3 py-1.5 rounded-lg bg-[#087f73] text-white text-sm font-bold">Save</button>
    <button type="button" onClick={onClose} className="px-2 py-1.5 text-sm text-stone-500">Cancel</button>
  </form>;
}

// ---------- standing commitments ----------

const KIND_LABELS: Record<CommitmentKind, string> = { meeting: 'Meeting', role: 'Role / share of time', other: 'Other' };

function Commitments({ list }: { list: Commitment[] }) {
  const remove = useDeleteCommitment();
  const [form, setForm] = useState<Commitment | 'new' | null>(null);
  return <aside className="bg-white rounded-2xl border border-stone-200/70 shadow-sm p-4 self-start">
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-bold text-stone-800 flex items-center gap-1.5"><Repeat className="w-4 h-4 text-[#087f73]" /> Regular commitments</h3>
      {form === null && <button onClick={() => setForm('new')} className="text-xs font-semibold text-[#087f73] inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>}
    </div>
    <p className="text-[11px] text-stone-500 mt-1">Meetings and roles that take part of your time every week. They count in your booked hours.</p>
    {form !== null && <CommitmentForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
    <ul className="mt-3 space-y-2">
      {list.map(c => <li key={c.id} className="group rounded-lg border border-stone-100 px-3 py-2">
        <div className="flex items-start gap-2">
          <CalendarClock className="w-4 h-4 mt-0.5 text-stone-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-stone-800 truncate">{c.title}</div>
            <div className="text-[11px] text-stone-500">{describeCommitment(c)} · {c.end_date ? `until ${fmt(c.end_date)}` : 'ongoing'}{c.project ? ` · ${c.project.code}` : ''}</div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button aria-label={`Edit ${c.title}`} onClick={() => setForm(c)} className="p-1 text-stone-400 hover:text-[#087f73]"><Pencil className="w-3.5 h-3.5" /></button>
            <button aria-label={`Delete ${c.title}`} onClick={() => { if (window.confirm(`Delete "${c.title}"?`)) remove.mutateAsync(c.id).catch(err => toast.error(apiErrorMessage(err, 'Could not delete'))); }}
              className="p-1 text-stone-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </li>)}
      {!list.length && form === null && <li className="text-xs text-stone-400">None yet. For example: weekly team meeting, Monday 1 h; or Business development, 40% of time.</li>}
    </ul>
  </aside>;
}

function CommitmentForm({ initial, onClose }: { initial: Commitment | null; onClose: () => void }) {
  const save = useSaveCommitment();
  const [f, setF] = useState({
    title: initial?.title ?? '', kind: initial?.kind ?? 'meeting' as CommitmentKind,
    byShare: !!initial?.capacity_pct, weekdays: initial?.weekdays ?? [0], hours: String(initial?.hours_per_day ?? 1),
    pct: String(initial?.capacity_pct ?? 20), start_date: initial?.start_date ?? todayIso(), end_date: initial?.end_date ?? '',
    project_id: initial?.project?.id ?? '',
  });
  const toggleDay = (d: number) => setF({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d].sort() });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('Give it a name');
    if (!f.byShare && !f.weekdays.length) return toast.error('Pick at least one day');
    const body: CommitmentPayload = {
      title: f.title.trim(), kind: f.kind, start_date: f.start_date, end_date: f.end_date || null, project_id: f.project_id || null,
      weekdays: f.byShare ? null : f.weekdays, hours_per_day: f.byShare ? null : Number(f.hours), capacity_pct: f.byShare ? Number(f.pct) : null,
    };
    try { await save.mutateAsync({ id: initial?.id, body }); onClose(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not save')); }
  };
  return <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3">
    <div className="flex items-center gap-2">
      <input aria-label="Name" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Weekly team meeting" className={`${input} flex-1`} />
      <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-stone-400"><X className="w-4 h-4" /></button>
    </div>
    <select aria-label="Type" value={f.kind} onChange={e => { const kind = e.target.value as CommitmentKind; setF({ ...f, kind, byShare: kind === 'role' ? true : f.byShare }); }} className={`${input} w-full`}>
      {(Object.keys(KIND_LABELS) as CommitmentKind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
    </select>
    <div className="flex gap-3 text-xs">
      <label className="flex items-center gap-1"><input type="radio" checked={!f.byShare} onChange={() => setF({ ...f, byShare: false })} /> Hours on set days</label>
      <label className="flex items-center gap-1"><input type="radio" checked={f.byShare} onChange={() => setF({ ...f, byShare: true })} /> Share of my time</label>
    </div>
    {f.byShare
      ? <label className="text-xs text-stone-600 flex items-center gap-1"><input aria-label="Share of time" type="number" min={1} max={100} value={f.pct} onChange={e => setF({ ...f, pct: e.target.value })} className={`${input} w-20`} /> % of my working time</label>
      : <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
            {WEEKDAY_SHORT.map((d, i) => <button type="button" key={d} aria-pressed={f.weekdays.includes(i)} onClick={() => toggleDay(i)}
              className={`px-2 py-0.5 rounded-md text-xs border ${f.weekdays.includes(i) ? 'bg-[#087f73] text-white border-[#087f73]' : 'bg-white border-stone-200 text-stone-600'}`}>{d}</button>)}
          </div>
          <label className="text-xs text-stone-600 flex items-center gap-1"><input aria-label="Hours each day" type="number" min={0.25} max={24} step={0.25} value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} className={`${input} w-20`} /> hours each day</label>
        </div>}
    <div className="flex items-center gap-1 text-xs text-stone-600">
      <input aria-label="From" type="date" required value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} className={input} />
      <span>to</span>
      <input aria-label="Until (empty = ongoing)" type="date" value={f.end_date} min={f.start_date} onChange={e => setF({ ...f, end_date: e.target.value })} className={input} />
    </div>
    <ProjectSelect value={f.project_id} onChange={v => setF({ ...f, project_id: v })} label="Project (optional)" />
    <button disabled={save.isPending} className="w-full px-3 py-1.5 rounded-lg bg-[#087f73] text-white text-sm font-bold">{initial ? 'Save' : 'Add commitment'}</button>
  </form>;
}
