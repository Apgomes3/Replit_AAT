/**
 * AAT water-side thermal load calculation.
 *
 * The calculation deliberately has no database or HTTP dependencies.  Source
 * records are supplied by the caller and are copied into the returned result
 * so an approved run can be audited without re-reading a mutable project.
 *
 * Sign convention: positive kW is heat entering the water.  Negative
 * convection, radiation, wall transfer, or evaporation is therefore a water
 * heat loss; positive equipment, lighting, or exchange is a water heat gain.
 */

import crypto from 'crypto';

export const THERMAL_CALCULATION_VERSION = 'aat-thermal-load-v3';
export const THERMAL_CONSTRUCTION_BASIS_VERSION = 'aat-thermal-construction-v1';
/**
 * Default wall U-values are governed engineering assumptions, not material
 * conductivity calculations. Keep the basis version and source reference in
 * every result so a saved calculation remains auditable if this table changes.
 */
export const THERMAL_CONSTRUCTION_DEFAULTS = [
  {
    code: 'acrylic',
    label: 'Acrylic',
    u_value_w_m2_k: 5.7,
    units: 'W/m²·K',
    assumption_label: 'Engineering assumption — standard acrylic tank wall',
    basis_version: THERMAL_CONSTRUCTION_BASIS_VERSION,
    source_reference: 'AAT thermal construction assumption basis v1',
  },
  {
    code: 'concrete',
    label: 'Concrete',
    u_value_w_m2_k: 1.5,
    units: 'W/m²·K',
    assumption_label: 'Engineering assumption — standard concrete tank wall',
    basis_version: THERMAL_CONSTRUCTION_BASIS_VERSION,
    source_reference: 'AAT thermal construction assumption basis v1',
  },
  {
    code: 'frp',
    label: 'FRP',
    u_value_w_m2_k: 2.5,
    units: 'W/m²·K',
    assumption_label: 'Engineering assumption — standard FRP tank wall',
    basis_version: THERMAL_CONSTRUCTION_BASIS_VERSION,
    source_reference: 'AAT thermal construction assumption basis v1',
  },
  {
    code: 'steel',
    label: 'Steel',
    u_value_w_m2_k: 5.8,
    units: 'W/m²·K',
    assumption_label: 'Engineering assumption — standard steel tank wall',
    basis_version: THERMAL_CONSTRUCTION_BASIS_VERSION,
    source_reference: 'AAT thermal construction assumption basis v1',
  },
] as const;
export const THERMAL_CONSTANTS = {
  convection_coefficient_w_m2_k: 18,
  emissivity: 0.97,
  stefan_boltzmann_w_m2_k4: 5.670374419e-8,
  inside_film_coefficient_w_m2_k: 150,
  outside_film_coefficient_w_m2_k: 5,
  water_density_kg_m3: 1000,
  water_specific_heat_kj_kg_k: 4.186,
  latent_heat_vaporization_j_kg: 2454000,
  recovery_heating_kw_per_m3: 0.194,
  lighting_coupling_pct_suggested: 85,
} as const;

export const THERMAL_ROUNDING = {
  temperature_c: 1,
  area_m2: 2,
  volume_m3: 3,
  flow_m3h: 2,
  duty_kw: 2,
  percentage: 1,
} as const;

export type ThermalStatus = 'Ready' | 'Blocked' | 'Warning';
export type AgitationClass = string;

export const THERMAL_AGITATION_CLASS_CATALOG = [
  {
    code: 'calm_covered',
    name: 'Calm or Covered',
    description: 'Low surface activity with a covered or otherwise quiet water surface.',
    guidance: 'Choose when the surface is covered or calm, with little water movement and no intentional aeration.',
    sort_order: 10,
  },
  {
    code: 'normal_circulation',
    name: 'Normal Circulation',
    description: 'Typical operating circulation with ordinary surface movement.',
    guidance: 'Choose for normal filtration circulation without sustained aeration, turbulence, or active splashing.',
    sort_order: 20,
  },
  {
    code: 'high_agitation_aerated',
    name: 'High Agitation or Aerated',
    description: 'Strong surface movement caused by aeration, returns, jets, or turbulence.',
    guidance: 'Choose when air or water movement is visibly energetic or aeration is continuous.',
    sort_order: 30,
  },
  {
    code: 'splashing_active',
    name: 'Splashing or Active',
    description: 'Very active water surface with repeated splashing, spray, or unusually vigorous movement.',
    guidance: 'Choose for waterfalls, spray, repeated splashing, or other active surface conditions.',
    sort_order: 40,
  },
] as const;

export interface ThermalCorrelationSnapshot {
  source: 'shared_library' | 'project_deviation' | 'legacy_manual';
  correlation_id?: string | null;
  agitation_class: string;
  version: string | null;
  coefficient_kg_m2_s_kpa: number | null;
  effective_coefficient_kg_m2_s_kpa: number | null;
  approved: boolean;
  deviation: boolean;
  deviation_justification?: string | null;
  source_reference?: string | null;
  notes?: string | null;
  database_defaults?: Record<string, any> | null;
  effective_values?: Record<string, any> | null;
  overrides?: Record<string, boolean> | null;
  coefficient_basis?: string | null;
  captured_at?: string | null;
}

export function isApprovedThermalCorrelationSnapshot(snapshot: any): boolean {
  const sourceIsGoverned = snapshot?.source === 'shared_library' ||
    snapshot?.source === 'project_deviation';
  const coefficient = Number(snapshot?.coefficient_kg_m2_s_kpa);
  const effectiveCoefficient = Number(snapshot?.effective_coefficient_kg_m2_s_kpa);
  const deviationIsJustified = snapshot?.deviation !== true ||
    !!String(snapshot?.deviation_justification || '').trim();
  return sourceIsGoverned &&
    !!String(snapshot?.correlation_id || '').trim() &&
    !!String(snapshot?.agitation_class || '').trim() &&
    !!String(snapshot?.version || '').trim() &&
    snapshot?.approved === true &&
    Number.isFinite(coefficient) && coefficient > 0 &&
    Number.isFinite(effectiveCoefficient) && effectiveCoefficient > 0 &&
    deviationIsJustified;
}

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const positive = (value: unknown): number | null => {
  const parsed = finite(value);
  return parsed != null && parsed > 0 ? parsed : null;
};

const nonNegative = (value: unknown): number | null => {
  const parsed = finite(value);
  return parsed != null && parsed >= 0 ? parsed : null;
};

const round = (value: number | null, decimals: number) =>
  value == null || !Number.isFinite(value) ? null : Number(value.toFixed(decimals));

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function thermalFingerprint(value: any): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function celsiusToKelvin(value: number) {
  return value + 273.15;
}

/** Buck saturation vapour pressure, returned in kPa. */
export function saturationVapourPressureKpa(temperatureC: number): number {
  return 0.61078 * Math.exp((17.2694 * temperatureC) / (temperatureC + 237.29));
}

export function humidityRatio(temperatureC: number, relativeHumidityPct: number, pressureKpa: number) {
  const vapourPressure = saturationVapourPressureKpa(temperatureC) * relativeHumidityPct / 100;
  if (!(pressureKpa > vapourPressure)) return null;
  return 0.62198 * vapourPressure / (pressureKpa - vapourPressure);
}

function sumNumber(values: Array<number | null>) {
  return values.reduce<number>((sum, value) => sum + (value || 0), 0);
}

function tankGeometry(tank: any) {
  const shape = String(tank?.eff_shape || tank?.shape_type || '').toLowerCase();
  const freeSurface = positive(
    tank?.free_surface_area_m2 ?? tank?.water_surface_area_m2 ?? tank?.surface_area_m2,
  );
  const quantity = Math.max(1, Number.parseInt(String(tank?.quantity ?? 1), 10) || 1);
  const length = positive(tank?.inner_length_mm ?? tank?.eff_length_mm ?? tank?.length_mm);
  const width = positive(tank?.inner_width_mm ?? tank?.eff_width_mm ?? tank?.width_mm);
  const waterHeight = positive(
    tank?.water_depth_mm ?? tank?.eff_water_level_mm ?? tank?.design_water_level_mm ??
    tank?.inner_height_mm ?? tank?.eff_height_mm ?? tank?.height_mm,
  );
  let wallArea = positive(tank?.exposed_wall_area_m2 ?? tank?.wall_area_m2);
  let wallSource = wallArea != null ? 'tank saved exposed wall area' : null;
  if (wallArea == null && shape === 'cylindrical' && width != null && waterHeight != null) {
    wallArea = Math.PI * width * waterHeight / 1e6;
    wallSource = 'cylindrical diameter × water height';
  } else if (wallArea == null && shape !== 'custom' && length != null && width != null && waterHeight != null) {
    wallArea = 2 * (length + width) * waterHeight / 1e6;
    wallSource = 'rectangular inner perimeter × water height';
  }
  const volume = positive(
    tank?.effective_operating_volume_m3 ?? tank?.design_volume_m3 ??
    tank?.operating_volume_m3 ?? tank?.project_operating_volume_m3,
  );
  return {
    tank_id: tank?.id || null,
    tank_code: tank?.tank_code || null,
    quantity,
    shape: shape || null,
    effective_water_volume_m3: volume == null ? null : volume * quantity,
    free_surface_area_m2: freeSurface == null ? null : freeSurface * quantity,
    exposed_wall_area_m2: wallArea == null ? null : wallArea * quantity,
    volume_source: tank?.effective_operating_volume_m3 != null
      ? 'effective exhibit operating volume'
      : volume != null ? 'tank operating volume' : 'missing',
    free_surface_source: freeSurface != null
      ? (tank?.free_surface_area_m2 != null || tank?.water_surface_area_m2 != null
        ? 'tank saved free-surface area' : 'tank saved water-surface area')
      : 'missing',
    exposed_wall_source: wallSource || (shape === 'custom' ? 'custom geometry requires reviewed wall area' : 'missing'),
    dimensions: {
      inner_length_mm: length,
      inner_width_mm: width,
      water_height_mm: waterHeight,
    },
  };
}

/**
 * Convert current project relationships into an auditable thermal source.
 * `exhibitCalculations` should be the same current hydraulic calculations used
 * by the Design Book endpoint.
 */
export function buildThermalSourceContext(args: {
  system: any;
  links: any[];
  exhibits: any[];
  tanks: any[];
  exhibitCalculations?: any[];
}) {
  const { system, links = [], exhibits = [], tanks = [], exhibitCalculations = [] } = args;
  const linkedExhibitIds = links.map(link => link.exhibit_id).filter(Boolean);
  const duplicateExhibitIds = [...new Set(
    linkedExhibitIds.filter((id, index) => linkedExhibitIds.indexOf(id) !== index),
  )];
  const linkedExhibits = linkedExhibitIds.map(id => exhibits.find(exhibit => exhibit.id === id) || {
    id, missing: true,
  });
  const linkedTanks = tanks
    .filter(tank => linkedExhibitIds.includes(tank.exhibit_id))
    .map(tank => ({
        ...tankGeometry(tank),
        exhibit_id: tank.exhibit_id || null,
        exhibit_code: linkedExhibits.find(exhibit => exhibit.id === tank.exhibit_id)?.exhibit_code || null,
      }));
  const exhibitTemperatures = linkedExhibits.map(exhibit => ({
    exhibit_id: exhibit.id || null,
    exhibit_code: exhibit.exhibit_code || null,
    water_temperature_min_c: finite(exhibit.design_temperature_min),
    water_temperature_max_c: finite(exhibit.design_temperature_max),
    water_temperature_range_status:
      finite(exhibit.design_temperature_min) == null || finite(exhibit.design_temperature_max) == null
        ? (exhibit.design_temperature_min == null || exhibit.design_temperature_min === '' ||
          exhibit.design_temperature_max == null || exhibit.design_temperature_max === ''
          ? 'incomplete' : 'invalid')
        : finite(exhibit.design_temperature_min)! > finite(exhibit.design_temperature_max)!
          ? 'invalid' : 'valid',
    water_type: exhibit.water_type || null,
  }));
  const circulationFlows = linkedExhibitIds.map(exhibitId => {
    const calc = exhibitCalculations.find(item => item.inputs?.exhibit_id === exhibitId);
    return {
      exhibit_id: exhibitId,
      flow_m3h: finite(calc?.results?.total_return_flow_m3h),
      source: 'LSS/exhibit hydraulic calculation',
    };
  });
  const effectiveVolumeSources = linkedExhibitIds.map(exhibitId => {
    const calc = exhibitCalculations.find(item => item.inputs?.exhibit_id === exhibitId);
    return {
      exhibit_id: exhibitId,
      effective_water_volume_m3: finite(calc?.results?.operating_volume_m3),
      calculation_version: calc?.calculation_version || null,
      status: calc?.status || 'missing',
      freshness: calc?.freshness || null,
      source: 'Design Book exhibit effective operating-volume calculation',
    };
  });
  const source = {
    system_id: system?.id || null,
    system_code: system?.system_code || null,
    system_name: system?.system_name || null,
    linked_exhibits: linkedExhibits,
    linked_tanks: linkedTanks,
    water_temperature_sources: exhibitTemperatures,
    effective_volume_sources: effectiveVolumeSources,
    circulation_flows: circulationFlows,
    lss_circulation_flow_m3h: finite(system?.design_flow_m3h),
    duplicate_exhibit_ids: duplicateExhibitIds,
  };
  return { ...source, fingerprint: thermalFingerprint(source) };
}

function resolveWaterTemperature(source: any, inputs: any, reasons: string[]) {
  const overrideValues = [
    inputs.reviewed_water_temperature_c,
    inputs.water_temperature_c,
  ].filter(value => value !== null && value !== undefined && value !== '');
  const reviewedOverride = finite(inputs.reviewed_water_temperature_c);
  const legacyOverride = finite(inputs.water_temperature_c);
  const overrideIsInvalid = overrideValues.length > 0 &&
    reviewedOverride == null && legacyOverride == null;
  if (overrideIsInvalid) {
    reasons.push('Reviewed water-temperature override must be a finite value.');
  }
  let overrideIsConflicting = false;
  if (reviewedOverride != null && legacyOverride != null &&
      Math.abs(reviewedOverride - legacyOverride) > 1e-9) {
    reasons.push('Reviewed water-temperature overrides conflict; provide one reviewed value.');
    overrideIsConflicting = true;
  }
  const override = reviewedOverride ?? legacyOverride;
  const records = source.water_temperature_sources || [];
  if (!records.length) {
    reasons.push('No linked exhibit provides a water design-temperature range.');
    return { value: null, source: 'missing', reviewed_override_used: false };
  }
  if (records.some((item: any) => item.water_temperature_range_status === 'invalid' ||
      (item.water_temperature_min_c != null && item.water_temperature_max_c != null &&
        item.water_temperature_min_c > item.water_temperature_max_c))) {
    reasons.push('Every linked exhibit must provide a valid water design-temperature range with minimum no greater than maximum.');
    return { value: null, source: 'invalid linked exhibit temperature range', reviewed_override_used: false };
  }
  if (records.some((item: any) => item.water_temperature_min_c == null || item.water_temperature_max_c == null)) {
    reasons.push('Every linked exhibit must provide both minimum and maximum water design temperature.');
    return { value: null, source: 'incomplete linked exhibit temperatures', reviewed_override_used: false };
  }
  const first = records[0];
  const same = records.every((item: any) =>
    Math.abs(item.water_temperature_min_c - first.water_temperature_min_c) < 1e-9 &&
    Math.abs(item.water_temperature_max_c - first.water_temperature_max_c) < 1e-9);
  if (!same) {
    reasons.push('Linked exhibits have conflicting water design temperatures; resolve the linked source range before calculating.');
    return { value: null, source: 'conflicting linked exhibit temperatures', reviewed_override_used: false };
  }
  const average = (first.water_temperature_min_c + first.water_temperature_max_c) / 2;
  if (overrideIsInvalid || overrideIsConflicting) {
    return {
      value: null,
      source: overrideIsConflicting
        ? 'conflicting reviewed water-temperature overrides'
        : 'invalid reviewed water-temperature override',
      minimum_c: first.water_temperature_min_c,
      maximum_c: first.water_temperature_max_c,
      average_c: average,
      reviewed_override_used: false,
    };
  }
  if (override != null) {
    return {
      value: override,
      source: 'system reviewed water-temperature override',
      minimum_c: first.water_temperature_min_c,
      maximum_c: first.water_temperature_max_c,
      average_c: average,
      reviewed_override_used: true,
    };
  }
  return {
    value: average,
    source: 'linked exhibit design-temperature range average',
    minimum_c: first.water_temperature_min_c,
    maximum_c: first.water_temperature_max_c,
    average_c: average,
    reviewed_override_used: false,
  };
}

function resolveWallUValue(inputs: any, reasons: string[]) {
  const rawConstruction = String(
    inputs.tank_construction_type ?? inputs.tank_construction ?? '',
  ).trim().toLowerCase();
  const construction = THERMAL_CONSTRUCTION_DEFAULTS.find(item => item.code === rawConstruction);
  if (rawConstruction && !construction) {
    reasons.push('Tank construction must be Acrylic, Concrete, FRP, or Steel.');
  }
  const reviewedRaw = inputs.reviewed_u_value_w_m2_k;
  const reviewed = positive(reviewedRaw);
  if (reviewedRaw !== null && reviewedRaw !== undefined && reviewedRaw !== '' && reviewed == null) {
    reasons.push('Reviewed wall U-value must be a positive finite value.');
  }
  if (reviewed != null) {
    return {
      value: reviewed,
      source: 'reviewed custom U-value',
      construction: construction || null,
      reviewed: true,
      assumption_label: 'Reviewed engineering value — custom wall U-value',
      basis_version: null,
      source_reference: null,
    };
  }
  if (construction) {
    return {
      value: construction.u_value_w_m2_k,
      source: 'assumed tank construction U-value',
      construction,
      reviewed: false,
      assumption_label: construction.assumption_label,
      basis_version: construction.basis_version,
      source_reference: construction.source_reference,
    };
  }
  const layers = Array.isArray(inputs.tank_wall_layers) ? inputs.tank_wall_layers : [];
  const validLayers = layers.map((layer: any) => ({
    material: String(layer?.material || '').trim(),
    thickness_m: positive(layer?.thickness_mm) == null ? null : Number(layer.thickness_mm) / 1000,
    conductivity_w_m_k: positive(layer?.conductivity_w_m_k),
  }));
  if (!validLayers.length) {
    if (!rawConstruction) reasons.push('Select a tank construction, enter wall layers, or provide a reviewed U-value before calculating.');
    return { value: null, source: 'missing wall construction' };
  }
  if (validLayers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null)) {
    reasons.push('Every tank wall layer requires material, positive thickness, and positive conductivity.');
    return { value: null, source: 'incomplete wall construction' };
  }
  const resistance = 1 / THERMAL_CONSTANTS.inside_film_coefficient_w_m2_k +
    validLayers.reduce((sum: number, layer: any) => sum + layer.thickness_m / layer.conductivity_w_m_k, 0) +
    1 / THERMAL_CONSTANTS.outside_film_coefficient_w_m2_k;
  return {
    value: 1 / resistance,
    source: 'film coefficients plus wall-layer resistance',
    construction: construction || null,
    reviewed: true,
    assumption_label: 'Reviewed engineering value — explicit wall-layer construction',
    basis_version: null,
    source_reference: null,
    layers: validLayers,
  };
}

function correlationFor(inputs: any, agitationClass = inputs.agitation_class) {
  const snapshot = inputs.agitation_correlation_snapshot;
  if (snapshot && snapshot.agitation_class === agitationClass) {
    return {
      class: snapshot.agitation_class,
      coefficient_kg_m2_s_kpa: snapshot.effective_coefficient_kg_m2_s_kpa ??
        snapshot.coefficient_kg_m2_s_kpa,
      version: snapshot.version,
      approved: snapshot.approved === true,
      deviation: snapshot.deviation === true,
      deviation_justification: snapshot.deviation_justification || inputs.deviation_justification,
      source: snapshot.source,
      correlation_id: snapshot.correlation_id,
    };
  }
  const configured = inputs.agitation_correlations || inputs.agitation_correlation;
  if (configured && configured[agitationClass]) return configured[agitationClass];
  if (configured && configured.class === agitationClass) return configured;
  if (inputs.agitation_correlation_class === agitationClass && inputs.evaporation_coefficient_kg_m2_s_kpa != null) {
    return {
      class: agitationClass,
      coefficient_kg_m2_s_kpa: inputs.evaporation_coefficient_kg_m2_s_kpa,
      version: inputs.agitation_correlation_version,
      approved: inputs.agitation_correlation_approved,
      deviation: inputs.agitation_correlation_deviation,
    };
  }
  return null;
}

function correlationProblems(correlation: any, inputs: any) {
  const problems: string[] = [];
  if (!correlation || positive(correlation.coefficient_kg_m2_s_kpa) == null) {
    problems.push('requires a positive mass-transfer coefficient');
  }
  if (!correlation?.version) problems.push('requires an explicit version');
  if (correlation?.approved !== true) problems.push('requires explicit approval');
  if (correlation?.deviation &&
    !String(correlation.deviation_justification || inputs.deviation_justification || '').trim()) {
    problems.push('requires a deviation justification');
  }
  return problems;
}

function resolvedWallArea(tank: any, inputs: any) {
  return positive(tank.exposed_wall_area_m2) ??
    positive(inputs.custom_tank_wall_areas_m2?.[tank.tank_id]);
}

function validateCommonInputs(source: any, inputs: any, reasons: string[]) {
  if (!source?.linked_exhibits?.length) reasons.push('Link at least one exhibit to this LSS system before calculating thermal loads.');
  if (source?.duplicate_exhibit_ids?.length) reasons.push('Duplicate exhibit links must be removed before calculating thermal loads.');
  if (source?.linked_exhibits?.some((exhibit: any) => exhibit.missing)) reasons.push('A linked exhibit no longer exists in the current project.');
  const ambient = finite(inputs.ambient_air_temperature_c);
  const humidity = finite(inputs.relative_humidity_pct);
  const pressure = positive(inputs.atmospheric_pressure_kpa);
  if (ambient == null) reasons.push('Ambient air temperature is required.');
  if (humidity == null || humidity < 0 || humidity > 100) reasons.push('Relative humidity must be between 0% and 100%.');
  if (pressure == null) reasons.push('Atmospheric pressure must be greater than zero.');
  const water = resolveWaterTemperature(source, inputs, reasons);
  if (water.value != null && ambient != null && pressure != null) {
    const airVapour = saturationVapourPressureKpa(ambient) * (humidity || 0) / 100;
    if (pressure <= airVapour) reasons.push('Atmospheric pressure must exceed ambient water-vapour pressure.');
  }
  const geometry = source.linked_tanks || [];
  if (!geometry.length) reasons.push('No tanks are linked through the current system exhibits.');
  const effectiveVolumes = source.effective_volume_sources || [];
  if (effectiveVolumes.length !== source.linked_exhibits?.length ||
      effectiveVolumes.some((item: any) => item.effective_water_volume_m3 == null ||
        item.effective_water_volume_m3 <= 0 || item.status === 'invalid' ||
        item.freshness === 'stale')) {
    reasons.push('Every linked exhibit requires a current positive effective operating-volume calculation.');
  }
  if (geometry.some((tank: any) => tank.free_surface_area_m2 == null || tank.free_surface_area_m2 <= 0)) {
    reasons.push('Every linked tank requires a positive free-surface area.');
  }
  if (geometry.some((tank: any) => resolvedWallArea(tank, inputs) == null)) {
    reasons.push('Every linked tank requires a positive exposed wall area; custom geometry needs a reviewed wall-area input.');
  }
  const wall = resolveWallUValue(inputs, reasons);
  const agitation = String(inputs.agitation_class || '').trim();
  if (!agitation) reasons.push('Select an agitation class.');
  const correlation = agitation ? correlationFor(inputs, agitation) : null;
  if (!correlation || positive(correlation.coefficient_kg_m2_s_kpa) == null) {
    reasons.push('Configure a versioned evaporation correlation coefficient for the selected agitation class; the manual does not supply one automatically.');
  } else {
    if (!correlation.version) reasons.push('Evaporation correlation data must have an explicit version.');
    if (correlation.approved !== true) reasons.push('Evaporation correlation data must be explicitly approved before a result can be Ready.');
    if (correlation.deviation && !String(inputs.deviation_justification || '').trim()) {
      reasons.push('Provide a deviation justification for the non-standard evaporation correlation.');
    }
  }
  const lightingPower = nonNegative(inputs.lighting_power_kw);
  const equipment = nonNegative(inputs.equipment_heat_gain_kw);
  const margin = nonNegative(inputs.capacity_margin_pct);
  if (inputs.equipment_heat_gain_kw != null && equipment == null) reasons.push('Equipment heat gain must be a non-negative finite value.');
  if (inputs.lighting_power_kw != null && lightingPower == null) reasons.push('Lighting power must be non-negative.');
  if (margin == null) reasons.push('Capacity margin must be a non-negative percentage.');
  if (inputs.water_exchange_enabled) {
    if (positive(inputs.water_exchange_flow_m3h) == null) reasons.push('Enabled water exchange requires a positive exchange flow.');
    if (finite(inputs.water_exchange_inlet_temperature_c) == null) reasons.push('Enabled water exchange requires an inlet water temperature.');
  }
  return {
    ambient,
    humidity,
    pressure,
    water,
    wall,
    correlation,
    agitation,
    lightingPower: lightingPower || 0,
    equipment: equipment || 0,
    margin: margin || 0,
  };
}

function calculateCase(source: any, inputs: any, factors = { surface: 1, evaporation: 1, correlation: null as any }) {
  const reasons: string[] = [];
  const common = validateCommonInputs(source, inputs, reasons);
  const waterTemperature = common.water.value;
  const volume = sumNumber((source.effective_volume_sources || []).map(
    (item: any) => finite(item.effective_water_volume_m3),
  ));
  const freeSurface = sumNumber((source.linked_tanks || []).map((tank: any) => finite(tank.free_surface_area_m2))) * factors.surface;
  const wallArea = sumNumber((source.linked_tanks || []).map(
    (tank: any) => resolvedWallArea(tank, inputs),
  )) * factors.surface;
  const uValue = common.wall.value;
  const correlation = factors.correlation || common.correlation;
  if (factors.correlation) {
    const sensitivityCorrelationProblems = correlationProblems(factors.correlation, inputs);
    if (sensitivityCorrelationProblems.length) {
      reasons.push(`Sensitivity agitation correlation ${sensitivityCorrelationProblems.join(', ')}.`);
    }
  }
  const surfaceTemperature = finite(inputs.surrounding_surface_temperature_c) ?? common.ambient;
  if (surfaceTemperature == null) reasons.push('Surrounding-surface temperature is required.');
  const evaporationCoefficient = positive(correlation?.coefficient_kg_m2_s_kpa);
  const airHumidityRatio = common.ambient == null || common.humidity == null || common.pressure == null
    ? null : humidityRatio(common.ambient, common.humidity, common.pressure);
  const waterHumidityRatio = waterTemperature == null || common.pressure == null
    ? null : humidityRatio(waterTemperature, 100, common.pressure);
  const deltaHumidityRatio = airHumidityRatio == null || waterHumidityRatio == null
    ? null : waterHumidityRatio - airHumidityRatio;
  const deltaVapourPressure = common.ambient == null || waterTemperature == null || common.humidity == null
    ? null
    : saturationVapourPressureKpa(waterTemperature) -
      saturationVapourPressureKpa(common.ambient) * common.humidity / 100;
  const convection = waterTemperature == null || common.ambient == null
    ? null : THERMAL_CONSTANTS.convection_coefficient_w_m2_k * freeSurface *
      (common.ambient - waterTemperature) / 1000;
  const radiation = waterTemperature == null || surfaceTemperature == null
    ? null : THERMAL_CONSTANTS.emissivity * THERMAL_CONSTANTS.stefan_boltzmann_w_m2_k4 *
      freeSurface * (Math.pow(celsiusToKelvin(surfaceTemperature), 4) -
        Math.pow(celsiusToKelvin(waterTemperature), 4)) / 1000;
  const wallConduction = waterTemperature == null || common.ambient == null || uValue == null
    ? null : uValue * wallArea * (common.ambient - waterTemperature) / 1000;
  const evaporation = evaporationCoefficient == null || deltaVapourPressure == null
    ? null : -evaporationCoefficient * freeSurface * Math.max(0, deltaVapourPressure) *
      THERMAL_CONSTANTS.latent_heat_vaporization_j_kg / 1000 * factors.evaporation;
  const lightingCoupling = finite(inputs.lighting_coupling_pct) ?? THERMAL_CONSTANTS.lighting_coupling_pct_suggested;
  if (lightingCoupling < 0 || lightingCoupling > 100) reasons.push('Lighting coupling must be between 0% and 100%.');
  const lighting = common.lightingPower * (lightingCoupling / 100);
  const exchangeFlow = inputs.water_exchange_enabled ? positive(inputs.water_exchange_flow_m3h) : 0;
  const exchangeInlet = inputs.water_exchange_enabled ? finite(inputs.water_exchange_inlet_temperature_c) : null;
  const exchange = exchangeFlow && exchangeInlet != null && waterTemperature != null
    ? exchangeFlow * THERMAL_CONSTANTS.water_density_kg_m3 *
      THERMAL_CONSTANTS.water_specific_heat_kj_kg_k * (exchangeInlet - waterTemperature) / 3600
    : 0;
  const contributions = {
    convection_kw: convection,
    radiation_kw: radiation,
    wall_conduction_kw: wallConduction,
    evaporation_kw: evaporation,
    equipment_kw: common.equipment,
    lighting_kw: lighting,
    water_exchange_kw: exchange,
  };
  const envelope = sumNumber(Object.values({
    convection,
    radiation,
    wall: wallConduction,
    evaporation,
  }));
  const total = envelope + common.equipment + lighting + exchange;
  const recovery = volume > 0 ? THERMAL_CONSTANTS.recovery_heating_kw_per_m3 * volume : null;
  if (recovery == null) reasons.push('Recovery heating requires a positive effective water volume.');
  const marginFactor = 1 + common.margin / 100;
  const waterTemperatureBasis = {
    source: common.water.source,
    minimum_c: common.water.minimum_c ?? null,
    maximum_c: common.water.maximum_c ?? null,
    average_c: common.water.average_c ?? null,
    calculated_temperature_c: waterTemperature,
    reviewed_override_used: common.water.reviewed_override_used === true,
  };
  const wallConstructionBasis = {
    construction_type: common.wall.construction?.code || null,
    construction_label: common.wall.construction?.label || null,
    u_value_w_m2_k: uValue,
    units: 'W/m²·K',
    source: common.wall.source,
    reviewed: common.wall.reviewed === true,
    assumption_label: common.wall.assumption_label || null,
    basis_version: common.wall.basis_version || null,
    source_reference: common.wall.source_reference || null,
    layers: common.wall.layers || null,
  };
  return {
    status: reasons.length ? 'Blocked' as ThermalStatus : 'Ready' as ThermalStatus,
    reasons,
    water_temperature_basis: waterTemperatureBasis,
    wall_construction_basis: wallConstructionBasis,
    contributions,
    results: {
      effective_water_volume_m3: volume,
      free_surface_area_m2: freeSurface,
      exposed_wall_area_m2: wallArea,
      wall_u_value_w_m2_k: uValue,
      wall_construction_type: wallConstructionBasis.construction_type,
      wall_construction_source: wallConstructionBasis.source,
      wall_construction_basis_version: wallConstructionBasis.basis_version,
      water_temperature_c: waterTemperature,
      water_temperature_source: common.water.source,
      water_temperature_min_c: waterTemperatureBasis.minimum_c,
      water_temperature_max_c: waterTemperatureBasis.maximum_c,
      water_temperature_average_c: waterTemperatureBasis.average_c,
      water_temperature_reviewed_override: waterTemperatureBasis.reviewed_override_used,
      circulation_flow_m3h: finite(source.lss_circulation_flow_m3h),
      circulation_flow_is_reference_only: true,
      operational_water_exchange_flow_m3h: exchangeFlow || 0,
      net_envelope_kw: envelope,
      net_total_load_kw: total,
      required_cooling_kw: Math.max(0, total),
      steady_state_heating_kw: Math.max(0, -total),
      recovery_heating_kw: recovery,
      total_heating_kw: recovery == null ? null : Math.max(0, -total) + recovery,
      margin_adjusted_cooling_kw: Math.max(0, total) * marginFactor,
      margin_adjusted_heating_kw: recovery == null ? null : (Math.max(0, -total) + recovery) * marginFactor,
    },
    formula_inputs: {
      ambient_air_temperature_c: common.ambient,
      relative_humidity_pct: common.humidity,
      surrounding_surface_temperature_c: surfaceTemperature,
      atmospheric_pressure_kpa: common.pressure,
      agitation_class: common.agitation,
      evaporation_coefficient_kg_m2_s_kpa: evaporationCoefficient,
      delta_humidity_ratio: deltaHumidityRatio,
      delta_vapour_pressure_kpa: deltaVapourPressure,
      lighting_power_kw: common.lightingPower,
      lighting_coupling_pct: lightingCoupling,
      equipment_heat_gain_kw: common.equipment,
      capacity_margin_pct: common.margin,
      water_exchange_enabled: !!inputs.water_exchange_enabled,
      evaporation_correlation_basis: inputs.agitation_correlation_snapshot || {
        source: 'legacy_manual',
        agitation_class: common.agitation,
        version: correlation?.version || null,
        effective_values: {
          coefficient_kg_m2_s_kpa: evaporationCoefficient,
        },
      },
      water_temperature_basis: waterTemperatureBasis,
      wall_construction_basis: wallConstructionBasis,
    },
  };
}

function adjacentCases(source: any, inputs: any) {
  const configured = inputs.agitation_correlations || inputs.agitation_correlation;
  const classes = configured && !Array.isArray(configured)
    ? Object.keys(configured)
    : Array.isArray(inputs.adjacent_agitation_classes) ? inputs.adjacent_agitation_classes : [];
  return classes
    .filter(value => value !== inputs.agitation_class && correlationFor(inputs, value))
    .slice(0, 2);
}

export function calculateThermalCalculation(source: any, inputs: any = {}, calculatedAt = new Date().toISOString()) {
  const normalizedInputs = {
    relative_humidity_pct: 60,
    surrounding_surface_temperature_c: inputs.ambient_air_temperature_c ?? null,
    lighting_coupling_pct: THERMAL_CONSTANTS.lighting_coupling_pct_suggested,
    atmospheric_pressure_kpa: 101.325,
    capacity_margin_pct: 10,
    equipment_heat_gain_kw: 0,
    lighting_power_kw: 0,
    water_exchange_enabled: false,
    ...inputs,
  };
  if (normalizedInputs.surrounding_surface_temperature_c == null) {
    normalizedInputs.surrounding_surface_temperature_c = normalizedInputs.ambient_air_temperature_c ?? null;
  }
  const base = calculateCase(source, normalizedInputs);
  normalizedInputs.water_temperature_basis = base.water_temperature_basis;
  normalizedInputs.wall_construction_basis = base.wall_construction_basis;
  const sensitivityCases: any[] = [];
  for (const factor of [-0.1, 0.1]) {
    const result = calculateCase(source, normalizedInputs, { surface: 1 + factor, evaporation: 1, correlation: null });
    sensitivityCases.push({
      case_key: `surface_${factor < 0 ? 'minus' : 'plus'}_10_pct`,
      description: `Free-surface and exposed-wall area ${factor < 0 ? '−' : '+'}10%`,
      results: result.results,
      status: result.status,
    });
  }
  for (const factor of [-0.15, 0.15]) {
    const result = calculateCase(source, normalizedInputs, { surface: 1, evaporation: 1 + factor, correlation: null });
    sensitivityCases.push({
      case_key: `evaporation_${factor < 0 ? 'minus' : 'plus'}_${Math.abs(factor * 100)}_pct`,
      description: `Evaporation rate ${factor < 0 ? '−' : '+'}${Math.abs(factor * 100)}%`,
      results: result.results,
      status: result.status,
    });
  }
  for (const agitation of adjacentCases(source, normalizedInputs)) {
    const result = calculateCase(source, normalizedInputs, {
      surface: 1,
      evaporation: 1,
      correlation: correlationFor(normalizedInputs, agitation),
    });
    sensitivityCases.push({
      case_key: `agitation_${agitation}`,
      description: `Adjacent agitation class: ${agitation}`,
      results: result.results,
      status: result.status,
    });
  }
  const allCases = [
    { case_key: 'base', description: 'Base calculation', results: base.results, status: base.status },
    ...sensitivityCases,
  ];
  const reasonable = allCases.filter(item => item.status === 'Ready').reduce<any | null>((selected, item) => {
    if (!selected) return item;
    const selectedCapacity = Math.max(selected.results.margin_adjusted_cooling_kw || 0, selected.results.margin_adjusted_heating_kw || 0);
    const capacity = Math.max(item.results.margin_adjusted_cooling_kw || 0, item.results.margin_adjusted_heating_kw || 0);
    return capacity > selectedCapacity ? item : selected;
  }, null);
  return {
    calculation_version: THERMAL_CALCULATION_VERSION,
    calculated_at: calculatedAt,
    status: base.status,
    freshness: 'fresh',
    is_stale: false,
    source_fingerprint: source.fingerprint || thermalFingerprint(source),
    source_snapshot: source,
    inputs: normalizedInputs,
    correlation_snapshot: normalizedInputs.agitation_correlation_snapshot || null,
    constants: THERMAL_CONSTANTS,
    formula: 'Qpositive-to-water = convection + radiation + wall conduction + evaporation + equipment + lighting + water exchange; recovery heating = 0.194 kW/m³ × effective water volume for 1°C in 6 hours.',
    sign_convention: 'Positive kW enters the water; negative kW removes heat from the water.',
    rounding: 'Internal calculations use full-precision SI values. Display temperatures use 1°C, areas 0.01 m², volumes 0.001 m³, flows 0.01 m³/h, duties 0.01 kW, and percentages 0.1%.',
    reasons: base.reasons,
    water_temperature_basis: base.water_temperature_basis,
    wall_construction_basis: base.wall_construction_basis,
    formula_inputs: base.formula_inputs,
    contributions: base.contributions,
    results: base.results,
    sensitivity_cases: sensitivityCases,
    sensitivity_summary: {
      recommended_case: reasonable?.case_key || null,
      recommended_description: reasonable?.description || null,
      cases: allCases.map(item => ({
        case_key: item.case_key,
        description: item.description,
        margin_adjusted_cooling_kw: item.results.margin_adjusted_cooling_kw,
        margin_adjusted_heating_kw: item.results.margin_adjusted_heating_kw,
        status: item.status,
      })),
    },
  };
}

export function thermalDisplayValue(value: number | null, kind: keyof typeof THERMAL_ROUNDING) {
  return round(value, THERMAL_ROUNDING[kind]);
}
