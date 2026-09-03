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
    delete: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);
const apiPut = vi.mocked(api.put);
const apiDelete = vi.mocked(api.delete);

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
  lights: [],
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
    apiDelete.mockResolvedValue({ data: {} });
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

    expect(headInput).toHaveValue('50');
    expect(screen.getByTestId('location')).toHaveTextContent(currentPath);
  });

  it('shows the AAT flow as a unit-aware reference without replacing the saved design target', async () => {
    apiGet.mockResolvedValue({
      data: {
        ...book,
        tanks: [{
          id: 'tank-1',
          exhibit_id: 'exhibit-1',
          eff_shape: 'Custom',
          operating_volume_m3: 24,
        }],
        hydraulics: [{
          exhibit_id: 'exhibit-1',
          target_turnover_rate: 4,
          surface_skim_pct: 30,
          bottom_drain_pct: 70,
        }],
        engineering_calculations: {
          exhibits: [{
            status: 'valid',
            calculation_version: 'aquarium-hydraulics-v1',
            calculated_at: '2026-08-28T00:00:00.000Z',
            inputs: { exhibit_id: 'exhibit-1' },
            results: {
              operating_volume_m3: 24,
              total_return_flow_m3h: 96,
              surface_skim_flow_m3h: 28.8,
              bottom_drain_flow_m3h: 67.2,
            },
            aat_reference: {
              status: 'valid',
              inputs: { effective_operating_volume_m3: 24 },
              results: {
                target_turnover_time_hours: 0.684,
                target_turnover_time_minutes: 41.04,
                recommended_turnover_rate_cycles_per_hour: 2.083,
                recommended_flow_m3h: 50,
              },
            },
            formula: 'effective operating volume × saved target turnover',
            rounding: 'flows rounded to 3 decimals',
          }],
        },
      },
    });
    const user = userEvent.setup();
    renderExhibit([`${currentPath}?tab=flow`]);

    expect(await screen.findByText('AAT Recommended Exhibit Flow')).toBeInTheDocument();
    expect(screen.getByText('Reference only')).toBeInTheDocument();
    expect(screen.getByText('50.000 m³/h')).toBeInTheDocument();
    expect(screen.getByText('833.3 L/min')).toBeInTheDocument();
    expect(screen.getByText(/does not set or replace/i)).toBeInTheDocument();
    expect(screen.getByText('4×')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'L/s' }));
    expect(screen.getByText('13.89 L/s')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const targetInput = screen.getByDisplayValue('4');
    await user.clear(targetInput);
    await user.type(targetInput, '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const savedPayload = apiPut.mock.calls[0][1] as Record<string, unknown>;
    expect(savedPayload.target_turnover_rate).toBe(5);
    expect(savedPayload).not.toHaveProperty('aat_reference');
    expect(screen.getByText('50.000 m³/h')).toBeInTheDocument();
  });

  it('shows a clear unavailable AAT state when effective volume is invalid', async () => {
    apiGet.mockResolvedValue({
      data: {
        ...book,
        engineering_calculations: {
          exhibits: [{
            status: 'invalid',
            calculation_version: 'aquarium-hydraulics-v1',
            calculated_at: '2026-08-28T00:00:00.000Z',
            inputs: { exhibit_id: 'exhibit-1' },
            results: { operating_volume_m3: 0 },
            aat_reference: {
              status: 'invalid',
              reasons: ['AAT reference is unavailable because net/effective operating volume is missing or invalid.'],
              inputs: { effective_operating_volume_m3: null },
              results: { recommended_flow_m3h: null },
            },
            reasons: ['Operating volume is missing or invalid.'],
            formula: 'effective operating volume',
            rounding: 'volumes rounded to 4 decimals',
          }],
        },
      },
    });
    renderExhibit([`${currentPath}?tab=flow`]);

    expect(await screen.findByText('AAT reference unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/net\/effective operating volume is missing or invalid/i)).toBeInTheDocument();
  });

  it.each([
    {
      label: 'stale',
      calculation: {
        status: 'valid',
        is_stale: true,
        inputs: { exhibit_id: 'exhibit-1' },
        results: { operating_volume_m3: 24 },
        aat_reference: {
          status: 'valid',
          is_stale: true,
          inputs: { effective_operating_volume_m3: 24 },
          results: { recommended_flow_m3h: 50 },
        },
      },
      expected: /calculation is stale/i,
    },
    {
      label: 'incomplete',
      calculation: {
        status: 'valid',
        is_stale: false,
        inputs: { exhibit_id: 'exhibit-1' },
        results: { operating_volume_m3: 24 },
      },
      expected: /payload is incomplete/i,
    },
  ])('does not invent an AAT result from a $label calculation payload', async ({ calculation, expected }) => {
    apiGet.mockResolvedValue({
      data: {
        ...book,
        tanks: [{
          id: 'tank-1',
          exhibit_id: 'exhibit-1',
          eff_shape: 'Custom',
          operating_volume_m3: 24,
        }],
        engineering_calculations: { exhibits: [calculation] },
      },
    });
    renderExhibit([`${currentPath}?tab=flow`]);

    expect(await screen.findByText('AAT reference unavailable.')).toBeInTheDocument();
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText('50.000 m³/h')).not.toBeInTheDocument();
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
    expect(screen.queryByLabelText('Construction Type')).not.toBeInTheDocument();
    expect(screen.getByText('Material', { selector: 'label' })).toBeInTheDocument();
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

  it('places the URL-addressable Lights tab immediately after Weir Design in both navigation surfaces', async () => {
    const user = userEvent.setup();
    renderExhibit([`${currentPath}?tab=lights`]);

    expect(await screen.findByRole('heading', { name: 'Exhibit Lighting Schedule' })).toBeInTheDocument();
    const tabButtons = screen.getAllByRole('button').filter(button =>
      ['Tank', 'Species', 'Water Flow', 'Weir Design', 'Lights'].includes(button.textContent?.trim() || ''),
    );
    expect(tabButtons.slice(-5).map(button => button.textContent?.trim())).toEqual([
      'Tank', 'Species', 'Water Flow', 'Weir Design', 'Lights',
    ]);

    await user.click(screen.getByRole('button', { name: 'Open exhibit tools' }));
    const menu = screen.getByRole('menu', { name: 'Exhibit tools' });
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent?.trim())).toEqual([
      'Back to Design Book', 'Tank', 'Species', 'Water Flow', 'Weir Design', 'Lights',
    ]);
  });

  it('adds a manual light and converts the displayed power without changing its physical load', async () => {
    const user = userEvent.setup();
    renderExhibit([`${currentPath}?tab=lights`]);

    await user.click(await screen.findByRole('button', { name: 'Add Light' }));
    await user.type(screen.getByLabelText('Light model'), 'AquaBeam 1000');
    await user.type(screen.getByLabelText('Light description'), 'Main display wash');
    await user.clear(screen.getByLabelText('Light quantity'));
    await user.type(screen.getByLabelText('Light quantity'), '2');
    await user.type(screen.getByLabelText('Power per light'), '1000');
    await user.selectOptions(screen.getByLabelText('Power unit'), 'kW');

    expect(screen.getByLabelText('Power per light')).toHaveValue(1);
    expect(screen.getByText('2 kW')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Light' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/design-books/book-1/exhibits/exhibit-1/lights',
      expect.objectContaining({
        product_master_id: null,
        model: 'AquaBeam 1000',
        description: 'Main display wash',
        lighting_type: 'LED',
        quantity: 2,
        power_value: 1,
        power_unit: 'kW',
      }),
    ));
  });

  it('prefills a PIM light from its authoritative kW electrical rating', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/design-books/book-1/lighting-products') {
        return {
          data: {
            items: [{
              id: 'light-pim-1',
              product_code: 'LT-100',
              product_name: 'Aqua LED Pendant',
              model: 'ALP-100',
              description: 'Aqua LED Pendant',
              power_kw: 0.25,
            }],
          },
        } as any;
      }
      return { data: book } as any;
    });
    const user = userEvent.setup();
    renderExhibit([`${currentPath}?tab=lights`]);

    await user.click(await screen.findByRole('button', { name: 'Add Light' }));
    await user.click(screen.getByRole('button', { name: 'PIM Product Master' }));
    await user.click(await screen.findByRole('button', { name: /ALP-100.*Aqua LED Pendant.*0.25 kW/i }));

    expect(screen.getByLabelText('Light model')).toHaveValue('ALP-100');
    expect(screen.getByLabelText('Light description')).toHaveValue('Aqua LED Pendant');
    expect(screen.getByLabelText('Power per light')).toHaveValue(0.25);
    expect(screen.getByLabelText('Power unit')).toHaveValue('kW');
    await user.click(screen.getByRole('button', { name: 'Add Light' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/design-books/book-1/exhibits/exhibit-1/lights',
      expect.objectContaining({ product_master_id: 'light-pim-1', power_value: 0.25, power_unit: 'kW' }),
    ));
  });

  it('keeps a saved PIM rating read-only while allowing display-unit conversion', async () => {
    const pimLight = {
      id: 'light-pim-1',
      exhibit_id: 'exhibit-1',
      product_master_id: 'pim-1',
      pim_product_code: 'LT-100',
      model: 'ALP-100',
      description: 'Aqua LED Pendant',
      lighting_type: 'LED',
      quantity: 1,
      power_value: 0.25,
      power_unit: 'kW',
      power_kw: 0.25,
    };
    apiGet.mockResolvedValue({ data: { ...book, lights: [pimLight] } });
    const user = userEvent.setup();
    renderExhibit([`${currentPath}?tab=lights`]);

    await user.click(await screen.findByRole('button', { name: 'Edit ALP-100' }));
    expect(screen.getByLabelText('Power per light')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Power unit'), 'W');
    expect(screen.getByLabelText('Power per light')).toHaveValue(250);
    await user.clear(screen.getByLabelText('Light quantity'));
    await user.type(screen.getByLabelText('Light quantity'), '3');
    await user.click(screen.getByRole('button', { name: 'Save Light' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/design-books/book-1/exhibits/exhibit-1/lights/light-pim-1',
      expect.objectContaining({
        product_master_id: 'pim-1',
        quantity: 3,
        power_value: 250,
        power_unit: 'W',
      }),
    ));
  });

  it('shows frozen lighting rows read-only and confirms removal in editable books', async () => {
    const light = {
      id: 'light-1',
      exhibit_id: 'exhibit-1',
      model: 'MH-400',
      description: 'Legacy feature light',
      lighting_type: 'Metal Halide',
      quantity: 2,
      power_value: 400,
      power_unit: 'W',
    };
    apiGet.mockResolvedValueOnce({ data: { ...book, status: 'Released', lights: [light] } });
    renderExhibit([`${currentPath}?tab=lights`]);

    expect(await screen.findByText('MH-400')).toBeInTheDocument();
    expect(screen.getByText('800 W')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Light' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove MH-400' })).not.toBeInTheDocument();

    apiGet.mockResolvedValueOnce({ data: { ...book, lights: [light] } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderExhibit([`${currentPath}?tab=lights`]);
    await user.click(await screen.findByRole('button', { name: 'Remove MH-400' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/design-books/book-1/exhibits/exhibit-1/lights/light-1'));
    confirm.mockRestore();
  });
});