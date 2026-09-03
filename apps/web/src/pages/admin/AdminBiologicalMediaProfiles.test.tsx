import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import AdminBiologicalMediaProfiles from './AdminBiologicalMediaProfiles';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const tanProfiles = [
  {
    id: 'tan-general',
    profile_code: 'EBELING_TIMMONS_GENERAL_RAS',
    profile_name: 'Ebeling Timmons general RAS',
    revision: 1,
    coefficient: '0.09216',
    coefficient_unit: 'kg TAN-N/kg feed protein',
    recommended_application: 'Default for teleost fish where no validated species data exist.',
    status: 'Draft',
  },
  {
    id: 'tan-validated',
    profile_code: 'SPECIES_AND_FEED_VALIDATED',
    profile_name: 'Species and feed validated',
    revision: 1,
    coefficient: null,
    coefficient_unit: 'kg TAN-N/kg feed protein',
    recommended_application: 'Requires an administrator-controlled, evidence-based value.',
    status: 'Draft',
  },
];

const mediaProfiles = [
  {
    id: 'media-moving-cold',
    profile_code: 'FW_MB_8C_850',
    profile_name: 'Cold freshwater moving bed — 850 m²/m³ media',
    revision: 1,
    water_types: ['Freshwater'],
    reactor_types: ['Moving bed biofilter'],
    overall_vtr_g_tan_n_m3_d: '231',
    capacity_basis_unit: 'g TAN-N/m³ media/day',
    provisional_label: 'Preliminary engineering reference — administrator review required',
    notes: 'Approximate study-condition reference only; do not treat this maximum-rate study result as universal design capacity.',
    evidence_reference: null,
    is_provisional: true,
    status: 'Draft',
  },
];

const evidenceRecords = [{
  id: 'evidence-sand',
  evidence_code: 'OBS_MARINE_FLUIDIZED_SAND',
  revision: 1,
  title: 'Marine fluidized sand filter',
  record_type: 'Observation',
  evidence_classification: 'Loading benchmark',
  review_status: 'Review Needed',
  promotable: false,
  source_reference: 'Not supplied in provided table',
  reactor_identity: 'Marine fluidized sand filter',
  reactor_type: 'Fluidized sand filter',
  media_identity: 'Fluidized sand',
  water_type: 'Marine',
  temperature_condition: '12 to 20°C',
  salinity_condition: 'Simulated seawater',
  tan_condition: 'TAN maintained around 0.45 to 1.26 mg/L',
  media_ssa_basis: 'Not supplied in provided table',
  observed_metric: 'Applied TAN load',
  observed_unit: 'g TAN-N/m³/day',
  intended_use: 'Retain as a loading benchmark for engineering review.',
  qualification: 'Applied TAN load of 500 g/m³/day.',
  limitations: 'This is a loading benchmark, not necessarily actual VTR.',
  promotion_exclusion_reason: 'Loading benchmark is explicitly excluded from direct Overall-VTR promotion.',
  source_text: 'This is a loading benchmark, not necessarily actual VTR',
  observations: [{
    observation_code: 'applied_tan_load',
    qualifier: 'Loading benchmark',
    metric: 'Applied TAN load',
    value_text: '500',
    unit: 'g TAN-N/m³/day',
  }],
}];

function renderPage(focus = 'tan') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/?focus=${focus}`]}>
        <AdminBiologicalMediaProfiles />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div>Returned to {location.pathname}{location.search}{location.hash}</div>;
}

function renderWithNavigation(initialEntries: any[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/admin/biological-media-profiles" element={<AdminBiologicalMediaProfiles />} />
          <Route path="/admin/users" element={<LocationProbe />} />
          <Route path="/design-books/:bookId/lss/:systemId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TAN generation profile administration', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/biological-media/tan-profiles') return Promise.resolve({ data: { items: tanProfiles } });
      if (url === '/biological-media/media-profiles') return Promise.resolve({ data: { items: mediaProfiles } });
      if (url === '/biological-media/evidence') return Promise.resolve({ data: { items: evidenceRecords } });
      return Promise.resolve({ data: { items: [] } });
    });
  });

  it('shows profile, coefficient, unit, and recommended application without fabricating the controlled value', async () => {
    renderPage();

    expect(await screen.findByText('Ebeling Timmons general RAS')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Profile' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Coefficient' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Unit' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Recommended application' })).toBeVisible();
    expect(screen.getByText('0.09216')).toBeVisible();
    expect(screen.getAllByText('kg TAN-N/kg feed protein')).toHaveLength(2);
    expect(screen.getByText('Default for teleost fish where no validated species data exist.')).toBeVisible();
    expect(screen.getByText('Controlled value required')).toBeVisible();
  });

  it('explains scope and leaves its numeric envelope optional', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'TAN-generation profile' }));
    expect(screen.getByText(/Where this coefficient is valid/)).toBeVisible();
    expect(screen.getByText(/Optional numeric applicability envelope/)).toBeVisible();
    expect(screen.getByText(/leave them blank for general reference profiles/)).toBeVisible();
    for (const label of ['Scope unit', 'Scope minimum', 'Scope maximum']) {
      expect(screen.getByText((_content, element) =>
        element?.tagName === 'LABEL'
        && element.textContent?.replace(/\s+/g, ' ').trim() === `${label} (optional)`,
      )).toBeVisible();
    }
  });

  it('shows Overall VTR without listing qualification details', async () => {
    renderPage('media');

    expect(await screen.findByText('Cold freshwater moving bed — 850 m²/m³ media')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Overall VTR' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: 'Qualification / use' })).not.toBeInTheDocument();
    expect(screen.getByText('231')).toBeVisible();
    expect(screen.getByText('g TAN-N/m³ media/day')).toBeVisible();
    expect(screen.queryByText('Preliminary engineering reference — administrator review required')).not.toBeInTheDocument();
    expect(screen.queryByText(/maximum-rate study result as universal design capacity/)).not.toBeInTheDocument();
    expect(screen.getByText('Review required before approval')).toBeVisible();
  });

  it('opens a Draft media revision for editing and saves it in place with its identity preserved', async () => {
    const user = userEvent.setup();
    renderPage('media');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit media profile revision' })).toBeVisible();
    const profileCode = screen.getByLabelText('Profile code *');
    expect(profileCode).toBeDisabled();
    expect(profileCode).toHaveValue('FW_MB_8C_850');
    expect(screen.getByLabelText('Explicit provisional label *')).toHaveValue('Preliminary engineering reference — administrator review required');
    expect(screen.getByLabelText('Revision notes')).toHaveValue('Approximate study-condition reference only; do not treat this maximum-rate study result as universal design capacity.');

    await user.type(screen.getByLabelText(/Evidence reference/), 'ENG-VTR-204');
    await user.clear(screen.getByLabelText('Explicit provisional label *'));
    await user.type(screen.getByLabelText('Explicit provisional label *'), 'Updated provisional basis');
    await user.clear(screen.getByLabelText('Revision notes'));
    await user.type(screen.getByLabelText('Revision notes'), 'Updated review notes');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/admin/biological-media/media-profiles/media-moving-cold',
      expect.objectContaining({
        profile_code: 'FW_MB_8C_850',
        evidence_reference: 'ENG-VTR-204',
        overall_vtr_g_tan_n_m3_d: 231,
        provisional_label: 'Updated provisional basis',
        notes: 'Updated review notes',
      }),
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('copies qualification details into a new media revision and submits them unchanged', async () => {
    const user = userEvent.setup();
    renderPage('media');

    await user.click(await screen.findByRole('button', { name: 'New revision' }));
    expect(screen.getByRole('heading', { name: 'Revise media profile revision' })).toBeVisible();
    expect(screen.getByLabelText('Explicit provisional label *')).toHaveValue('Preliminary engineering reference — administrator review required');
    expect(screen.getByLabelText('Revision notes')).toHaveValue('Approximate study-condition reference only; do not treat this maximum-rate study result as universal design capacity.');

    await user.click(screen.getByRole('button', { name: 'Save new draft revision' }));

    expect(api.post).toHaveBeenCalledWith(
      '/admin/biological-media/media-profiles/media-moving-cold/revisions',
      expect.objectContaining({
        provisional_label: 'Preliminary engineering reference — administrator review required',
        notes: 'Approximate study-condition reference only; do not treat this maximum-rate study result as universal design capacity.',
      }),
    );
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('uses controlled multi-selects for media water and reactor compatibility', async () => {
    const user = userEvent.setup();
    renderPage('media');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Water types' })).toHaveTextContent('Freshwater');
    expect(screen.getByRole('button', { name: 'Compatible reactor types' })).toHaveTextContent('Moving bed biofilter');

    await user.click(screen.getByRole('button', { name: 'Water types' }));
    expect(screen.getByRole('checkbox', { name: 'Marine' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Brackish' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Compatible reactor types' }));
    await user.click(screen.getByRole('checkbox', { name: 'Trickling filter' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/admin/biological-media/media-profiles/media-moving-cold',
      expect.objectContaining({
        water_types: ['Freshwater', 'Brackish'],
        reactor_types: ['Moving bed biofilter', 'Trickling filter'],
      }),
    );
  });

  it('keeps the editor open and shows structured validation errors after a failed save', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce({
      response: { data: { error: { message: 'Media depth is invalid.', fields: ['Media depth minimum cannot exceed maximum.'] } } },
    });
    const user = userEvent.setup();
    renderPage('media');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Media depth minimum cannot exceed maximum.');
    expect(screen.getByRole('heading', { name: 'Edit media profile revision' })).toBeVisible();
  });

  it('shows review-only evidence and full benchmark conditions without offering profile actions', async () => {
    const user = userEvent.setup();
    renderPage('evidence');

    const title = (await screen.findAllByText('Marine fluidized sand filter'))[0];
    expect(screen.getByText('Review Needed')).toBeVisible();
    expect(screen.getAllByText('Loading benchmark').length).toBeGreaterThan(0);
    expect(screen.getByText('Excluded from promotion')).toBeVisible();
    await user.click(title);
    expect(screen.getByText('12 to 20°C')).toBeVisible();
    expect(screen.getByText('TAN maintained around 0.45 to 1.26 mg/L')).toBeVisible();
    expect(screen.getByText('This is a loading benchmark, not necessarily actual VTR.')).toBeVisible();
    expect(screen.getByText('500')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new revision/i })).not.toBeInTheDocument();
  });

  it.each(['media', 'tan'])('returns to the originating Design Book location for the %s profile view', async focus => {
    renderWithNavigation([
      {
        pathname: `/design-books/book-7/lss/system-3`,
        search: '?tab=biological-media&system=selected',
        hash: '#biological-media',
      },
      {
        pathname: '/admin/biological-media-profiles',
        search: `?focus=${focus}`,
        hash: `#${focus}-profiles`,
        state: {
          returnTo: '/design-books/book-7/lss/system-3?tab=biological-media&system=selected#biological-media',
        },
      },
    ]);

    expect(await screen.findByRole('button', { name: 'Back' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Returned to /design-books/book-7/lss/system-3?tab=biological-media&system=selected#biological-media')).toBeVisible();
  });

  it.each(['media', 'tan'])('uses the Platform Admin fallback for a direct %s profile visit', async focus => {
    renderWithNavigation([`/admin/biological-media-profiles?focus=${focus}#${focus}-profiles`]);

    expect(await screen.findByRole('button', { name: 'Back' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Returned to /admin/users')).toBeVisible();
  });
});