import { render, screen, waitFor } from '@testing-library/react';
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
});