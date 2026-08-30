"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const thermalCalculations_1 = require("./thermalCalculations");
function readySource() {
    return (0, thermalCalculations_1.buildThermalSourceContext)({
        system: { id: 'system-1', system_code: 'LSS-1', design_flow_m3h: 120 },
        links: [{ system_id: 'system-1', exhibit_id: 'exhibit-1' }],
        exhibits: [{
                id: 'exhibit-1',
                exhibit_code: 'EX-1',
                design_temperature_min: 25,
                design_temperature_max: 25,
            }],
        tanks: [{
                id: 'tank-1',
                tank_code: 'TK-1',
                exhibit_id: 'exhibit-1',
                quantity: 1,
                shape_type: 'Rectangular',
                surface_area_m2: 10,
                inner_length_mm: 5000,
                inner_width_mm: 2000,
                design_water_level_mm: 1500,
                operating_volume_m3: 15,
            }],
        exhibitCalculations: [{
                status: 'valid',
                freshness: 'fresh',
                inputs: { exhibit_id: 'exhibit-1' },
                results: { operating_volume_m3: 14 },
            }],
    });
}
function readyInputs() {
    return {
        ambient_air_temperature_c: 20,
        relative_humidity_pct: 60,
        surrounding_surface_temperature_c: 20,
        atmospheric_pressure_kpa: 101.325,
        agitation_class: 'Moderate',
        agitation_correlation_class: 'Moderate',
        agitation_correlation_version: 'reviewed-2026',
        agitation_correlation_approved: true,
        evaporation_coefficient_kg_m2_s_kpa: 0.000001,
        reviewed_u_value_w_m2_k: 3,
        equipment_heat_gain_kw: 2,
        lighting_power_kw: 1,
        lighting_coupling_pct: 85,
        capacity_margin_pct: 10,
    };
}
(0, vitest_1.describe)('AAT thermal calculation', () => {
    (0, vitest_1.it)('uses the approved signs, constants, and 1°C-in-6-hour recovery duty', () => {
        const result = (0, thermalCalculations_1.calculateThermalCalculation)(readySource(), readyInputs(), '2026-08-30T00:00:00.000Z');
        (0, vitest_1.expect)(result.status).toBe('Ready');
        (0, vitest_1.expect)(result.contributions.convection_kw).toBeCloseTo(thermalCalculations_1.THERMAL_CONSTANTS.convection_coefficient_w_m2_k * 10 * (20 - 25) / 1000, 12);
        (0, vitest_1.expect)(result.contributions.radiation_kw).toBeLessThan(0);
        (0, vitest_1.expect)(result.contributions.wall_conduction_kw).toBeLessThan(0);
        (0, vitest_1.expect)(result.contributions.evaporation_kw).toBeLessThan(0);
        (0, vitest_1.expect)(result.contributions.equipment_kw).toBe(2);
        (0, vitest_1.expect)(result.contributions.lighting_kw).toBeCloseTo(0.85, 12);
        (0, vitest_1.expect)(result.results.recovery_heating_kw).toBeCloseTo(14 * 0.194, 12);
        (0, vitest_1.expect)(result.results.circulation_flow_is_reference_only).toBe(true);
        (0, vitest_1.expect)(result.results.operational_water_exchange_flow_m3h).toBe(0);
    });
    (0, vitest_1.it)('blocks rather than inventing a missing evaporation correlation', () => {
        const inputs = readyInputs();
        delete inputs.evaporation_coefficient_kg_m2_s_kpa;
        const result = (0, thermalCalculations_1.calculateThermalCalculation)(readySource(), inputs);
        (0, vitest_1.expect)(result.status).toBe('Blocked');
        (0, vitest_1.expect)(result.reasons.join(' ')).toMatch(/manual does not supply one automatically/i);
    });
    (0, vitest_1.it)('blocks conflicting linked-exhibit temperatures', () => {
        const source = readySource();
        source.water_temperature_sources.push({
            exhibit_id: 'exhibit-2',
            exhibit_code: 'EX-2',
            water_temperature_min_c: 24,
            water_temperature_max_c: 24,
            water_type: null,
        });
        const result = (0, thermalCalculations_1.calculateThermalCalculation)(source, readyInputs());
        (0, vitest_1.expect)(result.status).toBe('Blocked');
        (0, vitest_1.expect)(result.reasons.join(' ')).toMatch(/conflicting water design temperatures/i);
    });
    (0, vitest_1.it)('blocks incomplete custom geometry and keeps sensitivity separate from the base', () => {
        const source = readySource();
        source.linked_tanks[0].shape = 'custom';
        source.linked_tanks[0].exposed_wall_area_m2 = null;
        const blocked = (0, thermalCalculations_1.calculateThermalCalculation)(source, readyInputs());
        (0, vitest_1.expect)(blocked.status).toBe('Blocked');
        (0, vitest_1.expect)(blocked.reasons.join(' ')).toMatch(/custom geometry/i);
        const reviewed = (0, thermalCalculations_1.calculateThermalCalculation)(source, {
            ...readyInputs(),
            custom_tank_wall_areas_m2: { 'tank-1': 21 },
        });
        (0, vitest_1.expect)(reviewed.status).toBe('Ready');
        (0, vitest_1.expect)(reviewed.results.exposed_wall_area_m2).toBe(21);
        const ready = (0, thermalCalculations_1.calculateThermalCalculation)(readySource(), readyInputs());
        (0, vitest_1.expect)(ready.sensitivity_summary.cases).toHaveLength(5);
        (0, vitest_1.expect)(ready.sensitivity_cases.some(item => item.case_key === 'surface_plus_10_pct')).toBe(true);
        (0, vitest_1.expect)(ready.results.free_surface_area_m2).toBe(10);
    });
    (0, vitest_1.it)('rejects negative equipment heat gain', () => {
        const result = (0, thermalCalculations_1.calculateThermalCalculation)(readySource(), {
            ...readyInputs(),
            equipment_heat_gain_kw: -10,
        });
        (0, vitest_1.expect)(result.status).toBe('Blocked');
        (0, vitest_1.expect)(result.reasons.join(' ')).toMatch(/non-negative/i);
    });
    (0, vitest_1.it)('does not recommend an unapproved adjacent agitation correlation', () => {
        const result = (0, thermalCalculations_1.calculateThermalCalculation)(readySource(), {
            ...readyInputs(),
            adjacent_agitation_classes: ['High'],
            agitation_correlations: {
                Moderate: {
                    coefficient_kg_m2_s_kpa: 0.000001,
                    version: 'reviewed-2026',
                    approved: true,
                },
                High: {
                    coefficient_kg_m2_s_kpa: 0.0001,
                    version: '',
                    approved: false,
                },
            },
        });
        const adjacent = result.sensitivity_cases.find(item => item.case_key === 'agitation_High');
        (0, vitest_1.expect)(adjacent?.status).toBe('Blocked');
        (0, vitest_1.expect)(result.sensitivity_summary.recommended_case).not.toBe('agitation_High');
    });
    (0, vitest_1.it)('counts explicit water exchange but never normal circulation', () => {
        const inputs = {
            ...readyInputs(),
            water_exchange_enabled: true,
            water_exchange_flow_m3h: 1,
            water_exchange_inlet_temperature_c: 20,
        };
        const result = (0, thermalCalculations_1.calculateThermalCalculation)(readySource(), inputs);
        (0, vitest_1.expect)(result.contributions.water_exchange_kw).toBeCloseTo(1000 * 4.186 * (20 - 25) / 3600, 12);
        (0, vitest_1.expect)(result.results.circulation_flow_m3h).toBe(120);
    });
});
