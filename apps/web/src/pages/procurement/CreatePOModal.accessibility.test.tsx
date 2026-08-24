import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreatePOModal from './CreatePOModal';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { items: [] } }),
    post: vi.fn(),
  },
}));

function CreateModalHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open purchase order dialog</button>
      {open && <CreatePOModal onClose={() => setOpen(false)} />}
    </>
  );
}

function renderCreateModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreateModalHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreatePOModal accessibility behavior', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('focuses product search on open and restores the opener after Escape', async () => {
    const user = userEvent.setup();
    renderCreateModal();

    const opener = screen.getByRole('button', { name: 'Open purchase order dialog' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'New Purchase Order' });
    const productSearch = screen.getByPlaceholderText('Search product by name or code to add…');
    expect(document.activeElement).toBe(productSearch);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'New Purchase Order' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});