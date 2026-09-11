"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ozoneCalculations_1 = require("./ozoneCalculations");
(0, vitest_1.describe)('ozone requirement', () => {
    const lines = [
        { circuit_key: 'ff:1', pump_duty_tag: 'FFSP', pump_role: 'primary', flow_m3h: 100 },
        { circuit_key: 'ff:1', pump_duty_tag: 'FFVP', pump_role: 'venturi', venturi_flow_m3h: 25 },
    ];
    (0, vitest_1.it)('uses FFSP flow only by default', () => {
        (0, vitest_1.expect)((0, ozoneCalculations_1.calculateOzoneRequirement)({
            target_concentration_mg_l: 0.05,
            pump_lines: lines,
        })).toMatchObject({
            status: 'ready',
            ffsp_flow_m3h: 100,
            applicable_ffvp_flow_m3h: 0,
            total_treatment_flow_m3h: 100,
            ozone_required_mg_h: 5000,
        });
    });
    (0, vitest_1.it)('adds FFVP flow only when that circuit draws directly from the plenum', () => {
        (0, vitest_1.expect)((0, ozoneCalculations_1.calculateOzoneRequirement)({
            target_concentration_mg_l: 0.05,
            pump_lines: lines,
            ffvp_plenum_circuit_keys: ['ff:1'],
        })).toMatchObject({
            total_treatment_flow_m3h: 125,
            ozone_required_mg_h: 6250,
        });
    });
    (0, vitest_1.it)('converts display units without changing the mg/h basis', () => {
        (0, vitest_1.expect)((0, ozoneCalculations_1.convertOzoneRate)(6250, 'g/h')).toBe(6.25);
        (0, vitest_1.expect)((0, ozoneCalculations_1.convertOzoneRate)(453592.37, 'lb/h')).toBeCloseTo(1);
    });
});
(0, vitest_1.describe)('ozone generator selection', () => {
    const products = [
        { id: '7', product_code: 'OZ-07', product_name: 'Ozone 7', ozone_production_capacity_g_h: 7 },
        { id: '11', product_code: 'OZ-11', product_name: 'Ozone 11', ozone_production_capacity_g_h: 11 },
        { id: '20', product_code: 'OZ-20', product_name: 'Ozone 20', ozone_production_capacity_g_h: 20 },
    ];
    (0, vitest_1.it)('prefers the closest installed capacity above demand, then fewer units', () => {
        (0, vitest_1.expect)((0, ozoneCalculations_1.selectOzoneGenerator)(20, products)).toMatchObject({
            product_id: '20', quantity: 1, total_installed_capacity_g_h: 20, validation_status: 'PASS',
        });
        (0, vitest_1.expect)((0, ozoneCalculations_1.selectOzoneGenerator)(18, products.filter(product => product.id === '7'))).toMatchObject({
            quantity: 3, total_installed_capacity_g_h: 21, validation_status: 'PASS',
        });
    });
    (0, vitest_1.it)('allows an oversized selection with an advisory and fails without capacity', () => {
        (0, vitest_1.expect)((0, ozoneCalculations_1.selectOzoneGenerator)(11, products.filter(product => product.id === '20'))).toMatchObject({
            validation_status: 'PASS',
            oversize_percent: vitest_1.expect.any(Number),
            advisory_note: vitest_1.expect.stringContaining('more capacity than the calculated requirement'),
        });
        (0, vitest_1.expect)((0, ozoneCalculations_1.selectOzoneGenerator)(11, [])).toMatchObject({ validation_status: 'FAIL' });
    });
    (0, vitest_1.it)('chooses a closer multi-unit configuration over a larger single unit', () => {
        (0, vitest_1.expect)((0, ozoneCalculations_1.selectOzoneGenerator)(12, [
            { id: '7', product_code: 'OZ-07', product_name: 'Ozone 7', ozone_production_capacity_g_h: 7 },
            { id: '20', product_code: 'OZ-20', product_name: 'Ozone 20', ozone_production_capacity_g_h: 20 },
        ])).toMatchObject({
            product_id: '7', quantity: 2, total_installed_capacity_g_h: 14, validation_status: 'PASS',
        });
    });
});
