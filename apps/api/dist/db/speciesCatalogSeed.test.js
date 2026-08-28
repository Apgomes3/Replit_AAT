"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const speciesCatalogSeed_1 = require("./speciesCatalogSeed");
(0, vitest_1.describe)('reviewed species catalog artifact', () => {
    (0, vitest_1.it)('loads the reviewed stage-one records without a network request', async () => {
        const fetchSpy = vitest_1.vi.spyOn(globalThis, 'fetch');
        const records = await (0, speciesCatalogSeed_1.loadSpeciesCatalogStageOne)();
        (0, vitest_1.expect)(fetchSpy).not.toHaveBeenCalled();
        (0, vitest_1.expect)(speciesCatalogSeed_1.SPECIES_CATALOG_ARTIFACT.status).toBe('reviewed');
        (0, vitest_1.expect)(records).toHaveLength(speciesCatalogSeed_1.SPECIES_CATALOG_STAGE_ONE_SIZE);
        (0, vitest_1.expect)(new Set(records.map(record => record.scientific_name.toLowerCase())).size).toBe(records.length);
        fetchSpy.mockRestore();
    });
    (0, vitest_1.it)('inserts fresh records idempotently without updating or deleting existing identities', async () => {
        const query = vitest_1.vi.fn().mockResolvedValue({ rowCount: 1 });
        const seeded = await (0, speciesCatalogSeed_1.seedSpeciesCatalog)({ query }, null);
        (0, vitest_1.expect)(seeded).toBe(speciesCatalogSeed_1.SPECIES_CATALOG_STAGE_ONE_SIZE);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(speciesCatalogSeed_1.SPECIES_CATALOG_STAGE_ONE_SIZE);
        for (const [sql] of query.mock.calls) {
            (0, vitest_1.expect)(sql).toContain('INSERT INTO aquarium_species_catalog');
            (0, vitest_1.expect)(sql).toContain('ON CONFLICT DO NOTHING');
            (0, vitest_1.expect)(sql).not.toMatch(/\b(?:UPDATE|DELETE)\b/);
        }
    });
});
