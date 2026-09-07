import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import { PipeSizingSection } from './ExhibitDetail';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

const standards = [
  {
    dn: 25, internal_diameter_mm: 25, is_active: true,
    pressure_velocity_min_m_s: 1.5, pressure_velocity_max_m_s: 3,
    gravity_velocity_min_m_s: 0.1, gravity_velocity_max_m_s: 1.5,
  },
  {
    dn: 32, internal_diameter_mm: 32, is_active: true,
    pressure_velocity_min_m_s: 1.5, pressure_velocity_max_m_s: 3,
    gravity_velocity_min_m_s: 0.1, gravity_velocity_max_m_s: 1.5,
  },
  {
    dn: 40, internal_diameter_mm: 40, is_active: true,
    pressure_velocity_min_m_s: 1.5, pressure_velocity_max_m_s: 3,
    gravity_velocity_min_m_s: 0.1, gravity_velocity_max_m_s: 1.5,
  },
  {
    dn: 50, internal_diameter_mm: 50, is_active: true,
    pressure_velocity_min_m_s: 1.5, pressure_velocity_max_m_s: 3,
    gravity_velocity_min_m_s: 0.1, gravity_velocity_max_m_s: 1.5,
  },
  {
    dn: 65, internal_diameter_mm: 65, is_active: true,
    pressure_velocity_min_m_s: 1.5, pressure_velocity_max_m_s: 3,
    gravity_velocity_min_m_s: 0.1, gravity_velocity_max_m_s: 1.5,
  },
];

function renderSizing(readOnly = false, hydraulics: any = {
  target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70,
}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PipeSizingSection
        bookId="book-1"
        exhibitId="exhibit-1"
        hydraulics={hydraulics}
        calculation={{ results: { total_return_flow_m3h: 10, surface_skim_flow_m3h: 3, bottom_drain_flow_m3h: 7 } }}
        readOnly={readOnly}
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('exhibit pipe sizing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: { items: standards } });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('shows the smallest valid pressure DN, velocity, and one-size-up action', async () => {
    const user = userEvent.setup();
    renderSizing();

    const recommendations = await screen.findAllByText(/Recommendation/);
    expect(recommendations[0]).toHaveTextContent('DN 40');
    expect(screen.getByText('2.210 m/s')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Go one size up · DN 50/ }));

    expect(api.put).toHaveBeenCalledWith('/design-books/book-1/exhibits/exhibit-1/hydraulics',
      expect.objectContaining({ inlet_pipe_dn: 50 }));
    expect(screen.getByText('Bottom drain pipe')).toBeVisible();
    expect(screen.getAllByText(/Recommendation/)[2]).toHaveTextContent('DN 50');
    await user.click(screen.getByRole('button', { name: /Go one size up · DN 65/ }));
    expect(api.put).toHaveBeenCalledWith('/design-books/book-1/exhibits/exhibit-1/hydraulics',
      expect.objectContaining({ bottom_drain_pipe_dn: 65 }));
  });

  it('does not offer save controls on a read-only revision', async () => {
    renderSizing(true);

    expect(await screen.findAllByText(/Recommendation/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Save recommendation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Go one size up/ })).not.toBeInTheDocument();
  });

  it('keeps frozen saved evidence visible after the live standard is unavailable', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { items: [] } });
    renderSizing(false, {
      target_turnover_rate: 4,
      surface_skim_pct: 30,
      bottom_drain_pct: 70,
      inlet_pipe_dn: 40,
      inlet_pipe_evidence: {
        dn: 40,
        internal_diameter_mm: 41.2,
        velocity_min_m_s: 1.5,
        velocity_max_m_s: 3,
        authoritative_flow_m3h: 12,
        computed_velocity_m_s: 2.5,
        within_band: true,
        selection_mode: 'recommended',
      },
    });

    expect(await screen.findByText(/Saved selection/)).toHaveTextContent('DN 40');
    expect(screen.getByText('2.500 m/s')).toBeVisible();
    expect(screen.getByText(/saved engineering basis is retained/i)).toBeVisible();
  });
});