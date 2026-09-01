import { describe, expect, it } from 'vitest';
import {
  calculatePumpSelection, evaluateSelectedPumpSuitability, WATER_DENSITY_KG_M3,
  isFoamFractionatorCircuit, defaultPumpLineName, buildPumpLineItem, pumpLinesForCircuit,
  pumpCircuits, PUMP_ROLE_PRIMARY, PUMP_ROLE_VENTURI, FOAM_FRACTIONATION_CIRCUIT_TYPE,
} from './pumpSelections';

describe('pump circuit intent', () => {
  const system = { design_flow_m3h: 100, loop1_flow_pct: 80, loop1_filtration: 'Sand Filter' };
  const streams = [
    { id: 'yes', parent_loop_number: 1, name: 'UV', preset: 'UV', flow_pct: 25, has_dedicated_pump: true },
    { id: 'no', parent_loop_number: 1, name: 'Thermal', preset: 'Thermal', flow_pct: 50, has_dedicated_pump: false },
  ];

  it('only creates side-stream duties for branches with a dedicated pump', () => {
    expect(pumpCircuits(system, streams).map(item => item.circuit_key)).toEqual([
      'loop:1',
      'side_stream:yes',
    ]);
  });
});

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

describe('isFoamFractionatorCircuit', () => {
  it('recognises a Foam Fractionation loop circuit', () => {
    expect(isFoamFractionatorCircuit({ circuit_kind: 'loop', circuit_type: FOAM_FRACTIONATION_CIRCUIT_TYPE })).toBe(true);
  });
  it('returns false for a side stream of the same type label', () => {
    expect(isFoamFractionatorCircuit({ circuit_kind: 'side_stream', circuit_type: FOAM_FRACTIONATION_CIRCUIT_TYPE })).toBe(false);
  });
  it('returns false for a non-FF loop', () => {
    expect(isFoamFractionatorCircuit({ circuit_kind: 'loop', circuit_type: 'Sand Filter' })).toBe(false);
  });
  it('returns false for a circuit with no type', () => {
    expect(isFoamFractionatorCircuit({ circuit_kind: 'loop', circuit_type: null })).toBe(false);
  });
});

describe('defaultPumpLineName', () => {
  const ffCircuit = { circuit_name: 'Loop 1', circuit_kind: 'loop', circuit_type: FOAM_FRACTIONATION_CIRCUIT_TYPE };
  const sandCircuit = { circuit_name: 'Sand Filter Loop', circuit_kind: 'loop', circuit_type: 'Sand Filter' };

  it('returns FFSP name for primary role on FF circuit', () => {
    expect(defaultPumpLineName(ffCircuit, PUMP_ROLE_PRIMARY)).toBe('FFSP — Foam Fractionator Supply Pump');
  });
  it('returns FFVP name for venturi role on FF circuit', () => {
    expect(defaultPumpLineName(ffCircuit, PUMP_ROLE_VENTURI)).toBe('FFVP — Foam Fractionator Venturi Pump');
  });
  it('returns circuit name for non-FF circuit', () => {
    expect(defaultPumpLineName(sandCircuit, PUMP_ROLE_PRIMARY)).toBe('Sand Filter Loop');
  });
});

describe('buildPumpLineItem', () => {
  const circuit = {
    circuit_key: 'loop:1', circuit_kind: 'loop', circuit_name: 'Loop 1',
    circuit_type: FOAM_FRACTIONATION_CIRCUIT_TYPE, parent_loop_number: 1,
    side_stream_id: null, flow_m3h: 224.15,
  };

  it('FFSP line uses circuit flow (224.15 m³/h) as effective flow', () => {
    const line = buildPumpLineItem(circuit, null, PUMP_ROLE_PRIMARY);
    expect(line.effective_flow_m3h).toBe(224.15);
    expect(line.flow_m3h).toBe(224.15);
    expect(line.pump_role).toBe(PUMP_ROLE_PRIMARY);
    expect(line.pump_role_name).toBe('FFSP — Foam Fractionator Supply Pump');
    expect(line.is_foam_fractionator).toBe(true);
  });

  it('FFSP unsaved line has status incomplete (no pump selected)', () => {
    const line = buildPumpLineItem(circuit, null, PUMP_ROLE_PRIMARY);
    expect(line.status).toBe('incomplete');
    expect(line.freshness).toBe('unsaved');
  });

  it('FFVP line uses venturi_flow_m3h, not circuit flow', () => {
    const row = { venturi_flow_m3h: '42.5', pump_role: PUMP_ROLE_VENTURI };
    const line = buildPumpLineItem(circuit, row, PUMP_ROLE_VENTURI);
    expect(line.effective_flow_m3h).toBe(42.5);
    // circuit flow is unchanged on the line
    expect(line.flow_m3h).toBe(224.15);
    expect(line.pump_role).toBe(PUMP_ROLE_VENTURI);
    expect(line.pump_role_name).toBe('FFVP — Foam Fractionator Venturi Pump');
  });

  it('FFVP line with no venturi flow is blocked with a clear reason', () => {
    const row = { pump_role: PUMP_ROLE_VENTURI, venturi_flow_m3h: null };
    const line = buildPumpLineItem(circuit, row, PUMP_ROLE_VENTURI);
    expect(line.effective_flow_m3h).toBeNull();
    expect(line.status).toBe('incomplete');
    expect(line.reasons.some(r => r.includes('Venturi duty flow is required'))).toBe(true);
    // Must not silently use the 224.15 m³/h circuit flow
    expect(line.results.hydraulic_power_kw).toBeNull();
  });

  it('FFVP line with null row is blocked (unsaved, no venturi flow known)', () => {
    const line = buildPumpLineItem(circuit, null, PUMP_ROLE_VENTURI);
    expect(line.effective_flow_m3h).toBeNull();
    expect(line.status).toBe('incomplete');
    expect(line.reasons.some(r => r.includes('Venturi duty flow is required'))).toBe(true);
  });

  it('FFVP fingerprint changes when venturi flow changes', () => {
    const row1 = { venturi_flow_m3h: '42.5', pump_role: PUMP_ROLE_VENTURI, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 };
    const row2 = { venturi_flow_m3h: '50', pump_role: PUMP_ROLE_VENTURI, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 };
    const l1 = buildPumpLineItem(circuit, row1, PUMP_ROLE_VENTURI);
    const l2 = buildPumpLineItem(circuit, row2, PUMP_ROLE_VENTURI);
    expect(l1.current_source_fingerprint).not.toBe(l2.current_source_fingerprint);
  });

  it('FFSP and FFVP fingerprints differ on the same circuit', () => {
    const row = { venturi_flow_m3h: null, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 };
    const ffsp = buildPumpLineItem(circuit, row, PUMP_ROLE_PRIMARY);
    const ffvp = buildPumpLineItem(circuit, row, PUMP_ROLE_VENTURI);
    expect(ffsp.current_source_fingerprint).not.toBe(ffvp.current_source_fingerprint);
  });
});

describe('pumpLinesForCircuit', () => {
  const ffCircuit = {
    circuit_key: 'loop:1', circuit_kind: 'loop', circuit_name: 'Loop 1',
    circuit_type: FOAM_FRACTIONATION_CIRCUIT_TYPE, parent_loop_number: 1,
    side_stream_id: null, flow_m3h: 224.15,
  };
  const sandCircuit = {
    circuit_key: 'loop:2', circuit_kind: 'loop', circuit_name: 'Sand Filter Loop',
    circuit_type: 'Sand Filter', parent_loop_number: 2, side_stream_id: null, flow_m3h: 100,
  };

  it('non-FF circuit always returns exactly one line (primary)', () => {
    const lines = pumpLinesForCircuit(sandCircuit, []);
    expect(lines).toHaveLength(1);
    expect(lines[0].pump_role).toBe(PUMP_ROLE_PRIMARY);
  });

  it('non-FF circuit with a saved row returns one line', () => {
    const saved = [{ circuit_key: 'loop:2', pump_role: PUMP_ROLE_PRIMARY, design_head_m: '15' }];
    const lines = pumpLinesForCircuit(sandCircuit, saved);
    expect(lines).toHaveLength(1);
    expect(lines[0].design_head_m).toBe(15);
  });

  it('FF circuit with no saved rows returns one FFSP line', () => {
    const lines = pumpLinesForCircuit(ffCircuit, []);
    expect(lines).toHaveLength(1);
    expect(lines[0].pump_role).toBe(PUMP_ROLE_PRIMARY);
    expect(lines[0].pump_role_name).toBe('FFSP — Foam Fractionator Supply Pump');
  });

  it('FF circuit with only primary row returns one FFSP line', () => {
    const saved = [{ circuit_key: 'loop:1', pump_role: PUMP_ROLE_PRIMARY, design_head_m: '10' }];
    const lines = pumpLinesForCircuit(ffCircuit, saved);
    expect(lines).toHaveLength(1);
    expect(lines[0].pump_role).toBe(PUMP_ROLE_PRIMARY);
  });

  it('FF circuit with both primary and venturi rows returns two lines in order', () => {
    const saved = [
      { circuit_key: 'loop:1', pump_role: PUMP_ROLE_PRIMARY, design_head_m: '10' },
      { circuit_key: 'loop:1', pump_role: PUMP_ROLE_VENTURI, venturi_flow_m3h: '42.5', design_head_m: '8' },
    ];
    const lines = pumpLinesForCircuit(ffCircuit, saved);
    expect(lines).toHaveLength(2);
    expect(lines[0].pump_role).toBe(PUMP_ROLE_PRIMARY);
    expect(lines[1].pump_role).toBe(PUMP_ROLE_VENTURI);
  });

  it('FF circuit with only venturi row does NOT return an orphaned venturi without FFSP', () => {
    // A venturi without a primary saved row should still produce FFSP (unsaved) + FFVP.
    const saved = [{ circuit_key: 'loop:1', pump_role: PUMP_ROLE_VENTURI, venturi_flow_m3h: '42.5' }];
    const lines = pumpLinesForCircuit(ffCircuit, saved);
    expect(lines).toHaveLength(2);
    expect(lines[0].pump_role).toBe(PUMP_ROLE_PRIMARY);
    expect(lines[0].freshness).toBe('unsaved');
    expect(lines[1].pump_role).toBe(PUMP_ROLE_VENTURI);
  });

  it('ignores saved rows from other circuits', () => {
    const saved = [
      { circuit_key: 'loop:2', pump_role: PUMP_ROLE_PRIMARY, design_head_m: '5' },
    ];
    const lines = pumpLinesForCircuit(ffCircuit, saved);
    expect(lines).toHaveLength(1);
    expect(lines[0].freshness).toBe('unsaved');
  });
});
