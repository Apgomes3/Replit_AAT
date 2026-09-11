"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pipeSizing_1 = require("./pipeSizing");
const standards = [
    { dn: 25, internal_diameter_mm: 25, is_active: true },
    { dn: 32, internal_diameter_mm: 32, is_active: true },
    { dn: 40, internal_diameter_mm: 40, is_active: true },
    { dn: 50, internal_diameter_mm: 50, is_active: true },
];
(0, vitest_1.describe)('pipe sizing', () => {
    (0, vitest_1.it)('calculates velocity from flow and authoritative internal diameter', () => {
        (0, vitest_1.expect)((0, pipeSizing_1.pipeVelocity)(10, 50)).toBeCloseTo(1.4147, 4);
        (0, vitest_1.expect)((0, pipeSizing_1.pipeVelocity)(10, 0)).toBeNull();
    });
    (0, vitest_1.it)('recommends the smallest active DN inside the velocity band', () => {
        const result = (0, pipeSizing_1.recommendPipeSize)(10, standards, 1.5, 3);
        (0, vitest_1.expect)(result.standard?.dn).toBe(40);
        (0, vitest_1.expect)(result.velocity_m_s).toBeCloseTo(2.2105, 4);
        (0, vitest_1.expect)(result.within_band).toBe(true);
    });
    (0, vitest_1.it)('moves exactly one active standard above the selected DN', () => {
        (0, vitest_1.expect)((0, pipeSizing_1.nextPipeSize)(40, standards)?.dn).toBe(50);
        (0, vitest_1.expect)((0, pipeSizing_1.nextPipeSize)(50, standards)).toBeNull();
    });
});
