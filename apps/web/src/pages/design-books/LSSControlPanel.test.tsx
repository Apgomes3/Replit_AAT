import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LSSControlPanel from './LSSControlPanel';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));

function renderPanel(data: any, readOnly = true, canOverrideProduct = !readOnly) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/systems/system-1/control') return Promise.resolve({ data });
    if (url === '/products/masters') return Promise.resolve({ data: { items: [] } });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LSSControlPanel bookId="book-1" systemId="system-1" readOnly={readOnly} canOverrideProduct={canOverrideProduct} />
    </QueryClientProvider>,
  );
}

describe('LSSControlPanel frozen evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch or enable the product picker without PIM manage permission', async () => {
    renderPanel({
      control: { panel_type: 'GPO' },
      definitions: [{ id: 'definition-1', name: 'Flow switch', tag_code: 'FS' }],
      instruments: [],
    }, false, false);

    expect(await screen.findByLabelText('Product for Flow switch')).toBeDisabled();
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith('/products/masters', {
      params: { limit: 1000, status: 'Active' },
    });
  });

  it('fetches and enables the product picker with PIM manage permission', async () => {
    renderPanel({
      control: { panel_type: 'GPO' },
      definitions: [{ id: 'definition-1', name: 'Flow switch', tag_code: 'FS' }],
      instruments: [],
    }, false, true);

    expect(await screen.findByLabelText('Product for Flow switch')).toBeEnabled();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/products/masters', {
      params: { limit: 1000, status: 'Active' },
    });
  });

  it('renders frozen definition and product snapshots without live catalogue records', async () => {
    renderPanel({
      frozen: true,
      control: { panel_type: 'PLC' },
      definitions: [],
      instruments: [{
        definition_id: 'definition-retired',
        tag: 'LSS-01-PT-01',
        control_logic: 'Stop pump on high pressure.',
        product_master_id: 'product-retired',
        definition_snapshot: { id: 'definition-retired', name: 'Pressure transmitter', tag_code: 'PT', description: 'Historic pressure measurement', signal_type: 'Analog', signal_direction: 'Input' },
        product_snapshot: { id: 'product-retired', product_code: 'PT-100', product_name: 'Historic transmitter', status: 'Retired' },
      }],
    });

    expect(await screen.findByText('Pressure transmitter')).toBeVisible();
    expect(screen.getByText('Frozen definition evidence')).toBeVisible();
    expect(screen.getByRole('option', { name: /PT-100 — Historic transmitter \(Retired\) \(frozen snapshot\)/ })).toBeInTheDocument();
    expect(screen.getByText('Frozen product evidence')).toBeVisible();
    expect(screen.getByDisplayValue('Stop pump on high pressure.')).toBeDisabled();
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith('/products/masters', expect.anything());
  });

  it('keeps saved logic editable and submits only the intentional logic change', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    renderPanel({
      control: { panel_type: 'GPO' },
      definitions: [{ id: 'definition-1', name: 'Flow switch', tag_code: 'FS', default_control_logic: 'Original default' }],
      instruments: [{
        definition_id: 'definition-1',
        product_master_id: 'saved-product',
        control_logic: 'Saved interlock logic',
      }],
    }, false);

    const logic = await screen.findByDisplayValue('Saved interlock logic');
    await user.clear(logic);
    await user.type(logic, 'Revised interlock logic');
    await user.click(screen.getByRole('button', { name: 'Save control configuration' }));

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/systems/system-1/control', {
      design_book_id: 'book-1',
      panel_type: 'GPO',
      instruments: [{
        definition_id: 'definition-1',
        quantity: 1,
        control_logic: 'Revised interlock logic',
      }],
    });
  });
});