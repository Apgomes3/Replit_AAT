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
            },
        });
        (0, vitest_1.expect)(runner.mock.calls[0][0]).toContain('FOR SHARE');
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
