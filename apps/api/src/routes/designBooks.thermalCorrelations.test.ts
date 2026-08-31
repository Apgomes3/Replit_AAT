import { describe, expect, it, vi } from 'vitest';
import { thermalCorrelationTestUtils } from './designBooks';

const approvedRow = {
  id: 'correlation-1',
  class_id: 'class-1',
  class_code: 'Moderate',
  class_name: 'Moderate agitation',
  class_description: 'Continuous moderate surface movement',
  version: '2026.2',
  coefficient_kg_m2_s_kpa: '0.0000012',
  source_reference: 'Engineering standard ES-42',
  notes: 'Approved range',
  status: 'approved',
  approved_by: 'engineer-1',
  approved_at: '2026-08-30T00:00:00.000Z',
};

describe('thermal correlation approval boundary', () => {
  it('rejects client-supplied approval evidence without a library correlation id', async () => {
    const runner = vi.fn();
    await expect(thermalCorrelationTestUtils.resolveThermalCorrelationInputs(runner as any, {
      agitation_class: 'Invented',
      agitation_correlation_version: 'self-approved',
      agitation_correlation_approved: true,
      evaporation_coefficient_kg_m2_s_kpa: 9,
    })).rejects.toMatchObject({
      code: 'THERMAL_CORRELATION_REQUIRED',
      status: 400,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('discards client approval fields and snapshots the locked approved record', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedRow] }));
    const inputs = await thermalCorrelationTestUtils.resolveThermalCorrelationInputs(
      runner as any,
      {
        agitation_correlation_id: 'correlation-1',
        agitation_class: 'Forged',
        agitation_correlation_version: 'forged',
        agitation_correlation_approved: false,
        agitation_correlation_snapshot: { approved: false },
        evaporation_coefficient_kg_m2_s_kpa: 999,
      },
      '2026-08-31T00:00:00.000Z',
    );

    expect(inputs).toMatchObject({
      agitation_class: 'Moderate',
      agitation_correlation_version: '2026.2',
      agitation_correlation_approved: true,
      evaporation_coefficient_kg_m2_s_kpa: 0.0000012,
      agitation_correlation_snapshot: {
        source: 'shared_library',
        correlation_id: 'correlation-1',
        version: '2026.2',
        coefficient_kg_m2_s_kpa: 0.0000012,
        effective_coefficient_kg_m2_s_kpa: 0.0000012,
        approved: true,
        captured_at: '2026-08-31T00:00:00.000Z',
      },
    });
    expect((runner.mock.calls as any[][])[0][0]).toContain('FOR SHARE');
  });

  it('rejects superseded versions and unjustified deviations', async () => {
    const supersededRunner = vi.fn(async () => ({
      rows: [{ ...approvedRow, status: 'superseded' }],
    }));
    await expect(thermalCorrelationTestUtils.resolveThermalCorrelationInputs(
      supersededRunner as any,
      { agitation_correlation_id: 'correlation-1' },
    )).rejects.toMatchObject({ code: 'THERMAL_CORRELATION_SUPERSEDED', status: 409 });

    const approvedRunner = vi.fn(async () => ({ rows: [approvedRow] }));
    await expect(thermalCorrelationTestUtils.resolveThermalCorrelationInputs(
      approvedRunner as any,
      {
        agitation_correlation_id: 'correlation-1',
        agitation_correlation_deviation: true,
        evaporation_coefficient_kg_m2_s_kpa: 0.0000015,
        deviation_justification: ' ',
      },
    )).rejects.toMatchObject({
      code: 'THERMAL_CORRELATION_DEVIATION_JUSTIFICATION_REQUIRED',
      status: 400,
    });
  });
});