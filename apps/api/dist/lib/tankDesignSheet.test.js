"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const tankDesignSheet_1 = require("./tankDesignSheet");
(0, vitest_1.describe)('tank design sheet', () => {
    (0, vitest_1.it)('normalizes exhibit water types and uses an active matching density', () => {
        const model = (0, tankDesignSheet_1.buildTankDesignSheet)({
            tank: { tank_code: 'TK-01', design_water_level_mm: 2000, overflow_level_mm: 2100 },
            exhibit: { water_type: 'Marine / Salt Water', design_temperature_max: 26 },
            chemicalParameters: [
                { id: 'density-1', water_type: 'seawater', density_kg_m3: 1025, status: 'Active', is_active: true, unit: 'kg/m3', conditions: '20 C', source: 'Governed source' },
                { water_type: 'seawater', density_kg_m3: 900, status: 'Inactive' },
            ],
            thermalCalculations: [{ result_snapshot: { ambient_air_temperature_c: 22 } }],
        });
        (0, vitest_1.expect)((0, tankDesignSheet_1.normalizeExhibitWaterType)('Marine / Salt Water')).toBe('seawater');
        (0, vitest_1.expect)(model.design_basis.density_kg_m3).toBe(1025);
        (0, vitest_1.expect)(model.hydrostatic_pressure.pressure_kpa).toBe(24.124);
        (0, vitest_1.expect)(model.validation.valid).toBe(true);
        (0, vitest_1.expect)(model.tbcs).toContain('Seismic loads are TBC.');
        (0, vitest_1.expect)(model.design_basis.density_provenance).toMatchObject({
            parameter_id: 'density-1', unit: 'kg/m3', is_active: true, conditions: '20 C', catalog_source: 'Governed source',
        });
    });
    (0, vitest_1.it)('makes unresolved engineering data explicit TBCs', () => {
        const model = (0, tankDesignSheet_1.buildTankDesignSheet)({
            tank: { design_water_level_mm: 1000 },
            exhibit: { water_type: 'freshwater' },
        });
        (0, vitest_1.expect)(model.validation.valid).toBe(false);
        (0, vitest_1.expect)(model.tbcs.join(' ')).toContain('Overflow level is TBC');
        (0, vitest_1.expect)(model.tbcs.join(' ')).toContain('Water density is TBC');
        (0, vitest_1.expect)(model.tbcs.join(' ')).toContain('Ambient temperature is TBC');
        (0, vitest_1.expect)(model.hydrostatic_pressure.pressure_kpa).toBeNull();
    });
    (0, vitest_1.it)('rejects an overflow level at or below the effective water level', () => {
        const model = (0, tankDesignSheet_1.buildTankDesignSheet)({
            tank: { eff_water_level_mm: 1800, overflow_level_mm: 1800 },
            exhibit: { water_type: 'fresh water', design_temperature_min: 20 },
            chemicalParameters: [{ water_type: 'Freshwater', density: 1000, is_active: true }],
        });
        (0, vitest_1.expect)(model.validation.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'overflow_level_mm' }));
    });
    (0, vitest_1.it)('ignores stale and blocked Thermal calculations', () => {
        const base = {
            tank: { design_water_level_mm: 1000, overflow_level_mm: 1100 },
            exhibit: { water_type: 'freshwater', design_temperature_min: 20 },
            chemicalParameters: [{ water_type: 'Freshwater', density_kg_m3: 998.2, is_active: true }],
        };
        const model = (0, tankDesignSheet_1.buildTankDesignSheet)({
            ...base,
            thermalCalculations: [
                { status: 'Ready', freshness: 'stale', result_snapshot: { ambient_air_temperature_c: 30 } },
                { status: 'Blocked', freshness: 'fresh', result_snapshot: { ambient_air_temperature_c: 29 } },
                { status: 'Ready', freshness: 'fresh', result_snapshot: { ambient_air_temperature_c: 22 } },
            ],
        });
        (0, vitest_1.expect)(model.design_basis.ambient_air_temperature_c).toBe(22);
    });
    (0, vitest_1.it)('uses a linked-exhibit Thermal result when no direct tank system exists', () => {
        const model = (0, tankDesignSheet_1.buildTankDesignSheet)({
            tank: { design_water_level_mm: 1000, overflow_level_mm: 1100, system_id: null },
            exhibit: { water_type: 'freshwater' },
            chemicalParameters: [{ id: 'fresh', water_type: 'Freshwater', density_kg_m3: 998.2, is_active: true }],
            thermalCalculations: [{ id: 'thermal-link', system_id: 'linked-system', result_snapshot: { ambient_air_temperature_c: 19 } }],
        });
        (0, vitest_1.expect)(model.design_basis.ambient_air_temperature_c).toBe(19);
        (0, vitest_1.expect)(model.design_basis.thermal_calculation_id).toBe('thermal-link');
    });
    (0, vitest_1.it)('does not use inactive density catalog records', () => {
        const model = (0, tankDesignSheet_1.buildTankDesignSheet)({
            tank: { design_water_level_mm: 1000, overflow_level_mm: 1100 },
            exhibit: { water_type: 'Seawater' },
            chemicalParameters: [{ id: 'old', water_type: 'Seawater', density_kg_m3: 1025, is_active: false }],
        });
        (0, vitest_1.expect)(model.design_basis.density_kg_m3).toBeNull();
        (0, vitest_1.expect)(model.validation.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'water_type' }));
    });
});
