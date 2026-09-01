"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pumpSelections_1 = require("./pumpSelections");
(0, vitest_1.describe)('pump circuit intent', () => {
    const system = { design_flow_m3h: 100, loop1_flow_pct: 80, loop1_filtration: 'Sand Filter' };
    const streams = [
        { id: 'yes', parent_loop_number: 1, name: 'UV', preset: 'UV', flow_pct: 25, has_dedicated_pump: true },
        { id: 'no', parent_loop_number: 1, name: 'Thermal', preset: 'Thermal', flow_pct: 50, has_dedicated_pump: false },
    ];
    (0, vitest_1.it)('only creates side-stream duties for branches with a dedicated pump', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.pumpCircuits)(system, streams).map(item => item.circuit_key)).toEqual([
            'loop:1',
            'side_stream:yes',
        ]);
    });
});
(0, vitest_1.describe)('pump selection calculation', () => {
    (0, vitest_1.it)('calculates hydraulic, shaft, motor input and next standard motor', () => {
        const result = (0, pumpSelections_1.calculatePumpSelection)({ flow_m3h: 36, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 });
        (0, vitest_1.expect)(result.status).toBe('ready');
        (0, vitest_1.expect)(result.constants.water_density_kg_m3).toBe(pumpSelections_1.WATER_DENSITY_KG_M3);
        (0, vitest_1.expect)(result.results.hydraulic_power_kw).toBeCloseTo(0.98, 2);
        (0, vitest_1.expect)(result.results.shaft_power_kw).toBeCloseTo(1.224, 3);
        (0, vitest_1.expect)(result.results.motor_input_kw).toBeCloseTo(1.36, 3);
        (0, vitest_1.expect)(result.results.recommended_motor_kw).toBe(1.5);
    });
    (0, vitest_1.it)('does not return invented zeroes for incomplete inputs', () => {
        const result = (0, pumpSelections_1.calculatePumpSelection)({ flow_m3h: 10, design_head_m: 0, pump_efficiency_pct: 101, motor_efficiency_pct: null });
        (0, vitest_1.expect)(result.status).toBe('incomplete');
        (0, vitest_1.expect)(result.results).toEqual({ hydraulic_power_kw: null, shaft_power_kw: null, motor_input_kw: null, recommended_motor_kw: null });
    });
    (0, vitest_1.it)('does not mark duties above the configured motor series ready', () => {
        const result = (0, pumpSelections_1.calculatePumpSelection)({
            flow_m3h: 5000,
            design_head_m: 40,
            pump_efficiency_pct: 70,
            motor_efficiency_pct: 90,
        });
        (0, vitest_1.expect)(result.results.motor_input_kw).toBeGreaterThan(315);
        (0, vitest_1.expect)(result.results.recommended_motor_kw).toBeNull();
        (0, vitest_1.expect)(result.status).toBe('incomplete');
        (0, vitest_1.expect)(result.reasons.some(reason => reason.includes('exceeds the largest configured standard motor size'))).toBe(true);
    });
});
(0, vitest_1.describe)('selected pump suitability', () => {
    const calculation = (0, pumpSelections_1.calculatePumpSelection)({ flow_m3h: 36, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 });
    (0, vitest_1.it)('rejects insufficient catalog power using numeric database strings', () => {
        const result = (0, pumpSelections_1.evaluateSelectedPumpSuitability)({ selectedPump: { power_kw: '1.1' }, circuitFlowM3h: 36, designHeadM: 10, calculation });
        (0, vitest_1.expect)(result.status).toBe('incompatible');
        (0, vitest_1.expect)(result.reasons[0]).toContain('1.1 kW');
        (0, vitest_1.expect)(result.reasons[0]).toContain('1.5 kW');
    });
    (0, vitest_1.it)('checks optional catalog flow and head ratings when they are supplied', () => {
        const result = (0, pumpSelections_1.evaluateSelectedPumpSuitability)({ selectedPump: { power_kw: '1.5', design_flow_m3h: '30', design_head_m: '8' }, circuitFlowM3h: 36, designHeadM: 10, calculation });
        (0, vitest_1.expect)(result.status).toBe('incompatible');
        (0, vitest_1.expect)(result.reasons.join(' ')).toContain('30 m³/h');
        (0, vitest_1.expect)(result.reasons.join(' ')).toContain('8 m');
    });
});
(0, vitest_1.describe)('isFoamFractionatorCircuit', () => {
    (0, vitest_1.it)('recognises a Foam Fractionation loop circuit', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.isFoamFractionatorCircuit)({ circuit_kind: 'loop', circuit_type: pumpSelections_1.FOAM_FRACTIONATION_CIRCUIT_TYPE })).toBe(true);
    });
    (0, vitest_1.it)('returns false for a side stream of the same type label', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.isFoamFractionatorCircuit)({ circuit_kind: 'side_stream', circuit_type: pumpSelections_1.FOAM_FRACTIONATION_CIRCUIT_TYPE })).toBe(false);
    });
    (0, vitest_1.it)('returns false for a non-FF loop', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.isFoamFractionatorCircuit)({ circuit_kind: 'loop', circuit_type: 'Sand Filter' })).toBe(false);
    });
    (0, vitest_1.it)('returns false for a circuit with no type', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.isFoamFractionatorCircuit)({ circuit_kind: 'loop', circuit_type: null })).toBe(false);
    });
});
(0, vitest_1.describe)('defaultPumpLineName', () => {
    const ffCircuit = { circuit_name: 'Loop 1', circuit_kind: 'loop', circuit_type: pumpSelections_1.FOAM_FRACTIONATION_CIRCUIT_TYPE };
    const sandCircuit = { circuit_name: 'Sand Filter Loop', circuit_kind: 'loop', circuit_type: 'Sand Filter' };
    (0, vitest_1.it)('returns FFSP name for primary role on FF circuit', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.defaultPumpLineName)(ffCircuit, pumpSelections_1.PUMP_ROLE_PRIMARY)).toBe('FFSP — Foam Fractionator Supply Pump');
    });
    (0, vitest_1.it)('returns FFVP name for venturi role on FF circuit', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.defaultPumpLineName)(ffCircuit, pumpSelections_1.PUMP_ROLE_VENTURI)).toBe('FFVP — Foam Fractionator Venturi Pump');
    });
    (0, vitest_1.it)('returns circuit name for non-FF circuit', () => {
        (0, vitest_1.expect)((0, pumpSelections_1.defaultPumpLineName)(sandCircuit, pumpSelections_1.PUMP_ROLE_PRIMARY)).toBe('Sand Filter Loop');
    });
});
(0, vitest_1.describe)('buildPumpLineItem', () => {
    const circuit = {
        circuit_key: 'loop:1', circuit_kind: 'loop', circuit_name: 'Loop 1',
        circuit_type: pumpSelections_1.FOAM_FRACTIONATION_CIRCUIT_TYPE, parent_loop_number: 1,
        side_stream_id: null, flow_m3h: 224.15,
    };
    (0, vitest_1.it)('FFSP line uses circuit flow (224.15 m³/h) as effective flow', () => {
        const line = (0, pumpSelections_1.buildPumpLineItem)(circuit, null, pumpSelections_1.PUMP_ROLE_PRIMARY);
        (0, vitest_1.expect)(line.effective_flow_m3h).toBe(224.15);
        (0, vitest_1.expect)(line.flow_m3h).toBe(224.15);
        (0, vitest_1.expect)(line.pump_role).toBe(pumpSelections_1.PUMP_ROLE_PRIMARY);
        (0, vitest_1.expect)(line.pump_role_name).toBe('FFSP — Foam Fractionator Supply Pump');
        (0, vitest_1.expect)(line.is_foam_fractionator).toBe(true);
    });
    (0, vitest_1.it)('FFSP unsaved line has status incomplete (no pump selected)', () => {
        const line = (0, pumpSelections_1.buildPumpLineItem)(circuit, null, pumpSelections_1.PUMP_ROLE_PRIMARY);
        (0, vitest_1.expect)(line.status).toBe('incomplete');
        (0, vitest_1.expect)(line.freshness).toBe('unsaved');
    });
    (0, vitest_1.it)('FFVP line uses venturi_flow_m3h, not circuit flow', () => {
        const row = { venturi_flow_m3h: '42.5', pump_role: pumpSelections_1.PUMP_ROLE_VENTURI };
        const line = (0, pumpSelections_1.buildPumpLineItem)(circuit, row, pumpSelections_1.PUMP_ROLE_VENTURI);
        (0, vitest_1.expect)(line.effective_flow_m3h).toBe(42.5);
        // circuit flow is unchanged on the line
        (0, vitest_1.expect)(line.flow_m3h).toBe(224.15);
        (0, vitest_1.expect)(line.pump_role).toBe(pumpSelections_1.PUMP_ROLE_VENTURI);
        (0, vitest_1.expect)(line.pump_role_name).toBe('FFVP — Foam Fractionator Venturi Pump');
    });
    (0, vitest_1.it)('FFVP line with no venturi flow is blocked with a clear reason', () => {
        const row = { pump_role: pumpSelections_1.PUMP_ROLE_VENTURI, venturi_flow_m3h: null };
        const line = (0, pumpSelections_1.buildPumpLineItem)(circuit, row, pumpSelections_1.PUMP_ROLE_VENTURI);
        (0, vitest_1.expect)(line.effective_flow_m3h).toBeNull();
        (0, vitest_1.expect)(line.status).toBe('incomplete');
        (0, vitest_1.expect)(line.reasons.some(r => r.includes('Venturi duty flow is required'))).toBe(true);
        // Must not silently use the 224.15 m³/h circuit flow
        (0, vitest_1.expect)(line.results.hydraulic_power_kw).toBeNull();
    });
    (0, vitest_1.it)('FFVP line with null row is blocked (unsaved, no venturi flow known)', () => {
        const line = (0, pumpSelections_1.buildPumpLineItem)(circuit, null, pumpSelections_1.PUMP_ROLE_VENTURI);
        (0, vitest_1.expect)(line.effective_flow_m3h).toBeNull();
        (0, vitest_1.expect)(line.status).toBe('incomplete');
        (0, vitest_1.expect)(line.reasons.some(r => r.includes('Venturi duty flow is required'))).toBe(true);
    });
    (0, vitest_1.it)('FFVP fingerprint changes when venturi flow changes', () => {
        const row1 = { venturi_flow_m3h: '42.5', pump_role: pumpSelections_1.PUMP_ROLE_VENTURI, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 };
        const row2 = { venturi_flow_m3h: '50', pump_role: pumpSelections_1.PUMP_ROLE_VENTURI, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 };
        const l1 = (0, pumpSelections_1.buildPumpLineItem)(circuit, row1, pumpSelections_1.PUMP_ROLE_VENTURI);
        const l2 = (0, pumpSelections_1.buildPumpLineItem)(circuit, row2, pumpSelections_1.PUMP_ROLE_VENTURI);
        (0, vitest_1.expect)(l1.current_source_fingerprint).not.toBe(l2.current_source_fingerprint);
    });
    (0, vitest_1.it)('FFSP and FFVP fingerprints differ on the same circuit', () => {
        const row = { venturi_flow_m3h: null, design_head_m: 10, pump_efficiency_pct: 80, motor_efficiency_pct: 90 };
        const ffsp = (0, pumpSelections_1.buildPumpLineItem)(circuit, row, pumpSelections_1.PUMP_ROLE_PRIMARY);
        const ffvp = (0, pumpSelections_1.buildPumpLineItem)(circuit, row, pumpSelections_1.PUMP_ROLE_VENTURI);
        (0, vitest_1.expect)(ffsp.current_source_fingerprint).not.toBe(ffvp.current_source_fingerprint);
    });
});
(0, vitest_1.describe)('pumpLinesForCircuit', () => {
    const ffCircuit = {
        circuit_key: 'loop:1', circuit_kind: 'loop', circuit_name: 'Loop 1',
        circuit_type: pumpSelections_1.FOAM_FRACTIONATION_CIRCUIT_TYPE, parent_loop_number: 1,
        side_stream_id: null, flow_m3h: 224.15,
    };
    const sandCircuit = {
        circuit_key: 'loop:2', circuit_kind: 'loop', circuit_name: 'Sand Filter Loop',
        circuit_type: 'Sand Filter', parent_loop_number: 2, side_stream_id: null, flow_m3h: 100,
    };
    (0, vitest_1.it)('non-FF circuit always returns exactly one line (primary)', () => {
        const lines = (0, pumpSelections_1.pumpLinesForCircuit)(sandCircuit, []);
        (0, vitest_1.expect)(lines).toHaveLength(1);
        (0, vitest_1.expect)(lines[0].pump_role).toBe(pumpSelections_1.PUMP_ROLE_PRIMARY);
    });
    (0, vitest_1.it)('non-FF circuit with a saved row returns one line', () => {
        const saved = [{ circuit_key: 'loop:2', pump_role: pumpSelections_1.PUMP_ROLE_PRIMARY, design_head_m: '15' }];
        const lines = (0, pumpSelections_1.pumpLinesForCircuit)(sandCircuit, saved);
        (0, vitest_1.expect)(lines).toHaveLength(1);
        (0, vitest_1.expect)(lines[0].design_head_m).toBe(15);
    });
    (0, vitest_1.it)('FF circuit with no saved rows returns one FFSP line', () => {
        const lines = (0, pumpSelections_1.pumpLinesForCircuit)(ffCircuit, []);
        (0, vitest_1.expect)(lines).toHaveLength(1);
        (0, vitest_1.expect)(lines[0].pump_role).toBe(pumpSelections_1.PUMP_ROLE_PRIMARY);
        (0, vitest_1.expect)(lines[0].pump_role_name).toBe('FFSP — Foam Fractionator Supply Pump');
    });
    (0, vitest_1.it)('FF circuit with only primary row returns one FFSP line', () => {
        const saved = [{ circuit_key: 'loop:1', pump_role: pumpSelections_1.PUMP_ROLE_PRIMARY, design_head_m: '10' }];
        const lines = (0, pumpSelections_1.pumpLinesForCircuit)(ffCircuit, saved);
        (0, vitest_1.expect)(lines).toHaveLength(1);
        (0, vitest_1.expect)(lines[0].pump_role).toBe(pumpSelections_1.PUMP_ROLE_PRIMARY);
    });
    (0, vitest_1.it)('FF circuit with both primary and venturi rows returns two lines in order', () => {
        const saved = [
            { circuit_key: 'loop:1', pump_role: pumpSelections_1.PUMP_ROLE_PRIMARY, design_head_m: '10' },
            { circuit_key: 'loop:1', pump_role: pumpSelections_1.PUMP_ROLE_VENTURI, venturi_flow_m3h: '42.5', design_head_m: '8' },
        ];
        const lines = (0, pumpSelections_1.pumpLinesForCircuit)(ffCircuit, saved);
        (0, vitest_1.expect)(lines).toHaveLength(2);
        (0, vitest_1.expect)(lines[0].pump_role).toBe(pumpSelections_1.PUMP_ROLE_PRIMARY);
        (0, vitest_1.expect)(lines[1].pump_role).toBe(pumpSelections_1.PUMP_ROLE_VENTURI);
    });
    (0, vitest_1.it)('FF circuit with only venturi row does NOT return an orphaned venturi without FFSP', () => {
        // A venturi without a primary saved row should still produce FFSP (unsaved) + FFVP.
        const saved = [{ circuit_key: 'loop:1', pump_role: pumpSelections_1.PUMP_ROLE_VENTURI, venturi_flow_m3h: '42.5' }];
        const lines = (0, pumpSelections_1.pumpLinesForCircuit)(ffCircuit, saved);
        (0, vitest_1.expect)(lines).toHaveLength(2);
        (0, vitest_1.expect)(lines[0].pump_role).toBe(pumpSelections_1.PUMP_ROLE_PRIMARY);
        (0, vitest_1.expect)(lines[0].freshness).toBe('unsaved');
        (0, vitest_1.expect)(lines[1].pump_role).toBe(pumpSelections_1.PUMP_ROLE_VENTURI);
    });
    (0, vitest_1.it)('ignores saved rows from other circuits', () => {
        const saved = [
            { circuit_key: 'loop:2', pump_role: pumpSelections_1.PUMP_ROLE_PRIMARY, design_head_m: '5' },
        ];
        const lines = (0, pumpSelections_1.pumpLinesForCircuit)(ffCircuit, saved);
        (0, vitest_1.expect)(lines).toHaveLength(1);
        (0, vitest_1.expect)(lines[0].freshness).toBe('unsaved');
    });
});
