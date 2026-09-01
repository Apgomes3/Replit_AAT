import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import DocumentDetail from './DocumentDetail';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../components/ui/ActivityLog', () => ({ default: () => null }));

const apiGet = vi.mocked(api.get);
const apiPut = vi.mocked(api.put);

const content = {
  title: 'P-100 — Circulation Pump',
  generated_at: '2026-09-01T10:00:00.000Z',
  sections: {
    identity: { product_code: 'P-100', product_name: 'Circulation Pump', manufacturer: null, image_url: null },
    classification: { product_category: 'Pumping', classifier_values: [{ label: 'Connection size', value_text: '80', unit: 'DN' }] },
    engineering_values: { design_flow_m3h: 25, design_pressure_bar: null },
    materials: { primary_material_code: 'SS316' },
    dimensions: { length_mm: 1000 },
    electrical: { voltage_v: 400 },
    hydraulic: { design_flow_m3h: 25 },
    pneumatic: null,
    bill_of_materials: [{ bom_code: 'BOM-1', revision_code: 'A', lines: [{ component_name: 'Motor', quantity: 1, unit: 'ea' }] }],
    vendors: [{ vendor_name: 'Vendor A', vendor_item_code: 'VA-1', approved_status: 'Approved' }],
    notes: 'Current document wording',
  },
  unavailable_fields: ['manufacturer', 'design_pressure_bar'],
};

const generatedDocument = {
  id: 'document-1',
  document_code: 'P-100-TDS',
  document_title: 'Pump Technical Data Sheet',
  document_type: 'Technical Data Sheet',
  status: 'Draft',
  current_revision: 'A',
  generated_source: 'pim_tds',
  projects: [],
  approvals: [],
  revisions: [{
    id: 'revision-1',
    revision_code: 'A',
    status: 'Draft',
    generated_at: '2026-09-01T10:00:00.000Z',
    content,
    source_snapshot: { product: { product_name: 'Authoritative source name' } },
    created_at: '2026-09-01T10:00:00.000Z',
  }],
};

function renderPage(document = generatedDocument) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/documents/document-1']}>
        <Routes><Route path="/documents/:id" element={<DocumentDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('generated TDS document workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: {
        id: 'engineer-1',
        email: 'engineer@example.com',
        firstName: 'Design',
        lastName: 'Engineer',
        role: 'engineer',
        moduleAccess: {},
      },
      token: 'test-token',
      isLoading: false,
    });
    apiGet.mockImplementation((url: string) => {
      if (url === '/documents/document-1') return Promise.resolve({ data: generatedDocument });
      if (url.startsWith('/lifecycle/')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: [] } });
    });
    apiPut.mockResolvedValue({ data: generatedDocument.revisions[0] } as any);
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  it('shows formatted current-revision content and opens focused Web View and Print Preview actions', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'P-100 — Circulation Pump' })).toBeVisible();
    expect(screen.getByText('Current document wording')).toBeVisible();
    expect(screen.getByText(/manufacturer, design pressure bar/i)).toBeVisible();
    expect(screen.queryByText(/"source_snapshot"/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview / Print' }));
    expect(screen.getByRole('menuitem', { name: 'Web View' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Print Preview' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview / Print' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Preview / Print' }));
    await user.click(screen.getByRole('menuitem', { name: 'Web View' }));
    expect(screen.getByText('Web View')).toBeVisible();
    expect(screen.getAllByRole('heading', { name: 'P-100 — Circulation Pump' })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Preview / Print' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Preview / Print' }));
    await user.click(screen.getByRole('menuitem', { name: 'Print Preview' }));
    expect(screen.getByText('Print Preview')).toBeVisible();
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    expect(document.body).toHaveClass('tds-printing');
    expect(document.querySelectorAll('.tds-workspace-overlay > .tds-print-sheet')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass('tds-printing');
  });

  it('edits supported fields without exposing JSON and saves document-owned content', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Edit Draft/i }));
    expect(screen.queryByText(JSON.stringify(content))).not.toBeInTheDocument();
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Reviewer pump sheet');
    await user.clear(screen.getByLabelText('Document notes'));
    await user.type(screen.getByLabelText('Document notes'), 'Reviewer notes');
    const designFlow = screen.getAllByLabelText('Design Flow M3h')[0];
    await user.clear(designFlow);
    await user.type(designFlow, '30');
    await user.click(screen.getByRole('button', { name: /Save Draft/i }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/documents/document-1/revisions/revision-1/content',
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Reviewer pump sheet',
          sections: expect.objectContaining({
            notes: 'Reviewer notes',
            engineering_values: expect.objectContaining({ design_flow_m3h: 30 }),
          }),
        }),
      }),
    ));
  });

  it('keeps preview and print available for view-only users while hiding editing', async () => {
    useAuthStore.setState(state => ({
      ...state,
      user: state.user ? { ...state.user, moduleAccess: { documents: 'view' } } : null,
    }));
    renderPage();

    expect(await screen.findByRole('button', { name: 'Preview / Print' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Edit Draft/i })).not.toBeInTheDocument();
  });

  it('does not offer preview actions when the generated revision has no content', async () => {
    const sparse = {
      ...generatedDocument,
      revisions: [{ ...generatedDocument.revisions[0], content: null }],
    } as any;
    apiGet.mockImplementation((url: string) => Promise.resolve({ data: url === '/documents/document-1' ? sparse : { items: [] } }));
    renderPage(sparse);

    expect(await screen.findByText('This revision has no structured generated content.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Preview / Print' })).not.toBeInTheDocument();
  });
});