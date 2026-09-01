import { describe, expect, it } from 'vitest';
import {
  buildThermalSourceContext,
  calculateThermalCalculation,
  THERMAL_CONSTANTS,
  THERMAL_AGITATION_CLASS_CATALOG,
  THERMAL_CONSTRUCTION_BASIS_VERSION,
  THERMAL_CONSTRUCTION_DEFAULTS,
} from './thermalCalculations';

function readySource(shapeType = 'Rectangular') {
  return buildThermalSourceContext({
    system: { id: 'system-1', system_code: 'LSS-1', design_flow_m3h: 120 },
    links: [{ system_id: 'system-1', exhibit_id: 'exhibit-1' }],
    exhibits: [{
      id: 'exhibit-1',
      exhibit_code: 'EX-1',
      design_temperature_min: 24,
      design_temperature_max: 26,
    }],
    tanks: [{
      id: 'tank-1',
      tank_code: 'TK-1',
      exhibit_id: 'exhibit-1',
      quantity: 1,
      shape_type: shapeType,
      surface_area_m2: 10,
      inner_length_mm: 5000,
      inner_width_mm: 2000,
      design_water_level_mm: 1500,
      operating_volume_m3: 15,
    }],
    exhibitCalculations: [{
      status: 'valid',
      freshness: 'fresh',
      inputs: { exhibit_id: 'exhibit-1' },
      results: { operating_volume_m3: 14 },
    }],
  });
}

function readyInputs() {
  return {
    ambient_air_temperature_c: 20,
    relative_humidity_pct: 60,
    surrounding_surface_temperature_c: 20,
    atmospheric_pressure_kpa: 101.325,
    agitation_class: 'Moderate',
    agitation_correlation_class: 'Moderate',
    agitation_correlation_version: 'reviewed-2026',
    agitation_correlation_approved: true,
    evaporation_coefficient_kg_m2_s_kpa: 0.000001,
    reviewed_u_value_w_m2_k: 3,
    equipment_heat_gain_kw: 2,
    lighting_power_kw: 1,
    lighting_coupling_pct: 85,
    capacity_margin_pct: 10,
  };
}

describe('AAT thermal calculation', () => {
  it('publishes the stable recommended surface-activity class catalog', () => {
    expect(THERMAL_AGITATION_CLASS_CATALOG.map(item => item.name)).toEqual([
      'Calm or Covered',
      'Normal Circulation',
      'High Agitation or Aerated',
      'Splashing or Active',
    ]);
    expect(THERMAL_AGITATION_CLASS_CATALOG.every(
      item => item.description.length > 0 && item.guidance.length > 0,
    )).toBe(true);
  });
  it('uses the approved signs, constants, and 1°C-in-6-hour recovery duty', () => {
    const result = calculateThermalCalculation(readySource(), readyInputs(), '2026-08-30T00:00:00.000Z');
    expect(result.status).toBe('Ready');
    expect(result.contributions.convection_kw).toBeCloseTo(
      THERMAL_CONSTANTS.convection_coefficient_w_m2_k * 10 * (20 - 25) / 1000,
      12,
    );
    expect(result.contributions.radiation_kw).toBeLessThan(0);
    expect(result.contributions.wall_conduction_kw).toBeLessThan(0);
    expect(result.contributions.evaporation_kw).toBeLessThan(0);
    expect(result.contributions.equipment_kw).toBe(2);
    expect(result.contributions.lighting_kw).toBeCloseTo(0.85, 12);
    expect(result.results.recovery_heating_kw).toBeCloseTo(14 * 0.194, 12);
    expect(result.results.circulation_flow_is_reference_only).toBe(true);
    expect(result.results.operational_water_exchange_flow_m3h).toBe(0);
    expect(result.results.water_temperature_c).toBe(25);
    expect(result.water_temperature_basis).toEqual({
      source: 'linked exhibit design-temperature range average',
      minimum_c: 24,
      maximum_c: 26,
      average_c: 25,
      calculated_temperature_c: 25,
      reviewed_override_used: false,
    });
    expect(result.inputs.water_temperature_basis).toEqual(result.water_temperature_basis);
  });

  it.each(THERMAL_CONSTRUCTION_DEFAULTS)(
    'applies and freezes the governed $label construction default',
    construction => {
      const inputs = readyInputs();
      delete (inputs as any).reviewed_u_value_w_m2_k;
      const result = calculateThermalCalculation(readySource(), {
        ...inputs,
        tank_construction_type: construction.code,
      });

      expect(result.status).toBe('Ready');
      expect(result.results.wall_u_value_w_m2_k).toBe(construction.u_value_w_m2_k);
      expect(result.wall_construction_basis).toMatchObject({
        construction_type: construction.code,
        construction_label: construction.label,
        material: construction.material,
        thickness_mm: construction.thickness_mm,
        conductivity_w_m_k: construction.conductivity_w_m_k,
        u_value_w_m2_k: construction.u_value_w_m2_k,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source: 'AAT Foundations governed wall-layer default',
        reviewed: false,
        assumption_label: construction.assumption_label,
        basis_version: THERMAL_CONSTRUCTION_BASIS_VERSION,
        source_reference: construction.source_reference,
      });
      expect(result.inputs.wall_construction_basis).toEqual(result.wall_construction_basis);
      expect(result.wall_construction_basis).toMatchObject({
        default_layers: [{
          material: construction.material,
          thickness_m: construction.thickness_mm / 1000,
          conductivity_w_m_k: construction.conductivity_w_m_k,
        }],
        effective_layers: [{
          material: construction.material,
          thickness_m: construction.thickness_mm / 1000,
          conductivity_w_m_k: construction.conductivity_w_m_k,
        }],
        layer_override_flags: {
          material: false,
          thickness_mm: false,
          conductivity_w_m_k: false,
        },
      });
    },
  );

  it('retains a reviewed custom U-value over the selected construction assumption', () => {
    const result = calculateThermalCalculation(readySource(), {
      ...readyInputs(),
      tank_construction_type: 'acrylic',
      reviewed_u_value_w_m2_k: 2.75,
      tank_wall_layers: [{
        material: 'Must not be combined',
        thickness_mm: 50,
        conductivity_w_m_k: 0.04,
      }],
    });

    expect(result.status).toBe('Ready');
    expect(result.wall_construction_basis).toMatchObject({
      construction_type: 'acrylic',
      construction_label: 'Acrylic',
      u_value_w_m2_k: 2.75,
      source: 'reviewed custom U-value',
      reviewed: true,
      basis_version: null,
      default_layers: null,
      effective_layers: null,
    });
  });

  it('calculates a selected construction from designer-edited effective layer values', () => {
    const inputs = readyInputs();
    delete (inputs as any).reviewed_u_value_w_m2_k;
    const result = calculateThermalCalculation(readySource(), {
      ...inputs,
      tank_construction_type: 'acrylic',
      tank_wall_layers: [{
        material: 'Project acrylic',
        thickness_mm: 20,
        conductivity_w_m_k: 0.2,
      }],
      tank_wall_override_justification: 'Reviewed project wall schedule.',
    });
    const expected = 1 / (
      1 / THERMAL_CONSTANTS.inside_film_coefficient_w_m2_k +
      0.02 / 0.2 +
      1 / THERMAL_CONSTANTS.outside_film_coefficient_w_m2_k
    );

    expect(result.results.wall_u_value_w_m2_k).toBeCloseTo(expected, 12);
    expect(result.wall_construction_basis).toMatchObject({
      source: 'AAT Foundations wall-layer default with designer override',
      default_layers: [{ material: 'Acrylic / PMMA', thickness_m: 0.012, conductivity_w_m_k: 0.19 }],
      effective_layers: [{ material: 'Project acrylic', thickness_m: 0.02, conductivity_w_m_k: 0.2 }],
      layer_override_flags: { material: true, thickness_mm: true, conductivity_w_m_k: true },
      layer_override_justification: 'Reviewed project wall schedule.',
    });
  });

  it('blocks non-positive selected-construction layer values instead of falling back to defaults', () => {
    const inputs = readyInputs();
    delete (inputs as any).reviewed_u_value_w_m2_k;
    const result = calculateThermalCalculation(readySource(), {
      ...inputs,
      tank_construction_type: 'frp',
      tank_wall_layers: [{
        material: 'FRP / GRP laminate',
        thickness_mm: 0,
        conductivity_w_m_k: -1,
      }],
    });

    expect(result.status).toBe('Blocked');
    expect(result.reasons).toContain(
      'Every tank wall layer requires material, positive thickness, and positive conductivity.',
    );
  });

  it('retains reviewed explicit wall layers when no default construction applies', () => {
    const inputs = readyInputs();
    delete (inputs as any).reviewed_u_value_w_m2_k;
    const result = calculateThermalCalculation(readySource(), {
      ...inputs,
      tank_wall_layers: [{
        material: 'Insulated panel',
        thickness_mm: 50,
        conductivity_w_m_k: 0.04,
      }],
    });

    expect(result.status).toBe('Ready');
    expect(result.wall_construction_basis).toMatchObject({
      construction_type: null,
      source: 'film coefficients plus wall-layer resistance',
      reviewed: true,
      layers: [{
        material: 'Insulated panel',
        thickness_m: 0.05,
        conductivity_w_m_k: 0.04,
      }],
    });
  });

  it('uses and distinguishes a reviewed water-temperature override', () => {
    const result = calculateThermalCalculation(readySource(), {
      ...readyInputs(),
      reviewed_water_temperature_c: 27,
    });

    expect(result.status).toBe('Ready');
    expect(result.water_temperature_basis).toMatchObject({
      source: 'system reviewed water-temperature override',
      minimum_c: 24,
      maximum_c: 26,
      average_c: 25,
      calculated_temperature_c: 27,
      reviewed_override_used: true,
    });
  });

  it('blocks reversed and incomplete linked-exhibit temperature ranges', () => {
    const reversed = readySource();
    reversed.water_temperature_sources[0].water_temperature_min_c = 27;
    reversed.water_temperature_sources[0].water_temperature_max_c = 24;
    reversed.water_temperature_sources[0].water_temperature_range_status = 'invalid';
    const invalidResult = calculateThermalCalculation(reversed, readyInputs());
    expect(invalidResult.status).toBe('Blocked');
    expect(invalidResult.reasons.join(' ')).toMatch(/valid water design-temperature range/i);

    const incomplete = readySource();
    incomplete.water_temperature_sources[0].water_temperature_max_c = null;
    incomplete.water_temperature_sources[0].water_temperature_range_status = 'incomplete';
    const incompleteResult = calculateThermalCalculation(incomplete, readyInputs());
    expect(incompleteResult.status).toBe('Blocked');
    expect(incompleteResult.reasons.join(' ')).toMatch(/both minimum and maximum/i);
  });

  it('blocks a missing linked-exhibit temperature range', () => {
    const missing = readySource();
    missing.water_temperature_sources = [];

    const result = calculateThermalCalculation(missing, readyInputs());

    expect(result.status).toBe('Blocked');
    expect(result.reasons.join(' ')).toMatch(/no linked exhibit provides a water design-temperature range/i);
  });

  it('blocks rather than inventing a missing evaporation correlation', () => {
    const inputs = readyInputs();
    delete (inputs as any).evaporation_coefficient_kg_m2_s_kpa;
    const result = calculateThermalCalculation(readySource(), inputs);
    expect(result.status).toBe('Blocked');
    expect(result.reasons.join(' ')).toMatch(/manual does not supply one automatically/i);
  });

  it('uses an immutable shared-library snapshot without consulting mutable catalogue data', () => {
    const result = calculateThermalCalculation(readySource(), {
      ...readyInputs(),
      agitation_class: 'Moderate',
      agitation_correlation_snapshot: {
        source: 'shared_library',
        correlation_id: 'correlation-1',
        agitation_class: 'Moderate',
        version: 'approved-2026.2',
        coefficient_kg_m2_s_kpa: 0.0000012,
        effective_coefficient_kg_m2_s_kpa: 0.0000012,
        approved: true,
        deviation: false,
        source_reference: 'Engineering standard ES-42',
        captured_at: '2026-08-31T00:00:00.000Z',
      },
      evaporation_coefficient_kg_m2_s_kpa: 999,
    });

    expect(result.status).toBe('Ready');
    expect(result.formula_inputs.evaporation_coefficient_kg_m2_s_kpa).toBe(0.0000012);
    expect(result.correlation_snapshot).toMatchObject({
      correlation_id: 'correlation-1',
      version: 'approved-2026.2',
      source_reference: 'Engineering standard ES-42',
    });
    expect(result.formula_inputs.evaporation_correlation_basis).toEqual(
      result.correlation_snapshot,
    );
  });

  it('requires justification for a project-specific shared-correlation deviation', () => {
    const snapshot = {
      source: 'project_deviation',
      correlation_id: 'correlation-1',
      agitation_class: 'Moderate',
      version: 'approved-2026.2',
      coefficient_kg_m2_s_kpa: 0.0000012,
      effective_coefficient_kg_m2_s_kpa: 0.0000015,
      approved: true,
      deviation: true,
    };
    const blocked = calculateThermalCalculation(readySource(), {
      ...readyInputs(),
      agitation_correlation_snapshot: snapshot,
      agitation_correlation_deviation: true,
      deviation_justification: '',
    });
    expect(blocked.status).toBe('Blocked');
    expect(blocked.reasons.join(' ')).toMatch(/deviation justification/i);

    const ready = calculateThermalCalculation(readySource(), {
      ...readyInputs(),
      agitation_correlation_snapshot: {
        ...snapshot,
        deviation_justification: 'Project-specific splash regime confirmed by engineering review.',
      },
      agitation_correlation_deviation: true,
      deviation_justification: 'Project-specific splash regime confirmed by engineering review.',
    });
    expect(ready.status).toBe('Ready');
    expect(ready.formula_inputs.evaporation_coefficient_kg_m2_s_kpa).toBe(0.0000015);
  });

  it('blocks conflicting linked-exhibit temperatures', () => {
    const source = readySource();
    source.water_temperature_sources.push({
      exhibit_id: 'exhibit-2',
      exhibit_code: 'EX-2',
      water_temperature_min_c: 24,
      water_temperature_max_c: 24,
      water_temperature_range_status: 'valid',
      water_type: null,
    });
    const result = calculateThermalCalculation(source, readyInputs());
    expect(result.status).toBe('Blocked');
    expect(result.reasons.join(' ')).toMatch(/conflicting water design temperatures/i);
  });

  it('defaults custom wall area from rectangular dimensions and keeps sensitivity separate from the base', () => {
    const source = readySource('Custom');
    expect(source.linked_tanks[0].exposed_wall_area_m2).toBe(21);
    expect(source.linked_tanks[0].exposed_wall_source).toBe('rectangular default (custom tank)');

    const defaulted = calculateThermalCalculation(source, readyInputs());
    expect(defaulted.status).toBe('Ready');
    expect(defaulted.results.exposed_wall_area_m2).toBe(21);

    const reviewed = calculateThermalCalculation(source, {
      ...readyInputs(),
      custom_tank_wall_areas_m2: { 'tank-1': 7 },
    });
    expect(reviewed.status).toBe('Ready');
    expect(reviewed.results.exposed_wall_area_m2).toBe(7);
    expect(reviewed.source_snapshot.linked_tanks[0].exposed_wall_source).toBe('manual override (custom tank)');

    const cleared = calculateThermalCalculation(source, {
      ...readyInputs(),
      custom_tank_wall_areas_m2: { 'tank-1': null },
    });
    expect(cleared.results.exposed_wall_area_m2).toBe(21);
    expect(cleared.source_snapshot.linked_tanks[0].exposed_wall_source).toBe('rectangular default (custom tank)');

    const saved = { ...source, linked_tanks: [{ ...source.linked_tanks[0], exposed_wall_area_m2: 9, exposed_wall_source: 'tank saved exposed wall area' }] };
    const savedResult = calculateThermalCalculation(saved, readyInputs());
    expect(savedResult.results.exposed_wall_area_m2).toBe(9);
    expect(savedResult.source_snapshot.linked_tanks[0].exposed_wall_source).toBe('tank saved exposed wall area');

    const incomplete = {
      ...source,
      linked_tanks: [{ ...source.linked_tanks[0], dimensions: { inner_length_mm: null, inner_width_mm: 2000, water_height_mm: 1500 }, exposed_wall_area_m2: null }],
    };
    const blocked = calculateThermalCalculation(incomplete, readyInputs());
    expect(blocked.status).toBe('Blocked');
    expect(blocked.reasons.join(' ')).toMatch(/rectangular default.*reviewed override/i);

    const ready = calculateThermalCalculation(readySource(), readyInputs());
    expect(ready.sensitivity_summary.cases).toHaveLength(5);
    expect(ready.sensitivity_cases.some(item => item.case_key === 'surface_plus_10_pct')).toBe(true);
    expect(ready.results.free_surface_area_m2).toBe(10);
  });

  it('rejects negative equipment heat gain', () => {
    const result = calculateThermalCalculation(readySource(), {
      ...readyInputs(),
      equipment_heat_gain_kw: -10,
    });
    expect(result.status).toBe('Blocked');
    expect(result.reasons.join(' ')).toMatch(/non-negative/i);
  });

  it('does not recommend an unapproved adjacent agitation correlation', () => {
    const result = calculateThermalCalculation(readySource(), {
      ...readyInputs(),
      adjacent_agitation_classes: ['High'],
      agitation_correlations: {
        Moderate: {
          coefficient_kg_m2_s_kpa: 0.000001,
          version: 'reviewed-2026',
          approved: true,
        },
        High: {
          coefficient_kg_m2_s_kpa: 0.0001,
          version: '',
          approved: false,
        },
      },
    });
    const adjacent = result.sensitivity_cases.find(item => item.case_key === 'agitation_High');
    expect(adjacent?.status).toBe('Blocked');
    expect(result.sensitivity_summary.recommended_case).not.toBe('agitation_High');
  });

  it('counts explicit water exchange but never normal circulation', () => {
    const inputs = {
      ...readyInputs(),
      water_exchange_enabled: true,
      water_exchange_flow_m3h: 1,
      water_exchange_inlet_temperature_c: 20,
    };
    const result = calculateThermalCalculation(readySource(), inputs);
    expect(result.contributions.water_exchange_kw).toBeCloseTo(
      1000 * 4.186 * (20 - 25) / 3600,
      12,
    );
    expect(result.results.circulation_flow_m3h).toBe(120);
  });
});
