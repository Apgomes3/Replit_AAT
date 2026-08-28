"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const aquariumCalculations_1 = require("./aquariumCalculations");
(0, vitest_1.describe)('AAT recommended exhibit flow', () => {
    vitest_1.it.each([
        { volume: 0.8, timeHours: 0.25, flowM3h: 3.2, turnover: 4 },
        { volume: 6, timeHours: 0.4226194608, flowM3h: 14.1971692183, turnover: 2.3661948697 },
        { volume: 123.4272, timeHours: 1.1238687854, flowM3h: 109.8234968368, turnover: 0.8897835877 },
    ])('matches the supplied worked example for $volume m³', ({ volume, timeHours, flowM3h, turnover }) => {
        const result = (0, aquariumCalculations_1.calculateAatRecommendedFlow)(volume, '2026-08-28T00:00:00.000Z');
        (0, vitest_1.expect)(result.status).toBe('valid');
        (0, vitest_1.expect)(result.calculated_at).toBe('2026-08-28T00:00:00.000Z');
        (0, vitest_1.expect)(result.inputs.effective_operating_volume_m3).toBe(volume);
        (0, vitest_1.expect)(result.results.target_turnover_time_hours).toBeCloseTo(timeHours, 5);
        (0, vitest_1.expect)(result.results.target_turnover_time_minutes).toBeCloseTo(timeHours * 60, 1);
        (0, vitest_1.expect)(result.results.recommended_flow_m3h).toBeCloseTo(flowM3h, 3);
        (0, vitest_1.expect)(result.results.recommended_turnover_rate_cycles_per_hour).toBeCloseTo(turnover, 3);
    });
    (0, vitest_1.it)('switches to the first power curve at exactly 1 m³', () => {
        const result = (0, aquariumCalculations_1.calculateAatRecommendedFlow)(1);
        const expectedTime = 0.2265939594 * Math.pow(1, 0.3478773096);
        (0, vitest_1.expect)(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
        (0, vitest_1.expect)(result.results.recommended_turnover_rate_cycles_per_hour).toBeCloseTo(1 / expectedTime, 3);
        (0, vitest_1.expect)(result.results.recommended_flow_m3h).toBeCloseTo(1 / expectedTime, 3);
        (0, vitest_1.expect)(result.results.recommended_turnover_rate_cycles_per_hour).not.toBe(4);
    });
    (0, vitest_1.it)('switches to the second power curve at exactly 100 m³', () => {
        const result = (0, aquariumCalculations_1.calculateAatRecommendedFlow)(100);
        const expectedTime = 0.8850796805 * Math.pow(100, 0.04959964583);
        (0, vitest_1.expect)(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
        (0, vitest_1.expect)(result.results.recommended_flow_m3h).toBeCloseTo(100 / expectedTime, 3);
    });
    vitest_1.it.each([
        { input: 0.99994, canonical: 0.9999, expectedRule: 'fixed' },
        { input: 0.99999, canonical: 1, expectedRule: 'first' },
        { input: 99.99994, canonical: 99.9999, expectedRule: 'first' },
        { input: 99.99999, canonical: 100, expectedRule: 'second' },
    ])('uses the published canonical volume at rounded boundaries for $input', ({ input, canonical, expectedRule }) => {
        const result = (0, aquariumCalculations_1.calculateAatRecommendedFlow)(input);
        const expectedTime = expectedRule === 'fixed'
            ? 0.25
            : expectedRule === 'first'
                ? 0.2265939594 * Math.pow(canonical, 0.3478773096)
                : 0.8850796805 * Math.pow(canonical, 0.04959964583);
        (0, vitest_1.expect)(result.inputs.effective_operating_volume_m3).toBe(canonical);
        (0, vitest_1.expect)(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
    });
    (0, vitest_1.it)('continues the second power curve above 4000 m³ without a cap', () => {
        const volume = 4001;
        const expectedTime = 0.8850796805 * Math.pow(volume, 0.04959964583);
        const result = (0, aquariumCalculations_1.calculateAatRecommendedFlow)(volume);
        (0, vitest_1.expect)(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
        (0, vitest_1.expect)(result.results.recommended_turnover_rate_cycles_per_hour).toBeCloseTo(1 / expectedTime, 3);
        (0, vitest_1.expect)(result.results.recommended_turnover_rate_cycles_per_hour).toBeGreaterThan(0.66);
        (0, vitest_1.expect)(result.results.recommended_flow_m3h).toBeCloseTo(volume / expectedTime, 3);
    });
    vitest_1.it.each([null, '', 0, -1, 'not-a-volume'])('returns an unavailable reference for invalid volume %s', volume => {
        const result = (0, aquariumCalculations_1.calculateAatRecommendedFlow)(volume);
        (0, vitest_1.expect)(result.status).toBe('invalid');
        (0, vitest_1.expect)(result.reasons[0]).toContain('unavailable');
        (0, vitest_1.expect)(result.inputs.effective_operating_volume_m3).toBeNull();
        (0, vitest_1.expect)(result.results.recommended_flow_m3h).toBeNull();
    });
});
(0, vitest_1.describe)('Foam Fractionator capacity', () => {
    const model = (code, diameter_mm, quantity) => ({
        product_master_id: code,
        product_code: code,
        product_name: `Fractionator ${code}`,
        diameter_mm,
        quantity,
    });
    (0, vitest_1.it)('totals circular area across models and reports a matched capacity', () => {
        const result = (0, aquariumCalculations_1.calculateFoamFractionatorCapacity)(36, 20, [model('FF-1000', 1000, 1), model('FF-500', 500, 1)]);
        (0, vitest_1.expect)(result.results.selected_count).toBe(2);
        (0, vitest_1.expect)(result.results.total_area_m2).toBeCloseTo(0.9817, 4);
        (0, vitest_1.expect)(result.results.parent_loop_flow_ls).toBe(10);
        (0, vitest_1.expect)(result.results.capacity_ls).toBeCloseTo(19.635, 3);
        (0, vitest_1.expect)(result.results.actual_loading_ls_m2).toBeCloseTo(10.186, 3);
        (0, vitest_1.expect)(result.match_status).toBe('capacity_above_required');
    });
    (0, vitest_1.it)('reports required flow above capacity', () => {
        const result = (0, aquariumCalculations_1.calculateFoamFractionatorCapacity)(72, 18, [model('FF-500', 500, 1)]);
        (0, vitest_1.expect)(result.match_status).toBe('required_above_capacity');
    });
    (0, vitest_1.it)('accepts out-of-range rates with an advisory', () => {
        const result = (0, aquariumCalculations_1.calculateFoamFractionatorCapacity)(18, 25, [model('FF-500', 500, 1)]);
        (0, vitest_1.expect)(result.advisory).toContain('18–22');
        (0, vitest_1.expect)(result.status).toBe('valid');
    });
    vitest_1.it.each([
        { flow: null, rate: 20, products: [model('FF-500', 500, 1)], reason: 'Parent loop' },
        { flow: 18, rate: 20, products: [], reason: 'Select at least one' },
        { flow: 18, rate: 20, products: [model('FF-500', null, 1)], reason: 'saved diameter' },
    ])('returns an incomplete result when required inputs are unavailable', ({ flow, rate, products, reason }) => {
        const result = (0, aquariumCalculations_1.calculateFoamFractionatorCapacity)(flow, rate, products);
        (0, vitest_1.expect)(result.match_status).toBe('incomplete');
        (0, vitest_1.expect)(result.reasons.join(' ')).toContain(reason);
    });
});
(0, vitest_1.describe)('Foam Fractionator release readiness', () => {
    const baseSystem = {
        id: 'system-foam',
        design_flow_m3h: 100,
        loop1_name: 'Foam loop',
        loop1_filtration: 'Foam Fractionation',
        loop1_flow_pct: 50,
    };
    (0, vitest_1.it)('makes incomplete Foam Fractionator inputs invalidate the system calculation', () => {
        const result = (0, aquariumCalculations_1.calculateSystemEngineering)(baseSystem, [], [], null, '2026-08-28T00:00:00.000Z', [], [{ parent_loop_number: 1, process_rate_ls_m2: null, products: [] }]);
        (0, vitest_1.expect)(result.status).toBe('invalid');
        (0, vitest_1.expect)(result.reasons.join(' ')).toContain('Foam Fractionator capacity is incomplete');
    });
    (0, vitest_1.it)('makes insufficient Foam Fractionator capacity invalidate the system calculation', () => {
        const result = (0, aquariumCalculations_1.calculateSystemEngineering)(baseSystem, [], [], null, '2026-08-28T00:00:00.000Z', [], [{
                parent_loop_number: 1,
                process_rate_ls_m2: 18,
                products: [{
                        product_master_id: 'ff-small',
                        product_code: 'FF-SMALL',
                        product_name: 'Small Fractionator',
                        diameter_mm: 250,
                        quantity: 1,
                    }],
            }]);
        (0, vitest_1.expect)(result.status).toBe('invalid');
        (0, vitest_1.expect)(result.reasons.join(' ')).toContain('required flow is above');
    });
    (0, vitest_1.it)('does not invalidate a system with adequate Foam Fractionator capacity', () => {
        const result = (0, aquariumCalculations_1.calculateSystemEngineering)(baseSystem, [], [], null, '2026-08-28T00:00:00.000Z', [], [{
                parent_loop_number: 1,
                process_rate_ls_m2: 20,
                products: [{
                        product_master_id: 'ff-large',
                        product_code: 'FF-LARGE',
                        product_name: 'Large Fractionator',
                        diameter_mm: 2000,
                        quantity: 1,
                    }],
            }]);
        (0, vitest_1.expect)(result.flow_route.loops[0].foam_fractionation.match_status).toBe('capacity_above_required');
        (0, vitest_1.expect)(result.reasons.some(reason => reason.includes('Foam Fractionator'))).toBe(false);
    });
});
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
        (0, vitest_1.expect)(calculated.aat_reference).toMatchObject({
            status: 'valid',
            inputs: { effective_operating_volume_m3: 24 },
            results: { recommended_flow_m3h: vitest_1.expect.any(Number) },
        });
        (0, vitest_1.expect)(calculated.aat_reference.rule.first_power_curve.maximum_is_exclusive).toBe(true);
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
    (0, vitest_1.it)('uses a confirmed custom-tank surface area for height-based displacement', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{
                id: 'custom',
                tank_code: 'CUSTOM-1',
                eff_shape: 'custom',
                operating_volume_m3: 100,
                surface_area_m2: 20,
            }], { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 }, { substrate_height_mm: 100 });
        (0, vitest_1.expect)(calculated.status).toBe('valid');
        (0, vitest_1.expect)(calculated.inputs.substrate_volume_m3).toBe(2);
        (0, vitest_1.expect)(calculated.results.operating_volume_m3).toBe(98);
    });
    (0, vitest_1.it)('falls back to stored operating volume for a standard tank without dimensions', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{ id: 'legacy', eff_shape: 'rectangular', operating_volume_m3: 12.5 }], { target_turnover_rate: 3, surface_skim_pct: 30, bottom_drain_pct: 70 }, null);
        (0, vitest_1.expect)(calculated.status).toBe('valid');
        (0, vitest_1.expect)(calculated.inputs.tanks[0].source).toBe('stored');
        (0, vitest_1.expect)(calculated.results.operating_volume_m3).toBe(12.5);
        (0, vitest_1.expect)(calculated.results.total_return_flow_m3h).toBe(37.5);
    });
    (0, vitest_1.it)('prefers a stored project-tank operating volume over complete dimensions', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{
                id: 'assigned-project-tank',
                eff_shape: 'rectangular',
                eff_length_mm: 5000,
                eff_width_mm: 4000,
                eff_water_level_mm: 3000,
                project_operating_volume_m3: 42,
                operating_volume_m3: 42,
            }], { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 }, null);
        (0, vitest_1.expect)(calculated.inputs.tanks[0]).toMatchObject({
            source: 'stored',
            formula: 'Stored project-tank operating volume',
            value_m3: 42,
        });
        (0, vitest_1.expect)(calculated.results.operating_volume_m3).toBe(42);
        (0, vitest_1.expect)(calculated.aat_reference.inputs.effective_operating_volume_m3).toBe(42);
    });
    (0, vitest_1.it)('uses linked PIM operating volume when the project tank inherits catalog values', () => {
        const calculated = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [{
                id: 'assigned-pim-tank',
                product_master_id: 'pim-tank',
                eff_shape: 'rectangular',
                eff_length_mm: 5000,
                eff_width_mm: 4000,
                eff_water_level_mm: 3000,
                project_operating_volume_m3: null,
                operating_volume_m3: null,
                pim_operating_volume_m3: 48,
            }], { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 }, { substrate_volume_m3: 3, theming_volume_m3: 5 });
        (0, vitest_1.expect)(calculated.inputs.tanks[0]).toMatchObject({
            source: 'stored',
            formula: 'Stored PIM tank operating volume',
            value_m3: 48,
        });
        (0, vitest_1.expect)(calculated.results.operating_volume_m3).toBe(40);
        (0, vitest_1.expect)(calculated.aat_reference.inputs.effective_operating_volume_m3).toBe(40);
    });
    (0, vitest_1.it)('marks saved system flow as a manual override', () => {
        const exhibitCalculation = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, [tank], { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 }, null);
        const system = (0, aquariumCalculations_1.calculateSystemEngineering)({ id: 'sys-1', design_flow_m3h: 120, system_config: 'bespoke' }, [{ id: 'link-1', exhibit_id: 'ex-1', link_type: 'Primary' }], [exhibitCalculation], null);
        (0, vitest_1.expect)(system.status).toBe('override');
        (0, vitest_1.expect)(system.results.calculated_required_flow_m3h).toBe(108);
        (0, vitest_1.expect)(system.results.flow_override_m3h).toBe(120);
    });
    (0, vitest_1.it)('derives side-stream flow from the canonical parent-loop basis', () => {
        (0, vitest_1.expect)((0, aquariumCalculations_1.calculateSideStreamFlow)(120, 50, 25)).toBe(15);
        (0, vitest_1.expect)((0, aquariumCalculations_1.calculateSideStreamFlow)(120, null, 25)).toBeNull();
        (0, vitest_1.expect)((0, aquariumCalculations_1.calculateSideStreamFlow)(120, 50, 101)).toBeNull();
    });
    (0, vitest_1.it)('includes named loops and side streams in system engineering output without inflating allocations', () => {
        const system = (0, aquariumCalculations_1.calculateSystemEngineering)({
            id: 'sys-side-streams',
            design_flow_m3h: 100,
            system_config: 'bespoke',
            loop1_name: 'Main Filtration',
            loop1_flow_pct: 60,
        }, [], [], null, '2026-08-28T00:00:00.000Z', [
            { id: 'thermal', parent_loop_number: 1, name: 'Thermal', flow_pct: 25, sort_order: 0 },
            { id: 'uv', parent_loop_number: 1, name: 'UV', flow_pct: 40, sort_order: 1 },
        ]);
        (0, vitest_1.expect)(system.results.design_flow_m3h).toBe(100);
        (0, vitest_1.expect)(system.results.allocation_total_m3h).toBe(0);
        (0, vitest_1.expect)(system.flow_route.side_streams_are_branches).toBe(true);
        (0, vitest_1.expect)(system.flow_route.loops[0]).toMatchObject({
            name: 'Main Filtration',
            allocation_pct: 60,
            flow_m3h: 60,
        });
        (0, vitest_1.expect)(system.flow_route.loops[0].side_streams.map((stream) => stream.flow_m3h))
            .toEqual([15, 24]);
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
