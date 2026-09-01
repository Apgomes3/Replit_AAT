import { describe, expect, it, vi } from 'vitest';
import {
  STARTER_THERMAL_WALL_CONSTRUCTIONS,
  THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS,
  THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE,
  THERMAL_WALL_CONSTRUCTION_VERSION,
  seedThermalWallConstructions,
} from './thermalWallConstructionSeed';

describe('Thermal wall construction starter library', () => {
  it('contains the exact provisional AAT Foundations starter rows', () => {
    expect(THERMAL_WALL_CONSTRUCTION_VERSION).toBe('AAT_FOUNDATIONS_WALL_V1.0');
    expect(THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS).toBe('AAT Foundations');
    expect(THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE).toContain('AAT Foundations');
    expect(STARTER_THERMAL_WALL_CONSTRUCTIONS).toEqual([
      expect.objectContaining({ code: 'acrylic', material: 'Acrylic / PMMA', thickness_mm: 12, conductivity_w_m_k: 0.19 }),
      expect.objectContaining({ code: 'concrete', material: 'Reinforced concrete', thickness_mm: 150, conductivity_w_m_k: 1.4 }),
      expect.objectContaining({ code: 'frp', material: 'FRP / GRP laminate', thickness_mm: 6, conductivity_w_m_k: 0.25 }),
      expect.objectContaining({ code: 'steel', material: 'Stainless steel 316L', thickness_mm: 3, conductivity_w_m_k: 14 }),
    ]);
  });

  it('inserts only missing code/version rows without rewriting historical evidence', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'new' }] });
    const client = { query } as any;

    expect(await seedThermalWallConstructions(client, 'engineer-1')).toBe(4);
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('ON CONFLICT (construction_code, version) DO NOTHING');
      expect(sql).not.toContain('DO UPDATE');
      expect(params[7]).toBe(THERMAL_WALL_CONSTRUCTION_VERSION);
      expect(params[8]).toBe(THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS);
      expect(params[9]).toBe(THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE);
      expect(params[11]).toBe('engineer-1');
    }

    query.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await seedThermalWallConstructions(client, 'engineer-1')).toBe(0);
  });
});