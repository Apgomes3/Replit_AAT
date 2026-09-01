/**
 * UV fluence selection calculation engine.
 *
 * Formula: F = I × V × n / Q
 *   I  – irradiance at UVT percentile in mW/cm²
 *   V  – effective reactor volume per unit in L
 *   n  – integer unit quantity
 *   Q  – side-stream flow in L/s (m³/h ÷ 3.6)
 *
 * Hydraulic limit: Q / (lamp_count × n) ≤ 6.25 L/s per lamp
 *
 * Units: mJ/cm²  (because mW/cm² × s = mJ/cm²)
 */

export const UV_CALCULATION_VERSION = 'UV_SEL_V1.0';

/** Max flow per lamp in L/s — from manufacturer hydraulic design guidance. */
export const UV_MAX_FLOW_PER_LAMP_LS = 6.25;

export interface UVRevisionData {
  id: string;
  catalog_id: string;
  revision_number: number;
  status: string;
  lamp_count: number;
  lamp_power_w: number;
  effective_reactor_volume_l: number;
  irradiance_85t_mw_cm2: number;
  irradiance_95t_mw_cm2: number;
  compatibility: string;
  arrangement: string;
  source_evidence: string;
  approved_per_lamp_flow_exception_m3h: number | null;
  notes: string | null;
  // joined from catalog/product
  product_code?: string;
  product_name?: string;
  manufacturer?: string;
}

export interface UVStreamInput {
  side_stream_id: string;
  side_stream_name: string;
  /** Flow allocated to this UV side stream in m³/h */
  flow_m3h: number | null;
  uv_revision: UVRevisionData | null;
  uv_unit_quantity: number | null;
  /** UVT at 85th-percentile (0–100). Defaults to 85 if null. */
  uvt_85t_pct: number | null;
  uvt_95t_pct: number | null;
}

export interface UVStreamResult {
  side_stream_id: string;
  side_stream_name: string;
  flow_m3h: number | null;
  flow_ls: number | null;
  uv_revision_id: string | null;
  product_code: string | null;
  product_name: string | null;
  unit_quantity: number | null;
  // per-unit flow
  flow_per_unit_ls: number | null;
  // hydraulic check
  flow_per_lamp_ls: number | null;
  hydraulic_pass: boolean | null;
  hydraulic_exception: boolean;
  // contact time
  contact_time_s: number | null;
  // fluence (both irradiance grades)
  fluence_85t_mj_cm2: number | null;
  fluence_95t_mj_cm2: number | null;
  // vs. target
  target_met_85t: boolean | null;
  target_met_95t: boolean | null;
  // compatibility
  compatibility_warning: string | null;
  // overall status
  status: 'ready' | 'incomplete' | 'error';
  reasons: string[];
}

export interface UVCalculationResult {
  version: string;
  target_fluence_mj_cm2: number;
  water_type: string | null;
  streams: UVStreamResult[];
  /** true if all UV streams are defined, have product + quantity, and meet the target at 85th pct */
  overall_pass: boolean;
  overall_status: 'pass' | 'partial' | 'fail' | 'incomplete';
}

/** Convert m³/h → L/s */
function m3hToLs(m3h: number): number {
  return m3h / 3.6;
}

/** Check material compatibility of the revision against the system water type. */
function compatibilityWarning(revision: UVRevisionData, waterType: string | null): string | null {
  if (!waterType) return null;
  const compat = (revision.compatibility || '').toLowerCase();
  const isSaltwater = waterType === 'Marine' || waterType === 'Salt Water' || waterType === 'Brackish';
  const isFreshwater = waterType === 'Freshwater' || waterType === 'Blackwater';

  if (isSaltwater && compat && !compat.includes('salt') && !compat.includes('marine') && !compat.includes('titanium') && !compat.includes('all')) {
    return `Compatibility note: revision lists "${revision.compatibility}" — confirm suitability for ${waterType}.`;
  }
  if (isFreshwater && compat && (compat.includes('marine only') || compat.includes('saltwater only'))) {
    return `Compatibility note: revision lists "${revision.compatibility}" — confirm suitability for ${waterType}.`;
  }
  return null;
}

export function calculateUVStream(
  input: UVStreamInput,
  targetFluenceMjCm2: number,
  waterType: string | null,
): UVStreamResult {
  const reasons: string[] = [];
  const { side_stream_id, side_stream_name, flow_m3h, uv_revision, uv_unit_quantity } = input;
  const rev = uv_revision;

  const base = {
    side_stream_id,
    side_stream_name,
    flow_m3h: flow_m3h ?? null,
    uv_revision_id: rev?.id ?? null,
    product_code: rev?.product_code ?? null,
    product_name: rev?.product_name ?? null,
    unit_quantity: uv_unit_quantity ?? null,
    flow_ls: flow_m3h != null ? m3hToLs(flow_m3h) : null,
    flow_per_unit_ls: null,
    flow_per_lamp_ls: null,
    hydraulic_pass: null,
    hydraulic_exception: false,
    contact_time_s: null,
    fluence_85t_mj_cm2: null,
    fluence_95t_mj_cm2: null,
    target_met_85t: null,
    target_met_95t: null,
    compatibility_warning: null,
    status: 'incomplete' as const,
    reasons,
  };

  if (flow_m3h == null) reasons.push('Parent loop flow is not available for this side stream.');
  if (!rev) reasons.push('No UV product revision assigned to this stream.');
  if (!uv_unit_quantity || uv_unit_quantity < 1) reasons.push('Unit quantity is required (minimum 1).');

  if (reasons.length > 0) {
    return { ...base, status: 'incomplete', reasons };
  }

  // All prerequisites met
  const flowLs = m3hToLs(flow_m3h!);
  const n = uv_unit_quantity!;
  const I_85 = Number(rev!.irradiance_85t_mw_cm2);
  const I_95 = Number(rev!.irradiance_95t_mw_cm2);
  const V = Number(rev!.effective_reactor_volume_l);
  const lampCount = Number(rev!.lamp_count);

  if (flowLs <= 0) {
    reasons.push('Derived flow for this stream is zero or negative; check the parent loop allocation.');
    return { ...base, flow_ls: flowLs, status: 'error', reasons };
  }

  const flowPerUnitLs = flowLs / n;
  const flowPerLampLs = flowLs / (lampCount * n);
  const maxFlowPerLamp = rev!.approved_per_lamp_flow_exception_m3h != null
    ? m3hToLs(Number(rev!.approved_per_lamp_flow_exception_m3h))
    : UV_MAX_FLOW_PER_LAMP_LS;
  const hydraulicException = rev!.approved_per_lamp_flow_exception_m3h != null;
  const hydraulicPass = flowPerLampLs <= maxFlowPerLamp;

  if (!hydraulicPass) {
    reasons.push(
      `Hydraulic limit exceeded: ${flowPerLampLs.toFixed(3)} L/s/lamp > ${maxFlowPerLamp.toFixed(3)} L/s/lamp limit.` +
      (hydraulicException ? '' : ' Increase unit quantity or select a larger model.'),
    );
  }

  // Contact time = V × n / Q
  const contactTimeS = (V * n) / flowLs;

  // Fluence = I × contact_time
  const fluence85 = I_85 * contactTimeS;
  const fluence95 = I_95 * contactTimeS;

  const targetMet85 = fluence85 >= targetFluenceMjCm2;
  const targetMet95 = fluence95 >= targetFluenceMjCm2;

  if (!targetMet85) {
    reasons.push(
      `Fluence at 85th pct UVT (${fluence85.toFixed(4)} mJ/cm²) does not meet target of ${targetFluenceMjCm2} mJ/cm².`,
    );
  }

  const compatWarn = compatibilityWarning(rev!, waterType);

  return {
    ...base,
    flow_ls: flowLs,
    flow_per_unit_ls: flowPerUnitLs,
    flow_per_lamp_ls: flowPerLampLs,
    hydraulic_pass: hydraulicPass,
    hydraulic_exception: hydraulicException,
    contact_time_s: contactTimeS,
    fluence_85t_mj_cm2: fluence85,
    fluence_95t_mj_cm2: fluence95,
    target_met_85t: targetMet85,
    target_met_95t: targetMet95,
    compatibility_warning: compatWarn,
    status: reasons.length > 0 ? 'error' : 'ready',
    reasons,
  };
}

export function calculateUVSelection(
  streams: UVStreamInput[],
  targetFluenceMjCm2: number,
  waterType: string | null,
): UVCalculationResult {
  const results = streams.map(s => calculateUVStream(s, targetFluenceMjCm2, waterType));

  const allReady = results.every(r => r.status === 'ready');
  const allPass = allReady && results.every(r => r.target_met_85t === true && r.hydraulic_pass === true);
  const anyPass = results.some(r => r.status === 'ready' && r.target_met_85t === true);
  const anyIncomplete = results.some(r => r.status === 'incomplete');

  const overallStatus =
    results.length === 0 ? 'incomplete'
    : allPass ? 'pass'
    : anyIncomplete ? 'incomplete'
    : anyPass ? 'partial'
    : 'fail';

  return {
    version: UV_CALCULATION_VERSION,
    target_fluence_mj_cm2: targetFluenceMjCm2,
    water_type: waterType,
    streams: results,
    overall_pass: allPass,
    overall_status: overallStatus,
  };
}
