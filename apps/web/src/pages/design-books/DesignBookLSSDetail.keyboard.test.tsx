import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesignBookLSSDetail from './DesignBookLSSDetail';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);

const currentPath = '/design-books/book-1/lss/system-1';
const system = {
  id: 'system-1',
  system_code: 'LSS-01',
  system_name: 'Primary Life Support',
  system_type: 'Life Support',
  water_type: 'Freshwater',
  status: 'Draft',
  design_flow_m3h: '25',
  turnover_rate_hr: '2',
  duty_description: 'Handles the main exhibit water loop.',
  redundancy_strategy: 'N+1 pumps',
  system_config: 'bespoke',
  loop1_flow_source: 'Bottom Drain',
  loop1_filtration: 'Sand Filter',
  loop1_bio_degas_m3h: 12,
  loop1_link_bio_degas: false,
  loop2_flow_source: null,
  loop2_filtration: null,
  loop2_bio_degas_m3h: null,
  loop2_link_bio_degas: false,
  loop3_flow_source: null,
  loop3_filtration: null,
  loop3_bio_degas_m3h: null,
  loop3_link_bio_degas: false,
};

const book = {
  id: 'book-1',
  book_code: 'DB-001',
  book_title: 'Aquarium Design Book',
  status: 'Draft',
  exhibits: [],
  engineering_calculations: { systems: [], exhibits: [] },
};

function LocationDisplay() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderLSS(initialEntries = ['/design-books', currentPath]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
        <Routes>
          <Route path="/design-books/:bookId/lss/:systemId" element={<DesignBookLSSDetail />} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DesignBookLSSDetail Escape navigation', () => {
  beforeEach(() => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/systems/system-1') return Promise.resolve({ data: system });
      if (url === '/design-books/book-1') return Promise.resolve({ data: book });
      if (url === '/systems/system-1/exhibit-links') return Promise.resolve({ data: [] });
      if (url === '/lss-compact-units') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
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

  it('closes the LSS tools menu before considering history navigation', async () => {
    const user = userEvent.setup();
    renderLSS();

    await screen.findByRole('heading', { name: 'Primary Life Support' });
    await user.click(screen.getByRole('button', { name: 'Open LSS tools' }));
    expect(screen.getByRole('menu', { name: 'LSS tools' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'LSS tools' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(currentPath);
  });

  it('navigates back one history entry when Escape is pressed outside an editing field', async () => {
    const user = userEvent.setup();
    renderLSS();

    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const backLink = screen.getByRole('link', { name: 'Back to Life Support Systems' });
    backLink.focus();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/design-books'));
  });

  it('keeps the current page and unsaved values when Escape is pressed in form fields', async () => {
    const user = userEvent.setup();
    renderLSS([`${currentPath}?tab=details`]);

    await screen.findByRole('heading', { name: 'Primary Life Support' });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    const nameInput = screen.getByDisplayValue('Primary Life Support');
    await user.type(nameInput, ' revised');
    await user.keyboard('{Escape}');
    expect(nameInput).toHaveValue('Primary Life Support revised');

    const statusSelect = screen.getByDisplayValue('Draft');
    statusSelect.focus();
    await user.keyboard('{Escape}');

    const dutyTextarea = screen.getByDisplayValue('Handles the main exhibit water loop.');
    dutyTextarea.focus();
    await user.keyboard('{Escape}');

    expect(screen.getByTestId('location')).toHaveTextContent(currentPath);
    expect(nameInput).toHaveValue('Primary Life Support revised');
    expect(screen.getByDisplayValue('Draft')).toBeInTheDocument();
  });
});