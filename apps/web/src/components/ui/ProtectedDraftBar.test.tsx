// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import ProtectedDraftBar, { clearRecoveryDraft, readRecoveryDraft } from './ProtectedDraftBar';

function Editor({ save = vi.fn(), error, initial = '', baseline = '' }: {
  save?: () => void;
  error?: any;
  initial?: string;
  baseline?: string;
}) {
  const [value, setValue] = useState(initial);
  const [server, setServer] = useState(baseline);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const navigate = useNavigate();
  return <>
    <input aria-label="Draft text" value={value} onChange={e => setValue(e.target.value)} />
    <ProtectedDraftBar storageKey="test:u1:record1" value={value} baseline={server} version="1"
      error={error} savedAt={savedAt} onRestore={setValue} onSave={save} onConflictReload={() => {
        setServer('new server text');
        setValue('new server text');
      }} />
    <button onClick={() => { setServer(value); setSavedAt(Date.now()); }}>Commit</button>
    <button onClick={() => navigate('/elsewhere')}>Leave</button>
  </>;
}
function mount(props: React.ComponentProps<typeof Editor> = {}) {
  const router = createMemoryRouter([
    { path: '/', element: <Editor {...props} /> },
    { path: '/elsewhere', element: <p>Other page</p> },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('protected draft recovery', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('backs up dirty work, warns on navigation, then restores after reopening', async () => {
    const app = mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft text' }), { target: { value: 'unfinished' } });
    expect(readRecoveryDraft('test:u1:record1')?.value).toBe('unfinished');
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Other page')).not.toBeInTheDocument();
    app.unmount();
    mount();
    expect(screen.getByRole('dialog', { name: 'Recover local draft' })).toHaveTextContent('A draft from /');
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
    expect(screen.getByRole('textbox', { name: 'Draft text' })).toHaveValue('unfinished');
  });

  it('discards a recovery copy and removes it after confirmed save', async () => {
    localStorage.setItem('shark-draft:test:u1:record1', JSON.stringify({
      value: 'old draft', savedAt: '2026-09-24T00:00:00.000Z', source: '/enquiries/1', version: '1',
    }));
    const app = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Discard local draft' }));
    expect(readRecoveryDraft('test:u1:record1')).toBeNull();
    app.unmount();
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft text' }), { target: { value: 'new draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(readRecoveryDraft('test:u1:record1')).toBeNull());
  });

  it('retains a failed or conflicting draft and permits explicit server selection', async () => {
    const error = { response: { status: 409, data: { error: {
      message: 'Someone changed it', current_record: { title: 'new server text', version: '2' },
    } } } };
    mount({ initial: 'my work', error });
    expect(screen.getByRole('status')).toHaveTextContent('Conflict');
    expect(readRecoveryDraft('test:u1:record1')?.value).toBe('my work');
    fireEvent.click(screen.getByText('Review newer server version'));
    expect(screen.getByText(/new server text/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Use newer server version/ }));
    await waitFor(() => expect(readRecoveryDraft('test:u1:record1')).toBeNull());
  });

  it('does not retry an old recovered draft against a newer server version', () => {
    const save = vi.fn();
    localStorage.setItem('shark-draft:test:u1:record1', JSON.stringify({
      value: 'older local changes', savedAt: '2026-09-24T00:00:00.000Z', source: '/design-books/1',
      version: '0',
    }));
    mount({ save, baseline: 'newer server changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
    expect(screen.getByRole('status')).toHaveTextContent('Conflict');
    expect(screen.queryByRole('button', { name: 'Save / retry' })).not.toBeInTheDocument();
    expect(readRecoveryDraft('test:u1:record1')?.version).toBe('0');
    expect(save).not.toHaveBeenCalled();
  });

  it('reports failed server requests without deleting recoverable work', () => {
    mount({ initial: 'unsent', error: { response: { status: 503, data: { error: { message: 'Unavailable' } } } } });
    expect(screen.getByRole('status')).toHaveTextContent('Save failed');
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
    expect(readRecoveryDraft('test:u1:record1')?.value).toBe('unsent');
  });

  it('does not warn for clean work; offline edits remain locally recoverable', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByText('Other page')).toBeInTheDocument();
    clearRecoveryDraft('test:u1:record1');
    const app = mount();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft text' }), { target: { value: 'offline edit' } });
    expect(screen.getByRole('status')).toHaveTextContent('Offline');
    expect(readRecoveryDraft('test:u1:record1')?.value).toBe('offline edit');
    app.unmount();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });
});