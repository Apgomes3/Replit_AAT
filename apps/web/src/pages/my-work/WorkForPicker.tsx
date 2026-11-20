// "For": what a task belongs to (a project, an enquiry or bid, a design book or an initiative),
// as a searchable list. The value is "<kind>:<id>" (p, e, d, i) or "" for nothing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Briefcase, ChevronDown, FolderKanban, Lightbulb, Search, X } from 'lucide-react';
import { LinkOptions, useLinkOptions } from './myWorkApi';

const GROUPS = [
  { key: 'projects', prefix: 'p', label: 'Projects', icon: FolderKanban },
  { key: 'enquiries', prefix: 'e', label: 'Enquiries & bids', icon: Briefcase },
  { key: 'design_books', prefix: 'd', label: 'Design books', icon: BookOpen },
  { key: 'initiatives', prefix: 'i', label: 'Initiatives (internal work)', icon: Lightbulb },
] as const satisfies ReadonlyArray<{ key: keyof LinkOptions; prefix: string; label: string; icon: unknown }>;

export default function WorkForPicker({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const options = useLinkOptions();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const all = useMemo(() => GROUPS.flatMap(g => (options.data?.[g.key] ?? []).map(o => ({ ...o, value: `${g.prefix}:${o.id}`, group: g }))), [options.data]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter(o => words.every(w => `${o.code} ${o.name} ${o.group.label}`.toLowerCase().includes(w)));
  const chosen = all.find(o => o.value === value);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };

  return <div ref={box} className={`relative ${className}`}>
    <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="For"
      onClick={() => { setOpen(o => !o); setActive(0); }}
      className={`flex items-center gap-1.5 max-w-[260px] border rounded-lg px-2.5 py-1.5 text-sm bg-white ${chosen ? 'border-blue-300 text-stone-800' : 'border-[#dce7e2] text-stone-500'}`}>
      {chosen ? <chosen.group.icon className="w-3.5 h-3.5 shrink-0 text-blue-600" /> : null}
      <span className="truncate">{chosen ? <><span className="font-mono text-xs">{chosen.code}</span> {chosen.name}</> : 'For… (project, enquiry, bid)'}</span>
      {chosen
        ? <X role="button" aria-label="Clear" className="w-3.5 h-3.5 shrink-0 text-stone-400 hover:text-rose-600" onClick={e => { e.stopPropagation(); pick(''); }} />
        : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
    </button>
    {open && <div className="absolute z-30 mt-1 w-[340px] max-w-[90vw] bg-white rounded-xl border border-stone-200 shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-100">
        <Search className="w-3.5 h-3.5 text-stone-400" />
        <input autoFocus value={q} placeholder="Search code or name…" aria-label="Search what the task is for"
          onChange={e => { setQ(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active].value); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          className="flex-1 text-sm focus:outline-none" />
      </div>
      <ul role="listbox" className="max-h-72 overflow-auto py-1">
        {options.isLoading && <li className="px-3 py-2 text-xs text-stone-400">Loading…</li>}
        {!options.isLoading && !shown.length && <li className="px-3 py-2 text-xs text-stone-400">Nothing matches “{q}”.</li>}
        {GROUPS.map(g => {
          const list = shown.filter(o => o.group.key === g.key);
          return list.length ? <li key={g.key}>
            <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[.1em] text-stone-400">{g.label}</div>
            <ul>{list.map(o => {
              const i = shown.indexOf(o);
              return <li key={o.value} role="option" aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(o.value); }}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${i === active ? 'bg-blue-50' : ''} ${o.value === value ? 'font-semibold' : ''}`}>
                <g.icon className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                <span className="font-mono text-xs text-stone-500 shrink-0">{o.code}</span>
                <span className="truncate">{o.name}</span>
              </li>;
            })}</ul>
          </li> : null;
        })}
      </ul>
      {value && <button type="button" onMouseDown={e => { e.preventDefault(); pick(''); }} className="w-full text-left px-3 py-2 border-t border-stone-100 text-xs text-stone-500 hover:text-rose-600">Not for anything in particular</button>}
    </div>}
  </div>;
}
