"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const tankCalculations_1 = require("./tankCalculations");
(0, vitest_1.describe)('calculateWaterSurfaceAreaM2', () => {
    (0, vitest_1.it)('calculates a rectangular water-surface footprint', () => {
        (0, vitest_1.expect)((0, tankCalculations_1.calculateWaterSurfaceAreaM2)('Rectangular', 5000, 3000)).toBe(15);
    });
    (0, vitest_1.it)('calculates a cylindrical water-surface footprint from diameter', () => {
        (0, vitest_1.expect)((0, tankCalculations_1.calculateWaterSurfaceAreaM2)('Cylindrical', null, 2000)).toBe(3.1416);
    });
    (0, vitest_1.it)('calculates a custom tank footprint from confirmed outer dimensions', () => {
        (0, vitest_1.expect)((0, tankCalculations_1.calculateWaterSurfaceAreaM2)('Custom', 5000, 3000)).toBe(15);
    });
});
