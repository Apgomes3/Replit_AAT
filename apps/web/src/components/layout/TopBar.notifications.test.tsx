import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const sampleNotification = {
  id: 'n-1',
  type: 'po_submitted' as const,
  title: 'Purchase order needs review',
  body: 'Please review this order.',
  entity_type: 'purchase_order',
  entity_id: 'po-1',
  href: '/admin/uv-engineering?revision=11111111-1111-4111-8111-111111111111',
  action_required: true,
  is_read: false,
  created_at: new Date().toISOString(),
};

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderTopBar() {
  return render(
    <MemoryRouter>
      <TopBar />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

describe('TopBar notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.mocked(api.get).mockResolvedValue({
      data: { notifications: [sampleNotification], unread_count: 1, total: 1 },
    });
    useAuthStore.setState({
      user: {
        id: 'u1',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
        moduleAccess: {},
      },
    });
  });

  it('requests the chosen filter and marks that group read', async () => {
    const user = userEvent.setup();
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await screen.findByText('Purchase order needs review');
    expect(screen.getAllByText('Action required')).toHaveLength(2);

    await user.click(screen.getByRole('tab', { name: 'Action required' }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/notifications', {
        params: { limit: 20, offset: 0, filter: 'action' },
      });
    });

    await user.click(screen.getByRole('button', { name: 'Mark filtered read' }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/notifications/read-all', { filter: 'action' });
    });
  });

  it('uses an API-provided href when opening a notification', async () => {
    const user = userEvent.setup();
    renderTopBar();
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByText('Purchase order needs review'));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/uv-engineering?revision=11111111-1111-4111-8111-111111111111'));
    expect(api.patch).toHaveBeenCalledWith('/notifications/n-1/read');
  });

  it('shows a stale/offline message when opened without a connection', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/updates are paused/i);
  });

  it('reloads the first unread page after dismissing an item', async () => {
    const user = userEvent.setup();
    renderTopBar();
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByRole('tab', { name: 'Unread' }));
    await screen.findByText('Purchase order needs review');
    await user.click(screen.getByTitle('Dismiss'));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/notifications/n-1');
      expect(api.get).toHaveBeenCalledWith('/notifications', {
        params: { limit: 20, offset: 0, filter: 'unread' },
      });
    });
  });
});