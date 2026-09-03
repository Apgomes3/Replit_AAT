"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const designBooks_1 = require("./designBooks");
const approvedWall = {
    id: 'wall-1',
    construction_code: 'acrylic',
    construction_label: 'Acrylic',
    material: 'Acrylic / PMMA',
    thickness_mm: '12',
    conductivity_w_m_k: '0.19',
    thickness_units: 'mm',
    conductivity_units: 'W/m·K',
    version: 'AAT_FOUNDATIONS_WALL_V1.0',
    source_basis: 'AAT Foundations',
    source_reference: 'AAT Foundations wall construction starter defaults',
    notes: 'Provisional starter default.',
    status: 'approved',
    approved_by: 'engineer-1',
    approved_at: '2026-09-01T00:00:00.000Z',
};
(0, vitest_1.describe)('Thermal wall construction approval boundary', () => {
    (0, vitest_1.it)('rejects a stale successor confirmation when the approved version changed', () => {
        (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.thermalWallExpectedCurrentMatches({ id: 'wall-2' }, 'wall-1')).toBe(false);
        (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.thermalWallExpectedCurrentMatches({ id: 'wall-2' }, 'wall-2')).toBe(true);
        (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.thermalWallExpectedCurrentMatches(null, '')).toBe(true);
        (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.thermalWallExpectedCurrentMatches({ id: 'wall-1' }, '')).toBe(false);
    });
    (0, vitest_1.it)('returns approved and superseded history with approval metadata', async () => {
        const runner = vitest_1.vi.fn(async () => ({
            rows: [
                {
                    ...approvedWall,
                    approved_by_name: 'Alex Chen',
                    approved_by_email: 'engineer@example.com',
                },
                {
                    ...approvedWall,
                    id: 'wall-0',
                    version: 'AAT_FOUNDATIONS_WALL_V0.9',
                    status: 'superseded',
                    superseded_by: 'engineer-2',
                    superseded_at: '2026-08-01T00:00:00.000Z',
                    superseded_by_name: 'Priya Shah',
                    superseded_by_email: 'priya@example.com',
                },
            ],
        }));
        const history = await designBooks_1.thermalCorrelationTestUtils.loadThermalWallConstructionHistory(runner);
        (0, vitest_1.expect)(runner.mock.calls[0][0]).toContain('LEFT JOIN users approved_user');
        (0, vitest_1.expect)(history).toEqual([
            vitest_1.expect.objectContaining({
                basis_version: 'AAT_FOUNDATIONS_WALL_V1.0',
                approval: vitest_1.expect.objectContaining({
                    status: 'approved',
                    approved_by_name: 'Alex Chen',
                    approved_by_email: 'engineer@example.com',
                }),
            }),
            vitest_1.expect.objectContaining({
                basis_version: 'AAT_FOUNDATIONS_WALL_V0.9',
                approval: vitest_1.expect.objectContaining({
                    status: 'superseded',
                    superseded_by: 'engineer-2',
                    superseded_at: '2026-08-01T00:00:00.000Z',
                    superseded_by_name: 'Priya Shah',
                }),
            }),
        ]);
    });
    (0, vitest_1.it)('resolves the selected construction from locked governed evidence', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedWall] }));
        const inputs = await designBooks_1.thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(runner, { tank_construction_type: 'acrylic' });
        (0, vitest_1.expect)(runner.mock.calls[0][0]).toContain('FOR SHARE');
        (0, vitest_1.expect)(inputs).toMatchObject({
            tank_construction_type: 'acrylic',
            tank_wall_default_basis: {
                id: 'wall-1',
                material: 'Acrylic / PMMA',
                thickness_mm: 12,
                conductivity_w_m_k: 0.19,
                basis_version: 'AAT_FOUNDATIONS_WALL_V1.0',
                approval: {
                    status: 'approved',
                    approved_by: 'engineer-1',
                    approved_at: '2026-09-01T00:00:00.000Z',
                },
            },
            tank_wall_layers: [],
            tank_wall_layer_overrides: {},
        });
    });
    (0, vitest_1.it)('freezes valid Draft effective values separately from defaults', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedWall] }));
        const inputs = await designBooks_1.thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(runner, {
            tank_construction_type: 'acrylic',
            tank_wall_layers: [{
                    material: 'Project acrylic',
                    thickness_mm: 20,
                    conductivity_w_m_k: 0.2,
                }],
            tank_wall_override_justification: 'Project wall schedule.',
        }, 'Draft');
        (0, vitest_1.expect)(inputs.tank_wall_default_basis).toMatchObject({
            material: 'Acrylic / PMMA',
            thickness_mm: 12,
            conductivity_w_m_k: 0.19,
        });
        (0, vitest_1.expect)(inputs.tank_wall_layers).toEqual([{
                material: 'Project acrylic',
                thickness_mm: 20,
                conductivity_w_m_k: 0.2,
            }]);
        (0, vitest_1.expect)(inputs.tank_wall_layer_overrides).toEqual({
            material: true,
            conductivity_w_m_k: true,
        });
        (0, vitest_1.expect)(inputs.tank_wall_override_justification).toBe('Project wall schedule.');
    });
    (0, vitest_1.it)('rejects invalid effective values and overrides outside Draft', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedWall] }));
        await (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(runner, {
            tank_construction_type: 'acrylic',
            tank_wall_layers: [{ material: '', thickness_mm: 0, conductivity_w_m_k: -1 }],
        })).rejects.toMatchObject({ code: 'THERMAL_WALL_LAYER_INVALID', status: 400 });
        await (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(runner, {
            tank_construction_type: 'acrylic',
            tank_wall_layers: [{
                    material: 'Project acrylic',
                    thickness_mm: 20,
                    conductivity_w_m_k: 0.19,
                }],
        }, 'In Progress')).rejects.toMatchObject({
            code: 'THERMAL_WALL_LAYER_OVERRIDE_DRAFT_ONLY',
            status: 409,
        });
    });
    (0, vitest_1.it)('never resurrects a missing or superseded governed default from embedded values', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [] }));
        await (0, vitest_1.expect)(designBooks_1.thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(runner, { tank_construction_type: 'acrylic' })).rejects.toMatchObject({
            code: 'THERMAL_WALL_CONSTRUCTION_NOT_FOUND',
            status: 400,
        });
    });
    (0, vitest_1.it)('reset-equivalent values clear all override flags', async () => {
        const runner = vitest_1.vi.fn(async () => ({ rows: [approvedWall] }));
        const inputs = await designBooks_1.thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(runner, {
            tank_construction_type: 'acrylic',
            tank_wall_layers: [{
                    material: 'Acrylic / PMMA',
                    thickness_mm: 12,
                    conductivity_w_m_k: 0.19,
                }],
            tank_wall_override_justification: 'Old explanation',
        });
        (0, vitest_1.expect)(Object.values(inputs.tank_wall_layer_overrides)).not.toContain(true);
    });
});
