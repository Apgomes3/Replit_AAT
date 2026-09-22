import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientsList from './ClientsList';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ default: apiMock }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: any) => any) => selector({ user: { role: 'admin', moduleAccess: { business_development: 'manage' } } }),
}));

function renderClients() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ClientsList /></QueryClientProvider>);
}

describe('ClientsList organization contacts', () => {
  beforeEach(() => {
    apiMock.get.mockResolvedValue({ data: { data: [] } });
    apiMock.post.mockResolvedValue({ data: {} });
    apiMock.patch.mockResolvedValue({ data: {} });
  });

  it('allows saving a company with zero contacts', async () => {
    const user = userEvent.setup();
    renderClients();
    const opener = await screen.findByRole('button', { name: /add client/i });
    await user.click(opener);
    await user.type(screen.getByLabelText('Company name'), 'Acme');
    await user.click(screen.getByRole('button', { name: /save client/i }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/clients', expect.objectContaining({ name: 'Acme', contacts: [] })));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('adds multiple contacts and keeps only one primary', async () => {
    const user = userEvent.setup();
    renderClients();
    await user.click(await screen.findByRole('button', { name: /add client/i }));
    await user.type(screen.getByLabelText('Company name'), 'Acme');
    await user.click(screen.getByRole('button', { name: /add contact/i }));
    await user.click(screen.getByRole('button', { name: /add contact/i }));
    const names = screen.getAllByLabelText('Employee name');
    const emails = screen.getAllByLabelText('Email');
    fireEvent.change(names[0], { target: { value: 'Alex' } });
    fireEvent.change(emails[0], { target: { value: 'alex@example.com' } });
    fireEvent.change(names[1], { target: { value: 'Sam' } });
    fireEvent.change(emails[1], { target: { value: 'sam@example.com' } });
    await user.click(screen.getAllByRole('radio', { name: /primary/i })[1]);
    await user.click(screen.getByRole('button', { name: /save client/i }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/clients', expect.objectContaining({
      contacts: [
        { name: 'Alex', email: 'alex@example.com', phone: null, job_title: null },
        { name: 'Sam', email: 'sam@example.com', phone: null, job_title: null, is_primary: true },
      ],
    })));
  });

  it('names the dialog, focuses it, and closes on Escape restoring the opener', async () => {
    const user = userEvent.setup();
    renderClients();
    const opener = await screen.findByRole('button', { name: /add client/i });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Add client' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' })));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('wraps Tab and Shift+Tab at dialog boundaries', async () => {
    const user = userEvent.setup();
    renderClients();
    await user.click(await screen.findByRole('button', { name: /add client/i }));
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: /save client/i });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);
    await user.tab();
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Escape' });
  });
});