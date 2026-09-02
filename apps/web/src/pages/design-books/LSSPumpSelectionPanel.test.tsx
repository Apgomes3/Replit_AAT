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
    pump_quantity: 1,
    project_equipment_item_id: null,
    design_head_m: null,
    pump_efficiency_pct: null,
    motor_efficiency_pct: null,
    freshness: 'fresh',
    status: 'incomplete',
    reasons: ['Save and calculate to create the governed system pump.'],
    pump_duty_tag: 'SFSP',
    pump_tags: ['03-SFSP-01'],
    results: null,
  }],
  pump_candidates: [{
    id: 'equipment-1',
    project_equipment_item_id: 'equipment-1',
    equip_code: 'P-101',
    product_code: 'PM-PUMP-CIR-22',
    product_name: 'Circulation Pump 22kW',
    design_flow_m3h: 120,
    design_head_m: 24,
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
    await user.type(screen.getByLabelText('Initial design head for Sand Filter Loop'), '18');
    await user.type(screen.getByLabelText('Pump efficiency for Sand Filter Loop'), '76');
    await user.type(screen.getByLabelText('Motor efficiency for Sand Filter Loop'), '92');
    await user.selectOptions(screen.getByLabelText('Pump product for Sand Filter Loop'), 'equipment-1');
    await user.clear(screen.getByLabelText('Pump quantity for Sand Filter Loop'));
    await user.type(screen.getByLabelText('Pump quantity for Sand Filter Loop'), '3');
    await user.click(screen.getByRole('button', { name: 'Save & calculate' }));

    expect(apiPost).not.toHaveBeenCalled();
    expect(apiPut).toHaveBeenCalledWith('/systems/system-1/pump-selections', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'primary',
      project_equipment_item_id: 'equipment-1',
      design_head_m: 18,
      pump_efficiency_pct: 76,
      motor_efficiency_pct: 92,
      pump_quantity: 3,
    });
  });

  it('does not expose an origin selector for a known Sand Filter duty', async () => {
    apiGet.mockResolvedValue({ data: {
      ...response,
      items: [{
        ...response.items[0],
        pump_duty_type_id: 'duty-sfsp',
        pump_role_name: 'SFSP — Sand Filter Supply Pump',
        requires_pump_origin: false,
      }],
      pump_duty_types: [
        { id: 'duty-sfsp', tag: 'SFSP', pump_name: 'Sand Filter Supply Pump' },
        { id: 'duty-vacp', tag: 'VACP', pump_name: 'Vacuum Pump' },
      ],
    } } as any);
    renderPanel();

    expect(await screen.findByText('SFSP — Sand Filter Supply Pump')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Pump duty type/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Pump origin for /)).not.toBeInTheDocument();
  });

  it('does not expose manual origin or pump-name controls for an unknown loop', async () => {
    apiGet.mockResolvedValue({ data: {
      ...response,
      items: [{
        ...response.items[0],
        circuit_name: 'New treatment loop',
        circuit_type: 'Pumped',
        pump_role_name: 'Pump origin required',
        pump_duty_tag: null,
        pump_tags: [],
        requires_pump_origin: true,
      }],
      pump_duty_types: [
        { id: 'duty-circp', tag: 'CIRCP', pump_name: 'Circulation Pump' },
        { id: 'duty-vacp', tag: 'VACP', pump_name: 'Vacuum Pump' },
      ],
    } } as any);
    renderPanel();

    expect(await screen.findByText('No Platform Admin relationship matches this circuit.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Pump origin for /)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/New pump name/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create & use' })).not.toBeInTheDocument();
  });

  it('keeps a frozen pump-selection package read-only', async () => {
    apiGet.mockResolvedValue({ data: { ...response, frozen: true } } as any);
    renderPanel();

    expect(await screen.findByText('This pump-selection package is frozen with the Design Book revision.')).toBeInTheDocument();
    expect(screen.getByLabelText('Pump quantity for Sand Filter Loop')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save & calculate' })).not.toBeInTheDocument();
  });

  it('filters Pump-category products against per-pump flow and design head', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ data: {
      ...response,
      pump_candidates: [
        response.pump_candidates[0],
        {
          id: 'equipment-2',
          project_equipment_item_id: 'equipment-2',
          product_code: 'PM-PUMP-50-40',
          product_name: 'High-head Pump',
          design_flow_m3h: 50,
          design_head_m: 40,
          power_kw: 15,
        },
      ],
    } } as any);
    renderPanel();
    expect(await screen.findByText('SFSP — Sand Filter Supply Pump')).toBeInTheDocument();
    const selector = screen.getByLabelText('Pump product for Sand Filter Loop');
    expect(selector).toHaveDisplayValue('Select a pump from the catalogue');

    await user.type(screen.getByLabelText('Initial design head for Sand Filter Loop'), '18');

    expect(screen.getByRole('option', { name: /PM-PUMP-CIR-22.*120\.00 m³\/h.*24\.00 m head/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /PM-PUMP-50-40/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 compatible pump rated for at least 90.00 m³/h at 18.00 m.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Pump quantity for Sand Filter Loop'));
    await user.type(screen.getByLabelText('Pump quantity for Sand Filter Loop'), '2');

    expect(screen.getByRole('option', { name: /PM-PUMP-CIR-22/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /PM-PUMP-50-40/ })).toBeInTheDocument();
    expect(screen.getByText('2 compatible pumps rated for at least 45.00 m³/h at 18.00 m.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Initial design head for Sand Filter Loop'));
    await user.type(screen.getByLabelText('Initial design head for Sand Filter Loop'), '30');

    expect(screen.queryByRole('option', { name: /PM-PUMP-CIR-22/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /PM-PUMP-50-40/ })).toBeInTheDocument();
    expect(screen.getByText('1 compatible pump rated for at least 45.00 m³/h at 30.00 m.')).toBeInTheDocument();
  });

  it('saves a compatible selected pump without creating a duplicate draft item', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('SFSP — Sand Filter Supply Pump');

    await user.type(screen.getByLabelText('Initial design head for Sand Filter Loop'), '18');
    await user.type(screen.getByLabelText('Pump efficiency for Sand Filter Loop'), '76');
    await user.type(screen.getByLabelText('Motor efficiency for Sand Filter Loop'), '92');
    await user.selectOptions(screen.getByLabelText('Pump product for Sand Filter Loop'), 'equipment-1');
    await user.click(screen.getByRole('button', { name: 'Save & calculate' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/systems/system-1/pump-selections', expect.objectContaining({
      project_equipment_item_id: 'equipment-1',
      design_head_m: 18,
    })));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('creates and links a minimal draft pump immediately when no catalog product fits the duty', async () => {
    const user = userEvent.setup();
    apiPost.mockImplementation(async (url: string) => {
      if (url === '/product-masters') return { data: { id: 'new-pump-product' } } as any;
      return { data: { project_equipment_item: { id: 'created-pump' } } } as any;
    });
    renderPanel();
    await screen.findByText('SFSP — Sand Filter Supply Pump');

    await user.type(screen.getByLabelText('Initial design head for Sand Filter Loop'), '30');
    expect(screen.getByText('No linked Pump-category product is rated for at least 90.00 m³/h at 30.00 m.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a pump' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/product-masters', expect.objectContaining({
      product_code: expect.stringMatching(/^PUMP-SFSP-LOOP-1-/),
      product_name: 'Draft Sand Filter Loop',
      product_category: 'Pumping',
      design_flow_m3h: 90,
      design_head_m: 30,
      standard_status: 'Draft',
    })));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/systems/system-1/pump-lines', {
      design_book_id: 'book-1',
      circuit_key: 'loop:1',
      pump_role: 'primary',
      pump_quantity: 1,
      product_master_id: 'new-pump-product',
    }));
    expect(screen.queryByText('Create draft pump product')).not.toBeInTheDocument();
  });

  it('shows the Sand Filter supply-pump role label', async () => {
    apiGet.mockResolvedValue({ data: response } as any);
    renderPanel();

    expect(await screen.findByText('SFSP — Sand Filter Supply Pump')).toBeInTheDocument();
  });

  it('switches between card and list views with quantity visible in the list', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ data: {
      ...response,
       items: [{
         ...response.items[0],
         pump_quantity: 3,
         effective_flow_m3h: 30,
         pump_tags: ['03-SFSP-01', '03-SFSP-02', '03-SFSP-03'],
       }],
    } } as any);
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'List' }));
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument();
    expect(screen.getByText('30.00 m³/h')).toBeInTheDocument();
    expect(screen.getByText('03-SFSP-01, 03-SFSP-02, 03-SFSP-03')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit card' })).toBeInTheDocument();
  });

  it('shows every generated tag in the card when quantity changes before saving', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText('SFSP — Sand Filter Supply Pump');
    const quantity = screen.getByLabelText('Pump quantity for Sand Filter Loop');
    await user.clear(quantity);
    await user.type(quantity, '3');

    expect(screen.getByText('03-SFSP-01 · 03-SFSP-02 · 03-SFSP-03')).toBeInTheDocument();
    expect(screen.getByText('30.00 m³/h per pump')).toBeInTheDocument();
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
      pump_quantity: 1,
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