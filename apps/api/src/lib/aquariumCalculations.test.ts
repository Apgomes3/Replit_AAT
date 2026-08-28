import { describe, expect, it } from 'vitest';
import {
  calculateAatRecommendedFlow,
  calculateFoamFractionatorCapacity,
  calculateExhibitHydraulics,
  calculateSideStreamFlow,
  calculateSystemEngineering,
  compatibleWaterTypes,
  evaluateCompactUnit,
} from './aquariumCalculations';

describe('AAT recommended exhibit flow', () => {
  it.each([
    { volume: 0.8, timeHours: 0.25, flowM3h: 3.2, turnover: 4 },
    { volume: 6, timeHours: 0.4226194608, flowM3h: 14.1971692183, turnover: 2.3661948697 },
    { volume: 123.4272, timeHours: 1.1238687854, flowM3h: 109.8234968368, turnover: 0.8897835877 },
  ])('matches the supplied worked example for $volume m³', ({ volume, timeHours, flowM3h, turnover }) => {
    const result = calculateAatRecommendedFlow(volume, '2026-08-28T00:00:00.000Z');

    expect(result.status).toBe('valid');
    expect(result.calculated_at).toBe('2026-08-28T00:00:00.000Z');
    expect(result.inputs.effective_operating_volume_m3).toBe(volume);
    expect(result.results.target_turnover_time_hours).toBeCloseTo(timeHours, 5);
    expect(result.results.target_turnover_time_minutes).toBeCloseTo(timeHours * 60, 1);
    expect(result.results.recommended_flow_m3h).toBeCloseTo(flowM3h, 3);
    expect(result.results.recommended_turnover_rate_cycles_per_hour).toBeCloseTo(turnover, 3);
  });

  it('switches to the first power curve at exactly 1 m³', () => {
    const result = calculateAatRecommendedFlow(1);
    const expectedTime = 0.2265939594 * Math.pow(1, 0.3478773096);

    expect(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
    expect(result.results.recommended_turnover_rate_cycles_per_hour).toBeCloseTo(1 / expectedTime, 3);
    expect(result.results.recommended_flow_m3h).toBeCloseTo(1 / expectedTime, 3);
    expect(result.results.recommended_turnover_rate_cycles_per_hour).not.toBe(4);
  });

  it('switches to the second power curve at exactly 100 m³', () => {
    const result = calculateAatRecommendedFlow(100);
    const expectedTime = 0.8850796805 * Math.pow(100, 0.04959964583);

    expect(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
    expect(result.results.recommended_flow_m3h).toBeCloseTo(100 / expectedTime, 3);
  });

  it.each([
    { input: 0.99994, canonical: 0.9999, expectedRule: 'fixed' },
    { input: 0.99999, canonical: 1, expectedRule: 'first' },
    { input: 99.99994, canonical: 99.9999, expectedRule: 'first' },
    { input: 99.99999, canonical: 100, expectedRule: 'second' },
  ])('uses the published canonical volume at rounded boundaries for $input', ({ input, canonical, expectedRule }) => {
    const result = calculateAatRecommendedFlow(input);
    const expectedTime = expectedRule === 'fixed'
      ? 0.25
      : expectedRule === 'first'
        ? 0.2265939594 * Math.pow(canonical, 0.3478773096)
        : 0.8850796805 * Math.pow(canonical, 0.04959964583);

    expect(result.inputs.effective_operating_volume_m3).toBe(canonical);
    expect(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
  });

  it('continues the second power curve above 4000 m³ without a cap', () => {
    const volume = 4001;
    const expectedTime = 0.8850796805 * Math.pow(volume, 0.04959964583);
    const result = calculateAatRecommendedFlow(volume);

    expect(result.results.target_turnover_time_hours).toBeCloseTo(expectedTime, 6);
    expect(result.results.recommended_turnover_rate_cycles_per_hour).toBeCloseTo(1 / expectedTime, 3);
    expect(result.results.recommended_turnover_rate_cycles_per_hour).toBeGreaterThan(0.66);
    expect(result.results.recommended_flow_m3h).toBeCloseTo(volume / expectedTime, 3);
  });

  it.each([null, '', 0, -1, 'not-a-volume'])('returns an unavailable reference for invalid volume %s', volume => {
    const result = calculateAatRecommendedFlow(volume);

    expect(result.status).toBe('invalid');
    expect(result.reasons[0]).toContain('unavailable');
    expect(result.inputs.effective_operating_volume_m3).toBeNull();
    expect(result.results.recommended_flow_m3h).toBeNull();
  });
});

describe('Foam Fractionator capacity', () => {
  const model = (code: string, diameter_mm: number | null, quantity: number) => ({
    product_master_id: code,
    product_code: code,
    product_name: `Fractionator ${code}`,
    diameter_mm,
    quantity,
  });

  it('totals circular area across models and reports a matched capacity', () => {
    const result = calculateFoamFractionatorCapacity(
      36,
      20,
      [model('FF-1000', 1000, 1), model('FF-500', 500, 1)],
    );

    expect(result.results.selected_count).toBe(2);
    expect(result.results.total_area_m2).toBeCloseTo(0.9817, 4);
    expect(result.results.parent_loop_flow_ls).toBe(10);
    expect(result.results.capacity_ls).toBeCloseTo(19.635, 3);
    expect(result.results.actual_loading_ls_m2).toBeCloseTo(10.186, 3);
    expect(result.match_status).toBe('capacity_above_required');
  });

  it('reports required flow above capacity', () => {
    const result = calculateFoamFractionatorCapacity(72, 18, [model('FF-500', 500, 1)]);
    expect(result.match_status).toBe('required_above_capacity');
  });

  it('accepts out-of-range rates with an advisory', () => {
    const result = calculateFoamFractionatorCapacity(18, 25, [model('FF-500', 500, 1)]);
    expect(result.advisory).toContain('18–22');
    expect(result.status).toBe('valid');
  });

  it.each([
    { flow: null, rate: 20, products: [model('FF-500', 500, 1)], reason: 'Parent loop' },
    { flow: 18, rate: 20, products: [], reason: 'Select at least one' },
    { flow: 18, rate: 20, products: [model('FF-500', null, 1)], reason: 'saved diameter' },
  ])('returns an incomplete result when required inputs are unavailable', ({ flow, rate, products, reason }) => {
    const result = calculateFoamFractionatorCapacity(flow, rate, products);
    expect(result.match_status).toBe('incomplete');
    expect(result.reasons.join(' ')).toContain(reason);
  });
});

describe('Foam Fractionator release readiness', () => {
  const baseSystem = {
    id: 'system-foam',
    design_flow_m3h: 100,
    loop1_name: 'Foam loop',
    loop1_filtration: 'Foam Fractionation',
    loop1_flow_pct: 50,
  };

  it('makes incomplete Foam Fractionator inputs invalidate the system calculation', () => {
    const result = calculateSystemEngineering(
      baseSystem, [], [], null, '2026-08-28T00:00:00.000Z', [],
      [{ parent_loop_number: 1, process_rate_ls_m2: null, products: [] }],
    );
    expect(result.status).toBe('invalid');
    expect(result.reasons.join(' ')).toContain('Foam Fractionator capacity is incomplete');
  });

  it('makes insufficient Foam Fractionator capacity invalidate the system calculation', () => {
    const result = calculateSystemEngineering(
      baseSystem, [], [], null, '2026-08-28T00:00:00.000Z', [],
      [{
        parent_loop_number: 1,
        process_rate_ls_m2: 18,
        products: [{
          product_master_id: 'ff-small',
          product_code: 'FF-SMALL',
          product_name: 'Small Fractionator',
          diameter_mm: 250,
          quantity: 1,
        }],
      }],
    );
    expect(result.status).toBe('invalid');
    expect(result.reasons.join(' ')).toContain('required flow is above');
  });

  it('does not invalidate a system with adequate Foam Fractionator capacity', () => {
    const result = calculateSystemEngineering(
      baseSystem, [], [], null, '2026-08-28T00:00:00.000Z', [],
      [{
        parent_loop_number: 1,
        process_rate_ls_m2: 20,
        products: [{
          product_master_id: 'ff-large',
          product_code: 'FF-LARGE',
          product_name: 'Large Fractionator',
          diameter_mm: 2000,
          quantity: 1,
        }],
      }],
    );
    expect(result.flow_route.loops[0].foam_fractionation.match_status).toBe('capacity_above_required');
    expect(result.reasons.some(reason => reason.includes('Foam Fractionator'))).toBe(false);
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

describe('aquarium engineering calculations', () => {
  it('reports effective volume, turnover, allocations, units and timestamp', () => {
    const calculated = calculateExhibitHydraulics(
      exhibit,
      [tank],
      { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 },
      { substrate_volume_m3: 2, theming_volume_m3: 1 },
      '2026-08-26T10:00:00.000Z',
    );

    expect(calculated.status).toBe('valid');
    expect(calculated.inputs.gross_operating_volume_m3).toBe(27);
    expect(calculated.results.operating_volume_m3).toBe(24);
    expect(calculated.results.total_return_flow_m3h).toBe(96);
    expect(calculated.results.surface_skim_flow_m3h).toBe(28.8);
    expect(calculated.results.bottom_drain_flow_m3h).toBe(67.2);
    expect(calculated.inputs.turnover_unit).toBe('cycles_per_hour');
    expect(calculated.calculated_at).toBe('2026-08-26T10:00:00.000Z');
    expect(calculated.aat_reference).toMatchObject({
      status: 'valid',
      inputs: { effective_operating_volume_m3: 24 },
      results: { recommended_flow_m3h: expect.any(Number) },
    });
    expect(calculated.aat_reference.rule.first_power_curve.maximum_is_exclusive).toBe(true);
  });

  it('blocks invalid allocation totals and missing turnover', () => {
    const calculated = calculateExhibitHydraulics(
      exhibit,
      [tank],
      { surface_skim_pct: 35, bottom_drain_pct: 70 },
      null,
    );
    expect(calculated.status).toBe('invalid');
    expect(calculated.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('Turnover target'),
      expect.stringContaining('total 100%'),
    ]));
  });

  it('blocks impossible displacement and wall geometry', () => {
    const displaced = calculateExhibitHydraulics(
      exhibit,
      [tank],
      { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 },
      { substrate_volume_m3: 30, theming_volume_m3: -2 },
    );
    expect(displaced.status).toBe('invalid');
    expect(displaced.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('non-negative'),
      expect.stringContaining('less than gross operating volume'),
    ]));

    const invalidGeometry = calculateExhibitHydraulics(
      exhibit,
      [{
        ...tank,
        eff_shape: 'cylindrical',
        eff_width_mm: 500,
        wall_thickness_mm: 300,
      }],
      { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 },
      null,
    );
    expect(invalidGeometry.status).toBe('invalid');
    expect(invalidGeometry.results.operating_volume_m3).toBe(0);
    expect(invalidGeometry.reasons).toContain('Operating volume is missing or invalid.');
  });

  it('uses summed footprint area for height displacement across tank quantities', () => {
    const calculated = calculateExhibitHydraulics(
      exhibit,
      [{ ...tank, quantity: 2 }],
      { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 },
      { substrate_height_mm: 100 },
    );
    // Each tank has a 15 m² footprint, so 2 × 15 × 0.1 = 3 m³ displaced.
    expect(calculated.inputs.gross_operating_volume_m3).toBe(54);
    expect(calculated.inputs.substrate_volume_m3).toBe(3);
    expect(calculated.results.operating_volume_m3).toBe(51);
    expect(calculated.results.total_return_flow_m3h).toBe(102);
  });

  it('requires direct displacement volume when a custom tank has no footprint', () => {
    const calculated = calculateExhibitHydraulics(
      exhibit,
      [{ id: 'custom', eff_shape: 'custom', operating_volume_m3: 20 }],
      { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 },
      { substrate_height_mm: 100 },
    );
    expect(calculated.status).toBe('invalid');
    expect(calculated.reasons).toContain(
      'Substrate height requires tank footprint dimensions; enter a direct substrate volume for custom tanks.',
    );
  });

  it('uses a confirmed custom-tank surface area for height-based displacement', () => {
    const calculated = calculateExhibitHydraulics(
      exhibit,
      [{
        id: 'custom',
        tank_code: 'CUSTOM-1',
        eff_shape: 'custom',
        operating_volume_m3: 100,
        surface_area_m2: 20,
      }],
      { target_turnover_rate: 2, surface_skim_pct: 30, bottom_drain_pct: 70 },
      { substrate_height_mm: 100 },
    );
    expect(calculated.status).toBe('valid');
    expect(calculated.inputs.substrate_volume_m3).toBe(2);
    expect(calculated.results.operating_volume_m3).toBe(98);
  });

  it('falls back to stored operating volume for a standard tank without dimensions', () => {
    const calculated = calculateExhibitHydraulics(
      exhibit,
      [{ id: 'legacy', eff_shape: 'rectangular', operating_volume_m3: 12.5 }],
      { target_turnover_rate: 3, surface_skim_pct: 30, bottom_drain_pct: 70 },
      null,
    );
    expect(calculated.status).toBe('valid');
    expect(calculated.inputs.tanks[0].source).toBe('stored');
    expect(calculated.results.operating_volume_m3).toBe(12.5);
    expect(calculated.results.total_return_flow_m3h).toBe(37.5);
  });

  it('marks saved system flow as a manual override', () => {
    const exhibitCalculation = calculateExhibitHydraulics(
      exhibit,
      [tank],
      { target_turnover_rate: 4, surface_skim_pct: 30, bottom_drain_pct: 70 },
      null,
    );
    const system = calculateSystemEngineering(
      { id: 'sys-1', design_flow_m3h: 120, system_config: 'bespoke' },
      [{ id: 'link-1', exhibit_id: 'ex-1', link_type: 'Primary' }],
      [exhibitCalculation],
      null,
    );
    expect(system.status).toBe('override');
    expect(system.results.calculated_required_flow_m3h).toBe(108);
    expect(system.results.flow_override_m3h).toBe(120);
  });

  it('derives side-stream flow from the canonical parent-loop basis', () => {
    expect(calculateSideStreamFlow(120, 50, 25)).toBe(15);
    expect(calculateSideStreamFlow(120, null, 25)).toBeNull();
    expect(calculateSideStreamFlow(120, 50, 101)).toBeNull();
  });

  it('includes named loops and side streams in system engineering output without inflating allocations', () => {
    const system = calculateSystemEngineering(
      {
        id: 'sys-side-streams',
        design_flow_m3h: 100,
        system_config: 'bespoke',
        loop1_name: 'Main Filtration',
        loop1_flow_pct: 60,
      },
      [],
      [],
      null,
      '2026-08-28T00:00:00.000Z',
      [
        { id: 'thermal', parent_loop_number: 1, name: 'Thermal', flow_pct: 25, sort_order: 0 },
        { id: 'uv', parent_loop_number: 1, name: 'UV', flow_pct: 40, sort_order: 1 },
      ],
    );

    expect(system.results.design_flow_m3h).toBe(100);
    expect(system.results.allocation_total_m3h).toBe(0);
    expect(system.flow_route.side_streams_are_branches).toBe(true);
    expect(system.flow_route.loops[0]).toMatchObject({
      name: 'Main Filtration',
      allocation_pct: 60,
      flow_m3h: 60,
    });
    expect(system.flow_route.loops[0].side_streams.map((stream: any) => stream.flow_m3h))
      .toEqual([15, 24]);
  });

  it('propagates invalid linked exhibit calculations to bespoke systems', () => {
    const invalidExhibit = calculateExhibitHydraulics(
      exhibit,
      [],
      { surface_skim_pct: 30, bottom_drain_pct: 70 },
      null,
    );
    const system = calculateSystemEngineering(
      { id: 'sys-invalid', system_config: 'bespoke' },
      [{ id: 'link-invalid', exhibit_id: 'ex-1', exhibit_code: 'EX-01', link_type: 'Primary' }],
      [invalidExhibit],
      null,
    );
    expect(system.status).toBe('invalid');
    expect(system.reasons[0]).toContain('Linked exhibit EX-01 is invalid');
  });

  it('evaluates catalog volume, flow, status and water-type limits', () => {
    const unsuitable = evaluateCompactUnit(
      {
        min_tank_volume_m3: 10,
        max_tank_volume_m3: 30,
        max_flow_m3h: 100,
        water_type: 'Freshwater',
        status: 'Inactive',
      },
      'Marine',
      35,
      120,
    );
    expect(unsuitable.suitable).toBe(false);
    expect(unsuitable.reasons).toHaveLength(4);
    expect(compatibleWaterTypes('Marine', 'Universal')).toBe(true);
    expect(compatibleWaterTypes('Marine', 'Freshwater')).toBe(false);
  });
});