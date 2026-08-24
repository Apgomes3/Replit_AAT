import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeftNav from './LeftNav';

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
  });

  it('exposes and preserves the expanded state of collapsible navigation sections', async () => {
    const user = userEvent.setup();
    renderNav();

    const sectionToggle = screen.getByRole('button', { name: 'Collapse PIM Management' });
    expect(sectionToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Products' })).toBeVisible();

    await user.click(sectionToggle);
    expect(screen.getByRole('button', { name: 'Expand PIM Management' }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand PIM Management' }));
    expect(screen.getByRole('button', { name: 'Collapse PIM Management' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Products' })).toBeVisible();
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
});