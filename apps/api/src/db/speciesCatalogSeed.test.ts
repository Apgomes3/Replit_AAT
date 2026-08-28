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
    expect(SPECIES_CATALOG_ARTIFACT.version).toBe(2);
    expect(records).toHaveLength(SPECIES_CATALOG_STAGE_ONE_SIZE);
    expect(new Set(records.map(record => record.scientific_name.toLowerCase())).size).toBe(records.length);
    fetchSpy.mockRestore();
  });

  it('covers the reviewed penguin and aquarium-relevant shark expansion', async () => {
    const records = await loadSpeciesCatalogStageOne();
    const penguins = records.filter(record => record.family === 'Spheniscidae');
    const sharks = records.filter(record => record.scientific_name.toLowerCase().includes('shark')
      || ['Carcharhinidae', 'Ginglymostomatidae', 'Hemiscylliidae', 'Heterodontidae',
        'Orectolobidae', 'Stegostomatidae', 'Scyliorhinidae', 'Triakidae',
        'Rhincodontidae', 'Odontaspididae', 'Sphyrnidae', 'Hexanchidae'].includes(record.family));

    expect(penguins).toHaveLength(19);
    expect(sharks).toHaveLength(29);
    expect(new Set(sharks.map(record => record.family))).toEqual(new Set([
      'Carcharhinidae', 'Ginglymostomatidae', 'Hemiscylliidae', 'Heterodontidae',
      'Orectolobidae', 'Stegostomatidae', 'Scyliorhinidae', 'Triakidae',
      'Rhincodontidae', 'Odontaspididae', 'Sphyrnidae', 'Hexanchidae',
    ]));
    expect(records.filter(record => record.family === 'Carcharhinidae' && record.water_type === 'Brackish'))
      .toHaveLength(1);
    for (const record of [...penguins, ...sharks]) {
      expect(record.common_name).toBeTruthy();
      expect(record.average_size_cm).toBeGreaterThan(0);
      expect(record.reference_average_mass_kg).toBeGreaterThan(0);
      expect(record.source).toMatch(/provisional/i);
    }
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

  it('can be run again without turning the reviewed artifact into updates', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });

    await seedSpeciesCatalog({ query } as any, null);

    expect(query).toHaveBeenCalledTimes(SPECIES_CATALOG_STAGE_ONE_SIZE);
    expect(query.mock.calls.every(([sql]) => sql.includes('ON CONFLICT DO NOTHING'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => /\b(?:UPDATE|DELETE)\b/.test(sql))).toBe(false);
  });
});