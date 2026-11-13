import { useState } from 'react';
import { Palmtree, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiErrorMessage, useCanManageDrafting, useTeams } from './draftingApi';
import { Leave, Resource, useAddLeave, useCalendars, useDeleteLeave, useLeave, useResources, useSaveResource, weekTotal } from './planningApi';
import { todayIso } from './taskTiming';

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** People as planning resources: which calendar they work, at what capacity, and their leave. */
export default function PeoplePanel() {
  const teams = useTeams();
  const [teamId, setTeamId] = useState('');
  const people = useResources(teamId || undefined);
  const calendars = useCalendars();
  const leave = useLeave(todayIso());
  const canManage = useCanManageDrafting();
  const save = useSaveResource();
  const defaultCal = calendars.data?.find(c => c.is_default);

  const update = async (p: Resource, body: Parameters<typeof save.mutateAsync>[0]['body']) => {
    try { await save.mutateAsync({ userId: p.user_id, body }); toast.success(`${p.name} updated`); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not save')); }
  };

  return <div>
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <select aria-label="Team" value={teamId} onChange={e => setTeamId(e.target.value)} className="border border-[#dce7e2] rounded-lg px-3 py-2 text-sm bg-white font-bold">
        <option value="">Everyone</option>
        {(teams.data ?? []).filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <p className="text-sm text-[#6f8082]">Each person works on a calendar (hours per day and holidays). Capacity below 100% is for part-time work. Leave is taken out of their available hours.</p>
    </div>

    <div className="bg-white rounded-xl border border-[#dce7e2] overflow-x-auto shadow-sm">
      <table className="w-full text-sm min-w-[900px]">
        <thead><tr className="bg-[#f2f7f4] border-b border-[#dce7e2]">{['Person', 'Teams', 'Calendar', 'Capacity', 'Hours / week', 'Upcoming leave'].map(h =>
          <th key={h} className="text-left px-4 py-2 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">{h}</th>)}</tr></thead>
        <tbody>
          {people.isLoading && <tr><td colSpan={6} className="p-4"><div className="h-8 skeleton rounded" /></td></tr>}
          {(people.data ?? []).map(p => <tr key={p.user_id} className="border-b border-[#edf2ef] last:border-0 align-top">
            <td className="px-4 py-2.5"><div className="font-semibold">{p.name}</div><div className="text-xs text-[#8a9b9a]">{p.role}</div></td>
            <td className="px-4 py-2.5 text-xs text-[#53686b]">{p.team_names.join(', ') || '—'}</td>
            <td className="px-4 py-2.5">{canManage
              ? <select aria-label={`Calendar for ${p.name}`} value={p.calendar_id ?? ''} onChange={e => update(p, { calendar_id: e.target.value || null })}
                  className="border border-[#dce7e2] rounded-md px-2 py-1 text-sm">
                  <option value="">Default{defaultCal ? ` (${defaultCal.name})` : ''}</option>
                  {(calendars.data ?? []).filter(c => !c.is_default).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              : p.calendar_name}</td>
            <td className="px-4 py-2.5">{canManage
              ? <label className="inline-flex items-center gap-1"><input aria-label={`Capacity of ${p.name}`} type="number" min={0} max={100} step={5} defaultValue={p.capacity_pct}
                  onBlur={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v <= 100 && v !== p.capacity_pct) update(p, { capacity_pct: v }); }}
                  className="w-16 border border-[#dce7e2] rounded-md px-2 py-1 text-sm" />%</label>
              : `${p.capacity_pct}%`}</td>
            <td className="px-4 py-2.5 tabular-nums text-[#53686b]">{Math.round(weekTotal(p.week_hours) * p.capacity_pct) / 100} h</td>
            <td className="px-4 py-2.5"><LeaveCell person={p} leave={(leave.data ?? []).filter(l => l.user_id === p.user_id)} canManage={canManage} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}

function LeaveCell({ person, leave, canManage }: { person: Resource; leave: Leave[]; canManage: boolean }) {
  const add = useAddLeave();
  const remove = useDeleteLeave();
  const [form, setForm] = useState<{ start: string; end: string; hours: string; reason: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form?.start) return;
    const end = form.end || form.start;
    if (end < form.start) return toast.error('The last day cannot be before the first day');
    try {
      await add.mutateAsync({ userId: person.user_id, body: { start_date: form.start, end_date: end, hours_per_day: form.hours ? Number(form.hours) : null, reason: form.reason.trim() || null } });
      setForm(null);
      toast.success('Leave added');
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not add leave')); }
  };

  return <div className="space-y-1.5">
    {leave.map(l => <div key={l.id} className="inline-flex items-center gap-1.5 mr-1.5 rounded-md bg-amber-50 text-amber-900 px-2 py-0.5 text-xs">
      <Palmtree className="w-3 h-3" />
      {fmt(l.start_date)}{l.end_date !== l.start_date ? ` – ${fmt(l.end_date)}` : ''}{l.hours_per_day ? ` (${l.hours_per_day} h/day)` : ''}{l.reason ? ` · ${l.reason}` : ''}
      {canManage && <button aria-label="Remove leave" onClick={() => remove.mutateAsync(l.id).catch(err => toast.error(apiErrorMessage(err, 'Could not remove')))} className="hover:text-rose-700"><X className="w-3 h-3" /></button>}
    </div>)}
    {canManage && (form
      ? <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5 text-xs">
          <input aria-label="First day" type="date" required value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} className="border border-[#dce7e2] rounded px-1.5 py-1" />
          <span>to</span>
          <input aria-label="Last day" type="date" value={form.end} min={form.start} onChange={e => setForm({ ...form, end: e.target.value })} className="border border-[#dce7e2] rounded px-1.5 py-1" />
          <input aria-label="Hours off per day (empty = whole days)" placeholder="whole days" type="number" min={0.5} max={24} step={0.5} value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} className="w-20 border border-[#dce7e2] rounded px-1.5 py-1" />
          <input aria-label="Reason" placeholder="Annual leave" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="w-28 border border-[#dce7e2] rounded px-1.5 py-1" />
          <button disabled={add.isPending} className="px-2 py-1 rounded bg-[#087f73] text-white font-bold">Add</button>
          <button type="button" onClick={() => setForm(null)} className="px-1.5 py-1">Cancel</button>
        </form>
      : <button onClick={() => setForm({ start: '', end: '', hours: '', reason: '' })} className="inline-flex items-center gap-1 text-xs font-bold text-[#087f73]"><Plus className="w-3 h-3" /> Add leave</button>)}
  </div>;
}
