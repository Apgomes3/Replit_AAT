import { describe, expect, it, vi } from 'vitest';
import { findCreateRetry } from './createIdempotency';

describe('create retry isolation', () => {
  it('locks a key within its user and record type before checking for an existing row', async () => {
    const query = vi.fn(async (_sql: string, _params?: any[]) => ({ rows: [] }));
    const db = { query };
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await findCreateRetry(db, 'enquiries', 'user-a', key);
    await findCreateRetry(db, 'purchase_orders', 'user-a', key);
    await findCreateRetry(db, 'enquiries', 'user-b', key);
    expect(query.mock.calls[0][1]).toEqual([`enquiries:user-a:${key}`]);
    expect(query.mock.calls[2][1]).toEqual([`purchase_orders:user-a:${key}`]);
    expect(query.mock.calls[4][1]).toEqual([`enquiries:user-b:${key}`]);
    expect(query.mock.calls[1][1]).toEqual(['user-a', key]);
    expect(query.mock.calls[3][1]).toEqual(['user-a', key]);
    expect(query.mock.calls[5][1]).toEqual(['user-b', key]);
  });
});