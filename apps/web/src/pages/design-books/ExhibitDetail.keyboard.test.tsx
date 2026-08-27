import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExhibitDetail from './ExhibitDetail';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);

const currentPath = '/design-books/book-1/exhibits/exhibit-1';
const book = {
  id: 'book-1',
  book_code: 'DB-001',
  book_title: 'Aquarium Design Book',
  status: 'Draft',
  exhibits: [{
    id: 'exhibit-1',
    exhibit_code: 'EX-01',
    exhibit_name: 'Main Exhibit',
    water_type: 'Freshwater',
  }],
  tanks: [],
  species: [],
  hydraulics: [],
  substrate: [],
  engineering_calculations: { exhibits: [] },
};

function LocationDisplay() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderExhibit(initialEntries = ['/design-books', currentPath]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
        <Routes>
          <Route path="/design-books/:bookId/exhibits/:exhibitId" element={<ExhibitDetail />} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExhibitDetail Escape navigation', () => {
  beforeEach(() => {
    apiGet.mockResolvedValue({ data: book });
    useAuthStore.setState({
      user: {
        id: 'engineer-1',
        email: 'engineer@example.com',
        firstName: 'Design',
        lastName: 'Engineer',
        role: 'engineer',
        moduleAccess: {},
      },
      token: 'test-token',
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('closes the Exhibit Tools menu before considering history navigation', async () => {
    const user = userEvent.setup();
    renderExhibit();

    await screen.findByRole('heading', { name: 'Main Exhibit' });
    await user.click(screen.getByRole('button', { name: 'Open exhibit tools' }));
    expect(screen.getByRole('menu', { name: 'Exhibit tools' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Exhibit tools' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(currentPath);
  });

  it('navigates back one history entry when Escape is pressed outside an editing field', async () => {
    const user = userEvent.setup();
    renderExhibit();

    await screen.findByRole('heading', { name: 'Main Exhibit' });
    const backLink = screen.getByRole('link', { name: 'Back to Design Book' });
    backLink.focus();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/design-books'));
  });

  it('keeps the current page and unsaved field value when Escape is pressed in an input', async () => {
    const user = userEvent.setup();
    renderExhibit([`${currentPath}?tab=weir`]);

    const headInput = await screen.findByPlaceholderText('e.g. 50');
    await user.type(headInput, '50');
    await user.keyboard('{Escape}');

    expect(headInput).toHaveValue(50);
    expect(screen.getByTestId('location')).toHaveTextContent(currentPath);
  });
});