import crypto from 'crypto';
import { GRAVITY_M_S2, WATER_DENSITY_KG_M3 } from './pumpSelections';

export const FRICTION_LOSS_CALCULATION_VERSION = 'friction-loss-v2';
export const WATER_DYNAMIC_VISCOSITY_PA_S = 0.001002;

export type FrictionSide = 'suction' | 'discharge';
export type FrictionComponentKind = 'pipe' | 'fitting';

export type FrictionLossComponentInput = {
  project_piping_item_id?: string | null;
  side?: FrictionSide;
  component_kind?: FrictionComponentKind;
  sort_order?: number;
  piping_snapshot?: any;
  internal_diameter_mm?: unknown;
  straight_length_m?: unknown;
  material?: unknown;
  absolute_roughness_mm?: unknown;
  fitting_k_value?: unknown;
  quantity?: unknown;
};

const finite = (value: unknown) =>
  value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
const positive = (value: unknown) => {
  const number = finite(value);
  return number != null && number > 0 ? number : null;
};
const nonNegative = (value: unknown) => {
  const number = finite(value);
  return number != null && number >= 0 ? number : null;
};
const round = (value: number | null, places = 6) =>
  value == null ? null : Number(value.toFixed(places));

export function frictionSourceFingerprint(source: unknown) {
  const canonical = JSON.stringify(source, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).sort().reduce((out: any, key) => {
          out[key] = value[key];
          return out;
        }, {})
      : value);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function frictionCircuitSource(circuit: any) {
  return {
    circuit_key: circuit?.circuit_key || null,
    circuit_kind: circuit?.circuit_kind || null,
    circuit_name: circuit?.circuit_name || null,
    circuit_type: circuit?.circuit_type || null,
    parent_loop_number: circuit?.parent_loop_number == null ? null : Number(circuit.parent_loop_number),
    side_stream_id: circuit?.side_stream_id || null,
    flow_m3h: finite(circuit?.flow_m3h),
  };
}

export function frictionPumpSource(pump: any) {
  if (!pump) return null;
  return {
    project_equipment_item_id: pump.project_equipment_item_id || pump.id || null,
    equip_code: pump.equip_code || null,
    description: pump.description || null,
    product_master_id: pump.product_master_id || null,
    product_code: pump.product_code || null,
    product_name: pump.product_name || null,
    manufacturer: pump.manufacturer || null,
    model: pump.model || null,
  };
}

export function frictionPipingSource(item: any) {
  if (!item) return null;
  return {
    project_piping_item_id: item.project_piping_item_id || item.id || null,
    piping_code: item.piping_code || null,
    description: item.description || null,
    project_quantity: finite(item.project_quantity),
    unit: item.unit || null,
    system_id: item.system_id || null,
    product_master_id: item.product_master_id || null,
    product_code: item.product_code || null,
    product_name: item.product_name || null,
    application_type: item.application_type || null,
  };
}

export function frictionSourceSnapshot(circuit: any, pump: any, components: FrictionLossComponentInput[], tankBoundaries?: any) {
  return {
    circuit: frictionCircuitSource(circuit),
    selected_pump: frictionPumpSource(pump),
    components: components.map(component => ({
      project_piping_item_id: component.project_piping_item_id || null,
      piping_snapshot: frictionPipingSource(component.piping_snapshot),
      side: component.side,
      component_kind: component.component_kind,
      sort_order: Number(component.sort_order || 0),
      internal_diameter_mm: finite(component.internal_diameter_mm),
      straight_length_m: finite(component.straight_length_m),
      material: String(component.material || '').trim() || null,
      absolute_roughness_mm: finite(component.absolute_roughness_mm),
      fitting_k_value: finite(component.fitting_k_value),
      quantity: finite(component.quantity),
    })),
    tank_boundaries: tankBoundaries || null,
  };
}

export function calculateFrictionLoss(input: {
  flow_m3h?: unknown;
  selected_pump?: any;
  components?: FrictionLossComponentInput[];
  tank_boundaries?: any;
  calculated_at?: string;
}) {
  const flowM3h = positive(input.flow_m3h);
  const components = Array.isArray(input.components) ? input.components : [];
  const reasons: string[] = [];
  const boundaries = input.tank_boundaries || {};
  const start = boundaries.start || {};
  const end = boundaries.end || {};
  const startBase = finite(start.base_elevation_fl0_m);
  const startDepth = nonNegative(start.water_depth_m);
  const drawHeight = nonNegative(start.pump_draw_height_m);
  const endBase = finite(end.base_elevation_fl0_m);
  const endDepth = nonNegative(end.water_depth_m);
  const startPressure = start.open_to_atmosphere === false ? finite(start.gauge_pressure_kpa) : 0;
  const endPressure = end.open_to_atmosphere === false ? finite(end.gauge_pressure_kpa) : 0;
  if (!start.tank_id) reasons.push('Select a start tank.');
  if (!end.tank_id) reasons.push('Select a receiving tank.');
  if (startBase == null) reasons.push('Start tank base elevation relative to FL0 is required.');
  if (startDepth == null) reasons.push('Start tank water depth must be zero or greater.');
  if (drawHeight == null) reasons.push('Pump draw height must be zero or greater.');
  if (drawHeight != null && startDepth != null && drawHeight > startDepth) reasons.push('Pump draw height cannot be above the start tank water level.');
  if (endBase == null) reasons.push('Receiving tank base elevation relative to FL0 is required.');
  if (endDepth == null) reasons.push('Receiving tank water depth must be zero or greater.');
  if (start.open_to_atmosphere === false && startPressure == null) reasons.push('Start tank gauge pressure is required when it is not open to atmosphere.');
  if (end.open_to_atmosphere === false && endPressure == null) reasons.push('Receiving tank gauge pressure is required when it is not open to atmosphere.');
  if (flowM3h == null) reasons.push('Circuit flow is missing or must be greater than zero.');
  if (!input.selected_pump?.project_equipment_item_id && !input.selected_pump?.id) {
    reasons.push('Select a pump assigned to this LSS system.');
  }
  for (const side of ['suction', 'discharge'] as FrictionSide[]) {
    if (!components.some(component => component.side === side)) {
      reasons.push(`Add at least one ${side}-side pipe or fitting.`);
    }
  }

  const flowM3s = flowM3h == null ? null : flowM3h / 3600;
  const componentResults = components.map((component, index) => {
    const side = component.side === 'discharge' ? 'discharge' : 'suction';
    const kind = component.component_kind === 'fitting' ? 'fitting' : 'pipe';
    const label = component.piping_snapshot?.piping_code ||
      component.piping_snapshot?.product_code ||
      `Component ${index + 1}`;
    const diameterMm = positive(component.internal_diameter_mm);
    const diameterM = diameterMm == null ? null : diameterMm / 1000;
    const areaM2 = diameterM == null ? null : Math.PI * diameterM * diameterM / 4;
    const velocity = flowM3s == null || areaM2 == null ? null : flowM3s / areaM2;
    const reynolds = velocity == null || diameterM == null
      ? null
      : WATER_DENSITY_KG_M3 * velocity * diameterM / WATER_DYNAMIC_VISCOSITY_PA_S;
    const rowReasons: string[] = [];
    if (!component.project_piping_item_id || !component.piping_snapshot) {
      rowReasons.push(`${label}: select a project piping item assigned to this system.`);
    }
    if (diameterMm == null) rowReasons.push(`${label}: internal diameter must be greater than zero.`);

    let frictionFactor: number | null = null;
    let majorHeadM: number | null = null;
    let minorHeadM: number | null = null;
    if (kind === 'pipe') {
      const lengthM = positive(component.straight_length_m);
      const roughnessMm = nonNegative(component.absolute_roughness_mm);
      if (lengthM == null) rowReasons.push(`${label}: straight length must be greater than zero.`);
      if (!String(component.material || '').trim()) rowReasons.push(`${label}: pipe material is required.`);
      if (roughnessMm == null) rowReasons.push(`${label}: absolute roughness must be zero or greater.`);
      if (reynolds != null && reynolds > 0 && roughnessMm != null && diameterM != null) {
        frictionFactor = reynolds < 2300
          ? 64 / reynolds
          : 0.25 / Math.pow(Math.log10((roughnessMm / 1000) / (3.7 * diameterM) + 5.74 / Math.pow(reynolds, 0.9)), 2);
      }
      if (frictionFactor != null && lengthM != null && diameterM != null && velocity != null) {
        majorHeadM = frictionFactor * (lengthM / diameterM) * velocity * velocity / (2 * GRAVITY_M_S2);
      }
    } else {
      const kValue = nonNegative(component.fitting_k_value);
      const quantity = positive(component.quantity);
      if (kValue == null) rowReasons.push(`${label}: fitting K-value must be zero or greater.`);
      if (quantity == null) rowReasons.push(`${label}: fitting quantity must be greater than zero.`);
      if (kValue != null && quantity != null && velocity != null) {
        minorHeadM = kValue * quantity * velocity * velocity / (2 * GRAVITY_M_S2);
      }
    }
    reasons.push(...rowReasons);
    return {
      ...component,
      side,
      component_kind: kind,
      sort_order: Number.isInteger(Number(component.sort_order)) ? Number(component.sort_order) : index,
      internal_diameter_mm: diameterMm,
      straight_length_m: kind === 'pipe' ? positive(component.straight_length_m) : null,
      material: kind === 'pipe' ? String(component.material || '').trim() || null : null,
      absolute_roughness_mm: kind === 'pipe' ? nonNegative(component.absolute_roughness_mm) : null,
      fitting_k_value: kind === 'fitting' ? nonNegative(component.fitting_k_value) : null,
      quantity: kind === 'fitting' ? positive(component.quantity) : null,
      velocity_m_s: round(velocity),
      reynolds_number: round(reynolds, 0),
      friction_factor: round(frictionFactor),
      major_head_loss_m: round(majorHeadM),
      minor_head_loss_m: round(minorHeadM),
      total_head_loss_m: round((majorHeadM || 0) + (minorHeadM || 0)),
      pressure_drop_kpa: majorHeadM == null && minorHeadM == null
        ? null
        : round(WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * ((majorHeadM || 0) + (minorHeadM || 0)) / 1000),
      reasons: rowReasons,
    };
  });

  const sideTotals = (['suction', 'discharge'] as FrictionSide[]).reduce((out, side) => {
    const rows = componentResults.filter(component => component.side === side);
    const complete = rows.length > 0 && rows.every(component => component.reasons.length === 0);
    const major = complete ? rows.reduce((sum, component) => sum + Number(component.major_head_loss_m || 0), 0) : null;
    const minor = complete ? rows.reduce((sum, component) => sum + Number(component.minor_head_loss_m || 0), 0) : null;
    out[side] = {
      major_head_loss_m: round(major),
      minor_head_loss_m: round(minor),
      total_head_loss_m: major == null || minor == null ? null : round(major + minor),
      pressure_drop_kpa: major == null || minor == null
        ? null
        : round(WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * (major + minor) / 1000),
    };
    return out;
  }, {} as Record<FrictionSide, any>);
  const combinedHead = sideTotals.suction.total_head_loss_m == null ||
    sideTotals.discharge.total_head_loss_m == null
    ? null
    : sideTotals.suction.total_head_loss_m + sideTotals.discharge.total_head_loss_m;
  const startSurface = startBase == null || startDepth == null ? null : startBase + startDepth;
  const endSurface = endBase == null || endDepth == null ? null : endBase + endDepth;
  const elevationHead = startSurface == null || endSurface == null ? null : endSurface - startSurface;
  const pressureHead = startPressure == null || endPressure == null
    ? null
    : (endPressure - startPressure) * 1000 / (WATER_DENSITY_KG_M3 * GRAVITY_M_S2);
  const staticHead = elevationHead == null || pressureHead == null ? null : elevationHead + pressureHead;
  const totalDynamicHead = combinedHead == null || staticHead == null ? null : combinedHead + staticHead;

  return {
    calculation_version: FRICTION_LOSS_CALCULATION_VERSION,
    calculated_at: input.calculated_at || new Date().toISOString(),
    status: reasons.length ? 'incomplete' : 'ready',
    reasons,
    constants: {
      water_density_kg_m3: WATER_DENSITY_KG_M3,
      water_dynamic_viscosity_pa_s: WATER_DYNAMIC_VISCOSITY_PA_S,
      gravity_m_s2: GRAVITY_M_S2,
    },
    formulas: {
      major: 'h_f = f × (L / D) × (v² / 2g)',
      minor: 'h_m = K × quantity × (v² / 2g)',
      static: 'h_static = (receiving free-surface FL − start free-surface FL) + (receiving gauge pressure − start gauge pressure) / ρg',
      total_dynamic_head: 'TDH = suction friction + discharge friction + static head',
      friction_factor: '64 / Re for laminar flow; Swamee–Jain approximation for turbulent flow',
    },
    inputs: { flow_m3h: flowM3h, selected_pump: input.selected_pump || null, tank_boundaries: boundaries },
    components: componentResults,
    side_totals: sideTotals,
    results: {
      combined_head_loss_m: round(combinedHead),
      combined_pressure_drop_kpa: combinedHead == null
        ? null
        : round(WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * combinedHead / 1000),
      start_free_surface_fl0_m: round(startSurface),
      receiving_free_surface_fl0_m: round(endSurface),
      elevation_static_head_m: round(elevationHead),
      pressure_head_m: round(pressureHead),
      static_head_m: round(staticHead),
      total_dynamic_head_m: round(totalDynamicHead),
    },
  };
}