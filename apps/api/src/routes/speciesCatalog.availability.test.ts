import { describe, expect, it, vi } from 'vitest';
import {
  catalogPoolOptions,
  catalogQuery,
  CatalogUnavailableError,
  sendCatalogError,
} from './speciesCatalog';

describe('species catalog availability contract', () => {
  it('uses server-side cancellation and recovers the read pool after a timeout', async () => {
    expect(catalogPoolOptions.connectionTimeoutMillis).toBe(2_500);
    expect(catalogPoolOptions.statement_timeout).toBe(2_500);
    expect(catalogPoolOptions.query_timeout).toBeGreaterThan(catalogPoolOptions.statement_timeout as number);
    const started = Date.now();

    await expect(catalogQuery('SELECT pg_sleep(5)')).rejects.toMatchObject({
      code: 'CATALOG_UNAVAILABLE',
      status: 503,
      retryable: true,
    });

    expect(Date.now() - started).toBeLessThan(4_000);
    await expect(catalogQuery<{ ready: boolean }>('SELECT true AS ready')).resolves.toMatchObject({
      rows: [{ ready: true }],
    });
  }, 8_000);

  it('returns the retryable 503 response contract', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as any;

    sendCatalogError(res, new CatalogUnavailableError('Please retry.'));

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'CATALOG_UNAVAILABLE',
        message: 'Please retry.',
        retryable: true,
      },
    });
  });
});