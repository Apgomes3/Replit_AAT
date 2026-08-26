import { describe, expect, it } from 'vitest';
import {
  calculateFrancisWeir,
  FRANCIS_MAX_HEAD_M,
  FRANCIS_MIN_HEAD_M,
} from './weir';

const validInputs = {
  flowM3h: 100,
  headM: 0.1,
  geometry: 'sharp_rectangular',
  endContractions: 0,
  dischargeCondition: 'free',
  downstreamHeadM: 0,
};

describe('Francis weir sizing', () => {
  it('matches a worked suppressed-weir example', () => {
    const result = calculateFrancisWeir(validInputs);

    expect(result.status).toBe('valid');
    expect(result.lengthM).toBeCloseTo(0.477397, 6);
    expect(result.effectiveLengthM).toBeCloseTo(0.477397, 6);
    expect(result.flowM3s).toBeCloseTo(100 / 3600, 10);
  });

  it('adds the Francis end-contraction correction', () => {
    const suppressed = calculateFrancisWeir(validInputs);
    const contracted = calculateFrancisWeir({ ...validInputs, endContractions: 2 });

    expect(contracted.status).toBe('valid');
    expect(contracted.lengthM! - suppressed.lengthM!).toBeCloseTo(0.02, 10);
  });

  it('accepts the approved head boundaries', () => {
    const lowBoundary = calculateFrancisWeir({
      ...validInputs,
      flowM3h: 50,
      headM: FRANCIS_MIN_HEAD_M,
    });
    const highBoundary = calculateFrancisWeir({
      ...validInputs,
      flowM3h: 5000,
      headM: FRANCIS_MAX_HEAD_M,
    });

    expect(lowBoundary.status).toBe('valid');
    expect(highBoundary.status).toBe('valid');
  });

  it('rejects heads outside the approved operating range', () => {
    const tooLow = calculateFrancisWeir({ ...validInputs, headM: FRANCIS_MIN_HEAD_M - 0.001 });
    const tooHigh = calculateFrancisWeir({
      ...validInputs,
      flowM3h: 1000,
      headM: FRANCIS_MAX_HEAD_M + 0.001,
    });

    expect(tooLow.status).toBe('invalid');
    expect(tooLow.reasons.join(' ')).toContain('at least');
    expect(tooHigh.status).toBe('invalid');
    expect(tooHigh.reasons.join(' ')).toContain('must not exceed');
  });

  it('rejects a high head-to-crest-length ratio', () => {
    const result = calculateFrancisWeir({ ...validInputs, flowM3h: 1 });

    expect(result.status).toBe('invalid');
    expect(result.lengthM).toBeNull();
    expect(result.headToLengthRatio).toBeGreaterThan(0.5);
    expect(result.reasons.join(' ')).toContain('Head-to-crest-length ratio');
  });

  it.each([
    [{ geometry: 'broad_rectangular' }, 'sharp-crested rectangular'],
    [{ dischargeCondition: 'submerged' }, 'free discharge'],
    [{ downstreamHeadM: 0.001 }, 'submerged discharge'],
    [{ downstreamHeadM: null }, 'must be confirmed'],
    [{ endContractions: 3 }, '0, 1, or 2'],
  ])('rejects unsupported geometry or operating condition %o', (override, reason) => {
    const result = calculateFrancisWeir({ ...validInputs, ...override });

    expect(result.status).toBe('invalid');
    expect(result.lengthM).toBeNull();
    expect(result.reasons.join(' ')).toContain(reason);
  });
});