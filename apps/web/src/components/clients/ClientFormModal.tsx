import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import CountryCombobox from '../ui/CountryCombobox';
import { useModalFocus } from '../../hooks/useModalFocus';
import {
  apiError, CLIENT_KINDS, ClientKind, Company, CompanyInput, KIND_LABELS, placeOf, useSaveCompany, useSimilarCompanies,
} from '../../pages/clients/clientsApi';
import ClientPicker from './ClientPicker';

interface Props {
  /** The company to edit; omitted to add a new one. */
  company?: Company;
  initialName?: string;
  initialKinds?: ClientKind[];
  onClose: () => void;
  onSaved?: (company: Company) => void;
  /** When given, the duplicate warning offers "Use this one" instead of only opening it. */
  onPickExisting?: (company: Company) => void;
}

const input = 'mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal';
const label = 'text-xs font-bold text-stone-600';

/** Add or edit a company in the directory, warning when the name looks like one already there. */
export default function ClientFormModal({ company, initialName = '', initialKinds, onClose, onSaved, onPickExisting }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  const save = useSaveCompany();
  const [form, setForm] = useState({
    name: company?.name ?? initialName,
    legal_name: company?.legal_name ?? '',
    website: company?.website ?? '',
    country: company?.country ?? '',
    city: company?.city ?? '',
    address: company?.address ?? '',
    notes: company?.notes ?? '',
    kinds: company?.kinds ?? initialKinds ?? ['client'] as ClientKind[],
    parent_client_id: company?.parent_client_id ?? null as string | null,
    parent_name: company?.parent_name ?? null as string | null,
    active: company?.active ?? true,
  });
  const [duplicates, setDuplicates] = useState<Company[] | null>(null);
  const nameChanged = form.name.trim() !== (company?.name ?? '');
  const similar = useSimilarCompanies(nameChanged ? form.name : '', company?.id);
  const lookAlikes = (nameChanged ? similar.data ?? [] : []);

  const toggleKind = (k: ClientKind) => setForm(f => ({
    ...f, kinds: f.kinds.includes(k) ? f.kinds.filter(x => x !== k) : CLIENT_KINDS.filter(x => x === k || f.kinds.includes(x)),
  }));

  const submit = async (allowDuplicate = false) => {
    if (!form.name.trim()) return toast.error('Company name is required');
    if (!form.kinds.length) return toast.error('Choose at least one kind');
    const body: CompanyInput = {
      name: form.name.trim(), legal_name: form.legal_name, website: form.website, country: form.country, city: form.city,
      address: form.address, notes: form.notes, kinds: form.kinds, parent_client_id: form.parent_client_id, active: form.active,
      ...(allowDuplicate ? { allow_duplicate: true } : {}),
    };
    try {
      const saved = await save.mutateAsync({ id: company?.id, input: body });
      toast.success(company ? 'Company updated' : `${saved.name} added`);
      onSaved?.(saved);
      onClose();
    } catch (err: any) {
      const e = err?.response?.data?.error;
      if (e?.code === 'POSSIBLE_DUPLICATE') { setDuplicates(e.matches ?? []); return; }
      toast.error(apiError(err, 'Could not save the company'));
    }
  };

  return <div className="fixed inset-0 z-50 bg-stone-800/40 p-4 flex items-center justify-center">
    <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="company-form-title" tabIndex={-1}
      className="bg-white w-full max-w-2xl max-h-[92vh] overflow-auto rounded-2xl shadow-2xl">
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="p-5 border-b border-stone-100 flex justify-between gap-4">
          <div>
            <h2 id="company-form-title" className="font-extrabold">{company ? `Edit ${company.name}` : 'Add a company'}</h2>
            <p className="text-xs text-stone-500 mt-1">One directory for every client, consultant, contractor, partner and supplier.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-stone-400" /></button>
        </div>

        {duplicates && <div className="m-5 mb-0 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" role="alert">
          <div className="flex items-center gap-2 font-bold text-amber-800"><AlertTriangle className="w-4 h-4" /> This company may already be in the directory</div>
          <ul className="mt-2 space-y-1.5">
            {duplicates.map(d => <li key={d.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{d.name}</span>
              <span className="text-xs text-stone-500">{d.client_code}{placeOf(d) ? ` · ${placeOf(d)}` : ''}</span>
              {onPickExisting
                ? <button type="button" onClick={() => { onPickExisting(d); onClose(); }} className="text-xs font-bold text-blue-600 underline">Use this one</button>
                : <Link to={`/clients/${d.id}`} onClick={onClose} className="text-xs font-bold text-blue-600 underline">Open it</Link>}
            </li>)}
          </ul>
          <button type="button" onClick={() => submit(true)} disabled={save.isPending} className="mt-3 text-xs font-bold text-amber-900 underline">
            No, it is a different company: {company ? 'save' : 'add'} {form.name.trim()} anyway
          </button>
        </div>}

        <div className="p-5 grid sm:grid-cols-2 gap-4">
          <label className={`sm:col-span-2 ${label}`}>Company name
            <input autoFocus value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); setDuplicates(null); }} className={input} required />
            {!duplicates && lookAlikes.length > 0 && <span className="block mt-1 font-normal text-amber-700">
              Already in the directory: {lookAlikes.map((m, i) => <span key={m.id}>{i > 0 && ', '}<Link to={`/clients/${m.id}`} onClick={onClose} className="underline">{m.name}</Link></span>)}
            </span>}
          </label>
          <fieldset className="sm:col-span-2">
            <legend className={label}>Kind</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {CLIENT_KINDS.map(k => <button key={k} type="button" aria-pressed={form.kinds.includes(k)} onClick={() => toggleKind(k)}
                className={`px-3 py-1 rounded-full text-xs font-bold border ${form.kinds.includes(k) ? 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600' : 'bg-white text-stone-600 border-stone-200'}`}>
                {KIND_LABELS[k]}
              </button>)}
            </div>
          </fieldset>
          <label className={label}>Legal name<input value={form.legal_name} onChange={e => setForm({ ...form, legal_name: e.target.value })} className={input} /></label>
          <label className={label}>Website<input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://" className={input} /></label>
          <label className={label}>Country<CountryCombobox value={form.country} onChange={country => setForm({ ...form, country })} placeholder="Select country" className="mt-1.5" /></label>
          <label className={label}>City<input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className={input} /></label>
          <label className={`sm:col-span-2 ${label}`}>Address<input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className={input} /></label>
          <div className={label}>Part of (parent company)
            <ClientPicker className="mt-1.5" value={form.parent_client_id} valueLabel={form.parent_name} excludeId={company?.id}
              placeholder="None — search to choose" allowCreate={false}
              onChange={p => setForm({ ...form, parent_client_id: p?.id ?? null, parent_name: p?.name ?? null })} />
          </div>
          <label className={label}>Status
            <select value={form.active ? 'active' : 'inactive'} onChange={e => setForm({ ...form, active: e.target.value === 'active' })} className={input}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </label>
          <label className={`sm:col-span-2 ${label}`}>Notes<textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={input} /></label>
        </div>
        <div className="p-5 bg-stone-50 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
          <button disabled={save.isPending} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold disabled:opacity-60">
            {save.isPending ? 'Saving…' : company ? 'Save changes' : 'Add company'}
          </button>
        </div>
      </form>
    </div>
  </div>;
}
