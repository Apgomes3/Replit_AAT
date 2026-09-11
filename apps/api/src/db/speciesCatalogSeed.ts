import { PoolClient } from 'pg';
import baseArtifact from './speciesCatalogArtifact.v1.json';
import expansionArtifact from './speciesCatalogArtifact.v2.json';
import pelagicArtifact from './speciesCatalogArtifact.v3.json';
import freshwaterLakeArtifact from './speciesCatalogArtifact.v4.json';

export type SpeciesCatalogSeedRecord = {
  scientific_name: string;
  common_name: string | null;
  family: string;
  water_type: string;
  average_size_cm: number | null;
  reference_average_mass_kg: number | null;
  source: string;
};

export type SpeciesCatalogArtifact = {
  version: number;
  status: 'reviewed';
  generated_at: string;
  source: string;
  base_version?: number;
  record_scope?: string;
  records: SpeciesCatalogSeedRecord[];
};

type GbifImportGroup = {
  family: string;
  gbifFamilyKey: number;
  waterType: string;
  averageSizeCm: number;
  referenceAverageMassKg: number;
};

export const SPECIES_PER_IMPORT_GROUP = 40;
export const GBIF_IMPORT_GROUPS: GbifImportGroup[] = [
  { family: 'Acanthuridae', gbifFamilyKey: 4233, waterType: 'Marine', averageSizeCm: 24, referenceAverageMassKg: 0.55 },
  { family: 'Chaetodontidae', gbifFamilyKey: 8517, waterType: 'Marine', averageSizeCm: 18, referenceAverageMassKg: 0.25 },
  { family: 'Pomacentridae', gbifFamilyKey: 4499, waterType: 'Marine', averageSizeCm: 10, referenceAverageMassKg: 0.08 },
  { family: 'Labridae', gbifFamilyKey: 8535, waterType: 'Marine', averageSizeCm: 20, referenceAverageMassKg: 0.3 },
  { family: 'Serranidae', gbifFamilyKey: 8597, waterType: 'Marine', averageSizeCm: 48, referenceAverageMassKg: 3.8 },
  { family: 'Scorpaenidae', gbifFamilyKey: 4508, waterType: 'Marine', averageSizeCm: 22, referenceAverageMassKg: 0.7 },
  { family: 'Gobiidae', gbifFamilyKey: 4274, waterType: 'Marine', averageSizeCm: 12, referenceAverageMassKg: 0.1 },
  { family: 'Cichlidae', gbifFamilyKey: 8522, waterType: 'Freshwater', averageSizeCm: 26, referenceAverageMassKg: 0.45 },
  { family: 'Characidae', gbifFamilyKey: 7201, waterType: 'Freshwater', averageSizeCm: 14, referenceAverageMassKg: 0.12 },
  { family: 'Siluridae', gbifFamilyKey: 5168, waterType: 'Freshwater', averageSizeCm: 42, referenceAverageMassKg: 1.8 },
  { family: 'Loricariidae', gbifFamilyKey: 5158, waterType: 'Freshwater', averageSizeCm: 30, referenceAverageMassKg: 0.65 },
  { family: 'Osphronemidae', gbifFamilyKey: 8553, waterType: 'Freshwater', averageSizeCm: 20, referenceAverageMassKg: 0.25 },
  { family: 'Tetraodontidae', gbifFamilyKey: 2219, waterType: 'Brackish', averageSizeCm: 28, referenceAverageMassKg: 0.9 },
];

export const SPECIES_CATALOG_GBIF_STAGE_ONE_SIZE = GBIF_IMPORT_GROUPS.length * SPECIES_PER_IMPORT_GROUP;
export const SPECIES_CATALOG_ARTIFACT_VERSION = freshwaterLakeArtifact.version;
export const SPECIES_CATALOG_ARTIFACT = {
  ...freshwaterLakeArtifact,
  records: [
    ...baseArtifact.records,
    ...expansionArtifact.records,
    ...pelagicArtifact.records,
    ...freshwaterLakeArtifact.records,
  ],
} as SpeciesCatalogArtifact;
export const SPECIES_CATALOG_STAGE_ONE_SIZE = SPECIES_CATALOG_ARTIFACT.records.length;

type GbifSpecies = {
  key: number;
  canonicalName?: string;
  species?: string;
  family?: string;
  taxonomicStatus?: string;
  rank?: string;
  habitats?: string[];
  vernacularNames?: Array<{ vernacularName?: string; language?: string }>;
};

export async function fetchGbifGroup(group: GbifImportGroup): Promise<SpeciesCatalogSeedRecord[]> {
  const queryUrl = new URL('https://api.gbif.org/v1/species/search');
  queryUrl.searchParams.set('highertaxon_key', String(group.gbifFamilyKey));
  queryUrl.searchParams.set('rank', 'SPECIES');
  queryUrl.searchParams.set('status', 'ACCEPTED');
  queryUrl.searchParams.set('limit', '100');
  const response = await fetch(queryUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GBIF import failed for ${group.family}: HTTP ${response.status}`);
  const payload = await response.json() as { results?: GbifSpecies[] };
  const seen = new Set<string>();
  const records: SpeciesCatalogSeedRecord[] = [];
  for (const item of payload.results || []) {
    const scientificName = String(item.canonicalName || item.species || '').trim();
    const key = scientificName.toLowerCase();
    if (
      item.family !== group.family
      || item.rank !== 'SPECIES'
      || item.taxonomicStatus !== 'ACCEPTED'
      || !/^[A-Z][a-z-]+ [a-z][a-z-]+$/.test(scientificName)
      || seen.has(key)
    ) continue;
    seen.add(key);
    const commonName = item.vernacularNames?.find(name =>
      name.language === 'eng' && name.vernacularName?.trim(),
    )?.vernacularName?.trim() || null;
    const habitats = new Set(item.habitats || []);
    const hasMarine = habitats.has('MARINE');
    const hasFreshwater = habitats.has('FRESHWATER');
    const waterType = hasMarine && hasFreshwater
      ? 'Brackish'
      : hasMarine ? 'Marine' : hasFreshwater ? 'Freshwater' : group.waterType;
    const waterSource = habitats.size
      ? `Water type mapped from GBIF habitats (${[...habitats].join(', ')}).`
      : `Water type uses the provisional ${group.family} family baseline.`;
    records.push({
      scientific_name: scientificName,
      common_name: commonName,
      family: group.family,
      water_type: waterType,
      average_size_cm: group.averageSizeCm,
      reference_average_mass_kg: group.referenceAverageMassKg,
      source: `Taxonomy/common name: GBIF Backbone Taxonomy species key ${item.key}. ${waterSource} Size and mass: provisional ${group.family} planning baseline v1; verify before design use.`,
    });
    if (records.length === SPECIES_PER_IMPORT_GROUP) break;
  }
  if (records.length !== SPECIES_PER_IMPORT_GROUP) {
    throw new Error(`GBIF import returned ${records.length}/${SPECIES_PER_IMPORT_GROUP} accepted ${group.family} species`);
  }
  return records;
}

export async function fetchSpeciesCatalogStageOne() {
  const groups = await Promise.all(GBIF_IMPORT_GROUPS.map(fetchGbifGroup));
  const records = groups.flat();
  if (new Set(records.map(record => record.scientific_name.toLowerCase())).size !== records.length) {
    throw new Error('GBIF stage-one import contains duplicate scientific names');
  }
  return records;
}

function validateArtifact(records: SpeciesCatalogSeedRecord[]) {
  if (!records.length) throw new Error('Species catalog artifact is empty');
  const names = new Set<string>();
  for (const record of records) {
    const scientificName = String(record.scientific_name || '').trim();
    if (
      !/^[A-Z][a-z-]+ [a-z][a-z-]+$/.test(scientificName)
      || !record.family
      || !record.water_type
      || !['Marine', 'Freshwater', 'Brackish', 'Universal'].includes(record.water_type)
      || !record.source
      || !(record.average_size_cm == null || record.average_size_cm > 0)
      || !(record.reference_average_mass_kg == null || record.reference_average_mass_kg > 0)
    ) {
      throw new Error('Species catalog artifact contains an incomplete record');
    }
    const key = scientificName.toLowerCase();
    if (names.has(key)) throw new Error(`Species catalog artifact contains duplicate scientific name: ${scientificName}`);
    names.add(key);
  }
  return records;
}

export async function loadSpeciesCatalogStageOne() {
  return validateArtifact(SPECIES_CATALOG_ARTIFACT.records);
}

export async function seedSpeciesCatalog(client: PoolClient, userId: string | null) {
  const records = await loadSpeciesCatalogStageOne();
  // The reviewed artifact is immutable input for fresh setup. Never update or
  // delete existing rows: allocations retain both their link and snapshots.
  for (const record of records) {
    await client.query(
      `INSERT INTO aquarium_species_catalog
         (scientific_name, common_name, family, water_type, average_size_cm,
          reference_average_mass_kg, source, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT DO NOTHING`,
      [
        record.scientific_name, record.common_name, record.family, record.water_type,
        record.average_size_cm, record.reference_average_mass_kg, record.source, userId,
      ],
    );
  }
  return records.length;
}