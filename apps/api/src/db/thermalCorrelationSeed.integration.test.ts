import { afterAll, describe, expect, it } from 'vitest';
import pool from './index';
import {
  STARTER_THERMAL_CORRELATIONS,
  THERMAL_CORRELATION_VERSION,
  seedThermalCorrelations,
} from './thermalCorrelationSeed';

afterAll(async () => {
  await pool.end();
});

describe('Thermal correlation seed PostgreSQL constraints', () => {
  it('preserves a different approved version without failing the starter seed', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO pg_temp');
      await client.query(`
        CREATE TEMP TABLE thermal_agitation_classes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          class_code TEXT NOT NULL UNIQUE,
          class_name TEXT NOT NULL
        );
        CREATE TEMP TABLE thermal_mass_transfer_correlations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agitation_class_id UUID NOT NULL REFERENCES thermal_agitation_classes(id),
          agitation_class_code TEXT NOT NULL,
          agitation_class_name TEXT NOT NULL,
          agitation_class_description TEXT,
          version TEXT NOT NULL,
          coefficient_kg_m2_s_kpa NUMERIC NOT NULL,
          activity_factor NUMERIC,
          base_coefficient_kg_m2_s_kpa NUMERIC,
          coefficient_unit TEXT,
          base_coefficient_unit TEXT,
          formula_basis TEXT,
          source_basis TEXT,
          source_document TEXT,
          source_revision TEXT,
          source_reference TEXT,
          related_agitation_values JSONB NOT NULL DEFAULT '{}'::jsonb,
          notes TEXT,
          approved_by UUID,
          status TEXT NOT NULL DEFAULT 'approved',
          UNIQUE (agitation_class_id, version)
        );
        CREATE UNIQUE INDEX thermal_test_one_approved_correlation
          ON thermal_mass_transfer_correlations(agitation_class_id)
          WHERE status='approved';
      `);
      for (const item of STARTER_THERMAL_CORRELATIONS) {
        await client.query(
          `INSERT INTO thermal_agitation_classes (class_code, class_name)
           VALUES ($1,$2)`,
          [item.class_code, item.class_name],
        );
      }
      await client.query(
        `INSERT INTO thermal_mass_transfer_correlations
           (agitation_class_id, agitation_class_code, agitation_class_name,
            version, coefficient_kg_m2_s_kpa)
         SELECT id, class_code, class_name, 'MANUAL_APPROVED_V2', 0.000031
         FROM thermal_agitation_classes
         WHERE class_code='normal_circulation'`,
      );

      await expect(seedThermalCorrelations(client, null)).resolves.toBe(3);
      const records = await client.query(
        `SELECT agitation_class_code, version, coefficient_kg_m2_s_kpa
         FROM thermal_mass_transfer_correlations
         ORDER BY agitation_class_code`,
      );
      expect(records.rows).toHaveLength(4);
      expect(records.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          agitation_class_code: 'normal_circulation',
          version: 'MANUAL_APPROVED_V2',
          coefficient_kg_m2_s_kpa: '0.000031',
        }),
        expect.objectContaining({
          agitation_class_code: 'calm_covered',
          version: THERMAL_CORRELATION_VERSION,
          coefficient_kg_m2_s_kpa: '0.00002',
        }),
      ]));
      expect(records.rows.filter(
        row => row.agitation_class_code === 'normal_circulation',
      )).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});