import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import AdminThermalWallConstructions, { canManageThermalWalls } from './AdminThermalWallConstructions';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const current = {
  id: 'wall-2',
  code: 'acrylic',
  label: 'Acrylic',
  material: 'Acrylic / PMMA',
  thickness_mm: 20,
  conductivity_w_m_k: 0.19,
  basis_version: 'WALL-V2',
  source_basis: 'AAT Foundations',
  source_reference: 'Controlled wall schedule',
  approval: {
    status: 'approved',
    approved_at: '2026-09-01T00:00:00.000Z',
    approved_by_name: 'Alex Chen',
  },
};

const superseded = {
  ...current,
  id: 'wall-1',
  thickness_mm: 12,
  basis_version: 'WALL-V1',
  approval: {
    status: 'superseded',
    approved_at: '2026-08-01T00:00:00.000Z',
    superseded_at: '2026-09-01T00:00:00.000Z',
    superseded_by_name: 'Alex Chen',
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminThermalWallConstructions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Thermal wall construction administration', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: { items: [current, superseded] } } as any);
    useAuthStore.setState({
      user: {
        id: 'engineer-1',
        email: 'engineer@example.com',
        firstName: 'Alex',
        lastName: 'Chen',
        role: 'engineer',
        moduleAccess: { design_books: 'manage' },
      },
      token: 'test-token',
      isLoading: false,
    });
  });

  it('shows current and superseded versions in Platform Admin', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Thermal Wall Materials' })).toBeVisible();
    expect(await screen.findByText('WALL-V2')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Manage conductivity' }));

    expect(await screen.findByText('Approved and superseded conductivity history')).toBeVisible();
    expect(screen.getByText(/Acrylic · WALL-V1/)).toBeVisible();
    expect(screen.getAllByText(/Superseded/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Preview and approve' })).toBeDisabled();
  });

  it('requires an authorized engineering role and Design Book manage access', () => {
    expect(canManageThermalWalls(useAuthStore.getState().user)).toBe(true);
    expect(canManageThermalWalls({
      ...useAuthStore.getState().user!,
      moduleAccess: { design_books: 'view' },
    })).toBe(false);
    expect(canManageThermalWalls({
      ...useAuthStore.getState().user!,
      role: 'viewer',
    })).toBe(false);
  });
});