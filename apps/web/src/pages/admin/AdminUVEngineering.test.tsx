import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import AdminUVEngineering from './AdminUVEngineering';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const revision = {
  id: 'revision-2',
  catalog_id: 'catalog-1',
  revision_number: 2,
  status: 'Draft',
  lamp_count: 2,
  lamp_power_w: 85,
  effective_reactor_volume_l: 120,
  irradiance_85t_mw_cm2: 1.2,
  irradiance_95t_mw_cm2: 1.6,
  compatibility: 'Marine and freshwater',
  arrangement: 'Two-lamp reactor',
  source_evidence: 'Manufacturer TDS',
  approved_per_lamp_flow_exception_m3h: 40,
  notes: 'Draft evidence',
};

const product = {
  id: 'catalog-1',
  product_master_id: 'product-1',
  product_code: 'UV-100',
  product_name: 'UV Reactor 100',
  manufacturer: 'AAT',
  primary_material_code: 'SS316',
  configuration: 'Wall mounted',
  control_type: 'PLC interlock',
  signal_type: 'Modbus',
  control_type_optional: true,
  rated_power_kw: 0.17,
  pim_status: 'Active',
  product_family_code: 'PFM-UV',
  latest_revision: revision,
  sync_status: 'Current',
  calculation_enabled: false,
  completeness_message: 'Engineering revision is not approved',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminUVEngineering />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UV engineering administration', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: { items: [product] } } as any);
    vi.mocked(api.put).mockResolvedValue({ data: revision } as any);
  });

  it('shows the latest revision and authoritative PIM rated power', async () => {
    renderPage();
    expect(await screen.findByText('UV Reactor 100')).toBeVisible();
    expect(screen.getByText('r2')).toBeVisible();
    expect(screen.getByText(/0.17 kW/)).toBeVisible();
  });

  it('persists the schema-backed UV engineering fields', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Wall mounted')).toBeVisible();
    expect(screen.getByText('PLC interlock')).toBeVisible();
    expect(screen.getByText('Modbus')).toBeVisible();
    expect(screen.getByText('Optional').nextElementSibling).toHaveTextContent('Yes');
    expect(screen.getByLabelText('Effective reactor volume (L) *')).toHaveValue(120);
    expect(screen.getByLabelText('Irradiance at 85%T (mW/cm²) *')).toHaveValue(1.2);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(api.put).toHaveBeenCalledWith(
      '/admin/uv-engineering/revisions/revision-2',
      expect.objectContaining({
        effective_reactor_volume_l: 120,
        irradiance_85t_mw_cm2: 1.2,
        irradiance_95t_mw_cm2: 1.6,
        approved_per_lamp_flow_exception_m3h: 40,
      }),
    );
    const payload = vi.mocked(api.put).mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('lamp_count');
    expect(payload).not.toHaveProperty('lamp_power_w');
  });
});