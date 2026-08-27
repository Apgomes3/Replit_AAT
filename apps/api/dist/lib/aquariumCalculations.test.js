"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const aquariumCalculations_1 = require("./aquariumCalculations");
const exhibit = { id: 'ex-1', water_type: 'Marine' };
const tank = {
    id: 'tank-1',
    eff_shape: 'rectangular',
    eff_length_mm: 5000,
    eff_width_mm: 3000,
    eff_height_mm: 2000,
    eff_water_level_mm: 1800,
    quantity: 1,
};
(0, vitest_1.describe)('aquarium engineering calculations', () => {
    (0, vitest_1.it)('reports effective volume, turnover, allocations, units and timestamp', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [tank], { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 }, { substrate_volume_m3: 2, theming_volume_m3: 1 }, '2026-08-26T10:00:00.000Z');
        (0, vitest_1.expect)(calculated.status).toBe('valid');
        (0, vitest_1.expect)(calculated.inputs.gross_operating_volume_m3).toBe(27);
        (0, vitest_1.expect)(calculated.results.operating_volume_m3).toBe(24);
        (0, vitest_1.expect)(calculated.results.total_return_flow_m3h).toBe(96);
        (0, vitest_1.expect)(calculated.results.surface_skim_flow_m3h).toBe(28.8);
        (0, vitest_1.expect)(calculated.results.bottom_drain_flow_m3h).toBe(67.2);
        (0, vitest_1.expect)(calculated.inputs.turnover_unit).toBe('cycles_per_hour');
        (0, vitest_1.expect)(calculated.calculated_at).toBe('2026-08-26T10:00:00.000Z');
    });
    (0, vitest_1.it)('blocks invalid allocation totals and missing turnover', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [tank], { surface_skim_pct: 35, bottom_drain_pct: 70 }, null);
        (0, vitest_1.expect)(calculated.status).toBe('invalid');
        (0, vitest_1.expect)(calculated.reasons).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.stringContaining('Turnover target'),
            vitest_1.expect.stringContaining('total 100%'),
        ]));
    });
    (0, vitest_1.it)('blocks impossible displacement and wall geometry', () => {
        const displaced = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [tank], { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 }, { substrate_volume_m3: 30, theming_volume_m3: -2 });
        (0, vitest_1.expect)(displaced.status).toBe('invalid');
        (0, vitest_1.expect)(displaced.reasons).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.stringContaining('non-negative'),
            vitest_1.expect.stringContaining('less than gross operating volume'),
        ]));
        const invalidGeometry = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{
                ...tank,
                eff_shape: 'cylindrical',
                eff_width_mm: 500,
                wall_thickness_mm: 300,
            }], { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 }, null);
        (0, vitest_1.expect)(invalidGeometry.status).toBe('invalid');
        (0, vitest_1.expect)(invalidGeometry.results.operating_volume_m3).toBe(0);
        (0, vitest_1.expect)(invalidGeometry.reasons).toContain('Operating volume is missing or invalid.');
    });
    (0, vitest_1.it)('uses summed footprint area for height displacement across tank quantities', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{ ...tank, quantity: 2 }], { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 }, { substrate_height_mm: 100 });
        // Each tank has a 15 m² footprint, so 2 × 15 × 0.1 = 3 m³ displaced.
        (0, vitest_1.expect)(calculated.inputs.gross_operating_volume_m3).toBe(54);
        (0, vitest_1.expect)(calculated.inputs.substrate_volume_m3).toBe(3);
        (0, vitest_1.expect)(calculated.results.operating_volume_m3).toBe(51);
        (0, vitest_1.expect)(calculated.results.total_return_flow_m3h).toBe(102);
    });
    (0, vitest_1.it)('requires direct displacement volume when a custom tank has no footprint', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{ id: 'custom', eff_shape: 'custom', operating_volume_m3: 20 }], { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 }, { substrate_height_mm: 100 });
        (0, vitest_1.expect)(calculated.status).toBe('invalid');
        (0, vitest_1.expect)(calculated.reasons).toContain('Substrate height requires tank footprint dimensions; enter a direct substrate volume for custom tanks.');
    });
    (0, vitest_1.it)('falls back to stored operating volume for a standard tank without dimensions', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{ id: 'legacy', eff_shape: 'rectangular', operating_volume_m3: 12.5 }], { target_turnover_rate: 3, surface_skim_pct: 30, bottom_drain_pct: 70 }, null);
        (0, vitest_1.expect)(calculated.status).toBe('valid');
        (0, vitest_1.expect)(calculated.inputs.tanks[0].source).toBe('stored');
        (0, vitest_1.expect)(calculated.results.operating_volume_m3).toBe(12.5);
        (0, vitest_1.expect)(calculated.results.total_return_flow_m3h).toBe(37.5);
    });
    (0, vitest_1.it)('marks saved system flow as a manual override', () => {
        const exhibitCalculation = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [tank], { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 }, null);
        const system = (0, aquariumCalculations_1.calculateSystemEngineering)({ id: 'sys-1', design_flow_m3h: 120, system_config: 'bespoke' }, [{ id: 'link-1', exhibit_id: 'ex-1', link_type: 'Primary' }], [exhibitCalculation], null);
        (0, vitest_1.expect)(system.status).toBe('override');
        (0, vitest_1.expect)(system.results.calculated_required_flow_m3h).toBe(108);
        (0, vitest_1.expect)(system.results.flow_override_m3h).toBe(120);
    });
    (0, vitest_1.it)('propagates invalid linked exhibit calculations to bespoke systems', () => {
        const invalidExhibit = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [], { surface_skim_pct: 30, bottom_drain_pct: 70 }, null);
        const system = (0, aquariumCalculations_1.calculateSystemEngineering)({ id: 'sys-invalid', system_config: 'bespoke' }, [{ id: 'link-invalid', exhibit_id: 'ex-1', exhibit_code: 'EX-01', link_type: 'Primary' }], [invalidExhibit], null);
        (0, vitest_1.expect)(system.status).toBe('invalid');
        (0, vitest_1.expect)(system.reasons[0]).toContain('Linked exhibit EX-01 is invalid');
    });
    (0, vitest_1.it)('evaluates catalog volume, flow, status and water-type limits', () => {
        const unsuitable = (0, aquariumCalculations_1.evaluateCompactUnit)({
            min_tank_volume_m3: 10,
            max_tank_volume_m3: 30,
            max_flow_m3h: 100,
            water_type: 'Freshwater',
            status: 'Inactive',
        }, 'Marine', 35, 120);
        (0, vitest_1.expect)(unsuitable.suitable).toBe(false);
        (0, vitest_1.expect)(unsuitable.reasons).toHaveLength(4);
        (0, vitest_1.expect)((0, aquariumCalculations_1.compatibleWaterTypes)('Marine', 'Universal')).toBe(true);
        (0, vitest_1.expect)((0, aquariumCalculations_1.compatibleWaterTypes)('Marine', 'Freshwater')).toBe(false);
    });
});
