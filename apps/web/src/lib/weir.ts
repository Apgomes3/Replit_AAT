/**
 * Francis sharp-crested rectangular weir sizing.
 *
 * This is intentionally limited to the design-book approved case.  It is not
 * a general-purpose weir calculator.
 */

export const FRANCIS_COEFFICIENT = 1.84;
export const FRANCIS_MIN_HEAD_M = 0.05;
export const FRANCIS_MAX_HEAD_M = 0.6;
export const FRANCIS_MAX_HEAD_TO_LENGTH_RATIO = 0.5;

export type FrancisGeometry = 'sharp_rectangular';
export type FrancisDischargeCondition = 'free' | 'submerged';

export interface FrancisWeirInputs {
  flowM3h: number;
  headM: number;
  geometry: FrancisGeometry | string | null;
  endContractions: number | null;
  dischargeCondition: FrancisDischargeCondition | string | null;
  downstreamHeadM: number | null;
}

export interface FrancisWeirResult {
  status: 'valid' | 'invalid';
  lengthM: number | null;
  effectiveLengthM: number | null;
  flowM3s: number | null;
  headToLengthRatio: number | null;
  reasons: string[];
}

export function calculateFrancisWeir(inputs: FrancisWeirInputs): FrancisWeirResult {
  const reasons: string[] = [];
  const {
    flowM3h,
    headM,
    geometry,
    endContractions,
    dischargeCondition,
    downstreamHeadM,
  } = inputs;

  if (!Number.isFinite(flowM3h) || flowM3h <= 0) {
    reasons.push('A positive surface skim flow is required.');
  }
  if (!Number.isFinite(headM) || headM <= 0) {
    reasons.push('Head over the weir must be positive.');
  } else {
    if (headM < FRANCIS_MIN_HEAD_M) {
      reasons.push(`Head must be at least ${FRANCIS_MIN_HEAD_M * 1000} mm for the approved Francis range.`);
    }
    if (headM > FRANCIS_MAX_HEAD_M) {
      reasons.push(`Head must not exceed ${FRANCIS_MAX_HEAD_M * 1000} mm for the approved Francis range.`);
    }
  }
  if (geometry !== 'sharp_rectangular') {
    reasons.push('Only a sharp-crested rectangular weir is supported.');
  }
  if (!Number.isInteger(endContractions) || endContractions! < 0 || endContractions! > 2) {
    reasons.push('End contractions must be explicitly set to 0, 1, or 2.');
  }
  if (dischargeCondition !== 'free') {
    reasons.push('The Francis sizing is only approved for free discharge.');
  }
  if (downstreamHeadM == null || !Number.isFinite(downstreamHeadM)) {
    reasons.push('Downstream water level relative to the crest must be confirmed.');
  } else if (downstreamHeadM < 0) {
    reasons.push('Downstream head relative to the crest cannot be negative.');
  } else if (downstreamHeadM > 0) {
    reasons.push('Downstream water is above the crest; submerged discharge is not supported.');
  }

  if (reasons.length > 0) {
    return {
      status: 'invalid',
      lengthM: null,
      effectiveLengthM: null,
      flowM3s: Number.isFinite(flowM3h) && flowM3h > 0 ? flowM3h / 3600 : null,
      headToLengthRatio: null,
      reasons,
    };
  }

  const flowM3s = flowM3h / 3600;
  const effectiveLengthM = flowM3s / (FRANCIS_COEFFICIENT * Math.pow(headM, 1.5));
  const lengthM = effectiveLengthM + 0.1 * endContractions! * headM;
  const headToLengthRatio = headM / lengthM;

  if (headToLengthRatio > FRANCIS_MAX_HEAD_TO_LENGTH_RATIO) {
    reasons.push(
      `Head-to-crest-length ratio H/L must be at most ${FRANCIS_MAX_HEAD_TO_LENGTH_RATIO.toFixed(2)} (calculated ${headToLengthRatio.toFixed(2)}).`,
    );
  }

  return {
    status: reasons.length === 0 ? 'valid' : 'invalid',
    lengthM: reasons.length === 0 ? lengthM : null,
    effectiveLengthM: reasons.length === 0 ? effectiveLengthM : null,
    flowM3s,
    headToLengthRatio,
    reasons,
  };
}