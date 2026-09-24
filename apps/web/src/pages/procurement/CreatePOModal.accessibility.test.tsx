import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreatePOModal from './CreatePOModal';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { persistCreateDraft } from '../../lib/createDraftKey';
import { readRecoveryDraft } from '../../components/ui/ProtectedDraftBar';

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

  it('stores the committed header before sending line items and reopens it after recovery', async () => {
    const user = userEvent.setup();
    const userId = '99999999-9999-4999-8999-999999999999';
    const poId = '22222222-2222-4222-8222-222222222222';
    const storageKey = `purchase-order:${userId}:create`;
    useAuthStore.setState({ user: { id: userId, email: 'test@example.com', firstName: 'Test', lastName: 'User', role: 'engineer' } });
    vi.mocked(api.get).mockImplementation(async () => ({ data: { items: [{ id: 'project-1', project_code: 'P-1', project_name: 'Project' }] } } as any));
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockImplementation(async (url) => {
      if (url === '/purchase-orders') return { data: { id: poId, po_code: 'PO-2026-0001' } } as any;
      throw new Error('Line item response lost');
    });
    persistCreateDraft(storageKey, {
      projectId: 'project-1', currency: 'USD', notes: '', vendorName: '', requiredByDate: '',
      paymentTerms: '', paymentTermsOther: '', shippingTerms: '', shippingTermsOther: '', priority: 'normal',
      items: [{ key: 0, product_master_id: 'product-1', quantity: 1, uom: 'EA', cost_price: '', sell_price: '', notes: '', system_id: '' }],
      documentName: '', partialPoId: null, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    const first = renderCreateModal();
    await user.click(screen.getByRole('button', { name: 'Open purchase order dialog' }));
    await user.click(await screen.findByRole('button', { name: 'Restore draft' }));
    await user.click(screen.getByRole('button', { name: 'Create PO' }));
    await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalledTimes(2));
    expect((readRecoveryDraft(storageKey)?.value as any).partialPoId).toBe(poId);
    first.unmount();

    renderCreateModal();
    await user.click(screen.getByRole('button', { name: 'Open purchase order dialog' }));
    await user.click(await screen.findByRole('button', { name: 'Restore draft' }));
    expect(screen.getByText(/The purchase order header was created/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Open incomplete PO' })[0]);
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(2);
  });
});