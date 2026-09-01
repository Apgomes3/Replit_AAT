// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  calculateUVStream,
  UVRevisionData,
  UVStreamInput,
  UV_MAX_FLOW_PER_LAMP_LS,
} from './uvCalculations';

const baseRevision: UVRevisionData = {
  id: 'revision-test',
  catalog_id: 'catalog-test',
  revision_number: 1,
  status: 'Approved',
  lamp_count: 1,
  lamp_power_w: 300,
  effective_reactor_volume_l: 1,
  irradiance_85t_mw_cm2: 1,
  irradiance_95t_mw_cm2: 1,
  compatibility: 'All',
  arrangement: 'Test arrangement',
  source_evidence: 'Parity test fixture',
  approved_per_lamp_flow_exception_m3h: null,
  notes: null,
};

function makeRevision(overrides: Partial<UVRevisionData> = {}): UVRevisionData {
  return { ...baseRevision, ...overrides };
}

function makeInput(
  flowM3h: number,
  revision: UVRevisionData = makeRevision(),
  quantity = 1,
): UVStreamInput {
  return {
    side_stream_id: 'stream-test',
    side_stream_name: 'Parity stream',
    flow_m3h: flowM3h,
    uv_revision: revision,
    uv_unit_quantity: quantity,
    uvt_85t_pct: 85,
    uvt_95t_pct: 95,
  };
}

describe('UV fluence parity cases', () => {
  /*
   * The specification displays flow to four decimal places, but its expected
   * fluence values were produced from the workbook's full-precision flow.
   * These m³/h values are the full-precision flows implied by each expected
   * result, rather than reusing the rounded display value.
   */
  const parityCases = [
    {
      name: 'Ti 3.6 kW panel × 2 at 85%T',
      flowM3h: 837.4760019883,
      irradiance85: 17.20,
      irradiance95: 1,
      volume: 330.59,
      quantity: 2,
      uvt: 85,
      expectedFluence: 48.8853,
    },
    {
      name: 'Ti 0.6 kW PLC skid × 1 at 85%T',
      flowM3h: 35.0028362255,
      irradiance85: 14.73,
      irradiance95: 1,
      volume: 53.98,
      quantity: 1,
      uvt: 85,
      expectedFluence: 81.7777,
    },
    {
      name: 'PVC 240 PLC skid × 1 at 85%T',
      flowM3h: 15.9999948648,
      irradiance85: 12.19,
      irradiance95: 1,
      volume: 22.72,
      quantity: 1,
      uvt: 85,
      expectedFluence: 62.3153,
    },
    {
      name: 'Ti 1.5 kW panel × 1 at 85%T',
      flowM3h: 104.9999381742,
      irradiance85: 24.12,
      irradiance95: 1,
      volume: 83.32,
      quantity: 1,
      uvt: 85,
      expectedFluence: 68.9033,
    },
    {
      name: 'Ti 1.2 kW panel × 1 at 85%T',
      flowM3h: 70.0000287881,
      irradiance85: 29.09,
      irradiance95: 1,
      volume: 52.01,
      quantity: 1,
      uvt: 85,
      expectedFluence: 77.8099,
    },
    {
      name: 'Ti 0.3 kW panel × 1 at 85%T',
      flowM3h: 32.9999808802,
      irradiance85: 18.74,
      irradiance95: 1,
      volume: 15.35,
      quantity: 1,
      uvt: 85,
      expectedFluence: 31.3810,
    },
    {
      name: 'Ti 1.2 kW panel × 1 at 95%T',
      flowM3h: 69.9999862323,
      irradiance85: 29.09,
      irradiance95: 45.62,
      volume: 52.01,
      quantity: 1,
      uvt: 95,
      expectedFluence: 122.0244,
    },
  ] as const;

  it.each(parityCases)('$name matches the specification fluence', testCase => {
    const result = calculateUVStream(
      makeInput(testCase.flowM3h, makeRevision({
        effective_reactor_volume_l: testCase.volume,
        irradiance_85t_mw_cm2: testCase.irradiance85,
        irradiance_95t_mw_cm2: testCase.irradiance95,
      }), testCase.quantity),
      0,
      null,
    );

    const actualFluence = testCase.uvt === 85
      ? result.fluence_85t_mj_cm2
      : result.fluence_95t_mj_cm2;

    expect(actualFluence).not.toBeNull();
    expect(Math.abs(actualFluence! - testCase.expectedFluence))
      .toBeLessThanOrEqual(0.0001);
  });
});

describe('UV hydraulic lamp limit', () => {
  const target = 0;

  it('passes exactly at the global limit', () => {
    const result = calculateUVStream(
      makeInput(UV_MAX_FLOW_PER_LAMP_LS * 2 * 3.6, makeRevision({ lamp_count: 2 })),
      target,
      null,
    );

    expect(result.flow_per_lamp_ls).toBe(UV_MAX_FLOW_PER_LAMP_LS);
    expect(result.hydraulic_pass).toBe(true);
    expect(result.hydraulic_exception).toBe(false);
  });

  it('passes below the global limit', () => {
    const result = calculateUVStream(
      makeInput(6.24 * 3.6, makeRevision({ lamp_count: 1 })),
      target,
      null,
    );

    expect(result.flow_per_lamp_ls).toBeCloseTo(6.24, 10);
    expect(result.hydraulic_pass).toBe(true);
  });

  it('fails above the global limit', () => {
    const result = calculateUVStream(
      makeInput(6.26 * 3.6, makeRevision({ lamp_count: 1 })),
      target,
      null,
    );

    expect(result.flow_per_lamp_ls).toBeCloseTo(6.26, 10);
    expect(result.hydraulic_pass).toBe(false);
    expect(result.reasons).toContain(
      'Hydraulic limit exceeded: 6.260 L/s/lamp > 6.250 L/s/lamp limit. Increase unit quantity or select a larger model.',
    );
  });

  it('uses an approved product-specific exception instead of the global limit', () => {
    const result = calculateUVStream(
      makeInput(30, makeRevision({
        lamp_count: 1,
        approved_per_lamp_flow_exception_m3h: 30,
      })),
      target,
      null,
    );

    expect(result.flow_per_lamp_ls).toBeCloseTo(30 / 3.6, 10);
    expect(result.hydraulic_pass).toBe(true);
    expect(result.hydraulic_exception).toBe(true);
  });
});

describe('UV material compatibility warnings', () => {
  it('uses the selected 95%T basis as the governing compliance result', () => {
    const input = makeInput(3.6, makeRevision({
      irradiance_85t_mw_cm2: 1,
      irradiance_95t_mw_cm2: 10,
    }));
    input.uvt_basis = '95T';
    const result = calculateUVStream(input, 5, null);

    expect(result.target_met_85t).toBe(false);
    expect(result.target_met_95t).toBe(true);
    expect(result.selected_uvt_basis).toBe('95T');
    expect(result.target_met_selected).toBe(true);
    expect(result.selected_fluence_mj_cm2).toBe(result.fluence_95t_mj_cm2);
  });

  it('uses governed compatibility and explains a missing material/water mapping', () => {
    const blocked = calculateUVStream(
      makeInput(3.6, makeRevision({
        compatibility: 'All',
        material_code: 'MAT-SS316',
        compatibility_allowed: false,
      })),
      0,
      'Marine',
    );
    expect(blocked.compatibility_warning).toContain('MAT-SS316');
    expect(blocked.reasons).toContainEqual(expect.stringContaining('MAT-SS316'));

    const missing = calculateUVStream(
      makeInput(3.6, makeRevision({
        compatibility: 'All',
        material_code: 'MAT-UNKNOWN',
        compatibility_allowed: null,
      })),
      0,
      'Freshwater',
    );
    expect(missing.compatibility_warning).toContain('No governed material compatibility mapping');
  });

  it.each([
    { waterType: 'Marine', compatibility: 'Freshwater', warning: true },
    { waterType: 'Marine', compatibility: 'Titanium', warning: false },
    { waterType: 'Freshwater', compatibility: 'Marine only', warning: true },
    { waterType: 'Freshwater', compatibility: 'Freshwater / SS316', warning: false },
  ])(
    '$waterType with $compatibility has warning=$warning',
    ({ waterType, compatibility, warning }) => {
      const result = calculateUVStream(
        makeInput(3.6, makeRevision({ compatibility })),
        0,
        waterType,
      );

      if (warning) {
        expect(result.compatibility_warning).toContain(`for ${waterType}`);
      } else {
        expect(result.compatibility_warning).toBeNull();
      }
    },
  );
});