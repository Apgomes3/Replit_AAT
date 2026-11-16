// Google Calendar (read-only) beside My work: connect/disconnect and the week's events.
// Mirrors apps/api/src/modules/google-calendar/routes.ts.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { apiErrorMessage } from '../drafting/draftingApi';
import { addDays } from '../drafting/taskTiming';

type Status = { configured: boolean; allowed: boolean; connected: boolean; google_email: string | null };
export type GoogleEvent = { id: string; title: string; start: string; end: string; all_day: boolean; location: string | null; link: string | null; busy: boolean };

const CALLBACK_MESSAGES: Record<string, [ok: boolean, text: string]> = {
  connected: [true, 'Google Calendar connected.'],
  denied: [false, 'Google Calendar was not connected (access was declined).'],
  expired: [false, 'That Google sign-in took too long. Please try again.'],
  not_configured: [false, 'Google Calendar is not set up on this server yet.'],
  error: [false, 'Google Calendar could not be connected. Please try again.'],
};

/** Local calendar day (YYYY-MM-DD) an event starts on. */
export const eventDay = (e: GoogleEvent) => e.all_day ? e.start : new Date(e.start).toLocaleDateString('en-CA');
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export default function GoogleCalendarCard({ from }: { from: string }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['google-calendar', 'status'], queryFn: () => api.get('/google-calendar/status').then(r => r.data as Status) });
  const to = addDays(from, 7);
  const events = useQuery({
    queryKey: ['google-calendar', 'events', from],
    enabled: !!status.data?.connected,
    // Widen by a day each side so local-time events near midnight are not lost; filter below.
    queryFn: () => api.get('/google-calendar/events', { params: { from: addDays(from, -1), to: addDays(to, 1) } }).then(r => r.data.events as GoogleEvent[]),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google_calendar');
    if (!result) return;
    const [ok, text] = CALLBACK_MESSAGES[result] ?? CALLBACK_MESSAGES.error;
    (ok ? toast.success : toast.error)(text);
    params.delete('google_calendar');
    const q = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    qc.invalidateQueries({ queryKey: ['google-calendar'] });
  }, [qc]);

  const connect = useMutation({
    mutationFn: () => api.post('/google-calendar/connect').then(r => r.data.url as string),
    onSuccess: url => { window.location.assign(url); },
    onError: e => toast.error(apiErrorMessage(e, 'Google Calendar is not available just now.')),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete('/google-calendar/connection'),
    onSuccess: () => { toast.success('Google Calendar disconnected.'); qc.invalidateQueries({ queryKey: ['google-calendar'] }); },
    onError: e => toast.error(apiErrorMessage(e, 'Google Calendar is not available just now.')),
  });

  const s = status.data;
  if (!s || (s.configured && !s.allowed && !s.connected)) return null;
  if (!s.configured) return <aside className="bg-white rounded-2xl border border-stone-200/70 shadow-sm p-4">
    <h3 className="text-sm font-bold text-stone-800 flex items-center gap-1.5 mb-1"><CalendarDays className="w-4 h-4 text-[#087f73]" />Google Calendar</h3>
    <p className="text-xs text-stone-500">Not set up on this server yet. An admin needs to add the Google OAuth settings to <code>.env</code> (see docs/google-calendar-setup.md) and restart.</p>
  </aside>;

  const days = new Map<string, GoogleEvent[]>();
  for (const e of events.data ?? []) {
    const d = eventDay(e);
    if (d < from || d >= to) continue;
    days.set(d, [...(days.get(d) ?? []), e]);
  }

  return <aside aria-labelledby="gcal-title" className="bg-white rounded-2xl border border-stone-200/70 shadow-sm p-4">
    <div className="flex items-center justify-between gap-2 mb-2">
      <h3 id="gcal-title" className="text-sm font-bold text-stone-800 flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-[#087f73]" />Google Calendar</h3>
      {s.connected && <button type="button" className="text-[11px] text-stone-500 hover:text-rose-700 underline"
        disabled={disconnect.isPending} onClick={() => confirm('Disconnect Google Calendar? Shark OS will forget its access.') && disconnect.mutate()}>Disconnect</button>}
    </div>
    {!s.connected ? <>
      <p className="text-xs text-stone-500 mb-3">See your Google Calendar events for the week here. Shark OS only reads your calendar; it never changes it.</p>
      <button type="button" disabled={connect.isPending} onClick={() => connect.mutate()}
        className="w-full rounded-lg bg-[#087f73] text-white text-sm font-semibold py-2 hover:bg-[#066b61] disabled:opacity-60">Connect Google Calendar</button>
    </> : <>
      <p className="text-[11px] text-stone-500 mb-2">{s.google_email} · week of {dayLabel(from)}</p>
      {events.isLoading ? <div className="h-16 skeleton rounded-lg" />
        : events.isError ? <p className="text-xs text-rose-700">{apiErrorMessage(events.error, 'Your calendar could not be loaded.')} <button className="underline font-semibold" onClick={() => events.refetch()}>Try again</button></p>
        : !days.size ? <p className="text-xs text-stone-500">No events this week.</p>
        : <ul className="space-y-2">{[...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => <li key={d}>
            <div className="text-[10px] font-bold uppercase tracking-[.1em] text-stone-500">{dayLabel(d)}</div>
            <ul>{list.map(e => <li key={e.id} className={`text-xs flex gap-2 py-0.5 ${e.busy ? 'text-stone-800' : 'text-stone-400'}`}>
              <span className="w-20 shrink-0 tabular-nums text-stone-500">{e.all_day ? 'All day' : `${timeOf(e.start)}–${timeOf(e.end)}`}</span>
              <span className="min-w-0 truncate" title={e.location ?? undefined}>{e.title}</span>
              {e.link && <a href={e.link} target="_blank" rel="noreferrer" aria-label={`Open ${e.title} in Google Calendar`} className="ml-auto text-stone-400 hover:text-[#087f73]"><ExternalLink className="w-3 h-3" /></a>}
            </li>)}</ul>
          </li>)}</ul>}
    </>}
  </aside>;
}
