// My Work as a calendar: Week (meetings, regular commitments, a capacity bar and task bars per
// day; drag your own tasks to another day) and Month (due dates and meetings, to look ahead).
import { ReactNode, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Diamond, ExternalLink, Repeat, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { apiErrorMessage } from '../drafting/draftingApi';
import { addDays } from '../drafting/taskTiming';
import type { WorkloadDay } from '../drafting/planningApi';
import { Commitment, useMyWork, useSavePersonalTask, WorkItem } from './myWorkApi';
import {
  CalendarEvent, commitmentOn, eventsOn, isLocalToday, meetingHours, mondayOf, monthGrid, regularMeetings, shiftDates, stackRows, taskRange, weekDays, weekSpan,
} from './calendarLayout';

const dayName = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const h = (n: number) => `${Math.round(n * 10) / 10} h`;

/** Google events for a date range (read-only), when the person has connected their calendar. */
function useGoogleEvents(from: string, to: string) {
  const status = useQuery({
    queryKey: ['google-calendar', 'status'],
    queryFn: () => api.get('/google-calendar/status').then(r => r.data as { connected: boolean }),
    retry: false,
  });
  const events = useQuery({
    queryKey: ['google-calendar', 'events', 'range', from, to],
    enabled: !!status.data?.connected,
    // A day wider each side so events near midnight in local time are not lost.
    queryFn: () => api.get('/google-calendar/events', { params: { from: addDays(from, -1), to: addDays(to, 1) } }).then(r => r.data.events as CalendarEvent[]),
  });
  return { connected: !!status.data?.connected, events: events.data ?? [], error: events.isError };
}

const tone = (item: WorkItem) => item.status === 'done' ? 'bg-stone-100 text-stone-400 line-through border-stone-200'
  : item.kind === 'plan' ? 'bg-sky-50 text-sky-900 border-sky-200' : 'bg-blue-50 text-[#0b4f48] border-[#bcdcd3]';

/** The task's details and controls (the list row), shown when a bar is clicked. */
function TaskPopover({ item, onClose, children }: { item: WorkItem; onClose: () => void; children: ReactNode }) {
  return <div role="dialog" aria-label={item.title} className="fixed inset-0 z-40 flex items-start justify-center pt-24 px-4 bg-stone-900/10" onClick={onClose}>
    <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-stone-200" onClick={e => e.stopPropagation()}>
      <div className="flex justify-end px-2 pt-2"><button aria-label="Close" onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700"><X className="w-4 h-4" /></button></div>
      <ul className="pb-3">{children}</ul>
    </div>
  </div>;
}

type Props = {
  from: string; items: WorkItem[]; commitments: Commitment[]; days: WorkloadDay[];
  onShift: (weeks: number) => void; onToday: () => void; renderRow: (item: WorkItem) => ReactNode;
};

export function WeekCalendar({ from, items, commitments, days, onShift, onToday, renderRow }: Props) {
  const dates = weekDays(from);
  const google = useGoogleEvents(from, addDays(from, 7));
  const save = useSavePersonalTask();
  const [open, setOpen] = useState<WorkItem | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const grab = useRef<{ item: WorkItem; col: number } | null>(null);
  const [dropCol, setDropCol] = useState<number | null>(null);

  const placed = useMemo(() => items.flatMap(item => {
    const span = weekSpan(item, from);
    return span ? [{ ...span, item }] : [];
  }), [items, from]);
  const rows = useMemo(() => stackRows(placed), [placed]);
  const undated = items.filter(i => !taskRange(i) && i.status !== 'done');
  const spread = commitments.filter(c => c.capacity_pct);

  const colAt = (clientX: number) => {
    const r = grid.current!.getBoundingClientRect();
    return Math.max(0, Math.min(6, Math.floor(((clientX - r.left) / r.width) * 7)));
  };
  const drop = async (clientX: number) => {
    const g = grab.current; grab.current = null; setDropCol(null);
    if (!g) return;
    const col = colAt(clientX);
    const target = dates[col]!;
    const body = taskRange(g.item) ? shiftDates(g.item, col - g.col) : { start_date: null, due_date: target };
    if (taskRange(g.item) && col === g.col) return;
    try {
      await save.mutateAsync({ id: g.item.id, body });
      const short = (d: string) => dayName(d, { weekday: 'short', day: 'numeric', month: 'short' });
      toast.success(body.start_date && body.due_date && body.start_date !== body.due_date
        ? `${g.item.title}: now ${short(body.start_date)} – ${short(body.due_date)}`
        : `${g.item.title} moved to ${short(target)}`);
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not move the task')); }
  };
  const draggable = (item: WorkItem) => item.kind === 'task' && item.status !== 'done';

  return <div className="p-4">
    <div className="flex items-center gap-2 mb-3">
      <button aria-label="Previous week" onClick={() => onShift(-1)} className="p-1.5 rounded-lg border border-stone-200 text-stone-500 hover:text-blue-600"><ChevronLeft className="w-4 h-4" /></button>
      <button aria-label="Next week" onClick={() => onShift(1)} className="p-1.5 rounded-lg border border-stone-200 text-stone-500 hover:text-blue-600"><ChevronRight className="w-4 h-4" /></button>
      <button onClick={onToday} className="px-2.5 py-1 rounded-lg border border-stone-200 text-xs font-bold text-stone-600">Today</button>
      <span className="text-sm font-bold text-stone-800">{dayName(from, { day: 'numeric', month: 'short' })} – {dayName(addDays(from, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <span className="ml-auto text-[11px] text-stone-500 hidden md:inline">Drag your own tasks to another day. Plan tasks move in their plan.</span>
    </div>

    <div className="overflow-x-auto"><div className="min-w-[760px]">
      {/* Day headers with the capacity bar: booked work + meetings against the hours you can work. */}
      <div className="grid grid-cols-7 gap-px bg-stone-200 border border-stone-200 rounded-t-xl overflow-hidden">
        {dates.map((d, i) => {
          const day = days[i];
          const meet = meetingHours(google.events, d, commitments);
          const used = (day?.booked ?? 0) + meet;
          const cap = day?.capacity ?? 0;
          const pct = cap ? used / cap : used ? 2 : 0;
          const bar = pct > 1.0001 ? 'bg-rose-500' : pct >= 0.9 ? 'bg-amber-500' : 'bg-blue-600';
          const off = !cap && !(day?.leave);
          return <div key={d} className={`px-2 py-1.5 ${isLocalToday(d) ? 'bg-[#eef8f5]' : off ? 'bg-stone-50' : 'bg-white'}`}>
            <div className={`text-[11px] font-bold ${isLocalToday(d) ? 'text-blue-600' : 'text-stone-600'}`}>{dayName(d, { weekday: 'short', day: 'numeric' })}</div>
            {off ? <div className="text-[10px] text-stone-400 mt-1">Not working</div> : <>
              <div className="text-[10px] tabular-nums text-stone-500 mt-0.5" title={`Tasks and commitments ${h(day?.booked ?? 0)} · meetings ${h(meet)} · can work ${h(cap)}${day?.leave ? ` · leave ${h(day.leave)}` : ''}`}>
                {h(used)} / {h(cap)}{day?.leave ? <span className="text-amber-700"> · leave</span> : null}
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} /></div>
            </>}
          </div>;
        })}
      </div>

      {/* Meetings from Google and regular commitments on their weekdays. */}
      <div className="grid grid-cols-7 gap-px bg-stone-200 border-x border-stone-200">
        {dates.map(d => {
          const evs = eventsOn(google.events, d);
          // A Google meeting that is also a regular commitment is shown once, as the meeting, marked as regular.
          const matched = regularMeetings(google.events, commitments, d);
          const regular = commitments.filter(c => commitmentOn(c, d) && ![...matched.values()].includes(c.id));
          return <div key={d} className="bg-white px-1.5 py-1.5 min-h-[44px] space-y-0.5">
            {evs.map(e => {
              const as = matched.has(e.id) ? commitments.find(c => c.id === matched.get(e.id)) : undefined;
              return <div key={e.id} title={[e.title, e.location, as && `Your regular commitment "${as.title}": its hours count once`].filter(Boolean).join(' · ')}
              className={`flex items-center gap-1 text-[10.5px] leading-tight rounded px-1 py-0.5 ${e.all_day ? 'bg-violet-100 text-violet-900' : as ? 'bg-violet-50 text-violet-900 ring-1 ring-inset ring-amber-300' : e.busy ? 'bg-violet-50 text-violet-900' : 'text-stone-400'}`}>
              {as && <Repeat className="w-2.5 h-2.5 shrink-0 text-amber-700" aria-label="Regular commitment" />}
              {!e.all_day && <span className="tabular-nums shrink-0 text-violet-700/80">{timeOf(e.start)}</span>}
              <span className="truncate">{e.title}</span>
              {e.link && <a href={e.link} target="_blank" rel="noreferrer" aria-label={`Open ${e.title} in Google Calendar`} className="ml-auto shrink-0 text-violet-400 hover:text-violet-700"><ExternalLink className="w-2.5 h-2.5" /></a>}
            </div>;
            })}
            {regular.map(c => <div key={c.id} title={`${c.title} (regular commitment)`} className="flex items-center gap-1 text-[10.5px] leading-tight rounded px-1 py-0.5 bg-amber-50 text-amber-900">
              <Repeat className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{c.title}</span><span className="ml-auto shrink-0 tabular-nums">{h(commitmentOn(c, d))}</span>
            </div>)}
          </div>;
        })}
      </div>

      {/* Task bars across the days they cover. */}
      <div ref={grid} className="relative border border-stone-200 rounded-b-xl min-h-[140px]"
        onDragOver={e => { if (grab.current) { e.preventDefault(); setDropCol(colAt(e.clientX)); } }}
        onDragLeave={() => setDropCol(null)}
        onDrop={e => { e.preventDefault(); drop(e.clientX); }}>
        <div aria-hidden className="absolute inset-0 grid grid-cols-7 pointer-events-none">
          {dates.map((d, i) => <div key={d} className={`${i ? 'border-l border-stone-100' : ''} ${dropCol === i ? 'bg-blue-600/10' : isLocalToday(d) ? 'bg-[#eef8f5]/60' : ''}`} />)}
        </div>
        <div className="relative py-2 space-y-1">
          {!rows.length && <p className="text-xs text-stone-400 text-center py-10">No dated tasks this week.</p>}
          {rows.map((row, r) => <div key={r} className="grid grid-cols-7 gap-x-1 px-1">
            {row.map(({ item, first, last, before, after }) => <button key={item.key} type="button"
              draggable={draggable(item)}
              onDragStart={e => { grab.current = { item, col: colAt(e.clientX) }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.title); }}
              onDragEnd={() => { grab.current = null; setDropCol(null); }}
              onClick={() => setOpen(item)}
              style={{ gridColumn: `${first + 1} / ${last + 2}` }}
              title={`${item.title}${item.plan ? ` · ${item.plan.code}` : ''}${item.planned_hours ? ` · ${item.planned_hours} h` : ''}`}
              className={`flex items-center gap-1 min-w-0 text-left text-[11px] font-medium border px-1.5 py-1 ${tone(item)} ${draggable(item) ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${before ? 'rounded-l-none border-l-0' : 'rounded-l-md'} ${after ? 'rounded-r-none border-r-0' : 'rounded-r-md'}`}>
              {before && <ChevronLeft className="w-3 h-3 shrink-0 opacity-60" />}
              {item.is_milestone && <Diamond className="w-3 h-3 shrink-0" />}
              <span className="truncate">{item.title}</span>
              <span className="ml-auto shrink-0 opacity-70 font-mono text-[10px]">{item.plan?.code ?? item.project?.code ?? item.enquiry?.code ?? item.design_book?.code ?? item.initiative?.code ?? ''}</span>
              {after && <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />}
            </button>)}
          </div>)}
        </div>
      </div>
    </div></div>

    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-stone-500">
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-50 border border-[#bcdcd3]" />Own task</span>
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-50 border border-sky-200" />Plan task</span>
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-100" />Google Calendar</span>
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-50 border border-amber-200" />Regular commitment</span>
      {spread.map(c => <span key={c.id} className="inline-flex items-center gap-1 text-amber-800"><Repeat className="w-3 h-3" />{c.title}: {c.capacity_pct}% of each day</span>)}
      {!google.connected && <span>Google Calendar is not connected, so meetings are not shown.</span>}
      {google.error && <span className="text-rose-700">Google Calendar could not be loaded.</span>}
    </div>

    {undated.length > 0 && <div className="mt-4">
      <div className="text-[11px] font-bold uppercase tracking-[.12em] text-stone-500 mb-1.5">No date yet <span className="font-semibold normal-case tracking-normal text-stone-400">· drag one onto a day</span></div>
      <div className="flex flex-wrap gap-1.5">
        {undated.map(item => <button key={item.key} type="button" draggable={draggable(item)}
          onDragStart={e => { grab.current = { item, col: 0 }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.title); }}
          onDragEnd={() => { grab.current = null; setDropCol(null); }}
          onClick={() => setOpen(item)}
          className={`text-[11px] font-medium border rounded-md px-2 py-1 ${tone(item)} ${draggable(item) ? 'cursor-grab' : ''}`}>{item.title}</button>)}
      </div>
    </div>}

    {open && <TaskPopover item={open} onClose={() => setOpen(null)}>{renderRow(items.find(i => i.key === open.key) ?? open)}</TaskPopover>}
  </div>;
}

export function MonthCalendar({ month, items, onMonth, onPickWeek, renderRow }: {
  month: string; items: WorkItem[]; onMonth: (anyDay: string) => void; onPickWeek: (monday: string) => void; renderRow: (item: WorkItem) => ReactNode;
}) {
  const { days } = monthGrid(month);
  const google = useGoogleEvents(days[0]!, addDays(days[41]!, 1));
  const work = useMyWork(days[0]!, 6);
  const load = new Map((work.data?.weeks ?? []).flatMap(w => w.days ?? []).map(d => [d.date, d]));
  const [open, setOpen] = useState<WorkItem | null>(null);
  const first = `${month.slice(0, 7)}-01`;

  // A task shows on its due date (or its only date); multi-day work is in the Week view.
  const byDay = new Map<string, WorkItem[]>();
  for (const i of items) {
    const r = taskRange(i);
    if (!r) continue;
    byDay.set(r[1], [...(byDay.get(r[1]) ?? []), i]);
  }

  return <div className="p-4">
    <div className="flex items-center gap-2 mb-3">
      <button aria-label="Previous month" onClick={() => onMonth(addDays(first, -1))} className="p-1.5 rounded-lg border border-stone-200 text-stone-500 hover:text-blue-600"><ChevronLeft className="w-4 h-4" /></button>
      <button aria-label="Next month" onClick={() => onMonth(addDays(first, 32))} className="p-1.5 rounded-lg border border-stone-200 text-stone-500 hover:text-blue-600"><ChevronRight className="w-4 h-4" /></button>
      <span className="text-sm font-bold text-stone-800">{dayName(first, { month: 'long', year: 'numeric' })}</span>
      <span className="ml-auto text-[11px] text-stone-500 hidden md:inline">Tasks on their due date. Click a week number to open that week.</span>
    </div>
    <div className="overflow-x-auto"><div className="min-w-[760px] grid grid-cols-[28px_repeat(7,1fr)] gap-px bg-stone-200 border border-stone-200 rounded-xl overflow-hidden">
      <div className="bg-stone-50" />
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="bg-stone-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-stone-500">{d}</div>)}
      {days.map((d, i) => {
        const inMonth = d.startsWith(month.slice(0, 7));
        const tasks = byDay.get(d) ?? [];
        const evs = eventsOn(google.events, d).filter(e => e.busy || e.all_day);
        const day = load.get(d);
        const over = day && day.capacity > 0 && day.booked + meetingHours(google.events, d, work.data?.commitments ?? []) >day.capacity + 0.01;
        return [
          i % 7 === 0 ? <button key={`w${d}`} onClick={() => onPickWeek(mondayOf(d))} title="Open this week" className="bg-stone-50 text-[10px] text-stone-400 hover:text-blue-600 font-mono">
            {Math.ceil(((Date.parse(`${addDays(d, 3)}T00:00:00Z`) - Date.parse(`${addDays(d, 3).slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000 + 1) / 7)}</button> : null,
          <div key={d} className={`min-h-[92px] px-1.5 py-1 ${isLocalToday(d) ? 'bg-[#eef8f5]' : inMonth ? 'bg-white' : 'bg-stone-50/80'}`}>
            <div className="flex items-center gap-1">
              <span className={`text-[11px] font-bold ${isLocalToday(d) ? 'text-white bg-blue-600 rounded-full px-1.5' : inMonth ? 'text-stone-700' : 'text-stone-400'}`}>{Number(d.slice(8))}</span>
              {over && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-rose-500" title="Booked beyond what you can work" />}
            </div>
            <div className="mt-0.5 space-y-0.5">
              {evs.slice(0, 2).map(e => <div key={e.id} className="text-[10px] truncate text-violet-800" title={e.title}>{e.all_day ? '' : `${timeOf(e.start)} `}{e.title}</div>)}
              {evs.length > 2 && <div className="text-[10px] text-violet-500">+{evs.length - 2} meetings</div>}
              {tasks.slice(0, 3).map(t => <button key={t.key} type="button" onClick={() => setOpen(t)} title={t.title}
                className={`block w-full text-left truncate text-[10.5px] border rounded px-1 ${tone(t)}`}>{t.title}</button>)}
              {tasks.length > 3 && <button type="button" onClick={() => onPickWeek(mondayOf(d))} className="text-[10px] text-stone-500 hover:text-blue-600">+{tasks.length - 3} more</button>}
            </div>
          </div>,
        ];
      })}
    </div></div>
    {open && <TaskPopover item={open} onClose={() => setOpen(null)}>{renderRow(items.find(i => i.key === open.key) ?? open)}</TaskPopover>}
  </div>;
}
