import { Contact, useCompany } from '../../pages/clients/clientsApi';

interface Props {
  clientId: string;
  value: string;
  onChange: (person: Contact | null) => void;
  label?: string;
  emptyLabel?: string;
  className?: string;
}

/** Choose one of a company's current people (from the client directory). */
export default function ClientPersonSelect({ clientId, value, onChange, label = 'Person at the client', emptyLabel = 'Someone else (type below)', className = '' }: Props) {
  const company = useCompany(clientId);
  const people = (company.data?.contacts ?? []).filter(p => !p.left_on || p.id === value);
  return <label className={`text-xs font-bold text-[#53686b] ${className}`}>{label}
    <select value={value} onChange={e => onChange(people.find(p => p.id === e.target.value) ?? null)} disabled={company.isLoading}
      className="mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal bg-white">
      <option value="">{company.isLoading ? 'Loading people…' : people.length ? emptyLabel : 'No one recorded for this company yet'}</option>
      {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.job_title ? ` — ${p.job_title}` : ''}{p.is_primary ? ' (main contact)' : ''}</option>)}
    </select>
  </label>;
}
