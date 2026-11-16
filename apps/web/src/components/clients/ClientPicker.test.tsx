import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientPicker from './ClientPicker';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../lib/api', () => ({ default: apiMock }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: any) => any) => selector({ user: { role: 'manager', moduleAccess: { clients: 'manage' } } }),
}));

const seaWorld = { id: 'c-1', client_code: 'CL-2026-0001', name: 'Sea World Gold Coast', country: 'Australia', city: null, kinds: ['client'], active: true, parent_name: null };

function setup(onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter><ClientPicker value={null} onChange={onChange} /></MemoryRouter></QueryClientProvider>);
  return onChange;
}

describe('ClientPicker', () => {
  beforeEach(() => {
    apiMock.get.mockReset(); apiMock.post.mockReset();
    apiMock.get.mockImplementation((url: string) => Promise.resolve({ data: url === '/clients/similar' ? { data: [] } : { data: [seaWorld], pagination: { total: 1 } } }));
  });

  it('searches the directory and returns the chosen company', async () => {
    const user = userEvent.setup();
    const onChange = setup();
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('Sea World Gold Coast'));
    expect(onChange).toHaveBeenCalledWith(seaWorld);
    expect(apiMock.get).toHaveBeenCalledWith('/clients', expect.objectContaining({ params: expect.objectContaining({ status: 'active' }) }));
  });

  it('adds a new company, and on a duplicate warning lets you use the existing one', async () => {
    const user = userEvent.setup();
    const onChange = setup();
    apiMock.post.mockRejectedValue({ response: { status: 409, data: { error: { code: 'POSSIBLE_DUPLICATE', message: 'dup', matches: [seaWorld] } } } });
    await user.type(screen.getByRole('combobox'), 'Seaworld');
    await user.click(await screen.findByText(/as a new company/));
    expect(screen.getByLabelText('Company name')).toHaveValue('Seaworld');
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    expect(await screen.findByText(/may already be in the directory/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use this one' }));
    expect(onChange).toHaveBeenCalledWith(seaWorld);
  });

  it('adds it anyway when told it is a different company', async () => {
    const user = userEvent.setup();
    const onChange = setup();
    apiMock.post
      .mockRejectedValueOnce({ response: { status: 409, data: { error: { code: 'POSSIBLE_DUPLICATE', message: 'dup', matches: [seaWorld] } } } })
      .mockResolvedValueOnce({ data: { ...seaWorld, id: 'c-2', name: 'Seaworld Abu Dhabi' } });
    await user.type(screen.getByRole('combobox'), 'Seaworld Abu Dhabi');
    await user.click(await screen.findByText(/as a new company/));
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    await user.click(await screen.findByRole('button', { name: /different company/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith('/clients', expect.objectContaining({ name: 'Seaworld Abu Dhabi', allow_duplicate: true })));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-2' }));
  });
});
