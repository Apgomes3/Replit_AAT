import { describe, expect, it } from 'vitest';
import { calculateWaterSurfaceAreaM2 } from './tankCalculations';

describe('calculateWaterSurfaceAreaM2', () => {
  it('calculates a rectangular water-surface footprint', () => {
    expect(calculateWaterSurfaceAreaM2('Rectangular', 5000, 3000)).toBe(15);
  });

  it('calculates a cylindrical water-surface footprint from diameter', () => {
    expect(calculateWaterSurfaceAreaM2('Cylindrical', null, 2000)).toBe(3.1416);
  });

  it('does not infer a custom-shape surface area', () => {
    expect(calculateWaterSurfaceAreaM2('Custom', 5000, 3000)).toBeNull();
  });
});