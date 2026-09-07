import { describe, expect, it } from 'vitest';
import { calculateOzoneRequirement, convertOzoneRate } from './ozoneCalculations';

describe('ozone requirement', () => {
  const lines = [
    { circuit_key: 'ff:1', pump_duty_tag: 'FFSP', pump_role: 'primary', flow_m3h: 100 },
    { circuit_key: 'ff:1', pump_duty_tag: 'FFVP', pump_role: 'venturi', venturi_flow_m3h: 25 },
  ];

  it('uses FFSP flow only by default', () => {
    expect(calculateOzoneRequirement({
      target_concentration_mg_l: 0.05,
      pump_lines: lines,
    })).toMatchObject({
      status: 'ready',
      ffsp_flow_m3h: 100,
      applicable_ffvp_flow_m3h: 0,
      total_treatment_flow_m3h: 100,
      ozone_required_mg_h: 5_000,
    });
  });

  it('adds FFVP flow only when that circuit draws directly from the plenum', () => {
    expect(calculateOzoneRequirement({
      target_concentration_mg_l: 0.05,
      pump_lines: lines,
      ffvp_plenum_circuit_keys: ['ff:1'],
    })).toMatchObject({
      total_treatment_flow_m3h: 125,
      ozone_required_mg_h: 6_250,
    });
  });

  it('converts display units without changing the mg/h basis', () => {
    expect(convertOzoneRate(6_250, 'g/h')).toBe(6.25);
    expect(convertOzoneRate(453_592.37, 'lb/h')).toBeCloseTo(1);
  });
});