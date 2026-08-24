import { ReactNode, RefObject } from 'react';
import { useModalFocus } from '../../hooks/useModalFocus';

interface ModalDialogProps {
  onClose: () => void;
  labelledBy: string;
  className: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export default function ModalDialog({
  onClose,
  labelledBy,
  className,
  children,
  initialFocusRef,
}: ModalDialogProps) {
  const dialogRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={className}
    >
      {children}
    </div>
  );
}