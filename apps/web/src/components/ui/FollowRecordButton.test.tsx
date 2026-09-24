import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FollowRecordButton from './FollowRecordButton';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mount(id: string, client: QueryClient) {
  return render(<QueryClientProvider client={client}>
    <FollowRecordButton entityType="purchase_order" entityId={id} />
  </QueryClientProvider>);
}

describe('record follow control', () => {
  it('loads persisted status and toggles only the current record', async () => {
    let following = false;
    vi.mocked(api.get).mockImplementation(async () => ({ data: { following } } as any));
    vi.mocked(api.put).mockImplementation(async () => ({ data: { following: (following = true) } } as any));
    vi.mocked(api.delete).mockImplementation(async () => ({ data: { following: (following = false) } } as any));
    const id = '11111111-1111-4111-8111-111111111111';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = mount(id, client);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unfollow' })).not.toBeDisabled());
    expect(api.put).toHaveBeenCalledWith(`/notifications/subscriptions/purchase_order/${id}`);
    view.unmount();
    mount(id, new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unfollow' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false'));
    expect(api.delete).toHaveBeenCalledWith(`/notifications/subscriptions/purchase_order/${id}`);
  });

  it('does not offer a follow control when record access is denied', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 404 } });
    mount('22222222-2222-4222-8222-222222222222', new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  });
});