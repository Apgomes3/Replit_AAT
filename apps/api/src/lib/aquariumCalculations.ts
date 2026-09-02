/**
 * Approved aquarium engineering calculation definitions.
 *
 * Keep the values returned by this module deliberately explicit.  The UI can
 * render the inputs, formula and rounding rules without having to recreate
 * any engineering logic of its own.
 */
import { resolveLoopFlows } from './flowRoute';

export const AQUARIUM_CALCULATION_VERSION = 'aquarium-hydraulics-v1';
export const TURNOVER_UNIT = 'cycles_per_hour';
export const FLOW_UNIT = 'm3_per_hour';
export const ALLOCATION_TOLERANCE_PCT = 0.01;
export const VOLUME_DECIMALS = 4;
export const FLOW_DECIMALS = 3;
export const FOAM_FRACTIONATOR_MATCH_TOLERANCE_PCT = 5;
export const SAND_FILTER_MATCH_TOLERANCE_PCT = 5;
export const AAT_TARGET_TIME_DECIMALS = 6;
export const AAT_TIME_MINUTES_DECIMALS = 2;
export const AAT_TURNOVER_DECIMALS = 3;

const AAT_SMALL_VOLUME_THRESHOLD_M3 = 1;
const AAT_LARGE_VOLUME_THRESHOLD_M3 = 100;
const AAT_SMALL_VOLUME_TIME_HOURS = 0.25;
const AAT_MID_VOLUME_TIME_COEFFICIENT = 0.2265939594;
const AAT_MID_VOLUME_TIME_EXPONENT = 0.3478773096;
const AAT_LARGE_VOLUME_TIME_COEFFICIENT = 0.8850796805;
const AAT_LARGE_VOLUME_TIME_EXPONENT = 0.04959964583;

export type CalculationStatus = 'valid' | 'warning' | 'invalid' | 'override';

const numberOrNull = (value: any): number | null => {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const positiveOrNull = (value: any): number | null => {
  const result = numberOrNull(value);
  return result != null && result > 0 ? result : null;
};

export const roundEngineering = (value: number | null, decimals: number): number | null =>
  value == null || !Number.isFinite(value) ? null : Number(value.toFixed(decimals));

/**
 * Calculates the AAT reference flow from net/effective exhibit operating
 * volume.  This is advisory only: it is deliberately independent of the
 * designer's saved target turnover rate.
 */
export function calculateAatRecommendedFlow(
  effectiveOperatingVolumeM3: unknown,
  calculatedAt = new Date().toISOString(),
) {
  const parsedVolume = positiveOrNull(effectiveOperatingVolumeM3);
  const roundedVolume = roundEngineering(parsedVolume, VOLUME_DECIMALS);
  const volume = roundedVolume != null && roundedVolume > 0 ? roundedVolume : null;
  const rule = {
    volume_unit: 'm3',
    turnover_time_unit: 'hours',
    turnover_rate_unit: TURNOVER_UNIT,
    flow_unit: FLOW_UNIT,
    below_volume_m3: AAT_SMALL_VOLUME_THRESHOLD_M3,
    below_volume_target_turnover_time_hours: AAT_SMALL_VOLUME_TIME_HOURS,
    first_power_curve: {
      minimum_volume_m3: AAT_SMALL_VOLUME_THRESHOLD_M3,
      maximum_volume_m3: AAT_LARGE_VOLUME_THRESHOLD_M3,
      maximum_is_exclusive: true,
      coefficient: AAT_MID_VOLUME_TIME_COEFFICIENT,
      exponent: AAT_MID_VOLUME_TIME_EXPONENT,
    },
    second_power_curve: {
      minimum_volume_m3: AAT_LARGE_VOLUME_THRESHOLD_M3,
      maximum_volume_m3: null,
      maximum_is_exclusive: false,
      coefficient: AAT_LARGE_VOLUME_TIME_COEFFICIENT,
      exponent: AAT_LARGE_VOLUME_TIME_EXPONENT,
    },
  };
  const base = {
    calculation_version: AQUARIUM_CALCULATION_VERSION,
    calculated_at: calculatedAt,
    freshness: 'fresh' as const,
    is_stale: false,
    inputs: {
      effective_operating_volume_m3: volume,
    },
    formula: 'target turnover time T = 0.25 h when V < 1 m³; T = 0.2265939594 × V^0.3478773096 h when 1 m³ ≤ V < 100 m³; T = 0.8850796805 × V^0.04959964583 h when V ≥ 100 m³; recommended flow = V ÷ T; recommended turnover = 1 ÷ T',
    rule,
    units: {
      volume: 'm³',
      turnover_time: 'hours',
      turnover_rate: TURNOVER_UNIT,
      flow: FLOW_UNIT,
    },
    rounding: `Effective operating volume is rounded to ${VOLUME_DECIMALS} decimals m³ before selecting and evaluating the AAT rule; turnover time is rounded to ${AAT_TARGET_TIME_DECIMALS} decimals hours and ${AAT_TIME_MINUTES_DECIMALS} decimals minutes; turnover rate and flow are rounded to ${AAT_TURNOVER_DECIMALS} and ${FLOW_DECIMALS} decimals respectively.`,
  };

  if (volume == null) {
    return {
      ...base,
      status: 'invalid' as CalculationStatus,
      reasons: ['AAT reference is unavailable because net/effective operating volume is missing or invalid.'],
      results: {
        target_turnover_time_hours: null,
        target_turnover_time_minutes: null,
        recommended_turnover_rate_cycles_per_hour: null,
        recommended_flow_m3h: null,
      },
    };
  }

  const targetTurnoverTimeHours = volume < AAT_SMALL_VOLUME_THRESHOLD_M3
    ? AAT_SMALL_VOLUME_TIME_HOURS
    : volume < AAT_LARGE_VOLUME_THRESHOLD_M3
      ? AAT_MID_VOLUME_TIME_COEFFICIENT * Math.pow(volume, AAT_MID_VOLUME_TIME_EXPONENT)
      : AAT_LARGE_VOLUME_TIME_COEFFICIENT * Math.pow(volume, AAT_LARGE_VOLUME_TIME_EXPONENT);
  const recommendedTurnoverRate = 1 / targetTurnoverTimeHours;
  const recommendedFlow = volume / targetTurnoverTimeHours;

  return {
    ...base,
    status: 'valid' as CalculationStatus,
    reasons: [],
    results: {
      target_turnover_time_hours: roundEngineering(targetTurnoverTimeHours, AAT_TARGET_TIME_DECIMALS),
      target_turnover_time_minutes: roundEngineering(targetTurnoverTimeHours * 60, AAT_TIME_MINUTES_DECIMALS),
      recommended_turnover_rate_cycles_per_hour: roundEngineering(recommendedTurnoverRate, AAT_TURNOVER_DECIMALS),
      recommended_flow_m3h: roundEngineering(recommendedFlow, FLOW_DECIMALS),
    },
  };
}

// Keep the acronym-readable spelling available to callers that use AAT as a
// proper initialism while preserving the project's existing camel-case style.
export const calculateAATRecommendedFlow = calculateAatRecommendedFlow;

export function calculateSideStreamFlow(
  systemFlowM3h: unknown,
  parentLoopPct: unknown,
  sideStreamPct: unknown,
): number | null {
  if (
    systemFlowM3h == null || systemFlowM3h === '' ||
    parentLoopPct == null || parentLoopPct === '' ||
    sideStreamPct == null || sideStreamPct === ''
  ) return null;
  const systemFlow = numberOrNull(systemFlowM3h);
  const parentPct = numberOrNull(parentLoopPct);
  const branchPct = numberOrNull(sideStreamPct);
  if (
    systemFlow == null || systemFlow < 0 ||
    parentPct == null || parentPct < 0 || parentPct > 100 ||
    branchPct == null || branchPct < 0 || branchPct > 100
  ) return null;
  return roundEngineering(systemFlow * parentPct / 100 * branchPct / 100, FLOW_DECIMALS);
}

export function calculateFoamFractionatorCapacity(
  parentLoopFlowM3h: unknown,
  processRateLsM2: unknown,
  products: any[],
) {
  const parentFlowM3h = parentLoopFlowM3h == null || parentLoopFlowM3h === ''
    ? null
    : numberOrNull(parentLoopFlowM3h);
  const processRate = positiveOrNull(processRateLsM2);
  const selectedProducts = Array.isArray(products) ? products.map(product => {
    const quantity = Number(product?.quantity);
    const diameterMm = positiveOrNull(product?.diameter_mm);
    const unitAreaM2 = diameterMm == null ? null : Math.PI * Math.pow(diameterMm / 2000, 2);
    return {
      product_master_id: product?.product_master_id || null,
      product_code: product?.product_code || null,
      product_name: product?.product_name || null,
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
      diameter_mm: diameterMm,
      unit_area_m2: roundEngineering(unitAreaM2, VOLUME_DECIMALS),
      total_area_m2: unitAreaM2 == null || !(quantity > 0)
        ? null
        : roundEngineering(unitAreaM2 * quantity, VOLUME_DECIMALS),
    };
  }) : [];
  const reasons: string[] = [];
  if (parentFlowM3h == null || parentFlowM3h < 0) reasons.push('Parent loop allocation is unavailable.');
  if (!selectedProducts.length) reasons.push('Select at least one Foam Fractionator.');
  if (selectedProducts.some(product => product.quantity <= 0)) reasons.push('Every selected fractionator requires a positive whole-number quantity.');
  if (selectedProducts.some(product => product.diameter_mm == null)) reasons.push('Every selected fractionator requires a valid saved diameter.');
  if (processRate == null) reasons.push('Enter an AAT process rate greater than zero.');
  const totalArea = !selectedProducts.length
    || reasons.some(reason => reason.includes('diameter') || reason.includes('quantity'))
    ? null
    : selectedProducts.reduce((sum, product) =>
        sum + Math.PI * Math.pow(Number(product.diameter_mm) / 2000, 2) * product.quantity, 0);
  const parentFlowLs = parentFlowM3h == null ? null : parentFlowM3h / 3.6;
  const capacityLs = totalArea == null || processRate == null ? null : totalArea * processRate;
  const actualLoading = totalArea == null || totalArea <= 0 || parentFlowLs == null
    ? null
    : parentFlowLs / totalArea;
  let matchStatus: 'incomplete' | 'matched' | 'required_above_capacity' | 'capacity_above_required' = 'incomplete';
  if (!reasons.length && capacityLs != null && parentFlowLs != null) {
    const tolerance = Math.max(capacityLs, parentFlowLs) * FOAM_FRACTIONATOR_MATCH_TOLERANCE_PCT / 100;
    matchStatus = Math.abs(capacityLs - parentFlowLs) <= tolerance
      ? 'matched'
      : parentFlowLs > capacityLs
        ? 'required_above_capacity'
        : 'capacity_above_required';
  }
  return {
    status: reasons.length ? 'invalid' as CalculationStatus : 'valid' as CalculationStatus,
    match_status: matchStatus,
    reasons,
    advisory: processRate != null && (processRate < 18 || processRate > 22)
      ? 'Selected process rate is outside the recommended AAT range of 18–22 L/s/m².'
      : null,
    inputs: {
      process_rate_ls_m2: processRate,
      recommended_process_rate_ls_m2: { minimum: 18, maximum: 22 },
      parent_loop_flow_m3h: roundEngineering(parentFlowM3h, FLOW_DECIMALS),
      products: selectedProducts,
    },
    results: {
      selected_count: selectedProducts.reduce((sum, product) => sum + product.quantity, 0),
      total_area_m2: roundEngineering(totalArea, VOLUME_DECIMALS),
      parent_loop_flow_ls: roundEngineering(parentFlowLs, FLOW_DECIMALS),
      capacity_ls: roundEngineering(capacityLs, FLOW_DECIMALS),
      capacity_m3h: roundEngineering(capacityLs == null ? null : capacityLs * 3.6, FLOW_DECIMALS),
      actual_loading_ls_m2: roundEngineering(actualLoading, FLOW_DECIMALS),
    },
    formula: 'area = Σ(quantity × π × (diameter ÷ 2)²); capacity = total area × process rate; actual loading = parent loop flow ÷ total area',
  };
}

/**
 * Calculates the open filtration area and capacity of selected AAT Sand
 * Filters.  Sand-filter sizing intentionally shares the transparent hydraulic
 * basis used by fractionators, but keeps its own governed recommendation.
 */
export function calculateSandFilterCapacity(
  parentLoopFlowM3h: unknown,
  processRateLsM2: unknown,
  products: any[],
) {
  const parentFlowM3h = parentLoopFlowM3h == null || parentLoopFlowM3h === ''
    ? null
    : numberOrNull(parentLoopFlowM3h);
  const processRate = positiveOrNull(processRateLsM2);
  const selectedProducts = Array.isArray(products) ? products.map(product => {
    const quantity = Number(product?.quantity);
    const diameterMm = positiveOrNull(product?.diameter_mm);
    const unitAreaM2 = diameterMm == null ? null : Math.PI * Math.pow(diameterMm / 2000, 2);
    return {
      product_master_id: product?.product_master_id || null,
      product_code: product?.product_code || null,
      product_name: product?.product_name || null,
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
      diameter_mm: diameterMm,
      unit_area_m2: roundEngineering(unitAreaM2, VOLUME_DECIMALS),
      total_area_m2: unitAreaM2 == null || !(quantity > 0)
        ? null
        : roundEngineering(unitAreaM2 * quantity, VOLUME_DECIMALS),
    };
  }) : [];
  const reasons: string[] = [];
  if (parentFlowM3h == null || parentFlowM3h < 0) reasons.push('Parent loop allocation is unavailable.');
  if (!selectedProducts.length) reasons.push('Select at least one AAT Sand Filter.');
  if (selectedProducts.some(product => product.quantity <= 0)) reasons.push('Every selected sand filter requires a positive whole-number quantity.');
  if (selectedProducts.some(product => product.diameter_mm == null)) reasons.push('Every selected sand filter requires a valid saved diameter.');
  if (processRate == null) reasons.push('Enter an AAT process rate greater than zero.');
  const totalArea = !selectedProducts.length
    || reasons.some(reason => reason.includes('diameter') || reason.includes('quantity'))
    ? null
    : selectedProducts.reduce((sum, product) =>
        sum + Math.PI * Math.pow(Number(product.diameter_mm) / 2000, 2) * product.quantity, 0);
  const parentFlowLs = parentFlowM3h == null ? null : parentFlowM3h / 3.6;
  const capacityLs = totalArea == null || processRate == null ? null : totalArea * processRate;
  const actualLoading = totalArea == null || totalArea <= 0 || parentFlowLs == null
    ? null
    : parentFlowLs / totalArea;
  let matchStatus: 'incomplete' | 'matched' | 'required_above_capacity' | 'capacity_above_required' = 'incomplete';
  if (!reasons.length && capacityLs != null && parentFlowLs != null) {
    const tolerance = Math.max(capacityLs, parentFlowLs) * SAND_FILTER_MATCH_TOLERANCE_PCT / 100;
    matchStatus = Math.abs(capacityLs - parentFlowLs) <= tolerance
      ? 'matched'
      : parentFlowLs > capacityLs
        ? 'required_above_capacity'
        : 'capacity_above_required';
  }
  return {
    status: reasons.length ? 'invalid' as CalculationStatus : 'valid' as CalculationStatus,
    match_status: matchStatus,
    reasons,
    advisory: processRate != null && (processRate < 5 || processRate > 7)
      ? 'Selected process rate is outside the recommended AAT range of 5–7 L/s/m².'
      : null,
    inputs: {
      process_rate_ls_m2: processRate,
      recommended_process_rate_ls_m2: { minimum: 5, maximum: 7 },
      parent_loop_flow_m3h: roundEngineering(parentFlowM3h, FLOW_DECIMALS),
      products: selectedProducts,
    },
    results: {
      selected_count: selectedProducts.reduce((sum, product) => sum + product.quantity, 0),
      total_area_m2: roundEngineering(totalArea, VOLUME_DECIMALS),
      parent_loop_flow_ls: roundEngineering(parentFlowLs, FLOW_DECIMALS),
      capacity_ls: roundEngineering(capacityLs, FLOW_DECIMALS),
      capacity_m3h: roundEngineering(capacityLs == null ? null : capacityLs * 3.6, FLOW_DECIMALS),
      actual_loading_ls_m2: roundEngineering(actualLoading, FLOW_DECIMALS),
    },
    formula: 'area = Σ(quantity × π × (diameter ÷ 2)²); capacity = total area × process rate; actual loading = parent loop flow ÷ total area',
  };
}

export function compatibleWaterTypes(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return true;
  const normalize = (value: string) => {
    const type = value.toLowerCase().replace(/[\s_-]+/g, '');
    if (type === 'saltwater' || type === 'marine') return 'marine';
    if (type === 'universal') return 'universal';
    return type;
  };
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a === 'universal' || b === 'universal';
}

function dimension(tank: any, key: string): number | null {
  return positiveOrNull(tank?.[key]);
}

/**
 * Returns the raw operating volume before substrate/theming displacement.
 * Dimensions are in millimetres and the result is m³.  A wall thickness
 * removes two side panels and one bottom panel for an open-top tank.
 */
export function calculateTankOperatingVolume(tank: any): {
  value_m3: number | null;
  footprint_area_m2: number | null;
  source: 'dimensions' | 'stored' | 'missing';
  formula: string;
  inputs: Record<string, number | string | null>;
} {
  const shape = String(tank?.eff_shape || tank?.shape_type || '').toLowerCase();
  const projectStoredVolume = positiveOrNull(
    tank?.project_operating_volume_m3 ?? tank?.operating_volume_m3,
  );
  const pimStoredVolume = positiveOrNull(tank?.pim_operating_volume_m3);
  const storedOperatingVolume = projectStoredVolume ?? pimStoredVolume;
  const wall = positiveOrNull(tank?.wall_thickness_mm) || 0;
  const outerLength = dimension(tank, 'eff_length_mm') ?? dimension(tank, 'length_mm');
  const outerWidth = dimension(tank, 'eff_width_mm') ?? dimension(tank, 'width_mm');
  const outerHeight = dimension(tank, 'eff_height_mm') ?? dimension(tank, 'height_mm');
  const waterLevel = dimension(tank, 'eff_water_level_mm') ??
    dimension(tank, 'design_water_level_mm');
  const innerLength = dimension(tank, 'inner_length_mm') ??
    (outerLength != null && wall ? outerLength - 2 * wall : outerLength);
  const innerWidth = dimension(tank, 'inner_width_mm') ??
    (outerWidth != null && wall ? outerWidth - 2 * wall : outerWidth);
  const innerHeight = dimension(tank, 'inner_height_mm') ??
    (outerHeight != null && wall ? outerHeight - wall : outerHeight);
  const operatingHeight = waterLevel ?? innerHeight;

  let calculated: number | null = null;
  let footprintArea: number | null = null;
  let formula = '';
  if (shape === 'custom') {
    calculated = storedOperatingVolume ?? positiveOrNull(tank?.design_volume_m3);
    footprintArea = positiveOrNull(tank?.surface_area_m2);
    formula = 'Stored operating volume (custom tank)';
  } else if (storedOperatingVolume != null) {
    calculated = storedOperatingVolume;
    footprintArea = positiveOrNull(tank?.surface_area_m2);
    formula = projectStoredVolume != null
      ? 'Stored project-tank operating volume'
      : 'Stored PIM tank operating volume';
  } else if (shape === 'cylindrical' && innerWidth != null && innerWidth > 0 &&
             operatingHeight != null && operatingHeight > 0) {
    footprintArea = Math.PI * Math.pow(innerWidth / 2, 2) / 1e6;
    calculated = Math.PI * Math.pow(innerWidth / 2, 2) * operatingHeight / 1e9;
    formula = 'π × (inner diameter ÷ 2)² × operating water height ÷ 1,000,000,000';
  } else if (shape !== 'cylindrical' && innerLength != null && innerLength > 0 &&
             innerWidth != null && innerWidth > 0 && operatingHeight != null && operatingHeight > 0) {
    footprintArea = innerLength * innerWidth / 1e6;
    calculated = innerLength * innerWidth * operatingHeight / 1e9;
    formula = 'inner length × inner width × operating water height ÷ 1,000,000,000';
  }

  if (calculated == null) {
    const stored = positiveOrNull(tank?.operating_volume_m3 ?? tank?.design_volume_m3);
    if (stored != null) {
      calculated = stored;
      footprintArea = positiveOrNull(tank?.surface_area_m2);
      formula = 'Stored operating volume (dimensional calculation unavailable)';
    }
  }

  if (calculated != null && calculated > 0) {
    return {
      value_m3: roundEngineering(calculated, VOLUME_DECIMALS),
      footprint_area_m2: roundEngineering(footprintArea, VOLUME_DECIMALS),
      source: formula.startsWith('Stored') ? 'stored' : 'dimensions',
      formula,
      inputs: {
        shape: shape || null,
        outer_length_mm: outerLength,
        outer_width_mm: outerWidth,
        outer_height_mm: outerHeight,
        wall_thickness_mm: wall || null,
        inner_length_mm: innerLength,
        inner_width_mm: innerWidth,
        operating_height_mm: operatingHeight,
      },
    };
  }

  return {
    value_m3: null,
    footprint_area_m2: null,
    source: 'missing',
    formula: formula || 'Operating volume requires a stored value or complete dimensions',
    inputs: {
      shape: shape || null,
      outer_length_mm: outerLength,
      outer_width_mm: outerWidth,
      outer_height_mm: outerHeight,
      wall_thickness_mm: wall || null,
      inner_length_mm: innerLength,
      inner_width_mm: innerWidth,
      operating_height_mm: operatingHeight,
    },
  };
}

function displacementVolume(
  record: any,
  prefix: 'substrate' | 'theming',
  footprintAreaM2: number,
  operatingVolumeM3: number,
): { value_m3: number; source: string; input: number | null } {
  const direct = positiveOrNull(record?.[`${prefix}_volume_m3`]);
  if (direct != null) return { value_m3: direct, source: 'direct volume override', input: direct };

  const height = positiveOrNull(record?.[`${prefix}_height_mm`]);
  if (height != null && footprintAreaM2 > 0) {
    return { value_m3: footprintAreaM2 * height / 1000, source: 'footprint area × height', input: height };
  }

  if (prefix === 'theming') {
    const pct = positiveOrNull(record?.theming_volume_pct);
    if (pct != null && operatingVolumeM3 > 0) {
      return { value_m3: operatingVolumeM3 * pct / 100, source: 'operating volume × percentage', input: pct };
    }
  }
  return { value_m3: 0, source: 'none', input: null };
}

export function calculateExhibitHydraulics(
  exhibit: any,
  tanks: any[],
  hydraulics: any,
  substrate: any,
  calculatedAt = new Date().toISOString(),
) {
  const tankDetails = (tanks || []).map(tank => {
    const volume = calculateTankOperatingVolume(tank);
    const quantity = Math.max(1, Number.parseInt(String(tank.quantity ?? 1), 10) || 1);
    return { tank_id: tank.id, tank_code: tank.tank_code, quantity, ...volume,
      total_value_m3: volume.value_m3 == null ? null : roundEngineering(volume.value_m3 * quantity, VOLUME_DECIMALS) };
  });
  const rawOperating = tankDetails.reduce((sum, tank) => sum + (tank.total_value_m3 || 0), 0);
  const footprintArea = tankDetails.reduce(
    (sum, tank) => sum + (tank.footprint_area_m2 || 0) * tank.quantity, 0);
  const substrateResult = displacementVolume(substrate, 'substrate', footprintArea, rawOperating);
  const themingResult = displacementVolume(substrate, 'theming', footprintArea, rawOperating);
  const displaced = substrateResult.value_m3 + themingResult.value_m3;
  const effectiveOperating = Math.max(0, rawOperating - displaced);
  const aatReference = calculateAatRecommendedFlow(effectiveOperating, calculatedAt);
  const turnover = positiveOrNull(hydraulics?.target_turnover_rate);
  const surfacePct = numberOrNull(hydraulics?.surface_skim_pct) ?? 30;
  const bottomPct = numberOrNull(hydraulics?.bottom_drain_pct) ?? 70;
  const allocationTotal = surfacePct + bottomPct;
  const totalFlow = turnover == null || effectiveOperating <= 0 ? null : effectiveOperating * turnover;
  const surfaceFlow = totalFlow == null ? null : totalFlow * surfacePct / 100;
  const bottomFlow = totalFlow == null ? null : totalFlow * bottomPct / 100;
  const reasons: string[] = [];
  const substrateDirectVolume = positiveOrNull(substrate?.substrate_volume_m3);
  const themingDirectVolume = positiveOrNull(substrate?.theming_volume_m3);
  const substrateHeight = positiveOrNull(substrate?.substrate_height_mm);
  const themingHeight = positiveOrNull(substrate?.theming_height_mm);
  const invalidNonNegative = (value: any) =>
    value != null && (!Number.isFinite(Number(value)) || Number(value) < 0);
  const addInvalidInputReason = (label: string, value: any) => {
    if (invalidNonNegative(value)) reasons.push(`${label} must be a finite, non-negative value.`);
  };

  // Direct volumes are always meaningful saved inputs, even when a later
  // height or percentage value is left over from an earlier calculation mode.
  addInvalidInputReason('Substrate volume', substrate?.substrate_volume_m3);
  addInvalidInputReason('Theming volume', substrate?.theming_volume_m3);

  // Height and percentage validation follows the same precedence as
  // displacementVolume. Inactive values must not invalidate an otherwise
  // usable direct-volume calculation.
  if (substrateDirectVolume == null) {
    addInvalidInputReason('Substrate height', substrate?.substrate_height_mm);
  }
  if (themingDirectVolume == null) {
    addInvalidInputReason('Theming height', substrate?.theming_height_mm);
  }
  if (substrateDirectVolume == null && substrateHeight != null && footprintArea <= 0) {
    reasons.push('Substrate height requires tank footprint dimensions; enter a direct substrate volume for custom tanks.');
  }
  if (themingDirectVolume == null && themingHeight != null && footprintArea <= 0) {
    reasons.push('Theming height requires tank footprint dimensions; enter a direct theming volume for custom tanks.');
  }
  const themingPercentageIsActive = themingResult.source === 'operating volume × percentage';
  if (themingPercentageIsActive ||
      (themingDirectVolume == null && themingHeight == null &&
       substrate?.theming_volume_pct != null)) {
    addInvalidInputReason('Theming percentage', substrate?.theming_volume_pct);
    if (numberOrNull(substrate?.theming_volume_pct) != null &&
        Number(substrate.theming_volume_pct) > 100) {
      reasons.push('Theming percentage cannot exceed 100%.');
    }
  }
  if (rawOperating <= 0) reasons.push('Operating volume is missing or invalid.');
  if (rawOperating > 0 && displaced >= rawOperating) {
    reasons.push('Substrate and theming displacement must be less than gross operating volume.');
  }
  if (turnover == null) reasons.push('Turnover target must be greater than zero.');
  if (surfacePct < 0 || surfacePct > 100 || bottomPct < 0 || bottomPct > 100) {
    reasons.push('Surface and bottom allocation percentages must each be between 0% and 100%.');
  }
  if (Math.abs(allocationTotal - 100) > ALLOCATION_TOLERANCE_PCT) {
    reasons.push(`Surface and bottom allocations must total 100% ± ${ALLOCATION_TOLERANCE_PCT}%.`);
  }

  return {
    calculation_version: AQUARIUM_CALCULATION_VERSION,
    calculated_at: calculatedAt,
    status: reasons.length ? 'invalid' as CalculationStatus : 'valid' as CalculationStatus,
    freshness: 'fresh',
    is_stale: false,
    reasons,
    inputs: {
      exhibit_id: exhibit?.id || null,
      water_type: exhibit?.water_type || null,
      turnover_unit: TURNOVER_UNIT,
      flow_unit: FLOW_UNIT,
      tank_count: tankDetails.length,
      tanks: tankDetails,
      gross_operating_volume_m3: roundEngineering(rawOperating, VOLUME_DECIMALS),
      substrate_volume_m3: roundEngineering(substrateResult.value_m3, VOLUME_DECIMALS),
      substrate_source: substrateResult.source,
      theming_volume_m3: roundEngineering(themingResult.value_m3, VOLUME_DECIMALS),
      theming_source: themingResult.source,
      aat_reference_volume_m3: aatReference.inputs.effective_operating_volume_m3,
      target_turnover_rate_cycles_per_hour: turnover,
      surface_skim_pct: surfacePct,
      bottom_drain_pct: bottomPct,
    },
    results: {
      operating_volume_m3: roundEngineering(effectiveOperating, VOLUME_DECIMALS),
      total_return_flow_m3h: roundEngineering(totalFlow, FLOW_DECIMALS),
      surface_skim_flow_m3h: roundEngineering(surfaceFlow, FLOW_DECIMALS),
      bottom_drain_flow_m3h: roundEngineering(bottomFlow, FLOW_DECIMALS),
      allocation_total_pct: roundEngineering(allocationTotal, 2),
    },
    aat_reference: aatReference,
    formula: 'effective operating volume = gross operating volume − substrate displacement − theming displacement; return flow = effective operating volume × turnover',
    rounding: `Volumes rounded to ${VOLUME_DECIMALS} decimals m³; flows rounded to ${FLOW_DECIMALS} decimals m³/h.`,
  };
}

export function evaluateCompactUnit(
  unit: any | null,
  waterType: string | null,
  operatingVolumeM3: number | null,
  requiredFlowM3h: number | null,
) {
  if (!unit) {
    return {
      status: 'warning' as CalculationStatus,
      suitable: null,
      reasons: ['No compact unit selected; bespoke system guidance applies.'],
    };
  }
  const reasons: string[] = [];
  const volume = numberOrNull(operatingVolumeM3);
  const flow = numberOrNull(requiredFlowM3h);
  const minVolume = numberOrNull(unit.min_tank_volume_m3);
  const maxVolume = numberOrNull(unit.max_tank_volume_m3);
  const maxFlow = numberOrNull(unit.max_flow_m3h);
  if (volume == null || volume <= 0) reasons.push('Operating volume is required to confirm compact-unit suitability.');
  if (flow == null || flow <= 0) reasons.push('Required flow is required to confirm compact-unit suitability.');
  if (minVolume != null && volume != null && volume < minVolume) reasons.push(`Volume is below the catalog minimum of ${minVolume} m³.`);
  if (maxVolume != null && volume != null && volume > maxVolume) reasons.push(`Volume exceeds the catalog maximum of ${maxVolume} m³.`);
  if (maxFlow != null && flow != null && flow > maxFlow) reasons.push(`Required flow exceeds the catalog maximum of ${maxFlow} m³/h.`);
  if (!compatibleWaterTypes(waterType, unit.water_type)) reasons.push(`Water type ${waterType} is incompatible with ${unit.water_type} compact equipment.`);
  if (unit.status && unit.status !== 'Active') reasons.push(`Catalog unit is ${unit.status.toLowerCase()}.`);
  return {
    status: reasons.length ? 'invalid' as CalculationStatus : 'valid' as CalculationStatus,
    suitable: reasons.length === 0,
    reasons,
    limits: {
      water_type: unit.water_type || null,
      min_tank_volume_m3: minVolume,
      max_tank_volume_m3: maxVolume,
      design_flow_m3h: numberOrNull(unit.design_flow_m3h),
      max_flow_m3h: maxFlow,
    },
  };
}

export function calculateSystemEngineering(
  system: any,
  links: any[],
  exhibitCalculations: any[],
  compactUnit: any | null,
  calculatedAt = new Date().toISOString(),
  sideStreams: any[] = system?.side_streams || [],
  fractionatorAllocations: any[] = system?.fractionator_allocations || [],
  sandFilterAllocations: any[] = system?.sand_filter_allocations || [],
) {
  const linked = (links || []).map(link => {
    const exhibit = exhibitCalculations.find(calc => calc.inputs.exhibit_id === link.exhibit_id);
    const calculationIsCurrent = exhibit?.status === 'valid' &&
      exhibit?.is_stale !== true &&
      exhibit?.freshness !== 'stale';
    const required = calculationIsCurrent
      ? exhibit.results.total_return_flow_m3h ?? null
      : null;
    const override = numberOrNull(link.flow_allocation_m3h);
    return {
      link_id: link.id,
      exhibit_id: link.exhibit_id,
      exhibit_code: link.exhibit_code || null,
      link_type: link.link_type || 'Primary',
      required_flow_m3h: required,
      allocation_m3h: override ?? required,
      allocation_source: override != null ? 'manual_override' : 'calculated',
      allocation_override_m3h: override,
      flow_available: required != null,
      flow_unavailable_reason: required == null
        ? 'Current exhibit hydraulic inputs are incomplete or invalid.'
        : null,
    };
  });
  const linkedFlowsAvailable = linked.length > 0 &&
    linked.every(link => link.required_flow_m3h != null);
  const requiredFlow = linkedFlowsAvailable
    ? linked.reduce((sum, link) => sum + Number(link.required_flow_m3h), 0)
    : null;
  const allocatedFlow = linked.length === 0
    ? 0
    : linked.every(link => link.allocation_m3h != null)
      ? linked.reduce((sum, link) => sum + Number(link.allocation_m3h), 0)
      : null;
  const savedFlow = positiveOrNull(system?.design_flow_m3h);
  const savedTurnover = positiveOrNull(system?.turnover_rate_hr);
  const calculationInputs = system?.calculation_inputs &&
    typeof system.calculation_inputs === 'object'
    ? system.calculation_inputs
    : {};
  const designFlowSource = calculationInputs.design_flow_source === 'manual_override'
    ? 'manual_override'
    : 'linked_exhibits';
  const turnoverSource = calculationInputs.turnover_source === 'manual_override'
    ? 'manual_override'
    : 'primary_exhibit';
  const hasFlowOverride = designFlowSource === 'manual_override' && savedFlow != null;
  const storedFlowDiffers = hasFlowOverride && requiredFlow != null &&
    Math.abs(savedFlow - requiredFlow) > 0.005;
  const reasons: string[] = [];
  for (const link of linked) {
    const linkedCalculation = exhibitCalculations.find(
      item => item.inputs.exhibit_id === link.exhibit_id);
    if (!linkedCalculation) {
      reasons.push(`Linked exhibit ${link.exhibit_code || link.exhibit_id} has no engineering calculation.`);
    } else if (linkedCalculation.status !== 'valid' ||
               linkedCalculation.is_stale === true ||
               linkedCalculation.freshness === 'stale') {
      const detail = linkedCalculation.reasons?.join(' ') || 'Invalid engineering inputs.';
      reasons.push(`Linked exhibit ${link.exhibit_code || link.exhibit_id} has no current usable engineering calculation: ${detail}`);
    }
  }
  if (allocatedFlow != null && requiredFlow != null &&
      Math.abs(allocatedFlow - requiredFlow) > 0.005 && requiredFlow > 0) {
    reasons.push('Exhibit allocations do not equal the calculated required system flow.');
  }
  const primaryLinks = linked.filter(link => link.link_type === 'Primary');
  const primary = primaryLinks.length === 1 ? primaryLinks[0] : null;
  const primaryCalc = primary && exhibitCalculations.find(calc => calc.inputs.exhibit_id === primary.exhibit_id);
  const calculatedTurnover = primaryCalc?.status === 'valid' &&
    primaryCalc?.is_stale !== true &&
    primaryCalc?.freshness !== 'stale'
    ? primaryCalc.inputs.target_turnover_rate_cycles_per_hour ?? null
    : null;
  const turnover = turnoverSource === 'manual_override'
    ? savedTurnover
    : calculatedTurnover;
  if (turnoverSource === 'primary_exhibit' && linked.length > 0 && primaryLinks.length !== 1) {
    reasons.push(primaryLinks.length === 0
      ? 'Exactly one Primary exhibit link is required to calculate system turnover.'
      : 'Multiple Primary exhibit links make system turnover unavailable.');
  }
  const hasTurnoverOverride = turnoverSource === 'manual_override' && savedTurnover != null;
  const storedTurnoverDiffers = hasTurnoverOverride && calculatedTurnover != null &&
    Math.abs(savedTurnover - calculatedTurnover) > 0.005;
  const designFlow = designFlowSource === 'manual_override'
    ? savedFlow
    : requiredFlow;
  const unitResult = system?.system_config === 'compact'
    ? evaluateCompactUnit(
      compactUnit,
      system?.water_type || primaryCalc?.inputs.water_type || null,
      linked.reduce((sum, link) => {
        const calc = exhibitCalculations.find(item => item.inputs.exhibit_id === link.exhibit_id);
        const calculationIsCurrent = calc?.status === 'valid' &&
          calc?.is_stale !== true &&
          calc?.freshness !== 'stale';
        return sum + (calculationIsCurrent ? (calc?.results.operating_volume_m3 || 0) : 0);
      }, 0),
      designFlow,
    )
    : {
        status: 'warning' as CalculationStatus,
        suitable: null,
        reasons: ['Bespoke system selected; no compact catalog limits apply.'],
      };
  if (system?.system_config === 'compact') reasons.push(...unitResult.reasons);
  // Resolve matched loops after reading the complete route. This deliberately
  // uses loop flow, not its allocation percent, so a chain always follows the
  // current authoritative source flow.
  const resolvedLoopFlows = resolveLoopFlows(system, designFlow);
  for (const resolved of resolvedLoopFlows) {
    if (resolved.flow_mode === 'matched' && resolved.unavailable_reason) reasons.push(resolved.unavailable_reason);
  }
  const flowRoute = [1, 2, 3].map(loopNumber => {
    const allocationPct = numberOrNull(system?.[`loop${loopNumber}_flow_pct`]);
    const resolved = resolvedLoopFlows[loopNumber - 1];
    const flowMode = resolved.flow_mode;
    const matchLoopNumber = resolved.match_loop_number;
    const parentFlow = resolved.flow_m3h;
    return {
      loop_number: loopNumber,
      name: String(system?.[`loop${loopNumber}_name`] || `Loop ${loopNumber}`),
      flow_mode: flowMode,
      match_loop_number: matchLoopNumber,
      allocation_pct: allocationPct,
      flow_m3h: parentFlow,
      side_streams: sideStreams
        .filter(stream => Number(stream.parent_loop_number) === loopNumber)
        .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
        .map(stream => ({
          ...stream,
          flow_m3h: parentFlow != null && numberOrNull(stream.flow_pct) != null
            ? roundEngineering(parentFlow * Number(stream.flow_pct) / 100, FLOW_DECIMALS)
            : null,
          flow_available: parentFlow != null,
          flow_unavailable_reason: parentFlow == null
            ? (resolved.unavailable_reason || 'Parent loop allocation is unavailable.') : null,
        })),
      foam_fractionation: String(system?.[`loop${loopNumber}_filtration`] || '') === 'Foam Fractionation'
        ? (() => {
            const allocation = fractionatorAllocations.find(
              item => Number(item.parent_loop_number) === loopNumber);
            return {
              allocation_id: allocation?.id || null,
              notes: allocation?.notes || null,
              ...calculateFoamFractionatorCapacity(
                parentFlow,
                allocation?.process_rate_ls_m2,
                allocation?.products || [],
              ),
            };
          })()
        : null,
      sand_filter: String(system?.[`loop${loopNumber}_filtration`] || '') === 'Sand Filter'
        ? (() => {
            const allocation = sandFilterAllocations.find(
              item => Number(item.parent_loop_number) === loopNumber);
            return {
              allocation_id: allocation?.id || null,
              notes: allocation?.notes || null,
              ...calculateSandFilterCapacity(
                parentFlow,
                allocation?.process_rate_ls_m2,
                allocation?.products || [],
              ),
            };
          })()
        : null,
    };
  });
  for (const loop of flowRoute) {
    const foam = loop.foam_fractionation;
    if (!foam) continue;
    if (foam.match_status === 'incomplete') {
      reasons.push(
        `${loop.name} Foam Fractionator capacity is incomplete: ${foam.reasons.join(' ')}`,
      );
    } else if (foam.match_status === 'required_above_capacity') {
      reasons.push(`${loop.name} required flow is above the selected Foam Fractionator capacity.`);
    }
  }
  for (const loop of flowRoute) {
    const sand = loop.sand_filter;
    if (!sand) continue;
    if (sand.match_status === 'incomplete') {
      reasons.push(
        `${loop.name} Sand Filter capacity is incomplete: ${sand.reasons.join(' ')}`,
      );
    } else if (sand.match_status === 'required_above_capacity') {
      reasons.push(`${loop.name} required flow is above the selected Sand Filter capacity.`);
    }
  }

  return {
    calculation_version: AQUARIUM_CALCULATION_VERSION,
    calculated_at: calculatedAt,
    status: reasons.length ? 'invalid' : hasFlowOverride || hasTurnoverOverride ? 'override' : 'valid',
    freshness: hasFlowOverride || hasTurnoverOverride ? 'override' : 'fresh',
    is_stale: false,
    reasons,
    inputs: {
      system_id: system?.id || null,
      flow_unit: FLOW_UNIT,
      turnover_unit: TURNOVER_UNIT,
      linked_exhibits: linked.length,
      saved_design_flow_m3h: savedFlow,
      saved_turnover_rate_cycles_per_hour: savedTurnover,
      design_flow_source: designFlowSource,
      turnover_source: turnoverSource,
      system_water_type: system?.water_type || null,
    },
    results: {
      calculated_required_flow_m3h: roundEngineering(requiredFlow, FLOW_DECIMALS),
      allocated_flow_m3h: roundEngineering(allocatedFlow, FLOW_DECIMALS),
      design_flow_m3h: roundEngineering(designFlow, FLOW_DECIMALS),
      turnover_rate_cycles_per_hour: turnover,
      allocation_total_m3h: roundEngineering(allocatedFlow, FLOW_DECIMALS),
      flow_override_m3h: hasFlowOverride ? savedFlow : null,
      turnover_override_cycles_per_hour: hasTurnoverOverride ? savedTurnover : null,
      flow_override_differs_from_recommendation: storedFlowDiffers,
      turnover_override_differs_from_recommendation: storedTurnoverDiffers,
      sync_state: {
        design_flow: designFlowSource,
        turnover: turnoverSource,
      },
    },
    allocations: linked,
    flow_route: {
      flow_unit: FLOW_UNIT,
      side_streams_are_branches: true,
      loops: flowRoute,
    },
    suitability: unitResult,
    formula: 'system required flow = sum of linked exhibit return flows; unassigned exhibit allocations use calculated flow',
    rounding: `Flows rounded to ${FLOW_DECIMALS} decimals m³/h; comparison tolerance is 0.005 m³/h.`,
  };
}