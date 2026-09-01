"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const designBooks_1 = require("./designBooks");
const approvedRow = {
    id: 'correlation-1',
    class_id: 'class-1',
    class_code: 'Moderate',
    class_name: 'Moderate agitation',
    class_description: 'Continuous moderate surface movement',
    version: '2026.2',
    coefficient_kg_m2_s_kpa: '0.0000012',
    activity_factor: '0.8',
    base_coefficient_kg_m2_s_kpa: '0.0000015',
    coefficient_unit: 'kg/(m²·s·kPa)',
    base_coefficient_unit: 'kg/(m²·s·kPa)',
    formula_basis: 'K_class = K_base × Activity Factor',
    source_basis: 'AAT Foundations',
    source_document: 'AAT Foundations thermal basis',
    source_revision: '1.0',
    approving_engineer: 'A. Engineer',
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
(0, vitest_1.describe)('thermal correlation approval boundary', () => {
    (0, vitest_1.it)('rejects client-supplied approval evidence without a library correlation id', async () => {
        const runner = vitest_1.vi.fn();
        await (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.resolveThermalCorrelationInputs(runner, {
            agitation_class: 'Invented',
            agitation_correlation_version: 'self-approved',
            agitation_correlation_approved: true,
            evaporation_coefficient_kg_m2_s_kpa: 9,
        })).rejects.toMatchObject({
            code: 'THERMAL_CORRELATION_REQUIRED',
            status: 400,
        });
        (0, vitest_1.expect)(runner).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('discards client approval fields and snapshots the locked approved record', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedRow] }));
        const inputs = await designBooks_1.thermalCorrelationTestUtils.resolveThermalCorrelationInputs(runner, {
            agitation_correlation_id: 'correlation-1',
            agitation_class: 'Forged',
            agitation_correlation_version: 'forged',
            agitation_correlation_approved: false,
            agitation_correlation_snapshot: { approved: false },
            evaporation_coefficient_kg_m2_s_kpa: 999,
        }, '2026-08-31T00:00:00.000Z');
        (0, vitest_1.expect)(inputs).toMatchObject({
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
                activity_factor: 0.8,
                base_coefficient_kg_m2_s_kpa: 0.0000015,
                coefficient_unit: 'kg/(m²·s·kPa)',
                formula_basis: 'K_class = K_base × Activity Factor',
                source_basis: 'AAT Foundations',
                source_document: 'AAT Foundations thermal basis',
                source_revision: '1.0',
                approving_engineer: 'A. Engineer',
                database_defaults: {
                    activity_factor: 0.8,
                    base_coefficient_kg_m2_s_kpa: 0.0000015,
                    coefficient_unit: 'kg/(m²·s·kPa)',
                    source_basis: 'AAT Foundations',
                },
            },
        });
        (0, vitest_1.expect)(runner.mock.calls[0][0]).toContain('FOR SHARE');
    });
    (0, vitest_1.it)('freezes database defaults separately from valid Draft overrides', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedRow] }));
        const inputs = await designBooks_1.thermalCorrelationTestUtils.resolveThermalCorrelationInputs(runner, {
            agitation_correlation_id: 'correlation-1',
            lower_class_coefficient_kg_m2_s_kpa: 0.0000009,
            adjustment_value: 0.2,
            deviation_justification: 'Reviewed project conditions require these adjacent values.',
            agitation_correlation_overrides: {
                lower_class_coefficient_kg_m2_s_kpa: true,
                adjustment_value: true,
            },
        });
        (0, vitest_1.expect)(inputs.agitation_correlation_snapshot).toMatchObject({
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
    (0, vitest_1.it)('rejects correlation overrides outside Draft', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedRow] }));
        await (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.resolveThermalCorrelationInputs(runner, {
            agitation_correlation_id: 'correlation-1',
            adjustment_value: 0.2,
            agitation_correlation_overrides: { adjustment_value: true },
        }, '2026-08-31T00:00:00.000Z', 'In Progress')).rejects.toMatchObject({
            code: 'THERMAL_CORRELATION_OVERRIDE_DRAFT_ONLY',
            status: 409,
        });
    });
    (0, vitest_1.it)('rebuilds legacy adjacent maps from locked database evidence', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedRow] }));
        const inputs = await designBooks_1.thermalCorrelationTestUtils.resolveThermalCorrelationInputs(runner, {
            agitation_correlation_id: 'correlation-1',
            agitation_correlations: {
                calm_covered: {
                    coefficient_kg_m2_s_kpa: 999,
                    version: 'forged',
                    approved: true,
                },
            },
            adjacent_agitation_classes: ['forged'],
        }, '2026-08-31T00:00:00.000Z', 'In Progress');
        (0, vitest_1.expect)(inputs.adjacent_agitation_classes).toEqual([
            'calm_covered',
            'high_agitation_aerated',
        ]);
        (0, vitest_1.expect)(inputs.agitation_correlations.calm_covered).toMatchObject({
            coefficient_kg_m2_s_kpa: 0.0000008,
            version: '2026.2',
            approved: true,
        });
        (0, vitest_1.expect)(inputs.agitation_correlations).not.toHaveProperty('forged');
    });
    (0, vitest_1.it)('rejects superseded versions and unjustified deviations', async () => {
        const supersededRunner = vitest_1.vi.fn(async () => ({
            rows: [{ ...approvedRow, status: 'superseded' }],
        }));
        await (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.resolveThermalCorrelationInputs(supersededRunner, { agitation_correlation_id: 'correlation-1' })).rejects.toMatchObject({ code: 'THERMAL_CORRELATION_SUPERSEDED', status: 409 });
        const approvedRunner = vitest_1.vi.fn(async () => ({ rows: [approvedRow] }));
        await (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.resolveThermalCorrelationInputs(approvedRunner, {
            agitation_correlation_id: 'correlation-1',
            agitation_correlation_deviation: true,
            evaporation_coefficient_kg_m2_s_kpa: 0.0000015,
            deviation_justification: ' ',
        })).rejects.toMatchObject({
            code: 'THERMAL_CORRELATION_DEVIATION_JUSTIFICATION_REQUIRED',
            status: 400,
        });
    });
});
