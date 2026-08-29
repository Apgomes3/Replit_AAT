import { describe, expect, it } from 'vitest';
import {
  MAX_FOOTPRINT_SEGMENTS,
  MAX_FOOTPRINT_SOURCE_POINTS,
  normalizeCustomFootprint,
  summarizeCustomFootprint,
  validateCustomFootprint,
} from './customFootprint';

const point = (x: number, y: number) => ({ x, y });
const line = (start: ReturnType<typeof point>, end: ReturnType<typeof point>) => ({ type: 'line' as const, start, end });
const document = (segments: any[], closed = true) => ({
  schema_version: 1,
  units: 'mm',
  calibration: { model_unit: 'mm', mm_per_unit: 1 },
  closed,
  sampling: { quadratic_steps: 24, freehand_step_mm: 25 },
  segments,
});

describe('Custom tank footprint geometry', () => {
  it('measures line footprints in canonical millimetres regardless of orientation', () => {
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
    expect(summarizeCustomFootprint(clockwise)).toMatchObject({
      valid: true,
      area_m2: 2,
      perimeter_mm: 6000,
      approximate: false,
    });
    expect(summarizeCustomFootprint(counterClockwise).area_m2).toBe(2);
  });

  it('deterministically samples quadratic and freehand segments', () => {
    const curved = document([
      { type: 'quadratic', start: point(0, 0), control: point(500, -500), end: point(1000, 0) },
      { type: 'freehand', points: [point(1000, 0), point(1000, 500), point(1000, 1000)] },
      line(point(1000, 1000), point(0, 1000)),
      line(point(0, 1000), point(0, 0)),
    ]);
    const summary = summarizeCustomFootprint(curved);
    expect(summary.valid).toBe(true);
    expect(summary.approximate).toBe(true);
    expect(summary.segment_count).toBe(4);
    expect(summary.area_m2).toBeGreaterThan(1);
    expect(summary.perimeter_mm).toBeGreaterThan(4000);
    expect(summarizeCustomFootprint(curved)).toEqual(summary);
  });

  it('normalizes calibration, schema, and sampling without persisting viewport state', () => {
    const normalized = normalizeCustomFootprint({
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
    expect(normalized).toMatchObject({
      schema_version: 1,
      units: 'mm',
      calibration: { model_unit: 'mm', mm_per_unit: 1 },
      sampling: { quadratic_steps: 64, freehand_step_mm: 25 },
    });
    expect(normalized).not.toHaveProperty('viewport');
  });

  it.each([
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
    expect(validateCustomFootprint(value)).toMatchObject({ valid: false, code });
  });

  it('rejects disconnected geometry', () => {
    expect(validateCustomFootprint(document([
      line(point(0, 0), point(1000, 0)),
      line(point(900, 0), point(1000, 1000)),
      line(point(1000, 1000), point(0, 0)),
    ]))).toMatchObject({ valid: false, code: 'DISCONNECTED' });
  });

  it('rejects oversized and out-of-range geometry before sampling', () => {
    const tooManySegments = Array.from({ length: MAX_FOOTPRINT_SEGMENTS + 1 }, (_, index) =>
      line(point(index, 0), point(index + 1, 0)));
    expect(() => normalizeCustomFootprint(document(tooManySegments))).toThrow(/at most/);
    expect(validateCustomFootprint(document([
      line(point(0, 0), point(20_000_000, 0)),
      line(point(20_000_000, 0), point(0, 1000)),
      line(point(0, 1000), point(0, 0)),
    ]))).toMatchObject({ valid: false, code: 'INVALID_DOCUMENT' });
    expect(() => normalizeCustomFootprint(document([{
      type: 'freehand',
      points: Array(MAX_FOOTPRINT_SOURCE_POINTS + 1).fill({ x: 0, y: 0 }),
    }]))).toThrow(/source points/);
  });
});