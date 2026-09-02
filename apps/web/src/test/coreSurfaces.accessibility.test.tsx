import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import CountryCombobox from '../components/ui/CountryCombobox';
import LeftNav from '../components/layout/LeftNav';
import AdminAuditLog from '../pages/admin/AdminAuditLog';
import ComponentsList from '../pages/products/ComponentsList';
import ProductMastersList from '../pages/products/ProductMastersList';
import ProjectsList from '../pages/projects/ProjectsList';
import { describeUnnamedIconOnlyControls, findUnnamedIconOnlyControls } from './accessibility';

function expectNamedIconControls(surface: string, container: HTMLElement) {
  const unnamed = findUnnamedIconOnlyControls(container);
  expect(describeUnnamedIconOnlyControls(surface, unnamed)).toEqual([]);
}

function CountryComboboxHarness() {
  const [country, setCountry] = useState('Canada');
  return <CountryCombobox value={country} onChange={setCountry} />;
}

function renderPage(
  page: React.ReactNode,
  entries: Array<[readonly unknown[], unknown]>,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
  entries.forEach(([key, value]) => queryClient.setQueryData(key, value));

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('core surface accessible names', () => {
  it('does not ship unnamed icon-only controls in shared controls, dialogs, or navigation', () => {
    const dialog = render(
      <ConfirmDialog
        title="Delete item"
        message="This action cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expectNamedIconControls('confirmation dialog', dialog.baseElement);
    dialog.unmount();

    const navigation = render(
      <MemoryRouter>
        <LeftNav collapsed={false} onToggleCollapsed={vi.fn()} />
      </MemoryRouter>,
    );
    expectNamedIconControls('expanded navigation', navigation.container);
    navigation.unmount();

    const collapsedNavigation = render(
      <MemoryRouter>
        <LeftNav collapsed onToggleCollapsed={vi.fn()} />
      </MemoryRouter>,
    );
    expectNamedIconControls('collapsed navigation', collapsedNavigation.container);
    collapsedNavigation.unmount();

    const countryCombobox = render(<CountryComboboxHarness />);
    expectNamedIconControls('country selector', countryCombobox.container);
  });

  it('does not ship unnamed icon-only controls on product list pages', () => {
    const components = renderPage(
      <ComponentsList />,
      [
        [['components', ''], { items: [{ id: 'component-1', component_code: 'P-100', component_name: 'Circulation Pump', component_type: 'Pump', component_category: 'Mechanical', status: 'Active', unit: 'EA' }] }],
        [['materials-list'], { items: [] }],
      ],
    );
    expectNamedIconControls('components list', components.container);
    components.unmount();

    const products = renderPage(
      <ProductMastersList />,
      [
        [['product-masters', '', false], { items: [{ id: 'product-1', product_code: 'P-200', product_name: 'Pump Assembly', product_category: 'Pumping', standard_status: 'Active', unit: 'EA' }] }],
        [['product-families'], { items: [] }],
        [['product-categories'], { items: [] }],
        [['materials-list'], { items: [] }],
      ],
    );
    expectNamedIconControls('product masters list', products.container);
    products.unmount();
  });

  it('filters components by material code and name while composing with category filters', () => {
    const components = renderPage(
      <ComponentsList />,
      [
        [['components', ''], {
          items: [
            {
              id: 'component-steel',
              component_code: 'P-100',
              component_name: 'Stainless Pump',
              component_type: 'Pump',
              component_category: 'Mechanical',
              primary_material_code: 'SS-316',
              material_name: 'Stainless Steel',
              status: 'Active',
              unit: 'EA',
            },
            {
              id: 'component-pvc',
              component_code: 'P-200',
              component_name: 'PVC Valve',
              component_type: 'Valve',
              component_category: 'Piping',
              primary_material_code: 'PVC-U',
              material_name: 'PVC',
              status: 'Active',
              unit: 'EA',
            },
            {
              id: 'component-no-material',
              component_code: 'P-300',
              component_name: 'Unspecified Fitting',
              component_type: 'Fitting',
              component_category: 'Piping',
              status: 'Draft',
              unit: 'EA',
            },
          ],
        }],
        [['materials-list'], { items: [] }],
      ],
    );

    fireEvent.click(screen.getByRole('button', { name: /^Filters$/ }));
    const materialFilter = screen.getByPlaceholderText('Material');

    expect(screen.getByText('Stainless Pump')).toBeInTheDocument();
    expect(screen.getByText('PVC Valve')).toBeInTheDocument();
    expect(screen.getByText('Unspecified Fitting')).toBeInTheDocument();

    fireEvent.change(materialFilter, { target: { value: 'ss-3' } });
    expect(screen.getByText('Stainless Pump')).toBeInTheDocument();
    expect(screen.queryByText('PVC Valve')).not.toBeInTheDocument();
    expect(screen.queryByText('Unspecified Fitting')).not.toBeInTheDocument();

    fireEvent.change(materialFilter, { target: { value: 'STAINLESS STE' } });
    expect(screen.getByText('Stainless Pump')).toBeInTheDocument();
    expect(screen.queryByText('PVC Valve')).not.toBeInTheDocument();
    expect(screen.queryByText('Unspecified Fitting')).not.toBeInTheDocument();

    fireEvent.change(materialFilter, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Piping/ }));
    expect(screen.queryByText('Stainless Pump')).not.toBeInTheDocument();
    expect(screen.getByText('PVC Valve')).toBeInTheDocument();
    expect(screen.getByText('Unspecified Fitting')).toBeInTheDocument();

    fireEvent.change(materialFilter, { target: { value: 'pvc' } });
    expect(screen.getByText('PVC Valve')).toBeInTheDocument();
    expect(screen.queryByText('Unspecified Fitting')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide Filters/ }));
    expect(screen.getByText('PVC Valve')).toBeInTheDocument();
    expect(screen.getByText('Unspecified Fitting')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Piping/ }));
    expect(screen.getByText('Stainless Pump')).toBeInTheDocument();

    components.unmount();
  });

  it('does not ship unnamed icon-only controls on project and admin list pages', () => {
    const projects = renderPage(
      <ProjectsList />,
      [[['projects', ''], {
        items: [{ id: 'project-1', project_code: 'PR-100', project_name: 'Marine Exhibit', client_name: 'Oceanic', project_status: 'Active' }],
        pagination: { total: 1 },
      }]],
    );
    expectNamedIconControls('projects list', projects.container);
    projects.unmount();

    const auditLog = renderPage(
      <AdminAuditLog />,
      [[['audit-logs', 1, '', '', '', '', '', ''], {
        items: [{
          id: 'audit-1',
          entity_type: 'project',
          entity_id: 'project-1',
          action: 'UPDATE',
          actor_id: 'user-1',
          actor_name: 'Avery Admin',
          actor_email: 'avery@example.com',
          details: { summary: 'Updated project details' },
          ip_address: null,
          created_at: '2026-08-24T12:00:00.000Z',
        }],
        pagination: { total: 1, pages: 1 },
      }]],
    );
    expectNamedIconControls('audit log', auditLog.container);
  });
});