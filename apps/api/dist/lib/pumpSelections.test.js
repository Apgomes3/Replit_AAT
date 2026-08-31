"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pumpSelections_1 = require("./pumpSelections");
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
