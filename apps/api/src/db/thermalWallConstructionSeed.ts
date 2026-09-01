import type { PoolClient } from 'pg';
import { THERMAL_CONSTRUCTION_DEFAULTS } from '../lib/thermalCalculations';

export const THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS = 'AAT Foundations';
export const THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE =
  'AAT Foundations wall construction starter defaults';
export const THERMAL_WALL_CONSTRUCTION_VERSION = 'AAT_FOUNDATIONS_WALL_V1.0';

export const STARTER_THERMAL_WALL_CONSTRUCTIONS = THERMAL_CONSTRUCTION_DEFAULTS.map(item => ({
  ...item,
  version: THERMAL_WALL_CONSTRUCTION_VERSION,
  source_basis: THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS,
  source_reference: THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE,
}));

export async function seedThermalWallConstructions(
  client: PoolClient,
  approvingEngineerId: string | null,
): Promise<number> {
  let insertedCount = 0;
  for (const item of STARTER_THERMAL_WALL_CONSTRUCTIONS) {
    const result = await client.query(
      `INSERT INTO thermal_wall_construction_defaults
         (construction_code, construction_label, material, thickness_mm,
          conductivity_w_m_k, thickness_units, conductivity_units, version,
          source_basis, source_reference, notes, status, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12)
       ON CONFLICT (construction_code, version) DO NOTHING
       RETURNING id`,
      [
        item.code,
        item.label,
        item.material,
        item.thickness_mm,
        item.conductivity_w_m_k,
        item.thickness_units,
        item.conductivity_units,
        item.version,
        item.source_basis,
        item.source_reference,
        item.notes,
        approvingEngineerId,
      ],
    );
    insertedCount += result.rowCount || 0;
  }
  return insertedCount;
}