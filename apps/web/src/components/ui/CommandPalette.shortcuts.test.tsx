import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CommandPalette from './CommandPalette';
import { useCommandPalette } from '../../store/commandPaletteStore';
import { useAuthStore } from '../../store/authStore';
import { SEARCH_SHORTCUT } from '../../lib/shortcuts';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

function renderPalette() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CommandPalette cross-platform shortcuts', () => {
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
    // Reset palette to closed state
    useCommandPalette.setState({ isOpen: false });
  });

  it('opens the command palette with Cmd/Ctrl+K', () => {
    renderPalette();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('opens the command palette with Ctrl+K', () => {
    renderPalette();
    useCommandPalette.setState({ isOpen: false });

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('closes the palette on Escape', () => {
    useCommandPalette.setState({ isOpen: true });
    renderPalette();

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    // Escape is handled on the inner modal div; fire from the input so it bubbles up
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows Mac shortcut label in the palette footer', () => {
    useCommandPalette.setState({ isOpen: true });
    renderPalette();

    // The footer shows both Mac and Win toggle hint
    expect(screen.getByText(SEARCH_SHORTCUT.mac)).toBeInTheDocument();
  });

  it('shows Windows shortcut label in the palette footer', () => {
    useCommandPalette.setState({ isOpen: true });
    renderPalette();

    expect(screen.getByText(SEARCH_SHORTCUT.win)).toBeInTheDocument();
  });
});
