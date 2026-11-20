import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeftNav from './LeftNav';
import { useAuthStore } from '../../store/authStore';

function renderNav(props: Partial<React.ComponentProps<typeof LeftNav>> = {}) {
  return render(
    <MemoryRouter>
      <LeftNav collapsed={false} onToggleCollapsed={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

function CollapsibleNavHarness() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <MemoryRouter>
      <LeftNav
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(value => !value)}
      />
    </MemoryRouter>
  );
}

describe('LeftNav accessibility behavior', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        moduleAccess: {},
      },
      token: 'test-token',
      isLoading: false,
    });
  });

  it('exposes and preserves the expanded state of collapsible navigation sections', async () => {
    const user = userEvent.setup();
    renderNav();

    const sectionToggle = screen.getByRole('button', { name: 'Collapse Engineering' });
    expect(sectionToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Components' })).toBeVisible();

    await user.click(sectionToggle);
    expect(screen.getByRole('button', { name: 'Expand Engineering' }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Components' })).not.toBeInTheDocument();
    // Shared records stay one click away regardless of department sections.
    expect(screen.getByRole('link', { name: 'Products' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Expand Engineering' }));
    expect(screen.getByRole('button', { name: 'Collapse Engineering' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Components' })).toBeVisible();
  });

  it('makes the Platform Admin menu keyboard-operable and restores focus on close', async () => {
    const user = userEvent.setup();
    renderNav();

    const trigger = screen.getByRole('button', { name: 'Platform Admin' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Platform Admin' });
    const firstItem = screen.getByRole('menuitem', { name: 'Families' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(firstItem);

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Materials' }));

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Audit Log' }));

    await user.keyboard('{Escape}');
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('labels the sidebar toggle in both states', async () => {
    const user = userEvent.setup();
    render(<CollapsibleNavHarness />);

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('title', 'Collapse sidebar');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand sidebar' }))
      .toHaveAttribute('title', 'Expand sidebar');
  });

  it('does not render modules hidden for the current role', () => {
    useAuthStore.setState({
      user: {
        id: 'engineer-1',
        email: 'engineer@example.com',
        firstName: 'Design',
        lastName: 'Engineer',
        role: 'engineer',
        moduleAccess: { pim: 'hidden', orders: 'view' },
      },
    });

    renderNav();

    expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Components' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Purchase Orders' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Platform Admin' })).not.toBeInTheDocument();
  });

  it('opens only the department area by default and remembers the person\'s own choice', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      user: { id: 'eng-2', email: 'e@example.com', firstName: 'E', lastName: 'Ng', role: 'engineer', department: 'engineering', moduleAccess: {} },
    });

    const { unmount } = renderNav();
    expect(screen.getByRole('button', { name: 'Collapse Engineering' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Expand Procurement' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Purchase Orders' })).not.toBeInTheDocument();
    // Empty future areas are not shown to other departments.
    expect(screen.queryByRole('button', { name: /Logistics/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand Procurement' }));
    unmount();
    renderNav();
    expect(screen.getByRole('link', { name: 'Purchase Orders' })).toBeVisible();
  });

  it('shows the empty Logistics area to logistics people with a placeholder', () => {
    useAuthStore.setState({
      user: { id: 'log-1', email: 'l@example.com', firstName: 'L', lastName: 'Og', role: 'user', department: 'logistics', moduleAccess: {} },
    });

    renderNav();
    expect(screen.getByRole('button', { name: 'Collapse Logistics' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Nothing here yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Factory/ })).not.toBeInTheDocument();
  });

  it('shows only Thermal governance to engineers with Design Book manage access', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      user: {
        id: 'engineer-1',
        email: 'engineer@example.com',
        firstName: 'Design',
        lastName: 'Engineer',
        role: 'engineer',
        moduleAccess: { design_books: 'manage' },
      },
    });

    renderNav();
    await user.click(screen.getByRole('button', { name: 'Platform Admin' }));

    expect(screen.getByRole('menuitem', { name: 'Thermal Wall Constructions' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Users' })).not.toBeInTheDocument();
  });
  it('links each department area to its settings when the person can manage some', () => {
    renderNav();
    expect(screen.getByRole('link', { name: 'Engineering settings' })).toHaveAttribute('href', '/admin/engineering');
    expect(screen.getByRole('link', { name: 'Procurement settings' })).toHaveAttribute('href', '/admin/procurement');
    // Business Development has nothing to configure yet.
    expect(screen.queryByRole('link', { name: 'Business Development settings' })).not.toBeInTheDocument();
  });

  it('shows engineers only the Engineering settings link they can use', () => {
    useAuthStore.setState({
      user: { id: 'eng-3', email: 'e@example.com', firstName: 'E', lastName: 'Ng', role: 'engineer', moduleAccess: { design_books: 'manage' } },
    });
    renderNav();
    expect(screen.getByRole('link', { name: 'Engineering settings' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Procurement settings' })).not.toBeInTheDocument();
  });
});