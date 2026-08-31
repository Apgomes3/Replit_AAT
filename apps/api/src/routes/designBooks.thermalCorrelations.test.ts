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
  lower_agitation_class_code: 'calm_covered',
  lower_agitation_class_name: 'Calm or Covered',
  lower_class_coefficient_kg_m2_s_kpa: '0.0000008',
  adjustment_value: '0.15',
  adjustment_basis: 'Approved engineering adjustment',
  upper_agitation_class_code: 'high_agitation_aerated',
  upper_agitation_class_name: 'High Agitation or Aerated',
  upper_class_coefficient_kg_m2_s_kpa: '0.0000018',
  related_agitation_values: { air_velocity_m_s: 0.2 },
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

  it('freezes database defaults separately from valid Draft overrides', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedRow] }));
    const inputs = await thermalCorrelationTestUtils.resolveThermalCorrelationInputs(
      runner as any,
      {
        agitation_correlation_id: 'correlation-1',
        lower_class_coefficient_kg_m2_s_kpa: 0.0000009,
        adjustment_value: 0.2,
        deviation_justification: 'Reviewed project conditions require these adjacent values.',
        agitation_correlation_overrides: {
          lower_class_coefficient_kg_m2_s_kpa: true,
          adjustment_value: true,
        },
      },
    );

    expect(inputs.agitation_correlation_snapshot).toMatchObject({
      database_defaults: {
        coefficient_kg_m2_s_kpa: 0.0000012,
        lower_class_coefficient_kg_m2_s_kpa: 0.0000008,
        adjustment_value: 0.15,
      },
      effective_values: {
        coefficient_kg_m2_s_kpa: 0.0000012,
        lower_class_coefficient_kg_m2_s_kpa: 0.0000009,
        adjustment_value: 0.2,
      },
      overrides: {
        coefficient_kg_m2_s_kpa: false,
        lower_class_coefficient_kg_m2_s_kpa: true,
        adjustment_value: true,
      },
    });
  });

  it('rejects correlation overrides outside Draft', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedRow] }));
    await expect(thermalCorrelationTestUtils.resolveThermalCorrelationInputs(
      runner as any,
      {
        agitation_correlation_id: 'correlation-1',
        adjustment_value: 0.2,
        agitation_correlation_overrides: { adjustment_value: true },
      },
      '2026-08-31T00:00:00.000Z',
      'In Progress',
    )).rejects.toMatchObject({
      code: 'THERMAL_CORRELATION_OVERRIDE_DRAFT_ONLY',
      status: 409,
    });
  });

  it('rebuilds legacy adjacent maps from locked database evidence', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedRow] }));
    const inputs = await thermalCorrelationTestUtils.resolveThermalCorrelationInputs(
      runner as any,
      {
        agitation_correlation_id: 'correlation-1',
        agitation_correlations: {
          calm_covered: {
            coefficient_kg_m2_s_kpa: 999,
            version: 'forged',
            approved: true,
          },
        },
        adjacent_agitation_classes: ['forged'],
      },
      '2026-08-31T00:00:00.000Z',
      'In Progress',
    );

    expect(inputs.adjacent_agitation_classes).toEqual([
      'calm_covered',
      'high_agitation_aerated',
    ]);
    expect(inputs.agitation_correlations.calm_covered).toMatchObject({
      coefficient_kg_m2_s_kpa: 0.0000008,
      version: '2026.2',
      approved: true,
    });
    expect(inputs.agitation_correlations).not.toHaveProperty('forged');
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