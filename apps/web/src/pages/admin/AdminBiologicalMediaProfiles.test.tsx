import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
    overall_vtr_g_tan_n_m3_d: '231',
    capacity_basis_unit: 'g TAN-N/m³ media/day',
    provisional_label: 'Preliminary engineering reference — administrator review required',
    notes: 'Approximate study-condition reference only; do not treat this maximum-rate study result as universal design capacity.',
    evidence_reference: null,
    status: 'Draft',
  },
];

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

describe('TAN generation profile administration', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/biological-media/tan-profiles') return Promise.resolve({ data: { items: tanProfiles } });
      if (url === '/biological-media/media-profiles') return Promise.resolve({ data: { items: mediaProfiles } });
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

  it('shows Overall VTR and its preliminary use qualification in the media listing', async () => {
    renderPage('media');

    expect(await screen.findByText('Cold freshwater moving bed — 850 m²/m³ media')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Overall VTR' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Qualification / use' })).toBeVisible();
    expect(screen.getByText('231')).toBeVisible();
    expect(screen.getByText('g TAN-N/m³ media/day')).toBeVisible();
    expect(screen.getByText('Preliminary engineering reference — administrator review required')).toBeVisible();
    expect(screen.getByText(/maximum-rate study result as universal design capacity/)).toBeVisible();
    expect(screen.getByText('Review required before approval')).toBeVisible();
  });
});