// Admin: the list of offices and each office's working calendar. Giving a person an office sets
// their calendar to the office's calendar; changing an office's calendar here does not move people
// already in it (their calendars stay as set).
import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

export type Office = { id: string; name: string; calendar_id: string | null; calendar_name: string | null; people: number };
type OfficesResponse = { data: Office[]; calendars: Array<{ id: string; name: string }> };

export const OFFICES_KEY = ['admin-offices'] as const;
export const useOffices = (enabled = true) => useQuery({
  queryKey: OFFICES_KEY, enabled,
  queryFn: () => api.get('/admin/offices').then(r => r.data as OfficesResponse),
});

const errorText = (err: any, fallback: string) => err?.response?.data?.error?.message || fallback;
const input = 'text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function OfficeRow({ office, calendars }: { office: Office; calendars: OfficesResponse['calendars'] }) {
  const qc = useQueryClient();
  const [name, setName] = useState(office.name);
  const [calendarId, setCalendarId] = useState(office.calendar_id ?? '');
  const dirty = name.trim() !== office.name || calendarId !== (office.calendar_id ?? '');
  const save = useMutation({
    mutationFn: () => api.put(`/admin/offices/${office.id}`, { name: name.trim(), calendar_id: calendarId || null }),
    onSuccess: () => { toast.success('Office saved'); qc.invalidateQueries({ queryKey: OFFICES_KEY }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: err => toast.error(errorText(err, 'Could not save the office')),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/offices/${office.id}`),
    onSuccess: () => { toast.success('Office removed'); qc.invalidateQueries({ queryKey: OFFICES_KEY }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: err => toast.error(errorText(err, 'Could not remove the office')),
  });
  const confirmRemove = () => {
    const who = office.people ? ` Its ${office.people} ${office.people === 1 ? 'person' : 'people'} will have no office (their calendars stay as they are).` : '';
    if (window.confirm(`Remove the office "${office.name}"?${who}`)) remove.mutate();
  };
  return <li className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100">
    <input aria-label="Office name" value={name} onChange={e => setName(e.target.value)} className={`${input} flex-1 min-w-[160px]`} />
    <select aria-label={`Calendar for ${office.name}`} value={calendarId} onChange={e => setCalendarId(e.target.value)} className={`${input} w-56`}>
      <option value="">No calendar</option>
      {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
    <span className="w-20 text-xs text-slate-500 text-right tabular-nums">{office.people} {office.people === 1 ? 'person' : 'people'}</span>
    <button type="button" disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}
      className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40">Save</button>
    <button type="button" aria-label={`Remove ${office.name}`} onClick={confirmRemove} className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
  </li>;
}

export default function OfficesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useOffices();
  const [name, setName] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/admin/offices', { name: name.trim(), calendar_id: calendarId || null }),
    onSuccess: () => { toast.success('Office added'); setName(''); setCalendarId(''); qc.invalidateQueries({ queryKey: OFFICES_KEY }); },
    onError: err => toast.error(errorText(err, 'Could not add the office')),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) add.mutate(); };

  return <div role="dialog" aria-modal="true" aria-label="Offices" className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-900/30" onClick={onClose}>
    <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <Building2 className="w-5 h-5 text-blue-600" />
        <h2 className="text-base font-bold text-slate-800">Offices</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-5 py-3">
        <p className="text-xs text-slate-500">Each office has a working calendar. Giving someone an office sets their calendar to it; you can still change a person's calendar in Resources. Changing an office's calendar here does not move the people already in it.</p>
        {isLoading && <p className="py-6 text-sm text-slate-500">Loading…</p>}
        {isError && <p role="alert" className="py-6 text-sm text-rose-700">Offices could not be loaded.</p>}
        {data && <ul className="mt-2">
          {data.data.map(o => <OfficeRow key={`${o.id}:${o.name}:${o.calendar_id}`} office={o} calendars={data.calendars} />)}
          {!data.data.length && <li className="py-4 text-sm text-slate-400">No offices yet.</li>}
        </ul>}
        {data && <form onSubmit={submit} className="flex flex-wrap items-center gap-2 py-3">
          <input aria-label="New office name" value={name} onChange={e => setName(e.target.value)} placeholder="New office, e.g. Shanghai" className={`${input} flex-1 min-w-[160px]`} />
          <select aria-label="Calendar for the new office" value={calendarId} onChange={e => setCalendarId(e.target.value)} className={`${input} w-56`}>
            <option value="">No calendar</option>
            {data.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button disabled={!name.trim() || add.isPending} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-40"><Plus className="w-4 h-4" />Add</button>
        </form>}
      </div>
    </div>
  </div>;
}
