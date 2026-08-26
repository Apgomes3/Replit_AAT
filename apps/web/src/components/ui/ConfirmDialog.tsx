import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';

interface ConfirmDialogProps {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  busyLabel?: string;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  busyLabel = 'Saving…',
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useModalFocus<HTMLDivElement>({ onClose: onCancel });

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={busy ? undefined : onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'confirm-dialog-title' : undefined}
        aria-describedby="confirm-dialog-message"
        tabIndex={-1}
        className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm p-6"
      >
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="shrink-0 w-9 h-9 rounded-full bg-red-50 flex items-center justify-center mt-0.5">
              <AlertTriangle className="w-4.5 h-4.5 text-red-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {title && <h3 id="confirm-dialog-title" className="text-sm font-semibold text-slate-800 mb-1">{title}</h3>}
            <p id="confirm-dialog-message" className="text-sm text-slate-600 leading-relaxed">{message}</p>
          </div>
          <button aria-label="Close dialog" title="Close dialog" onClick={onCancel} disabled={busy} className="text-slate-300 hover:text-slate-500 shrink-0 -mt-0.5 -mr-1 disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
