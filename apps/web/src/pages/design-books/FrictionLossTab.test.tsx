import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import FrictionLossTab from './FrictionLossTab';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

const apiGet = vi.mocked(api.get);
const apiPut = vi.mocked(api.put);
const circuit = {
  circuit_key: 'loop:1',
  circuit_kind: 'loop',
  circuit_name: 'Main filtration',
  flow_m3h: 72,
  status: 'incomplete',
  freshness: 'unsaved',
  reasons: ['Select a pump assigned to this LSS system.'],
  pump_selection_ready: false,
  pump_selection_status: 'incomplete',
  pump_selection_freshness: 'unsaved',
  pump_selection_reasons: ['Select and calculate this circuit pump first.'],
  components: [],
  result: null,
};
const readyCircuit = {
  ...circuit,
  project_equipment_item_id: 'pump-1',
  selected_pump: {
    id: 'pump-1',
    project_equipment_item_id: 'pump-1',
    equip_code: 'P-101',
    product_code: 'PUMP-01',
    product_name: 'Duty pump',
  },
  pump_selection_ready: true,
  pump_selection_status: 'ready',
  pump_selection_freshness: 'fresh',
  pump_selection_reasons: [],
  reasons: ['Add at least one suction-side pipe or fitting.', 'Add at least one discharge-side pipe or fitting.'],
};
const packageItem = {
  system_id: 'system-1',
  system: { id: 'system-1', system_code: 'LSS-01', system_name: 'Main LSS' },
  items: [circuit],
};
const detail = {
  ...packageItem,
  pump_candidates: [{ id: 'pump-1', equip_code: 'P-101', product_code: 'PUMP-01', product_name: 'Duty pump' }],
  tank_candidates: [
    { id: 'tank-1', tank_code: 'TK-01', tank_name: 'Main tank' },
    { id: 'tank-2', tank_code: 'TK-02', tank_name: 'Receiving tank' },
  ],
  frozen: false,
};
const readyDetail = {
  ...detail,
  items: [readyCircuit],
};

function renderTab(readOnly = false, detailResponse = detail) {
  apiGet.mockResolvedValue({ data: detailResponse } as any);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FrictionLossTab
        book={{ id: 'book-1', friction_loss_calculations: [packageItem] }}
        readOnly={readOnly}
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('FrictionLossTab', () => {
  beforeEach(() => {
    apiGet.mockResolvedValue({ data: detail } as any);
    apiPut.mockResolvedValue({ data: {} } as any);
  });

  it('lists authoritative Flow Route circuits and opens a two-sided editor', async () => {
    const user = userEvent.setup();
    renderTab();
    expect(screen.getByText('Main filtration ·')).toBeInTheDocument();
    expect(screen.getByText('72.000 m³/h')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open system/ }));
    expect(await screen.findByText('Suction side')).toBeInTheDocument();
    expect(screen.getByText('Discharge side')).toBeInTheDocument();
    expect(screen.getByText(/Authoritative circuit flow:/)).toHaveTextContent('72.000 m³/h');
    expect(await screen.findByRole('combobox', { name: 'Start tank' })).toHaveValue('');
    expect(screen.getByRole('spinbutton', { name: 'Start tank base elevation' })).toHaveValue(0);
    expect(screen.getByRole('checkbox', { name: 'Start tank open to atmosphere' })).toBeChecked();
    expect(screen.getByRole('link', { name: 'Open LSS Pump Selection' })).toHaveAttribute(
      'href',
      '/design-books/book-1/lss/system-1?tab=pump#pump-selection',
    );
    expect(screen.getByRole('button', { name: 'Save & recalculate' })).toBeDisabled();
    expect(apiGet).toHaveBeenCalledWith('/design-books/book-1/friction-loss/system-1');
  });

  it('uses the inherited pump and persists compact suction and discharge table rows', async () => {
    const user = userEvent.setup();
    renderTab(false, readyDetail);
    await user.click(screen.getByRole('button', { name: /Open system/ }));
    await screen.findByText('Suction side');
    expect(screen.getByText('P-101 · Duty pump')).toBeInTheDocument();
    expect(screen.getByText(/read-only from Pump Selection/)).toBeInTheDocument();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Start tank' }), 'tank-1');
    await user.type(screen.getByRole('spinbutton', { name: 'Start tank water depth' }), '3');
    await user.type(screen.getByRole('spinbutton', { name: 'Pump draw height' }), '0.5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Receiving tank' }), 'tank-2');
    await user.type(screen.getByRole('spinbutton', { name: 'Receiving tank base elevation' }), '5');
    await user.type(screen.getByRole('spinbutton', { name: 'Receiving tank water depth' }), '2');

    const suction = screen.getByText('Suction side').closest('section')!;
    await user.click(within(suction).getByRole('button', { name: 'Pipe' }));
    expect(within(suction).getByRole('table')).toBeInTheDocument();
    const suctionInputs = within(suction).getAllByRole('spinbutton');
    await user.type(suctionInputs[0], '100');
    await user.type(suctionInputs[1], '12');
    await user.selectOptions(within(suction).getByRole('combobox', { name: 'Material 1' }), 'HDPE');
    expect(within(suction).getByRole('spinbutton', { name: 'Roughness 1' })).toHaveValue(0.0015);
    expect(within(suction).getByRole('spinbutton', { name: 'Roughness 1' })).toBeDisabled();

    const discharge = screen.getByText('Discharge side').closest('section')!;
    await user.click(within(discharge).getByRole('button', { name: 'Fitting' }));
    const dischargeInputs = within(discharge).getAllByRole('spinbutton');
    await user.type(dischargeInputs[0], '100');
    await user.type(dischargeInputs[1], '0.9');
    await user.clear(dischargeInputs[2]);
    await user.type(dischargeInputs[2], '2');
    await user.click(screen.getByRole('button', { name: 'Save & recalculate' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/design-books/book-1/friction-loss/system-1',
      expect.objectContaining({
        circuit_key: 'loop:1',
        project_equipment_item_id: 'pump-1',
        tank_boundaries: expect.objectContaining({
          start: expect.objectContaining({ tank_id: 'tank-1', base_elevation_fl0_m: '0', water_depth_m: '3', pump_draw_height_m: '0.5', open_to_atmosphere: true }),
          end: expect.objectContaining({ tank_id: 'tank-2', base_elevation_fl0_m: '5', water_depth_m: '2', open_to_atmosphere: true }),
        }),
        components: expect.arrayContaining([
          expect.objectContaining({
            side: 'suction',
            component_kind: 'pipe',
            material: 'HDPE',
            absolute_roughness_mm: 0.0015,
          }),
          expect.objectContaining({ side: 'discharge', component_kind: 'fitting' }),
        ]),
      }),
    ));
  });

  it('shows frozen calculations without editing controls', async () => {
    const user = userEvent.setup();
    renderTab(true);
    await user.click(screen.getByRole('button', { name: /Open system/ }));
    await screen.findByText('Suction side');
    expect(screen.queryByRole('button', { name: 'Save & recalculate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pipe' })).not.toBeInTheDocument();
  });
});