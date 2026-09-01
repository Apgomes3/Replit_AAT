import type { PoolClient } from 'pg';

export const THERMAL_CORRELATION_VERSION = 'AAT_FOUNDATIONS_EVAP_V1.0';
export const THERMAL_CORRELATION_SOURCE_BASIS = 'AAT Foundations';
export const THERMAL_CORRELATION_SOURCE_DOCUMENT = 'AAT Foundations';
export const THERMAL_CORRELATION_SOURCE_REVISION = THERMAL_CORRELATION_VERSION;
export const THERMAL_CORRELATION_COEFFICIENT_UNIT = 'kg/(m²·s·kPa)';
export const THERMAL_CORRELATION_BASE_COEFFICIENT = 0.000040;
export const THERMAL_CORRELATION_FORMULA =
  'K_class = K_base × Activity Factor';

export const STARTER_THERMAL_CORRELATIONS = [
  {
    source_class_code: 'CALM_COVERED',
    class_code: 'calm_covered',
    class_name: 'Calm or Covered',
    description: 'Quiet water surface with little movement. May include substantially covered surfaces. No intentional aeration.',
    activity_factor: 0.50,
    coefficient: 0.000020,
    sort_order: 10,
  },
  {
    source_class_code: 'NORMAL_CIRCULATION',
    class_code: 'normal_circulation',
    class_name: 'Normal Circulation',
    description: 'Typical aquarium exhibit with normal turnover, submerged returns and moderate surface movement.',
    activity_factor: 0.80,
    coefficient: 0.000032,
    sort_order: 20,
  },
  {
    source_class_code: 'HIGH_AGITATION_AERATED',
    class_code: 'high_agitation_aerated',
    class_name: 'High Agitation or Aerated',
    description: 'Strong surface movement, aeration, turbulent returns, vigorous overflow or similar activity.',
    activity_factor: 1.00,
    coefficient: 0.000040,
    sort_order: 30,
  },
  {
    source_class_code: 'SPLASHING_ACTIVE',
    class_code: 'splashing_active',
    class_name: 'Splashing or Active',
    description: 'Continuous splashing, waves, waterfalls, breaking jets or significant creation of additional air water interface.',
    activity_factor: 1.50,
    coefficient: 0.000060,
    sort_order: 40,
  },
] as const;

function relatedValues(item: typeof STARTER_THERMAL_CORRELATIONS[number]) {
  return {
    activity_factor: item.activity_factor,
    base_coefficient_kg_m2_s_kpa: THERMAL_CORRELATION_BASE_COEFFICIENT,
    coefficient_unit: THERMAL_CORRELATION_COEFFICIENT_UNIT,
    base_coefficient_unit: THERMAL_CORRELATION_COEFFICIENT_UNIT,
    formula: THERMAL_CORRELATION_FORMULA,
    source_class_code: item.source_class_code,
    source_basis: THERMAL_CORRELATION_SOURCE_BASIS,
    source_document: THERMAL_CORRELATION_SOURCE_DOCUMENT,
    source_revision: THERMAL_CORRELATION_SOURCE_REVISION,
  };
}

export async function seedThermalCorrelations(
  client: PoolClient,
  approvingEngineerId: string | null,
): Promise<number> {
  let insertedCount = 0;
  for (const item of STARTER_THERMAL_CORRELATIONS) {
    const result = await client.query(
      `INSERT INTO thermal_mass_transfer_correlations
         (agitation_class_id, agitation_class_code, agitation_class_name,
          agitation_class_description, version, coefficient_kg_m2_s_kpa,
          activity_factor, base_coefficient_kg_m2_s_kpa, coefficient_unit,
          base_coefficient_unit, formula_basis, source_basis,
          source_document, source_revision, source_reference,
          related_agitation_values, notes, approved_by)
       SELECT ac.id, ac.class_code, ac.class_name, $2, $3, $4,
              $5, $6, $7, $8, $9, $10, $11, $12, $10, $13::jsonb, $14, $15
       FROM thermal_agitation_classes ac
       WHERE ac.class_code=$1
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        item.class_code,
        item.description,
        THERMAL_CORRELATION_VERSION,
        item.coefficient,
        item.activity_factor,
        THERMAL_CORRELATION_BASE_COEFFICIENT,
        THERMAL_CORRELATION_COEFFICIENT_UNIT,
        THERMAL_CORRELATION_COEFFICIENT_UNIT,
        THERMAL_CORRELATION_FORMULA,
        THERMAL_CORRELATION_SOURCE_BASIS,
        THERMAL_CORRELATION_SOURCE_DOCUMENT,
        THERMAL_CORRELATION_SOURCE_REVISION,
        JSON.stringify(relatedValues(item)),
        `Starter AAT Foundations evaporation surface-activity correlation for ${item.source_class_code}.`,
        approvingEngineerId,
      ],
    );
    insertedCount += result.rowCount || 0;
  }
  return insertedCount;
}