import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LSSControlPanel from './LSSControlPanel';
import api from '../../lib/api';
import { exportCsv } from '../../lib/exportCsv';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../lib/exportCsv', () => ({ exportCsv: vi.fn() }));

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
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith('/products/masters', expect.anything());
  });

  it('renders compact comparison rows with row-associated detail controls', async () => {
    const user = userEvent.setup();
    renderPanel({
      control: { panel_type: 'GPO' },
      definitions: [
        { id: 'flow', name: 'Flow switch', tag_code: 'FS', signal_type: 'Digital', signal_direction: 'Input', minimum_quantity: 1 },
        { id: 'pressure', name: 'Pressure transmitter', tag_code: 'PT', signal_type: 'Analog', signal_direction: 'Input' },
      ],
      instruments: [{ definition_id: 'flow', tag: 'LSS-01-FS-01', quantity: 1 }],
    }, false);

    const table = await screen.findByRole('table', { name: 'Field instrument definitions' });
    expect(within(table).getAllByRole('rowheader').map(cell => cell.textContent))
      .toEqual(expect.arrayContaining([expect.stringContaining('Flow switch'), expect.stringContaining('Pressure transmitter')]));
    expect(within(table).getByText('Required · min 1')).toBeVisible();
    expect(within(table).getByText('LSS-01-FS-01')).toBeVisible();

    const details = screen.getByText('Control, range, calibration & datasheet details for Pressure transmitter');
    expect(details.closest('details')).not.toHaveAttribute('open');
    await user.click(details);
    expect(details.closest('details')).toHaveAttribute('open');
    expect(screen.getByLabelText('Control logic for Pressure transmitter')).toBeInTheDocument();
  });

  it('fetches and enables the product picker with PIM manage permission', async () => {
    renderPanel({
      control: { panel_type: 'GPO' },
      definitions: [{ id: 'definition-1', name: 'Flow switch', tag_code: 'FS' }],
      instruments: [],
    }, false, true);

    expect(await screen.findByLabelText('Product for Flow switch')).toBeEnabled();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/products/masters', expect.objectContaining({
      params: { limit: 1000, status: 'Active' },
      signal: expect.any(AbortSignal),
      timeout: 10_000,
    }));
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

    expect(await screen.findAllByText('Pressure transmitter')).toHaveLength(2);
    expect(screen.getAllByText('Frozen definition evidence')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /PT-100 — Historic transmitter \(Retired\) \(frozen snapshot\)/ })).toBeInTheDocument();
    expect(screen.getAllByText('Frozen product evidence')).toHaveLength(1);
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

  it('stops after one failed load and lets the user retry successfully', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ data: {
        control: { panel_type: 'PLC' },
        definitions: [],
        instruments: [],
      } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LSSControlPanel bookId="book-1" systemId="system-1" readOnly canOverrideProduct={false} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('The request took too long');
    expect(api.get).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No active field instrument definitions are available.')).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('cancels an obsolete control request when the panel unmounts', () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation((_url: string, config: any) => {
      requestSignal = config?.signal;
      return new Promise(() => undefined);
    });
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LSSControlPanel bookId="book-1" systemId="system-1" readOnly canOverrideProduct={false} />
      </QueryClientProvider>,
    );

    expect(requestSignal?.aborted).toBe(false);
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('submits only intentional range and calibration evidence overrides', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    renderPanel({
      control: { panel_type: 'GPO' },
      definitions: [{
        id: 'definition-1', name: 'Pressure transmitter', tag_code: 'PT',
        default_range_min: 0, default_range_max: 6, default_unit: 'bar',
        allow_range_override: true, default_calibration_required: true,
        default_calibration_interval_days: 365, default_calibration_procedure: 'CAL-PT-01',
        default_datasheet_reference: 'DS-PT-100', allow_calibration_override: true,
      }],
      instruments: [],
    }, false);

    await user.type(await screen.findByLabelText('Quantity for Pressure transmitter'), '1');
    await user.clear(screen.getByLabelText('Range maximum for Pressure transmitter'));
    await user.type(screen.getByLabelText('Range maximum for Pressure transmitter'), '10');
    await user.clear(screen.getByLabelText('Datasheet reference for Pressure transmitter'));
    await user.type(screen.getByLabelText('Datasheet reference for Pressure transmitter'), 'DS-PT-200');
    await user.click(screen.getByRole('button', { name: 'Save control configuration' }));

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/systems/system-1/control', {
      design_book_id: 'book-1',
      panel_type: 'GPO',
      instruments: [{
        definition_id: 'definition-1',
        quantity: 1,
        range_min: 0,
        range_max: 10,
        unit: 'bar',
        calibration_required: true,
        calibration_interval_days: 365,
        calibration_procedure: 'CAL-PT-01',
        datasheet_reference: 'DS-PT-200',
      }],
    });
  });

  it('keeps frozen historical range and unavailable datasheet evidence inspectable', async () => {
    renderPanel({
      frozen: true,
      control: { panel_type: 'PLC' },
      definitions: [],
      instruments: [{
        definition_id: 'retired-definition',
        tag: 'LSS-01-PT-01',
        range_min: '0',
        range_max: '16',
        unit: 'bar',
        calibration_required: true,
        calibration_interval_days: 180,
        calibration_procedure: 'Historical procedure unavailable',
        datasheet_reference: 'DS-OLD-404 (unavailable)',
        definition_snapshot: {
          id: 'retired-definition', name: 'Retired pressure transmitter', tag_code: 'PT',
          allow_range_override: true, allow_calibration_override: true,
        },
      }],
    });

    expect(await screen.findByDisplayValue('DS-OLD-404 (unavailable)')).toBeDisabled();
    expect(screen.getByDisplayValue('Historical procedure unavailable')).toBeDisabled();
    expect(screen.getByLabelText('Range maximum for Retired pressure transmitter')).toHaveValue(16);
    expect(screen.getByText('Frozen calibration and datasheet evidence')).toBeVisible();
  });
});

describe('LSSControlPanel I/O schedule preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups saved instances by panel and direction, ordered by direction then tag, with all review fields', async () => {
    renderPanel({
      frozen: true,
      control: { panel_type: 'PLC' },
      definitions: [],
      instruments: [
        {
          definition_id: 'output', tag: 'LSS-02-AO-02', control_logic: 'Modulate valve',
          definition_snapshot: { id: 'output', name: 'Valve actuator', signal_type: 'Analog', signal_direction: 'Output' },
          product_snapshot: { product_code: 'VA-10', product_name: 'Historic actuator', status: 'Retired' },
        },
        {
          definition_id: 'input-2', tag: 'LSS-02-PT-02', control_logic: 'Alarm high',
          definition_snapshot: { id: 'input-2', name: 'Pressure transmitter', signal_type: 'Analog', signal_direction: 'Input' },
        },
        {
          definition_id: 'input-1', tag: 'LSS-02-FS-01', control_logic: 'Stop pump',
          definition_snapshot: { id: 'input-1', name: 'Flow switch', signal_type: 'Digital', signal_direction: 'Input' },
        },
      ],
    });

    expect(await screen.findByRole('heading', { name: 'PLC panel · Input signals' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'PLC panel · Output signals' })).toBeVisible();
    const inputTable = screen.getByRole('table', { name: 'PLC Input I/O schedule' });
    expect(within(inputTable).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[0].textContent))
      .toEqual(['LSS-02-FS-01', 'LSS-02-PT-02']);
    const outputRow = within(screen.getByRole('table', { name: 'PLC Output I/O schedule' })).getAllByRole('row')[1];
    expect(within(outputRow).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['LSS-02-AO-02', 'Valve actuator', 'Analog', 'Output', 'VA-10 — Historic actuator (Retired)', 'Modulate valve']);
    expect(screen.getAllByText('Frozen definition evidence')).toHaveLength(3);
  });

  it('exports the saved schedule as CSV and requests its PDF with the design book', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:io-schedule');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/systems/system-1/control') return Promise.resolve({ data: {
        control: { panel_type: 'GPO' },
        definitions: [{ id: 'flow', name: 'Flow switch', signal_type: 'Digital', signal_direction: 'Input' }],
        instruments: [{ definition_id: 'flow', tag: '=FS-01', control_logic: '@Stop' }],
      } });
      if (url === '/systems/system-1/control/io-schedule.pdf') return Promise.resolve({ data: new Blob(['pdf']) });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LSSControlPanel bookId="book-1" systemId="system-1" readOnly canOverrideProduct={false} />
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText('=FS-01')).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(exportCsv).toHaveBeenCalledWith('io-schedule-system-1.csv', expect.arrayContaining([
      expect.objectContaining({ header: 'Tag' }),
      expect.objectContaining({ header: 'Saved control logic' }),
    ]), [expect.objectContaining({ tag: '=FS-01', controlLogic: '@Stop' })]);

    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/systems/system-1/control/io-schedule.pdf', {
      params: { design_book_id: 'book-1' },
      responseType: 'blob',
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:io-schedule');
    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});