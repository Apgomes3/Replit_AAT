import { describe, expect, it } from 'vitest';
import { buildTankDesignSheet, normalizeExhibitWaterType } from './tankDesignSheet';

describe('tank design sheet', () => {
  it('normalizes exhibit water types and uses an active matching density', () => {
    const model = buildTankDesignSheet({
      tank: { tank_code: 'TK-01', design_water_level_mm: 2000, overflow_level_mm: 2100 },
      exhibit: { water_type: 'Marine / Salt Water', design_temperature_max: 26 },
      chemicalParameters: [
        { id: 'density-1', water_type: 'seawater', density_kg_m3: 1025, status: 'Active', is_active: true, unit: 'kg/m3', conditions: '20 C', source: 'Governed source' },
        { water_type: 'seawater', density_kg_m3: 900, status: 'Inactive' },
      ],
      thermalCalculations: [{ result_snapshot: { ambient_air_temperature_c: 22 } }],
    });
    expect(normalizeExhibitWaterType('Marine / Salt Water')).toBe('seawater');
    expect(model.design_basis.density_kg_m3).toBe(1025);
    expect(model.hydrostatic_pressure.pressure_kpa).toBe(24.124);
    expect(model.validation.valid).toBe(true);
    expect(model.tbcs).toContain('Seismic loads are TBC.');
    expect(model.design_basis.density_provenance).toMatchObject({
      parameter_id: 'density-1', unit: 'kg/m3', is_active: true, conditions: '20 C', catalog_source: 'Governed source',
    });
  });

  it('makes unresolved engineering data explicit TBCs', () => {
    const model = buildTankDesignSheet({
      tank: { design_water_level_mm: 1000 },
      exhibit: { water_type: 'freshwater' },
    });
    expect(model.validation.valid).toBe(false);
    expect(model.tbcs.join(' ')).toContain('Overflow level is TBC');
    expect(model.tbcs.join(' ')).toContain('Water density is TBC');
    expect(model.tbcs.join(' ')).toContain('Ambient temperature is TBC');
    expect(model.hydrostatic_pressure.pressure_kpa).toBeNull();
  });

  it('rejects an overflow level at or below the effective water level', () => {
    const model = buildTankDesignSheet({
      tank: { eff_water_level_mm: 1800, overflow_level_mm: 1800 },
      exhibit: { water_type: 'fresh water', design_temperature_min: 20 },
      chemicalParameters: [{ water_type: 'Freshwater', density: 1000, is_active: true }],
    });
    expect(model.validation.errors).toContainEqual(expect.objectContaining({ field: 'overflow_level_mm' }));
  });

  it('ignores stale and blocked Thermal calculations', () => {
    const base = {
      tank: { design_water_level_mm: 1000, overflow_level_mm: 1100 },
      exhibit: { water_type: 'freshwater', design_temperature_min: 20 },
      chemicalParameters: [{ water_type: 'Freshwater', density_kg_m3: 998.2, is_active: true }],
    };
    const model = buildTankDesignSheet({
      ...base,
      thermalCalculations: [
        { status: 'Ready', freshness: 'stale', result_snapshot: { ambient_air_temperature_c: 30 } },
        { status: 'Blocked', freshness: 'fresh', result_snapshot: { ambient_air_temperature_c: 29 } },
        { status: 'Ready', freshness: 'fresh', result_snapshot: { ambient_air_temperature_c: 22 } },
      ],
    });
    expect(model.design_basis.ambient_air_temperature_c).toBe(22);
  });

  it('uses a linked-exhibit Thermal result when no direct tank system exists', () => {
    const model = buildTankDesignSheet({
      tank: { design_water_level_mm: 1000, overflow_level_mm: 1100, system_id: null },
      exhibit: { water_type: 'freshwater' },
      chemicalParameters: [{ id: 'fresh', water_type: 'Freshwater', density_kg_m3: 998.2, is_active: true }],
      thermalCalculations: [{ id: 'thermal-link', system_id: 'linked-system', result_snapshot: { ambient_air_temperature_c: 19 } }],
    });
    expect(model.design_basis.ambient_air_temperature_c).toBe(19);
    expect(model.design_basis.thermal_calculation_id).toBe('thermal-link');
  });

  it('does not use inactive density catalog records', () => {
    const model = buildTankDesignSheet({
      tank: { design_water_level_mm: 1000, overflow_level_mm: 1100 },
      exhibit: { water_type: 'Seawater' },
      chemicalParameters: [{ id: 'old', water_type: 'Seawater', density_kg_m3: 1025, is_active: false }],
    });
    expect(model.design_basis.density_kg_m3).toBeNull();
    expect(model.validation.errors).toContainEqual(expect.objectContaining({ field: 'water_type' }));
  });
});