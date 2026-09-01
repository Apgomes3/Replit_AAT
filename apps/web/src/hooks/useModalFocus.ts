import { RefObject, useEffect, useRef } from 'react';

interface ModalFocusOptions {
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Gives a modal a predictable keyboard lifecycle: focus enters the dialog,
 * Tab stays inside it, Escape closes it, and focus returns to the opener.
 */
export function useModalFocus<T extends HTMLElement>({
  onClose,
  initialFocusRef,
  restoreFocusRef,
}: ModalFocusOptions): RefObject<T | null> {
  const dialogRef = useRef<T | null>(null);
  const openerRef = useRef<HTMLElement | null>(
    restoreFocusRef?.current
      || (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null),
  );
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusTarget = initialFocusRef?.current
      || dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusTarget || dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      openerRef.current?.focus();
    };
  }, [initialFocusRef]);

  return dialogRef;
}