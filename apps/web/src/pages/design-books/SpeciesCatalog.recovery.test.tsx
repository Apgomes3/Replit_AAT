import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import SpeciesAllocationSection from './SpeciesAllocationSection';
import SpeciesCatalog from './SpeciesCatalog';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);
const catalogItem = {
  id: 'species-1',
  scientific_name: 'Amphiprion ocellaris',
  common_name: 'Ocellaris clownfish',
  family: 'Pomacentridae',
  water_type: 'Marine',
  average_size_cm: 10,
  reference_average_mass_kg: 0.08,
  source: 'Reviewed reference',
  active: true,
};

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('species catalog recovery states', () => {
  beforeEach(() => {
    apiGet.mockReset();
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

  it('retries a failed full catalog request and refreshes the list and facets', async () => {
    let catalogAttempts = 0;
    apiGet.mockImplementation((url: string) => {
      if (url === '/species-catalog/facets') {
        return Promise.resolve({ data: { families: [], water_types: [] } });
      }
      catalogAttempts += 1;
      if (catalogAttempts === 1) {
        return Promise.reject({
          response: { data: { error: { message: 'Catalog database is unavailable.' } } },
        });
      }
      return Promise.resolve({ data: { items: [catalogItem], total: 1 } });
    });

    renderWithQuery(<SpeciesCatalog />);

    expect(await screen.findByText('The species catalog could not be loaded')).toBeVisible();
    expect(screen.getByText('Catalog database is unavailable.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry catalog' }));

    expect(await screen.findByText('Amphiprion ocellaris')).toBeVisible();
    expect(apiGet).toHaveBeenCalledWith('/species-catalog/facets');
    expect(catalogAttempts).toBe(2);
  });

  it('distinguishes an empty catalog from a failed request', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve({
      data: url === '/species-catalog/facets'
        ? { families: [], water_types: [] }
        : { items: [], total: 0 },
    }));

    renderWithQuery(<SpeciesCatalog />);

    expect(await screen.findByText('The catalog is empty. Add or import a reviewed species set.')).toBeVisible();
    expect(screen.queryByText('The species catalog could not be loaded')).not.toBeInTheDocument();
  });

  it('keeps custom entry available when picker lookup fails and recovers on retry', async () => {
    apiGet
      .mockRejectedValueOnce({
        response: { data: { error: { message: 'Catalog lookup timed out.' } } },
      })
      .mockResolvedValueOnce({ data: { items: [catalogItem], total: 1 } });

    renderWithQuery(
      <SpeciesAllocationSection
        bookId="book-1"
        exhibitId="exhibit-1"
        species={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add species' }));
    const search = screen.getByPlaceholderText('Search scientific, common, or family name');
    fireEvent.change(search, { target: { value: 'clown' } });

    expect(await screen.findByText('Catalog lookup timed out.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use custom species' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry catalog search' }));

    expect(await screen.findByText('Amphiprion ocellaris')).toBeVisible();
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });
});