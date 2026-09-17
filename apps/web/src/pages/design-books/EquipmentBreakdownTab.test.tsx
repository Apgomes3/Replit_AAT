import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EquipmentBreakdownTab, { reorderEquipmentRows } from './EquipmentBreakdownTab';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const book = { id: 'book-1', systems: [
  { id: 'system-1', system_id: 'system-1', system_type: 'LSS', system_code: 'LSS-01', system_name: 'Main Life Support' },
  { id: 'system-2', system_id: 'system-2', system_type: 'LSS', system_code: 'LSS-02', system_name: 'Quarantine Life Support' },
] };
const rows = [
  { id: 'line-1', system_id: 'system-1', source_kind: 'pump', description: 'Primary pump', quantity: 2, unit: 'EA', unit_cost: 100, markup: 25, selling_price: 125, total_price: 250, currency: 'USD' },
  { id: 'line-2', system_id: 'system-2', source_kind: 'tank', description: 'Quarantine tank', quantity: 2, unit: 'EA', currency: 'USD' },
];

function renderTab() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <EquipmentBreakdownTab book={book} readOnly={false} />
  </QueryClientProvider>);
}

describe('EquipmentBreakdownTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: { items: rows } } as any);
    vi.mocked(api.put).mockResolvedValue({ data: {} } as any);
    vi.mocked(api.post).mockResolvedValue({ data: {} } as any);
    vi.mocked(api.delete).mockResolvedValue({ data: {} } as any);
  });

  it('renders rows grouped under every LSS system', async () => {
    renderTab();
    expect(await screen.findByText('LSS-01 — Main Life Support')).toBeVisible();
    expect(screen.getByText('LSS-02 — Quarantine Life Support')).toBeVisible();
    expect(screen.getByDisplayValue('Primary pump')).toBeVisible();
    expect(screen.getByDisplayValue('Quarantine tank')).toBeVisible();
  });

  it('allows continuous typing and saves the completed draft on blur', async () => {
    const user = userEvent.setup();
    renderTab();
    const description = await screen.findByDisplayValue('Primary pump');
    await user.clear(description);
    await user.type(description, 'Proposal pump');
    expect(description).toHaveDisplayValue('Proposal pump');
    expect(api.put).not.toHaveBeenCalled();
    await user.tab();
    expect(api.put).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/lines/line-1', { description: 'Proposal pump' });
  });

  it('shows calculated prices as read-only values and keeps incomplete values blank', async () => {
    renderTab();
    expect(await screen.findByTestId('selling_price-line-1')).toHaveTextContent('125.00');
    expect(screen.getByTestId('total_price-line-1')).toHaveTextContent('250.00');
    expect(screen.getByTestId('selling_price-line-2')).toBeEmptyDOMElement();
    expect(screen.queryByDisplayValue('125')).not.toBeInTheDocument();
  });

  it('saves cost and markup edits without sending selling price overrides', async () => {
    const user = userEvent.setup();
    renderTab();
    const cost = await screen.findByDisplayValue('100');
    await user.clear(cost);
    await user.type(cost, '120.5');
    await user.tab();
    expect(api.put).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/lines/line-1', { unit_cost: 120.5 });
  });

  it('recalculates sell and total prices while markup is being entered', async () => {
    const user = userEvent.setup();
    renderTab();
    const markup = await screen.findByDisplayValue('25');
    await user.clear(markup);
    expect(screen.getByTestId('selling_price-line-1')).toBeEmptyDOMElement();
    await user.type(markup, '50');
    expect(screen.getByTestId('selling_price-line-1')).toHaveTextContent('150.00');
    expect(screen.getByTestId('total_price-line-1')).toHaveTextContent('300.00');
  });

  it('refreshes calculated values after a cost edit', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { initialized: true, items: rows } } as any)
      .mockResolvedValue({ data: { initialized: true, items: [{ ...rows[0], unit_cost: 120, selling_price: 150, total_price: 300 }, rows[1]] } } as any);
    renderTab();
    const cost = await screen.findByDisplayValue('100');
    await user.clear(cost);
    await user.type(cost, '120');
    await user.tab();
    await waitFor(() => expect(screen.getByTestId('selling_price-line-1')).toHaveTextContent('150.00'));
    expect(screen.getByTestId('total_price-line-1')).toHaveTextContent('300.00');
  });

  it('offers only supported currencies and requests automatic conversion when currency changes', async () => {
    const user = userEvent.setup();
    renderTab();
    const currency = (await screen.findAllByRole('combobox'))[0];
    expect(currency).toHaveTextContent('USD');
    expect(currency).toHaveTextContent('RMB');
    expect(currency).toHaveTextContent('AUD');
    expect(currency).toHaveTextContent('NZD');
    expect(currency).toHaveTextContent('EUR');
    await user.selectOptions(currency, 'CNY');
    expect(api.put).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/lines/line-1', { currency: 'CNY' });
  });

  it('adds a manual line and exposes refresh/export actions', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click((await screen.findAllByRole('button', { name: /add proposal line/i }))[0]);
    await user.type(screen.getByRole('textbox', { name: 'Proposal line description' }), 'Freight and commissioning');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    expect(api.post).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/lines', expect.objectContaining({
      description: 'Freight and commissioning',
      system_id: 'system-1',
    }));
    await user.click(screen.getByRole('button', { name: /refresh selections/i }));
    expect(api.post).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/refresh');
    expect(screen.getByRole('button', { name: /export excel/i })).toBeVisible();
  });

  it('reorders a dragged line at the requested row boundary', () => {
    const ordered = reorderEquipmentRows([
      rows[0],
      { ...rows[0], id: 'line-3', description: 'Secondary pump' },
    ], 'line-1', 2);
    expect(ordered.map(row => row.id)).toEqual(['line-3', 'line-1']);
  });

  it('persists hidden columns and removes them from the view', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { initialized: true, items: rows, hidden_columns: [] } } as any)
      .mockResolvedValue({ data: { initialized: true, items: rows, hidden_columns: ['supplier'] } } as any);
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'Supplier' }));
    expect(api.put).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/columns', { hidden_columns: ['supplier'] });
    expect(await screen.findAllByRole('columnheader', { name: 'Description' })).toHaveLength(2);
    expect(screen.queryByRole('columnheader', { name: 'Supplier' })).not.toBeInTheDocument();
  });

  it('initializes once after an uninitialized read for a manager', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { initialized: false, items: [] } } as any)
      .mockResolvedValue({ data: { initialized: true, items: rows } } as any);
    renderTab();
    await screen.findByText('LSS-01 — Main Life Support');
    expect(api.post).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/refresh');
  });

  it('explains that a manager must initialize an uninitialized read-only schedule', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { initialized: false, items: [] } } as any);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EquipmentBreakdownTab book={book} readOnly />
    </QueryClientProvider>);
    expect(await screen.findByText(/manager must initialize/i)).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
  });
});