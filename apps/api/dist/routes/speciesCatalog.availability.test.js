"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const speciesCatalog_1 = require("./speciesCatalog");
(0, vitest_1.describe)('species catalog availability contract', () => {
    (0, vitest_1.it)('uses server-side cancellation and recovers the read pool after a timeout', async () => {
        (0, vitest_1.expect)(speciesCatalog_1.catalogPoolOptions.connectionTimeoutMillis).toBe(2500);
        (0, vitest_1.expect)(speciesCatalog_1.catalogPoolOptions.statement_timeout).toBe(2500);
        (0, vitest_1.expect)(speciesCatalog_1.catalogPoolOptions.query_timeout).toBeGreaterThan(speciesCatalog_1.catalogPoolOptions.statement_timeout);
        const started = Date.now();
        await (0, vitest_1.expect)((0, speciesCatalog_1.catalogQuery)('SELECT pg_sleep(5)')).rejects.toMatchObject({
            code: 'CATALOG_UNAVAILABLE',
            status: 503,
            retryable: true,
        });
        (0, vitest_1.expect)(Date.now() - started).toBeLessThan(4000);
        await (0, vitest_1.expect)((0, speciesCatalog_1.catalogQuery)('SELECT true AS ready')).resolves.toMatchObject({
            rows: [{ ready: true }],
        });
    }, 8000);
    (0, vitest_1.it)('returns the retryable 503 response contract', () => {
        const json = vitest_1.vi.fn();
        const status = vitest_1.vi.fn(() => ({ json }));
        const res = { status };
        (0, speciesCatalog_1.sendCatalogError)(res, new speciesCatalog_1.CatalogUnavailableError('Please retry.'));
        (0, vitest_1.expect)(status).toHaveBeenCalledWith(503);
        (0, vitest_1.expect)(json).toHaveBeenCalledWith({
            error: {
                code: 'CATALOG_UNAVAILABLE',
                message: 'Please retry.',
                retryable: true,
            },
        });
    });
});
