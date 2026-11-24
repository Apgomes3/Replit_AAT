// Admin → Offices: each office's name, address, time zone and working calendar, and who is in it.
// Giving someone an office (on the Users page or by file) sets their calendar to the office's
// calendar; changing an office's calendar here does not move the people already in it.
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarDays, Clock, MapPin, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { Office, OfficeInput, OFFICES_KEY, OfficesResponse, useOffices } from '../../lib/officesApi';
import { localTimeIn, timeZoneNames, utcOffsetLabel } from '../../lib/timeZones';

const errorText = (err: any, fallback: string) => err?.response?.data?.error?.message || fallback;
const field = 'w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const label = 'block text-xs font-semibold text-slate-600 mb-1';

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), everyMs); return () => window.clearInterval(t); }, [everyMs]);
  return now;
}

function OfficeForm({ office, calendars, onClose }: { office: Office | null; calendars: OfficesResponse['calendars']; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<OfficeInput>({
    name: office?.name ?? '', address: office?.address ?? '', time_zone: office?.time_zone ?? '', calendar_id: office?.calendar_id ?? '',
  });
  const zones = useMemo(timeZoneNames, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const set = (k: keyof OfficeInput) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), address: form.address?.trim() || null, time_zone: form.time_zone?.trim() || null, calendar_id: form.calendar_id || null };
      return office ? api.put(`/admin/offices/${office.id}`, body) : api.post('/admin/offices', body);
    },
    onSuccess: () => {
      toast.success(office ? 'Office saved' : 'Office added');
      qc.invalidateQueries({ queryKey: OFFICES_KEY });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['auth-me', 'office'] });
      onClose();
    },
    onError: err => toast.error(errorText(err, 'Could not save the office')),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (form.name.trim()) save.mutate(); };
  const preview = form.time_zone ? localTimeIn(form.time_zone) : null;

  return <div role="dialog" aria-modal="true" aria-label={office ? `Edit ${office.name}` : 'New office'}
    className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-900/30" onClick={onClose}>
    <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <Building2 className="w-5 h-5 text-blue-600" />
        <h2 className="text-base font-bold text-slate-800">{office ? `Edit ${office.name}` : 'New office'}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div>
          <label className={label} htmlFor="office-name">Name</label>
          <input id="office-name" autoFocus value={form.name} onChange={set('name')} maxLength={100} placeholder="e.g. China office" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="office-address">Address</label>
          <textarea id="office-address" rows={3} value={form.address ?? ''} onChange={set('address')} maxLength={1000} placeholder="Street, city, postcode, country" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="office-tz">Time zone</label>
          <input id="office-tz" list="office-tz-list" value={form.time_zone ?? ''} onChange={set('time_zone')} placeholder="e.g. Asia/Shanghai" className={field} />
          <datalist id="office-tz-list">{zones.map(z => <option key={z} value={z} />)}</datalist>
          <p className="mt-1 text-xs text-slate-500">
            {!form.time_zone ? 'Type a city or region to pick from the list.'
              : preview ? `Local time there now: ${preview} (${utcOffsetLabel(form.time_zone!)})` : 'Not a time zone this browser knows.'}
          </p>
        </div>
        <div>
          <label className={label} htmlFor="office-calendar">Working calendar</label>
          <select id="office-calendar" value={form.calendar_id ?? ''} onChange={set('calendar_id')} className={field}>
            <option value="">No calendar</option>
            {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">People given this office get this calendar. Changing it here does not move people already in the office.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
        <button disabled={!form.name.trim() || save.isPending} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-40">
          {save.isPending ? 'Saving…' : office ? 'Save' : 'Add office'}
        </button>
      </div>
    </form>
  </div>;
}

function OfficeCard({ office, now, onEdit }: { office: Office; now: Date; onEdit: () => void }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/offices/${office.id}`),
    onSuccess: () => { toast.success('Office removed'); qc.invalidateQueries({ queryKey: OFFICES_KEY }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: err => toast.error(errorText(err, 'Could not remove the office')),
  });
  const confirmRemove = () => {
    const who = office.people ? ` Its ${office.people} ${office.people === 1 ? 'person' : 'people'} will have no office (their calendars stay as they are).` : '';
    if (window.confirm(`Remove the office "${office.name}"?${who}`)) remove.mutate();
  };
  const time = office.time_zone ? localTimeIn(office.time_zone, now) : null;
  return <li className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start gap-2">
      <Building2 className="w-5 h-5 mt-0.5 text-blue-600 shrink-0" />
      <h2 className="flex-1 text-base font-bold text-slate-800">{office.name}</h2>
      <button type="button" aria-label={`Edit ${office.name}`} onClick={onEdit} className="p-1.5 text-slate-400 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
      <button type="button" aria-label={`Remove ${office.name}`} onClick={confirmRemove} className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
    </div>
    <dl className="mt-3 space-y-2 text-sm">
      <div className="flex gap-2"><dt className="sr-only">Address</dt><MapPin className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
        <dd className={office.address ? 'whitespace-pre-line text-slate-700' : 'text-slate-400'}>{office.address || 'No address yet'}</dd></div>
      <div className="flex gap-2"><dt className="sr-only">Time zone</dt><Clock className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
        <dd className={office.time_zone ? 'text-slate-700' : 'text-slate-400'}>
          {office.time_zone ? <>{office.time_zone} <span className="text-slate-500 tabular-nums">· {time ?? '?'} now · {utcOffsetLabel(office.time_zone, now)}</span></> : 'No time zone yet'}
        </dd></div>
      <div className="flex gap-2"><dt className="sr-only">Working calendar</dt><CalendarDays className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
        <dd className={office.calendar_name ? 'text-slate-700' : 'text-slate-400'}>{office.calendar_name || 'No calendar'}</dd></div>
    </dl>
    <Link to={`/admin/users?office=${office.id}`} className="mt-auto pt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline">
      <Users className="w-4 h-4" />{office.people} {office.people === 1 ? 'person' : 'people'}
    </Link>
  </li>;
}

export default function AdminOffices() {
  const { data, isLoading, isError } = useOffices();
  const [editing, setEditing] = useState<Office | 'new' | null>(null);
  const now = useNow();
  return <div className="h-full flex flex-col">
    <PageHeader
      title="Offices"
      subtitle="Where people work: address, time zone and working calendar"
      actions={<button type="button" onClick={() => setEditing('new')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold"><Plus className="w-4 h-4" />New office</button>}
    />
    <div className="flex-1 overflow-auto px-4 py-4">
      <p className="mb-4 max-w-3xl text-xs text-slate-500">
        Give people an office on the <Link to="/admin/users" className="text-blue-700 hover:underline">Users</Link> page (or with Export and Update reporting there).
        Their working calendar is set from the office; you can still change a person's calendar in Resources.
      </p>
      {isLoading && <p className="py-6 text-sm text-slate-500">Loading…</p>}
      {isError && <p role="alert" className="py-6 text-sm text-rose-700">Offices could not be loaded.</p>}
      {data && (data.data.length
        ? <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.data.map(o => <OfficeCard key={o.id} office={o} now={now} onEdit={() => setEditing(o)} />)}
        </ul>
        : <p className="py-6 text-sm text-slate-400">No offices yet.</p>)}
    </div>
    {editing && data && <OfficeForm office={editing === 'new' ? null : editing} calendars={data.calendars} onClose={() => setEditing(null)} />}
  </div>;
}
