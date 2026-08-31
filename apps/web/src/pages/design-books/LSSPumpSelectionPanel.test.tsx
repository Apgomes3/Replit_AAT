import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import LSSPumpSelectionPanel from './LSSPumpSelectionPanel';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);
const apiPut = vi.mocked(api.put);

function renderPanel(readOnly = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LSSPumpSelectionPanel systemId="system-1" bookId="book-1" readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

const response = {
  items: [{
    circuit_key: 'loop:1',
    circuit_kind: 'main_loop',
    circuit_name: 'Sand Filter Loop',
    circuit_type: 'Sand Filter',
    flow_m3h: 90,
    project_equipment_item_id: null,
    design_head_m: null,
    pump_efficiency_pct: null,
    motor_efficiency_pct: null,
    freshness: 'fresh',
    status: 'incomplete',
    reasons: ['Select a pump.'],
    results: null,
  }],
  pump_candidates: [{
    id: 'equipment-1',
    equip_code: 'P-101',
    product_code: 'PM-PUMP-CIR-22',
    product_name: 'Circulation Pump 22kW',
    power_kw: 22,
  }],
  frozen: false,
};

describe('LSSPumpSelectionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: response } as any);
    apiPut.mockResolvedValue({ data: { item: response.items[0] } } as any);
  });

  it('shows authoritative Flow Route flow and saves separate efficiency inputs', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('90.00 m³/h')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Selected pump for Sand Filter Loop'), 'equipment-1');
    await user.type(screen.getByLabelText('Initial design head for Sand Filter Loop'), '18');
    await user.type(screen.getByLabelText('Pump efficiency for Sand Filter Loop'), '76');
    await user.type(screen.getByLabelText('Motor efficiency for Sand Filter Loop'), '92');
    await user.click(screen.getByRole('button', { name: 'Save & calculate' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/systems/system-1/pump-selections', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      project_equipment_item_id: 'equipment-1',
      design_head_m: 18,
      pump_efficiency_pct: 76,
      motor_efficiency_pct: 92,
    }));
  });

  it('keeps a frozen pump-selection package read-only', async () => {
    apiGet.mockResolvedValue({ data: { ...response, frozen: true } } as any);
    renderPanel();

    expect(await screen.findByText('This pump-selection package is frozen with the Design Book revision.')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected pump for Sand Filter Loop')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save & calculate' })).not.toBeInTheDocument();
  });
});