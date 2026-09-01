"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const thermalCorrelationSeed_1 = require("./thermalCorrelationSeed");
(0, vitest_1.describe)('Thermal correlation starter library', () => {
    (0, vitest_1.it)('contains the exact governed AAT Foundations dataset', () => {
        (0, vitest_1.expect)(thermalCorrelationSeed_1.THERMAL_CORRELATION_VERSION).toBe('AAT_FOUNDATIONS_EVAP_V1.0');
        (0, vitest_1.expect)(thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_BASIS).toBe('AAT Foundations');
        (0, vitest_1.expect)(thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_DOCUMENT).toBe('AAT Foundations');
        (0, vitest_1.expect)(thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_REVISION).toBe('AAT_FOUNDATIONS_EVAP_V1.0');
        (0, vitest_1.expect)(thermalCorrelationSeed_1.THERMAL_CORRELATION_COEFFICIENT_UNIT).toBe('kg/(m²·s·kPa)');
        (0, vitest_1.expect)(thermalCorrelationSeed_1.THERMAL_CORRELATION_BASE_COEFFICIENT).toBe(0.000040);
        (0, vitest_1.expect)(thermalCorrelationSeed_1.THERMAL_CORRELATION_FORMULA).toBe('K_class = K_base × Activity Factor');
        (0, vitest_1.expect)(thermalCorrelationSeed_1.STARTER_THERMAL_CORRELATIONS).toEqual([
            vitest_1.expect.objectContaining({
                source_class_code: 'CALM_COVERED',
                class_code: 'calm_covered',
                class_name: 'Calm or Covered',
                activity_factor: 0.50,
                coefficient: 0.000020,
            }),
            vitest_1.expect.objectContaining({
                source_class_code: 'NORMAL_CIRCULATION',
                class_code: 'normal_circulation',
                class_name: 'Normal Circulation',
                activity_factor: 0.80,
                coefficient: 0.000032,
            }),
            vitest_1.expect.objectContaining({
                source_class_code: 'HIGH_AGITATION_AERATED',
                class_code: 'high_agitation_aerated',
                class_name: 'High Agitation or Aerated',
                activity_factor: 1.00,
                coefficient: 0.000040,
            }),
            vitest_1.expect.objectContaining({
                source_class_code: 'SPLASHING_ACTIVE',
                class_code: 'splashing_active',
                class_name: 'Splashing or Active',
                activity_factor: 1.50,
                coefficient: 0.000060,
            }),
        ]);
    });
    (0, vitest_1.it)('inserts only missing class/version records and never overwrites evidence', async () => {
        const query = vitest_1.vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'new' }] });
        const client = { query };
        (0, vitest_1.expect)(await (0, thermalCorrelationSeed_1.seedThermalCorrelations)(client, 'engineer-1')).toBe(4);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(4);
        for (const [sql, params] of query.mock.calls) {
            (0, vitest_1.expect)(sql).toContain('ON CONFLICT DO NOTHING');
            (0, vitest_1.expect)(sql).not.toContain('DO UPDATE');
            (0, vitest_1.expect)(params[2]).toBe(thermalCorrelationSeed_1.THERMAL_CORRELATION_VERSION);
            (0, vitest_1.expect)(params[5]).toBe(thermalCorrelationSeed_1.THERMAL_CORRELATION_BASE_COEFFICIENT);
            (0, vitest_1.expect)(params[6]).toBe(thermalCorrelationSeed_1.THERMAL_CORRELATION_COEFFICIENT_UNIT);
            (0, vitest_1.expect)(params[9]).toBe(thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_BASIS);
            (0, vitest_1.expect)(params[10]).toBe(thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_DOCUMENT);
            (0, vitest_1.expect)(params[11]).toBe(thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_REVISION);
            (0, vitest_1.expect)(JSON.parse(params[12])).toMatchObject({
                base_coefficient_kg_m2_s_kpa: thermalCorrelationSeed_1.THERMAL_CORRELATION_BASE_COEFFICIENT,
                formula: thermalCorrelationSeed_1.THERMAL_CORRELATION_FORMULA,
                source_basis: thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_BASIS,
                source_document: thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_DOCUMENT,
                source_revision: thermalCorrelationSeed_1.THERMAL_CORRELATION_SOURCE_REVISION,
            });
        }
        query.mockClear();
        query.mockResolvedValue({ rowCount: 0, rows: [] });
        (0, vitest_1.expect)(await (0, thermalCorrelationSeed_1.seedThermalCorrelations)(client, 'engineer-1')).toBe(0);
    });
    (0, vitest_1.it)('fills only missing starter records on a partially populated database', async () => {
        const query = vitest_1.vi.fn()
            .mockResolvedValueOnce({ rowCount: 0, rows: [] })
            .mockResolvedValue({ rowCount: 1, rows: [{ id: 'new' }] });
        const client = { query };
        (0, vitest_1.expect)(await (0, thermalCorrelationSeed_1.seedThermalCorrelations)(client, null)).toBe(3);
        (0, vitest_1.expect)(query.mock.calls.map(call => call[1][0])).toEqual(thermalCorrelationSeed_1.STARTER_THERMAL_CORRELATIONS.map(item => item.class_code));
    });
    (0, vitest_1.it)('skips a class that already has a different approved version', async () => {
        const query = vitest_1.vi.fn(async (sql, params) => {
            if (params[0] === 'normal_circulation') {
                (0, vitest_1.expect)(sql).toContain('ON CONFLICT DO NOTHING');
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [{ id: 'new' }] };
        });
        (0, vitest_1.expect)(await (0, thermalCorrelationSeed_1.seedThermalCorrelations)({ query }, 'engineer-1')).toBe(3);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(4);
        (0, vitest_1.expect)(query.mock.calls[1][1][0]).toBe('normal_circulation');
    });
});
