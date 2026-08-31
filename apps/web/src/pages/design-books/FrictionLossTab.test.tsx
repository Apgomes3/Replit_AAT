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
  components: [],
  result: null,
};
const packageItem = {
  system_id: 'system-1',
  system: { id: 'system-1', system_code: 'LSS-01', system_name: 'Main LSS' },
  items: [circuit],
};
const detail = {
  ...packageItem,
  pump_candidates: [{ id: 'pump-1', equip_code: 'P-101', product_code: 'PUMP-01', product_name: 'Duty pump' }],
  piping_candidates: [
    { id: 'pipe-1', piping_code: 'PI-101', product_name: 'PVC pipe' },
    { id: 'fit-1', piping_code: 'FI-101', product_name: 'Elbow' },
  ],
  frozen: false,
};

function renderTab(readOnly = false) {
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
    expect(apiGet).toHaveBeenCalledWith('/design-books/book-1/friction-loss/system-1');
  });

  it('persists separate suction pipe and discharge fitting schedules', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole('button', { name: /Open system/ }));
    await screen.findByText('Suction side');
    await user.selectOptions(screen.getByText('Selected LSS pump').parentElement!.querySelector('select')!, 'pump-1');

    const suction = screen.getByText('Suction side').closest('section')!;
    await user.click(within(suction).getByRole('button', { name: 'Pipe' }));
    await user.selectOptions(within(suction).getByText('Project pipe / fitting').parentElement!.querySelector('select')!, 'pipe-1');
    const suctionInputs = within(suction).getAllByRole('spinbutton');
    await user.type(suctionInputs[0], '100');
    await user.type(suctionInputs[1], '12');
    await user.type(suctionInputs[2], '0.0015');
    await user.type(within(suction).getByPlaceholderText('e.g. PVC-U'), 'PVC-U');

    const discharge = screen.getByText('Discharge side').closest('section')!;
    await user.click(within(discharge).getByRole('button', { name: 'Fitting' }));
    await user.selectOptions(within(discharge).getByText('Project pipe / fitting').parentElement!.querySelector('select')!, 'fit-1');
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
        components: expect.arrayContaining([
          expect.objectContaining({ side: 'suction', component_kind: 'pipe', project_piping_item_id: 'pipe-1' }),
          expect.objectContaining({ side: 'discharge', component_kind: 'fitting', project_piping_item_id: 'fit-1' }),
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