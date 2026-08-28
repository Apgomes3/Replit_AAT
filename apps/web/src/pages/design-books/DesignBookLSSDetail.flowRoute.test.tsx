import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesignBookLSSDetail from './DesignBookLSSDetail';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);
const apiPut = vi.mocked(api.put);

const baseSystem = {
  id: 'system-1',
  system_code: 'LSS-01',
  system_name: 'Primary Life Support',
  system_type: 'Life Support',
  water_type: 'Freshwater',
  status: 'Draft',
  design_flow_m3h: '100',
  turnover_rate_hr: '2',
  duty_description: 'Handles the main exhibit water loop.',
  redundancy_strategy: 'N+1 pumps',
  system_config: 'bespoke',
  compact_unit_id: null,
  loop1_flow_source: 'Bottom Drain',
  loop1_filtration: 'Sand Filter',
  loop1_flow_pct: 40,
  loop1_bio_degas_pct: 25,
  loop1_bio_degas_m3h: 12,
  loop1_link_bio_degas: false,
  loop2_flow_source: null,
  loop2_filtration: null,
  loop2_flow_pct: null,
  loop2_bio_degas_pct: null,
  loop2_bio_degas_m3h: null,
  loop2_link_bio_degas: false,
  loop3_flow_source: null,
  loop3_filtration: null,
  loop3_flow_pct: null,
  loop3_bio_degas_pct: null,
  loop3_bio_degas_m3h: null,
  loop3_link_bio_degas: false,
  side_streams: [],
};

const baseBook = {
  id: 'book-1',
  book_code: 'DB-001',
  book_title: 'Aquarium Design Book',
  status: 'Draft',
  exhibits: [],
  engineering_calculations: {
    systems: [{
      status: 'override',
      inputs: {
        system_id: 'system-1',
        design_flow_source: 'manual_override',
        turnover_source: 'manual_override',
      },
      results: {
        calculated_required_flow_m3h: null,
        design_flow_m3h: 100,
        turnover_rate_cycles_per_hour: 2,
      },
      flow_route: {
        loops: [{
          loop_number: 1,
          allocation_pct: 40,
          flow_m3h: 40,
        }],
      },
    }],
    exhibits: [],
  },
};

const primaryLink = {
  id: 'link-1',
  system_id: 'system-1',
  exhibit_id: 'exhibit-1',
  exhibit_code: 'EX-01',
  link_type: 'Primary',
};

const primaryExhibitCalculation = {
  status: 'valid',
  inputs: {
    exhibit_id: 'exhibit-1',
    surface_skim_pct: 36,
    bottom_drain_pct: 64,
  },
  results: {
    total_return_flow_m3h: 125,
    surface_skim_flow_m3h: 45,
    bottom_drain_flow_m3h: 80,
  },
};

const bookWithPrimarySplit = {
  ...baseBook,
  engineering_calculations: {
    systems: baseBook.engineering_calculations.systems,
    exhibits: [primaryExhibitCalculation],
  },
};

function renderFlowRoute(
  system: any = baseSystem,
  book: any = baseBook,
  links: any[] = [],
  fractionatorProducts: any[] = [],
) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/systems/system-1') return Promise.resolve({ data: system });
    if (url === '/design-books/book-1') return Promise.resolve({ data: book });
    if (url === '/systems/system-1/exhibit-links') return Promise.resolve({ data: links });
    if (url === '/systems/system-1/fractionator-products') {
      return Promise.resolve({ data: { items: fractionatorProducts } });
    }
    if (url === '/lss-compact-units') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/design-books/book-1/lss/system-1']}>
        <Routes>
          <Route path="/design-books/:bookId/lss/:systemId" element={<DesignBookLSSDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

describe('DesignBookLSSDetail Flow Route allocations', () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it('uses the fresh linked aggregate for the card and Flow Route after updates and reloads', async () => {
    const linkedCalculation = (flow: number) => ({
      status: 'valid',
      freshness: 'fresh',
      is_stale: false,
      inputs: {
        system_id: 'system-1',
        design_flow_source: 'linked_exhibits',
        turnover_source: 'primary_exhibit',
      },
      results: {
        calculated_required_flow_m3h: flow,
        design_flow_m3h: flow,
        turnover_rate_cycles_per_hour: 2,
      },
    });
    const linkedBook = (flow: number) => ({
      ...bookWithPrimarySplit,
      engineering_calculations: {
        ...bookWithPrimarySplit.engineering_calculations,
        systems: [linkedCalculation(flow)],
      },
    });
    const staleStoredSystem = { ...baseSystem, design_flow_m3h: '350' };
    const rendered = renderFlowRoute(staleStoredSystem, linkedBook(320), [primaryLink]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    expect(screen.getAllByText('320.0 m³/h').length).toBeGreaterThan(0);
    expect(document.querySelector('#flow-route')).toHaveTextContent('128.0 m³/h');
    expect(screen.queryByText('350.0 m³/h')).not.toBeInTheDocument();

    act(() => {
      rendered.queryClient.setQueryData(['design-book', 'book-1'], linkedBook(300));
    });
    await waitFor(() => expect(screen.getAllByText('300.0 m³/h').length).toBeGreaterThan(0));
    expect(document.querySelector('#flow-route')).toHaveTextContent('120.0 m³/h');

    rendered.unmount();
    renderFlowRoute(staleStoredSystem, linkedBook(320), [primaryLink]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    expect(screen.getAllByText('320.0 m³/h').length).toBeGreaterThan(0);
    expect(screen.queryByText('350.0 m³/h')).not.toBeInTheDocument();
  });

  it('shows linked design flow as unavailable instead of falling back to persisted data', async () => {
    renderFlowRoute(
      { ...baseSystem, design_flow_m3h: '350' },
      {
        ...baseBook,
        engineering_calculations: { systems: [], exhibits: [] },
      },
      [],
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText('Synced from linked exhibits')).toBeInTheDocument();
    expect(screen.queryByText('350.0 m³/h')).not.toBeInTheDocument();
    expect(document.querySelector('#flow-route')).not.toHaveTextContent('140.0 m³/h');
  });

  it('retains a persisted design flow only for an explicit manual override', async () => {
    renderFlowRoute();
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    expect(screen.getAllByText('100.0 m³/h').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Manual override').length).toBeGreaterThan(0);
    expect(document.querySelector('#flow-route')).toHaveTextContent('40.0 m³/h');
  });

  it('keeps loop flow visible while hiding Bio/Degas details when the branch is not linked', async () => {
    const user = userEvent.setup();
    renderFlowRoute();
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('Bottom Drain')).toBeInTheDocument();
    expect(route.getByText('Sand Filter')).toBeInTheDocument();
    expect(route.getAllByText('40.0 m³/h').length).toBeGreaterThan(0);
    expect(document.querySelector('#flow-route')).toHaveTextContent('40% of system');
    expect(route.queryByText('Bio/Degas:')).not.toBeInTheDocument();
    expect(route.getByText('60.0%')).toBeInTheDocument();

    await user.click(route.getByRole('button', { name: 'L/s' }));
    expect(route.getAllByText('11.1 L/s').length).toBeGreaterThan(0);
    await user.click(route.getByRole('button', { name: 'US GPM' }));
    expect(route.getAllByText('176.1 US GPM').length).toBeGreaterThan(0);
    await user.click(route.getByRole('button', { name: 'Imperial GPM' }));
    expect(route.getAllByText('146.6 Imperial GPM').length).toBeGreaterThan(0);
  });

  it('shows the primary exhibit source split without changing the loop allocation', async () => {
    const user = userEvent.setup();
    renderFlowRoute(baseSystem, bookWithPrimarySplit, [primaryLink]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('Read-only · from linked exhibit')).toBeInTheDocument();
    expect(route.getByText('EX-01')).toBeInTheDocument();
    expect(route.getByText('64% · 80.0 m³/h')).toBeInTheDocument();
    expect(route.getByText(/loop allocation remains an independent percentage/)).toBeInTheDocument();

    await user.click(route.getByRole('button', { name: 'Edit' }));
    await user.click(route.getByRole('button', { name: 'Surface Skim' }));
    expect(route.getByText('(Surface Skimmer Box)')).toBeInTheDocument();
    expect(route.getByText('36% · 45.0 m³/h')).toBeInTheDocument();
    expect(route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' })).toHaveValue(40);

    await user.click(route.getByRole('button', { name: 'L/s' }));
    expect(route.getByText('36% · 12.5 L/s')).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'US GPM' }));
    expect(route.getByText('36% · 198.1 US GPM')).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'Imperial GPM' }));
    expect(route.getByText('36% · 165.0 Imperial GPM')).toBeInTheDocument();

    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        loop1_flow_source: 'Surface Skim',
        loop1_flow_pct: 40,
        loop1_bio_degas_pct: 25,
      }),
    ));
  });

  it('shows both exhibit components and their combined return flow', async () => {
    renderFlowRoute(
      { ...baseSystem, loop1_flow_source: 'Both Integrated' },
      bookWithPrimarySplit,
      [primaryLink],
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('36% · 45.0 m³/h')).toBeInTheDocument();
    expect(route.getByText('64% · 80.0 m³/h')).toBeInTheDocument();
    expect(route.getByText('Combined exhibit return flow')).toBeInTheDocument();
    expect(route.getByText('125.0 m³/h')).toBeInTheDocument();
  });

  it('does not use a secondary exhibit as an authoritative source reference', async () => {
    renderFlowRoute(baseSystem, bookWithPrimarySplit, [{
      ...primaryLink,
      link_type: 'Secondary',
    }]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText(/Exhibit split unavailable: No primary linked exhibit is configured/)).toBeInTheDocument();
    expect(route.queryByText('64% · 80.0 m³/h')).not.toBeInTheDocument();
  });

  it('shows an unavailable state when multiple primary exhibit links are configured', async () => {
    renderFlowRoute(baseSystem, bookWithPrimarySplit, [
      primaryLink,
      {
        ...primaryLink,
        id: 'link-2',
        exhibit_id: 'exhibit-2',
        exhibit_code: 'EX-02',
      },
    ]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText(/Exhibit split unavailable: Multiple primary linked exhibits are configured/)).toBeInTheDocument();
    expect(route.queryByText('64% · 80.0 m³/h')).not.toBeInTheDocument();
  });

  it('clears the old source reference when the primary exhibit link changes', async () => {
    const { queryClient } = renderFlowRoute(baseSystem, bookWithPrimarySplit, [primaryLink]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);
    expect(route.getByText('64% · 80.0 m³/h')).toBeInTheDocument();

    const replacementLink = {
      ...primaryLink,
      id: 'link-2',
      exhibit_id: 'exhibit-2',
      exhibit_code: 'EX-02',
    };
    const replacementBook = {
      ...bookWithPrimarySplit,
      engineering_calculations: {
        systems: [],
        exhibits: [{
          status: 'valid',
          inputs: {
            exhibit_id: 'exhibit-2',
            surface_skim_pct: 50,
            bottom_drain_pct: 50,
          },
          results: {
            total_return_flow_m3h: 100,
            surface_skim_flow_m3h: 50,
            bottom_drain_flow_m3h: 50,
          },
        }],
      },
    };
    act(() => {
      queryClient.setQueryData(['system-exhibit-links', 'system-1'], [replacementLink]);
      queryClient.setQueryData(['design-book', 'book-1'], replacementBook);
    });

    await waitFor(() => expect(route.getByText('EX-02')).toBeInTheDocument());
    expect(route.getByText('50% · 50.0 m³/h')).toBeInTheDocument();
    expect(route.queryByText('64% · 80.0 m³/h')).not.toBeInTheDocument();
  });

  it('shows an unavailable state for an invalid primary exhibit calculation', async () => {
    renderFlowRoute(baseSystem, {
      ...bookWithPrimarySplit,
      engineering_calculations: {
        systems: [],
        exhibits: [{ ...primaryExhibitCalculation, status: 'invalid' }],
      },
    }, [primaryLink]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText(/Exhibit split unavailable: The primary exhibit has no usable hydraulic split calculation/)).toBeInTheDocument();
    expect(route.queryByText('64% · 80.0 m³/h')).not.toBeInTheDocument();
  });

  it('resolves the primary exhibit code from a frozen review package', async () => {
    const frozenLink = {
      id: primaryLink.id,
      system_id: primaryLink.system_id,
      exhibit_id: primaryLink.exhibit_id,
      link_type: primaryLink.link_type,
    };
    renderFlowRoute(baseSystem, {
      ...bookWithPrimarySplit,
      status: 'For Review',
      systems: [baseSystem],
      system_links: [frozenLink],
      exhibits: [{
        id: 'exhibit-1',
        exhibit_code: 'EX-01',
        exhibit_name: 'Main Exhibit',
      }],
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('EX-01')).toBeInTheDocument();
    expect(route.getByText('64% · 80.0 m³/h')).toBeInTheDocument();
    expect(route.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('does not present a stale calculation as the current exhibit split', async () => {
    renderFlowRoute(baseSystem, {
      ...bookWithPrimarySplit,
      engineering_calculations: {
        systems: [],
        exhibits: [{
          ...primaryExhibitCalculation,
          is_stale: true,
          freshness: 'stale',
        }],
      },
    }, [primaryLink]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText(/Exhibit split unavailable: The primary exhibit has no usable hydraulic split calculation/)).toBeInTheDocument();
    expect(route.queryByText('64% · 80.0 m³/h')).not.toBeInTheDocument();
  });

  it('edits total-loop and linked branch percentages independently and saves canonical values', async () => {
    const user = userEvent.setup();
    renderFlowRoute();
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    const loopInput = route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' });
    await user.clear(loopInput);
    await user.type(loopInput, '60');
    await user.click(route.getByRole('checkbox', { name: 'Link SF Loop to Bio/Degas' }));
    const branchInput = route.getByRole('spinbutton', { name: 'Loop 1 Bio/Degas allocation percentage' });
    await user.clear(branchInput);
    await user.type(branchInput, '25');

    expect(document.querySelector('#flow-route')).toHaveTextContent('60.0 m³/h');
    expect(document.querySelector('#flow-route')).toHaveTextContent('15.0 m³/h');
    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        design_flow_m3h: '100',
        loop1_flow_pct: 60,
        loop1_bio_degas_pct: 25,
        loop1_bio_degas_m3h: 12,
        loop1_link_bio_degas: true,
        loop2_flow_pct: null,
        loop2_bio_degas_pct: null,
      }),
    ));
  });

  it('blocks active-loop allocations above 100 percent without normalizing them', async () => {
    const user = userEvent.setup();
    renderFlowRoute({
      ...baseSystem,
      loop1_flow_pct: 60,
      loop2_flow_source: 'Surface Skim',
      loop2_filtration: 'Pressurized Bag Filter',
      loop2_flow_pct: 50,
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText(/Active loop allocations total 110.0%/)).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'Edit' }));
    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('preserves allocation drafts while switching to list editing and saves the row', async () => {
    const user = userEvent.setup();
    renderFlowRoute({ ...baseSystem, loop1_link_bio_degas: true });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    const cardInput = route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' });
    await user.clear(cardInput);
    await user.type(cardInput, '55');
    await user.click(route.getByRole('button', { name: 'List' }));
    await user.click(route.getByRole('button', { name: 'Edit' }));

    const listInput = route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' });
    expect(listInput).toHaveValue(55);
    const branchInput = route.getByRole('spinbutton', { name: 'Loop 1 Bio/Degas allocation percentage' });
    await user.clear(branchInput);
    await user.type(branchInput, '30');
    await user.click(route.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        loop1_flow_pct: 55,
        loop1_bio_degas_pct: 30,
        loop1_link_bio_degas: true,
      }),
    ));
  });

  it('keeps nullable legacy allocations editable and restores them on cancel', async () => {
    const user = userEvent.setup();
    renderFlowRoute({
      ...baseSystem,
      loop1_flow_pct: null,
      loop1_bio_degas_pct: null,
      loop1_link_bio_degas: true,
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getAllByText(/allocation not reviewed/).length).toBeGreaterThan(0);
    expect(route.getByText('12.0 m³/h')).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'Edit' }));
    const loopInput = route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' });
    expect(loopInput).toHaveValue(null);
    await user.type(loopInput, '70');
    await user.click(route.getByRole('button', { name: 'Cancel' }));

    expect(route.getAllByText(/allocation not reviewed/).length).toBeGreaterThan(0);
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('allows nullable allocations to remain blank when saving a draft', async () => {
    const user = userEvent.setup();
    renderFlowRoute({
      ...baseSystem,
      loop1_flow_pct: null,
      loop1_bio_degas_pct: null,
      loop1_link_bio_degas: true,
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        loop1_flow_pct: null,
        loop1_bio_degas_pct: null,
        loop1_link_bio_degas: true,
      }),
    ));
  });

  it('labels reviewed zero allocations as intentional instead of unreviewed', async () => {
    renderFlowRoute({
      ...baseSystem,
      loop1_flow_pct: 0,
      loop1_bio_degas_pct: 0,
      loop1_link_bio_degas: true,
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getAllByText(/0% \(intentional zero allocation\)/)).toHaveLength(2);
    expect(route.queryByText('allocation not reviewed')).not.toBeInTheDocument();
  });

  it('shows separate nullable allocation warnings from the frozen review package', async () => {
    const reviewBook = {
      ...baseBook,
      status: 'For Review',
      systems: [{
        ...baseSystem,
        loop1_flow_pct: null,
        loop1_bio_degas_pct: null,
        loop1_link_bio_degas: true,
      }],
      system_links: [],
    };

    renderFlowRoute(baseSystem, reviewBook);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText(/configured loop has an unreviewed total-flow percentage/)).toBeInTheDocument();
    expect(route.getByText(/linked Bio\/Degas branch has an unreviewed branch percentage/)).toBeInTheDocument();
    expect(route.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('renders frozen released allocations read-only', async () => {
    const releasedBook = {
      ...baseBook,
      status: 'Released',
      systems: [{ ...baseSystem, loop1_link_bio_degas: true }],
      system_links: [],
    };
    renderFlowRoute(baseSystem, releasedBook);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('Bio/Degas:')).toBeInTheDocument();
    expect(route.getByText(/25% of loop/)).toBeInTheDocument();
    expect(route.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('renames a main loop and saves preset and custom side-stream details together', async () => {
    const user = userEvent.setup();
    renderFlowRoute(baseSystem);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit Loop 1 name' }));
    const loopName = route.getByRole('textbox', { name: 'Loop 1 name' });
    await user.clear(loopName);
    await user.type(loopName, 'Main Filtration');
    await user.click(route.getByRole('button', { name: 'Save Loop 1 name' }));
    await user.click(route.getByRole('button', { name: /Thermal/ }));
    await user.type(route.getByRole('spinbutton', { name: 'Thermal side stream percentage' }), '25');
    await user.type(route.getByRole('textbox', { name: 'Thermal side stream notes' }), 'Heat exchanger branch');
    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        loop1_name: 'Main Filtration',
        side_streams: [
          expect.objectContaining({
            parent_loop_number: 1,
            name: 'Thermal',
            preset: 'Thermal',
            flow_pct: 25,
            notes: 'Heat exchanger branch',
          }),
        ],
      }),
    ));
  });

  it('cancels an inline rename without changing the Flow Route draft', async () => {
    const user = userEvent.setup();
    renderFlowRoute({ ...baseSystem, loop1_name: 'Main Filtration' });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit Main Filtration name' }));
    const loopName = route.getByRole('textbox', { name: 'Loop 1 name' });
    await user.clear(loopName);
    await user.type(loopName, 'Temporary Name');
    await user.click(route.getByRole('button', { name: 'Cancel Loop 1 name' }));

    expect(route.getByRole('button', { name: 'Edit Main Filtration name' })).toBeInTheDocument();
    expect(route.queryByText('Temporary Name')).not.toBeInTheDocument();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('supports keyboard save and cancel while renaming a loop inline', async () => {
    const user = userEvent.setup();
    renderFlowRoute({ ...baseSystem, loop1_name: 'Main Filtration' });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit Main Filtration name' }));
    let loopName = route.getByRole('textbox', { name: 'Loop 1 name' });
    await user.clear(loopName);
    await user.type(loopName, 'Temporary Name{Escape}');
    expect(route.getByRole('button', { name: 'Edit Main Filtration name' })).toBeInTheDocument();

    await user.click(route.getByRole('button', { name: 'Edit Main Filtration name' }));
    loopName = route.getByRole('textbox', { name: 'Loop 1 name' });
    await user.clear(loopName);
    await user.type(loopName, 'Primary Treatment{Enter}');
    expect(route.getByRole('button', { name: 'Edit Primary Treatment name' })).toBeInTheDocument();

    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({ loop1_name: 'Primary Treatment' }),
    ));
  });

  it('persists a list-view rename without replacing other loop or side-stream data', async () => {
    const user = userEvent.setup();
    renderFlowRoute({
      ...baseSystem,
      loop1_name: 'Main Filtration',
      loop2_name: 'Polishing',
      loop2_flow_source: 'Surface Skim',
      loop2_filtration: 'Pressurized Bag Filter',
      loop2_flow_pct: 35,
      side_streams: [{
        id: 'side-1',
        parent_loop_number: 1,
        name: 'UV Contact',
        preset: 'UV',
        flow_pct: 100,
        notes: null,
        sort_order: 0,
      }],
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'List' }));
    const polishingRow = route.getByText('Polishing').closest('tr')!;
    await user.click(within(polishingRow).getByRole('button', { name: /Edit/ }));
    const loopName = route.getByRole('textbox', { name: 'Loop 2 name' });
    await user.clear(loopName);
    await user.type(loopName, 'Secondary Polishing');
    await user.click(within(loopName.closest('tr')!).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        loop1_name: 'Main Filtration',
        loop2_name: 'Secondary Polishing',
        loop2_flow_source: 'Surface Skim',
        loop2_filtration: 'Pressurized Bag Filter',
        loop2_flow_pct: 35,
        side_streams: [expect.objectContaining({
          id: 'side-1',
          parent_loop_number: 1,
          name: 'UV Contact',
          flow_pct: 100,
        })],
      }),
    ));
  });

  it('saves multiple side streams at 100 percent because each is an independent branch', async () => {
    const user = userEvent.setup();
    renderFlowRoute(baseSystem);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    await user.click(route.getByRole('button', { name: /Thermal/ }));
    await user.type(route.getByRole('spinbutton', { name: 'Thermal side stream percentage' }), '100');
    await user.click(route.getByRole('button', { name: /UV/ }));
    await user.type(route.getByRole('spinbutton', { name: 'UV side stream percentage' }), '100');
    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        side_streams: [
          expect.objectContaining({ name: 'Thermal', flow_pct: 100 }),
          expect.objectContaining({ name: 'UV', flow_pct: 100 }),
        ],
      }),
    ));
  });

  it('keeps a saved rename and side stream visible after reload and when editing resumes', async () => {
    const user = userEvent.setup();
    const firstRender = renderFlowRoute(baseSystem);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    let route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit Loop 1 name' }));
    const loopName = route.getByRole('textbox', { name: 'Loop 1 name' });
    await user.clear(loopName);
    await user.type(loopName, 'Main Filtration');
    await user.click(route.getByRole('button', { name: 'Save Loop 1 name' }));
    await user.click(route.getByRole('button', { name: /Thermal/ }));
    await user.type(route.getByRole('spinbutton', { name: 'Thermal side stream percentage' }), '100');
    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));

    const savedPayload = await waitFor(() => {
      const call = apiPut.mock.calls.find(([url]) => url === '/systems/system-1');
      expect(call).toBeDefined();
      return call![1] as any;
    });
    const reloadedSystem = {
      ...baseSystem,
      ...savedPayload,
      side_streams: savedPayload.side_streams.map((stream: any, index: number) => ({
        ...stream,
        id: `saved-side-${index + 1}`,
      })),
    };

    firstRender.unmount();
    renderFlowRoute(reloadedSystem);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    route = within(document.querySelector('#flow-route')!);
    expect(route.getByRole('button', { name: 'Edit Main Filtration name' })).toBeInTheDocument();
    expect(route.getByText('Thermal')).toBeInTheDocument();
    expect(route.getByText('100% of parent')).toBeInTheDocument();
    expect(route.getAllByText('40.0 m³/h').length).toBeGreaterThan(0);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    expect(route.getByRole('spinbutton', { name: 'Thermal side stream percentage' })).toHaveValue(100);
  });

  it('shows side streams nested in card and list views and follows unit conversion', async () => {
    const user = userEvent.setup();
    renderFlowRoute({
      ...baseSystem,
      loop1_name: 'Main Filtration',
      side_streams: [{
        id: 'side-1',
        parent_loop_number: 1,
        name: 'UV Contact',
        preset: 'UV',
        flow_pct: 50,
        notes: 'Duty UV branch',
        sort_order: 0,
      }],
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('Main Filtration')).toBeInTheDocument();
    expect(route.getByText('UV Contact')).toBeInTheDocument();
    expect(route.getByText('20.0 m³/h')).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'L/s' }));
    expect(route.getByText('5.6 L/s')).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'US GPM' }));
    expect(route.getByText('88.1 US GPM')).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'Imperial GPM' }));
    expect(route.getByText('73.3 Imperial GPM')).toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'List' }));
    expect(route.getByText('↳ UV Contact')).toBeInTheDocument();
    expect(route.getByText(/50% of parent · 73.3 Imperial GPM/)).toBeInTheDocument();
  });

  it('keeps the percentage visible when the parent loop flow is unavailable', async () => {
    renderFlowRoute({
      ...baseSystem,
      loop1_flow_pct: null,
      side_streams: [{
        id: 'side-1',
        parent_loop_number: 1,
        name: 'Thermal',
        preset: 'Thermal',
        flow_pct: 30,
        notes: null,
        sort_order: 0,
      }],
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('30% of parent')).toBeInTheDocument();
    expect(route.getByText('Unavailable')).toBeInTheDocument();
    expect(route.getByText(/Set the parent loop allocation/)).toBeInTheDocument();
  });

  it('uses the canonical calculated system flow when no saved design-flow override exists', async () => {
    renderFlowRoute(
      {
        ...baseSystem,
        design_flow_m3h: null,
        loop1_flow_pct: 50,
        side_streams: [{
          id: 'side-1',
          parent_loop_number: 1,
          name: 'Thermal',
          preset: 'Thermal',
          flow_pct: 50,
          notes: null,
          sort_order: 0,
        }],
      },
      {
        ...baseBook,
        engineering_calculations: {
          exhibits: [],
          systems: [{
            inputs: { system_id: 'system-1' },
            results: { design_flow_m3h: 80 },
          }],
        },
      },
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.getByText('20.0 m³/h')).toBeInTheDocument();
    expect(route.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('refreshes the displayed system flow when the design-book calculation changes', async () => {
    const { queryClient, unmount } = renderFlowRoute(
      { ...baseSystem, design_flow_m3h: null },
      {
        ...baseBook,
        engineering_calculations: {
          exhibits: [],
          systems: [{
            inputs: {
              system_id: 'system-1',
              design_flow_source: 'linked_exhibits',
              turnover_source: 'primary_exhibit',
            },
            results: {
              calculated_required_flow_m3h: 80,
              design_flow_m3h: 80,
              turnover_rate_cycles_per_hour: 2,
            },
          }],
        },
      },
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    expect(screen.getByText('80.0 m³/h')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(['design-book', 'book-1'], {
        ...baseBook,
        engineering_calculations: {
          exhibits: [],
          systems: [{
            inputs: {
              system_id: 'system-1',
              design_flow_source: 'linked_exhibits',
              turnover_source: 'primary_exhibit',
            },
            results: {
              calculated_required_flow_m3h: 125,
              design_flow_m3h: 125,
              turnover_rate_cycles_per_hour: 2.5,
            },
          }],
        },
      });
    });

    await waitFor(() => expect(screen.getByText('125.0 m³/h')).toBeInTheDocument());
    expect(screen.getAllByText('2.5 ×/h').length).toBeGreaterThan(0);
    unmount();
  });

  it('synchronizes fractionator rate controls and only applies sizing when requested', async () => {
    const user = userEvent.setup();
    const product = {
      id: 'ff-500',
      product_code: 'FF-500',
      product_name: 'Foam Fractionator 500',
      diameter_mm: 500,
    };
    renderFlowRoute({
      ...baseSystem,
      water_type: 'Marine',
      loop1_filtration: 'Foam Fractionation',
      fractionator_allocations: [{
        parent_loop_number: 1,
        process_rate_ls_m2: 19,
        notes: null,
        products: [{
          product_master_id: 'ff-500',
          product_code: 'FF-500',
          product_name: 'Foam Fractionator 500',
          diameter_mm: 500,
          quantity: 1,
        }],
      }],
    }, baseBook, [], [product]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    const slider = route.getByRole('slider', { name: 'AAT process rate slider for Loop 1' });
    const rateInput = route.getByRole('spinbutton', { name: 'AAT process rate for Loop 1' });

    expect(slider).toHaveValue('19');
    expect(rateInput).toHaveValue(19);
    expect(route.getByText('Suggested standalone quantity')).toBeInTheDocument();
    expect(route.getByText('3 units')).toBeInTheDocument();
    expect(rateInput).toHaveValue(19);

    fireEvent.change(rateInput, { target: { value: '24' } });
    await waitFor(() => expect(
      route.getByRole('slider', { name: 'AAT process rate slider for Loop 1' }),
    ).toHaveValue('24'));
    expect(route.getByText(/outside it are allowed with an advisory/)).toBeInTheDocument();

    await user.click(route.getByRole('button', { name: 'Apply rate + quantity' }));
    expect(route.getByRole('spinbutton', { name: 'AAT process rate for Loop 1' })).toHaveValue(20);
    await user.click(route.getByRole('button', { name: 'Show details for FF-500' }));
    expect(route.getByRole('spinbutton', { name: 'FF-500 quantity' })).toHaveValue(3);

    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        fractionator_allocations: [expect.objectContaining({
          parent_loop_number: 1,
          process_rate_ls_m2: 20,
          products: [expect.objectContaining({
            product_master_id: 'ff-500',
            quantity: 3,
          })],
        })],
      }),
    ));
  });

  it('keeps selected fractionators independent while flipping with the keyboard', async () => {
    const user = userEvent.setup();
    const products = [
      {
        id: 'ff-500',
        product_code: 'FF-500',
        product_name: 'Foam Fractionator 500',
        diameter_mm: 500,
      },
      {
        id: 'ff-750',
        product_code: 'FF-750',
        product_name: 'Foam Fractionator 750',
        diameter_mm: 750,
      },
    ];
    renderFlowRoute({
      ...baseSystem,
      water_type: 'Marine',
      loop1_filtration: 'Foam Fractionation',
      fractionator_allocations: [{
        parent_loop_number: 1,
        process_rate_ls_m2: 19,
        notes: 'Keep the skimmer bank accessible.',
        products: [
          { product_master_id: 'ff-500', product_code: 'FF-500', quantity: 1 },
          { product_master_id: 'ff-750', product_code: 'FF-750', quantity: 2 },
        ],
      }],
    }, baseBook, [], products);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    const firstCard = route.getByRole('button', { name: 'Show details for FF-500' });
    const secondCard = route.getByRole('button', { name: 'Show details for FF-750' });
    route.getAllByText('Model diameter').forEach(detail => expect(detail).not.toBeVisible());

    firstCard.focus();
    await user.keyboard('{Enter}');

    expect(route.getByRole('button', { name: 'Show compact summary for FF-500' })).toBeInTheDocument();
    expect(route.getAllByText('Model diameter').filter(detail => detail.closest('[hidden]') === null)).toHaveLength(1);
    expect(route.getAllByText('Calculated area').filter(detail => detail.closest('[hidden]') === null)).toHaveLength(1);
    expect(route.getAllByText('Capacity status').filter(detail => detail.closest('[hidden]') === null)).toHaveLength(1);
    expect(secondCard).not.toHaveAttribute('aria-expanded', 'true');
    expect(route.getByRole('button', { name: 'Show details for FF-750' })).toHaveAttribute('aria-expanded', 'false');
    expect(route.getByRole('spinbutton', { name: 'FF-500 quantity' })).toHaveValue(1);
    expect(route.getAllByText('Keep the skimmer bank accessible.').length).toBeGreaterThan(0);
    expect(apiPut).not.toHaveBeenCalled();

    await user.click(route.getByRole('button', { name: 'Show compact summary for FF-500' }));
    expect(route.getByRole('button', { name: 'Show details for FF-500' })).toBeInTheDocument();
    expect(route.queryByRole('spinbutton', { name: 'FF-500 quantity' })).not.toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'Save Flow Route' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({
        fractionator_allocations: [expect.objectContaining({
          parent_loop_number: 1,
          process_rate_ls_m2: 19,
          products: [
            expect.objectContaining({ product_master_id: 'ff-500', quantity: 1 }),
            expect.objectContaining({ product_master_id: 'ff-750', quantity: 2 }),
          ],
        })],
      }),
    ));
  });

  it('keeps flipped fractionator details read-only for released Flow Routes', async () => {
    const user = userEvent.setup();
    const product = {
      id: 'ff-500',
      product_code: 'FF-500',
      product_name: 'Foam Fractionator 500',
      diameter_mm: 500,
    };
    const releasedBook = {
      ...baseBook,
      status: 'Released',
      systems: [{
        ...baseSystem,
        water_type: 'Marine',
        loop1_filtration: 'Foam Fractionation',
        fractionator_allocations: [{
          parent_loop_number: 1,
          process_rate_ls_m2: 19,
          products: [{
            product_master_id: 'ff-500',
            product_code: 'FF-500',
            product_name: 'Foam Fractionator 500',
            diameter_mm: 500,
            quantity: 1,
          }],
        }],
      }],
      system_links: [],
    };
    renderFlowRoute(baseSystem, releasedBook, [], [product]);
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    expect(route.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    await user.click(route.getByRole('button', { name: 'Show details for FF-500' }));

    expect(route.getByText('Model diameter')).toBeInTheDocument();
    expect(route.queryByRole('spinbutton', { name: 'FF-500 quantity' })).not.toBeInTheDocument();
    expect(route.queryByRole('button', { name: 'Remove FF-500' })).not.toBeInTheDocument();
  });
});