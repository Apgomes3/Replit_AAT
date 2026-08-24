import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LeftNav from '../components/layout/LeftNav';
import { findUnnamedIconOnlyControls } from './accessibility';

describe('core surface accessible names', () => {
  it('does not ship unnamed icon-only controls in the dialog or navigation', () => {
    const dialog = render(
      <ConfirmDialog
        title="Delete item"
        message="This action cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(findUnnamedIconOnlyControls(dialog.baseElement)).toEqual([]);
    dialog.unmount();

    const navigation = render(
      <MemoryRouter>
        <LeftNav collapsed={false} onToggleCollapsed={vi.fn()} />
      </MemoryRouter>,
    );
    expect(findUnnamedIconOnlyControls(navigation.container)).toEqual([]);
    navigation.unmount();

    const collapsedNavigation = render(
      <MemoryRouter>
        <LeftNav collapsed onToggleCollapsed={vi.fn()} />
      </MemoryRouter>,
    );
    expect(findUnnamedIconOnlyControls(collapsedNavigation.container)).toEqual([]);
  });
});