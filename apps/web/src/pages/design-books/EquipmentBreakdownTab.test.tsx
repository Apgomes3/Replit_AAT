import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EquipmentBreakdownTab from './EquipmentBreakdownTab';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const book = { id: 'book-1', systems: [
  { id: 'system-1', system_id: 'system-1', system_type: 'LSS', system_code: 'LSS-01', system_name: 'Main Life Support' },
  { id: 'system-2', system_id: 'system-2', system_type: 'LSS', system_code: 'LSS-02', system_name: 'Quarantine Life Support' },
] };
const rows = [
  { id: 'line-1', system_id: 'system-1', source_kind: 'pump', description: 'Primary pump', quantity: 1, unit: 'EA', currency: 'USD' },
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

  it('adds a manual line and exposes refresh/export actions', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /add proposal line/i }));
    await user.type(screen.getByPlaceholderText('Description *'), 'Freight and commissioning');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.post).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/lines', expect.objectContaining({ description: 'Freight and commissioning' }));
    await user.click(screen.getByRole('button', { name: /refresh selections/i }));
    expect(api.post).toHaveBeenCalledWith('/design-books/book-1/equipment-breakdown/refresh');
    expect(screen.getByRole('button', { name: /export excel/i })).toBeVisible();
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