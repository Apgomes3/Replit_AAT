import { describe, expect, it } from 'vitest';
import {
  GBIF_IMPORT_GROUPS,
  SPECIES_CATALOG_STAGE_ONE_SIZE,
  SPECIES_PER_IMPORT_GROUP,
} from '../db/speciesCatalogSeed';
import { calculateSpeciesAllocation } from './speciesAllocations';

describe('Aquarium species catalog and allocation policy', () => {
  it('ships a broad, unique starter catalog in the requested range', () => {
    expect(SPECIES_CATALOG_STAGE_ONE_SIZE).toBeGreaterThanOrEqual(500);
    expect(SPECIES_CATALOG_STAGE_ONE_SIZE).toBeLessThanOrEqual(1000);
    expect(GBIF_IMPORT_GROUPS.every(group => group.gbifFamilyKey > 0)).toBe(true);
    expect(new Set(GBIF_IMPORT_GROUPS.map(row => row.waterType))).toEqual(
      new Set(['Marine', 'Freshwater', 'Brackish']),
    );
    expect(new Set(GBIF_IMPORT_GROUPS.map(row => row.family)).size).toBeGreaterThanOrEqual(10);
    expect(GBIF_IMPORT_GROUPS.every(row =>
      row.averageSizeCm > 0 && row.referenceAverageMassKg > 0,
    )).toBe(true);
    expect(SPECIES_PER_IMPORT_GROUP).toBe(40);
  });

  it('calculates default biomass from quantity and the captured catalog mass', () => {
    expect(calculateSpeciesAllocation({
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

  it('keeps size, mass, and biomass overrides explicit and independent', () => {
    expect(calculateSpeciesAllocation({
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