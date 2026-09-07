import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import AdminFieldInstruments from './AdminFieldInstruments';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminFieldInstruments />
    </QueryClientProvider>,
  );
}

describe('AdminFieldInstruments loading recovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a timeout error and retries without issuing a separate product request', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ data: {
        items: [{ id: 'fs', name: 'Flow switch', tag_code: 'FS', is_active: true }],
        products: [{ id: 'p1', product_code: 'P-1', product_name: 'Switch' }],
      } });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('The request took too long');
    expect(api.get).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Flow switch')).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).not.toHaveBeenCalledWith('/products/masters', expect.anything());
  });

  it('cancels the catalogue request when the page unmounts', () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation((_url: string, config: any) => {
      requestSignal = config?.signal;
      return new Promise(() => undefined);
    });
    const view = renderPage();

    expect(requestSignal?.aborted).toBe(false);
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);
  });
});