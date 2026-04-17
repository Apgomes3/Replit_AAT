import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import StatusBadge from './StatusBadge';

interface InlineStatusSelectProps {
  value: string;
  options: string[];
  onSave: (newStatus: string) => Promise<void>;
  disabled?: boolean;
}

export default function InlineStatusSelect({ value, options, onSave, disabled }: InlineStatusSelectProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled && !saving) setOpen(v => !v);
  };

  const handleSelect = async (e: React.MouseEvent, status: string) => {
    e.stopPropagation();
    if (status === value) { setOpen(false); return; }
    setOpen(false);
    setSaving(true);
    try {
      await onSave(status);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        onClick={handleToggle}
        disabled={disabled || saving}
        className={clsx(
          'flex items-center gap-1 rounded-full transition-all focus:outline-none',
          !disabled && !saving && 'hover:ring-2 hover:ring-amber-300 hover:ring-offset-1 cursor-pointer group',
          saving && 'opacity-60 cursor-wait',
          disabled && 'cursor-default',
        )}
      >
        <StatusBadge status={value} />
        {!disabled && !saving && (
          <ChevronDown className={clsx(
            'w-3 h-3 text-stone-400 -ml-0.5 opacity-0 group-hover:opacity-100 transition-all duration-150',
            open && 'rotate-180 opacity-100 text-amber-500',
          )} />
        )}
        {saving && (
          <span className="w-3 h-3 -ml-0.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin inline-block" />
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 z-50 bg-white border border-stone-200 rounded-xl shadow-xl shadow-black/10 py-1 min-w-[160px]">
          <div className="px-3 py-1 text-[10px] font-bold text-stone-400 uppercase tracking-wider">Set status</div>
          {options.map(opt => (
            <button
              key={opt}
              onClick={e => handleSelect(e, opt)}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100',
                opt === value ? 'bg-amber-50/60' : 'hover:bg-stone-50',
              )}
            >
              <StatusBadge status={opt} />
              {opt === value && (
                <span className="ml-auto text-amber-500 text-xs font-bold">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
