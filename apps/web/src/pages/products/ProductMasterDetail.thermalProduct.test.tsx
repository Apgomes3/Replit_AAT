import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductMasterDetail from './ProductMasterDetail';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  default: {
    get: mocks.get,
    post: vi.fn(),
    put: mocks.put,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

const productId = 'thermal-product-1';
let category = 'Thermal';
let thermal: Record<string, unknown>;

const product = () => ({
  id: productId,
  product_code: 'HEX-100',
  product_name: 'Plate heat exchanger',
  product_category: category,
  standard_status: 'Active',
  product_family_id: null,
  product_family_name: null,
  boms: [],
  documents: [],
  vendors: [],
  projects: [],
  synonyms: [],
});

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/products/masters/${productId}`]}>
        <Routes>
          <Route path="/products/masters/:id" element={<ProductMasterDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function thermalCard() {
  const title = await screen.findByText('Thermal Specifications');
  const card = title.parentElement?.parentElement;
  if (!card) throw new Error('Could not find Thermal Specifications card');
  return within(card);
}

describe('ProductMasterDetail thermal specifications', () => {
  beforeEach(() => {
    category = 'Thermal';
    thermal = {
      thermal_capacity_kw: 120,
      thermal_duty: 'Heating',
      fluid_type: 'Fresh water',
      operating_temperature_min_c: 12,
      operating_temperature_max_c: 30,
      design_temperature_c: 35,
      flow_rate_m3h: 40,
      pressure_rating_bar: 6,
      efficiency_pct: 92,
      primary_inlet_dn_mm: 80,
      primary_outlet_dn_mm: 80,
      secondary_inlet_dn_mm: 65,
      secondary_outlet_dn_mm: 65,
      flow_switch_status: 'optional',
      notes: 'Titanium plates',
    };
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === `/product-masters/${productId}`) return { data: product() };
      if (url === `/product-masters/${productId}/thermal`) return { data: { ...thermal } };
      return { data: { items: [] } };
    });
    mocks.put.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url !== `/product-masters/${productId}/thermal`) return { data: {} };
      thermal = { ...body };
      return { data: { ...thermal } };
    });
  });

  it('appears only for Thermal products and renders all custom side connections', async () => {
    const { unmount } = renderDetail();
    const card = await thermalCard();
    expect((await card.findByText('120')).parentElement).toHaveTextContent(/120\s*kW/);
    expect(card.getByText('Primary-side Inlet DN').parentElement).toHaveTextContent(/80\s*mm/);
    expect(card.getByText('Secondary-side Outlet DN').parentElement).toHaveTextContent(/65\s*mm/);
    expect(card.getByText('Flow Switch').parentElement).toHaveTextContent('Optional');

    unmount();
    mocks.get.mockClear();
    category = 'Pumping';
    renderDetail();
    expect(await screen.findByText('Plate heat exchanger')).toBeInTheDocument();
    expect(screen.queryByText('Thermal Specifications')).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalledWith(`/product-masters/${productId}/thermal`);
  });

  it('saves Thermal values, DN sizes, and the flow-switch option', async () => {
    const user = userEvent.setup();
    renderDetail();
    const card = await thermalCard();
    await user.click(card.getByRole('button', { name: 'Edit' }));

    const capacity = card.getByText('Thermal Capacity (kW)').nextElementSibling as HTMLInputElement;
    await user.clear(capacity);
    await user.type(capacity, '150');
    await user.selectOptions(card.getByText('Flow Switch').nextElementSibling as HTMLSelectElement, 'included');
    await user.click(card.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Thermal specifications saved'));
    expect(mocks.put).toHaveBeenCalledWith(
      `/product-masters/${productId}/thermal`,
      expect.objectContaining({
        thermal_capacity_kw: 150,
        primary_inlet_dn_mm: 80,
        primary_outlet_dn_mm: 80,
        secondary_inlet_dn_mm: 65,
        secondary_outlet_dn_mm: 65,
        flow_switch_status: 'included',
      }),
    );
    expect(card.getByText('Included')).toBeInTheDocument();
  });

  it('rejects an inverted operating-temperature range before calling the API', async () => {
    thermal.operating_temperature_min_c = 40;
    thermal.operating_temperature_max_c = 20;
    const user = userEvent.setup();
    renderDetail();
    const card = await thermalCard();
    await user.click(card.getByRole('button', { name: 'Edit' }));
    await user.click(card.getByRole('button', { name: 'Save' }));

    expect(mocks.toastError).toHaveBeenCalledWith('Minimum operating temperature cannot exceed maximum operating temperature');
    expect(mocks.put).not.toHaveBeenCalled();
    expect(card.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});