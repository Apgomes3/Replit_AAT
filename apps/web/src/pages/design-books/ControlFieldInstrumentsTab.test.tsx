import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import ControlFieldInstrumentsTab, { getControlPanelType, getLssSystems } from './ControlFieldInstrumentsTab';

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
            { id: 'system-1', system_code: '1', system_name: 'Main LSS', system_type: 'Life Support', water_type: 'Freshwater', status: 'Draft' },
            { id: 'system-3', system_code: '2', system_name: 'Backup LSS', system_type: 'LSS Compact', water_type: 'Marine', status: 'Approved' },
            { id: 'system-2', system_code: 'P-01', system_name: 'Unrelated Pump', system_type: 'Pump', status: 'Draft' },
          ], lss_controls: [
            { system_id: 'system-1', control: { panel_type: 'GPO' } },
            { system_id: 'system-3', control: null },
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

  it('resolves configured panel types and provides an explicit fallback', () => {
    const controls = [{ system_id: 'system-1', control: { panel_type: 'plc' } }];
    expect(getControlPanelType(controls, 'system-1')).toBe('PLC');
    expect(getControlPanelType(controls, 'system-2')).toBe('Not configured');
  });

  it('shows separate system, code, panel type, and status columns without water type', () => {
    renderTab();

    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Code', 'LSS system', 'Control panel type', 'Status', '',
    ]);
    const mainRow = screen.getByText('Main LSS').closest('tr');
    const backupRow = screen.getByText('Backup LSS').closest('tr');
    expect(mainRow?.querySelectorAll('td')[0]).toHaveTextContent(/^1$/);
    expect(mainRow?.querySelectorAll('td')[1]).toHaveTextContent(/^Main LSS$/);
    expect(mainRow?.querySelectorAll('td')[2]).toHaveTextContent(/^GPO$/);
    expect(mainRow?.querySelectorAll('td')[3]).toHaveTextContent(/^Draft$/);
    expect(backupRow?.querySelectorAll('td')[0]).toHaveTextContent(/^2$/);
    expect(backupRow?.querySelectorAll('td')[1]).toHaveTextContent(/^Backup LSS$/);
    expect(backupRow?.querySelectorAll('td')[2]).toHaveTextContent(/^Not configured$/);
    expect(backupRow?.querySelectorAll('td')[3]).toHaveTextContent(/^Approved$/);
    expect(screen.queryByRole('button', { name: /Copy (1|2)/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Water type', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText('Freshwater')).not.toBeInTheDocument();
    expect(screen.queryByText('Marine')).not.toBeInTheDocument();
  });

  it('lists LSS systems and opens the selected control workspace at a shareable URL', async () => {
    const user = userEvent.setup();
    renderTab();

    expect(screen.getByText('Main LSS')).toBeInTheDocument();
    expect(screen.queryByText('Unrelated Pump')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Open control/ })[0]);

    expect(await screen.findByRole('heading', { name: 'Control panel' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=control&system=system-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/systems/system-1/control', expect.objectContaining({
      params: { design_book_id: 'book-1' },
      signal: expect.any(AbortSignal),
      timeout: 10_000,
    }));
  });

  it('defaults to list view and allows switching to cards', async () => {
    const user = userEvent.setup();
    renderTab();

    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cards' }));

    expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    expect(cards[0]).toHaveTextContent('Main LSS1Control panel typeGPO');
    expect(cards[1]).toHaveTextContent('Backup LSS2Control panel typeNot configured');
    expect(screen.queryByText('Water type', { exact: false })).not.toBeInTheDocument();
  });
});
