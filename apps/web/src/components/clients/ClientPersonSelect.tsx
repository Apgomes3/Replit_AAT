import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiError, Contact, useCanManageClients, useCompany, useContactActions } from '../../pages/clients/clientsApi';

interface Props {
  clientId: string;
  value: string;
  onChange: (person: Contact | null) => void;
  label?: string;
  emptyLabel?: string;
  className?: string;
  /** Offer "+ Add a person…", which adds them to the company's contacts and picks them. */
  allowAdd?: boolean;
}

const ADD = '__add__';
const BLANK = { name: '', job_title: '', email: '', phone: '' };

/** Choose one of a company's current people (from the client directory). */
export default function ClientPersonSelect({ clientId, value, onChange, label = 'Person at the client', emptyLabel = 'Not chosen', className = '', allowAdd = false }: Props) {
  const company = useCompany(clientId);
  const canAdd = useCanManageClients() && allowAdd;
  const { save } = useContactActions(clientId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const people = (company.data?.contacts ?? []).filter(p => !p.left_on || p.id === value);

  const add = async () => {
    if (!draft.name.trim()) return toast.error('Give the person a name');
    try {
      const made = await save.mutateAsync({ input: {
        name: draft.name.trim(), job_title: draft.job_title.trim() || null, email: draft.email.trim() || null, phone: draft.phone.trim() || null,
      } });
      toast.success(`${made.name} added to ${company.data?.name ?? 'the company'}`);
      setAdding(false); setDraft(BLANK);
      onChange(made);
    } catch (err) { toast.error(apiError(err, 'Could not add the person')); }
  };
  // Enter in these fields must add the person, not submit the form around them.
  const enterAdds = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  const input = 'mt-1 w-full border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm font-normal bg-white';

  return <div className={`text-xs font-bold text-stone-600 ${className}`}>
    <label>{label}
      <select value={adding ? ADD : value} disabled={company.isLoading}
        onChange={e => {
          if (e.target.value === ADD) { setAdding(true); onChange(null); return; }
          setAdding(false); onChange(people.find(p => p.id === e.target.value) ?? null);
        }}
        className="mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal bg-white">
        <option value="">{company.isLoading ? 'Loading people…' : people.length ? emptyLabel : 'No one recorded for this company yet'}</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.job_title ? ` — ${p.job_title}` : ''}{p.is_primary ? ' (main contact)' : ''}</option>)}
        {canAdd && <option value={ADD}>+ Add a person…</option>}
      </select>
    </label>
    {adding && <div className="mt-2 p-3 rounded-lg border border-[#cfe3dc] bg-[#f5faf8] grid grid-cols-2 gap-2">
      <label className="col-span-2 font-semibold">Name<input autoFocus value={draft.name} onKeyDown={enterAdds} onChange={e => setDraft({ ...draft, name: e.target.value })} className={input} /></label>
      <label className="col-span-2 font-semibold">Job title<input value={draft.job_title} onKeyDown={enterAdds} onChange={e => setDraft({ ...draft, job_title: e.target.value })} className={input} /></label>
      <label className="font-semibold">Email<input type="email" value={draft.email} onKeyDown={enterAdds} onChange={e => setDraft({ ...draft, email: e.target.value })} className={input} /></label>
      <label className="font-semibold">Phone<input value={draft.phone} onKeyDown={enterAdds} onChange={e => setDraft({ ...draft, phone: e.target.value })} className={input} /></label>
      <div className="col-span-2 flex justify-end gap-2 pt-1">
        <button type="button" onClick={() => { setAdding(false); setDraft(BLANK); }} className="px-3 py-1.5 text-xs">Cancel</button>
        <button type="button" onClick={add} disabled={save.isPending} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-bold">{save.isPending ? 'Adding…' : 'Add to contacts'}</button>
      </div>
    </div>}
  </div>;
}
