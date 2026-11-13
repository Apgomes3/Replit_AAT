import { CalendarCog, Flag, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiErrorMessage, Plan, usePatchPlan, useSetBaseline } from './draftingApi';
import { useCalendars } from './planningApi';
import { useConfirm } from '../../hooks/useConfirm';

/** Plan-level scheduling settings: working calendar, automatic scheduling and the baseline. */
export default function PlanSettings({ plan, calendarName, canManage }: { plan: Plan; calendarName: string; canManage: boolean }) {
  const calendars = useCalendars();
  const patch = usePatchPlan(plan.id);
  const baseline = useSetBaseline(plan.id);
  const { confirm, dialog } = useConfirm();
  const defaultCal = calendars.data?.find(c => c.is_default);

  const change = async (body: Parameters<typeof patch.mutateAsync>[0], done: string) => {
    try { await patch.mutateAsync(body); toast.success(done); } catch (err) { toast.error(apiErrorMessage(err, 'Could not save')); }
  };
  const saveBaseline = async (clear: boolean) => {
    const ok = await confirm(clear
      ? { title: 'Clear the baseline?', message: 'The saved dates are removed, so slips are no longer shown.', confirmLabel: 'Clear', danger: true }
      : { title: plan.baseline_set_at ? 'Replace the baseline?' : 'Save a baseline?', message: 'Every task\'s current start and due dates are saved, so you can see later how far each task has moved.', confirmLabel: 'Save baseline' });
    if (!ok) return;
    try { await baseline.mutateAsync(clear); toast.success(clear ? 'Baseline cleared' : 'Baseline saved'); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not save the baseline')); }
  };

  return <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[#dce7e2] bg-white px-4 py-2 text-xs text-[#53686b]">
    <label className="inline-flex items-center gap-1.5 font-bold"><CalendarCog className="w-3.5 h-3.5 text-[#087f73]" /> Calendar
      {canManage
        ? <select value={plan.calendar_id ?? ''} onChange={e => change({ calendar_id: e.target.value || null }, 'Calendar changed')}
            className="border border-[#dce7e2] rounded-md px-2 py-1 font-normal">
            <option value="">Default{defaultCal ? ` (${defaultCal.name})` : ''}</option>
            {(calendars.data ?? []).filter(c => !c.is_default).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        : <span className="font-normal">{calendarName}</span>}
    </label>
    <label className="inline-flex items-center gap-1.5 font-bold" title="When a task's dates change, the tasks that wait for it move later automatically (you can undo).">
      <Wand2 className="w-3.5 h-3.5 text-[#087f73]" /> Automatic scheduling
      <input type="checkbox" disabled={!canManage} checked={plan.auto_schedule}
        onChange={e => change({ auto_schedule: e.target.checked }, e.target.checked ? 'Automatic scheduling on' : 'Automatic scheduling off')} />
      <span className="font-normal text-[#8a9b9a]">{plan.auto_schedule ? 'later tasks follow delays' : 'warnings only'}</span>
    </label>
    <span className="inline-flex items-center gap-1.5 font-bold"><Flag className="w-3.5 h-3.5 text-[#087f73]" /> Baseline
      <span className="font-normal">{plan.baseline_set_at ? `saved ${new Date(plan.baseline_set_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'none'}</span>
      {canManage && <button onClick={() => saveBaseline(false)} className="font-bold text-[#087f73] hover:underline">{plan.baseline_set_at ? 'Replace' : 'Save now'}</button>}
      {canManage && plan.baseline_set_at && <button onClick={() => saveBaseline(true)} className="font-bold text-rose-700 hover:underline">Clear</button>}
    </span>
    {dialog}
  </div>;
}
