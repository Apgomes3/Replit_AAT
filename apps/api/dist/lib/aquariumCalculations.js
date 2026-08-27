"use strict";
/**
 * Approved aquarium engineering calculation definitions.
 *
 * Keep the values returned by this module deliberately explicit.  The UI can
 * render the inputs, formula and rounding rules without having to recreate
 * any engineering logic of its own.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundEngineering = exports.FLOW_DECIMALS = exports.VOLUME_DECIMALS = exports.ALLOCATION_TOLERANCE_PCT = exports.FLOW_UNIT = exports.TURNOVER_UNIT = exports.AQUARIUM_CALCULATION_VERSION = void 0;
exports.compatibleWaterTypes = compatibleWaterTypes;
exports.calculateTankOperatingVolume = calculateTankOperatingVolume;
exports.calculateExhibitHydraulics = calculateExhibitHydraulics;
exports.evaluateCompactUnit = evaluateCompactUnit;
exports.calculateSystemEngineering = calculateSystemEngineering;
exports.AQUARIUM_CALCULATION_VERSION = 'aquarium-hydraulics-v1';
exports.TURNOVER_UNIT = 'cycles_per_hour';
exports.FLOW_UNIT = 'm3_per_hour';
exports.ALLOCATION_TOLERANCE_PCT = 0.01;
exports.VOLUME_DECIMALS = 4;
exports.FLOW_DECIMALS = 3;
const numberOrNull = (value) => {
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
};
const positiveOrNull = (value) => {
    const result = numberOrNull(value);
    return result != null && result > 0 ? result : null;
};
const roundEngineering = (value, decimals) => value == null || !Number.isFinite(value) ? null : Number(value.toFixed(decimals));
exports.roundEngineering = roundEngineering;
function compatibleWaterTypes(left, right) {
    if (!left || !right)
        return true;
    const normalize = (value) => {
        const type = value.toLowerCase().replace(/[\s_-]+/g, '');
        if (type === 'saltwater' || type === 'marine')
            return 'marine';
        if (type === 'universal')
            return 'universal';
        return type;
    };
    const a = normalize(left);
    const b = normalize(right);
    return a === b || a === 'universal' || b === 'universal';
}
function dimension(tank, key) {
    return positiveOrNull(tank?.[key]);
}
/**
 * Returns the raw operating volume before substrate/theming displacement.
 * Dimensions are in millimetres and the result is m³.  A wall thickness
 * removes two side panels and one bottom panel for an open-top tank.
 */
function calculateTankOperatingVolume(tank) {
    const shape = String(tank?.eff_shape || tank?.shape_type || '').toLowerCase();
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
    let calculated = null;
    let footprintArea = null;
    let formula = '';
    if (shape === 'custom') {
        calculated = positiveOrNull(tank?.operating_volume_m3 ?? tank?.design_volume_m3);
        footprintArea = positiveOrNull(tank?.surface_area_m2);
        formula = 'Stored operating volume (custom tank)';
    }
    else if (shape === 'cylindrical' && innerWidth != null && innerWidth > 0 &&
        operatingHeight != null && operatingHeight > 0) {
        footprintArea = Math.PI * Math.pow(innerWidth / 2, 2) / 1e6;
        calculated = Math.PI * Math.pow(innerWidth / 2, 2) * operatingHeight / 1e9;
        formula = 'π × (inner diameter ÷ 2)² × operating water height ÷ 1,000,000,000';
    }
    else if (shape !== 'cylindrical' && innerLength != null && innerLength > 0 &&
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
            value_m3: (0, exports.roundEngineering)(calculated, exports.VOLUME_DECIMALS),
            footprint_area_m2: (0, exports.roundEngineering)(footprintArea, exports.VOLUME_DECIMALS),
            source: footprintArea == null ? 'stored' : 'dimensions',
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
function displacementVolume(record, prefix, footprintAreaM2, operatingVolumeM3) {
    const direct = positiveOrNull(record?.[`${prefix}_volume_m3`]);
    if (direct != null)
        return { value_m3: direct, source: 'direct volume override', input: direct };
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
function calculateExhibitHydraulics(exhibit, tanks, hydraulics, substrate, calculatedAt = new Date().toISOString()) {
    const tankDetails = (tanks || []).map(tank => {
        const volume = calculateTankOperatingVolume(tank);
        const quantity = Math.max(1, Number.parseInt(String(tank.quantity ?? 1), 10) || 1);
        return { tank_id: tank.id, tank_code: tank.tank_code, quantity, ...volume,
            total_value_m3: volume.value_m3 == null ? null : (0, exports.roundEngineering)(volume.value_m3 * quantity, exports.VOLUME_DECIMALS) };
    });
    const rawOperating = tankDetails.reduce((sum, tank) => sum + (tank.total_value_m3 || 0), 0);
    const footprintArea = tankDetails.reduce((sum, tank) => sum + (tank.footprint_area_m2 || 0) * tank.quantity, 0);
    const substrateResult = displacementVolume(substrate, 'substrate', footprintArea, rawOperating);
    const themingResult = displacementVolume(substrate, 'theming', footprintArea, rawOperating);
    const displaced = substrateResult.value_m3 + themingResult.value_m3;
    const effectiveOperating = Math.max(0, rawOperating - displaced);
    const turnover = positiveOrNull(hydraulics?.target_turnover_rate);
    const surfacePct = numberOrNull(hydraulics?.surface_skim_pct) ?? 30;
    const bottomPct = numberOrNull(hydraulics?.bottom_drain_pct) ?? 70;
    const allocationTotal = surfacePct + bottomPct;
    const totalFlow = turnover == null || effectiveOperating <= 0 ? null : effectiveOperating * turnover;
    const surfaceFlow = totalFlow == null ? null : totalFlow * surfacePct / 100;
    const bottomFlow = totalFlow == null ? null : totalFlow * bottomPct / 100;
    const reasons = [];
    for (const [label, value] of [
        ['Substrate volume', substrate?.substrate_volume_m3],
        ['Substrate height', substrate?.substrate_height_mm],
        ['Theming volume', substrate?.theming_volume_m3],
        ['Theming height', substrate?.theming_height_mm],
        ['Theming percentage', substrate?.theming_volume_pct],
    ]) {
        if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            reasons.push(`${label} must be a finite, non-negative value.`);
        }
    }
    if (numberOrNull(substrate?.theming_volume_pct) != null &&
        Number(substrate.theming_volume_pct) > 100) {
        reasons.push('Theming percentage cannot exceed 100%.');
    }
    if (positiveOrNull(substrate?.substrate_height_mm) != null && footprintArea <= 0) {
        reasons.push('Substrate height requires tank footprint dimensions; enter a direct substrate volume for custom tanks.');
    }
    if (positiveOrNull(substrate?.theming_height_mm) != null && footprintArea <= 0) {
        reasons.push('Theming height requires tank footprint dimensions; enter a direct theming volume for custom tanks.');
    }
    if (rawOperating <= 0)
        reasons.push('Operating volume is missing or invalid.');
    if (rawOperating > 0 && displaced >= rawOperating) {
        reasons.push('Substrate and theming displacement must be less than gross operating volume.');
    }
    if (turnover == null)
        reasons.push('Turnover target must be greater than zero.');
    if (surfacePct < 0 || surfacePct > 100 || bottomPct < 0 || bottomPct > 100) {
        reasons.push('Surface and bottom allocation percentages must each be between 0% and 100%.');
    }
    if (Math.abs(allocationTotal - 100) > exports.ALLOCATION_TOLERANCE_PCT) {
        reasons.push(`Surface and bottom allocations must total 100% ± ${exports.ALLOCATION_TOLERANCE_PCT}%.`);
    }
    return {
        calculation_version: exports.AQUARIUM_CALCULATION_VERSION,
        calculated_at: calculatedAt,
        status: reasons.length ? 'invalid' : 'valid',
        freshness: 'fresh',
        is_stale: false,
        reasons,
        inputs: {
            exhibit_id: exhibit?.id || null,
            water_type: exhibit?.water_type || null,
            turnover_unit: exports.TURNOVER_UNIT,
            flow_unit: exports.FLOW_UNIT,
            tank_count: tankDetails.length,
            tanks: tankDetails,
            gross_operating_volume_m3: (0, exports.roundEngineering)(rawOperating, exports.VOLUME_DECIMALS),
            substrate_volume_m3: (0, exports.roundEngineering)(substrateResult.value_m3, exports.VOLUME_DECIMALS),
            substrate_source: substrateResult.source,
            theming_volume_m3: (0, exports.roundEngineering)(themingResult.value_m3, exports.VOLUME_DECIMALS),
            theming_source: themingResult.source,
            target_turnover_rate_cycles_per_hour: turnover,
            surface_skim_pct: surfacePct,
            bottom_drain_pct: bottomPct,
        },
        results: {
            operating_volume_m3: (0, exports.roundEngineering)(effectiveOperating, exports.VOLUME_DECIMALS),
            total_return_flow_m3h: (0, exports.roundEngineering)(totalFlow, exports.FLOW_DECIMALS),
            surface_skim_flow_m3h: (0, exports.roundEngineering)(surfaceFlow, exports.FLOW_DECIMALS),
            bottom_drain_flow_m3h: (0, exports.roundEngineering)(bottomFlow, exports.FLOW_DECIMALS),
            allocation_total_pct: (0, exports.roundEngineering)(allocationTotal, 2),
        },
        formula: 'effective operating volume = gross operating volume − substrate displacement − theming displacement; return flow = effective operating volume × turnover',
        rounding: `Volumes rounded to ${exports.VOLUME_DECIMALS} decimals m³; flows rounded to ${exports.FLOW_DECIMALS} decimals m³/h.`,
    };
}
function evaluateCompactUnit(unit, waterType, operatingVolumeM3, requiredFlowM3h) {
    if (!unit) {
        return {
            status: 'warning',
            suitable: null,
            reasons: ['No compact unit selected; bespoke system guidance applies.'],
        };
    }
    const reasons = [];
    const volume = numberOrNull(operatingVolumeM3);
    const flow = numberOrNull(requiredFlowM3h);
    const minVolume = numberOrNull(unit.min_tank_volume_m3);
    const maxVolume = numberOrNull(unit.max_tank_volume_m3);
    const maxFlow = numberOrNull(unit.max_flow_m3h);
    if (volume == null || volume <= 0)
        reasons.push('Operating volume is required to confirm compact-unit suitability.');
    if (minVolume != null && volume != null && volume < minVolume)
        reasons.push(`Volume is below the catalog minimum of ${minVolume} m³.`);
    if (maxVolume != null && volume != null && volume > maxVolume)
        reasons.push(`Volume exceeds the catalog maximum of ${maxVolume} m³.`);
    if (maxFlow != null && flow != null && flow > maxFlow)
        reasons.push(`Required flow exceeds the catalog maximum of ${maxFlow} m³/h.`);
    if (!compatibleWaterTypes(waterType, unit.water_type))
        reasons.push(`Water type ${waterType} is incompatible with ${unit.water_type} compact equipment.`);
    if (unit.status && unit.status !== 'Active')
        reasons.push(`Catalog unit is ${unit.status.toLowerCase()}.`);
    return {
        status: reasons.length ? 'invalid' : 'valid',
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
function calculateSystemEngineering(system, links, exhibitCalculations, compactUnit, calculatedAt = new Date().toISOString()) {
    const linked = (links || []).map(link => {
        const exhibit = exhibitCalculations.find(calc => calc.inputs.exhibit_id === link.exhibit_id);
        const required = exhibit?.results.total_return_flow_m3h ?? null;
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
        };
    });
    const requiredFlow = linked.reduce((sum, link) => sum + (link.required_flow_m3h || 0), 0);
    const allocatedFlow = linked.reduce((sum, link) => sum + (link.allocation_m3h || 0), 0);
    const savedFlow = positiveOrNull(system?.design_flow_m3h);
    const savedTurnover = positiveOrNull(system?.turnover_rate_hr);
    const storedFlowDiffers = savedFlow != null && requiredFlow > 0 &&
        Math.abs(savedFlow - requiredFlow) > 0.005;
    const reasons = [];
    for (const link of linked) {
        const linkedCalculation = exhibitCalculations.find(item => item.inputs.exhibit_id === link.exhibit_id);
        if (!linkedCalculation) {
            reasons.push(`Linked exhibit ${link.exhibit_code || link.exhibit_id} has no engineering calculation.`);
        }
        else if (linkedCalculation.status === 'invalid') {
            const detail = linkedCalculation.reasons?.join(' ') || 'Invalid engineering inputs.';
            reasons.push(`Linked exhibit ${link.exhibit_code || link.exhibit_id} is invalid: ${detail}`);
        }
    }
    if (Math.abs(allocatedFlow - requiredFlow) > 0.005 && requiredFlow > 0) {
        reasons.push('Exhibit allocations do not equal the calculated required system flow.');
    }
    const primary = linked.find(link => link.link_type === 'Primary') || linked[0];
    const primaryCalc = primary && exhibitCalculations.find(calc => calc.inputs.exhibit_id === primary.exhibit_id);
    const turnover = primaryCalc?.inputs.target_turnover_rate_cycles_per_hour ?? null;
    const unitResult = system?.system_config === 'compact'
        ? evaluateCompactUnit(compactUnit, system?.water_type || primaryCalc?.inputs.water_type || null, linked.reduce((sum, link) => {
            const calc = exhibitCalculations.find(item => item.inputs.exhibit_id === link.exhibit_id);
            return sum + (calc?.results.operating_volume_m3 || 0);
        }, 0), requiredFlow || savedFlow)
        : {
            status: 'warning',
            suitable: null,
            reasons: ['Bespoke system selected; no compact catalog limits apply.'],
        };
    if (system?.system_config === 'compact')
        reasons.push(...unitResult.reasons);
    return {
        calculation_version: exports.AQUARIUM_CALCULATION_VERSION,
        calculated_at: calculatedAt,
        status: reasons.length ? 'invalid' : storedFlowDiffers ? 'override' : 'valid',
        freshness: storedFlowDiffers ? 'override' : 'fresh',
        is_stale: false,
        reasons,
        inputs: {
            system_id: system?.id || null,
            flow_unit: exports.FLOW_UNIT,
            turnover_unit: exports.TURNOVER_UNIT,
            linked_exhibits: linked.length,
            saved_design_flow_m3h: savedFlow,
            saved_turnover_rate_cycles_per_hour: savedTurnover,
            system_water_type: system?.water_type || null,
        },
        results: {
            calculated_required_flow_m3h: (0, exports.roundEngineering)(requiredFlow, exports.FLOW_DECIMALS),
            allocated_flow_m3h: (0, exports.roundEngineering)(allocatedFlow, exports.FLOW_DECIMALS),
            design_flow_m3h: (0, exports.roundEngineering)(savedFlow ?? requiredFlow, exports.FLOW_DECIMALS),
            turnover_rate_cycles_per_hour: turnover,
            allocation_total_m3h: (0, exports.roundEngineering)(allocatedFlow, exports.FLOW_DECIMALS),
            flow_override_m3h: storedFlowDiffers ? savedFlow : null,
        },
        allocations: linked,
        suitability: unitResult,
        formula: 'system required flow = sum of linked exhibit return flows; unassigned exhibit allocations use calculated flow',
        rounding: `Flows rounded to ${exports.FLOW_DECIMALS} decimals m³/h; comparison tolerance is 0.005 m³/h.`,
    };
}
