import { describe, expect, it } from 'vitest';
import { calculatePumpSelection, evaluateSelectedPumpSuitability, WATER_DENSITY_KG_M3 } from './pumpSelections';

describe('pump selection calculation', () => {
  it('calculates hydraulic, shaft, motor input and next standard motor', () => {
    const result = calculatePumpSelection({ flow_m3h: 36, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 });
    expect(result.status).toBe('ready');
    expect(result.constants.water_density_kg_m3).toBe(WATER_DENSITY_KG_M3);
    expect(result.results.hydraulic_power_kw).toBeCloseTo(0.98, 2);
    expect(result.results.shaft_power_kw).toBeCloseTo(1.224, 3);
    expect(result.results.motor_input_kw).toBeCloseTo(1.36, 3);
    expect(result.results.recommended_motor_kw).toBe(1.5);
  });
  it('does not return invented zeroes for incomplete inputs', () => {
    const result = calculatePumpSelection({ flow_m3h: 10, design_head_m: 0, pump_efficiency_pct: 101, motor_efficiency_pct: null });
    expect(result.status).toBe('incomplete');
    expect(result.results).toEqual({ hydraulic_power_kw: null, shaft_power_kw: null, motor_input_kw: null, recommended_motor_kw: null });
  });
  it('does not mark duties above the configured motor series ready', () => {
    const result = calculatePumpSelection({
      flow_m3h: 5000,
      design_head_m: 40,
      pump_efficiency_pct: 70,
      motor_efficiency_pct: 90,
    });
    expect(result.results.motor_input_kw).toBeGreaterThan(315);
    expect(result.results.recommended_motor_kw).toBeNull();
    expect(result.status).toBe('incomplete');
    expect(result.reasons.some(reason =>
      reason.includes('exceeds the largest configured standard motor size'),
    )).toBe(true);
  });
});

describe('selected pump suitability', () => {
  const calculation = calculatePumpSelection({ flow_m3h: 36, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 });
  it('rejects insufficient catalog power using numeric database strings', () => {
    const result = evaluateSelectedPumpSuitability({ selectedPump: { power_kw: '1.1' }, circuitFlowM3h: 36, designHeadM: 10, calculation });
    expect(result.status).toBe('incompatible');
    expect(result.reasons[0]).toContain('1.1 kW');
    expect(result.reasons[0]).toContain('1.5 kW');
  });
  it('checks optional catalog flow and head ratings when they are supplied', () => {
    const result = evaluateSelectedPumpSuitability({ selectedPump: { power_kw: '1.5', design_flow_m3h: '30', design_head_m: '8' }, circuitFlowM3h: 36, designHeadM: 10, calculation });
    expect(result.status).toBe('incompatible');
    expect(result.reasons.join(' ')).toContain('30 m³/h');
    expect(result.reasons.join(' ')).toContain('8 m');
  });
});