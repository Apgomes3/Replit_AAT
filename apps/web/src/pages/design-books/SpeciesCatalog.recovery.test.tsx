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

  it('discovers a reviewed penguin or shark through the existing catalog picker', async () => {
    const shark = {
      ...catalogItem,
      id: 'species-shark',
      scientific_name: 'Rhincodon typus',
      common_name: 'Whale shark',
      family: 'Rhincodontidae',
      average_size_cm: 600,
      reference_average_mass_kg: 5000,
    };
    apiGet.mockResolvedValue({ data: { items: [shark], total: 1 } });

    renderWithQuery(
      <SpeciesAllocationSection
        bookId="book-1"
        exhibitId="exhibit-1"
        species={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add species' }));
    fireEvent.change(screen.getByPlaceholderText('Search scientific, common, or family name'), {
      target: { value: 'whale' },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Rhincodon typus/i }));
    expect(screen.getByText('Linked catalog reference selected')).toBeVisible();
    expect(screen.getByPlaceholderText('600')).toBeVisible();
    expect(screen.getByPlaceholderText('5000')).toBeVisible();
  });

  it('applies catalog search and family and water-type facets to the expanded records', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve({
      data: url === '/species-catalog/facets'
        ? {
            families: [
              { family: 'Carcharhinidae', count: 4 },
              { family: 'Spheniscidae', count: 19 },
            ],
            water_types: [
              { water_type: 'Brackish', count: 1 },
              { water_type: 'Marine', count: 46 },
            ],
          }
        : { items: [], total: 0 },
    }));

    renderWithQuery(<SpeciesCatalog />);

    fireEvent.change(screen.getByPlaceholderText('Search scientific name, common name, or family'), {
      target: { value: 'penguin' },
    });
    await screen.findByRole('option', { name: 'Marine (46)' });
    const [waterType, family] = await screen.findAllByRole('combobox');
    fireEvent.change(waterType, { target: { value: 'Marine' } });
    fireEvent.change(family, { target: { value: 'Spheniscidae' } });

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(
      '/species-catalog?limit=1000&q=penguin&water_type=Marine&family=Spheniscidae',
    ));
  });
});