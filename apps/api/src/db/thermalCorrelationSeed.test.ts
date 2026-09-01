import { describe, expect, it, vi } from 'vitest';
import {
  STARTER_THERMAL_CORRELATIONS,
  THERMAL_CORRELATION_BASE_COEFFICIENT,
  THERMAL_CORRELATION_COEFFICIENT_UNIT,
  THERMAL_CORRELATION_FORMULA,
  THERMAL_CORRELATION_SOURCE_BASIS,
  THERMAL_CORRELATION_SOURCE_DOCUMENT,
  THERMAL_CORRELATION_SOURCE_REVISION,
  THERMAL_CORRELATION_VERSION,
  seedThermalCorrelations,
} from './thermalCorrelationSeed';

describe('Thermal correlation starter library', () => {
  it('contains the exact governed AAT Foundations dataset', () => {
    expect(THERMAL_CORRELATION_VERSION).toBe('AAT_FOUNDATIONS_EVAP_V1.0');
    expect(THERMAL_CORRELATION_SOURCE_BASIS).toBe('AAT Foundations');
    expect(THERMAL_CORRELATION_SOURCE_DOCUMENT).toBe('AAT Foundations');
    expect(THERMAL_CORRELATION_SOURCE_REVISION).toBe('AAT_FOUNDATIONS_EVAP_V1.0');
    expect(THERMAL_CORRELATION_COEFFICIENT_UNIT).toBe('kg/(m²·s·kPa)');
    expect(THERMAL_CORRELATION_BASE_COEFFICIENT).toBe(0.000040);
    expect(THERMAL_CORRELATION_FORMULA).toBe('K_class = K_base × Activity Factor');
    expect(STARTER_THERMAL_CORRELATIONS).toEqual([
      expect.objectContaining({
        source_class_code: 'CALM_COVERED',
        class_code: 'calm_covered',
        class_name: 'Calm or Covered',
        activity_factor: 0.50,
        coefficient: 0.000020,
      }),
      expect.objectContaining({
        source_class_code: 'NORMAL_CIRCULATION',
        class_code: 'normal_circulation',
        class_name: 'Normal Circulation',
        activity_factor: 0.80,
        coefficient: 0.000032,
      }),
      expect.objectContaining({
        source_class_code: 'HIGH_AGITATION_AERATED',
        class_code: 'high_agitation_aerated',
        class_name: 'High Agitation or Aerated',
        activity_factor: 1.00,
        coefficient: 0.000040,
      }),
      expect.objectContaining({
        source_class_code: 'SPLASHING_ACTIVE',
        class_code: 'splashing_active',
        class_name: 'Splashing or Active',
        activity_factor: 1.50,
        coefficient: 0.000060,
      }),
    ]);
  });

  it('inserts only missing class/version records and never overwrites evidence', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'new' }] });
    const client = { query } as any;

    expect(await seedThermalCorrelations(client, 'engineer-1')).toBe(4);
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('ON CONFLICT DO NOTHING');
      expect(sql).not.toContain('DO UPDATE');
      expect(params[2]).toBe(THERMAL_CORRELATION_VERSION);
      expect(params[5]).toBe(THERMAL_CORRELATION_BASE_COEFFICIENT);
      expect(params[6]).toBe(THERMAL_CORRELATION_COEFFICIENT_UNIT);
      expect(params[9]).toBe(THERMAL_CORRELATION_SOURCE_BASIS);
      expect(params[10]).toBe(THERMAL_CORRELATION_SOURCE_DOCUMENT);
      expect(params[11]).toBe(THERMAL_CORRELATION_SOURCE_REVISION);
      expect(JSON.parse(params[12])).toMatchObject({
        base_coefficient_kg_m2_s_kpa: THERMAL_CORRELATION_BASE_COEFFICIENT,
        formula: THERMAL_CORRELATION_FORMULA,
        source_basis: THERMAL_CORRELATION_SOURCE_BASIS,
        source_document: THERMAL_CORRELATION_SOURCE_DOCUMENT,
        source_revision: THERMAL_CORRELATION_SOURCE_REVISION,
      });
    }

    query.mockClear();
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await seedThermalCorrelations(client, 'engineer-1')).toBe(0);
  });

  it('fills only missing starter records on a partially populated database', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValue({ rowCount: 1, rows: [{ id: 'new' }] });
    const client = { query } as any;

    expect(await seedThermalCorrelations(client, null)).toBe(3);
    expect(query.mock.calls.map(call => call[1][0])).toEqual(
      STARTER_THERMAL_CORRELATIONS.map(item => item.class_code),
    );
  });

  it('skips a class that already has a different approved version', async () => {
    const query = vi.fn(async (sql: string, params: any[]) => {
      if (params[0] === 'normal_circulation') {
        expect(sql).toContain('ON CONFLICT DO NOTHING');
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [{ id: 'new' }] };
    });

    expect(await seedThermalCorrelations({ query } as any, 'engineer-1')).toBe(3);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][1][0]).toBe('normal_circulation');
  });
});