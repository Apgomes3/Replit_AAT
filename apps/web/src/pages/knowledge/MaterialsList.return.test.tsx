import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MaterialsList from './MaterialsList';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    put: vi.fn(),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <>
    <output data-testid="location-path">{location.pathname}</output>
    <output data-testid="location-state">{JSON.stringify(location.state)}</output>
  </>;
}

function renderMaterials() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{
        pathname: '/knowledge/materials',
        state: {
          returnTo: '/products/masters?family=family-1',
          returnContext: {
            type: 'product-create',
            materialName: 'Titanium Grade 2',
            draft: {
              product_code: 'PM-NEW-1',
              product_name: 'New circulation pump',
              product_family_id: 'family-1 — Pumps',
            },
          },
        },
      }]}>
        <LocationProbe />
        <MaterialsList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MaterialsList product-create return flow', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.get.mockResolvedValue({ data: { items: [] } });
    mocks.post.mockResolvedValue({
      data: {
        id: 'material-1',
        material_code: 'MAT-TI-G2',
        material_name: 'Titanium Grade 2',
        status: 'Active',
      },
    });
  });

  it('returns to the unfinished product with the created material selected', async () => {
    const user = userEvent.setup();
    renderMaterials();

    expect(screen.getByLabelText('Material Name*')).toHaveValue('Titanium Grade 2');
    await user.type(screen.getByLabelText('Material Code*'), 'MAT-TI-G2');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await user.click(await screen.findByRole('button', { name: 'Use MAT-TI-G2' }));

    expect(screen.getByTestId('location-path')).toHaveTextContent('/products/masters');
    const state = JSON.parse(screen.getByTestId('location-state').textContent || '{}');
    expect(state.resumeProductCreate).toMatchObject({
      draft: {
        product_code: 'PM-NEW-1',
        product_name: 'New circulation pump',
        product_family_id: 'family-1 — Pumps',
      },
      material: {
        material_code: 'MAT-TI-G2',
        material_name: 'Titanium Grade 2',
      },
    });
  });
});