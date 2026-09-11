"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HYDROSTATIC_LOAD_FACTOR = exports.GRAVITY_M_S2 = exports.TANK_DESIGN_SHEET_VERSION = void 0;
exports.normalizeExhibitWaterType = normalizeExhibitWaterType;
exports.resolveWaterDensityKgM3 = resolveWaterDensityKgM3;
exports.buildTankDesignSheet = buildTankDesignSheet;
/**
 * Canonical, deliberately small tank design-sheet model.  It contains no
 * database or HTTP concerns so the same engineering basis is used by previews,
 * PDFs and tests.
 */
exports.TANK_DESIGN_SHEET_VERSION = 'aat-tank-design-sheet-v1';
exports.GRAVITY_M_S2 = 9.80665;
exports.HYDROSTATIC_LOAD_FACTOR = 1.2;
const finite = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
function normalizeExhibitWaterType(value) {
    const normal = String(value ?? '').trim().toLowerCase().replace(/[_\-/]+/g, ' ');
    if (!normal)
        return null;
    if (normal.includes('fresh'))
        return 'freshwater';
    if (normal.includes('sea') || normal.includes('marine') || normal.includes('salt'))
        return 'seawater';
    if (normal.includes('brack'))
        return 'brackish';
    return normal.replace(/\s+/g, '_');
}
function parameterWaterType(row) {
    return normalizeExhibitWaterType(row?.water_type ?? row?.water_type_code ?? row?.chemical_type ?? row?.name);
}
function isActive(row) {
    // Catalog migrations have historically used both conventions.  A missing
    // state is treated as active for backwards-compatible seeded records.
    if (row?.is_active !== undefined && row?.is_active !== null)
        return row.is_active === true || row.is_active === 1 || row.is_active === 'true';
    if (row?.active !== undefined && row?.active !== null)
        return row.active === true || row.active === 1 || row.active === 'true';
    return !row?.status || String(row.status).trim().toLowerCase() === 'active';
}
function resolveWaterDensityKgM3(waterType, parameters) {
    const normalized = normalizeExhibitWaterType(waterType);
    const candidate = (parameters || []).find(row => isActive(row) && parameterWaterType(row) === normalized);
    const density = finite(candidate?.density_kg_m3 ?? candidate?.density ?? candidate?.water_density_kg_m3);
    return {
        water_type: normalized,
        density_kg_m3: density != null && density > 0 ? density : null,
        parameter_id: candidate?.id ?? null,
        catalog_source: candidate?.source ?? null,
        conditions: candidate?.conditions ?? null,
        unit: candidate?.unit ?? 'kg/m3',
        is_active: candidate?.is_active === true,
        source: candidate ? 'water_density_parameters' : 'missing water_density_parameters',
    };
}
function ambientFromThermal(rows, tank) {
    const systemId = tank?.system_id;
    const candidates = [...(rows || [])].sort((a, b) => Number(String(b.system_id) === String(systemId)) - Number(String(a.system_id) === String(systemId)));
    for (const row of candidates) {
        if ((row?.freshness != null && row.freshness !== 'fresh') ||
            (row?.status != null && row.status !== 'Ready'))
            continue;
        const calculation = row?.result_snapshot || row?.calculation || row?.results || row;
        const value = finite(calculation?.ambient_air_temperature_c ?? calculation?.results?.ambient_air_temperature_c ??
            row?.input_snapshot?.ambient_air_temperature_c ?? row?.formula_inputs?.ambient_air_temperature_c);
        if (value != null)
            return { ambient_air_temperature_c: value, source: 'applicable Thermal calculation', thermal_calculation_id: row?.id ?? null, system_id: row?.system_id ?? null };
    }
    return { ambient_air_temperature_c: null, source: 'No value/TBC — no applicable Thermal calculation', thermal_calculation_id: null, system_id: null };
}
function buildTankDesignSheet(args) {
    const tank = args.tank || {};
    const exhibit = args.exhibit || {};
    const maximumWaterLevelMm = finite(tank.eff_water_level_mm ?? tank.design_water_level_mm ?? tank.maximum_water_level_mm);
    const overflowLevelMm = finite(tank.overflow_level_mm);
    const density = resolveWaterDensityKgM3(exhibit.water_type ?? tank.water_type, args.chemicalParameters || []);
    const waterTemperatureC = finite(exhibit.design_temperature_max ?? exhibit.design_temperature_min);
    const thermal = ambientFromThermal(args.thermalCalculations || [], tank);
    const validation = [];
    if (maximumWaterLevelMm == null || maximumWaterLevelMm <= 0)
        validation.push({ field: 'design_water_level_mm', message: 'Effective maximum/design water level is required.' });
    if (overflowLevelMm == null)
        validation.push({ field: 'overflow_level_mm', message: 'Overflow level is TBC.' });
    else if (maximumWaterLevelMm != null && overflowLevelMm <= maximumWaterLevelMm)
        validation.push({ field: 'overflow_level_mm', message: 'Overflow level must be above the effective maximum/design water level.' });
    if (density.density_kg_m3 == null)
        validation.push({ field: 'water_type', message: 'An active chemical parameter density is required for the exhibit water type.' });
    const pressure = density.density_kg_m3 != null && maximumWaterLevelMm != null && maximumWaterLevelMm > 0
        ? density.density_kg_m3 * exports.GRAVITY_M_S2 * (maximumWaterLevelMm / 1000) * exports.HYDROSTATIC_LOAD_FACTOR / 1000
        : null;
    const tbcs = [
        ...(waterTemperatureC == null ? ['Water temperature is TBC (exhibit design temperature unavailable).'] : []),
        ...(thermal.ambient_air_temperature_c == null ? ['Ambient temperature is TBC (no applicable Thermal calculation).'] : []),
        ...(overflowLevelMm == null ? ['Overflow level is TBC.'] : []),
        ...(density.density_kg_m3 == null ? ['Water density is TBC (active chemical parameter unavailable).'] : []),
    ];
    return {
        calculation_version: exports.TANK_DESIGN_SHEET_VERSION,
        generated_at: new Date().toISOString(),
        project: {
            id: args.project?.id ?? tank.project_id ?? null,
            project_code: args.project?.project_code ?? tank.project_code ?? null,
            project_name: args.project?.project_name ?? tank.project_name ?? null,
        },
        exhibit: {
            id: exhibit.id ?? tank.exhibit_id ?? null, exhibit_code: exhibit.exhibit_code ?? null,
            exhibit_name: exhibit.exhibit_name ?? null, water_type: density.water_type,
            water_temperature_min_c: finite(exhibit.design_temperature_min),
            water_temperature_max_c: finite(exhibit.design_temperature_max),
        },
        tank: {
            id: tank.id ?? null, tank_code: tank.tank_code ?? null, tank_name: tank.tank_name ?? null,
            shape_type: tank.eff_shape ?? tank.shape_type ?? null,
            dimensions_mm: {
                length: finite(tank.eff_length_mm ?? tank.length_mm), width: finite(tank.eff_width_mm ?? tank.width_mm),
                height: finite(tank.eff_height_mm ?? tank.height_mm),
            },
            gross_volume_m3: finite(tank.gross_volume_m3),
            operating_volume_m3: finite(tank.design_volume_m3 ?? tank.operating_volume_m3),
            maximum_water_level_mm: maximumWaterLevelMm, overflow_level_mm: overflowLevelMm,
        },
        design_basis: {
            required_life_years: 50,
            atmosphere: 'Open atmosphere',
            external_pressure: 'Atmospheric',
            vacuum: 'No vacuum',
            water_type: density.water_type,
            density_kg_m3: density.density_kg_m3,
            density_provenance: density,
            water_temperature_c: waterTemperatureC,
            water_temperature_min_c: finite(exhibit.design_temperature_min),
            water_temperature_max_c: finite(exhibit.design_temperature_max),
            ambient_air_temperature_c: thermal.ambient_air_temperature_c,
            ambient_temperature_source: thermal.source,
            thermal_calculation_id: thermal.thermal_calculation_id,
        },
        hydrostatic_pressure: {
            formula: 'rho × g × maximum water depth × 1.2',
            load_factor: exports.HYDROSTATIC_LOAD_FACTOR,
            gravity_m_s2: exports.GRAVITY_M_S2,
            maximum_water_depth_m: maximumWaterLevelMm == null ? null : maximumWaterLevelMm / 1000,
            pressure_kpa: pressure == null ? null : Number(pressure.toFixed(3)),
        },
        tbcs: [...tbcs,
            'Seismic loads are TBC.', 'Wind loads are TBC.', 'Access platform loads are TBC.',
            'Nozzle sizes and loads are TBC.', 'Supports and anchorage are TBC.',
        ],
        validation: { valid: validation.length === 0, errors: validation },
    };
}
