import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductMastersList from './ProductMastersList';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  exportCsv: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    put: vi.fn(),
    patch: vi.fn(),
    delete: mocks.delete,
  },
}));

vi.mock('../../lib/exportCsv', () => ({
  exportCsv: mocks.exportCsv,
}));

const products = [
  {
    id: 'active-1',
    product_code: 'P-ACTIVE',
    product_name: 'Active pump',
    product_family_id: 'family-1',
    product_family_name: 'Pumps',
    product_category: 'Pumping',
    standard_status: 'Active',
  },
  {
    id: 'obsolete-1',
    product_code: 'P-OBSOLETE',
    product_name: 'Obsolete pump',
    product_family_id: 'family-1',
    product_family_name: 'Pumps',
    product_category: 'Pumping',
    standard_status: 'Obsolete',
  },
  {
    id: 'unassigned-1',
    product_code: 'P-UNASSIGNED',
    product_name: 'Unassigned product',
    product_category: 'Pumping',
    standard_status: 'Active',
  },
];

function LocationProbe() {
  const location = useLocation();
  return <>
    <output data-testid="location-search">{location.search}</output>
    <output data-testid="location-path">{location.pathname}</output>
    <output data-testid="location-state">{JSON.stringify(location.state)}</output>
  </>;
}

function renderList(initialEntries = ['/products/masters']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <LocationProbe />
        <ProductMastersList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductMastersList obsolete visibility', () => {
  beforeEach(() => {
    mocks.exportCsv.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.delete.mockReset();
    mocks.post.mockResolvedValue({ data: {} });
    mocks.delete.mockResolvedValue({ data: { deleted: true } });
    mocks.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/product-masters?')) {
        const params = new URLSearchParams(url.split('?')[1]);
        const includeObsolete = params.get('include_obsolete') === 'true';
        const search = params.get('q')?.toLowerCase() ?? '';
        const items = products.filter(product =>
          (includeObsolete || product.standard_status !== 'Obsolete')
          && (!search
            || product.product_name.toLowerCase().includes(search)
            || product.product_code.toLowerCase().includes(search)),
        );
        return { data: { items, pagination: { total: items.length } } };
      }
      if (url === '/product-families') {
        return {
          data: {
            items: [{
              id: 'family-1',
              product_family_name: 'Pumps',
              category_code: 'PUMP',
              description: 'Pump products',
              product_count: 2,
              }, {
                id: 'family-2',
                product_family_name: 'Other Pumps',
                category_code: 'PUMP',
                description: 'Other pump products',
                product_count: 0,
              }],
          },
        };
      }
      return { data: { items: [] } };
    });
  });

  it('keeps the active list context while revealing obsolete rows and exporting visible data', async () => {
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('Active pump')).toBeInTheDocument();
    expect(screen.queryByText('Obsolete pump')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All Products 2/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Pumps 1/ }));
    expect(screen.getByRole('heading', { name: 'Pumps' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show obsoleted' }));

    expect(await screen.findByText('Obsolete pump')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide obsoleted' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Pumps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All Products 3/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pumps 2/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(mocks.exportCsv).toHaveBeenCalledWith(
      expect.stringMatching(/^products-\d{4}-\d{2}-\d{2}\.csv$/),
      expect.any(Array),
      products.filter(product => product.product_family_id === 'family-1'),
    );

    await user.type(screen.getByPlaceholderText('Search by name or code...'), 'obsolete');

    await waitFor(() => {
      expect(screen.queryByText('Active pump')).not.toBeInTheDocument();
      expect(screen.getByText('Obsolete pump')).toBeInTheDocument();
    });
    expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining('include_obsolete=true'));
    expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining('q=obsolete'));
  });

  it('restores a family from the URL and keeps sidebar navigation in sync', async () => {
    const user = userEvent.setup();
    renderList(['/products/masters?family=family-1']);

    expect(await screen.findByRole('heading', { name: 'Pumps' })).toBeInTheDocument();
    expect(screen.getByText('Active pump')).toBeInTheDocument();
    expect(screen.queryByText('Unassigned product')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent('?family=family-1');

    await user.click(screen.getByRole('button', { name: /Other Pumps 0/ }));
    expect(screen.getByRole('heading', { name: 'Other Pumps' })).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent('?family=family-2');
    expect(screen.queryByText('Active pump')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /All Products 2/ }));
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent('');
    expect(screen.getByText('Unassigned product')).toBeInTheDocument();
  });

  it('quick-adds a sparse product in edit mode and exposes row editing', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Active pump');

    mocks.post.mockResolvedValueOnce({ data: { id: 'quick-product' } });
    await user.click(screen.getByRole('button', { name: 'Edit Mode' }));
    await user.type(screen.getByLabelText('Quick product code'), 'PM-QUICK-1');
    await user.type(screen.getByLabelText('Quick product name'), 'Quick entry product');
    await user.click(screen.getByRole('button', { name: 'Show obsoleted' }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/product-masters', {
        product_code: 'PM-QUICK-1',
        product_name: 'Quick entry product',
        product_family_id: null,
        product_category: null,
        standard_status: 'Concept',
      });
    });
    expect(screen.getByRole('button', { name: 'Edit P-ACTIVE' })).toBeInTheDocument();
    expect(screen.getByText('Enter the code and name. Click outside this area to save, or use Add Product.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Edit Product' })).not.toBeInTheDocument();
  });

  it('allows temporary product deletion from edit mode', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Active pump');

    await user.click(screen.getByRole('button', { name: 'Edit Mode' }));
    await user.click(screen.getByRole('button', { name: 'Delete P-ACTIVE' }));
    expect(screen.getByRole('heading', { name: 'Delete product?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mocks.delete).toHaveBeenCalledWith('/product-masters/active-1');
    });
  });

  it('opens Material Management with the unfinished product draft preserved', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Active pump');

    await user.click(screen.getByRole('button', { name: 'New Product' }));
    await user.type(screen.getByLabelText('Product Code*'), 'PM-NEW-1');
    await user.type(screen.getByLabelText('Product Name*'), 'New circulation pump');
    await user.selectOptions(screen.getByLabelText('Primary Material'), '__CREATE_NEW__');
    await user.type(screen.getByPlaceholderText('New Primary Material name…'), 'Titanium Grade 2');
    await user.click(screen.getAllByRole('button', { name: 'Create' })[0]);

    expect(screen.getByTestId('location-path')).toHaveTextContent('/knowledge/materials');
    const state = JSON.parse(screen.getByTestId('location-state').textContent || '{}');
    expect(state.returnTo).toBe('/products/masters');
    expect(state.returnContext).toMatchObject({
      type: 'product-create',
      materialName: 'Titanium Grade 2',
      draft: {
        product_code: 'PM-NEW-1',
        product_name: 'New circulation pump',
      },
    });
  });
});