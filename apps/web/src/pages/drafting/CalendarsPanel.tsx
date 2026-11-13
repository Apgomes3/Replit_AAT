import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, Star, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiErrorMessage, useCanManageDrafting } from './draftingApi';
import {
  Calendar, useCalendarDays, useCalendars, useDeleteCalendar, useDeleteCalendarDays, useSaveCalendar, useSaveCalendarDays,
  weekTotal, WEEKDAYS,
} from './planningApi';
import { addDays } from './taskTiming';
import { useConfirm } from '../../hooks/useConfirm';

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Working calendars: hours per weekday, public holidays and make-up working days. */
export default function CalendarsPanel() {
  const calendars = useCalendars();
  const [selected, setSelected] = useState<string>('');
  const canManage = useCanManageDrafting();
  const list = calendars.data ?? [];
  const cal = list.find(c => c.id === selected) ?? list.find(c => c.is_default) ?? list[0];

  return <div className="grid lg:grid-cols-[260px_1fr] gap-5">
    <aside className="space-y-2">
      {list.map(c => <button key={c.id} onClick={() => setSelected(c.id)}
        className={`w-full text-left rounded-xl border px-4 py-3 ${cal?.id === c.id ? 'border-[#087f73] bg-[#f2f7f4]' : 'border-[#dce7e2] bg-white hover:bg-[#f8fbf9]'}`}>
        <div className="flex items-center gap-1.5 font-bold text-sm">{c.is_default && <Star className="w-3.5 h-3.5 text-amber-500" aria-label="Default" />}{c.name}</div>
        <div className="text-xs text-[#6f8082] mt-0.5">{weekTotal(c.week_hours)} h/week · {c.exception_count} special days</div>
        <div className="text-[11px] text-[#8a9b9a]">{c.plan_count} plans · {c.people_count} people{c.is_default ? ' · plus everyone without a calendar' : ''}</div>
      </button>)}
      {canManage && <NewCalendar defaultId={list.find(c => c.is_default)?.id} onCreated={setSelected} />}
    </aside>
    {cal ? <CalendarEditor key={cal.id} cal={cal} canManage={canManage} onDeleted={() => setSelected('')} /> : <div className="h-40 skeleton rounded-xl" />}
  </div>;
}

function NewCalendar({ defaultId, onCreated }: { defaultId?: string; onCreated: (id: string) => void }) {
  const save = useSaveCalendar();
  const [name, setName] = useState('');
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const c = await save.mutateAsync({ body: { name: name.trim(), week_hours: [9, 9, 9, 9, 9, 8, 0], ...(defaultId ? { copy_days_from: defaultId } : {}) } });
      setName(''); onCreated(c.id); toast.success('Calendar added, with the default calendar\'s holidays');
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not add calendar')); }
  };
  return <form onSubmit={create} className="flex gap-2">
    <input aria-label="New calendar name" value={name} onChange={e => setName(e.target.value)} placeholder="Part-time Mon-Fri" className="flex-1 min-w-0 border border-[#dce7e2] rounded-lg px-3 py-2 text-sm" />
    <button disabled={save.isPending} aria-label="Add calendar" className="px-3 rounded-lg bg-[#087f73] text-white"><Plus className="w-4 h-4" /></button>
  </form>;
}

function CalendarEditor({ cal, canManage, onDeleted }: { cal: Calendar; canManage: boolean; onDeleted: () => void }) {
  const save = useSaveCalendar();
  const remove = useDeleteCalendar();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState(cal.name);
  const [description, setDescription] = useState(cal.description ?? '');
  const [hours, setHours] = useState(cal.week_hours.map(String));
  useEffect(() => { setName(cal.name); setDescription(cal.description ?? ''); setHours(cal.week_hours.map(String)); }, [cal]);

  const parsed = hours.map(Number);
  const valid = parsed.every(h => Number.isFinite(h) && h >= 0 && h <= 24) && parsed.some(h => h > 0);
  const dirty = name !== cal.name || description !== (cal.description ?? '') || parsed.some((h, i) => h !== cal.week_hours[i]);

  const submit = async () => {
    if (!valid) return toast.error('Hours must be 0–24, with at least one working day');
    try { await save.mutateAsync({ id: cal.id, body: { name: name.trim(), description: description.trim() || null, week_hours: parsed } }); toast.success('Calendar saved. Plans using it now count working days with these hours.'); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not save calendar')); }
  };
  const makeDefault = async () => {
    try { await save.mutateAsync({ id: cal.id, body: { is_default: true } }); toast.success(`${cal.name} is now the default calendar`); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not change the default')); }
  };
  const del = async () => {
    const ok = await confirm({ title: 'Delete calendar?', message: `"${cal.name}" will be deleted. ${cal.plan_count} plans and ${cal.people_count} people using it move to the default calendar.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await remove.mutateAsync(cal.id); onDeleted(); toast.success('Calendar deleted'); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not delete calendar')); }
  };

  return <section className="bg-white rounded-xl border border-[#dce7e2] shadow-sm">
    <div className="p-5 border-b border-[#edf2ef] grid sm:grid-cols-2 gap-4">
      <label className="text-xs font-bold text-[#53686b]">Name<input disabled={!canManage} value={name} onChange={e => setName(e.target.value)} className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold text-[#53686b]">Description<input disabled={!canManage} value={description} onChange={e => setDescription(e.target.value)} className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal" /></label>
      <fieldset className="sm:col-span-2">
        <legend className="text-xs font-bold text-[#53686b]">Working hours per day <span className="font-normal text-[#8a9b9a]">(0 = day off)</span></legend>
        <div className="mt-1.5 grid grid-cols-7 gap-2">
          {WEEKDAYS.map((d, i) => <label key={d} className="text-center text-xs text-[#6f8082]">{d}
            <input disabled={!canManage} aria-label={`${d} hours`} type="number" min={0} max={24} step={0.5} value={hours[i]}
              onChange={e => setHours(hours.map((h, j) => (j === i ? e.target.value : h)))}
              className={`mt-1 w-full border rounded-lg px-1 py-2 text-sm text-center ${Number(hours[i]) > 0 ? 'border-[#b8d9d0] bg-[#f2f7f4] font-bold text-[#20333a]' : 'border-[#dce7e2] text-[#8a9b9a]'}`} />
          </label>)}
        </div>
        <p className="mt-1.5 text-xs text-[#6f8082]">{valid ? `${weekTotal(parsed)} hours a week, ${parsed.filter(h => h > 0).length} working days.` : 'Enter 0–24 hours, with at least one working day.'}</p>
      </fieldset>
      {canManage && <div className="sm:col-span-2 flex flex-wrap gap-2">
        <button onClick={submit} disabled={!dirty || save.isPending} className="px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold disabled:opacity-40">Save working week</button>
        {!cal.is_default && <button onClick={makeDefault} className="px-3 py-2 rounded-lg border border-[#dce7e2] text-sm font-bold text-[#53686b]"><Star className="inline w-3.5 h-3.5 mr-1" />Make default</button>}
        {!cal.is_default && <button onClick={del} className="ml-auto px-3 py-2 text-sm font-bold text-rose-700"><Trash2 className="inline w-3.5 h-3.5 mr-1" />Delete</button>}
      </div>}
    </div>
    <SpecialDays cal={cal} canManage={canManage} />
    {dialog}
  </section>;
}

function SpecialDays({ cal, canManage }: { cal: Calendar; canManage: boolean }) {
  const days = useCalendarDays(cal.id);
  const saveDays = useSaveCalendarDays();
  const deleteDays = useDeleteCalendarDays();
  const years = useMemo(() => [...new Set((days.data ?? []).map(d => d.day.slice(0, 4)))].sort(), [days.data]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const shown = (days.data ?? []).filter(d => d.day.startsWith(year));
  const [form, setForm] = useState({ from: '', to: '', kind: 'holiday', hours: '9', name: '' });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.from) return;
    const to = form.to || form.from;
    if (to < form.from) return toast.error('The last day cannot be before the first day');
    const list = [];
    for (let d = form.from; d <= to && list.length < 400; d = addDays(d, 1)) {
      list.push({ day: d, hours: form.kind === 'holiday' ? 0 : Number(form.hours), name: form.name.trim() || null });
    }
    try {
      await saveDays.mutateAsync({ id: cal.id, days: list });
      setYear(form.from.slice(0, 4));
      setForm({ ...form, from: '', to: '', name: '' });
      toast.success(`${list.length} ${list.length === 1 ? 'day' : 'days'} saved`);
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not save days')); }
  };

  return <div className="p-5">
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <h3 className="font-extrabold text-sm flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-[#087f73]" /> Holidays and make-up working days</h3>
      <div className="ml-auto flex gap-1">{[...new Set([...years, String(new Date().getFullYear()), String(new Date().getFullYear() + 1)])].sort().map(y =>
        <button key={y} onClick={() => setYear(y)} className={`px-2.5 py-1 rounded-md text-xs font-bold ${y === year ? 'bg-[#087f73] text-white' : 'border border-[#dce7e2] text-[#53686b]'}`}>{y}</button>)}</div>
    </div>
    {canManage && <form onSubmit={add} className="flex flex-wrap items-end gap-2 mb-4 rounded-lg bg-[#f8fbf9] border border-[#edf2ef] p-3 text-xs">
      <label className="font-bold text-[#53686b]">From<input type="date" required value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} className="block mt-1 border border-[#dce7e2] rounded px-2 py-1.5 font-normal" /></label>
      <label className="font-bold text-[#53686b]">To<input type="date" value={form.to} min={form.from} onChange={e => setForm({ ...form, to: e.target.value })} className="block mt-1 border border-[#dce7e2] rounded px-2 py-1.5 font-normal" /></label>
      <label className="font-bold text-[#53686b]">Type<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="block mt-1 border border-[#dce7e2] rounded px-2 py-1.5 font-normal">
        <option value="holiday">Holiday (no work)</option><option value="working">Make-up working day</option></select></label>
      {form.kind === 'working' && <label className="font-bold text-[#53686b]">Hours<input type="number" min={0.5} max={24} step={0.5} value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} className="block mt-1 w-16 border border-[#dce7e2] rounded px-2 py-1.5 font-normal" /></label>}
      <label className="font-bold text-[#53686b] flex-1 min-w-[160px]">Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Spring Festival" className="block mt-1 w-full border border-[#dce7e2] rounded px-2 py-1.5 font-normal" /></label>
      <button disabled={saveDays.isPending} className="px-3 py-1.5 rounded-lg bg-[#087f73] text-white font-bold">Add</button>
    </form>}
    {days.isLoading ? <div className="h-24 skeleton rounded" />
      : !shown.length ? <p className="text-sm text-[#6f8082]">No special days in {year}.{canManage ? ' Add the official public holidays once they are published.' : ''}</p>
      : <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6">{shown.map(d => <li key={d.day} className="flex items-center gap-2 py-1.5 border-b border-[#edf2ef] text-sm">
          <span className={`w-2 h-2 rounded-full ${d.hours > 0 ? 'bg-[#087f73]' : 'bg-rose-400'}`} />
          <span className="w-32 tabular-nums">{fmt(d.day)}</span>
          <span className="flex-1 truncate text-[#53686b]">{d.name ?? (d.hours > 0 ? 'Working day' : 'Holiday')}{d.hours > 0 ? ` · ${d.hours} h` : ''}</span>
          {canManage && <button aria-label={`Remove ${d.day}`} onClick={() => deleteDays.mutateAsync({ id: cal.id, days: [d.day] }).catch(err => toast.error(apiErrorMessage(err, 'Could not remove')))}
            className="p-1 text-[#80908f] hover:text-rose-700"><Trash2 className="w-3.5 h-3.5" /></button>}
        </li>)}</ul>}
  </div>;
}
