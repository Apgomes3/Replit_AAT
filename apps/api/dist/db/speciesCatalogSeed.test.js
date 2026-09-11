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
        (0, vitest_1.expect)(speciesCatalogSeed_1.SPECIES_CATALOG_ARTIFACT.version).toBe(4);
        (0, vitest_1.expect)(records).toHaveLength(speciesCatalogSeed_1.SPECIES_CATALOG_STAGE_ONE_SIZE);
        (0, vitest_1.expect)(new Set(records.map(record => record.scientific_name.toLowerCase())).size).toBe(records.length);
        fetchSpy.mockRestore();
    });
    (0, vitest_1.it)('covers the reviewed penguin and aquarium-relevant shark expansion', async () => {
        const records = await (0, speciesCatalogSeed_1.loadSpeciesCatalogStageOne)();
        const penguins = records.filter(record => record.family === 'Spheniscidae');
        const sharks = records.filter(record => record.scientific_name.toLowerCase().includes('shark')
            || ['Carcharhinidae', 'Ginglymostomatidae', 'Hemiscylliidae', 'Heterodontidae',
                'Orectolobidae', 'Stegostomatidae', 'Scyliorhinidae', 'Triakidae',
                'Rhincodontidae', 'Odontaspididae', 'Sphyrnidae', 'Hexanchidae'].includes(record.family));
        (0, vitest_1.expect)(penguins).toHaveLength(19);
        (0, vitest_1.expect)(sharks).toHaveLength(29);
        (0, vitest_1.expect)(new Set(sharks.map(record => record.family))).toEqual(new Set([
            'Carcharhinidae', 'Ginglymostomatidae', 'Hemiscylliidae', 'Heterodontidae',
            'Orectolobidae', 'Stegostomatidae', 'Scyliorhinidae', 'Triakidae',
            'Rhincodontidae', 'Odontaspididae', 'Sphyrnidae', 'Hexanchidae',
        ]));
        (0, vitest_1.expect)(records.filter(record => record.family === 'Carcharhinidae' && record.water_type === 'Brackish'))
            .toHaveLength(1);
        for (const record of [...penguins, ...sharks]) {
            (0, vitest_1.expect)(record.common_name).toBeTruthy();
            (0, vitest_1.expect)(record.average_size_cm).toBeGreaterThan(0);
            (0, vitest_1.expect)(record.reference_average_mass_kg).toBeGreaterThan(0);
            (0, vitest_1.expect)(record.source).toMatch(/provisional/i);
        }
    });
    (0, vitest_1.it)('covers the reviewed marine pelagic fish expansion without duplicate identities', async () => {
        const records = await (0, speciesCatalogSeed_1.loadSpeciesCatalogStageOne)();
        const pelagic = records.filter(record => ['Carangidae', 'Scombridae'].includes(record.family));
        (0, vitest_1.expect)(pelagic).toHaveLength(29);
        (0, vitest_1.expect)(pelagic.every(record => record.water_type === 'Marine')).toBe(true);
        (0, vitest_1.expect)(new Set(pelagic.map(record => record.family))).toEqual(new Set(['Carangidae', 'Scombridae']));
        (0, vitest_1.expect)(pelagic.filter(record => record.family === 'Carangidae').map(record => record.common_name))
            .toEqual(vitest_1.expect.arrayContaining(['Giant trevally', 'Crevalle jack', 'Greater amberjack']));
        (0, vitest_1.expect)(pelagic.filter(record => record.family === 'Scombridae').map(record => record.common_name))
            .toEqual(vitest_1.expect.arrayContaining(['Yellowfin tuna', 'Atlantic mackerel', 'Atlantic bonito', 'Wahoo']));
        for (const record of pelagic) {
            (0, vitest_1.expect)(record.common_name).toBeTruthy();
            (0, vitest_1.expect)(record.average_size_cm).toBeGreaterThan(0);
            (0, vitest_1.expect)(record.reference_average_mass_kg).toBeGreaterThan(0);
            (0, vitest_1.expect)(record.source).toMatch(/provisional/i);
        }
    });
    (0, vitest_1.it)('covers the reviewed freshwater lake expansion with complete planning provenance', async () => {
        const records = await (0, speciesCatalogSeed_1.loadSpeciesCatalogStageOne)();
        const expectedNames = [
            'Cyprinus carpio',
            'Micropterus salmoides',
            'Oncorhynchus mykiss',
            'Esox lucius',
            'Perca fluviatilis',
            'Lepomis macrochirus',
            'Sander vitreus',
            'Pomoxis nigromaculatus',
            'Ictalurus punctatus',
        ];
        const freshwaterLake = records.filter(record => expectedNames.includes(record.scientific_name));
        const koi = records.find(record => record.scientific_name === 'Cyprinus carpio');
        (0, vitest_1.expect)(freshwaterLake.map(record => record.scientific_name)).toEqual(vitest_1.expect.arrayContaining(expectedNames));
        (0, vitest_1.expect)(koi).toEqual(vitest_1.expect.objectContaining({
            common_name: 'Koi Fish',
            family: 'Cyprinidae',
            water_type: 'Freshwater',
        }));
        for (const record of freshwaterLake) {
            (0, vitest_1.expect)(record.water_type).toBe('Freshwater');
            (0, vitest_1.expect)(record.common_name).toBeTruthy();
            (0, vitest_1.expect)(record.average_size_cm).toBeGreaterThan(0);
            (0, vitest_1.expect)(record.reference_average_mass_kg).toBeGreaterThan(0);
            (0, vitest_1.expect)(record.source).toMatch(/GBIF Backbone Taxonomy/);
            (0, vitest_1.expect)(record.source).toMatch(/provisional/i);
            (0, vitest_1.expect)(record.source).toMatch(/verify before design use/i);
        }
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
    (0, vitest_1.it)('can be run again without turning the reviewed artifact into updates', async () => {
        const query = vitest_1.vi.fn().mockResolvedValue({ rowCount: 0 });
        await (0, speciesCatalogSeed_1.seedSpeciesCatalog)({ query }, null);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(speciesCatalogSeed_1.SPECIES_CATALOG_STAGE_ONE_SIZE);
        (0, vitest_1.expect)(query.mock.calls.every(([sql]) => sql.includes('ON CONFLICT DO NOTHING'))).toBe(true);
        (0, vitest_1.expect)(query.mock.calls.some(([sql]) => /\b(?:UPDATE|DELETE)\b/.test(sql))).toBe(false);
    });
});
