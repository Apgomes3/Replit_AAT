import { useState, useRef, useEffect, useId } from 'react';
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
  const [activeIndex, setActiveIndex] = useState(Math.max(options.indexOf(value), 0));
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreFocusAfterSave = useRef(false);
  const listboxId = useId();

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();

    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || saving) return;
    if (open) {
      close(true);
    } else {
      setActiveIndex(Math.max(options.indexOf(value), 0));
      setOpen(true);
    }
  };

  const handleSelect = async (e: React.MouseEvent | React.KeyboardEvent, status: string) => {
    e.stopPropagation();
    if (status === value) {
      close(true);
      return;
    }
    setOpen(false);
    setSaving(true);
    restoreFocusAfterSave.current = true;
    try {
      await onSave(status);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!saving && restoreFocusAfterSave.current) {
      restoreFocusAfterSave.current = false;
      triggerRef.current?.focus();
    }
  }, [saving]);

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Change status, currently ${value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-busy={saving}
        onClick={handleToggle}
        onKeyDown={e => {
          if (disabled || saving) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(Math.max(options.indexOf(value), 0));
            setOpen(true);
          }
        }}
        disabled={disabled || saving}
        className={clsx(
          'flex items-center gap-1 rounded-full transition-all focus:outline-none',
          !disabled && !saving && 'hover:ring-2 hover:ring-blue-300 hover:ring-offset-1 cursor-pointer group',
          saving && 'opacity-60 cursor-wait',
          disabled && 'cursor-default',
        )}
      >
        <StatusBadge status={value} />
        {!disabled && !saving && (
          <ChevronDown className={clsx(
            'w-3 h-3 text-stone-400 -ml-0.5 opacity-0 group-hover:opacity-100 transition-all duration-150',
            open && 'rotate-180 opacity-100 text-blue-500',
          )} />
        )}
        {saving && (
          <span className="w-3 h-3 -ml-0.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 z-50 bg-white border border-stone-200 rounded-xl shadow-xl shadow-black/10 py-1 min-w-[160px]">
          <div id={`${listboxId}-label`} className="px-3 py-1 text-[10px] font-bold text-stone-400 uppercase tracking-wider">Set status</div>
          <div id={listboxId} role="listbox" aria-labelledby={`${listboxId}-label`}>
            {options.map((opt, index) => (
              <button
                key={opt}
                ref={element => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={opt === value}
                tabIndex={-1}
                onClick={e => handleSelect(e, opt)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const nextIndex = e.key === 'ArrowDown'
                      ? (index + 1) % options.length
                      : (index - 1 + options.length) % options.length;
                    setActiveIndex(nextIndex);
                    optionRefs.current[nextIndex]?.focus();
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    setActiveIndex(0);
                    optionRefs.current[0]?.focus();
                  } else if (e.key === 'End') {
                    e.preventDefault();
                    const lastIndex = options.length - 1;
                    setActiveIndex(lastIndex);
                    optionRefs.current[lastIndex]?.focus();
                  } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Space') {
                    e.preventDefault();
                    handleSelect(e, opt);
                  }
                }}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100',
                  opt === value ? 'bg-blue-50/60' : 'hover:bg-stone-50',
                )}
              >
                <StatusBadge status={opt} />
                {opt === value && (
                  <span className="ml-auto text-blue-500 text-xs font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
