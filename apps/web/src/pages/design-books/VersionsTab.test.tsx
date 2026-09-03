import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VersionCard } from './VersionsTab';

describe('Design Book version restore entry point', () => {
  it('allows a fresh restore preview when list metadata reports a blocker', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(
      <VersionCard
        version={{
          id: 'version-1',
          version_number: 1,
          version_label: 'Milestone',
          created_at: '2026-09-03T08:00:00.000Z',
          summary: { integrity: 'invalid' },
          drift: { unresolved_references: [{ type: 'tank', id: 'tank-1' }] },
        }}
        latest
        onRestore={onRestore}
        restoring={false}
        readOnly={false}
      />,
    );

    const restore = screen.getByRole('button', { name: 'Restore' });
    expect(restore).toBeEnabled();
    await user.click(restore);
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'version-1' }));
  });
});