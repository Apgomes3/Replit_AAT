import { useState, useRef, useEffect, useId } from 'react';
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const filtered = search.trim()
    ? COUNTRIES.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : COUNTRIES;

  const close = (shouldRestoreFocus: boolean) => {
    setOpen(false);
    setSearch('');
    setActiveIndex(-1);
    if (shouldRestoreFocus) restoreFocus.current = true;
  };

  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const handleMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close(false);
    };
    const handleFocusIn = (e: FocusEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [open]);

  const select = (c: string) => {
    onChange(c);
    close(true);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setActiveIndex(-1);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus-within:ring-2 focus-within:ring-blue-600/30">
        {open ? (
          <input
            ref={inputRef}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setActiveIndex(e.target.value.trim() ? 0 : -1);
            }}
            placeholder={value || placeholder}
            aria-label="Search countries"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 && filtered[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
            className="flex-1 outline-none text-sm bg-transparent"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
              } else if (e.key === 'Enter' && activeIndex >= 0 && filtered[activeIndex]) {
                e.preventDefault();
                select(filtered[activeIndex]);
              } else if (e.key === 'ArrowDown' && filtered.length > 0) {
                e.preventDefault();
                setActiveIndex(index => index < filtered.length - 1 ? index + 1 : 0);
              } else if (e.key === 'ArrowUp' && filtered.length > 0) {
                e.preventDefault();
                setActiveIndex(index => index <= 0 ? filtered.length - 1 : index - 1);
              } else if (e.key === 'Home' && filtered.length > 0) {
                e.preventDefault();
                setActiveIndex(0);
              } else if (e.key === 'End' && filtered.length > 0) {
                e.preventDefault();
                setActiveIndex(filtered.length - 1);
              } else if (e.key === 'Tab') {
                close(false);
              }
            }}
          />
        ) : (
          <button
            ref={triggerRef}
            type="button"
            aria-label={value ? `Select country, currently ${value}` : 'Select country'}
            aria-haspopup="listbox"
            aria-expanded="false"
            onClick={() => {
              setOpen(true);
              setActiveIndex(value ? Math.max(COUNTRIES.indexOf(value), 0) : -1);
            }}
            onKeyDown={e => {
              if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
                e.preventDefault();
                setOpen(true);
                setActiveIndex(value ? Math.max(COUNTRIES.indexOf(value), 0) : 0);
              }
            }}
            className={`flex-1 min-w-0 text-left truncate outline-none ${value ? 'text-slate-800' : 'text-slate-400'}`}
          >
            {value || placeholder}
          </button>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && !open && (
            <button type="button" aria-label="Clear selected country" title="Clear selected country" onClick={clear} className="text-slate-300 hover:text-slate-500">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {open && (
        <div id={listboxId} role="listbox" aria-label="Country options" className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400">No countries match "{search}"</div>
          ) : (
            filtered.map((c, index) => (
              <button
                key={c}
                type="button"
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={c === value}
                tabIndex={-1}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(c)}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors ${index === activeIndex ? 'bg-slate-50' : ''} ${c === value ? 'text-blue-600 font-medium bg-blue-50' : 'text-slate-700'}`}
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
