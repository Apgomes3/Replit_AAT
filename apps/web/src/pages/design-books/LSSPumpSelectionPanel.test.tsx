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
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);
const apiPut = vi.mocked(api.put);
const apiPost = vi.mocked(api.post);
const apiDelete = vi.mocked(api.delete);

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
    pump_role: 'primary',
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
    apiPost.mockResolvedValue({ data: { project_equipment_item: { id: 'created-pump' } } } as any);
    apiDelete.mockResolvedValue({ data: { ok: true } } as any);
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
      pump_role: 'primary',
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

  it('offers Add pump when a circuit has no allocation', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Add pump' })).toBeInTheDocument();
  });

  it('shows the venturi question for a Foam Fractionator and creates FFVP when Yes is chosen', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ data: {
      ...response,
      items: [{
        ...response.items[0],
        circuit_name: 'Foam Fractionator Loop',
        circuit_type: 'Foam Fractionation',
        is_foam_fractionator: true,
        pump_role: 'primary',
        pump_role_name: 'FFSP — Foam Fractionator Supply Pump',
        flow_m3h: 224.15,
      }],
    } } as any);
    renderPanel();

    expect(await screen.findByText('224.15 m³/h')).toBeInTheDocument();
    expect(screen.getByText('Do you need a separate venturi pump?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes — add FFVP' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/systems/system-1/pump-lines', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'venturi',
    }));
  });

  it('saves an FFVP with its explicit flow instead of the supply flow', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ data: {
      ...response,
      items: [
        {
          ...response.items[0],
          circuit_name: 'Foam Fractionator Loop',
          circuit_type: 'Foam Fractionation',
          is_foam_fractionator: true,
          pump_role: 'primary',
          pump_role_name: 'FFSP — Foam Fractionator Supply Pump',
          flow_m3h: 224.15,
        },
        {
          ...response.items[0],
          circuit_name: 'Foam Fractionator Loop',
          circuit_type: 'Foam Fractionation',
          is_foam_fractionator: true,
          pump_role: 'venturi',
          pump_role_name: 'FFVP — Foam Fractionator Venturi Pump',
          flow_m3h: 224.15,
          venturi_flow_m3h: null,
          project_equipment_item_id: 'equipment-1',
        },
      ],
    } } as any);
    renderPanel();

    const venturiFlow = await screen.findByLabelText('Venturi flow for FFVP — Foam Fractionator Venturi Pump');
    await user.type(venturiFlow, '42.5');
    await user.type(screen.getByLabelText('Initial design head for FFVP — Foam Fractionator Venturi Pump'), '8');
    await user.type(screen.getByLabelText('Pump efficiency for FFVP — Foam Fractionator Venturi Pump'), '75');
    await user.type(screen.getByLabelText('Motor efficiency for FFVP — Foam Fractionator Venturi Pump'), '90');
    await user.click(screen.getAllByRole('button', { name: 'Save & calculate' })[1]);

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/systems/system-1/pump-selections', expect.objectContaining({
      circuit_key: 'loop:1',
      pump_role: 'venturi',
      venturi_flow_m3h: 42.5,
      design_head_m: 8,
    })));
  });
});