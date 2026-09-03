import { describe, expect, it, vi } from 'vitest';
import { thermalCalculationTestUtils } from './designBooks';
import {
  buildThermalSourceContext,
  calculateThermalCalculation,
} from '../lib/thermalCalculations';

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
      u_value_w_m2_k: 4.335260115606936,
      units: 'W/m²·K',
      source: 'AAT Foundations wall-layer default with designer override',
      reviewed: false,
      assumption_label: 'Provisional AAT Foundations starter default — FRP / GRP laminate wall',
      basis_version: 'AAT_FOUNDATIONS_WALL_V1.0',
      source_basis: 'AAT Foundations',
      source_reference: 'AAT Foundations wall construction starter defaults',
      default_layers: [{ material: 'FRP / GRP laminate', thickness_m: 0.006, conductivity_w_m_k: 0.25 }],
      effective_layers: [{ material: 'Project FRP', thickness_m: 0.008, conductivity_w_m_k: 0.3 }],
      layer_override_flags: { material: true, thickness_mm: true, conductivity_w_m_k: true },
      layer_override_justification: 'Project laminate schedule.',
      tank_bases: [{
        tank_id: 'tank-frp',
        tank_code: 'TK-FRP',
        quantity: 2,
        exposed_wall_area_m2: 18,
        material: 'Project FRP',
        thickness_mm: 8,
        conductivity_w_m_k: 0.3,
        u_value_w_m2_k: 37.5,
        basis_version: 'AAT_FOUNDATIONS_WALL_V1.0',
      }, {
        tank_id: 'tank-concrete',
        tank_code: 'TK-CON',
        quantity: 1,
        exposed_wall_area_m2: 12,
        material: 'Reinforced concrete',
        thickness_mm: 150,
        conductivity_w_m_k: 1.4,
        u_value_w_m2_k: 9.333333333333334,
        basis_version: 'AAT_FOUNDATIONS_WALL_V1.0',
      }],
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

  it('marks a saved Ready calculation stale when approved wall evidence changes while preserving frozen tank evidence', async () => {
    const system = {
      id: 'system-thermal-1',
      system_code: 'LSS-THERMAL-1',
      system_name: 'Thermal regression LSS',
      design_flow_m3h: 100,
    };
    const links = [{ system_id: system.id, exhibit_id: 'exhibit-thermal-1' }];
    const exhibits = [{
      id: 'exhibit-thermal-1',
      exhibit_code: 'EX-THERMAL-1',
      design_temperature_min: 24,
      design_temperature_max: 26,
      water_type: 'freshwater',
    }];
    const tanks = [{
      id: 'tank-thermal-1',
      exhibit_id: exhibits[0].id,
      tank_code: 'TK-THERMAL-1',
      shape_type: 'Rectangular',
      length_mm: 2000,
      width_mm: 1000,
      design_water_level_mm: 1000,
      operating_volume_m3: 2,
      surface_area_m2: 2,
      primary_material: 'Acrylic / PMMA',
      wall_thickness_mm: 12,
    }];
    const exhibitCalculations = [{
      inputs: { exhibit_id: exhibits[0].id },
      results: {
        operating_volume_m3: 2,
        total_return_flow_m3h: 100,
      },
      status: 'Ready',
      freshness: 'fresh',
    }];
    const approvedCorrelation = {
      source: 'shared_library',
      correlation_id: 'correlation-thermal-1',
      agitation_class: 'Moderate',
      version: '2026.2',
      coefficient_kg_m2_s_kpa: 0.0000012,
      effective_coefficient_kg_m2_s_kpa: 0.0000012,
      approved: true,
    };
    const approvedWall = {
      code: 'acrylic',
      label: 'Acrylic',
      material: 'Acrylic / PMMA',
      thickness_mm: 12,
      conductivity_w_m_k: 0.19,
      basis_version: 'AAT_FOUNDATIONS_WALL_V1.0',
      source_basis: 'AAT Foundations',
      source_reference: 'AAT Foundations wall construction starter defaults',
      assumption_label: 'Approved acrylic wall construction',
      approval: { status: 'approved', approved_at: '2026-08-31T00:00:00.000Z' },
    };
    const originalSource = buildThermalSourceContext({
      system,
      links,
      exhibits,
      tanks,
      exhibitCalculations,
      wallConstructions: [approvedWall],
    });
    const calculation = calculateThermalCalculation(
      originalSource,
      {
        ambient_air_temperature_c: 20,
        relative_humidity_pct: 60,
        atmospheric_pressure_kpa: 101.325,
        agitation_class: 'Moderate',
        agitation_correlation_snapshot: approvedCorrelation,
        tank_construction_type: 'acrylic',
      },
      '2026-08-31T00:00:00.000Z',
    );
    expect(calculation.status).toBe('Ready');

    const saveRunner = vi.fn(async () => ({ rows: [] }));
    await thermalCalculationTestUtils.insertThermalSnapshotRecord(
      saveRunner as any,
      'book-thermal-1',
      {
        system_id: system.id,
        calculation_version: calculation.calculation_version,
        status: calculation.status,
        freshness: calculation.freshness,
        source_fingerprint: calculation.source_fingerprint,
        source_snapshot: calculation.source_snapshot,
        constants: calculation.constants,
        formula_inputs: calculation.formula_inputs,
        input_snapshot: calculation.inputs,
        result_snapshot: calculation,
        sensitivity_cases: calculation.sensitivity_cases,
        correlation_snapshot: calculation.correlation_snapshot,
        calculated_at: calculation.calculated_at,
      },
    );
    const savedParams = (saveRunner.mock.calls as any[][])[0][1];
    const savedRow = {
      system_id: savedParams[1],
      calculation_version: savedParams[2],
      status: savedParams[3],
      freshness: savedParams[4],
      source_fingerprint: savedParams[5],
      source_snapshot: JSON.parse(savedParams[6]),
      constants: JSON.parse(savedParams[7]),
      formula_inputs: JSON.parse(savedParams[8]),
      input_snapshot: JSON.parse(savedParams[9]),
      result_snapshot: JSON.parse(savedParams[10]),
      sensitivity_cases: JSON.parse(savedParams[11]),
      correlation_snapshot: JSON.parse(savedParams[12]),
      calculated_at: savedParams[15],
    };
    const frozenWallEvidence = structuredClone(
      savedRow.result_snapshot.results.tank_wall_calculations,
    );
    const frozenSourceWallEvidence = structuredClone(
      savedRow.source_snapshot.linked_tanks[0].wall_construction_basis,
    );

    const loadRunner = vi.fn(async () => ({ rows: [savedRow] }));
    const initiallyFresh = await thermalCalculationTestUtils.loadThermalCalculations(
      loadRunner as any,
      'book-thermal-1',
      [system],
      links,
      exhibits,
      tanks,
      exhibitCalculations,
      [approvedWall],
    );
    expect(initiallyFresh[0]).toMatchObject({
      status: 'Ready',
      freshness: 'fresh',
      calculation: {
        status: 'Ready',
        is_stale: false,
      },
    });

    const changedApprovedWall = {
      ...approvedWall,
      conductivity_w_m_k: 0.2,
      basis_version: 'AAT_FOUNDATIONS_WALL_V2.0',
    };
    const reloaded = await thermalCalculationTestUtils.loadThermalCalculations(
      loadRunner as any,
      'book-thermal-1',
      [system],
      links,
      exhibits,
      tanks,
      exhibitCalculations,
      [changedApprovedWall],
    );

    expect(reloaded[0]).toMatchObject({
      status: 'Stale',
      freshness: 'stale',
      source_fingerprint: expect.any(String),
      calculation: {
        status: 'Blocked',
        freshness: 'stale',
        is_stale: true,
        wall_construction_basis: calculation.wall_construction_basis,
      },
    });
    expect(reloaded[0].source.fingerprint).not.toBe(savedRow.source_fingerprint);
    expect(reloaded[0].calculation.results.tank_wall_calculations).toEqual(frozenWallEvidence);
    expect(reloaded[0].saved.result_snapshot.results.tank_wall_calculations).toEqual(
      frozenWallEvidence,
    );
    expect(reloaded[0].saved.source_snapshot.linked_tanks[0].wall_construction_basis).toEqual(
      frozenSourceWallEvidence,
    );
  });
});
