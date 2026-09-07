import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import LSSOzoneCalculationPanel from './LSSOzoneCalculationPanel';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const apiGet = vi.mocked(api.get);
const apiPut = vi.mocked(api.put);

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LSSOzoneCalculationPanel bookId="book-1" systemId="system-1" readOnly={false} />
    </QueryClientProvider>,
  );
}

describe('LSS ozone calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: {
      target_concentration_mg_l: 0.05,
      display_unit: 'g/h',
      ffvp_plenum_circuit_keys: [],
      frozen: false,
      pump_lines: [
        { circuit_key: 'ff:1', circuit_name: 'Foam Fractionator', pump_duty_tag: 'FFSP', flow_m3h: 100 },
        { circuit_key: 'ff:1', circuit_name: 'Foam Fractionator', pump_duty_tag: 'FFVP', venturi_flow_m3h: 25 },
      ],
    } } as any);
    apiPut.mockResolvedValue({ data: {} } as any);
  });

  it('defaults to 0.05 mg/L, adds only selected plenum-fed FFVP flow, and converts display units', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('5 g/h')).toBeInTheDocument();
    expect(screen.getAllByText('100 m³/h')).toHaveLength(2);

    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByText('125 m³/h')).toBeInTheDocument();
    expect(screen.getByText('6.25 g/h')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'mg/h' }));
    expect(screen.getByText('6,250 mg/h')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save ozone calculation' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/systems/system-1/ozone-calculation', {
      design_book_id: 'book-1',
      target_concentration_mg_l: 0.05,
      display_unit: 'mg/h',
      ffvp_plenum_circuit_keys: ['ff:1'],
    }));
  });

  it('keeps manual concentration entry and the slider synchronized', async () => {
    const user = userEvent.setup();
    renderPanel();
    const numericInput = await screen.findByLabelText('Target ozone concentration value');
    const slider = screen.getByLabelText('Target ozone concentration');

    await user.clear(numericInput);
    await user.type(numericInput, '0.075');
    expect(slider).toHaveValue('0.075');
    expect(screen.getByText('7.5 g/h')).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '0.1' } });
    expect((numericInput as HTMLInputElement).value).toBe('0.1');
    expect(screen.getByText('10 g/h')).toBeInTheDocument();
  });

  it('renders server-selected generator evidence and its validation status', async () => {
    apiGet.mockResolvedValueOnce({ data: {
      target_concentration_mg_l: 0.05, display_unit: 'g/h', frozen: true,
      input_snapshot: { ffvp_plenum_circuit_keys: [] },
      result_snapshot: { ffsp_flow_m3h: 100, applicable_ffvp_flow_m3h: 0, ozone_required_g_h: 5 },
      allocation_snapshot: {
        product_id: 'oz-7', product_code: 'OZ-07', product_name: 'Ozone Generator',
        per_unit_capacity_g_h: 7, quantity: 1, total_installed_capacity_g_h: 7,
        required_capacity_g_h: 5, oversize_percent: 40, validation_status: 'WARNING',
      },
    } } as any);
    renderPanel();
    expect(await screen.findByText(/Automatic ozone generator selection/i)).toBeInTheDocument();
    expect(screen.getByText(/1 × OZ-07/)).toBeInTheDocument();
    expect(screen.getByText('WARNING')).toBeInTheDocument();
    expect(screen.getByText(/Oversize:/)).toHaveTextContent('40%');
  });
});