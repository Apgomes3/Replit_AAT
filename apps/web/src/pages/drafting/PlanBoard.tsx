import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, FolderPlus, ChartGantt, Link2, List, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Avatar } from './TeamsPanel';
import { StatusBadge } from './PlansPanel';
import TaskModal from './TaskModal';
import GanttView from './GanttView';
import {
  apiErrorMessage, Task, TaskPayload, TaskPriority, TaskStatus, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS,
  useBoard, useCanManageDrafting, useDeleteGroup, useReschedule, useSaveGroup, useSaveTask, useTeams,
} from './draftingApi';
import { buildSections, GroupBy, GROUP_BY, GROUP_BY_LABELS, Section, Sort, SortKey } from './planViews';
import { durationDays, isLate, linkShortfall, timeElapsedPercent, todayIso } from './taskTiming';
import { useConfirm } from '../../hooks/useConfirm';

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  urgent: 'bg-rose-50 text-rose-700',
  important: 'bg-amber-50 text-amber-800',
  medium: 'bg-[#eef4f1] text-[#53686b]',
  low: 'bg-stone-50 text-stone-500',
};

const STATUS_STYLE: Record<TaskStatus, string> = {
  not_started: 'border-stone-200 text-stone-600',
  in_progress: 'border-sky-200 bg-sky-50 text-sky-800',
  review: 'border-violet-200 bg-violet-50 text-violet-800',
  done: 'border-[#b8d9d0] bg-[#e4f2ee] text-[#087f73]',
};

const formatDay = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—';

type ModalState = { task?: Task; defaults?: TaskPayload } | null;
type View = 'list' | 'gantt';

/** Per task: how many tasks it waits for, and how many days too early it starts (0 = in order). */
export type LinkInfo = Map<string, { waitsFor: number; earlyBy: number }>;

export default function PlanBoard() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const board = useBoard(id);
  const teams = useTeams();
  const canManage = useCanManageDrafting();
  const reschedule = useReschedule(id);
  const { confirm, dialog } = useConfirm();
  const [personFilter, setPersonFilter] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'manual', desc: false });
  const [modal, setModal] = useState<ModalState>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const today = todayIso();

  const view: View = params.get('view') === 'gantt' ? 'gantt' : 'list';
  const groupBy: GroupBy = (GROUP_BY as readonly string[]).includes(params.get('group') ?? '') ? params.get('group') as GroupBy : 'group';
  const setParam = (key: string, value: string, fallback: string) => setParams(p => {
    const next = new URLSearchParams(p);
    if (value === fallback) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });

  const plan = board.data?.plan;
  const groups = board.data?.groups ?? [];
  const tasks = board.data?.tasks ?? [];
  const links = board.data?.links ?? [];
  const externalTasks = board.data?.external_tasks ?? [];

  const teamPeopleIds = useMemo(() => {
    const team = teams.data?.find(t => t.id === plan?.team.id);
    return team ? [...(team.manager ? [team.manager.id] : []), ...team.members.map(m => m.id)] : [];
  }, [teams.data, plan?.team.id]);

  const people = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach(t => t.assignees.forEach(a => map.set(a.id, a.name)));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: tasks.length, late: 0 };
    TASK_STATUSES.forEach(s => { c[s] = 0; });
    tasks.forEach(t => { c[t.status]!++; if (isLate(t, today)) c.late!++; });
    return c;
  }, [tasks, today]);

  const linkInfo: LinkInfo = useMemo(() => {
    const byId = new Map<string, { start_date: string | null; due_date: string | null; status: string }>(
      [...tasks, ...externalTasks].map(t => [t.id, t]));
    const info: LinkInfo = new Map();
    for (const l of links) {
      const pred = byId.get(l.predecessor_id), succ = byId.get(l.successor_id);
      if (!pred || !succ) continue;
      const cur = info.get(l.successor_id) ?? { waitsFor: 0, earlyBy: 0 };
      const early = succ.status === 'done' ? 0 : linkShortfall(l, pred, succ);
      info.set(l.successor_id, { waitsFor: cur.waitsFor + 1, earlyBy: Math.max(cur.earlyBy, early) });
    }
    return info;
  }, [links, tasks, externalTasks]);
  const outOfOrder = tasks.filter(t => (linkInfo.get(t.id)?.earlyBy ?? 0) > 0).length;

  if (board.isError) return <div className="p-8 text-sm text-rose-700">This plan could not be loaded. <button className="underline font-bold" onClick={() => board.refetch()}>Try again</button></div>;
  if (board.isLoading || !plan) return <div className="p-6 max-w-7xl mx-auto space-y-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-12 skeleton rounded-xl" />)}</div>;

  const visible = tasks.filter(t =>
    (!personFilter || t.assignees.some(a => a.id === personFilter)) && (!hideDone || t.status !== 'done'));
  const sections = buildSections(visible, groups, groupBy, sort);

  const pushLater = async () => {
    try {
      const preview = await reschedule.mutateAsync(false);
      if (!preview.length) return toast('Nothing to move: the remaining conflicts involve finished tasks or tasks in other plans.');
      const biggest = preview.reduce((a, b) => (shiftOf(b) > shiftOf(a) ? b : a));
      const ok = await confirm({
        title: `Move ${preview.length} ${preview.length === 1 ? 'task' : 'tasks'} later?`,
        message: `Tasks that start before the task they wait for is finished move later, keeping their length; tasks after them move too. `
          + `The biggest move is ${shiftOf(biggest)} days ("${biggest.title}"). Finished tasks and tasks in other plans are not moved.`,
        confirmLabel: 'Move tasks',
      });
      if (!ok) return;
      const done = await reschedule.mutateAsync(true);
      toast.success(`${done.length} ${done.length === 1 ? 'task' : 'tasks'} moved`);
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not reschedule')); }
  };

  return <div className={`p-6 mx-auto ${view === 'gantt' ? 'max-w-[1600px]' : 'max-w-7xl'}`}>
    <Link to="/drafting" className="inline-flex items-center gap-1 text-xs font-bold text-[#087f73]"><ArrowLeft className="w-3.5 h-3.5" /> Drafting plans</Link>
    <header className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-[#6f8082]"><span className="font-mono">{plan.plan_code}</span><StatusBadge status={plan.status} /></div>
        <h1 className="text-2xl font-extrabold mt-1">{plan.name}</h1>
        <p className="text-sm text-[#6f8082] mt-1">
          <span className="font-mono">{plan.project.code}</span> · {plan.project.name} · {plan.team.name}{plan.team.manager_name ? ` (manager: ${plan.team.manager_name})` : ''}
        </p>
      </div>
      {canManage && <div className="flex gap-2">
        <button onClick={() => setAddingGroup(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#dce7e2] bg-white text-sm font-bold text-[#53686b]"><FolderPlus className="w-4 h-4" /> Add group</button>
        <button onClick={() => setModal({ defaults: {} })} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold"><Plus className="w-4 h-4" /> New task</button>
      </div>}
    </header>

    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Chip label="Tasks" value={counts.total!} />
      {TASK_STATUSES.map(s => <Chip key={s} label={TASK_STATUS_LABELS[s]} value={counts[s]!} />)}
      {counts.late! > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold"><AlertTriangle className="w-3.5 h-3.5" /> {counts.late} late</span>}
    </div>

    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-[#dce7e2] bg-white p-0.5">
        {([['list', 'List', List], ['gantt', 'Gantt', ChartGantt]] as const).map(([v, label, Icon]) =>
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setParam('view', v, 'list')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold ${view === v ? 'bg-[#087f73] text-white' : 'text-[#53686b] hover:bg-[#f2f7f4]'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>)}
      </div>
      <label className="flex items-center gap-2 text-xs font-bold text-[#53686b]">Group by
        <select value={groupBy} onChange={e => setParam('group', e.target.value, 'group')} className="border border-[#dce7e2] rounded-lg px-2 py-1.5 text-sm font-normal bg-white">
          {GROUP_BY.map(g => <option key={g} value={g}>{GROUP_BY_LABELS[g]}</option>)}
        </select>
      </label>
      <div className="ml-auto flex items-center gap-3">
        <select aria-label="Filter by person" value={personFilter} onChange={e => setPersonFilter(e.target.value)} className="border border-[#dce7e2] rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">Everyone</option>
          {people.map(([pid, name]) => <option key={pid} value={pid}>{name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs font-bold text-[#53686b]"><input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> Hide done</label>
      </div>
    </div>

    {outOfOrder > 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1"><b>{outOfOrder} {outOfOrder === 1 ? 'task starts' : 'tasks start'} before the task {outOfOrder === 1 ? 'it waits' : 'they wait'} for is finished.</b> This is a warning only.</span>
      {canManage && <button onClick={pushLater} disabled={reschedule.isPending} className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-bold hover:bg-amber-100 disabled:opacity-50">Move later tasks…</button>}
    </div>}

    {addingGroup && <NewGroupRow planId={id} onDone={() => setAddingGroup(false)} />}

    {view === 'gantt'
      ? <GanttView planId={id} sections={sections} groupBy={groupBy} tasks={tasks} links={links} externalTasks={externalTasks}
          today={today} canManage={canManage} onOpen={task => setModal({ task })} />
      : <div className="space-y-4">
          {sections.map(section => <BoardSection key={section.key} planId={id} section={section} groupBy={groupBy} today={today}
            canManage={canManage} showHeader={groupBy !== 'none' && (groupBy !== 'group' || groups.length > 0)}
            sort={sort} onSort={setSort} linkInfo={linkInfo} onOpen={setModal} />)}
        </div>}

    {modal && <TaskModal planId={id} groups={groups} teamPeopleIds={teamPeopleIds} task={modal.task}
      defaults={modal.defaults} board={board.data!} onClose={() => setModal(null)} />}
    {dialog}
  </div>;
}

const shiftOf = (c: { start_date: string | null; old_start_date: string | null; due_date: string | null; old_due_date: string | null }) => {
  const [a, b] = c.start_date && c.old_start_date ? [c.old_start_date, c.start_date] : [c.old_due_date, c.due_date];
  return a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) : 0;
};

function Chip({ label, value }: { label: string; value: number }) {
  return <span className="px-3 py-1.5 rounded-lg bg-white border border-[#dce7e2] text-xs text-[#53686b]"><b className="text-[#20333a]">{value}</b> {label}</span>;
}

function NewGroupRow({ planId, onDone }: { planId: string; onDone: () => void }) {
  const save = useSaveGroup(planId);
  const [name, setName] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { await save.mutateAsync({ name: name.trim() }); toast.success('Group added'); onDone(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not add group')); }
  };
  return <form onSubmit={submit} className="mb-4 flex items-center gap-2">
    <input autoFocus aria-label="New group name" value={name} onChange={e => setName(e.target.value)} placeholder="Group name, e.g. LSS Compact Units"
      className="flex-1 max-w-md border border-[#dce7e2] rounded-lg px-3 py-2 text-sm" />
    <button disabled={save.isPending} className="px-3 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold">Add</button>
    <button type="button" onClick={onDone} className="px-3 py-2 text-sm">Cancel</button>
  </form>;
}

const COLUMNS: Array<{ label: string; sort?: SortKey }> = [
  { label: 'Task', sort: 'title' }, { label: 'Assigned to' }, { label: 'Priority', sort: 'priority' }, { label: 'Status', sort: 'status' },
  { label: 'Start', sort: 'start' }, { label: 'Due', sort: 'due' }, { label: 'Days' }, { label: 'Time used' },
];

function BoardSection({ planId, section, groupBy, today, canManage, showHeader, sort, onSort, linkInfo, onOpen }: {
  planId: string; section: Section; groupBy: GroupBy; today: string; canManage: boolean; showHeader: boolean;
  sort: Sort; onSort: (s: Sort) => void; linkInfo: LinkInfo; onOpen: (m: ModalState) => void;
}) {
  const { group, tasks } = section;
  const saveTask = useSaveTask(planId);
  const saveGroup = useSaveGroup(planId);
  const deleteGroup = useDeleteGroup(planId);
  const { confirm, dialog } = useConfirm();
  const [quickTitle, setQuickTitle] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const quickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    try { await saveTask.mutateAsync({ body: { ...section.defaults, title: quickTitle.trim() } }); setQuickTitle(''); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not add task')); }
  };

  const setStatus = async (task: Task, status: TaskStatus) => {
    try { await saveTask.mutateAsync({ id: task.id, body: { status } }); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not update status')); }
  };

  const rename = async () => {
    if (!group || !renaming?.trim()) return setRenaming(null);
    try { await saveGroup.mutateAsync({ id: group.id, name: renaming.trim() }); setRenaming(null); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not rename group')); }
  };

  const removeGroup = async () => {
    if (!group) return;
    const ok = await confirm({ title: 'Delete group?', message: `"${group.name}" will be removed. Its tasks are kept and move to "No group".`, confirmLabel: 'Delete group', danger: true });
    if (!ok) return;
    try { await deleteGroup.mutateAsync(group.id); toast.success('Group deleted'); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not delete group')); }
  };

  const clickSort = (key: SortKey) => onSort(
    sort.key !== key ? { key, desc: false } : sort.desc ? { key: 'manual', desc: false } : { key, desc: true });

  return <section className="bg-white rounded-xl border border-[#dce7e2] overflow-hidden shadow-sm">
    {showHeader && <header className="px-4 py-2.5 bg-[#f2f7f4] border-b border-[#dce7e2] flex items-center gap-2">
      {renaming !== null
        ? <><input autoFocus aria-label="Group name" value={renaming} onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }}
            className="border border-[#dce7e2] rounded px-2 py-1 text-sm font-bold" />
          <button onClick={rename} aria-label="Save group name" className="p-1 text-[#087f73]"><Check className="w-4 h-4" /></button>
          <button onClick={() => setRenaming(null)} aria-label="Cancel rename" className="p-1 text-[#80908f]"><X className="w-4 h-4" /></button></>
        : <h2 className="font-extrabold text-sm">{section.label}</h2>}
      <span className="text-xs text-[#6f8082]">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span>
      {group && groupBy === 'group' && canManage && renaming === null && <div className="ml-auto flex">
        <button onClick={() => setRenaming(group.name)} aria-label={`Rename ${group.name}`} className="p-1.5 text-[#80908f] hover:text-[#087f73]"><Pencil className="w-3.5 h-3.5" /></button>
        <button onClick={removeGroup} aria-label={`Delete ${group.name}`} className="p-1.5 text-[#80908f] hover:text-rose-700"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>}
    </header>}

    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[880px]">
        <thead><tr className="border-b border-[#edf2ef]">{COLUMNS.map(c =>
          <th key={c.label} aria-sort={c.sort && sort.key === c.sort ? (sort.desc ? 'descending' : 'ascending') : undefined}
            className="text-left px-4 py-2 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">
            {c.sort
              ? <button onClick={() => clickSort(c.sort!)} className="inline-flex items-center gap-1 uppercase tracking-[.13em] hover:text-[#087f73]">
                  {c.label}{sort.key === c.sort && (sort.desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
                </button>
              : c.label}
          </th>)}</tr></thead>
        <tbody>
          {tasks.map(task => {
            const late = isLate(task, today);
            const elapsed = timeElapsedPercent(task.start_date, task.due_date, today);
            const days = durationDays(task.start_date, task.due_date);
            const li = linkInfo.get(task.id);
            return <tr key={task.id} className="border-b border-[#edf2ef] last:border-0 hover:bg-[#f8fbf9]">
              <td className="px-4 py-2.5 max-w-[340px]">
                <button onClick={() => onOpen({ task })} className={`text-left font-semibold hover:text-[#087f73] ${task.status === 'done' ? 'line-through text-[#8a9b9a]' : ''}`}>{task.title}</button>
                {li && <span title={li.earlyBy ? `Starts ${li.earlyBy} ${li.earlyBy === 1 ? 'day' : 'days'} before the task it waits for allows` : `Waits for ${li.waitsFor} ${li.waitsFor === 1 ? 'task' : 'tasks'}`}
                  className={`ml-2 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold align-middle ${li.earlyBy ? 'bg-amber-100 text-amber-800' : 'bg-[#eef4f1] text-[#53686b]'}`}>
                  <Link2 className="w-3 h-3" />{li.waitsFor}{li.earlyBy ? ` · ${li.earlyBy}d early` : ''}
                </span>}
                {task.notes && <div className="text-xs text-[#8a9b9a] truncate">{task.notes}</div>}
              </td>
              <td className="px-4 py-2.5"><div className="flex -space-x-1.5" title={task.assignees.map(a => a.name).join(', ')}>
                {task.assignees.length ? task.assignees.map(a => <Avatar key={a.id} person={a} />) : <span className="text-xs text-[#a3b1af]">—</span>}
              </div></td>
              <td className="px-4 py-2.5"><span className={`px-2 py-1 rounded-md text-[11px] font-bold ${PRIORITY_STYLE[task.priority]}`}>{TASK_PRIORITY_LABELS[task.priority]}</span></td>
              <td className="px-4 py-2.5">{canManage
                ? <select aria-label={`Status of ${task.title}`} value={task.status} onChange={e => setStatus(task, e.target.value as TaskStatus)}
                    className={`border rounded-md px-2 py-1 text-xs font-bold ${STATUS_STYLE[task.status]}`}>
                    {TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                  </select>
                : <span className={`border rounded-md px-2 py-1 text-xs font-bold ${STATUS_STYLE[task.status]}`}>{TASK_STATUS_LABELS[task.status]}</span>}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-[#53686b]">{formatDay(task.start_date)}</td>
              <td className={`px-4 py-2.5 whitespace-nowrap ${late ? 'text-rose-700 font-bold' : 'text-[#53686b]'}`}>{formatDay(task.due_date)}</td>
              <td className="px-4 py-2.5 text-[#53686b]">{days ?? '—'}</td>
              <td className="px-4 py-2.5 w-40">{task.status === 'done'
                ? <span className="text-xs font-bold text-[#087f73]">Done</span>
                : elapsed === null ? <span className="text-xs text-[#a3b1af]">No dates</span>
                : <div className="flex items-center gap-2" title={late ? 'Past due date' : `${elapsed}% of the planned time used`}>
                    <div className="h-1.5 flex-1 rounded-full bg-[#edf2ef] overflow-hidden"><div className={`h-full rounded-full ${late ? 'bg-rose-500' : elapsed >= 80 ? 'bg-amber-500' : 'bg-[#087f73]'}`} style={{ width: `${elapsed}%` }} /></div>
                    <span className={`text-xs tabular-nums ${late ? 'text-rose-700 font-bold' : 'text-[#53686b]'}`}>{late ? 'Late' : `${elapsed}%`}</span>
                  </div>}</td>
            </tr>;
          })}
          {tasks.length === 0 && <tr><td colSpan={8} className="px-4 py-4 text-sm text-[#8a9b9a]">No tasks here yet.</td></tr>}
        </tbody>
      </table>
    </div>

    {canManage && <form onSubmit={quickAdd} className="flex items-center gap-2 px-4 py-2 border-t border-[#edf2ef] bg-[#fbfdfc]">
      <Plus className="w-4 h-4 text-[#80908f]" />
      <input aria-label={`Add a task${showHeader ? ` to ${section.label}` : ''}`} value={quickTitle} onChange={e => setQuickTitle(e.target.value)}
        placeholder="Add a task and press Enter" className="flex-1 bg-transparent text-sm py-1 outline-none" />
    </form>}
    {dialog}
  </section>;
}
