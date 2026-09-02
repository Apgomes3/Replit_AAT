import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductMasterDetail from './ProductMasterDetail';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
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

vi.mock('../../components/ui/PageHeader', () => ({
  default: ({
    crumbs,
    actions,
  }: {
    crumbs: { label: string; href?: string }[];
    actions?: React.ReactNode;
  }) => (
    <>
      <nav aria-label="Breadcrumb">
        {crumbs.map(crumb => crumb.href
          ? <Link key={crumb.label} to={crumb.href}>{crumb.label}</Link>
          : <span key={crumb.label}>{crumb.label}</span>)}
      </nav>
      {actions}
    </>
  ),
}));

const assignedProduct = {
  id: 'assigned-1',
  product_code: 'P-ASSIGNED',
  product_name: 'Assigned pump',
  product_category: 'Pumping',
  standard_status: 'Active',
  product_family_id: 'family/north',
  product_family_name: 'Pumps / North',
  lamp_count: 2,
  power_kw: 0.9,
  boms: [],
  documents: [],
  vendors: [],
  projects: [],
  synonyms: [],
};

const unassignedProduct = {
  ...assignedProduct,
  id: 'unassigned-1',
  product_code: 'P-UNASSIGNED',
  product_name: 'Unassigned pump',
  product_family_id: null,
  product_family_name: null,
};

let product = assignedProduct;

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/products/masters/${product.id}`]}>
        <Routes>
          <Route path="/products/masters/:id" element={<ProductMasterDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductMasterDetail family breadcrumb', () => {
  beforeEach(() => {
    product = assignedProduct;
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.put.mockResolvedValue({ data: {} });
    mocks.get.mockImplementation(async (url: string) => {
      if (url === `/product-masters/${product.id}`) return { data: product };
      return { data: { items: [] } };
    });
  });

  it('links the assigned family back to its filtered product list', async () => {
    renderDetail();

    const familyLink = await screen.findByRole('link', { name: 'Pumps / North' });
    expect(familyLink).toHaveAttribute('href', '/products/masters?family=family%2Fnorth');
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/products/masters');
  });

  it('keeps the general Products destination for unassigned products', async () => {
    product = unassignedProduct;
    renderDetail();

    expect(await screen.findByText('P-UNASSIGNED')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pumps / North' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/products/masters');
  });

  it('keeps Design Flow and Design Head editable only in the Hydraulic card', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText('P-ASSIGNED');
    await user.click(screen.getAllByRole('button', { name: 'Edit', exact: true })[0]);

    expect(screen.queryByText('Design Flow (m³/h)')).not.toBeInTheDocument();
    expect(screen.queryByText('Design Head (m)')).not.toBeInTheDocument();
    expect(screen.getByText('Hydraulic')).toBeInTheDocument();
  });

  it('maintains the PIM-owned Lamp Count from the Electrical card', async () => {
    const user = userEvent.setup();
    renderDetail();

    const electricalCard = (await screen.findByText('Electrical')).closest('.bg-white') as HTMLElement;
    await user.click(within(electricalCard).getByRole('button', { name: 'Edit' }));
    const lampCountInput = within(electricalCard).getByText('Lamp Count').nextElementSibling as HTMLInputElement;
    expect(lampCountInput).toHaveValue(2);

    await user.clear(lampCountInput);
    await user.type(lampCountInput, '4');
    await user.click(within(electricalCard).getByRole('button', { name: 'Save' }));

    expect(mocks.put).toHaveBeenCalledWith(
      `/product-masters/${assignedProduct.id}/electrical`,
      expect.objectContaining({ lamp_count: 4, rated_power_kw: 0.9 }),
    );
  });
});
