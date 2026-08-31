import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import LSSCompactUnitsCatalog, {
  mapProductMasterToCompactUnit,
  normalizeCompactUnitPayload,
  summarizeFiltration,
} from './LSSCompactUnitsCatalog';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);
const apiPut = vi.mocked(api.put);

const product = {
  id: 'product-1',
  product_code: 'PIM-CU-100',
  product_name: 'Product Master Compact 100',
  manufacturer: 'Aquatic Systems',
  design_flow_m3h: 21,
  power_kw: 3.1,
  length_mm: 1900,
};

const dimensions = {
  length_mm: 2000,
  width_mm: 900,
  height_mm: 1600,
  weight_kg: 450,
  inlet_dn_mm: 80,
  outlet_dn_mm: '100',
};

const hydraulic = {
  design_flow_m3h: 25,
  max_flow_m3h: 32,
};

const electrical = {
  rated_power_kw: 4.5,
};

const standardBom = {
  id: 'bom-1',
  bom_code: 'BOM-CU-100',
  revision_code: 'B',
};

const standardEquipment = [
  {
    source_bom_line_id: 'line-1',
    source_bom_id: 'bom-1',
    line_number: 1,
    component_type: 'Filter',
    component_reference_code: 'FLT-100',
    component_name: 'Drum Filter',
    quantity: 1,
    unit: 'EA',
    is_optional: false,
    included: true,
    is_filtration: true,
    size_or_power: '100 micron',
    is_custom: false,
  },
  {
    source_bom_line_id: 'line-2',
    source_bom_id: 'bom-1',
    line_number: 2,
    component_type: 'Pump',
    component_reference_code: 'PMP-1',
    component_name: 'Circulation Pump',
    quantity: 2,
    unit: 'EA',
    is_optional: true,
    included: true,
    is_filtration: false,
    size_or_power: '4 kW',
    is_custom: false,
  },
];

function renderCatalog(units: any[] = [], products: any[] = [product]) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/lss-compact-units') return Promise.resolve({ data: units });
    if (url === '/product-masters?page_size=500') return Promise.resolve({ data: { items: products } });
    if (url.endsWith('/dimensions')) return Promise.resolve({ data: dimensions });
    if (url.endsWith('/hydraulic')) return Promise.resolve({ data: hydraulic });
    if (url.endsWith('/electrical')) return Promise.resolve({ data: electrical });
    if (url.includes('/lss-compact-units/bom/')) {
      return Promise.resolve({ data: { available: true, reason: null, bom: standardBom, lines: standardEquipment } });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LSSCompactUnitsCatalog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Product Master compact-unit mapping', () => {
  it('uses dedicated specifications before compatible master fallbacks', () => {
    expect(mapProductMasterToCompactUnit(product, { dimensions, hydraulic, electrical })).toEqual({
      unit_code: 'PIM-CU-100',
      unit_name: 'Product Master Compact 100',
      manufacturer: 'Aquatic Systems',
      design_flow_m3h: 25,
      max_flow_m3h: 32,
      power_kw: 4.5,
      footprint_l_mm: 2000,
      footprint_w_mm: 900,
      height_mm: 1600,
      dry_weight_kg: 450,
      inlet_connection: 'DN80',
      outlet_connection: 'DN100',
    });
  });

  it('omits missing and LSS-only values rather than inventing them', () => {
    const mapped = mapProductMasterToCompactUnit(
      { product_code: 'PARTIAL', product_name: 'Partial Unit', power_kw: 2.2 },
      { dimensions: { width_mm: null }, hydraulic: {}, electrical: {} },
    );

    expect(mapped).toEqual({
      unit_code: 'PARTIAL',
      unit_name: 'Partial Unit',
      power_kw: 2.2,
    });
    expect(mapped).not.toHaveProperty('water_type');
    expect(mapped).not.toHaveProperty('min_tank_volume_m3');
    expect(mapped).not.toHaveProperty('includes_filtration');
    expect(mapped).not.toHaveProperty('uv_power_w');
    expect(mapped).not.toHaveProperty('break_tank_volume_l');
  });

  it('normalizes numeric values and an empty link for the request payload', () => {
    expect(normalizeCompactUnitPayload({
      unit_code: 'CU-1',
      unit_name: 'Compact One',
      manufacturer: '',
      water_type: '',
      min_tank_volume_m3: '',
      max_tank_volume_m3: '120',
      design_flow_m3h: '25.5',
      max_flow_m3h: '32',
      break_tank_volume_l: '',
      includes_filtration: '',
      uv_power_w: '',
      footprint_l_mm: '2000',
      footprint_w_mm: '900',
      height_mm: '1600',
      dry_weight_kg: '450',
      power_kw: '4.5',
      inlet_connection: 'DN80',
      outlet_connection: 'DN100',
      notes: '',
      product_master_id: '',
      status: 'Active',
    })).toMatchObject({
      max_tank_volume_m3: 120,
      design_flow_m3h: 25.5,
      max_flow_m3h: 32,
      min_tank_volume_m3: null,
      break_tank_volume_l: null,
      footprint_l_mm: 2000,
      power_kw: 4.5,
      product_master_id: null,
    });
  });

  it('does not fall back to legacy text when a structured checklist excludes all filtration', () => {
    expect(summarizeFiltration([
      {
        component_name: 'Drum Filter',
        quantity: 1,
        included: false,
        is_filtration: true,
      },
    ], 'Legacy foam filter')).toBe('');
  });
});

describe('LSS compact-unit Product Master prefilling', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiPost.mockResolvedValue({ data: { id: 'unit-1' } });
  });

  it('prefills a new unit, keeps fields editable, and sends an independent snapshot', async () => {
    const user = userEvent.setup();
    renderCatalog();

    await user.click(await screen.findByRole('button', { name: 'Add Unit' }));
    await user.selectOptions(screen.getByLabelText('Link to Product Master'), product.id);

    await waitFor(() => expect(screen.getByLabelText('Design Flow m³/h')).toHaveValue(25));
    expect(screen.getByLabelText('Unit Code *')).toHaveValue('PIM-CU-100');
    expect(screen.getByLabelText('Unit Name *')).toHaveValue('Product Master Compact 100');
    expect(screen.getByLabelText('Water Type')).toHaveValue('');
    expect(screen.getByLabelText('Min Volume m³')).toHaveValue(null);
    expect(screen.getByLabelText('Inlet Connection')).toHaveValue('DN80');

    fireEvent.change(screen.getByLabelText('Design Flow m³/h'), { target: { value: '27.5' } });
    fireEvent.change(screen.getByLabelText('Water Type'), { target: { value: 'Marine' } });
    await user.click(screen.getByRole('button', { name: 'Create Unit' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/lss-compact-units',
      expect.objectContaining({
        unit_code: 'PIM-CU-100',
        product_master_id: product.id,
        design_flow_m3h: 27.5,
        max_flow_m3h: 32,
        power_kw: 4.5,
        water_type: 'Marine',
        min_tank_volume_m3: null,
        uv_power_w: null,
      }),
    ));
  });

  it('preserves saved overrides when an edit form opens or its link changes', async () => {
    const user = userEvent.setup();
    const existing = {
      id: 'unit-existing',
      unit_code: 'OVERRIDE-1',
      unit_name: 'Saved LSS Override',
      manufacturer: 'Saved Manufacturer',
      design_flow_m3h: 19,
      product_master_id: product.id,
      status: 'Active',
    };
    const secondProduct = {
      ...product,
      id: 'product-2',
      product_code: 'PIM-CU-200',
      product_name: 'Product Master Compact 200',
    };
    renderCatalog([existing], [product, secondProduct]);

    await user.click(await screen.findByRole('button', { name: 'Edit OVERRIDE-1' }));
    expect(screen.getByLabelText('Unit Code *')).toHaveValue('OVERRIDE-1');
    expect(screen.getByLabelText('Design Flow m³/h')).toHaveValue(19);
    expect(apiGet).not.toHaveBeenCalledWith(`/product-masters/${product.id}/dimensions`);

    await user.selectOptions(screen.getByLabelText('Link to Product Master'), secondProduct.id);
    await screen.findByText('Specifications loaded as starting values. Compact-unit fields remain editable.');

    expect(screen.getByLabelText('Unit Code *')).toHaveValue('OVERRIDE-1');
    expect(screen.getByLabelText('Unit Name *')).toHaveValue('Saved LSS Override');
    expect(screen.getByLabelText('Design Flow m³/h')).toHaveValue(19);
  });

  it('shows a recoverable failure without disabling manual entry', async () => {
    const user = userEvent.setup();
    renderCatalog();
    await user.click(await screen.findByRole('button', { name: 'Add Unit' }));
    apiGet.mockImplementation((url: string) => {
      if (url.endsWith('/dimensions')) return Promise.reject(new Error('offline'));
      if (url.endsWith('/hydraulic') || url.endsWith('/electrical')) return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    await user.selectOptions(screen.getByLabelText('Link to Product Master'), product.id);
    expect(await screen.findByText(/specifications could not be loaded/i)).toBeVisible();

    const unitName = screen.getByLabelText('Unit Name *');
    expect(unitName).not.toBeDisabled();
    await user.type(unitName, 'Manual Compact Unit');
    expect(unitName).toHaveValue('Manual Compact Unit');
  });

  it('imports a BOM snapshot, supports checklist overrides, and saves provenance', async () => {
    const user = userEvent.setup();
    renderCatalog();
    await user.click(await screen.findByRole('button', { name: 'Add Unit' }));
    await user.selectOptions(screen.getByLabelText('Link to Product Master'), product.id);

    expect(await screen.findByDisplayValue('Drum Filter')).toBeVisible();
    expect(screen.getByDisplayValue('100 micron')).toBeVisible();
    expect(screen.getByText(/BOM-CU-100, Rev B/)).toBeVisible();

    await user.clear(screen.getByLabelText('Equipment quantity 1'));
    await user.type(screen.getByLabelText('Equipment quantity 1'), '3');
    await user.clear(screen.getByLabelText('Equipment size or power 1'));
    await user.type(screen.getByLabelText('Equipment size or power 1'), '80 micron');
    await user.click(screen.getByLabelText('Include Circulation Pump'));
    await user.click(screen.getByRole('button', { name: 'Create Unit' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/lss-compact-units',
      expect.objectContaining({
        source_bom_id: 'bom-1',
        source_bom_code: 'BOM-CU-100',
        source_bom_revision: 'B',
        includes_filtration: 'Drum Filter (80 micron)',
        equipment: expect.arrayContaining([
          expect.objectContaining({
            source_bom_line_id: 'line-1',
            quantity: '3',
            size_or_power_override: '80 micron',
            included: true,
          }),
          expect.objectContaining({
            source_bom_line_id: 'line-2',
            included: false,
          }),
        ]),
      }),
    ));
  });

  it('keeps legacy filtration editable and shows structured summaries in the catalog', async () => {
    const user = userEvent.setup();
    const legacy = {
      id: 'legacy-unit',
      unit_code: 'LEGACY-1',
      unit_name: 'Legacy Unit',
      includes_filtration: 'Foam + UV',
      status: 'Active',
      equipment: [],
    };
    renderCatalog([legacy]);
    expect(await screen.findByText('Foam + UV')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit LEGACY-1' }));
    expect(screen.getByLabelText('Legacy filtration description (editable)')).toHaveValue('Foam + UV');
    await user.clear(screen.getByLabelText('Legacy filtration description (editable)'));
    await user.type(screen.getByLabelText('Legacy filtration description (editable)'), 'Legacy sand filter');
    apiPut.mockResolvedValue({ data: legacy });
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/lss-compact-units/legacy-unit',
      expect.objectContaining({ includes_filtration: 'Legacy sand filter', equipment: [] }),
    ));
  });
});