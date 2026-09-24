import { describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import api from './api';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

describe('failed mutation feedback', () => {
  it('shows a safe reference and warns against blindly retrying an ambiguous creation', async () => {
    await expect(api.post('/records', {}, {
      adapter: async config => Promise.reject({ config, response: { status: 503, headers: { 'x-correlation-id': '12345678-1234-1234-1234-123456789abc' } } }),
    })).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Review the record before retrying. Reference: 12345678-1234-1234-1234-123456789abc'));
  });
});