import { describe, expect, it, vi } from 'vitest';
import { thermalCalculationTestUtils } from './designBooks';

describe('thermal calculation snapshot persistence', () => {
  it('persists exact temperature and wall-construction evidence for reloads', async () => {
    const waterTemperatureBasis = {
      source: 'linked exhibit design-temperature range average',
      minimum_c: 24,
      maximum_c: 26,
      average_c: 25,
      calculated_temperature_c: 25,
      reviewed_override_used: false,
    };
    const wallConstructionBasis = {
      construction_type: 'frp',
      construction_label: 'FRP',
      u_value_w_m2_k: 2.5,
      units: 'W/m²·K',
      source: 'assumed tank construction U-value',
      reviewed: false,
      assumption_label: 'Engineering assumption — standard FRP tank wall',
      basis_version: 'aat-thermal-construction-v1',
      source_reference: 'AAT thermal construction assumption basis v1',
      layers: null,
    };
    const calculation = {
      calculation_version: 'aat-thermal-load-v2',
      status: 'Ready',
      source_fingerprint: 'a'.repeat(64),
      calculated_at: '2026-08-31T00:00:00.000Z',
      constants: {},
      formula_inputs: {
        water_temperature_basis: waterTemperatureBasis,
        wall_construction_basis: wallConstructionBasis,
      },
      inputs: {
        tank_construction_type: 'frp',
        water_temperature_basis: waterTemperatureBasis,
        wall_construction_basis: wallConstructionBasis,
      },
      water_temperature_basis: waterTemperatureBasis,
      wall_construction_basis: wallConstructionBasis,
      sensitivity_cases: [],
    };
    const runner = vi.fn(async () => ({ rows: [] }));

    await thermalCalculationTestUtils.insertThermalSnapshotRecord(
      runner as any,
      'book-1',
      {
        system_id: 'system-1',
        calculation_version: calculation.calculation_version,
        status: calculation.status,
        freshness: 'fresh',
        source_fingerprint: calculation.source_fingerprint,
        source: { fingerprint: calculation.source_fingerprint },
        calculation,
      },
    );

    expect(runner).toHaveBeenCalledOnce();
    const params = (runner.mock.calls as any[][])[0][1];
    const reloadedInputSnapshot = JSON.parse(params[8]);
    const reloadedResultSnapshot = JSON.parse(params[9]);
    expect(reloadedInputSnapshot.water_temperature_basis).toEqual(waterTemperatureBasis);
    expect(reloadedInputSnapshot.wall_construction_basis).toEqual(wallConstructionBasis);
    expect(reloadedResultSnapshot.water_temperature_basis).toEqual(waterTemperatureBasis);
    expect(reloadedResultSnapshot.wall_construction_basis).toEqual(wallConstructionBasis);
  });
});