import { describe, expect, it, vi } from 'vitest';
import {
  loadSpeciesCatalogStageOne,
  seedSpeciesCatalog,
  SPECIES_CATALOG_ARTIFACT,
  SPECIES_CATALOG_STAGE_ONE_SIZE,
} from './speciesCatalogSeed';

describe('reviewed species catalog artifact', () => {
  it('loads the reviewed stage-one records without a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const records = await loadSpeciesCatalogStageOne();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(SPECIES_CATALOG_ARTIFACT.status).toBe('reviewed');
    expect(records).toHaveLength(SPECIES_CATALOG_STAGE_ONE_SIZE);
    expect(new Set(records.map(record => record.scientific_name.toLowerCase())).size).toBe(records.length);
    fetchSpy.mockRestore();
  });

  it('inserts fresh records idempotently without updating or deleting existing identities', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });

    const seeded = await seedSpeciesCatalog({ query } as any, null);

    expect(seeded).toBe(SPECIES_CATALOG_STAGE_ONE_SIZE);
    expect(query).toHaveBeenCalledTimes(SPECIES_CATALOG_STAGE_ONE_SIZE);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('INSERT INTO aquarium_species_catalog');
      expect(sql).toContain('ON CONFLICT DO NOTHING');
      expect(sql).not.toMatch(/\b(?:UPDATE|DELETE)\b/);
    }
  });
});