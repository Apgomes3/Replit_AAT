import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  query: vi.fn(),
  default: {},
}));

import { query } from '../db';
import { requireModuleAccess } from './auth';

function responseStub() {
  const response: any = {};
  response.status = vi.fn(() => response);
  response.json = vi.fn(() => response);
  return response;
}

describe('requireModuleAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks direct API access when the role hides the module', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ access_level: 'hidden' }] } as any);
    const response = responseStub();
    const next = vi.fn();

    await requireModuleAccess('design_books')(
      { user: { id: 'user-1' } } as any,
      response,
      next,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'MODULE_HIDDEN' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('preserves visible access for existing roles without a configured row', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
    const response = responseStub();
    const next = vi.fn();

    await requireModuleAccess('pim')(
      { user: { id: 'user-1' } } as any,
      response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});