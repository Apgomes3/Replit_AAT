import { useRef } from 'react';
import { X } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';

type Props = {
  title: string;
  subtitle?: string;
  saving: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
};

/** Form dialog used by the drafting setup screens (focus-trapped, Escape closes). */
export default function DraftingModal({ title, subtitle, saving, submitLabel, onClose, onSubmit, children }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  return (
    <div className="fixed inset-0 z-50 bg-[#20333a]/40 p-4 flex items-center justify-center">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="drafting-modal-title" tabIndex={-1}
        className="bg-white w-full max-w-2xl max-h-[92vh] overflow-auto rounded-2xl shadow-2xl">
        <form onSubmit={onSubmit}>
          <div className="p-5 border-b border-[#edf2ef] flex justify-between gap-4">
            <div>
              <h2 id="drafting-modal-title" className="font-extrabold">{title}</h2>
              {subtitle && <p className="text-xs text-[#6f8082] mt-1">{subtitle}</p>}
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-[#80908f]" /></button>
          </div>
          <div className="p-5 grid sm:grid-cols-2 gap-4">{children}</div>
          <div className="p-5 bg-[#f5f8f6] flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
            <button disabled={saving} className="px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold disabled:opacity-60">
              {saving ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const fieldLabel = 'text-xs font-bold text-[#53686b]';
export const fieldInput = 'mt-1.5 w-full border border-[#dce7e2] rounded-lg px-3 py-2 text-sm font-normal bg-white';
