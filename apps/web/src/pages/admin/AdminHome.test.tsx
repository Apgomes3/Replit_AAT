import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { counts: { roles: 7 }, alerts: [{ id: 'exchange-rates', message: 'Last updated 45 days ago' }] } })) },
}));
import AdminHome from './AdminHome';
import { useAuthStore } from '../../store/authStore';

const renderHome = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AdminHome /></MemoryRouter></QueryClientProvider>);

describe('AdminHome', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({
      user: { id: 'a', email: 'a@example.com', firstName: 'A', lastName: 'D', role: 'admin', moduleAccess: {} },
    });
  });

  it('groups pages by department and shows empty departments to admins', () => {
    renderHome();
    expect(screen.getByRole('region', { name: 'Engineering' })).toHaveTextContent('Pump Duty Types');
    expect(screen.getByRole('region', { name: 'Platform' })).toHaveTextContent('Users');
    expect(screen.getByRole('region', { name: 'Logistics' })).toHaveTextContent('Nothing to configure yet');
  });

  it('filters by search words, including keywords', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByLabelText('Search settings'), 'currency');
    expect(screen.getByRole('link', { name: 'Exchange Rates' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('pins a page into the Pinned card and remembers it', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHome();
    await user.click(screen.getByRole('button', { name: 'Pin Roles' }));
    expect(screen.getByRole('region', { name: 'Pinned' })).toHaveTextContent('Roles');
    unmount();
    renderHome();
    expect(screen.getByRole('region', { name: 'Pinned' })).toHaveTextContent('Roles');
  });
  it('shows record counts and warnings from the settings summary', async () => {
    renderHome();
    expect(await screen.findByTitle('7 records')).toHaveTextContent('7');
    expect(screen.getByText('Last updated 45 days ago')).toBeVisible();
  });
});
