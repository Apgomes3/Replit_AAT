"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const customFootprint_1 = require("./customFootprint");
const point = (x, y) => ({ x, y });
const line = (start, end) => ({ type: 'line', start, end });
const document = (segments, closed = true) => ({
    schema_version: 1,
    units: 'mm',
    calibration: { model_unit: 'mm', mm_per_unit: 1 },
    closed,
    sampling: { quadratic_steps: 24, freehand_step_mm: 25 },
    segments,
});
(0, vitest_1.describe)('Custom tank footprint geometry', () => {
    (0, vitest_1.it)('measures line footprints in canonical millimetres regardless of orientation', () => {
        const clockwise = document([
            line(point(0, 0), point(2000, 0)),
            line(point(2000, 0), point(2000, 1000)),
            line(point(2000, 1000), point(0, 1000)),
            line(point(0, 1000), point(0, 0)),
        ]);
        const counterClockwise = document([
            line(point(0, 0), point(0, 1000)),
            line(point(0, 1000), point(2000, 1000)),
            line(point(2000, 1000), point(2000, 0)),
            line(point(2000, 0), point(0, 0)),
        ]);
        (0, vitest_1.expect)((0, customFootprint_1.summarizeCustomFootprint)(clockwise)).toMatchObject({
            valid: true,
            area_m2: 2,
            perimeter_mm: 6000,
            approximate: false,
        });
        (0, vitest_1.expect)((0, customFootprint_1.summarizeCustomFootprint)(counterClockwise).area_m2).toBe(2);
    });
    (0, vitest_1.it)('deterministically samples quadratic and freehand segments', () => {
        const curved = document([
            { type: 'quadratic', start: point(0, 0), control: point(500, -500), end: point(1000, 0) },
            { type: 'freehand', points: [point(1000, 0), point(1000, 500), point(1000, 1000)] },
            line(point(1000, 1000), point(0, 1000)),
            line(point(0, 1000), point(0, 0)),
        ]);
        const summary = (0, customFootprint_1.summarizeCustomFootprint)(curved);
        (0, vitest_1.expect)(summary.valid).toBe(true);
        (0, vitest_1.expect)(summary.approximate).toBe(true);
        (0, vitest_1.expect)(summary.segment_count).toBe(4);
        (0, vitest_1.expect)(summary.area_m2).toBeGreaterThan(1);
        (0, vitest_1.expect)(summary.perimeter_mm).toBeGreaterThan(4000);
        (0, vitest_1.expect)((0, customFootprint_1.summarizeCustomFootprint)(curved)).toEqual(summary);
    });
    (0, vitest_1.it)('normalizes calibration, schema, and sampling without persisting viewport state', () => {
        const normalized = (0, customFootprint_1.normalizeCustomFootprint)({
            ...document([
                line(point(0, 0), point(1000, 0)),
                line(point(1000, 0), point(0, 1000)),
                line(point(0, 1000), point(0, 0)),
            ]),
            schema_version: 99,
            units: 'in',
            calibration: { pixels_per_mm: 4 },
            viewport: { width: 800, height: 600 },
            sampling: { quadratic_steps: 1000, freehand_step_mm: 0 },
        });
        (0, vitest_1.expect)(normalized).toMatchObject({
            schema_version: 1,
            units: 'mm',
            calibration: { model_unit: 'mm', mm_per_unit: 1 },
            sampling: { quadratic_steps: 64, freehand_step_mm: 25 },
        });
        (0, vitest_1.expect)(normalized).not.toHaveProperty('viewport');
    });
    vitest_1.it.each([
        ['OPEN', document([
                line(point(0, 0), point(1000, 0)),
                line(point(1000, 0), point(1000, 1000)),
                line(point(1000, 1000), point(0, 1000)),
            ], false)],
        ['TOO_SMALL', document([
                line(point(0, 0), point(1000, 0)),
                line(point(1000, 0), point(0, 0)),
            ])],
        ['ZERO_LENGTH', document([
                line(point(0, 0), point(1000, 0)),
                line(point(1000, 0), point(1000, 0)),
                line(point(1000, 0), point(0, 1000)),
                line(point(0, 1000), point(0, 0)),
            ])],
        ['DEGENERATE', document([
                line(point(0, 0), point(1000, 0)),
                line(point(1000, 0), point(2000, 0)),
                line(point(2000, 0), point(0, 0)),
            ])],
        ['SELF_INTERSECTING', document([
                line(point(0, 0), point(1000, 1000)),
                line(point(1000, 1000), point(0, 1000)),
                line(point(0, 1000), point(1000, 0)),
                line(point(1000, 0), point(0, 0)),
            ])],
    ])('identifies %s outlines', (code, value) => {
        (0, vitest_1.expect)((0, customFootprint_1.validateCustomFootprint)(value)).toMatchObject({ valid: false, code });
    });
    (0, vitest_1.it)('rejects disconnected geometry', () => {
        (0, vitest_1.expect)((0, customFootprint_1.validateCustomFootprint)(document([
            line(point(0, 0), point(1000, 0)),
            line(point(900, 0), point(1000, 1000)),
            line(point(1000, 1000), point(0, 0)),
        ]))).toMatchObject({ valid: false, code: 'DISCONNECTED' });
    });
    (0, vitest_1.it)('rejects oversized and out-of-range geometry before sampling', () => {
        const tooManySegments = Array.from({ length: customFootprint_1.MAX_FOOTPRINT_SEGMENTS + 1 }, (_, index) => line(point(index, 0), point(index + 1, 0)));
        (0, vitest_1.expect)(() => (0, customFootprint_1.normalizeCustomFootprint)(document(tooManySegments))).toThrow(/at most/);
        (0, vitest_1.expect)((0, customFootprint_1.validateCustomFootprint)(document([
            line(point(0, 0), point(20000000, 0)),
            line(point(20000000, 0), point(0, 1000)),
            line(point(0, 1000), point(0, 0)),
        ]))).toMatchObject({ valid: false, code: 'INVALID_DOCUMENT' });
        (0, vitest_1.expect)(() => (0, customFootprint_1.normalizeCustomFootprint)(document([{
                type: 'freehand',
                points: Array(customFootprint_1.MAX_FOOTPRINT_SOURCE_POINTS + 1).fill({ x: 0, y: 0 }),
            }]))).toThrow(/source points/);
    });
});
