import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import HomeHub from './HomeHub';
import { useAuthStore } from '../store/authStore';
import { SEARCH_SHORTCUT } from '../lib/shortcuts';

// Suppress react-router navigate warnings in tests
vi.mock('../lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['stats'], {});
  queryClient.setQueryData(['po-summary'], { items: [], total: 0 });
  queryClient.setQueryData(['design-books-summary'], { items: [] });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomeHub />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomeHub keyboard shortcut map', () => {
  beforeEach(() => {
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

  it('renders the keyboard shortcuts button on the home page', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it('opens the shortcut map modal when the button is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));

    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it('shows both Mac and Windows labels for each platform-dependent shortcut', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));

    // Mac label
    expect(screen.getByText(SEARCH_SHORTCUT.mac)).toBeInTheDocument();
    // Win label
    expect(screen.getByText(SEARCH_SHORTCUT.win)).toBeInTheDocument();
  });

  it('closes the modal when the close button is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close keyboard shortcuts/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes the modal when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes the modal when clicking the backdrop', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click the overlay (the absolute backdrop div behind the modal)
    const backdrop = document.querySelector('.fixed.inset-0.z-50') as HTMLElement;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
