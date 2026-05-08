import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { COUNTRIES } from '../../lib/countries';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export default function CountryCombobox({ value, onChange, placeholder = 'Select country…', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = search.trim()
    ? COUNTRIES.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : COUNTRIES;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (c: string) => {
    onChange(c);
    setSearch('');
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className="flex items-center border border-slate-200 rounded-lg px-3 py-2 text-sm cursor-pointer focus-within:ring-2 focus-within:ring-blue-600/30 bg-white"
        onClick={() => { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 50); }}
      >
        {open ? (
          <input
            ref={inputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={value || placeholder}
            className="flex-1 outline-none text-sm bg-transparent"
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && filtered.length > 0) select(filtered[0]);
            }}
          />
        ) : (
          <span className={`flex-1 truncate ${value ? 'text-slate-800' : 'text-slate-400'}`}>
            {value || placeholder}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && !open && (
            <button type="button" onClick={clear} className="text-slate-300 hover:text-slate-500">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400">No countries match "{search}"</div>
          ) : (
            filtered.map(c => (
              <button
                key={c}
                type="button"
                onMouseDown={() => select(c)}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors ${c === value ? 'text-blue-600 font-medium bg-blue-50' : 'text-slate-700'}`}
              >
                {c}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
