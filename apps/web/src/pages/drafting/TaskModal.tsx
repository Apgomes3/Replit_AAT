import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DraftingModal, { fieldInput, fieldLabel } from './DraftingModal';
import { Avatar } from './TeamsPanel';
import {
  apiErrorMessage, Task, TaskGroup, TaskPayload, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES,
  TASK_STATUS_LABELS, useDeleteTask, usePeople, useSaveTask,
} from './draftingApi';
import { useConfirm } from '../../hooks/useConfirm';

type Props = {
  planId: string;
  groups: TaskGroup[];
  /** People in the plan's team (manager + members); listed first. */
  teamPeopleIds: string[];
  task?: Task;
  defaultGroupId?: string | null;
  onClose: () => void;
};

type FormState = Required<Pick<TaskPayload, 'title' | 'status' | 'priority'>> & {
  group_id: string | null;
  start_date: string | null;
  due_date: string | null;
  notes: string;
  assignee_ids: string[];
};

export default function TaskModal({ planId, groups, teamPeopleIds, task, defaultGroupId = null, onClose }: Props) {
  const people = usePeople();
  const save = useSaveTask(planId);
  const remove = useDeleteTask(planId);
  const { confirm, dialog } = useConfirm();
  const [showEveryone, setShowEveryone] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    title: task?.title ?? '',
    status: task?.status ?? 'not_started',
    priority: task?.priority ?? 'medium',
    group_id: task ? task.group_id : defaultGroupId,
    start_date: task?.start_date ?? null,
    due_date: task?.due_date ?? null,
    notes: task?.notes ?? '',
    assignee_ids: task?.assignees.map(a => a.id) ?? [],
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
    if (form.start_date && form.due_date && form.due_date < form.start_date) return toast.error('Due date cannot be before start date');
    try {
      await save.mutateAsync({ id: task?.id, body: { ...form, title: form.title.trim(), notes: form.notes.trim() || null } });
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
      <label className={fieldLabel}>Start<input type="date" value={form.start_date ?? ''} onChange={e => setForm({ ...form, start_date: e.target.value || null })} className={fieldInput} /></label>
      <label className={fieldLabel}>Due<input type="date" value={form.due_date ?? ''} min={form.start_date ?? undefined} onChange={e => setForm({ ...form, due_date: e.target.value || null })} className={fieldInput} /></label>
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
            </label>)}
        </div>
      </fieldset>

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
