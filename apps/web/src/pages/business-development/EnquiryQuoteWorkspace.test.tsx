import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EnquiryQuoteWorkspace from './EnquiryQuoteWorkspace';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { role: 'user', moduleAccess: { business_development: 'manage' } as any } }));
vi.mock('../../lib/api', () => ({ default: apiMock }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (sel: (s: any) => any) => sel(auth) }));

const draft = { id: 1, status: 'draft', currency: 'USD', updated_at: 'v1', lines: [
  { id: 11, description: 'Pump skid', quantity: 2, unit: 'ea', unit_price: 100, source_snapshot: { source_type: 'pim_product', product_code: 'PMP-01', product_name: 'Pump' } },
] };

function renderWs(enquiry: any, canManage = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><EnquiryQuoteWorkspace enquiryId="5" enquiry={enquiry} canManage={canManage} canImportEquipmentAccess={false} /></QueryClientProvider>);
}

describe('EnquiryQuoteWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { role: 'user', moduleAccess: { business_development: 'manage' } };
    apiMock.get.mockResolvedValue({ data: { items: [{ id: 7, product_code: 'EUR-1', product_name: 'Valve', sell_price: 40, currency: 'EUR' }], quote_currency: 'USD' } });
    apiMock.post.mockResolvedValue({ data: {} });
  });

  it('shows frozen PIM code and does not fetch catalog until picker opens', () => {
    renderWs({ id: 5, quote: draft });
    expect(screen.getByText('PMP-01')).toBeTruthy();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('is read-only for issued quotes', () => {
    renderWs({ id: 5, quote: { ...draft, status: 'issued' } });
    expect(screen.queryByRole('button', { name: /add pim product/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit line/i })).toBeNull();
  });

  it('hides PIM add when PIM explicitly hidden', () => {
    auth.user = { role: 'user', moduleAccess: { business_development: 'manage', pim: 'hidden' } };
    renderWs({ id: 5, quote: draft });
    expect(screen.queryByRole('button', { name: /add pim product/i })).toBeNull();
  });

  it('requires explicit price for foreign-currency product and reuses idempotency key on retry', async () => {
    const user = userEvent.setup();
    renderWs({ id: 5, quote: draft });
    await user.click(screen.getByRole('button', { name: /add pim product/i }));
    await user.click(await screen.findByText('Valve'));
    expect(screen.getByRole('alert').textContent).toMatch(/not USD/);
    const add = screen.getByRole('button', { name: /add to quote/i }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await user.type(screen.getByLabelText(/unit price/i), '0');
    apiMock.post.mockRejectedValueOnce({ response: { status: 500, data: { error: { message: 'x' } } } });
    await user.click(add);
    await user.click(screen.getByRole('button', { name: /add to quote/i }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
    const [a, b] = apiMock.post.mock.calls.map(c => c[1]);
    expect(a.unit_price).toBe(0);
    expect(a.currency).toBe('USD');
    expect(a.idempotency_key).toBeTruthy();
    expect(b.idempotency_key).toBe(a.idempotency_key);
  });
});
