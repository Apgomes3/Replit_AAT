import { describe, expect, it } from 'vitest';
import { nextPipeSize, pipeVelocity, recommendPipeSize } from './pipeSizing';

const standards = [
  { dn: 25, internal_diameter_mm: 25, is_active: true },
  { dn: 32, internal_diameter_mm: 32, is_active: true },
  { dn: 40, internal_diameter_mm: 40, is_active: true },
  { dn: 50, internal_diameter_mm: 50, is_active: true },
];

describe('pipe sizing', () => {
  it('calculates velocity from flow and authoritative internal diameter', () => {
    expect(pipeVelocity(10, 50)).toBeCloseTo(1.4147, 4);
    expect(pipeVelocity(10, 0)).toBeNull();
  });

  it('recommends the smallest active DN inside the velocity band', () => {
    const result = recommendPipeSize(10, standards, 1.5, 3);

    expect(result.standard?.dn).toBe(40);
    expect(result.velocity_m_s).toBeCloseTo(2.2105, 4);
    expect(result.within_band).toBe(true);
  });

  it('moves exactly one active standard above the selected DN', () => {
    expect(nextPipeSize(40, standards)?.dn).toBe(50);
    expect(nextPipeSize(50, standards)).toBeNull();
  });
});