export const BIOLOGICAL_MEDIA_WATER_TYPES = [
  'Freshwater',
  'Marine',
  'Saltwater',
  'Brackish',
  'Universal',
] as const;

export const BIOLOGICAL_MEDIA_REACTOR_TYPES = [
  'Fixed bed biofilter',
  'Moving bed biofilter',
  'MBBR',
  'Trickling filter',
  'Fluidized sand filter',
] as const;

export function normalizeBiologicalMediaWaterType(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (normalized === 'freshwater' || normalized === 'fresh water') return 'freshwater';
  if (normalized === 'saltwater' || normalized === 'salt water' || normalized === 'marine' || normalized === 'seawater') return 'saltwater';
  if (normalized === 'brackish' || normalized === 'brackish water') return 'brackish';
  if (normalized === 'universal') return 'universal';
  return normalized;
}