import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import LSSThermalSelectionPanel from './LSSThermalSelectionPanel';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);

function renderPanel(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LSSThermalSelectionPanel bookId="book-1" systemId="system-1" readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe('LSSThermalSelectionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: {
      duty: { duty: 'Cooling', required_capacity_kw: 18.5 },
      thermal_status: 'Ready',
      thermal_freshness: 'fresh',
      frozen: false,
      saved: null,
      side_streams: [{ id: 'stream-1', name: 'Thermal', flow_m3h: 22.5 }],
      products: [{
        id: 'product-1',
        product_master_id: 'product-1',
        product_code: 'HX-20',
        product_name: 'Plate 20',
        duty: 'Cooling',
        thermal_capacity_kw: 20,
      }],
    } } as any);
    apiPost.mockResolvedValue({ data: { saved: { id: 'selection-1' } } } as any);
  });

  it('shows resolved flow and saves the selected Product Master plate', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('18.50 kW')).toBeInTheDocument();
    expect(screen.getByText(/Resolved plate-side flow:/)).toHaveTextContent('22.500 m³/h');
    await user.click(screen.getByRole('button', { name: 'Save plate selection' }));
    expect(apiPost).toHaveBeenCalledWith(
      '/design-books/book-1/thermal-selection/system-1',
      { side_stream_id: 'stream-1', product_master_id: 'product-1' },
    );
  });
});