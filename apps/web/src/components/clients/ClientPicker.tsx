import { useEffect, useId, useRef, useState } from 'react';
import { Building2, Plus, Search, X } from 'lucide-react';
import { ClientKind, Company, placeOf, useCanManageClients, useCompanies, useCompany } from '../../pages/clients/clientsApi';
import ClientFormModal from './ClientFormModal';

interface Props {
  value: string | null;
  /** Name to show for `value` without loading it. */
  valueLabel?: string | null;
  onChange: (company: Company | null) => void;
  kind?: ClientKind;
  excludeId?: string;
  placeholder?: string;
  /** Offer "Add <name> as a new company" (only to people who can manage the directory). */
  allowCreate?: boolean;
  className?: string;
  id?: string;
}

/** Search the client directory and choose a company, or add a new one on the spot. */
export default function ClientPicker({ value, valueLabel, onChange, kind, excludeId, placeholder = 'Search companies…', allowCreate = true, className = '', id }: Props) {
  const canManage = useCanManageClients();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = useCompany(value && !valueLabel ? value : undefined);
  const label = valueLabel ?? selected.data?.name ?? null;
  const results = useCompanies({ search: text.trim(), kind, status: 'active', pageSize: 20 }, open);
  const options = (results.data?.data ?? []).filter(c => c.id !== excludeId);
  const canCreate = allowCreate && canManage && text.trim().length > 1;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (c: Company) => { onChange(c); setText(''); setOpen(false); };

  if (value && label) {
    return <div className={`flex items-center justify-between gap-2 border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white ${className}`}>
      <span className="inline-flex items-center gap-1.5 font-semibold text-stone-800 min-w-0"><Building2 className="w-4 h-4 text-blue-600 shrink-0" /><span className="truncate">{label}</span></span>
      <button type="button" onClick={() => onChange(null)} aria-label={`Clear ${label}`} className="text-stone-400 hover:text-rose-700"><X className="w-4 h-4" /></button>
    </div>;
  }

  return <div ref={boxRef} className={`relative ${className}`}>
    <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" aria-hidden />
    <input id={id} value={text} placeholder={placeholder} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      onFocus={() => setOpen(true)}
      onChange={e => { setText(e.target.value); setOpen(true); setActive(0); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
        else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active]); }
        else if (e.key === 'Escape') setOpen(false);
      }}
      className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-lg bg-white text-sm font-normal" />
    {open && <ul id={listId} role="listbox" className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg text-sm">
      {results.isLoading && <li className="px-3 py-2 text-stone-500">Searching…</li>}
      {!results.isLoading && options.length === 0 && <li className="px-3 py-2 text-stone-500">{text.trim() ? 'No company matches' : 'No companies yet'}</li>}
      {options.map((c, i) => <li key={c.id} role="option" aria-selected={i === active}
        onMouseDown={e => { e.preventDefault(); choose(c); }} onMouseEnter={() => setActive(i)}
        className={`px-3 py-2 cursor-pointer ${i === active ? 'bg-[#f0f7f4]' : ''}`}>
        <div className="font-semibold text-stone-800">{c.name}</div>
        <div className="text-xs text-stone-500">{[c.client_code, placeOf(c), c.parent_name ? `part of ${c.parent_name}` : null].filter(Boolean).join(' · ')}</div>
      </li>)}
      {canCreate && <li role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); setOpen(false); setCreating(true); }}
        className="px-3 py-2 cursor-pointer border-t border-stone-100 text-blue-600 font-bold inline-flex items-center gap-1.5 w-full hover:bg-[#f0f7f4]">
        <Plus className="w-4 h-4" /> Add “{text.trim()}” as a new company
      </li>}
    </ul>}
    {creating && <ClientFormModal initialName={text.trim()} initialKinds={kind ? [kind] : undefined}
      onClose={() => setCreating(false)} onSaved={choose} onPickExisting={choose} />}
  </div>;
}
