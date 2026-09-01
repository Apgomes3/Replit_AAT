import { describe, expect, it, vi } from 'vitest';
import { thermalCorrelationTestUtils } from './designBooks';

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

describe('Thermal wall construction approval boundary', () => {
  it('resolves the selected construction from locked governed evidence', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedWall] }));
    const inputs = await thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(
      runner as any,
      { tank_construction_type: 'acrylic' },
    );

    expect((runner.mock.calls as any[][])[0][0]).toContain('FOR SHARE');
    expect(inputs).toMatchObject({
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
      tank_wall_layers: [{
        material: 'Acrylic / PMMA',
        thickness_mm: 12,
        conductivity_w_m_k: 0.19,
      }],
      tank_wall_layer_overrides: {
        material: false,
        thickness_mm: false,
        conductivity_w_m_k: false,
      },
    });
  });

  it('freezes valid Draft effective values separately from defaults', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedWall] }));
    const inputs = await thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(
      runner as any,
      {
        tank_construction_type: 'acrylic',
        tank_wall_layers: [{
          material: 'Project acrylic',
          thickness_mm: 20,
          conductivity_w_m_k: 0.2,
        }],
        tank_wall_override_justification: 'Project wall schedule.',
      },
      'Draft',
    );

    expect(inputs.tank_wall_default_basis).toMatchObject({
      material: 'Acrylic / PMMA',
      thickness_mm: 12,
      conductivity_w_m_k: 0.19,
    });
    expect(inputs.tank_wall_layers).toEqual([{
      material: 'Project acrylic',
      thickness_mm: 20,
      conductivity_w_m_k: 0.2,
    }]);
    expect(inputs.tank_wall_layer_overrides).toEqual({
      material: true,
      thickness_mm: true,
      conductivity_w_m_k: true,
    });
    expect(inputs.tank_wall_override_justification).toBe('Project wall schedule.');
  });

  it('rejects invalid effective values and overrides outside Draft', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedWall] }));
    await expect(thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(
      runner as any,
      {
        tank_construction_type: 'acrylic',
        tank_wall_layers: [{ material: '', thickness_mm: 0, conductivity_w_m_k: -1 }],
      },
    )).rejects.toMatchObject({ code: 'THERMAL_WALL_LAYER_INVALID', status: 400 });

    await expect(thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(
      runner as any,
      {
        tank_construction_type: 'acrylic',
        tank_wall_layers: [{
          material: 'Acrylic / PMMA',
          thickness_mm: 20,
          conductivity_w_m_k: 0.19,
        }],
      },
      'In Progress',
    )).rejects.toMatchObject({
      code: 'THERMAL_WALL_LAYER_OVERRIDE_DRAFT_ONLY',
      status: 409,
    });
  });

  it('never resurrects a missing or superseded governed default from embedded values', async () => {
    const runner = vi.fn(async () => ({ rows: [] }));
    await expect(thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(
      runner as any,
      { tank_construction_type: 'acrylic' },
    )).rejects.toMatchObject({
      code: 'THERMAL_WALL_CONSTRUCTION_NOT_FOUND',
      status: 400,
    });
  });

  it('reset-equivalent values clear all override flags', async () => {
    const runner = vi.fn(async () => ({ rows: [approvedWall] }));
    const inputs = await thermalCorrelationTestUtils.resolveThermalWallConstructionInputs(
      runner as any,
      {
        tank_construction_type: 'acrylic',
        tank_wall_layers: [{
          material: 'Acrylic / PMMA',
          thickness_mm: 12,
          conductivity_w_m_k: 0.19,
        }],
        tank_wall_override_justification: 'Old explanation',
      },
    );

    expect(Object.values(inputs.tank_wall_layer_overrides)).not.toContain(true);
  });
});