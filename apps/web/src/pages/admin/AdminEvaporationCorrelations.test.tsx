import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import AdminEvaporationCorrelations, { canManageEvaporationCorrelations } from './AdminEvaporationCorrelations';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const agitationClass = {
  id: 'class-1',
  class_code: 'normal_circulation',
  class_name: 'Normal circulation',
  description: 'Continuous surface movement',
  guidance: 'Use for ordinary returns without aeration.',
  sort_order: 2,
  is_active: true,
};

const approved = {
  id: 'correlation-2',
  class_id: 'class-1',
  class_code: 'normal_circulation',
  class_name: 'Normal circulation',
  version: '2026.2',
  coefficient_kg_m2_s_kpa: 0.0000012,
  source_basis: 'AAT Foundations',
  source_document: 'Thermal basis',
  source_revision: '2',
  source_reference: 'ES-42',
  status: 'approved',
  approved_at: '2026-09-01T00:00:00.000Z',
  usage_count: 1,
};

const superseded = {
  ...approved,
  id: 'correlation-1',
  version: '2026.1',
  status: 'superseded',
  superseded_at: '2026-09-01T00:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminEvaporationCorrelations />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('evaporation correlation administration', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/usages')) {
        return {
          data: {
            correlation: approved,
            usages: [{
              design_book_id: 'book-1',
              design_book_status: 'Released',
              book_code: 'DB-001',
              book_title: 'Habitat',
              revision: 'A',
              project_code: 'P-001',
              project_name: 'Ocean Habitat',
              system_code: 'LSS-01',
              system_name: 'Main LSS',
              captured_at: '2026-09-01T00:00:00.000Z',
            }],
            impact_token: 'confirmed-impact',
          },
        } as any;
      }
      return { data: { classes: [agitationClass], items: [approved, superseded] } } as any;
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} } as any);
    vi.mocked(api.put).mockResolvedValue({ data: {} } as any);
    useAuthStore.setState({
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        moduleAccess: { design_books: 'manage' },
      },
      token: 'test-token',
      isLoading: false,
    });
  });

  it('shows classes, approved and superseded evidence, and supports class updates', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Evaporation Correlations' })).toBeVisible();
    expect(await screen.findByText('2026.2')).toBeVisible();
    expect(screen.getByText('2026.1')).toBeVisible();
    expect(screen.getAllByText('superseded').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Edit class' }));
    const nameInput = screen.getByLabelText('Class name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Standard circulation');
    await user.click(screen.getByRole('button', { name: 'Update class' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/thermal-correlations/classes/class-1',
      expect.objectContaining({ class_name: 'Standard circulation' }),
    ));
  });

  it('requires usage confirmation before approving a replacement version', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await screen.findByLabelText('Agitation class'), 'class-1');
    await user.type(screen.getByLabelText('New version'), '2026.3');
    await user.type(screen.getByLabelText('Coefficient (kg/m²·s·kPa)'), '0.0000013');
    await user.type(screen.getByLabelText('Source / reference'), 'ES-43');
    await user.click(screen.getByRole('button', { name: 'Approve version' }));

    expect(await screen.findByRole('heading', { name: 'normal_circulation · 2026.2' })).toBeVisible();
    expect(await screen.findByText('DB-001')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm and approve version' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/thermal-correlations/classes/class-1/versions',
      expect.objectContaining({
        version: '2026.3',
        impact_token: 'confirmed-impact',
      }),
    ));
  });

  it('allows only platform administrators to manage the library', () => {
    expect(canManageEvaporationCorrelations(useAuthStore.getState().user)).toBe(true);
    expect(canManageEvaporationCorrelations({
      ...useAuthStore.getState().user!,
      role: 'engineer',
    })).toBe(false);
  });
});