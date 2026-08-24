import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useModalFocus } from './useModalFocus';

function FocusTestDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalFocus<HTMLDivElement>({ onClose });

  return (
    <div ref={dialogRef} role="dialog" aria-label="Test dialog" tabIndex={-1}>
      <button>First action</button>
      <button>Last action</button>
    </div>
  );
}

function ModalHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open && <FocusTestDialog onClose={() => setOpen(false)} />}
    </>
  );
}

describe('useModalFocus', () => {
  it('moves focus into the dialog, traps Tab in both directions, and restores the opener', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });
    expect(document.activeElement).toBe(first);

    await user.tab();
    expect(document.activeElement).toBe(last);

    await user.tab();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('uses the latest close callback when Escape is pressed', () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const initialFocusRef = { current: null };

    function CallbackHarness({ onClose }: { onClose: () => void }) {
      const dialogRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef });
      return <div ref={dialogRef} role="dialog" aria-label="Callback dialog" tabIndex={-1} />;
    }

    const { rerender } = render(<CallbackHarness onClose={firstClose} />);
    rerender(<CallbackHarness onClose={secondClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledOnce();
  });
});