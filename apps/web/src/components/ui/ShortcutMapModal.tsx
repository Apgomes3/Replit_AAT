import { useRef } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { SHORTCUT_GROUPS } from '../../lib/shortcuts';

interface Props {
  onClose: () => void;
}

export default function ShortcutMapModal({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef: closeRef });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-map-title"
        tabIndex={-1}
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl ring-1 ring-stone-200/80 overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '150ms' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-4 h-4 text-stone-400" />
            <h2 id="shortcut-map-title" className="text-sm font-semibold text-stone-800">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="text-stone-400 hover:text-stone-600 p-1 rounded-lg hover:bg-stone-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map(group => (
            <section key={group.group}>
              <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.15em] mb-3">
                {group.group}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map(shortcut => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between gap-4 py-1.5"
                  >
                    <span className="text-sm text-stone-600 flex-1">{shortcut.description}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Mac label */}
                      <span className="flex items-center gap-0.5" aria-label={`Mac: ${shortcut.keys.mac}`}>
                        <kbd className="inline-flex items-center rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px] font-medium text-stone-600 font-mono whitespace-nowrap">
                          {shortcut.keys.mac}
                        </kbd>
                        <span className="text-[9px] text-stone-300 leading-none ml-0.5">mac</span>
                      </span>
                      <span className="text-stone-200 text-xs">/</span>
                      {/* Win label */}
                      <span className="flex items-center gap-0.5" aria-label={`Windows: ${shortcut.keys.win}`}>
                        <kbd className="inline-flex items-center rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px] font-medium text-stone-600 font-mono whitespace-nowrap">
                          {shortcut.keys.win}
                        </kbd>
                        <span className="text-[9px] text-stone-300 leading-none ml-0.5">win</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/60">
          <p className="text-[11px] text-stone-400 text-center">
            Press <kbd className="inline-flex items-center rounded border border-stone-200 bg-white px-1 py-0.5 text-[10px] font-medium text-stone-500">Esc</kbd> or click outside to close
          </p>
        </div>
      </div>
    </div>
  );
}
