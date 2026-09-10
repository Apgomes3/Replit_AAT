import { describe, expect, it } from 'vitest';
import {
  calculateFrictionLoss,
  FRICTION_LOSS_CALCULATION_VERSION,
} from './frictionLossCalculations';

const pump = { id: 'pump-1', project_equipment_item_id: 'pump-1', equip_code: 'P-101' };
const pipe = {
  project_piping_item_id: 'pipe-1',
  piping_snapshot: { piping_code: 'PIPE-1' },
  component_kind: 'pipe' as const,
  internal_diameter_mm: 100,
  straight_length_m: 10,
  material: 'PVC-U',
  absolute_roughness_mm: 0.0015,
};
const fitting = {
  project_piping_item_id: 'fit-1',
  piping_snapshot: { piping_code: 'FIT-1' },
  component_kind: 'fitting' as const,
  internal_diameter_mm: 100,
  fitting_k_value: 0.9,
  quantity: 2,
};
const tankBoundaries = {
  start: { tank_id: 'tank-1', base_elevation_fl0_m: 0, water_depth_m: 3, pump_draw_height_m: 0.5, open_to_atmosphere: true, atmospheric_pressure_kpa: 101.325, water_temperature_c: 20, npsh_safety_margin_m: 0.5 },
  end: { tank_id: 'tank-2', base_elevation_fl0_m: 5, water_depth_m: 2, open_to_atmosphere: true },
};

describe('calculateFrictionLoss', () => {
  it('calculates separate Darcy-Weisbach and K-value side totals', () => {
    const result = calculateFrictionLoss({
      flow_m3h: 36,
      selected_pump: pump,
      tank_boundaries: tankBoundaries,
      components: [
        { ...pipe, side: 'suction' },
        { ...fitting, side: 'discharge' },
      ],
      calculated_at: '2026-08-31T00:00:00.000Z',
    });
    expect(result.status).toBe('ready');
    expect(result.calculation_version).toBe(FRICTION_LOSS_CALCULATION_VERSION);
    expect(result.components[0].velocity_m_s).toBeCloseTo(1.27324, 4);
    expect(result.components[0].reynolds_number).toBeGreaterThan(100000);
    expect(result.side_totals.suction.major_head_loss_m).toBeGreaterThan(0);
    expect(result.side_totals.discharge.minor_head_loss_m).toBeGreaterThan(0);
    expect(result.results.combined_head_loss_m).toBeCloseTo(
      result.side_totals.suction.total_head_loss_m + result.side_totals.discharge.total_head_loss_m,
      5,
    );
    expect(result.results.combined_pressure_drop_kpa).toBeGreaterThan(0);
    expect(result.results.static_head_m).toBe(4);
    expect(result.results.total_dynamic_head_m).toBeCloseTo(result.results.combined_head_loss_m + 4, 5);
  });

  it('returns specific readiness reasons instead of zero defaults', () => {
    const result = calculateFrictionLoss({
      flow_m3h: null,
      components: [
        { ...pipe, side: 'suction', internal_diameter_mm: null, material: '', straight_length_m: null, absolute_roughness_mm: null },
      ],
    });
    expect(result.status).toBe('incomplete');
    expect(result.reasons).toContain('Circuit flow is missing or must be greater than zero.');
    expect(result.reasons).toContain('Select a pump assigned to this LSS system.');
    expect(result.reasons).toContain('Add at least one discharge-side pipe or fitting.');
    expect(result.reasons.some(reason => reason.includes('internal diameter'))).toBe(true);
    expect(result.reasons.some(reason => reason.includes('pipe material'))).toBe(true);
    expect(result.results.combined_head_loss_m).toBeNull();
  });

  it('keeps fitting quantity and K-value explicit', () => {
    const result = calculateFrictionLoss({
      flow_m3h: 10,
      selected_pump: pump,
      tank_boundaries: tankBoundaries,
      components: [
        { ...fitting, side: 'suction', quantity: 0 },
        { ...fitting, side: 'discharge', fitting_k_value: null },
      ],
    });
    expect(result.status).toBe('incomplete');
    expect(result.reasons.some(reason => reason.includes('quantity must be greater than zero'))).toBe(true);
    expect(result.reasons.some(reason => reason.includes('K-value must be zero or greater'))).toBe(true);
  });

  it('uses free surfaces for static head and keeps pump draw height out of TDH', () => {
    const first = calculateFrictionLoss({
      flow_m3h: 36, selected_pump: pump, tank_boundaries: tankBoundaries,
      components: [{ ...pipe, side: 'suction' }, { ...fitting, side: 'discharge' }],
    });
    const second = calculateFrictionLoss({
      flow_m3h: 36, selected_pump: pump,
      tank_boundaries: { ...tankBoundaries, start: { ...tankBoundaries.start, pump_draw_height_m: 2.5 } },
      components: [{ ...pipe, side: 'suction' }, { ...fitting, side: 'discharge' }],
    });
    expect(first.results.static_head_m).toBe(4);
    expect(second.results.static_head_m).toBe(4);
    expect(second.results.total_dynamic_head_m).toBe(first.results.total_dynamic_head_m);
  });

  it('calculates NPSH available at the draw point without changing static head', () => {
    const result = calculateFrictionLoss({
      flow_m3h: 36,
      selected_pump: { ...pump, npsh_required_m: 2 },
      tank_boundaries: tankBoundaries,
      components: [{ ...pipe, side: 'suction' }, { ...fitting, side: 'discharge' }],
    });
    expect(result.results.npsh_status).toBe('pass');
    expect(result.results.npsh_available_m).toBeGreaterThan(2);
    expect(result.results.npsh_required_m).toBe(2);
    expect(result.results.npsh_inputs.suction_loss_m).toBe(result.side_totals.suction.total_head_loss_m);
    expect(result.results.static_head_m).toBe(4);
  });

  it('blocks a selected pump when governed NPSH required exceeds available head', () => {
    const result = calculateFrictionLoss({
      flow_m3h: 36,
      selected_pump: { ...pump, npsh_required_m: 20 },
      tank_boundaries: tankBoundaries,
      components: [{ ...pipe, side: 'suction' }, { ...fitting, side: 'discharge' }],
    });
    expect(result.results.npsh_status).toBe('blocked');
    expect(result.status).toBe('ready');
    expect(result.reasons).not.toContain(expect.stringContaining('NPSH available'));
  });

  it('warns when the pump has no governed NPSH-required evidence', () => {
    const result = calculateFrictionLoss({
      flow_m3h: 36,
      selected_pump: pump,
      tank_boundaries: tankBoundaries,
      components: [{ ...pipe, side: 'suction' }, { ...fitting, side: 'discharge' }],
    });
    expect(result.results.npsh_status).toBe('warning');
    expect(result.status).toBe('ready');
  });
});