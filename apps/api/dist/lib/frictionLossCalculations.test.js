"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const frictionLossCalculations_1 = require("./frictionLossCalculations");
const pump = { id: 'pump-1', project_equipment_item_id: 'pump-1', equip_code: 'P-101' };
const pipe = {
    project_piping_item_id: 'pipe-1',
    piping_snapshot: { piping_code: 'PIPE-1' },
    component_kind: 'pipe',
    internal_diameter_mm: 100,
    straight_length_m: 10,
    material: 'PVC-U',
    absolute_roughness_mm: 0.0015,
};
const fitting = {
    project_piping_item_id: 'fit-1',
    piping_snapshot: { piping_code: 'FIT-1' },
    component_kind: 'fitting',
    internal_diameter_mm: 100,
    fitting_k_value: 0.9,
    quantity: 2,
};
(0, vitest_1.describe)('calculateFrictionLoss', () => {
    (0, vitest_1.it)('calculates separate Darcy-Weisbach and K-value side totals', () => {
        const result = (0, frictionLossCalculations_1.calculateFrictionLoss)({
            flow_m3h: 36,
            selected_pump: pump,
            components: [
                { ...pipe, side: 'suction' },
                { ...fitting, side: 'discharge' },
            ],
            calculated_at: '2026-08-31T00:00:00.000Z',
        });
        (0, vitest_1.expect)(result.status).toBe('ready');
        (0, vitest_1.expect)(result.calculation_version).toBe(frictionLossCalculations_1.FRICTION_LOSS_CALCULATION_VERSION);
        (0, vitest_1.expect)(result.components[0].velocity_m_s).toBeCloseTo(1.27324, 4);
        (0, vitest_1.expect)(result.components[0].reynolds_number).toBeGreaterThan(100000);
        (0, vitest_1.expect)(result.side_totals.suction.major_head_loss_m).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.side_totals.discharge.minor_head_loss_m).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.results.combined_head_loss_m).toBeCloseTo(result.side_totals.suction.total_head_loss_m + result.side_totals.discharge.total_head_loss_m, 5);
        (0, vitest_1.expect)(result.results.combined_pressure_drop_kpa).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('returns specific readiness reasons instead of zero defaults', () => {
        const result = (0, frictionLossCalculations_1.calculateFrictionLoss)({
            flow_m3h: null,
            components: [
                { ...pipe, side: 'suction', internal_diameter_mm: null, material: '', straight_length_m: null, absolute_roughness_mm: null },
            ],
        });
        (0, vitest_1.expect)(result.status).toBe('incomplete');
        (0, vitest_1.expect)(result.reasons).toContain('Circuit flow is missing or must be greater than zero.');
        (0, vitest_1.expect)(result.reasons).toContain('Select a pump assigned to this LSS system.');
        (0, vitest_1.expect)(result.reasons).toContain('Add at least one discharge-side pipe or fitting.');
        (0, vitest_1.expect)(result.reasons.some(reason => reason.includes('internal diameter'))).toBe(true);
        (0, vitest_1.expect)(result.reasons.some(reason => reason.includes('pipe material'))).toBe(true);
        (0, vitest_1.expect)(result.results.combined_head_loss_m).toBeNull();
    });
    (0, vitest_1.it)('keeps fitting quantity and K-value explicit', () => {
        const result = (0, frictionLossCalculations_1.calculateFrictionLoss)({
            flow_m3h: 10,
            selected_pump: pump,
            components: [
                { ...fitting, side: 'suction', quantity: 0 },
                { ...fitting, side: 'discharge', fitting_k_value: null },
            ],
        });
        (0, vitest_1.expect)(result.status).toBe('incomplete');
        (0, vitest_1.expect)(result.reasons.some(reason => reason.includes('quantity must be greater than zero'))).toBe(true);
        (0, vitest_1.expect)(result.reasons.some(reason => reason.includes('K-value must be zero or greater'))).toBe(true);
    });
});
