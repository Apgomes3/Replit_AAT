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
    post: vi.fn(),
    put: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);
const apiPut = vi.mocked(api.put);

const currentPath = '/design-books/book-1/exhibits/exhibit-1';
const book = {
  id: 'book-1',
  book_code: 'DB-001',
  book_title: 'Aquarium Design Book',
  status: 'Draft',
  project_id: 'project-1',
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
    apiPost.mockResolvedValue({ data: {} });
    apiPut.mockResolvedValue({ data: {} });
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

  it('keeps project tanks separate and creates a linked tank from the PIM library', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/design-books/')) return { data: book } as any;
      if (url === '/tank-families') {
        return {
          data: { items: [{ id: 'family-1', name: 'Main Displays', product_count: 1 }] },
        } as any;
      }
      if (url.startsWith('/product-masters?')) {
        return {
          data: {
            items: [{
              id: 'pim-tank-1',
              product_code: 'PIM-MAIN-01',
              product_name: 'PIM Main Display Tank',
              tank_family_name: 'Main Displays',
              shape_type: 'Rectangular',
              gross_volume_m3: '58.8',
            }],
          },
        } as any;
      }
      return { data: { items: [] } } as any;
    });
    const user = userEvent.setup();
    renderExhibit();

    expect(await screen.findByRole('button', { name: 'Project Tanks' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'PIM Tank Library' }));
    expect(await screen.findByText('Create a linked project tank')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /PIM-MAIN-01.*PIM Main Display Tank/i }));
    await user.click(screen.getByRole('button', { name: 'Create & Assign Linked Tank' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/tanks/from-pim', {
      project_id: 'project-1',
      exhibit_id: 'exhibit-1',
      design_book_id: 'book-1',
      product_master_id: 'pim-tank-1',
    }));
  });

  it('closes the creation panel after the first tank is created and refreshed', async () => {
    const createdTank = {
      id: 'tank-1',
      tank_code: 'TK-01',
      tank_name: 'Main Display Tank',
      exhibit_id: 'exhibit-1',
      shape_type: 'Rectangular',
      status: 'Active',
    };
    let designBookFetches = 0;
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/design-books/')) {
        designBookFetches += 1;
        return {
          data: designBookFetches === 1 ? book : { ...book, tanks: [createdTank] },
        } as any;
      }
      return { data: { items: [] } } as any;
    });
    const user = userEvent.setup();
    renderExhibit();

    await user.click(await screen.findByRole('button', { name: 'Create New Tank' }));
    await user.type(screen.getByPlaceholderText('e.g. TK-01'), 'TK-01');
    const tankName = screen.getByPlaceholderText('e.g. Main Display Tank');
    await user.clear(tankName);
    await user.type(tankName, 'Main Display Tank');
    await user.click(screen.getByRole('button', { name: 'Create & Assign Tank' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/tanks', expect.objectContaining({
      tank_code: 'TK-01',
      tank_name: 'Main Display Tank',
      project_id: 'project-1',
      exhibit_id: 'exhibit-1',
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a New Tank' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Create & Assign Tank' })).not.toBeInTheDocument();
    expect(screen.getByText('Main Display Tank')).toBeInTheDocument();
  });

  it('keeps entered tank values and shows a server error on the affected field', async () => {
    apiPost.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            code: 'DUPLICATE_TANK',
            field: 'tank_code',
            message: 'A tank with this code already exists in the project.',
          },
        },
      },
    });
    const user = userEvent.setup();
    renderExhibit();

    await user.click(await screen.findByRole('button', { name: 'Create New Tank' }));
    const tankCode = screen.getByLabelText('Tank Code *');
    const tankName = screen.getByLabelText('Tank Name *');
    await user.type(tankCode, 'TK-01');
    await user.clear(tankName);
    await user.type(tankName, 'Main Display Tank');
    await user.click(screen.getByRole('button', { name: 'Create & Assign Tank' }));

    expect(await screen.findByText('A tank with this code already exists in the project.')).toBeInTheDocument();
    expect(tankCode).toHaveValue('TK-01');
    expect(tankName).toHaveValue('Main Display Tank');
    expect(tankCode).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Create & Assign Tank' })).toBeInTheDocument();
  });

  it('does not turn inherited PIM dimensions into overrides during an unrelated edit', async () => {
    const linkedBook = {
      ...book,
      tanks: [{
        id: 'linked-tank-1',
        tank_code: 'PIM-MAIN-01',
        tank_name: 'Linked Main Tank',
        project_id: 'project-1',
        exhibit_id: 'exhibit-1',
        product_master_id: 'pim-tank-1',
        pim_product_code: 'PIM-MAIN-01',
        pim_product_name: 'PIM Main Display Tank',
        pim_tank_family_name: 'Main Displays',
        eff_tank_type: 'Display Tank',
        eff_shape: 'Rectangular',
        eff_length_mm: '6000',
        eff_width_mm: '3500',
        eff_height_mm: '2800',
        eff_water_level_mm: '2500',
        eff_primary_material: 'ACRYLIC',
        gross_volume_m3: '58.8',
        design_volume_m3: '52.5',
        shape_type: null,
        length_mm: null,
        width_mm: null,
        height_mm: null,
        design_water_level_mm: null,
        tank_type: null,
        primary_material: null,
        status: 'Active',
      }],
    };
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/design-books/')) return { data: linkedBook } as any;
      return { data: { items: [] } } as any;
    });
    const user = userEvent.setup();
    renderExhibit();

    expect(await screen.findByRole('button', { name: 'Add a New Tank' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a New Tank' }));
    expect(await screen.findByRole('button', { name: 'PIM Tank Library' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'PIM Tank Library' })).not.toBeInTheDocument();
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]);
    const tankName = screen.getByPlaceholderText('e.g. Main Display Tank');
    await user.clear(tankName);
    await user.type(tankName, 'Project Display Name');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/tanks/linked-tank-1', expect.objectContaining({
      tank_name: 'Project Display Name',
      tank_type: null,
      shape_type: null,
      primary_material: null,
      length_mm: null,
      width_mm: null,
      height_mm: null,
      design_water_level_mm: null,
    })));
  });
});