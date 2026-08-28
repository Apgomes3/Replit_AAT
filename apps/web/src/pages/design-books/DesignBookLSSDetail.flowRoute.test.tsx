import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
};

const baseBook = {
  id: 'book-1',
  book_code: 'DB-001',
  book_title: 'Aquarium Design Book',
  status: 'Draft',
  exhibits: [],
  engineering_calculations: { systems: [], exhibits: [] },
};

function renderFlowRoute(system = baseSystem, book = baseBook) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/systems/system-1') return Promise.resolve({ data: system });
    if (url === '/design-books/book-1') return Promise.resolve({ data: book });
    if (url === '/systems/system-1/exhibit-links') return Promise.resolve({ data: [] });
    if (url === '/lss-compact-units') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/design-books/book-1/lss/system-1']}>
        <Routes>
          <Route path="/design-books/:bookId/lss/:systemId" element={<DesignBookLSSDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
});