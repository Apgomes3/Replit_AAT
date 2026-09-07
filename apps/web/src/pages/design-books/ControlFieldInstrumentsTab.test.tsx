import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import ControlFieldInstrumentsTab, { getLssSystems } from './ControlFieldInstrumentsTab';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));

function LocationDisplay() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderTab() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/systems/system-1/control') {
      return Promise.resolve({ data: { control: { panel_type: 'GPO' }, definitions: [], instruments: [], products: [] } });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/design-books/book-1?tab=control']}>
        <ControlFieldInstrumentsTab
          book={{ id: 'book-1', systems: [
            { id: 'system-1', system_code: 'LSS-01', system_name: 'Main LSS', system_type: 'Life Support', water_type: 'Freshwater', status: 'Draft' },
            { id: 'system-2', system_code: 'P-01', system_name: 'Unrelated Pump', system_type: 'Pump', status: 'Draft' },
          ] }}
          readOnly={false}
          canOverrideProduct={false}
        />
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ControlFieldInstrumentsTab', () => {
  it('identifies only Life Support Systems for the Control count', () => {
    expect(getLssSystems([
      { id: 'system-1', system_type: 'Life Support' },
      { id: 'system-2', system_type: 'Pump' },
      { id: 'system-3', system_type: 'LSS Compact' },
    ])).toHaveLength(2);
  });

  it('lists LSS systems and opens the selected control workspace at a shareable URL', async () => {
    const user = userEvent.setup();
    renderTab();

    expect(screen.getByText('Main LSS')).toBeInTheDocument();
    expect(screen.queryByText('Unrelated Pump')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open control/ }));

    expect(await screen.findByRole('heading', { name: 'Control panel' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=control&system=system-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/systems/system-1/control', {
      params: { design_book_id: 'book-1' },
    });
  });
});