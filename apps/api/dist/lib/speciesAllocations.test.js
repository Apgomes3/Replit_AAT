"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const speciesCatalogSeed_1 = require("../db/speciesCatalogSeed");
const speciesAllocations_1 = require("./speciesAllocations");
(0, vitest_1.describe)('Aquarium species catalog and allocation policy', () => {
    (0, vitest_1.it)('ships a broad, unique starter catalog in the requested range', () => {
        (0, vitest_1.expect)(speciesCatalogSeed_1.SPECIES_CATALOG_STAGE_ONE_SIZE).toBeGreaterThanOrEqual(500);
        (0, vitest_1.expect)(speciesCatalogSeed_1.SPECIES_CATALOG_STAGE_ONE_SIZE).toBeLessThanOrEqual(1000);
        (0, vitest_1.expect)(speciesCatalogSeed_1.GBIF_IMPORT_GROUPS.every(group => group.gbifFamilyKey > 0)).toBe(true);
        (0, vitest_1.expect)(new Set(speciesCatalogSeed_1.GBIF_IMPORT_GROUPS.map(row => row.waterType))).toEqual(new Set(['Marine', 'Freshwater', 'Brackish']));
        (0, vitest_1.expect)(new Set(speciesCatalogSeed_1.GBIF_IMPORT_GROUPS.map(row => row.family)).size).toBeGreaterThanOrEqual(10);
        (0, vitest_1.expect)(speciesCatalogSeed_1.GBIF_IMPORT_GROUPS.every(row => row.averageSizeCm > 0 && row.referenceAverageMassKg > 0)).toBe(true);
        (0, vitest_1.expect)(speciesCatalogSeed_1.SPECIES_PER_IMPORT_GROUP).toBe(40);
    });
    (0, vitest_1.it)('calculates default biomass from quantity and the captured catalog mass', () => {
        (0, vitest_1.expect)((0, speciesAllocations_1.calculateSpeciesAllocation)({
            quantity: 12,
            catalogAverageSizeCm: 18,
            catalogReferenceMassKg: 0.35,
        })).toMatchObject({
            average_size_cm: 18,
            reference_average_mass_kg: 0.35,
            biomass_kg: 4.2,
            average_size_source: 'catalog_snapshot',
            reference_mass_source: 'catalog_snapshot',
            biomass_source: 'calculated',
        });
    });
    (0, vitest_1.it)('keeps size, mass, and biomass overrides explicit and independent', () => {
        (0, vitest_1.expect)((0, speciesAllocations_1.calculateSpeciesAllocation)({
            quantity: 12,
            catalogAverageSizeCm: 18,
            catalogReferenceMassKg: 0.35,
            averageSizeOverrideCm: 21,
            referenceMassOverrideKg: 0.5,
            biomassOverrideKg: 7.25,
        })).toMatchObject({
            average_size_cm: 21,
            reference_average_mass_kg: 0.5,
            biomass_kg: 7.25,
            average_size_source: 'override',
            reference_mass_source: 'override',
            biomass_source: 'override',
        });
    });
});
