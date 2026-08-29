import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
const apiPost = vi.mocked(api.post);

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
  exhibit_name: 'Main Exhibit',
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

const bookWithLinkedExhibits = {
  ...bookWithPrimarySplit,
  exhibits: [
    { id: 'exhibit-1', exhibit_code: 'EX-01', exhibit_name: 'Main Exhibit' },
    { id: 'exhibit-2', exhibit_code: 'EX-02', exhibit_name: 'Secondary Exhibit' },
  ],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>;
}

function renderFlowRoute(
  system: any = baseSystem,
  book: any = baseBook,
  links: any[] = [],
  fractionatorProducts: any[] = [],
  initialEntry = '/design-books/book-1/lss/system-1?tab=flow',
  biologicalMedia: any = null,
) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/systems/system-1') return Promise.resolve({ data: system });
    if (url === '/design-books/book-1') return Promise.resolve({ data: book });
    if (url === '/systems/system-1/exhibit-links') return Promise.resolve({ data: links });
    if (url === '/systems/system-1/fractionator-products') {
      return Promise.resolve({ data: { items: fractionatorProducts } });
    }
    if (url === '/systems/system-1/biological-media') return Promise.resolve({ data: biologicalMedia });
    if (url === '/biological-media/media-profiles') return Promise.resolve({ data: { items: [] } });
    if (url === '/biological-media/tan-profiles') return Promise.resolve({ data: { items: [] } });
    if (url === '/lss-compact-units') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/design-books/:bookId/lss/:systemId" element={<DesignBookLSSDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

function renderBrowserFlowRoute() {
  apiGet.mockImplementation((url: string) => {
    if (url === '/systems/system-1') return Promise.resolve({ data: baseSystem });
    if (url === '/design-books/book-1') return Promise.resolve({ data: baseBook });
    if (url === '/systems/system-1/exhibit-links') return Promise.resolve({ data: [] });
    if (url === '/systems/system-1/fractionator-products') {
      return Promise.resolve({ data: { items: [] } });
    }
    if (url === '/systems/system-1/biological-media') return Promise.resolve({ data: null });
    if (url === '/biological-media/media-profiles') return Promise.resolve({ data: { items: [] } });
    if (url === '/biological-media/tan-profiles') return Promise.resolve({ data: { items: [] } });
    if (url === '/lss-compact-units') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  window.history.replaceState({}, '', '/design-books/book-1/lss/system-1?tab=flow');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LocationProbe />
        <Routes>
          <Route path="/design-books/:bookId/lss/:systemId" element={<DesignBookLSSDetail />} />
          <Route path="/design-books/:bookId" element={<div>Design book destination</div>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

describe('DesignBookLSSDetail Flow Route allocations', () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiPut.mockResolvedValue({ data: {} });
    apiPost.mockResolvedValue({ data: {} });
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

  it('opens on an accessible system overview with linked flow information', async () => {
    renderFlowRoute(
      baseSystem,
      bookWithPrimarySplit,
      [primaryLink],
      [],
      '/design-books/book-1/lss/system-1',
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual([
      'System Overview',
      'Flow Route',
      'Biological Media',
      'UV Selection',
      'Thermal Selection',
      'Ozone Selection',
      'Other Equipment',
    ]);
    expect(screen.getByRole('tab', { name: 'System Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'System Overview' })).toBeVisible();
    expect(screen.getByText('Design Flow')).toBeInTheDocument();
    expect(screen.getByText('Turnover Rate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Link Exhibit/ })).toBeInTheDocument();
    expect(screen.getByText('125.0')).toBeInTheDocument();
  });

  it('shows authoritative linked volume context without presenting a sizing result', async () => {
    const user = userEvent.setup();
    renderFlowRoute(
      baseSystem,
      bookWithLinkedExhibits,
      [primaryLink],
      [],
      '/design-books/book-1/lss/system-1?tab=biological-media',
      {
        case: null,
        readiness_status: 'Blocked',
        input_completeness: { complete: false, missing: ['Create the biological media draft.'] },
        context: {
          status: 'blocked',
          total_operating_volume_m3: 42.125,
          reasons: ['An approved media profile is not available.'],
          linked_exhibits: [{
            exhibit_id: 'exhibit-1',
            exhibit_code: 'EX-01',
            exhibit_name: 'Main Exhibit',
            water_type: 'Freshwater',
            operating_volume_m3: 42.125,
          }],
        },
      },
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    expect(screen.getByRole('tab', { name: 'Biological Media' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Biological Media' })).toHaveTextContent('42.1250');
    expect(screen.getByRole('tabpanel', { name: 'Biological Media' })).toHaveTextContent('Blocked');
    expect(screen.getByText(/No biological-filter sizing result is calculated here/)).toBeInTheDocument();
    expect(screen.queryByText(/media volume required/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1/biological-media',
      expect.objectContaining({ design_book_id: 'book-1' }),
    ));
  });

  it('keeps Biological Media draft controls read-only in a frozen Design Book package', async () => {
    renderFlowRoute(
      baseSystem,
      {
        ...bookWithLinkedExhibits,
        status: 'Released',
        systems: [baseSystem],
        system_links: [primaryLink],
      },
      [primaryLink],
      [],
      '/design-books/book-1/lss/system-1?tab=biological-media',
      {
        case: { id: 'case-1', reactor_type: 'Moving bed biofilter', notes: 'Frozen basis' },
        readiness_status: 'Incomplete',
        input_completeness: { complete: false, missing: ['Select an approved media profile revision.'] },
        context: { total_operating_volume_m3: 42, linked_exhibits: [] },
      },
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    expect(screen.getByDisplayValue('Moving bed biofilter')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });

  it('opens the selected linked exhibit from the table without changing neighboring controls', async () => {
    const user = userEvent.setup();
    const secondaryLink = {
      ...primaryLink,
      id: 'link-2',
      exhibit_id: 'exhibit-2',
      exhibit_code: 'EX-02',
      exhibit_name: 'Secondary Exhibit',
      link_type: 'Secondary',
    };
    renderFlowRoute(
      baseSystem,
      bookWithLinkedExhibits,
      [primaryLink, secondaryLink],
      [],
      '/design-books/book-1/lss/system-1?tab=overview',
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    const table = screen.getByRole('table');
    const secondaryRow = within(table).getByText('Secondary Exhibit').closest('tr');
    expect(secondaryRow).not.toBeNull();
    const exhibitLink = within(secondaryRow!).getByRole('link', {
      name: 'Open exhibit EX-02 — Secondary Exhibit',
    });
    expect(exhibitLink).toHaveAttribute('href', '/design-books/book-1/exhibits/exhibit-2');

    await user.click(within(secondaryRow!).getByRole('button', { name: 'Edit link for EX-02' }));
    expect(screen.getByText('Edit Exhibit Link')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design-books/book-1/lss/system-1?tab=overview',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Edit Exhibit Link')).not.toBeInTheDocument();
    await user.click(exhibitLink);
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design-books/book-1/exhibits/exhibit-2',
    );
  });

  it('opens the primary exhibit from the Flow Route split reference', async () => {
    const user = userEvent.setup();
    renderFlowRoute(
      { ...baseSystem, loop1_flow_source: 'Both Integrated' },
      bookWithLinkedExhibits,
      [primaryLink],
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    const route = within(document.querySelector('#flow-route')!);
    const exhibitLink = route.getByRole('link', { name: 'Open exhibit EX-01' });
    expect(exhibitLink).toHaveAttribute('href', '/design-books/book-1/exhibits/exhibit-1');

    await user.click(route.getByRole('button', { name: 'List' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design-books/book-1/lss/system-1?tab=flow',
    );
    await user.click(route.getByRole('button', { name: 'Card' }));
    await user.click(route.getByRole('link', { name: 'Open exhibit EX-01' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design-books/book-1/exhibits/exhibit-1',
    );
  });

  it('keeps snapshot-only exhibit references readable but non-clickable', async () => {
    const user = userEvent.setup();
    renderFlowRoute(
      baseSystem,
      {
        ...bookWithPrimarySplit,
        engineering_calculations: {
          ...bookWithPrimarySplit.engineering_calculations,
          exhibits: [{
            ...primaryExhibitCalculation,
            inputs: {
              ...primaryExhibitCalculation.inputs,
              exhibit_id: 'snapshot-only-exhibit',
            },
          }],
        },
      },
      [{
        ...primaryLink,
        exhibit_id: 'snapshot-only-exhibit',
        exhibit_code: 'EX-SNAPSHOT',
        exhibit_name: 'Archived Snapshot',
      }],
      [],
      '/design-books/book-1/lss/system-1?tab=overview',
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    const table = screen.getByRole('table');
    expect(within(table).getByText('EX-SNAPSHOT')).toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: /EX-SNAPSHOT/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Flow Route' }));
    const route = within(document.querySelector('#flow-route')!);
    expect(route.getByText('EX-SNAPSHOT')).toBeInTheDocument();
    expect(route.queryByRole('link', { name: 'Open exhibit EX-SNAPSHOT' })).not.toBeInTheDocument();
  });

  it.each(['For Review', 'Released'])(
    'keeps linked-exhibit navigation available for %s LSS views',
    async status => {
      renderFlowRoute(
        baseSystem,
        {
          ...bookWithLinkedExhibits,
          status,
          systems: [baseSystem],
          system_links: [primaryLink],
        },
        [primaryLink],
        [],
        '/design-books/book-1/lss/system-1',
      );
      await screen.findByRole('heading', { name: 'Primary Life Support' });

      expect(screen.getByRole('link', {
        name: 'Open exhibit EX-01 — Main Exhibit',
      })).toHaveAttribute('href', '/design-books/book-1/exhibits/exhibit-1');
    },
  );

  it('shows configuration as first-time setup and hides it after configuration is saved', async () => {
    const user = userEvent.setup();
    const unconfiguredSystem = {
      ...baseSystem,
      system_config: null,
      compact_unit_id: null,
    };
    apiPut.mockImplementation(async (_url, payload: any) => {
      Object.assign(unconfiguredSystem, {
        system_config: payload.system_config,
        compact_unit_id: payload.compact_unit_id,
      });
      return { data: unconfiguredSystem };
    });
    renderFlowRoute(
      unconfiguredSystem,
      baseBook,
      [],
      [],
      '/design-books/book-1/lss/system-1',
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    expect(screen.getByText('System Configuration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Compact Unit/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bespoke \/ Large System/ }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/systems/system-1',
      expect.objectContaining({ system_config: 'bespoke', compact_unit_id: null }),
    ));
    await waitFor(() => expect(screen.queryByText('System Configuration')).not.toBeInTheDocument());
  });

  it('requires destructive confirmation, preserves data on cancel, and reloads cleared state on reset', async () => {
    const user = userEvent.setup();
    const mutableSystem = { ...baseSystem };
    const mutableBook = {
      ...bookWithPrimarySplit,
      engineering_calculations: {
        ...bookWithPrimarySplit.engineering_calculations,
        systems: [...bookWithPrimarySplit.engineering_calculations.systems],
      },
    };
    apiPost.mockImplementation(async () => {
      Object.assign(mutableSystem, {
        system_config: null,
        compact_unit_id: null,
        design_flow_m3h: null,
        turnover_rate_hr: null,
        loop1_flow_source: null,
        loop1_filtration: null,
        loop1_flow_pct: null,
        side_streams: [],
        fractionator_allocations: [],
      });
      mutableBook.engineering_calculations.systems = [];
      return { data: { system: mutableSystem } };
    });
    renderFlowRoute(
      mutableSystem,
      mutableBook,
      [primaryLink],
      [],
      '/design-books/book-1/lss/system-1',
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    await user.click(screen.getByRole('button', { name: 'Open LSS tools' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change System Configuration' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Confirming will erase this system’s existing LSS input and configuration data',
    );
    await user.click(screen.getByRole('button', { name: 'Keep Current Configuration' }));

    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Link Exhibit/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open LSS tools' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change System Configuration' }));
    await user.click(screen.getByRole('button', { name: 'Erase and Reconfigure' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/systems/system-1/configuration-reset',
      { design_book_id: 'book-1' },
    ));
    await waitFor(() => expect(screen.getByText('System Configuration')).toBeInTheDocument());
    expect(screen.queryByText('Bottom Drain')).not.toBeInTheDocument();
    expect(screen.queryByText('100.0 m³/h')).not.toBeInTheDocument();
  });

  it('does not expose configuration reset for reviewed or released Design Books', async () => {
    const user = userEvent.setup();
    renderFlowRoute(baseSystem, {
      ...baseBook,
      status: 'For Review',
      systems: [baseSystem],
      system_links: [],
    }, [], [], '/design-books/book-1/lss/system-1');
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    await user.click(screen.getByRole('button', { name: 'Open LSS tools' }));
    expect(screen.queryByRole('menuitem', { name: 'Change System Configuration' })).not.toBeInTheDocument();
  });

  it.each(['For Review', 'Approved', 'Released'])(
    'does not expose configuration reset for a %s system in an editable Design Book',
    async status => {
      const user = userEvent.setup();
      renderFlowRoute(
        { ...baseSystem, status },
        baseBook,
        [],
        [],
        '/design-books/book-1/lss/system-1',
      );
      await screen.findByRole('heading', { name: 'Primary Life Support' });

      await user.click(screen.getByRole('button', { name: 'Open LSS tools' }));
      expect(screen.queryByRole('menuitem', { name: 'Change System Configuration' })).not.toBeInTheDocument();
    },
  );

  it('supports keyboard tab navigation and honest equipment empty states', async () => {
    const user = userEvent.setup();
    renderFlowRoute(
      baseSystem,
      baseBook,
      [],
      [],
      '/design-books/book-1/lss/system-1?view=details&tab=other#equipment',
    );
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    const otherTab = screen.getByRole('tab', { name: 'Other Equipment' });
    expect(otherTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design-books/book-1/lss/system-1?view=details&tab=other#equipment',
    );
    otherTab.focus();
    await user.keyboard('{ArrowLeft}');

    expect(screen.getByRole('tab', { name: 'Ozone Selection' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Ozone Selection' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    const overviewTab = screen.getByRole('tab', { name: 'System Overview' });
    expect(overviewTab).toHaveFocus();
    await user.keyboard('{End}');
    expect(otherTab).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Other Equipment' })).toHaveTextContent('Not configured');
    await user.click(screen.getByRole('tab', { name: 'UV Selection' }));
    expect(screen.getByRole('tabpanel', { name: 'UV Selection' })).toHaveTextContent(
      'UV equipment selection will be available here',
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design-books/book-1/lss/system-1?view=details&tab=uv#equipment',
    );
  });

  it('preserves unsaved Flow Route edits while switching tabs', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderFlowRoute();
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    const allocation = route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' });
    await user.clear(allocation);
    await user.type(allocation, '55');

    await user.click(screen.getByRole('tab', { name: 'System Overview' }));
    expect(screen.getByRole('tab', { name: /Flow Route/ })).toHaveTextContent('*');
    await user.click(screen.getByRole('tab', { name: /Flow Route/ }));
    expect(route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' })).toHaveValue(55);
    expect(confirmSpy).not.toHaveBeenCalled();

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it('blocks destructive in-app navigation until unsaved Flow Route edits are confirmed', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const rendered = renderBrowserFlowRoute();
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);

    await user.click(route.getByRole('button', { name: 'Edit' }));
    const allocation = route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' });
    await user.clear(allocation);
    await user.type(allocation, '55');

    await user.click(screen.getByRole('link', { name: 'Back to Life Support Systems' }));
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unsaved Flow Route changes. Leave this page and discard them?',
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design-books/book-1/lss/system-1?tab=flow',
    );
    expect(route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' })).toHaveValue(55);

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('link', { name: 'Back to Life Support Systems' }));
    await screen.findByText('Design book destination');
    expect(screen.getByTestId('location')).toHaveTextContent('/design-books/book-1?tab=lss');

    rendered.unmount();
    window.history.replaceState({}, '', '/');
  });

  it('keeps reviewed records read-only across the overview and Flow Route tabs', async () => {
    const user = userEvent.setup();
    renderFlowRoute(baseSystem, {
      ...baseBook,
      status: 'Released',
      systems: [baseSystem],
      system_links: [],
    }, [], [], '/design-books/book-1/lss/system-1');
    await screen.findByRole('heading', { name: 'Primary Life Support' });

    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Flow Route' }));
    expect(within(document.querySelector('#flow-route')!).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
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

  it('places loop and linked Bio/Degas context before fractionator capacity and converts both flows', async () => {
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
      loop1_link_bio_degas: true,
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
    const context = route.getByLabelText('Foam Fractionator flow context for Loop 1');
    const capacity = route.getByText('Foam Fractionator capacity');

    expect(context.compareDocumentPosition(capacity)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(context).getByText('40% of system')).toBeInTheDocument();
    expect(within(context).getByText('40.0 m³/h')).toBeInTheDocument();
    expect(within(context).getByText('25% of loop')).toBeInTheDocument();
    expect(within(context).getByText('10.0 m³/h derived branch flow')).toBeInTheDocument();

    const card = within(route.getByRole('region', { name: 'Foam Fractionator FF-500' }));
    expect(card.getByText('FF-500')).toBeInTheDocument();
    expect(card.getByText('1 unit')).toBeInTheDocument();
    expect(card.getAllByText('Ø500 mm').length).toBeGreaterThan(0);
    expect(card.getAllByText('Required flow above capacity').length).toBeGreaterThan(0);
    expect(card.queryByRole('spinbutton', { name: 'FF-500 quantity' })).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: 'Remove FF-500' })).not.toBeInTheDocument();

    await user.click(route.getByRole('button', { name: 'L/s' }));
    const convertedContext = within(route.getByLabelText('Foam Fractionator flow context for Loop 1'));
    expect(convertedContext.getByText('11.1 L/s')).toBeInTheDocument();
    expect(convertedContext.getByText('2.8 L/s derived branch flow')).toBeInTheDocument();
  });

  it('states when Bio/Degas is not connected without showing a branch flow', async () => {
    renderFlowRoute({
      ...baseSystem,
      water_type: 'Marine',
      loop1_filtration: 'Foam Fractionation',
      loop1_link_bio_degas: false,
      fractionator_allocations: [],
    });
    await screen.findByRole('heading', { name: 'Primary Life Support' });
    const route = within(document.querySelector('#flow-route')!);
    const context = within(route.getByLabelText('Foam Fractionator flow context for Loop 1'));

    expect(context.getByText('Not connected')).toBeInTheDocument();
    expect(context.queryByText(/derived branch flow/)).not.toBeInTheDocument();
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
    const flowAllocation = route.getByRole('spinbutton', { name: 'Loop 1 flow allocation percentage' });
    const capacityHeading = route.getByText('Foam Fractionator capacity');
    expect(flowAllocation.compareDocumentPosition(capacityHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
    await user.click(route.getByRole('button', { name: 'Details' }));
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

  it('keeps selected fractionators independent while disclosing details with the keyboard', async () => {
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
    const firstCard = within(route.getByRole('region', { name: 'Foam Fractionator FF-500' }));
    const secondCard = within(route.getByRole('region', { name: 'Foam Fractionator FF-750' }));
    route.getAllByText('Model diameter').forEach(detail => expect(detail).not.toBeVisible());

    const firstDetails = firstCard.getByRole('button', { name: 'Details' });
    const secondDetails = secondCard.getByRole('button', { name: 'Details' });
    expect(firstDetails).toHaveAttribute('aria-expanded', 'false');
    expect(secondDetails).toHaveAttribute('aria-expanded', 'false');
    firstDetails.focus();
    await user.keyboard('{Enter}');

    expect(firstCard.getByRole('button', { name: 'Hide details' })).toBeInTheDocument();
    expect(route.getAllByText('Model diameter').filter(detail => detail.closest('[hidden]') === null)).toHaveLength(1);
    expect(route.getAllByText('Calculated area').filter(detail => detail.closest('[hidden]') === null)).toHaveLength(1);
    expect(route.getAllByText('Capacity status').filter(detail => detail.closest('[hidden]') === null)).toHaveLength(1);
    expect(firstDetails).toHaveAttribute('aria-expanded', 'true');
    expect(secondDetails).toHaveAttribute('aria-expanded', 'false');
    expect(route.getByRole('spinbutton', { name: 'FF-500 quantity' })).toHaveValue(1);
    expect(route.getAllByText('Keep the skimmer bank accessible.').length).toBeGreaterThan(0);
    expect(apiPut).not.toHaveBeenCalled();

    await user.click(firstCard.getByRole('button', { name: 'Hide details' }));
    expect(firstCard.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(route.getByRole('spinbutton', { name: 'FF-500 quantity' })).toHaveValue(1);
    expect(apiPut).not.toHaveBeenCalled();
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

  it('keeps disclosed fractionator details read-only for released Flow Routes', async () => {
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
    await user.click(route.getByRole('button', { name: 'Details' }));

    expect(route.getByText('Model diameter')).toBeInTheDocument();
    expect(route.queryByRole('spinbutton', { name: 'FF-500 quantity' })).not.toBeInTheDocument();
    expect(route.queryByRole('button', { name: 'Remove FF-500' })).not.toBeInTheDocument();
  });
});