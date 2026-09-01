import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductMasterDetail from './ProductMasterDetail';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  default: {
    get: mocks.get,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../components/ui/PageHeader', () => ({
  default: ({ crumbs }: { crumbs: { label: string; href?: string }[] }) => (
    <nav aria-label="Breadcrumb">
      {crumbs.map(crumb => crumb.href
        ? <Link key={crumb.label} to={crumb.href}>{crumb.label}</Link>
        : <span key={crumb.label}>{crumb.label}</span>)}
    </nav>
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
});
