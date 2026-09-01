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

const productId = 'pneumatic-product-1';
const product = {
  id: productId,
  product_code: 'AIR-100',
  product_name: 'Air dryer',
  product_category: 'Pneumatic',
  standard_status: 'Active',
  product_family_id: null,
  product_family_name: null,
  boms: [],
  documents: [],
  vendors: [],
  projects: [],
  synonyms: [],
};

let pneumatic: Record<string, unknown>;

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
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

async function pneumaticCard() {
  const title = await screen.findByText('Pneumatic Specifications');
  const card = title.parentElement?.parentElement;
  if (!card) throw new Error('Could not find Pneumatic Specifications card');
  return within(card);
}

describe('ProductMasterDetail pneumatic save flow', () => {
  beforeEach(() => {
    pneumatic = {};
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === `/product-masters/${productId}`) return { data: product };
      if (url === `/product-masters/${productId}/pneumatic`) return { data: { ...pneumatic } };
      return { data: { items: [] } };
    });
    mocks.put.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url !== `/product-masters/${productId}/pneumatic`) return { data: {} };
      pneumatic = { ...body };
      return { data: { ...pneumatic } };
    });
  });

  it('rejects a populated value without a unit and keeps the editor usable', async () => {
    pneumatic = { gas_flow_value: 125.5, gas_flow_unit: null };
    const user = userEvent.setup();
    renderDetail();
    const card = await pneumaticCard();

    await user.click(card.getByRole('button', { name: 'Edit' }));
    await user.click(card.getByRole('button', { name: 'Save' }));

    expect(mocks.toastError).toHaveBeenCalledWith('Gas flow requires a unit');
    expect(mocks.put).not.toHaveBeenCalled();
    expect(card.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(card.getByLabelText('Gas Flow unit')).toHaveValue('');
  });

  it('saves supported values, exits edit mode, and renders the confirmed response', async () => {
    pneumatic = {
      gas_flow_value: 125.5,
      gas_flow_unit: 'm3/h',
      operating_temperature_value: -5,
      operating_temperature_unit: '°C',
      dew_point_value: -40,
      dew_point_unit: '°C',
      inlet_port_value: 2,
      inlet_port_unit: 'in',
      outlet_port_value: 50,
      outlet_port_unit: 'DN',
    };
    const user = userEvent.setup();
    renderDetail();
    const card = await pneumaticCard();

    await user.click(card.getByRole('button', { name: 'Edit' }));
    await user.click(card.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Pneumatic specifications saved'));
    expect(mocks.put).toHaveBeenCalledWith(
      `/product-masters/${productId}/pneumatic`,
      expect.objectContaining({
        gas_flow_value: 125.5,
        gas_flow_unit: 'm3/h',
        dew_point_value: -40,
        dew_point_unit: '°C',
      }),
    );
    expect(card.getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(card.getByText('125.5').parentElement).toHaveTextContent(/125\.5\s*m3\/h/);
    expect(card.getByText('-40').parentElement).toHaveTextContent(/-40\s*°C/);
  });

  it('surfaces an API rejection and restores Save so the user can retry', async () => {
    pneumatic = { gas_flow_value: 88, gas_flow_unit: 'SCFM' };
    mocks.put
      .mockRejectedValueOnce({
        response: {
          data: {
            error: { message: 'Manage access is required for this module.' },
          },
        },
      })
      .mockImplementationOnce(async (_url: string, body: Record<string, unknown>) => ({
        data: { ...body },
      }));
    const user = userEvent.setup();
    renderDetail();
    const card = await pneumaticCard();

    await user.click(card.getByRole('button', { name: 'Edit' }));
    await user.click(card.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Manage access is required for this module.'));
    expect(card.getByRole('button', { name: 'Save' })).toBeEnabled();

    await user.click(card.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Pneumatic specifications saved'));
    expect(card.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });
});