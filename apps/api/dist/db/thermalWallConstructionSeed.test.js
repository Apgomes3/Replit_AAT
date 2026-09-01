"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const thermalWallConstructionSeed_1 = require("./thermalWallConstructionSeed");
(0, vitest_1.describe)('Thermal wall construction starter library', () => {
    (0, vitest_1.it)('contains the exact provisional AAT Foundations starter rows', () => {
        (0, vitest_1.expect)(thermalWallConstructionSeed_1.THERMAL_WALL_CONSTRUCTION_VERSION).toBe('AAT_FOUNDATIONS_WALL_V1.0');
        (0, vitest_1.expect)(thermalWallConstructionSeed_1.THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS).toBe('AAT Foundations');
        (0, vitest_1.expect)(thermalWallConstructionSeed_1.THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE).toContain('AAT Foundations');
        (0, vitest_1.expect)(thermalWallConstructionSeed_1.STARTER_THERMAL_WALL_CONSTRUCTIONS).toEqual([
            vitest_1.expect.objectContaining({ code: 'acrylic', material: 'Acrylic / PMMA', thickness_mm: 12, conductivity_w_m_k: 0.19 }),
            vitest_1.expect.objectContaining({ code: 'concrete', material: 'Reinforced concrete', thickness_mm: 150, conductivity_w_m_k: 1.4 }),
            vitest_1.expect.objectContaining({ code: 'frp', material: 'FRP / GRP laminate', thickness_mm: 6, conductivity_w_m_k: 0.25 }),
            vitest_1.expect.objectContaining({ code: 'steel', material: 'Stainless steel 316L', thickness_mm: 3, conductivity_w_m_k: 14 }),
        ]);
    });
    (0, vitest_1.it)('inserts only missing code/version rows without rewriting historical evidence', async () => {
        const query = vitest_1.vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'new' }] });
        const client = { query };
        (0, vitest_1.expect)(await (0, thermalWallConstructionSeed_1.seedThermalWallConstructions)(client, 'engineer-1')).toBe(4);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(4);
        for (const [sql, params] of query.mock.calls) {
            (0, vitest_1.expect)(sql).toContain('ON CONFLICT (construction_code, version) DO NOTHING');
            (0, vitest_1.expect)(sql).not.toContain('DO UPDATE');
            (0, vitest_1.expect)(params[7]).toBe(thermalWallConstructionSeed_1.THERMAL_WALL_CONSTRUCTION_VERSION);
            (0, vitest_1.expect)(params[8]).toBe(thermalWallConstructionSeed_1.THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS);
            (0, vitest_1.expect)(params[9]).toBe(thermalWallConstructionSeed_1.THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE);
            (0, vitest_1.expect)(params[11]).toBe('engineer-1');
        }
        query.mockResolvedValue({ rowCount: 0, rows: [] });
        (0, vitest_1.expect)(await (0, thermalWallConstructionSeed_1.seedThermalWallConstructions)(client, 'engineer-1')).toBe(0);
    });
});
