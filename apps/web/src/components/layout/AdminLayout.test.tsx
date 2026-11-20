import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import AdminLayout from './AdminLayout';
import AdminHome from '../../pages/admin/AdminHome';
import { useAuthStore } from '../../store/authStore';

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="admin" element={<AdminHome />} />
        <Route path="admin/:domain" element={<AdminHome />} />
        <Route path="admin/pump-duty-types" element={<p>pump page</p>} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe('AdminLayout and department pages', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({ user: { id: 'a', email: 'a@example.com', firstName: 'A', lastName: 'D', role: 'admin', moduleAccess: {} } });
  });

  it('shows the department side list around an admin page', () => {
    renderAt('/admin/pump-duty-types');
    const rail = screen.getByRole('complementary', { name: 'Engineering settings' });
    expect(rail).toHaveTextContent('UV Engineering Products');
    expect(rail).not.toHaveTextContent('Audit Log');
    expect(screen.getByRole('link', { name: 'Pump Duty Types' })).toHaveClass('text-blue-700');
    expect(screen.getByText('pump page')).toBeInTheDocument();
  });

  it('shows only one department at /admin/<department>', () => {
    renderAt('/admin/platform');
    expect(screen.getByRole('heading', { level: 1, name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Platform' })).toHaveTextContent('Audit Log');
    expect(screen.queryByRole('region', { name: 'Engineering' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
