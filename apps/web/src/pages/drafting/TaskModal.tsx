import { useMemo, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import DraftingModal, { fieldInput, fieldLabel } from './DraftingModal';
import { Avatar } from './TeamsPanel';
import {
  apiErrorMessage, Board, LinkType, LINK_TYPES, LINK_TYPE_LABELS, Task, TaskGroup, TaskPayload, TASK_PRIORITIES,
  TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, useCreateLink, useDeleteLink, useDeleteTask, usePeople, useSaveTask,
  useUpdateLink,
} from './draftingApi';
import { useConfirm } from '../../hooks/useConfirm';

/** "Waits for" (editable) and "Waited on by" (read-only) links of one task. Changes save immediately. */
function TaskLinks({ planId, task, board }: { planId: string; task: Task; board: Board }) {
  const create = useCreateLink(planId);
  const update = useUpdateLink(planId);
  const remove = useDeleteLink(planId);
  const [adding, setAdding] = useState('');
  const all = new Map<string, { title: string; start_date: string | null; due_date: string | null; plan_code?: string }>(
    [...board.tasks, ...board.external_tasks.map(t => ({ ...t, plan_code: t.plan_code }))].map(t => [t.id, t]));
  const waitsFor = board.links.filter(l => l.successor_id === task.id);
  const waitedOnBy = board.links.filter(l => l.predecessor_id === task.id);
  const linked = new Set([...waitsFor.map(l => l.predecessor_id), ...waitedOnBy.map(l => l.successor_id), task.id]);
  const options = board.tasks.filter(t => !linked.has(t.id));
  const fail = (fallback: string) => (err: unknown) => toast.error(apiErrorMessage(err, fallback));
  const label = (id: string) => { const t = all.get(id); return t ? `${t.plan_code ? `${t.plan_code} · ` : ''}${t.title}` : 'Unknown task'; };

  return <fieldset className="sm:col-span-2">
    <legend className={fieldLabel}>Waits for</legend>
    <div className="mt-1.5 rounded-lg border border-[#dce7e2] divide-y divide-[#edf2ef]">
      {waitsFor.map(l => {
        const early = l.early_days ?? 0;
        return <div key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="flex-1 min-w-[160px] font-semibold truncate" title={label(l.predecessor_id)}>{label(l.predecessor_id)}</span>
          {early > 0 && <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700" title="This task starts before the link allows"><AlertTriangle className="w-3.5 h-3.5" /> {early}d early</span>}
          <select aria-label="Link type" value={l.link_type} onChange={e => update.mutateAsync({ id: l.id, link_type: e.target.value as LinkType }).catch(fail('Could not change link'))}
            className="border border-[#dce7e2] rounded-md px-1.5 py-1 text-xs">
            {LINK_TYPES.map(t => <option key={t} value={t}>{LINK_TYPE_LABELS[t]}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-[#6f8082]">+<input aria-label="Lag in days" type="number" min={-365} max={365} defaultValue={l.lag_days}
            onBlur={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== l.lag_days) update.mutateAsync({ id: l.id, lag_days: v }).catch(fail('Could not change lag')); }}
            className="w-14 border border-[#dce7e2] rounded-md px-1.5 py-1 text-xs" />days</label>
          <button type="button" aria-label={`Remove link to ${label(l.predecessor_id)}`} onClick={() => remove.mutateAsync(l.id).catch(fail('Could not remove link'))}
            className="p-1 text-[#80908f] hover:text-rose-700"><X className="w-3.5 h-3.5" /></button>
        </div>;
      })}
      <div className="flex items-center gap-2 px-3 py-2">
        <select aria-label="Add a task this one waits for" value={adding} onChange={e => setAdding(e.target.value)} className="flex-1 border border-[#dce7e2] rounded-md px-2 py-1 text-sm">
          <option value="">{waitsFor.length ? 'Add another task it waits for…' : 'Choose a task it waits for…'}</option>
          {options.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <button type="button" disabled={!adding || create.isPending}
          onClick={() => create.mutateAsync({ successorId: task.id, predecessorId: adding }).then(() => setAdding('')).catch(fail('Could not add link'))}
          className="px-3 py-1 rounded-md bg-[#087f73] text-white text-xs font-bold disabled:opacity-40">Add</button>
      </div>
    </div>
    {waitedOnBy.length > 0 && <p className="mt-1.5 text-xs text-[#6f8082]">Waited on by: {waitedOnBy.map(l => label(l.successor_id)).join(' · ')}</p>}
  </fieldset>;
}

type Props = {
  planId: string;
  groups: TaskGroup[];
  /** People in the plan's team (manager + members); listed first. */
  teamPeopleIds: string[];
  task?: Task;
  /** Starting values for a new task (e.g. the group or person of the section it was added from). */
  defaults?: TaskPayload;
  /** The plan's board, for the task's links. */
  board: Board;
  onClose: () => void;
};

type FormState = Required<Pick<TaskPayload, 'title' | 'status' | 'priority'>> & {
  group_id: string | null;
  start_date: string | null;
  due_date: string | null;
  notes: string;
  assignee_ids: string[];
  progress_pct: number;
  is_milestone: boolean;
  allocations: Record<string, number>;
};

export default function TaskModal({ planId, groups, teamPeopleIds, task, defaults = {}, board, onClose }: Props) {
  const people = usePeople();
  const save = useSaveTask(planId);
  const remove = useDeleteTask(planId);
  const { confirm, dialog } = useConfirm();
  const [showEveryone, setShowEveryone] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    title: task?.title ?? '',
    status: task?.status ?? defaults.status ?? 'not_started',
    priority: task?.priority ?? defaults.priority ?? 'medium',
    group_id: task ? task.group_id : defaults.group_id ?? null,
    start_date: task?.start_date ?? null,
    due_date: task?.due_date ?? null,
    notes: task?.notes ?? '',
    assignee_ids: task?.assignees.map(a => a.id) ?? defaults.assignee_ids ?? [],
    progress_pct: task?.progress_pct ?? 0,
    is_milestone: task?.is_milestone ?? false,
    allocations: Object.fromEntries((task?.assignees ?? []).map(a => [a.id, a.allocation_pct ?? 100])),
  }));

  const candidates = useMemo(() => {
    const team = new Set(teamPeopleIds);
    const all = people.data ?? [];
    // Always keep current assignees visible, even if they are outside the team.
    return all.filter(p => showEveryone || team.has(p.id) || form.assignee_ids.includes(p.id));
  }, [people.data, teamPeopleIds, showEveryone, form.assignee_ids]);

  const toggle = (id: string) => setForm(f => ({
    ...f,
    assignee_ids: f.assignee_ids.includes(id) ? f.assignee_ids.filter(x => x !== id) : [...f.assignee_ids, id],
  }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Task name is required');
    if (!form.is_milestone && form.start_date && form.due_date && form.due_date < form.start_date) return toast.error('Due date cannot be before start date');
    const allocations = Object.fromEntries(form.assignee_ids.map(id => [id, Math.min(100, Math.max(1, Math.round(form.allocations[id] ?? 100)))]));
    // A milestone is one day: its date is the start date (or the due date if only that is set).
    const day = form.start_date ?? form.due_date;
    const dates = form.is_milestone ? { start_date: day, due_date: day } : {};
    try {
      await save.mutateAsync({ id: task?.id, body: { ...form, ...dates, allocations, title: form.title.trim(), notes: form.notes.trim() || null } });
      toast.success(task ? 'Task updated' : 'Task added');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save task'));
    }
  };

  const deleteTask = async () => {
    if (!task) return;
    const ok = await confirm({ title: 'Delete task?', message: `"${task.title}" will be permanently deleted.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await remove.mutateAsync(task.id);
      toast.success('Task deleted');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete task'));
    }
  };

  return <>
    <DraftingModal title={task ? 'Edit task' : 'New task'} saving={save.isPending} submitLabel={task ? 'Save task' : 'Add task'}
      onClose={onClose} onSubmit={submit}>
      <label className={`sm:col-span-2 ${fieldLabel}`}>Task<input required autoFocus value={form.title}
        onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. LSS-02 Compact Unit S1 Right" className={fieldInput} /></label>
      <label className={fieldLabel}>Status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as FormState['status'] })} className={fieldInput}>
        {TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
      </select></label>
      <label className={fieldLabel}>Priority<select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as FormState['priority'] })} className={fieldInput}>
        {TASK_PRIORITIES.map(p => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}
      </select></label>
      <label className={fieldLabel}>{form.is_milestone ? 'Date' : 'Start'}<input type="date" value={form.start_date ?? ''} onChange={e => setForm({ ...form, start_date: e.target.value || null })} className={fieldInput} /></label>
      {form.is_milestone
        ? <div className={`${fieldLabel} self-end pb-2 text-[#6f8082] font-normal`}>A milestone is a single day, such as "Drawings issued to client".</div>
        : <label className={fieldLabel}>Due<input type="date" value={form.due_date ?? ''} min={form.start_date ?? undefined} onChange={e => setForm({ ...form, due_date: e.target.value || null })} className={fieldInput} /></label>}
      <label className={fieldLabel}>Progress
        <div className="mt-1.5 flex items-center gap-2">
          <input type="range" min={0} max={100} step={5} value={form.status === 'done' ? 100 : form.progress_pct} disabled={form.status === 'done'}
            onChange={e => setForm({ ...form, progress_pct: Number(e.target.value) })} className="flex-1 accent-[#087f73]" aria-label="Progress percentage" />
          <span className="w-10 text-right text-sm font-bold tabular-nums">{form.status === 'done' ? 100 : form.progress_pct}%</span>
        </div>
      </label>
      <label className={`${fieldLabel} flex items-center gap-2 self-end pb-2`}>
        <input type="checkbox" checked={form.is_milestone} onChange={e => setForm({ ...form, is_milestone: e.target.checked })} /> Milestone
      </label>
      <label className={`sm:col-span-2 ${fieldLabel}`}>Group<select value={form.group_id ?? ''} onChange={e => setForm({ ...form, group_id: e.target.value || null })} className={fieldInput}>
        <option value="">No group</option>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select></label>

      <fieldset className="sm:col-span-2">
        <legend className={fieldLabel}>Assigned to</legend>
        <div className="mt-1.5 flex items-center justify-between text-xs text-[#6f8082]">
          <span>{form.assignee_ids.length} selected · {showEveryone ? 'everyone' : 'plan team'}</span>
          <button type="button" onClick={() => setShowEveryone(v => !v)} className="font-bold text-[#087f73]">{showEveryone ? 'Show team only' : 'Show everyone'}</button>
        </div>
        <div className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-[#dce7e2] divide-y divide-[#edf2ef]">
          {people.isLoading ? <div className="p-3 text-xs text-[#6f8082]">Loading people…</div>
            : candidates.length === 0 ? <div className="p-3 text-xs text-[#6f8082]">No team members yet — use “Show everyone” or add people to the team.</div>
            : candidates.map(p => <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-[#f4faf7] cursor-pointer">
              <input type="checkbox" aria-label={`Assign ${p.name}`} checked={form.assignee_ids.includes(p.id)} onChange={() => toggle(p.id)} />
              <Avatar person={p} />
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs text-[#8a9b9a] truncate">{p.role}</span>
              {form.assignee_ids.includes(p.id) && <span className="ml-auto inline-flex items-center gap-1 text-xs text-[#6f8082]" title="Share of this person's working day spent on the task">
                <input aria-label={`Allocation of ${p.name}`} type="number" min={1} max={100} step={5} value={form.allocations[p.id] ?? 100}
                  onChange={e => setForm({ ...form, allocations: { ...form.allocations, [p.id]: Number(e.target.value) } })}
                  className="w-14 border border-[#dce7e2] rounded px-1.5 py-0.5 text-xs" />% of day
              </span>}
            </label>)}
        </div>
      </fieldset>

      {task && <TaskLinks planId={planId} task={task} board={board} />}

      <label className={`sm:col-span-2 ${fieldLabel}`}>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className={fieldInput} /></label>
      {task && <div className="sm:col-span-2">
        <button type="button" onClick={deleteTask} disabled={remove.isPending} className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 hover:text-rose-800 disabled:opacity-50">
          <Trash2 className="w-3.5 h-3.5" /> Delete task
        </button>
      </div>}
    </DraftingModal>
    {dialog}
  </>;
}
