import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Building2, Pencil, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import CountryCombobox from '../../components/ui/CountryCombobox';
import { useModalFocus } from '../../hooks/useModalFocus';

type Contact = {
  name: string;
  email: string;
  phone: string;
  job_title: string;
  is_primary?: boolean;
};

const newContact = (): Contact => ({ name: '', email: '', phone: '', job_title: '' });
const empty = {
  name: '',
  legal_name: '',
  website: '',
  address: '',
  country: '',
  notes: '',
  active: true,
  contacts: [],
};

function contactsFrom(client: any): Contact[] {
  const contacts = Array.isArray(client?.contacts) ? client.contacts : [];
  if (contacts.length) return contacts.map((c: any) => ({
    name: c.name || '',
    email: c.email || '',
    phone: c.phone || '',
    job_title: c.job_title || c.role || '',
    ...(c.is_primary ? { is_primary: true } : {}),
  }));
  if (client?.contact_name || client?.contact_email) {
    return [{ name: client.contact_name || '', email: client.contact_email || '', phone: client.contact_phone || '', job_title: '', is_primary: true }];
  }
  return [];
}

function ClientModal({ onClose, children }: { onClose: () => void; children: (closeButtonRef: React.RefObject<HTMLButtonElement | null>) => React.ReactNode }) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef: closeButtonRef });
  return <div className="fixed inset-0 z-50 bg-[#20333a]/40 p-4 flex items-center justify-center"><div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="client-modal-title" tabIndex={-1} className="bg-white w-full max-w-3xl max-h-[92vh] overflow-auto rounded-2xl shadow-2xl">{children(closeButtonRef)}</div></div>;
}

export default function ClientsList() {
  const user = useAuthStore(s => s.user);
  const canManage = user?.role === 'admin' || user?.moduleAccess?.business_development === 'manage';
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const closeForm = () => setForm(null);
  const query = useQuery({
    queryKey: ['clients', search],
    queryFn: () => api.get('/clients', { params: { search, page: 1, page_size: 100 } }).then(r => r.data),
  });
  const clients: any[] = query.data?.items || query.data?.data || query.data || [];

  const openEdit = async (client: any) => {
    if (Array.isArray(client.contacts)) {
      setForm({ ...empty, ...client, contacts: contactsFrom(client) });
      return;
    }
    setLoadingEdit(true);
    setEditError('');
    try {
      const detail = await api.get(`/clients/${client.id}`).then(r => r.data);
      setForm({ ...empty, ...detail, contacts: contactsFrom(detail) });
    } catch (err: any) {
      setEditError(err?.response?.data?.error?.message || 'Could not load client details');
    } finally {
      setLoadingEdit(false);
    }
  };

  const setContact = (index: number, patch: Partial<Contact>) => {
    setForm((current: any) => {
      const contacts = [...current.contacts];
      contacts[index] = { ...contacts[index], ...patch };
      if (patch.is_primary) contacts.forEach((contact, i) => { if (i !== index) delete contact.is_primary; });
      return { ...current, contacts };
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    if (!form.name.trim()) return toast.error('Company name is required');
    const contacts = form.contacts.filter((c: Contact) => c.name.trim() || c.email.trim());
    if (contacts.some((c: Contact) => !c.name.trim() || !c.email.trim())) return toast.error('Each contact needs a name and email');
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        legal_name: form.legal_name || null,
        website: form.website || null,
        country: form.country || null,
        address: form.address || null,
        notes: form.notes || null,
        active: form.active !== false,
        contacts: contacts.map((c: Contact) => ({
          name: c.name.trim(),
          email: c.email.trim(),
          phone: c.phone.trim() || null,
          job_title: c.job_title.trim() || null,
          ...(c.is_primary ? { is_primary: true } : {}),
        })),
      };
      if (form.id) await api.patch(`/clients/${form.id}`, body);
      else await api.post('/clients', body);
      toast.success(form.id ? 'Client updated' : 'Client created');
      closeForm();
      qc.invalidateQueries({ queryKey: ['clients'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not save client');
    } finally {
      setSaving(false);
    }
  };

  return <div className="p-6 max-w-7xl mx-auto">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Commercial register</div><h1 className="text-2xl font-extrabold mt-2">Clients</h1><p className="text-sm text-[#6f8082] mt-1">The organisations behind every enquiry and quote.</p></div>
      {canManage && <button onClick={() => { setEditError(''); setForm({ ...empty, contacts: [] }); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#087f73] text-white text-sm font-bold"><Plus className="w-4 h-4" /> Add client</button>}
    </header>
    <div className="relative max-w-md mb-4"><Search className="absolute left-3 top-2.5 w-4 h-4 text-[#8da09d]" /><label htmlFor="client-search" className="sr-only">Search companies and contacts</label><input id="client-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company, code, contact…" className="w-full pl-9 pr-3 py-2 border border-[#dce7e2] rounded-lg bg-white text-sm" /></div>
    <div className="bg-white rounded-xl border border-[#dce7e2] overflow-hidden shadow-sm">
      {query.isError ? <div className="p-8 text-sm text-rose-700">Clients could not be loaded. <button className="underline font-bold" onClick={() => query.refetch()}>Try again</button></div> : query.isLoading ? <div className="p-5 space-y-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-12 skeleton" />)}</div> : clients.length === 0 ? <div className="p-16 text-center"><Building2 className="mx-auto w-9 h-9 text-[#b8d9d0] mb-3" /><p className="font-bold">No clients found</p></div> : <table className="w-full text-sm"><thead className="bg-[#f2f7f4] border-b border-[#dce7e2]"><tr>{['Company', 'Primary contact', 'Location', 'Status', ''].map(h => <th key={h} className="text-left px-5 py-3 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">{h}</th>)}</tr></thead><tbody>{clients.map(c => {
        const primary = c.primary_contact || (Array.isArray(c.contacts) ? c.contacts.find((contact: any) => contact.is_primary) || c.contacts[0] : null);
        const count = c.contact_count ?? c.contacts?.length;
        return <tr key={c.id} className="border-b border-[#edf2ef] last:border-0 hover:bg-[#f4faf7]"><td className="px-5 py-4"><div className="font-bold">{c.name}</div><div className="text-xs text-[#6f8082] font-mono mt-1">{c.client_code || '—'} {c.legal_name && `· ${c.legal_name}`}</div></td><td className="px-5 py-4 text-[#53686b]">{primary?.name || c.contact_name || '—'}<div className="text-xs text-[#8a9b9a]">{primary?.email || c.contact_email || '—'}{count != null && <span> · {count} contact{count === 1 ? '' : 's'}</span>}</div></td><td className="px-5 py-4 text-[#53686b]">{[c.country, c.address].filter(Boolean).join(' · ') || '—'}</td><td className="px-5 py-4"><span className={`px-2 py-1 rounded-md text-[10px] uppercase font-extrabold ${c.active === false ? 'bg-stone-100 text-stone-500' : 'bg-[#e4f2ee] text-[#087f73]'}`}>{c.active === false ? 'Inactive' : 'Active'}</span></td><td className="px-5 py-4 text-right">{canManage && <button onClick={() => openEdit(c)} disabled={loadingEdit} className="p-2 text-[#80908f] hover:text-[#087f73] disabled:opacity-50" aria-label={`Edit ${c.name}`}><Pencil className="w-4 h-4" /></button>}</td></tr>;
      })}</tbody></table>}
    </div>
    {loadingEdit && <div className="mt-3 text-sm text-[#6f8082]" role="status">Loading client details…</div>}
    {editError && <div className="mt-3 text-sm text-rose-700" role="alert">{editError} <button className="underline font-bold" onClick={() => setEditError('')}>Dismiss</button></div>}
    {form && canManage && <ClientModal onClose={closeForm}>{closeButtonRef => <form onSubmit={save}><div className="p-5 border-b border-[#edf2ef] flex justify-between"><div><h2 id="client-modal-title" className="font-extrabold">{form.id ? 'Edit client' : 'Add client'}</h2><p className="text-xs text-[#6f8082] mt-1">Company details and the employees you are reaching out to.</p></div><button ref={closeButtonRef} type="button" onClick={closeForm} aria-label="Close"><X className="w-5 h-5 text-[#80908f]" /></button></div><div className="p-5 grid sm:grid-cols-2 gap-4">
      {([['name', 'Company name'], ['legal_name', 'Legal name'], ['website', 'Website'], ['address', 'Address']] as const).map(([key, label]) => <label key={key} className="text-xs font-bold text-[#53686b]">{label}<input value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal" /></label>)}
      <label className="text-xs font-bold text-[#53686b]">Country<CountryCombobox value={form.country || ''} onChange={country => setForm({ ...form, country })} placeholder="Select country" className="mt-1.5" /></label>
      <label className="text-xs font-bold text-[#53686b]">Status<select value={form.active === false ? 'inactive' : 'active'} onChange={e => setForm({ ...form, active: e.target.value === 'active' })} className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label className="sm:col-span-2 text-xs font-bold text-[#53686b]">Notes<textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal" /></label>
      <div className="sm:col-span-2 border-t border-[#edf2ef] pt-5"><div className="flex items-center justify-between mb-3"><div><h3 className="font-extrabold">Contacts</h3><p className="text-xs text-[#6f8082] mt-1">Employees at this company. Name and email are required.</p></div><button type="button" onClick={() => setForm({ ...form, contacts: [...form.contacts, newContact()] })} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#087f73]"><UserPlus className="w-4 h-4" /> Add contact</button></div>{form.contacts.length === 0 ? <div className="rounded-lg border border-dashed border-[#c9d9d2] px-4 py-6 text-center text-sm text-[#6f8082]">No employee contacts added yet. Add one when you are ready.</div> : <div className="space-y-3">{form.contacts.map((contact: Contact, index: number) => <div key={index} className="rounded-lg border border-[#dce7e2] p-3 grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end"><label className="text-xs font-bold text-[#53686b]">Employee name<input required value={contact.name} onChange={e => setContact(index, { name: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-bold text-[#53686b]">Email<input required type="email" value={contact.email} onChange={e => setContact(index, { email: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-bold text-[#53686b]">Phone / job title<input value={contact.phone} onChange={e => setContact(index, { phone: e.target.value })} placeholder="Phone" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /><input value={contact.job_title} onChange={e => setContact(index, { job_title: e.target.value })} placeholder="Job title" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label><div className="flex items-center gap-2 pb-2"><label className="text-xs font-bold whitespace-nowrap"><input type="radio" name="primary-contact" checked={!!contact.is_primary} onChange={() => setContact(index, { is_primary: true })} className="mr-1" /> Primary</label><button type="button" onClick={() => setForm({ ...form, contacts: form.contacts.filter((_: Contact, i: number) => i !== index) })} aria-label={`Remove contact ${index + 1}`} className="p-1.5 text-[#80908f] hover:text-rose-700"><Trash2 className="w-4 h-4" /></button></div></div>)}</div>}</div>
    </div><div className="p-5 bg-[#f5f8f6] flex justify-end gap-2"><button type="button" onClick={closeForm} className="px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold">{saving ? 'Saving…' : 'Save client'}</button></div></form>}</ClientModal>}
  </div>;
}