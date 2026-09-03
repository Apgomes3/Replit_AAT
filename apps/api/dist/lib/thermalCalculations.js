"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.THERMAL_AGITATION_CLASS_CATALOG = exports.THERMAL_ROUNDING = exports.THERMAL_CONSTANTS = exports.THERMAL_CONSTRUCTION_DEFAULTS = exports.THERMAL_CONSTRUCTION_BASIS_VERSION = exports.THERMAL_CALCULATION_VERSION = void 0;
exports.isApprovedThermalCorrelationSnapshot = isApprovedThermalCorrelationSnapshot;
exports.thermalFingerprint = thermalFingerprint;
exports.saturationVapourPressureKpa = saturationVapourPressureKpa;
exports.humidityRatio = humidityRatio;
exports.buildThermalSourceContext = buildThermalSourceContext;
exports.calculateThermalCalculation = calculateThermalCalculation;
exports.thermalDisplayValue = thermalDisplayValue;
const crypto_1 = __importDefault(require("crypto"));
exports.THERMAL_CALCULATION_VERSION = 'aat-thermal-load-v7';
exports.THERMAL_CONSTRUCTION_BASIS_VERSION = 'AAT_FOUNDATIONS_WALL_V1.0';
/**
 * These are provisional AAT Foundations starter values. The database seed
 * stores the same values with approval metadata; this catalogue is deliberately
 * kept as a safe calculation/test fallback for legacy databases and previews.
 */
exports.THERMAL_CONSTRUCTION_DEFAULTS = [
    {
        code: 'acrylic',
        label: 'Acrylic',
        material: 'Acrylic / PMMA',
        thickness_mm: 12,
        conductivity_w_m_k: 0.19,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source_basis: 'AAT Foundations',
        source_reference: 'AAT Foundations wall construction starter defaults',
        notes: 'Provisional starter default; confirm project-specific construction with the responsible engineer.',
        assumption_label: 'Provisional AAT Foundations starter default — acrylic / PMMA wall',
        basis_version: exports.THERMAL_CONSTRUCTION_BASIS_VERSION,
    },
    {
        code: 'concrete',
        label: 'Concrete',
        material: 'Reinforced concrete',
        thickness_mm: 150,
        conductivity_w_m_k: 1.4,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source_basis: 'AAT Foundations',
        source_reference: 'AAT Foundations wall construction starter defaults',
        notes: 'Provisional starter default; confirm project-specific construction with the responsible engineer.',
        assumption_label: 'Provisional AAT Foundations starter default — reinforced concrete wall',
        basis_version: exports.THERMAL_CONSTRUCTION_BASIS_VERSION,
    },
    {
        code: 'frp',
        label: 'FRP',
        material: 'FRP / GRP laminate',
        thickness_mm: 6,
        conductivity_w_m_k: 0.25,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source_basis: 'AAT Foundations',
        source_reference: 'AAT Foundations wall construction starter defaults',
        notes: 'Provisional starter default; confirm project-specific construction with the responsible engineer.',
        assumption_label: 'Provisional AAT Foundations starter default — FRP / GRP laminate wall',
        basis_version: exports.THERMAL_CONSTRUCTION_BASIS_VERSION,
    },
    {
        code: 'steel',
        label: 'Steel',
        material: 'Stainless steel 316L',
        thickness_mm: 3,
        conductivity_w_m_k: 14,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source_basis: 'AAT Foundations',
        source_reference: 'AAT Foundations wall construction starter defaults',
        notes: 'Provisional starter default; confirm project-specific construction with the responsible engineer.',
        assumption_label: 'Provisional AAT Foundations starter default — stainless steel 316L wall',
        basis_version: exports.THERMAL_CONSTRUCTION_BASIS_VERSION,
    },
];
exports.THERMAL_CONSTANTS = {
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
};
exports.THERMAL_ROUNDING = {
    temperature_c: 1,
    area_m2: 2,
    volume_m3: 3,
    flow_m3h: 2,
    duty_kw: 2,
    percentage: 1,
};
exports.THERMAL_AGITATION_CLASS_CATALOG = [
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
];
function isApprovedThermalCorrelationSnapshot(snapshot) {
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
const finite = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value) => {
    const parsed = finite(value);
    return parsed != null && parsed > 0 ? parsed : null;
};
const nonNegative = (value) => {
    const parsed = finite(value);
    return parsed != null && parsed >= 0 ? parsed : null;
};
const round = (value, decimals) => value == null || !Number.isFinite(value) ? null : Number(value.toFixed(decimals));
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function thermalFingerprint(value) {
    return crypto_1.default.createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function celsiusToKelvin(value) {
    return value + 273.15;
}
/** Buck saturation vapour pressure, returned in kPa. */
function saturationVapourPressureKpa(temperatureC) {
    return 0.61078 * Math.exp((17.2694 * temperatureC) / (temperatureC + 237.29));
}
function humidityRatio(temperatureC, relativeHumidityPct, pressureKpa) {
    const vapourPressure = saturationVapourPressureKpa(temperatureC) * relativeHumidityPct / 100;
    if (!(pressureKpa > vapourPressure))
        return null;
    return 0.62198 * vapourPressure / (pressureKpa - vapourPressure);
}
function sumNumber(values) {
    return values.reduce((sum, value) => sum + (value || 0), 0);
}
function tankGeometry(tank) {
    const shape = String(tank?.eff_shape || tank?.shape_type || '').toLowerCase();
    let freeSurface = positive(tank?.free_surface_area_m2 ?? tank?.water_surface_area_m2 ?? tank?.surface_area_m2);
    const quantity = Math.max(1, Number.parseInt(String(tank?.quantity ?? 1), 10) || 1);
    const length = positive(tank?.inner_length_mm ?? tank?.eff_length_mm ?? tank?.length_mm);
    const width = positive(tank?.inner_width_mm ?? tank?.eff_width_mm ?? tank?.width_mm);
    const waterHeight = positive(tank?.water_depth_mm ?? tank?.eff_water_level_mm ?? tank?.design_water_level_mm ??
        tank?.inner_height_mm ?? tank?.eff_height_mm ?? tank?.height_mm);
    let freeSurfaceSource = freeSurface != null
        ? (tank?.free_surface_area_m2 != null || tank?.water_surface_area_m2 != null
            ? 'tank saved free-surface area'
            : 'tank saved water-surface area')
        : 'missing';
    if (freeSurface == null && shape === 'cylindrical' && width != null) {
        freeSurface = Math.PI * Math.pow(width / 2, 2) / 1e6;
        freeSurfaceSource = 'cylindrical diameter footprint';
    }
    else if (freeSurface == null && shape !== 'custom' && length != null && width != null) {
        freeSurface = length * width / 1e6;
        freeSurfaceSource = 'rectangular length × width footprint';
    }
    let wallArea = positive(tank?.exposed_wall_area_m2 ?? tank?.wall_area_m2);
    let wallSource = wallArea != null ? 'tank saved exposed wall area' : null;
    if (wallArea == null && shape === 'cylindrical' && width != null && waterHeight != null) {
        wallArea = Math.PI * width * waterHeight / 1e6;
        wallSource = 'cylindrical diameter × water height';
    }
    else if (wallArea == null && length != null && width != null && waterHeight != null) {
        wallArea = 2 * (length + width) * waterHeight / 1e6;
        wallSource = shape === 'custom'
            ? 'rectangular default (custom tank)'
            : 'rectangular inner perimeter × water height';
    }
    const sourceWallLayers = Array.isArray(tank?.wall_layers) && tank.wall_layers.length
        ? tank.wall_layers
        : null;
    const volume = positive(tank?.effective_operating_volume_m3 ?? tank?.design_volume_m3 ??
        tank?.operating_volume_m3 ?? tank?.project_operating_volume_m3);
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
        free_surface_source: freeSurfaceSource,
        exposed_wall_source: wallSource || (shape === 'custom' ? 'custom geometry requires reviewed wall area' : 'missing'),
        wall_material: String(tank?.material_name ?? tank?.eff_primary_material ??
            tank?.primary_material ?? tank?.material_code ?? '').trim() || null,
        wall_thickness_mm: positive(tank?.eff_wall_thickness_mm ?? tank?.wall_thickness_mm),
        wall_layers: sourceWallLayers,
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
function buildThermalSourceContext(args) {
    const { system, links = [], exhibits = [], tanks = [], exhibitCalculations = [], wallConstructions = [], } = args;
    const governedWallConstructions = wallConstructions.length
        ? wallConstructions
        : exports.THERMAL_CONSTRUCTION_DEFAULTS;
    const linkedExhibitIds = links.map(link => link.exhibit_id).filter(Boolean);
    const duplicateExhibitIds = [...new Set(linkedExhibitIds.filter((id, index) => linkedExhibitIds.indexOf(id) !== index))];
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
        water_temperature_range_status: finite(exhibit.design_temperature_min) == null || finite(exhibit.design_temperature_max) == null
            ? (exhibit.design_temperature_min == null || exhibit.design_temperature_min === '' ||
                exhibit.design_temperature_max == null || exhibit.design_temperature_max === ''
                ? 'incomplete' : 'invalid')
            : finite(exhibit.design_temperature_min) > finite(exhibit.design_temperature_max)
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
        wall_construction_defaults: governedWallConstructions,
    };
    return { ...source, fingerprint: thermalFingerprint(source) };
}
function resolveWaterTemperature(source, inputs, reasons) {
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
    if (records.some((item) => item.water_temperature_range_status === 'invalid' ||
        (item.water_temperature_min_c != null && item.water_temperature_max_c != null &&
            item.water_temperature_min_c > item.water_temperature_max_c))) {
        reasons.push('Every linked exhibit must provide a valid water design-temperature range with minimum no greater than maximum.');
        return { value: null, source: 'invalid linked exhibit temperature range', reviewed_override_used: false };
    }
    if (records.some((item) => item.water_temperature_min_c == null || item.water_temperature_max_c == null)) {
        reasons.push('Every linked exhibit must provide both minimum and maximum water design temperature.');
        return { value: null, source: 'incomplete linked exhibit temperatures', reviewed_override_used: false };
    }
    const first = records[0];
    const same = records.every((item) => Math.abs(item.water_temperature_min_c - first.water_temperature_min_c) < 1e-9 &&
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
function normalizedWallMaterial(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}
function constructionForWallMaterial(value, constructions = exports.THERMAL_CONSTRUCTION_DEFAULTS) {
    const material = normalizedWallMaterial(value);
    if (!material)
        return null;
    if (material.includes('acrylic') || material.includes('pmma')) {
        return constructions.find(item => item.code === 'acrylic') || null;
    }
    if (material.includes('concrete')) {
        return constructions.find(item => item.code === 'concrete') || null;
    }
    if (material.includes('frp') || material.includes('grp') || material.includes('fiberglass')) {
        return constructions.find(item => item.code === 'frp') || null;
    }
    if (material.includes('steel')) {
        return constructions.find(item => item.code === 'steel') || null;
    }
    return null;
}
function calculatedWallProperties(thicknessM, conductivity) {
    if (thicknessM == null || conductivity == null || thicknessM <= 0 || conductivity <= 0) {
        return null;
    }
    const materialResistance = thicknessM / conductivity;
    const materialUValue = 1 / materialResistance;
    const overallResistance = 1 / exports.THERMAL_CONSTANTS.inside_film_coefficient_w_m2_k +
        materialResistance +
        1 / exports.THERMAL_CONSTANTS.outside_film_coefficient_w_m2_k;
    return {
        material_resistance_m2_k_w: materialResistance,
        material_u_value_w_m2_k: materialUValue,
        overall_resistance_m2_k_w: overallResistance,
        overall_u_value_w_m2_k: 1 / overallResistance,
    };
}
function calculatedWallPropertiesFromResistance(materialResistance) {
    if (materialResistance == null || materialResistance <= 0)
        return null;
    const materialUValue = 1 / materialResistance;
    const overallResistance = 1 / exports.THERMAL_CONSTANTS.inside_film_coefficient_w_m2_k +
        materialResistance +
        1 / exports.THERMAL_CONSTANTS.outside_film_coefficient_w_m2_k;
    return {
        material_resistance_m2_k_w: materialResistance,
        material_u_value_w_m2_k: materialUValue,
        overall_resistance_m2_k_w: overallResistance,
        overall_u_value_w_m2_k: 1 / overallResistance,
    };
}
function resolveWallUValueLegacy(source, inputs, reasons) {
    const sourceTankWall = (source?.linked_tanks || []).find((tank) => positive(tank?.wall_thickness_mm) != null && String(tank?.wall_material || '').trim());
    const sourceConstruction = constructionForWallMaterial(sourceTankWall?.wall_material);
    const rawConstruction = String(inputs.tank_construction_type ?? inputs.tank_construction ?? sourceConstruction?.code ?? '').trim().toLowerCase();
    const construction = exports.THERMAL_CONSTRUCTION_DEFAULTS.find(item => item.code === rawConstruction);
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
            default_layers: null,
            effective_layers: null,
            layer_override_flags: {},
            layer_override_justification: null,
        };
    }
    if (construction) {
        const defaultBasis = inputs.tank_wall_default_basis || construction;
        const sourceLayerApplies = sourceTankWall && sourceConstruction?.code === construction.code;
        const defaultLayer = {
            material: String(sourceLayerApplies
                ? sourceTankWall.wall_material
                : defaultBasis.material || construction.material || '').trim(),
            thickness_mm: Number(sourceLayerApplies
                ? sourceTankWall.wall_thickness_mm
                : defaultBasis.thickness_mm ?? construction.thickness_mm),
            conductivity_w_m_k: Number(defaultBasis.conductivity_w_m_k ?? construction.conductivity_w_m_k),
        };
        const requestedLayers = Array.isArray(inputs.tank_wall_layers) &&
            inputs.tank_wall_layers.length
            ? inputs.tank_wall_layers
            : [defaultLayer];
        const validLayers = requestedLayers.map((layer) => ({
            material: String(layer?.material || '').trim(),
            thickness_m: positive(layer?.thickness_mm) == null ? null : Number(layer.thickness_mm) / 1000,
            conductivity_w_m_k: positive(layer?.conductivity_w_m_k),
        }));
        const defaultLayers = [{
                material: defaultLayer.material,
                thickness_m: positive(defaultLayer.thickness_mm) == null ? null : defaultLayer.thickness_mm / 1000,
                conductivity_w_m_k: positive(defaultLayer.conductivity_w_m_k),
            }];
        if (validLayers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null) ||
            defaultLayers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null)) {
            reasons.push('Every tank wall layer requires material, positive thickness, and positive conductivity.');
            return { value: null, source: 'incomplete wall construction' };
        }
        const effectiveLayer = validLayers[0];
        const defaultLayerResolved = defaultLayers[0];
        const layerOverrideFlags = {
            material: effectiveLayer.material !== defaultLayerResolved.material,
            thickness_mm: Math.abs(effectiveLayer.thickness_m - defaultLayerResolved.thickness_m) > 1e-12,
            conductivity_w_m_k: Math.abs(effectiveLayer.conductivity_w_m_k - defaultLayerResolved.conductivity_w_m_k) > 1e-12,
        };
        const hasLayerOverride = Object.values(layerOverrideFlags).some(Boolean);
        const materialResistance = validLayers.reduce((sum, layer) => sum + layer.thickness_m / layer.conductivity_w_m_k, 0);
        const properties = calculatedWallPropertiesFromResistance(materialResistance);
        return {
            value: properties.overall_u_value_w_m2_k,
            ...properties,
            source: hasLayerOverride
                ? 'AAT Foundations wall-layer default with designer override'
                : sourceLayerApplies
                    ? 'exhibit tank wall with governed material conductivity'
                    : 'AAT Foundations governed wall-layer default',
            construction: {
                ...construction,
                label: defaultBasis.label || construction.label,
            },
            reviewed: false,
            assumption_label: defaultBasis.assumption_label || construction.assumption_label,
            basis_version: defaultBasis.basis_version || construction.basis_version,
            source_reference: defaultBasis.source_reference || construction.source_reference,
            source_basis: defaultBasis.source_basis || 'AAT Foundations',
            approval: defaultBasis.approval || null,
            default_layers: defaultLayers,
            effective_layers: validLayers,
            layer_override_flags: layerOverrideFlags,
            layer_override_justification: String(inputs.tank_wall_override_justification || inputs.wall_layer_override_justification || '').trim() || null,
        };
    }
    const layers = Array.isArray(inputs.tank_wall_layers) ? inputs.tank_wall_layers : [];
    const validLayers = layers.map((layer) => ({
        material: String(layer?.material || '').trim(),
        thickness_m: positive(layer?.thickness_mm) == null ? null : Number(layer.thickness_mm) / 1000,
        conductivity_w_m_k: positive(layer?.conductivity_w_m_k),
    }));
    if (!validLayers.length) {
        if (!rawConstruction)
            reasons.push('Select a tank construction, enter wall layers, or provide a reviewed U-value before calculating.');
        return { value: null, source: 'missing wall construction' };
    }
    if (validLayers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null)) {
        reasons.push('Every tank wall layer requires material, positive thickness, and positive conductivity.');
        return { value: null, source: 'incomplete wall construction' };
    }
    const materialResistance = validLayers.reduce((sum, layer) => sum + layer.thickness_m / layer.conductivity_w_m_k, 0);
    const properties = calculatedWallPropertiesFromResistance(materialResistance);
    return {
        value: properties.overall_u_value_w_m2_k,
        ...properties,
        source: 'wall-layer resistance with water-side and air-side films',
        construction: construction || null,
        reviewed: true,
        assumption_label: 'Reviewed engineering value — explicit wall-layer construction',
        basis_version: null,
        source_reference: null,
        default_layers: null,
        effective_layers: validLayers,
        layer_override_flags: {},
        layer_override_justification: String(inputs.tank_wall_override_justification || inputs.wall_layer_override_justification || '').trim() || null,
        layers: validLayers,
    };
}
function resolveWallUValue(source, inputs, reasons) {
    const sourceTanks = source?.linked_tanks || [];
    const governedConstructions = source?.wall_construction_defaults?.length
        ? source.wall_construction_defaults
        : exports.THERMAL_CONSTRUCTION_DEFAULTS;
    const sourceTankWalls = sourceTanks.filter((tank) => positive(tank?.wall_thickness_mm) != null && String(tank?.wall_material || '').trim());
    const sourceHasTankWallData = sourceTanks.some((tank) => positive(tank?.wall_thickness_mm) != null || String(tank?.wall_material || '').trim());
    const sourceHasCompleteTankWallData = sourceTanks.length > 0 &&
        sourceTanks.every((tank) => positive(tank?.wall_thickness_mm) != null && String(tank?.wall_material || '').trim());
    const submittedWallLayers = Array.isArray(inputs.tank_wall_layers)
        ? inputs.tank_wall_layers
        : [];
    if (submittedWallLayers.length && submittedWallLayers.some((layer) => !String(layer?.material || '').trim() ||
        positive(layer?.thickness_mm) == null ||
        positive(layer?.conductivity_w_m_k) == null)) {
        reasons.push('Every tank wall layer requires material, positive thickness, and positive conductivity.');
    }
    const sourceHasMixedTankWalls = sourceHasCompleteTankWallData &&
        new Set(sourceTanks.map((tank) => {
            const governed = constructionForWallMaterial(tank.wall_material, governedConstructions);
            return [
                governed?.code || normalizedWallMaterial(tank.wall_material),
                positive(tank.wall_thickness_mm),
                positive(governed?.conductivity_w_m_k),
            ].join('|');
        })).size > 1;
    const sourceTankWall = sourceTankWalls[0];
    const sourceConstruction = constructionForWallMaterial(sourceTankWall?.wall_material, governedConstructions);
    const rawConstruction = String(inputs.tank_construction_type ?? inputs.tank_construction ?? sourceConstruction?.code ?? '').trim().toLowerCase();
    const construction = governedConstructions.find((item) => item.code === rawConstruction);
    if (rawConstruction && !construction) {
        reasons.push('Tank construction must be Acrylic, Concrete, FRP, or Steel.');
    }
    const reviewedRaw = inputs.reviewed_u_value_w_m2_k;
    const reviewed = positive(reviewedRaw);
    if (reviewedRaw !== null && reviewedRaw !== undefined && reviewedRaw !== '' && reviewed == null) {
        reasons.push('Reviewed wall U-value must be a positive finite value.');
    }
    // Linked tank evidence governs the calculation. A legacy system-wide custom
    // U-value cannot replace a missing, unrecognised, or mixed tank wall.
    if (reviewed != null && !sourceHasTankWallData) {
        return buildWallResolution({
            value: reviewed,
            source: 'reviewed custom U-value',
            construction: construction || null,
            reviewed: true,
            assumption_label: 'Reviewed engineering value — custom wall U-value',
            basis_version: null,
            source_reference: null,
            default_layers: null,
            effective_layers: null,
            layer_override_flags: {},
            layer_override_justification: null,
        }, source, inputs, reasons);
    }
    // Linked exhibit tanks are the authoritative wall construction whenever
    // their material and thickness are available. A single system-level
    // construction must not be applied to a mixed set of linked tanks.
    if (sourceHasTankWallData && sourceHasCompleteTankWallData) {
        const tankResolutions = sourceTanks.map((tank) => {
            const tankConstruction = constructionForWallMaterial(tank.wall_material, governedConstructions);
            const conductivity = positive(tankConstruction?.conductivity_w_m_k);
            const thickness = positive(tank.wall_thickness_mm);
            if (!tankConstruction || conductivity == null || thickness == null) {
                return {
                    tank,
                    error: `Tank ${tank.tank_code || tank.tank_id || 'linked tank'} requires a recognized wall material and positive wall thickness.`,
                };
            }
            const sourceLayers = Array.isArray(tank.wall_layers) && tank.wall_layers.length
                ? tank.wall_layers
                : [{
                        material: tank.wall_material,
                        thickness_mm: thickness,
                        conductivity_w_m_k: conductivity,
                    }];
            const layers = sourceLayers.map((layer) => {
                const layerConstruction = constructionForWallMaterial(layer?.material, governedConstructions);
                return {
                    material: String(layer?.material || '').trim(),
                    thickness_m: positive(layer?.thickness_mm) == null
                        ? null
                        : Number(layer.thickness_mm) / 1000,
                    conductivity_w_m_k: positive(layer?.conductivity_w_m_k ?? layerConstruction?.conductivity_w_m_k),
                };
            });
            if (layers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null)) {
                return {
                    tank,
                    error: `Tank ${tank.tank_code || tank.tank_id || 'linked tank'} requires complete wall-layer material, positive thickness, and positive conductivity.`,
                };
            }
            const materialResistance = layers.reduce((sum, layer) => sum + layer.thickness_m / layer.conductivity_w_m_k, 0);
            const properties = calculatedWallPropertiesFromResistance(materialResistance);
            return {
                tank,
                resolution: {
                    // The governed U used for Task 224 conduction is the material
                    // conductance k/L. Film resistances remain frozen alongside it as
                    // supporting wall evidence and are not silently substituted.
                    value: properties.material_u_value_w_m2_k,
                    ...properties,
                    source: layers.length > 1
                        ? 'linked exhibit tank multilayer wall with governed material conductivity'
                        : 'exhibit tank wall with governed material conductivity',
                    construction: {
                        ...tankConstruction,
                        label: tankConstruction.label,
                    },
                    reviewed: false,
                    assumption_label: `Exhibit tank wall — ${tank.wall_material}, ${thickness} mm`,
                    basis_version: tankConstruction.basis_version,
                    source_reference: tank.tank_code || tank.tank_id || tankConstruction.source_reference,
                    source_basis: tankConstruction.source_basis,
                    approval: null,
                    default_layers: layers,
                    effective_layers: layers,
                    layer_override_flags: {
                        material: false,
                        thickness_mm: false,
                        conductivity_w_m_k: false,
                    },
                    layer_override_justification: null,
                },
            };
        });
        const invalidTank = tankResolutions.find(item => item.error);
        if (invalidTank) {
            reasons.push(invalidTank.error);
            return {
                value: null,
                source: 'invalid linked tank wall construction',
                tank_resolutions: [],
            };
        }
        return buildWallResolution(tankResolutions[0].resolution, source, inputs, reasons, tankResolutions);
    }
    else if (sourceHasTankWallData && !sourceHasCompleteTankWallData) {
        reasons.push('Every linked tank must provide both a recognized wall material and a positive wall thickness for mixed-wall thermal conduction.');
        return { value: null, source: 'incomplete linked tank wall construction', tank_resolutions: [] };
    }
    if (construction) {
        const defaultBasis = inputs.tank_wall_default_basis || construction;
        const sourceLayerApplies = sourceTankWall && sourceConstruction?.code === construction.code;
        const defaultLayer = {
            material: String(sourceLayerApplies
                ? sourceTankWall.wall_material
                : defaultBasis.material || construction.material || '').trim(),
            thickness_mm: Number(sourceLayerApplies
                ? sourceTankWall.wall_thickness_mm
                : defaultBasis.thickness_mm ?? construction.thickness_mm),
            conductivity_w_m_k: Number(defaultBasis.conductivity_w_m_k ?? construction.conductivity_w_m_k),
        };
        const requestedLayers = Array.isArray(inputs.tank_wall_layers) &&
            inputs.tank_wall_layers.length
            ? inputs.tank_wall_layers
            : [defaultLayer];
        const validLayers = requestedLayers.map((layer) => ({
            material: String(layer?.material || '').trim(),
            thickness_m: positive(layer?.thickness_mm) == null ? null : Number(layer.thickness_mm) / 1000,
            conductivity_w_m_k: positive(layer?.conductivity_w_m_k),
        }));
        const defaultLayers = [{
                material: defaultLayer.material,
                thickness_m: positive(defaultLayer.thickness_mm) == null ? null : defaultLayer.thickness_mm / 1000,
                conductivity_w_m_k: positive(defaultLayer.conductivity_w_m_k),
            }];
        if (validLayers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null) ||
            defaultLayers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null)) {
            reasons.push('Every tank wall layer requires material, positive thickness, and positive conductivity.');
            return { value: null, source: 'incomplete wall construction' };
        }
        const effectiveLayer = validLayers[0];
        const defaultLayerResolved = defaultLayers[0];
        const layerOverrideFlags = {
            material: effectiveLayer.material !== defaultLayerResolved.material,
            thickness_mm: Math.abs(effectiveLayer.thickness_m - defaultLayerResolved.thickness_m) > 1e-12,
            conductivity_w_m_k: Math.abs(effectiveLayer.conductivity_w_m_k - defaultLayerResolved.conductivity_w_m_k) > 1e-12,
        };
        const hasLayerOverride = Object.values(layerOverrideFlags).some(Boolean);
        const resistance = validLayers.reduce((sum, layer) => sum + layer.thickness_m / layer.conductivity_w_m_k, 0);
        return buildWallResolution({
            value: 1 / resistance,
            source: hasLayerOverride
                ? 'AAT Foundations wall-layer default with designer override'
                : sourceLayerApplies
                    ? 'exhibit tank wall with governed material conductivity'
                    : 'AAT Foundations governed wall-layer default',
            construction: {
                ...construction,
                label: defaultBasis.label || construction.label,
            },
            reviewed: false,
            assumption_label: defaultBasis.assumption_label || construction.assumption_label,
            basis_version: defaultBasis.basis_version || construction.basis_version,
            source_reference: defaultBasis.source_reference || construction.source_reference,
            source_basis: defaultBasis.source_basis || 'AAT Foundations',
            approval: defaultBasis.approval || null,
            default_layers: defaultLayers,
            effective_layers: validLayers,
            layer_override_flags: layerOverrideFlags,
            layer_override_justification: String(inputs.tank_wall_override_justification || inputs.wall_layer_override_justification || '').trim() || null,
        }, source, inputs, reasons);
    }
    const layers = Array.isArray(inputs.tank_wall_layers) ? inputs.tank_wall_layers : [];
    const validLayers = layers.map((layer) => ({
        material: String(layer?.material || '').trim(),
        thickness_m: positive(layer?.thickness_mm) == null ? null : Number(layer.thickness_mm) / 1000,
        conductivity_w_m_k: positive(layer?.conductivity_w_m_k),
    }));
    if (!validLayers.length) {
        if (!rawConstruction)
            reasons.push('Select a tank construction, enter wall layers, or provide a reviewed U-value before calculating.');
        return { value: null, source: 'missing wall construction' };
    }
    if (validLayers.some(layer => !layer.material || layer.thickness_m == null || layer.conductivity_w_m_k == null)) {
        reasons.push('Every tank wall layer requires material, positive thickness, and positive conductivity.');
        return { value: null, source: 'incomplete wall construction' };
    }
    const resistance = validLayers.reduce((sum, layer) => sum + layer.thickness_m / layer.conductivity_w_m_k, 0);
    return buildWallResolution({
        value: 1 / resistance,
        source: 'material-only wall-layer resistance',
        construction: construction || null,
        reviewed: true,
        assumption_label: 'Reviewed engineering value — explicit wall-layer construction',
        basis_version: null,
        source_reference: null,
        default_layers: null,
        effective_layers: validLayers,
        layer_override_flags: {},
        layer_override_justification: String(inputs.tank_wall_override_justification || inputs.wall_layer_override_justification || '').trim() || null,
        layers: validLayers,
    }, source, inputs, reasons);
}
function buildWallResolution(resolution, source, inputs, reasons, tankResolutions = []) {
    const sourceTanks = source?.linked_tanks || [];
    const resolutions = tankResolutions.length
        ? tankResolutions
        : sourceTanks.map((tank) => ({ tank, resolution }));
    const resolvedTankResolutions = resolutions.map(({ tank, resolution: tankResolution }) => ({
        tank,
        resolution: tankResolution,
    }));
    return {
        ...resolution,
        tank_resolutions: resolvedTankResolutions,
    };
}
function resolveTankWallCalculation(tank, inputs, reasons) {
    const label = tank?.tank_code || tank?.tank_id || 'Linked tank';
    const sourceLayers = Array.isArray(tank?.wall_layers) && tank.wall_layers.length
        ? tank.wall_layers
        : [{
                material: tank?.wall_material,
                thickness_mm: tank?.wall_thickness_mm,
            }];
    const explicitLayers = inputs.tank_wall_layers_by_tank?.[tank?.tank_id] ||
        inputs.tank_wall_layers_by_exhibit?.[tank?.exhibit_id];
    const layers = Array.isArray(explicitLayers) && explicitLayers.length
        ? explicitLayers
        : sourceLayers;
    const area = resolvedWallArea(tank, inputs);
    const resolvedLayers = layers.map((layer) => {
        const material = String(layer?.material || '').trim();
        const construction = constructionForWallMaterial(material);
        return {
            material: material || null,
            thickness_mm: positive(layer?.thickness_mm),
            conductivity_w_m_k: positive(layer?.conductivity_w_m_k ?? construction?.conductivity_w_m_k),
            construction_type: construction?.code || null,
        };
    });
    if (resolvedLayers.some(layer => !layer.material)) {
        reasons.push(`${label} requires a material for every wall layer before Thermal calculation.`);
    }
    if (resolvedLayers.some(layer => layer.thickness_mm == null)) {
        reasons.push(`${label} requires a positive thickness for every wall layer before Thermal calculation.`);
    }
    if (resolvedLayers.some(layer => layer.conductivity_w_m_k == null)) {
        reasons.push(`${label} has a wall material without governed thermal conductivity.`);
    }
    if (area == null)
        reasons.push(`${label} requires a positive exposed wall area before Thermal calculation.`);
    const materialResistance = resolvedLayers.every(layer => layer.thickness_mm != null && layer.conductivity_w_m_k != null)
        ? resolvedLayers.reduce((sum, layer) => sum + (layer.thickness_mm / 1000) / layer.conductivity_w_m_k, 0)
        : null;
    const properties = calculatedWallPropertiesFromResistance(materialResistance);
    return {
        tank_id: tank?.tank_id || null,
        tank_code: tank?.tank_code || null,
        exhibit_id: tank?.exhibit_id || null,
        exhibit_code: tank?.exhibit_code || null,
        quantity: tank?.quantity || 1,
        material: resolvedLayers.length === 1 ? resolvedLayers[0].material : null,
        construction_type: resolvedLayers.length === 1 ? resolvedLayers[0].construction_type : null,
        thickness_mm: resolvedLayers.length === 1 ? resolvedLayers[0].thickness_mm : null,
        conductivity_w_m_k: resolvedLayers.length === 1 ? resolvedLayers[0].conductivity_w_m_k : null,
        water_side_h_w_m2_k: exports.THERMAL_CONSTANTS.inside_film_coefficient_w_m2_k,
        air_side_h_w_m2_k: exports.THERMAL_CONSTANTS.outside_film_coefficient_w_m2_k,
        exposed_wall_area_m2: area,
        layers: resolvedLayers,
        ...properties,
        source: resolvedLayers.length > 1
            ? 'linked exhibit tank multilayer wall with governed material conductivity'
            : 'linked exhibit tank with governed material conductivity',
    };
}
function correlationFor(inputs, agitationClass = inputs.agitation_class) {
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
    if (configured && configured[agitationClass])
        return configured[agitationClass];
    if (configured && configured.class === agitationClass)
        return configured;
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
function correlationProblems(correlation, inputs) {
    const problems = [];
    if (!correlation || positive(correlation.coefficient_kg_m2_s_kpa) == null) {
        problems.push('requires a positive mass-transfer coefficient');
    }
    if (!correlation?.version)
        problems.push('requires an explicit version');
    if (correlation?.approved !== true)
        problems.push('requires explicit approval');
    if (correlation?.deviation &&
        !String(correlation.deviation_justification || inputs.deviation_justification || '').trim()) {
        problems.push('requires a deviation justification');
    }
    return problems;
}
function resolvedWallArea(tank, inputs) {
    return positive(inputs.custom_tank_wall_areas_m2?.[tank.tank_id]) ??
        positive(tank.exposed_wall_area_m2);
}
function resolvedWallSource(tank, inputs) {
    return positive(inputs.custom_tank_wall_areas_m2?.[tank.tank_id]) != null
        ? 'manual override (custom tank)'
        : tank.exposed_wall_source;
}
function sourceWithResolvedWallSources(source, inputs, wallConstructionBasis) {
    return {
        ...source,
        linked_tanks: (source.linked_tanks || []).map((tank) => ({
            ...tank,
            exposed_wall_source: resolvedWallSource(tank, inputs),
            wall_construction_basis: wallConstructionBasis?.tank_bases?.find((basis) => basis.tank_id === tank.tank_id) || null,
        })),
        wall_construction_basis: wallConstructionBasis || null,
    };
}
function validateCommonInputs(source, inputs, reasons) {
    if (!source?.linked_exhibits?.length)
        reasons.push('Link at least one exhibit to this LSS system before calculating thermal loads.');
    if (source?.duplicate_exhibit_ids?.length)
        reasons.push('Duplicate exhibit links must be removed before calculating thermal loads.');
    if (source?.linked_exhibits?.some((exhibit) => exhibit.missing))
        reasons.push('A linked exhibit no longer exists in the current project.');
    const ambient = finite(inputs.ambient_air_temperature_c);
    const humidity = finite(inputs.relative_humidity_pct);
    const pressure = positive(inputs.atmospheric_pressure_kpa);
    if (ambient == null)
        reasons.push('Ambient air temperature is required.');
    if (humidity == null || humidity < 0 || humidity > 100)
        reasons.push('Relative humidity must be between 0% and 100%.');
    if (pressure == null)
        reasons.push('Atmospheric pressure must be greater than zero.');
    const water = resolveWaterTemperature(source, inputs, reasons);
    if (water.value != null && ambient != null && pressure != null) {
        const airVapour = saturationVapourPressureKpa(ambient) * (humidity || 0) / 100;
        if (pressure <= airVapour)
            reasons.push('Atmospheric pressure must exceed ambient water-vapour pressure.');
    }
    const geometry = source.linked_tanks || [];
    if (!geometry.length)
        reasons.push('No tanks are linked through the current system exhibits.');
    const effectiveVolumes = source.effective_volume_sources || [];
    if (effectiveVolumes.length !== source.linked_exhibits?.length ||
        effectiveVolumes.some((item) => item.effective_water_volume_m3 == null ||
            item.effective_water_volume_m3 <= 0 || item.status === 'invalid' ||
            item.freshness === 'stale')) {
        reasons.push('Every linked exhibit requires a current positive effective operating-volume calculation.');
    }
    if (geometry.some((tank) => tank.free_surface_area_m2 == null || tank.free_surface_area_m2 <= 0)) {
        reasons.push('Every linked tank requires a positive free-surface area.');
    }
    if (geometry.some((tank) => resolvedWallArea(tank, inputs) == null)) {
        reasons.push('Every linked tank requires a positive exposed wall area; custom tanks use a rectangular default when length, width, and water height are available, otherwise provide a positive reviewed override.');
    }
    const wall = resolveWallUValue(source, inputs, reasons);
    const agitation = String(inputs.agitation_class || '').trim();
    if (!agitation)
        reasons.push('Select an agitation class.');
    const correlation = agitation ? correlationFor(inputs, agitation) : null;
    if (!correlation || positive(correlation.coefficient_kg_m2_s_kpa) == null) {
        reasons.push('Configure a versioned evaporation correlation coefficient for the selected agitation class; the manual does not supply one automatically.');
    }
    else {
        if (!correlation.version)
            reasons.push('Evaporation correlation data must have an explicit version.');
        if (correlation.approved !== true)
            reasons.push('Evaporation correlation data must be explicitly approved before a result can be Ready.');
        if (correlation.deviation && !String(inputs.deviation_justification || '').trim()) {
            reasons.push('Provide a deviation justification for the non-standard evaporation correlation.');
        }
    }
    const lightingPower = nonNegative(inputs.lighting_power_kw);
    const equipment = nonNegative(inputs.equipment_heat_gain_kw);
    const margin = nonNegative(inputs.capacity_margin_pct);
    if (inputs.equipment_heat_gain_kw != null && equipment == null)
        reasons.push('Equipment heat gain must be a non-negative finite value.');
    if (inputs.lighting_power_kw != null && lightingPower == null)
        reasons.push('Lighting power must be non-negative.');
    if (margin == null)
        reasons.push('Capacity margin must be a non-negative percentage.');
    if (inputs.water_exchange_enabled) {
        if (positive(inputs.water_exchange_flow_m3h) == null)
            reasons.push('Enabled water exchange requires a positive exchange flow.');
        if (finite(inputs.water_exchange_inlet_temperature_c) == null)
            reasons.push('Enabled water exchange requires an inlet water temperature.');
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
function calculateCaseLegacy(source, inputs, factors = { surface: 1, evaporation: 1, correlation: null }) {
    const reasons = [];
    const common = validateCommonInputs(source, inputs, reasons);
    const waterTemperature = common.water.value;
    const volume = sumNumber((source.effective_volume_sources || []).map((item) => finite(item.effective_water_volume_m3)));
    const freeSurface = sumNumber((source.linked_tanks || []).map((tank) => finite(tank.free_surface_area_m2))) * factors.surface;
    const tankWallCalculations = (source.linked_tanks || []).map((tank) => resolveTankWallCalculation(tank, inputs, reasons));
    const wallArea = sumNumber(tankWallCalculations.map((wall) => finite(wall.exposed_wall_area_m2))) * factors.surface;
    const uValue = tankWallCalculations.length === 1
        ? tankWallCalculations[0].overall_u_value_w_m2_k
        : null;
    const correlation = factors.correlation || common.correlation;
    if (factors.correlation) {
        const sensitivityCorrelationProblems = correlationProblems(factors.correlation, inputs);
        if (sensitivityCorrelationProblems.length) {
            reasons.push(`Sensitivity agitation correlation ${sensitivityCorrelationProblems.join(', ')}.`);
        }
    }
    const surfaceTemperature = finite(inputs.surrounding_surface_temperature_c) ?? common.ambient;
    if (surfaceTemperature == null)
        reasons.push('Effective Radiant Surroundings Temperature is required.');
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
        ? null : exports.THERMAL_CONSTANTS.convection_coefficient_w_m2_k * freeSurface *
        (common.ambient - waterTemperature) / 1000;
    const radiation = waterTemperature == null || surfaceTemperature == null
        ? null : exports.THERMAL_CONSTANTS.emissivity * exports.THERMAL_CONSTANTS.stefan_boltzmann_w_m2_k4 *
        freeSurface * (Math.pow(celsiusToKelvin(surfaceTemperature), 4) -
        Math.pow(celsiusToKelvin(waterTemperature), 4)) / 1000;
    const wallConduction = waterTemperature == null || common.ambient == null
        ? null
        : tankWallCalculations.reduce((sum, wall) => {
            const tankU = finite(wall.overall_u_value_w_m2_k);
            const tankArea = finite(wall.exposed_wall_area_m2);
            return tankU == null || tankArea == null
                ? sum
                : sum + tankU * tankArea * factors.surface * (common.ambient - waterTemperature) / 1000;
        }, 0);
    const tankWallBreakdown = tankWallCalculations.map((wall) => ({
        ...wall,
        wall_conduction_kw: waterTemperature == null || common.ambient == null ||
            wall.overall_u_value_w_m2_k == null || wall.exposed_wall_area_m2 == null
            ? null
            : wall.overall_u_value_w_m2_k * wall.exposed_wall_area_m2 * factors.surface *
                (common.ambient - waterTemperature) / 1000,
    }));
    const evaporation = evaporationCoefficient == null || deltaVapourPressure == null
        ? null : -evaporationCoefficient * freeSurface * Math.max(0, deltaVapourPressure) *
        exports.THERMAL_CONSTANTS.latent_heat_vaporization_j_kg / 1000 * factors.evaporation;
    const lightingCoupling = finite(inputs.lighting_coupling_pct) ?? exports.THERMAL_CONSTANTS.lighting_coupling_pct_suggested;
    if (lightingCoupling < 0 || lightingCoupling > 100)
        reasons.push('Lighting coupling must be between 0% and 100%.');
    const lighting = common.lightingPower * (lightingCoupling / 100);
    const exchangeFlow = inputs.water_exchange_enabled ? positive(inputs.water_exchange_flow_m3h) : 0;
    const exchangeInlet = inputs.water_exchange_enabled ? finite(inputs.water_exchange_inlet_temperature_c) : null;
    const exchange = exchangeFlow && exchangeInlet != null && waterTemperature != null
        ? exchangeFlow * exports.THERMAL_CONSTANTS.water_density_kg_m3 *
            exports.THERMAL_CONSTANTS.water_specific_heat_kj_kg_k * (exchangeInlet - waterTemperature) / 3600
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
    const recovery = volume > 0 ? exports.THERMAL_CONSTANTS.recovery_heating_kw_per_m3 * volume : null;
    if (recovery == null)
        reasons.push('Recovery heating requires a positive effective water volume.');
    const marginFactor = 1 + common.margin / 100;
    const waterTemperatureBasis = {
        source: common.water.source,
        minimum_c: common.water.minimum_c ?? null,
        maximum_c: common.water.maximum_c ?? null,
        average_c: common.water.average_c ?? null,
        calculated_temperature_c: waterTemperature,
        reviewed_override_used: common.water.reviewed_override_used === true,
    };
    const singleTankWall = tankWallBreakdown.length === 1 ? tankWallBreakdown[0] : null;
    const wallConstructionBasis = {
        construction_type: singleTankWall?.construction_type || null,
        construction_label: singleTankWall?.material || null,
        material: singleTankWall?.material || null,
        thickness_mm: singleTankWall?.thickness_mm ?? null,
        conductivity_w_m_k: singleTankWall?.conductivity_w_m_k ?? null,
        material_resistance_m2_k_w: singleTankWall?.material_resistance_m2_k_w ?? null,
        material_u_value_w_m2_k: singleTankWall?.material_u_value_w_m2_k ?? null,
        overall_resistance_m2_k_w: singleTankWall?.overall_resistance_m2_k_w ?? null,
        u_value_w_m2_k: singleTankWall?.overall_u_value_w_m2_k ?? null,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source: singleTankWall
            ? 'linked exhibit tank with governed material conductivity'
            : 'separate linked exhibit tank wall calculations',
        reviewed: false,
        assumption_label: 'Tank thickness from exhibit; conductivity from governed material library',
        basis_version: exports.THERMAL_CONSTRUCTION_BASIS_VERSION,
        source_basis: 'Exhibit tank and governed Thermal material library',
        source_reference: null,
        approval: null,
        layers: null,
        default_layers: null,
        effective_layers: null,
        layer_override_flags: {},
        layer_override_justification: null,
        tank_wall_calculations: tankWallBreakdown,
        mixed_constructions: new Set(tankWallBreakdown.map((wall) => `${wall.material}|${wall.thickness_mm}|${wall.conductivity_w_m_k}`)).size > 1,
    };
    return {
        status: reasons.length ? 'Blocked' : 'Ready',
        reasons,
        water_temperature_basis: waterTemperatureBasis,
        wall_construction_basis: wallConstructionBasis,
        contributions,
        results: {
            effective_water_volume_m3: volume,
            free_surface_area_m2: freeSurface,
            exposed_wall_area_m2: wallArea,
            wall_u_value_w_m2_k: uValue,
            tank_wall_calculations: tankWallBreakdown,
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
function calculateCase(source, inputs, factors = { surface: 1, evaporation: 1, correlation: null }) {
    const reasons = [];
    const common = validateCommonInputs(source, inputs, reasons);
    const waterTemperature = common.water.value;
    const volume = sumNumber((source.effective_volume_sources || []).map((item) => finite(item.effective_water_volume_m3)));
    const freeSurface = sumNumber((source.linked_tanks || []).map((tank) => finite(tank.free_surface_area_m2))) * factors.surface;
    const wallArea = sumNumber((source.linked_tanks || []).map((tank) => resolvedWallArea(tank, inputs))) * factors.surface;
    const wallTankBases = (common.wall.tank_resolutions || []).map(({ tank, resolution }) => wallBasisForTank(tank, resolution, inputs));
    const uValue = wallTankBases.length
        ? sumNumber(wallTankBases.map(basis => basis.u_value_w_m2_k * (basis.exposed_wall_area_m2 || 0))) /
            (wallTankBases.reduce((sum, basis) => sum + (basis.exposed_wall_area_m2 || 0), 0) || 1)
        : common.wall.value;
    const correlation = factors.correlation || common.correlation;
    if (factors.correlation) {
        const sensitivityCorrelationProblems = correlationProblems(factors.correlation, inputs);
        if (sensitivityCorrelationProblems.length) {
            reasons.push(`Sensitivity agitation correlation ${sensitivityCorrelationProblems.join(', ')}.`);
        }
    }
    const surfaceTemperature = finite(inputs.surrounding_surface_temperature_c) ?? common.ambient;
    if (surfaceTemperature == null)
        reasons.push('Effective Radiant Surroundings Temperature is required.');
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
        ? null : exports.THERMAL_CONSTANTS.convection_coefficient_w_m2_k * freeSurface *
        (common.ambient - waterTemperature) / 1000;
    const radiation = waterTemperature == null || surfaceTemperature == null
        ? null : exports.THERMAL_CONSTANTS.emissivity * exports.THERMAL_CONSTANTS.stefan_boltzmann_w_m2_k4 *
        freeSurface * (Math.pow(celsiusToKelvin(surfaceTemperature), 4) -
        Math.pow(celsiusToKelvin(waterTemperature), 4)) / 1000;
    const wallConductionByTank = wallTankBases.map(basis => ({
        ...basis,
        exposed_wall_area_m2: basis.exposed_wall_area_m2 == null
            ? null
            : basis.exposed_wall_area_m2 * factors.surface,
        wall_conduction_kw: waterTemperature == null || common.ambient == null ||
            basis.u_value_w_m2_k == null || basis.exposed_wall_area_m2 == null
            ? null
            : basis.u_value_w_m2_k * basis.exposed_wall_area_m2 *
                (common.ambient - waterTemperature) / 1000 * factors.surface,
        overall_wall_conduction_kw: waterTemperature == null || common.ambient == null ||
            basis.overall_u_value_w_m2_k == null || basis.exposed_wall_area_m2 == null
            ? null
            : basis.overall_u_value_w_m2_k * basis.exposed_wall_area_m2 *
                (common.ambient - waterTemperature) / 1000 * factors.surface,
    }));
    const wallConduction = wallTankBases.length
        ? (waterTemperature == null || common.ambient == null ||
            wallConductionByTank.some(item => item.wall_conduction_kw == null)
            ? null
            : sumNumber(wallConductionByTank.map(item => item.wall_conduction_kw)))
        : waterTemperature == null || common.ambient == null || uValue == null
            ? null : uValue * wallArea * (common.ambient - waterTemperature) / 1000;
    const overallWallConduction = wallTankBases.length
        ? (waterTemperature == null || common.ambient == null ||
            wallConductionByTank.some(item => item.overall_wall_conduction_kw == null)
            ? null
            : sumNumber(wallConductionByTank.map(item => item.overall_wall_conduction_kw)))
        : null;
    const overallUValue = wallTankBases.length
        ? sumNumber(wallTankBases.map(basis => (basis.overall_u_value_w_m2_k || 0) * (basis.exposed_wall_area_m2 || 0))) / (wallTankBases.reduce((sum, basis) => sum + (basis.exposed_wall_area_m2 || 0), 0) || 1)
        : null;
    const evaporation = evaporationCoefficient == null || deltaVapourPressure == null
        ? null : -evaporationCoefficient * freeSurface * Math.max(0, deltaVapourPressure) *
        exports.THERMAL_CONSTANTS.latent_heat_vaporization_j_kg / 1000 * factors.evaporation;
    const lightingCoupling = finite(inputs.lighting_coupling_pct) ?? exports.THERMAL_CONSTANTS.lighting_coupling_pct_suggested;
    if (lightingCoupling < 0 || lightingCoupling > 100)
        reasons.push('Lighting coupling must be between 0% and 100%.');
    const lighting = common.lightingPower * (lightingCoupling / 100);
    const exchangeFlow = inputs.water_exchange_enabled ? positive(inputs.water_exchange_flow_m3h) : 0;
    const exchangeInlet = inputs.water_exchange_enabled ? finite(inputs.water_exchange_inlet_temperature_c) : null;
    const exchange = exchangeFlow && exchangeInlet != null && waterTemperature != null
        ? exchangeFlow * exports.THERMAL_CONSTANTS.water_density_kg_m3 *
            exports.THERMAL_CONSTANTS.water_specific_heat_kj_kg_k * (exchangeInlet - waterTemperature) / 3600
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
    const recovery = volume > 0 ? exports.THERMAL_CONSTANTS.recovery_heating_kw_per_m3 * volume : null;
    if (recovery == null)
        reasons.push('Recovery heating requires a positive effective water volume.');
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
        construction_label: common.wall.construction?.label ||
            common.wall.effective_layers?.[0]?.material ||
            common.wall.layers?.[0]?.material ||
            null,
        material: common.wall.effective_layers?.[0]?.material ||
            common.wall.layers?.[0]?.material ||
            common.wall.construction?.material ||
            null,
        thickness_mm: common.wall.effective_layers?.[0]?.thickness_m != null
            ? common.wall.effective_layers[0].thickness_m * 1000
            : common.wall.layers?.[0]?.thickness_m != null
                ? common.wall.layers[0].thickness_m * 1000
                : common.wall.construction?.thickness_mm ?? null,
        conductivity_w_m_k: common.wall.effective_layers?.[0]?.conductivity_w_m_k ??
            common.wall.layers?.[0]?.conductivity_w_m_k ??
            common.wall.construction?.conductivity_w_m_k ??
            null,
        material_resistance_m2_k_w: wallTankBases.length === 1
            ? wallTankBases[0].material_resistance_m2_k_w ?? null
            : null,
        material_u_value_w_m2_k: wallTankBases.length === 1
            ? wallTankBases[0].material_u_value_w_m2_k ?? null
            : null,
        overall_resistance_m2_k_w: wallTankBases.length === 1
            ? wallTankBases[0].overall_resistance_m2_k_w ?? null
            : null,
        overall_u_value_w_m2_k: wallTankBases.length === 1
            ? wallTankBases[0].overall_u_value_w_m2_k ?? null
            : overallUValue,
        u_value_w_m2_k: uValue,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source: common.wall.source,
        reviewed: common.wall.reviewed === true,
        assumption_label: common.wall.assumption_label || null,
        basis_version: common.wall.basis_version || null,
        source_basis: common.wall.source_basis || null,
        source_reference: common.wall.source_reference || null,
        approval: common.wall.approval || null,
        layers: common.wall.effective_layers || common.wall.layers || null,
        default_layers: common.wall.default_layers || null,
        effective_layers: common.wall.effective_layers || common.wall.layers || null,
        layer_override_flags: common.wall.layer_override_flags || {},
        layer_override_justification: common.wall.layer_override_justification || null,
        tank_bases: wallTankBases,
    };
    return {
        status: reasons.length ? 'Blocked' : 'Ready',
        reasons,
        water_temperature_basis: waterTemperatureBasis,
        wall_construction_basis: wallConstructionBasis,
        contributions,
        results: {
            effective_water_volume_m3: volume,
            free_surface_area_m2: freeSurface,
            exposed_wall_area_m2: wallArea,
            wall_u_value_w_m2_k: uValue,
            overall_wall_u_value_w_m2_k: overallUValue,
            wall_conduction_by_tank: wallConductionByTank,
            overall_wall_conduction_kw: overallWallConduction,
            // Retain the earlier detailed-result field while the task-specific
            // breakdown name is adopted by the mixed-wall UI.
            tank_wall_calculations: wallConductionByTank,
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
function adjacentCases(source, inputs) {
    const configured = inputs.agitation_correlations || inputs.agitation_correlation;
    const classes = configured && !Array.isArray(configured)
        ? Object.keys(configured)
        : Array.isArray(inputs.adjacent_agitation_classes) ? inputs.adjacent_agitation_classes : [];
    return classes
        .filter(value => value !== inputs.agitation_class && correlationFor(inputs, value))
        .slice(0, 2);
}
function calculateThermalCalculation(source, inputs = {}, calculatedAt = new Date().toISOString()) {
    const normalizedInputs = {
        relative_humidity_pct: 60,
        surrounding_surface_temperature_c: inputs.ambient_air_temperature_c ?? null,
        lighting_coupling_pct: exports.THERMAL_CONSTANTS.lighting_coupling_pct_suggested,
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
    const resolvedSource = sourceWithResolvedWallSources(source, normalizedInputs, base.wall_construction_basis);
    normalizedInputs.water_temperature_basis = base.water_temperature_basis;
    normalizedInputs.wall_construction_basis = base.wall_construction_basis;
    const sensitivityCases = [];
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
    const reasonable = allCases.filter(item => item.status === 'Ready').reduce((selected, item) => {
        if (!selected)
            return item;
        const selectedCapacity = Math.max(selected.results.margin_adjusted_cooling_kw || 0, selected.results.margin_adjusted_heating_kw || 0);
        const capacity = Math.max(item.results.margin_adjusted_cooling_kw || 0, item.results.margin_adjusted_heating_kw || 0);
        return capacity > selectedCapacity ? item : selected;
    }, null);
    return {
        calculation_version: exports.THERMAL_CALCULATION_VERSION,
        calculated_at: calculatedAt,
        status: base.status,
        freshness: 'fresh',
        is_stale: false,
        source_fingerprint: source.fingerprint || thermalFingerprint(source),
        source_snapshot: resolvedSource,
        inputs: normalizedInputs,
        correlation_snapshot: normalizedInputs.agitation_correlation_snapshot || null,
        constants: exports.THERMAL_CONSTANTS,
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
function thermalDisplayValue(value, kind) {
    return round(value, exports.THERMAL_ROUNDING[kind]);
}
function wallBasisForTank(tank, resolution, inputs) {
    const layers = resolution.effective_layers || resolution.layers;
    const layer = layers?.[0];
    const area = resolvedWallArea(tank, inputs);
    const materialResistance = resolution.material_resistance_m2_k_w ??
        (Array.isArray(layers) && layers.every((item) => positive(item?.thickness_m) != null && positive(item?.conductivity_w_m_k) != null)
            ? layers.reduce((sum, item) => sum + Number(item.thickness_m) / Number(item.conductivity_w_m_k), 0)
            : null);
    const properties = calculatedWallPropertiesFromResistance(materialResistance);
    return {
        tank_id: tank.tank_id || null,
        tank_code: tank.tank_code || null,
        exhibit_id: tank.exhibit_id || null,
        exhibit_code: tank.exhibit_code || null,
        quantity: tank.quantity ?? 1,
        exposed_wall_area_m2: area,
        wall_area_source: resolvedWallSource(tank, inputs),
        construction_type: resolution.construction?.code || null,
        construction_label: resolution.construction?.label ||
            layer?.material || resolution.layers?.[0]?.material || null,
        material: layer?.material || resolution.construction?.material || tank.wall_material || null,
        thickness_mm: layer?.thickness_m != null
            ? layer.thickness_m * 1000
            : resolution.construction?.thickness_mm ?? tank.wall_thickness_mm ?? null,
        conductivity_w_m_k: layer?.conductivity_w_m_k ||
            resolution.construction?.conductivity_w_m_k || null,
        u_value_w_m2_k: resolution.value,
        material_resistance_m2_k_w: properties?.material_resistance_m2_k_w ?? null,
        material_u_value_w_m2_k: properties?.material_u_value_w_m2_k ?? null,
        overall_resistance_m2_k_w: properties?.overall_resistance_m2_k_w ?? null,
        overall_u_value_w_m2_k: properties?.overall_u_value_w_m2_k ?? null,
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        source: resolution.source,
        reviewed: resolution.reviewed === true,
        assumption_label: resolution.assumption_label || null,
        basis_version: resolution.basis_version || null,
        source_basis: resolution.source_basis || null,
        source_reference: resolution.source_reference || null,
        approval: resolution.approval || null,
        layers: layers || null,
        default_layers: resolution.default_layers || null,
        effective_layers: resolution.effective_layers || resolution.layers || null,
        layer_override_flags: resolution.layer_override_flags || {},
        layer_override_justification: resolution.layer_override_justification || null,
    };
}
