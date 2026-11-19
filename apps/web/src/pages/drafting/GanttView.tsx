import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  apiErrorMessage, BoardCalendar, ExternalTask, LINK_TYPE_LABELS, Task, TaskLink, TaskStatus, TASK_STATUS_LABELS,
  useCreateLink, useDeleteLink, useSaveTask,
} from './draftingApi';
import { GroupBy, Section } from './planViews';
import { addDays, daysBetween, isLate } from './taskTiming';
import { useConfirm } from '../../hooks/useConfirm';

const ROW = 34;
const HEAD = 48;
const NAME_W = 300;
const ZOOMS = { day: 30, week: 12, month: 4 } as const;
type Zoom = keyof typeof ZOOMS;

const BAR: Record<TaskStatus, string> = {
  not_started: 'bg-stone-300 text-stone-800',
  in_progress: 'bg-sky-500 text-white',
  review: 'bg-violet-500 text-white',
  done: 'bg-blue-600/60 text-white',
};

type Dates = { start: string; due: string };
type Row = { kind: 'section'; key: string; label: string; count: number } | { kind: 'task'; key: string; task: Task };
type Drag = { id: string; mode: 'move' | 'start' | 'end'; x0: number; orig: Dates; moved: boolean };
type Linking = { fromId: string; x1: number; y1: number; x2: number; y2: number };

/** The days a task covers on the chart; a task with one date shows as a one-day bar. */
const spanOf = (t: { start_date: string | null; due_date: string | null }): Dates | null => {
  const start = t.start_date ?? t.due_date, due = t.due_date ?? t.start_date;
  return start && due ? { start, due } : null;
};

const mondayOnOrBefore = (iso: string) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
};

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });

/** Hours worked on a day by the plan calendar (exceptions first, then the weekday; Monday = index 0). */
const hoursOn = (cal: BoardCalendar, iso: string) => {
  const ex = cal.days[iso];
  if (ex !== undefined) return ex;
  return Number(cal.week_hours[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7] ?? 0);
};

type Props = {
  planId: string; sections: Section[]; groupBy: GroupBy; tasks: Task[]; links: TaskLink[]; externalTasks: ExternalTask[];
  calendar: BoardCalendar; hasBaseline: boolean;
  today: string; canManage: boolean; onOpen: (task: Task) => void;
};

export default function GanttView({ planId, sections, groupBy, tasks, links, externalTasks, calendar, hasBaseline, today, canManage, onOpen }: Props) {
  const saveTask = useSaveTask(planId);
  const createLink = useCreateLink(planId);
  const deleteLink = useDeleteLink(planId);
  const { confirm, dialog } = useConfirm();
  const [zoom, setZoom] = useState<Zoom>('day');
  const [showCritical, setShowCritical] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  // Dates shown while a move is being saved; `settled` ones are dropped when the refreshed board arrives.
  const [overrides, setOverrides] = useState<Record<string, Dates & { settled?: boolean }>>({});
  const [preview, setPreview] = useState<{ id: string } & Dates | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const drag = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dayW = ZOOMS[zoom];

  useEffect(() => {
    setOverrides(o => (Object.values(o).some(d => d.settled)
      ? Object.fromEntries(Object.entries(o).filter(([, d]) => !d.settled)) : o));
  }, [tasks]);

  const datesOf = (t: Task): Dates | null => (preview?.id === t.id ? preview : overrides[t.id] ?? spanOf(t));

  const rows: Row[] = useMemo(() => sections.flatMap(s => [
    ...(groupBy !== 'none' ? [{ kind: 'section' as const, key: `s-${s.key}`, label: s.label, count: s.tasks.length }] : []),
    ...s.tasks.map(task => ({ kind: 'task' as const, key: `${s.key}-${task.id}`, task })),
  ]), [sections, groupBy]);

  const rowOf = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => { if (r.kind === 'task' && !m.has(r.task.id)) m.set(r.task.id, i); });
    return m;
  }, [rows]);

  const range = useMemo(() => {
    const taskDates = sections.flatMap(s => s.tasks.flatMap(t => [t.start_date, t.due_date].filter((d): d is string => !!d))).sort();
    const dates = [today, ...taskDates].sort();
    const start = mondayOnOrBefore(addDays(dates[0]!, -7));
    const end = addDays(dates[dates.length - 1]!, 28);
    // Open on today while the plan is running; otherwise on its first task.
    const first = taskDates[0], last = taskDates[taskDates.length - 1];
    const focus = !first || (first <= today && today <= addDays(last!, 14)) ? today : first;
    return { start, days: daysBetween(start, end) + 1, focus };
  }, [sections, today]);
  const width = range.days * dayW;
  const xOf = (iso: string) => daysBetween(range.start, iso) * dayW;
  const scrollTo = (iso: string) => { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xOf(iso) - 2 * 7 * dayW); };

  // Only on opening and zoom changes, so editing a task never makes the chart jump.
  useLayoutEffect(() => { scrollTo(range.focus); }, [zoom]);

  const months = useMemo(() => {
    const out: Array<{ key: string; x: number; w: number; label: string }> = [];
    let d = range.start;
    const end = addDays(range.start, range.days);
    while (d < end) {
      const [y, m] = d.split('-').map(Number);
      const next = `${m === 12 ? y! + 1 : y}-${String(m === 12 ? 1 : m! + 1).padStart(2, '0')}-01`;
      const stop = next < end ? next : end;
      out.push({ key: d, x: xOf(d), w: daysBetween(d, stop) * dayW, label: fmt(d, { month: 'short', year: 'numeric' }) });
      d = next;
    }
    return out;
  }, [range, dayW]);

  const ticks = useMemo(() => {
    const step = zoom === 'day' ? 1 : zoom === 'week' ? 7 : 0;
    if (!step) return [];
    return Array.from({ length: Math.ceil(range.days / step) }, (_, i) => addDays(range.start, i * step));
  }, [range, zoom]);

  // ---------- dragging bars ----------

  const pointerToChart = (e: { clientX: number; clientY: number }) => {
    const r = innerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - NAME_W, y: e.clientY - r.top - HEAD };
  };

  const onBarDown = (e: React.PointerEvent, task: Task) => {
    const handle = (e.target as HTMLElement).dataset.handle;
    const dates = datesOf(task);
    if (!dates) return;
    if (handle === 'link') {
      if (!canManage) return;
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const p = pointerToChart(e);
      setLinking({ fromId: task.id, x1: xOf(dates.due) + dayW, y1: rowOf.get(task.id)! * ROW + ROW / 2, x2: p.x, y2: p.y });
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: task.id, mode: handle === 'start' ? 'start' : handle === 'end' ? 'end' : 'move', x0: e.clientX, orig: dates, moved: false };
  };

  const onBarMove = (e: React.PointerEvent) => {
    if (linking) { const p = pointerToChart(e); setLinking({ ...linking, x2: p.x, y2: p.y }); return; }
    const d = drag.current;
    if (!d || !canManage) return;
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved) return;
    const n = Math.round(dx / dayW);
    const { start, due } = d.orig;
    const next = d.mode === 'move' ? { start: addDays(start, n), due: addDays(due, n) }
      : d.mode === 'start' ? { start: addDays(start, Math.min(n, daysBetween(start, due))), due }
      : { start, due: addDays(due, Math.max(n, -daysBetween(start, due))) };
    setPreview({ id: d.id, ...next });
  };

  const onBarUp = async (e: React.PointerEvent, task: Task) => {
    if (linking) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId;
      const from = linking.fromId;
      setLinking(null);
      if (target && target !== from) {
        try { await createLink.mutateAsync({ successorId: target, predecessorId: from }); toast.success('Link added'); }
        catch (err) { toast.error(apiErrorMessage(err, 'Could not link the tasks')); }
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) { setPreview(null); onOpen(task); return; }
    const p = preview;
    setPreview(null);
    if (!p || (p.start === d.orig.start && p.due === d.orig.due)) return;
    setOverrides(o => ({ ...o, [task.id]: { start: p.start, due: p.due } }));
    try {
      await saveTask.mutateAsync({ id: task.id, body: { start_date: p.start, due_date: p.due } });
      setOverrides(o => (o[task.id] ? { ...o, [task.id]: { ...o[task.id]!, settled: true } } : o));
    } catch (err) {
      setOverrides(o => { const { [task.id]: _, ...rest } = o; return rest; });
      toast.error(apiErrorMessage(err, 'Could not move the task'));
    }
  };

  /** Clicking a day on an undated task's row gives it a 5-day slot starting that day. */
  const scheduleAt = async (e: React.MouseEvent, task: Task) => {
    if (!canManage) return onOpen(task);
    const day = addDays(range.start, Math.floor(pointerToChart(e).x / dayW));
    try { await saveTask.mutateAsync({ id: task.id, body: { start_date: day, due_date: addDays(day, 4) } }); }
    catch (err) { toast.error(apiErrorMessage(err, 'Could not schedule the task')); }
  };

  // ---------- link arrows ----------

  const byId = useMemo(() => new Map<string, { title: string; status: string; start_date: string | null; due_date: string | null }>(
    [...tasks, ...externalTasks].map(t => [t.id, t])), [tasks, externalTasks]);

  const arrows = links.flatMap(l => {
    const pr = rowOf.get(l.predecessor_id), sr = rowOf.get(l.successor_id);
    const pred = tasks.find(t => t.id === l.predecessor_id), succ = tasks.find(t => t.id === l.successor_id);
    if (pr === undefined || sr === undefined || !pred || !succ) return [];
    const pd = datesOf(pred), sd = datesOf(succ);
    if (!pd || !sd) return [];
    const fromEnd = l.link_type === 'FS' || l.link_type === 'FF';
    const toStart = l.link_type === 'FS' || l.link_type === 'SS';
    const x1 = fromEnd ? xOf(pd.due) + dayW : xOf(pd.start);
    const x2 = toStart ? xOf(sd.start) : xOf(sd.due) + dayW;
    const y1 = pr * ROW + ROW / 2, y2 = sr * ROW + ROW / 2;
    const xa = x1 + (fromEnd ? 6 : -6), xb = x2 + (toStart ? -6 : 6);
    const ymid = y2 > y1 ? y2 - ROW / 2 : y2 + ROW / 2;
    const early = l.early_days ?? 0;
    const critical = showCritical && !!pred.critical && !!succ.critical;
    return [{ link: l, d: `M${x1},${y1} H${xa} V${ymid} H${xb} V${y2} H${x2}`, early, critical, pred, succ }];
  });

  const removeLink = async (a: (typeof arrows)[number]) => {
    if (!canManage) return;
    const ok = await confirm({
      title: 'Remove link?',
      message: `"${a.succ.title}" will no longer wait for "${a.pred.title}" (${LINK_TYPE_LABELS[a.link.link_type].toLowerCase()}${a.link.lag_days ? `, ${a.link.lag_days > 0 ? '+' : ''}${a.link.lag_days} days` : ''}).`,
      confirmLabel: 'Remove link', danger: true,
    });
    if (!ok) return;
    try { await deleteLink.mutateAsync(a.link.id); } catch (err) { toast.error(apiErrorMessage(err, 'Could not remove link')); }
  };

  const externalPreds = (taskId: string) => links.filter(l => l.successor_id === taskId && !rowOf.has(l.predecessor_id))
    .map(l => externalTasks.find(t => t.id === l.predecessor_id)).filter((t): t is ExternalTask => !!t);

  // Week lines (range starts on a Monday); Sundays and holidays are shaded from the plan calendar.
  const grid = `repeating-linear-gradient(90deg, #edf2ef 0 1px, transparent 1px ${7 * dayW}px)`;
  const offDays = useMemo(() => Array.from({ length: range.days }, (_, i) => addDays(range.start, i))
    .filter(d => hoursOn(calendar, d) === 0)
    .map(d => ({ day: d, name: calendar.days[d] === 0 ? 'Holiday' : 'Day off' })), [range, calendar]);
  const criticalCount = tasks.filter(t => t.critical).length;

  return <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
    <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-stone-200 bg-stone-50 text-xs text-stone-600">
      <div role="radiogroup" aria-label="Zoom" className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5">
        {(Object.keys(ZOOMS) as Zoom[]).map(z => <button key={z} role="radio" aria-checked={zoom === z} onClick={() => setZoom(z)}
          className={`px-2.5 py-1 rounded-md font-bold capitalize ${zoom === z ? 'bg-blue-600 text-white hover:bg-blue-700' : 'hover:bg-stone-50'}`}>{z}s</button>)}
      </div>
      <button onClick={() => scrollTo(today)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-stone-200 bg-white font-bold"><CalendarDays className="w-3.5 h-3.5" /> Today</button>
      <label className="inline-flex items-center gap-1.5 font-bold" title="Tasks with no slack: a delay on any of them delays the plan's last task">
        <input type="checkbox" checked={showCritical} onChange={e => setShowCritical(e.target.checked)} />
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500" /> Critical path ({criticalCount})
      </label>
      {hasBaseline && <label className="inline-flex items-center gap-1.5 font-bold">
        <input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} />
        <span className="inline-block w-3 h-1 rounded-sm bg-stone-400" /> Baseline
      </label>}
      <span className="ml-auto text-[11px]">{canManage ? 'Drag a bar to move it, its ends to change dates; drag the dot at a bar\'s end onto another bar to link them; click an arrow to remove it.' : 'Read-only.'}</span>
    </div>

    <div ref={scrollRef} className="overflow-auto max-h-[72vh]">
      <div ref={innerRef} className="relative select-none" style={{ width: NAME_W + width, height: HEAD + rows.length * ROW }}>
        {/* header */}
        <div className="sticky top-0 z-20 flex bg-white border-b border-stone-200" style={{ height: HEAD }}>
          <div className="sticky left-0 z-10 bg-white border-r border-stone-200 px-4 flex items-end pb-1.5 text-[10px] uppercase tracking-[.13em] font-extrabold text-stone-500" style={{ width: NAME_W, minWidth: NAME_W }}>Task</div>
          <div className="relative" style={{ width }}>
            {months.map(m => <div key={m.key} className="absolute top-0 h-6 border-l border-stone-200 px-1.5 text-[11px] font-bold text-stone-800 leading-6 truncate" style={{ left: m.x, width: m.w }}>{m.label}</div>)}
            {ticks.map(d => <div key={d} className={`absolute top-6 h-6 text-center text-[10px] leading-6 ${d === today ? 'text-rose-600 font-bold' : 'text-stone-500'}`}
              style={{ left: xOf(d), width: zoom === 'day' ? dayW : 7 * dayW, textAlign: zoom === 'day' ? 'center' : 'left' }}>
              {zoom === 'day' ? Number(d.slice(8)) : <span className="pl-1">{Number(d.slice(8))}</span>}
            </div>)}
          </div>
        </div>

        {/* rows */}
        {rows.map(r => r.kind === 'section'
          ? <div key={r.key} className="flex bg-stone-50 border-b border-stone-200" style={{ height: ROW }}>
              <div className="sticky left-0 z-10 bg-stone-50 px-4 flex items-center gap-2 text-sm font-extrabold" style={{ width: NAME_W, minWidth: NAME_W }}>
                <span className="truncate">{r.label}</span><span className="text-xs font-normal text-stone-500">{r.count}</span>
              </div>
              <div style={{ width }} />
            </div>
          : <TaskRow key={r.key} task={r.task} dates={datesOf(r.task)} today={today} dayW={dayW} width={width} grid={grid} xOf={xOf}
              canManage={canManage} externalPreds={externalPreds(r.task.id)} onOpen={onOpen} critical={showCritical && !!r.task.critical}
              baseline={hasBaseline && showBaseline ? spanOf({ start_date: r.task.baseline_start ?? null, due_date: r.task.baseline_due ?? null }) : null}
              onBarDown={onBarDown} onBarMove={onBarMove} onBarUp={onBarUp} onSchedule={scheduleAt} />)}

        {/* Sundays and holidays on the plan calendar */}
        {zoom !== 'month' && offDays.map(o => <div key={o.day} className="absolute z-[2] bg-stone-400/10 pointer-events-none"
          style={{ left: NAME_W + xOf(o.day), width: dayW, top: HEAD, bottom: 0 }} />)}

        {/* today line */}
        <div className="absolute z-[6] w-0.5 bg-rose-400/70 pointer-events-none" style={{ left: NAME_W + xOf(today) + dayW / 2, top: HEAD, bottom: 0 }} />

        {/* link arrows */}
        <svg className="absolute z-[5] pointer-events-none overflow-visible" style={{ left: NAME_W, top: HEAD }} width={width} height={rows.length * ROW}>
          <defs>
            {[['ok', '#7d8f8e'], ['early', '#d97706'], ['critical', '#e11d48']].map(([id, c]) =>
              <marker key={id} id={`gantt-arrow-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill={c} />
              </marker>)}
          </defs>
          {arrows.map(a => <g key={a.link.id}>
            <path d={a.d} fill="none" stroke={a.early ? '#d97706' : a.critical ? '#e11d48' : '#7d8f8e'} strokeWidth={a.early || a.critical ? 1.75 : 1.25}
              markerEnd={`url(#gantt-arrow-${a.early ? 'early' : a.critical ? 'critical' : 'ok'})`} />
            <path d={a.d} fill="none" stroke="transparent" strokeWidth={10} className={canManage ? 'cursor-pointer' : ''} style={{ pointerEvents: 'stroke' }}
              onClick={() => removeLink(a)}>
              <title>{`${a.pred.title} → ${a.succ.title}\n${LINK_TYPE_LABELS[a.link.link_type]}${a.link.lag_days ? `, ${a.link.lag_days > 0 ? '+' : ''}${a.link.lag_days} days` : ''}${a.early ? `\nStarts ${a.early} days too early` : ''}`}</title>
            </path>
          </g>)}
          {linking && <line x1={linking.x1} y1={linking.y1} x2={linking.x2} y2={linking.y2} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#gantt-arrow-ok)" />}
        </svg>
      </div>
    </div>
    {rows.length === 0 && <p className="px-4 py-6 text-sm text-stone-400">No tasks to show.</p>}
    {dialog}
  </div>;
}

function TaskRow({ task, dates, today, dayW, width, grid, xOf, canManage, externalPreds, onOpen, critical, baseline, onBarDown, onBarMove, onBarUp, onSchedule }: {
  task: Task; dates: Dates | null; today: string; dayW: number; width: number; grid: string; xOf: (iso: string) => number;
  canManage: boolean; externalPreds: ExternalTask[]; onOpen: (t: Task) => void; critical: boolean; baseline: Dates | null;
  onBarDown: (e: React.PointerEvent, t: Task) => void; onBarMove: (e: React.PointerEvent) => void;
  onBarUp: (e: React.PointerEvent, t: Task) => void; onSchedule: (e: React.MouseEvent, t: Task) => void;
}) {
  const late = isLate(task, today);
  const done = task.status === 'done';
  const events = {
    'data-task-id': task.id, role: 'button', tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(task); },
    onPointerDown: (e: React.PointerEvent) => onBarDown(e, task), onPointerMove: onBarMove, onPointerUp: (e: React.PointerEvent) => onBarUp(e, task),
  };
  const linkDot = canManage && <span data-handle="link" title="Drag onto another task to make it wait for this one"
    className="absolute -right-3.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2 border-blue-600 bg-white opacity-0 group-hover/bar:opacity-100 cursor-crosshair" />;
  const who = <span className="pointer-events-none absolute left-full top-0 ml-4 whitespace-nowrap text-[11px] leading-5 text-stone-500">
    {task.assignees.map(a => a.name.split(' ')[0]).join(', ')}
  </span>;
  return <div className="group/row flex border-b border-stone-100 hover:bg-stone-50" style={{ height: ROW }}>
    <div className="sticky left-0 z-10 bg-white group-hover/row:bg-stone-50 border-r border-stone-200 px-4 flex items-center gap-2 min-w-0" style={{ width: NAME_W, minWidth: NAME_W }}>
      <button onClick={() => onOpen(task)} title={task.title}
        className={`truncate text-left text-sm font-semibold hover:text-blue-600 ${done ? 'line-through text-stone-400' : ''}`}>{task.title}</button>
      {externalPreds.length > 0 && <span title={`Waits for: ${externalPreds.map(t => `${t.plan_code} · ${t.title}`).join('; ')}`}
        className="shrink-0 inline-flex items-center gap-0.5 rounded bg-[#eef4f1] px-1 py-0.5 text-[10px] font-bold text-stone-600"><Link2 className="w-3 h-3" />{externalPreds[0]!.plan_code}</span>}
    </div>
    <div className="relative" style={{ width, backgroundImage: grid, backgroundPosition: '0 0' }}>
      {baseline && <div title={`Baseline: ${baseline.start} to ${baseline.due}`} className="absolute z-[3] top-[28px] h-1 rounded-full bg-stone-400/70 pointer-events-none"
        style={{ left: xOf(baseline.start), width: Math.max(dayW, (daysBetween(baseline.start, baseline.due) + 1) * dayW) - 1 }} />}
      {dates && task.is_milestone
        ? <div {...events} aria-label={`Milestone ${task.title}: ${dates.start}, ${TASK_STATUS_LABELS[task.status]}`}
            className={`group/bar absolute z-[3] top-[9px] h-4 w-4 rotate-45 rounded-[2px] shadow-sm ${critical && !done ? 'bg-rose-600' : done ? 'bg-blue-600/60' : 'bg-blue-600'} ${late ? 'ring-2 ring-rose-500' : ''} ${canManage ? 'cursor-grab' : 'cursor-pointer'}`}
            style={{ left: xOf(dates.start) + dayW / 2 - 8, touchAction: 'none' }}>
            <span className="-rotate-45 absolute inset-0">{linkDot}{who}</span>
          </div>
        : dates
        ? <div {...events} aria-label={`${task.title}: ${dates.start} to ${dates.due}, ${TASK_STATUS_LABELS[task.status]}, ${task.progress_pct}% done${critical ? ', critical' : ''}`}
            className={`group/bar absolute z-[3] top-[7px] h-5 rounded-md shadow-sm overflow-visible ${critical && !done ? 'bg-rose-500 text-white' : BAR[task.status]} ${late ? 'ring-2 ring-rose-500 ring-offset-1' : ''} ${canManage ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
            style={{ left: xOf(dates.start), width: Math.max(dayW, (daysBetween(dates.start, dates.due) + 1) * dayW) - 1, touchAction: 'none' }}>
            {!done && task.progress_pct > 0 && <span className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-black/25" style={{ width: `${task.progress_pct}%` }} />}
            {(daysBetween(dates.start, dates.due) + 1) * dayW > 90 && <span className="pointer-events-none relative block truncate px-2 text-[11px] font-semibold leading-5">{task.title}</span>}
            {canManage && <>
              <span data-handle="start" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md hover:bg-black/20" />
              <span data-handle="end" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md hover:bg-black/20" />
            </>}
            {linkDot}{who}
          </div>
        : <button onClick={e => onSchedule(e, task)} className="absolute inset-0 text-left px-3 text-xs text-[#a3b1af] hover:text-blue-600">
            <span className="sticky inline-block" style={{ left: NAME_W + 12 }}>{canManage ? 'No dates — click a day to schedule it' : 'No dates'}</span>
          </button>}
    </div>
  </div>;
}
