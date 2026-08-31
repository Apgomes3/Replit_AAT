// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  MEDIA_CAPACITY_BASIS_UNIT,
  seedBiologicalMediaProfiles,
  seedTanGenerationProfiles,
  STARTER_MEDIA_PROFILES,
  STARTER_TAN_PROFILES,
  TAN_COEFFICIENT_UNIT,
  CONTROLLED_VALUE_TAN_PROFILE_CODE,
} from './biologicalMediaSeed';

describe('Biological Media Overall VTR starter profiles', () => {
  it('preserves the four preliminary reference values, units, and qualifications', () => {
    expect(MEDIA_CAPACITY_BASIS_UNIT).toBe('g TAN-N/m³ media/day');
    expect(STARTER_MEDIA_PROFILES).toHaveLength(4);
    expect(STARTER_MEDIA_PROFILES.map(profile => ({
      code: profile.profile_code,
      rate: profile.overall_vtr_g_tan_n_m3_d,
    }))).toEqual([
      { code: 'FW_TF_25C', rate: 90 },
      { code: 'FW_MBBR_25C', rate: 350 },
      { code: 'FW_FB_8C_200', rate: 92 },
      { code: 'FW_MB_8C_850', rate: 231 },
    ]);
    expect(new Set(STARTER_MEDIA_PROFILES.map(profile => profile.profile_code)).size).toBe(4);
    expect(STARTER_MEDIA_PROFILES.every(profile => profile.provisional_label.includes('review required'))).toBe(true);
    expect(STARTER_MEDIA_PROFILES[0].notes).toContain('alkalinity ≥100 mg/L as CaCO₃');
    expect(STARTER_MEDIA_PROFILES[0].notes).toContain('Not a universal media capacity');
    expect(STARTER_MEDIA_PROFILES[1].media_fill_fraction).toBe(0.7);
    expect(STARTER_MEDIA_PROFILES[2].notes).toContain('8°C');
    expect(STARTER_MEDIA_PROFILES[3].notes).toContain('approximately 231');
    expect(STARTER_MEDIA_PROFILES[3].notes).toContain('maximum-rate study result');
  });

  it('seeds draft revision one idempotently without evidence or destructive conflict handling', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const client = { query } as any;

    expect(await seedBiologicalMediaProfiles(client, 'admin-1')).toBe(4);
    expect(query).toHaveBeenCalledTimes(4);
    for (const call of query.mock.calls) {
      expect(call[0]).toContain("NULL,true,$18,'Draft'");
      expect(call[0]).toContain('ON CONFLICT (profile_code, revision) DO NOTHING');
      expect(call[0]).not.toContain('DO UPDATE');
      expect(call[1][4]).toBe(MEDIA_CAPACITY_BASIS_UNIT);
    }

    query.mockClear();
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await seedBiologicalMediaProfiles(client, 'admin-1')).toBe(0);
  });

  it('fills only missing starter revisions on an existing database', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    const client = { query } as any;

    expect(await seedBiologicalMediaProfiles(client, 'admin-1')).toBe(3);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0][1][0]).toBe('FW_TF_25C');
    expect(query.mock.calls[1][1][0]).toBe('FW_MBBR_25C');
    expect(query.mock.calls[3][1][9]).toBe(231);
  });
});

describe('Biological Media TAN starter profiles', () => {
  it('uses the exact controlled starter values, names, and recommendations', () => {
    expect(TAN_COEFFICIENT_UNIT).toBe('kg TAN-N/kg feed protein');
    expect(STARTER_TAN_PROFILES).toEqual([
      expect.objectContaining({ profile_name: 'Ebeling Timmons general RAS', coefficient: 0.09216, recommended_application: 'Default for teleost fish where no validated species data exist.' }),
      expect.objectContaining({ profile_name: 'Losordo nitrogen retention model', coefficient: 0.080, recommended_application: 'Less conservative production estimate.' }),
      expect.objectContaining({ profile_name: 'AAT conservative legacy', coefficient: 0.0976, recommended_application: 'May remain as an AAT controlled design profile.' }),
      expect.objectContaining({ profile_name: 'Eventual dissolved nitrogen', coefficient: 0.1024, recommended_application: 'Includes the nitrogen assumed to be excreted as urea and later converted to TAN.' }),
       expect.objectContaining({ profile_name: 'Species and feed validated', coefficient: null, recommended_application: expect.stringContaining('administrator-controlled') }),
      expect.objectContaining({ profile_name: 'Theoretical maximum', coefficient: 0.160, recommended_application: 'All feed protein nitrogen becoming TAN-N; normally unrealistically conservative.' }),
    ]);
    expect(new Set(STARTER_TAN_PROFILES.map(profile => profile.profile_code)).size).toBe(6);
  });

  it('is idempotent and never overwrites revision one', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const client = { query } as any;

    expect(await seedTanGenerationProfiles(client, 'admin-1')).toBe(6);
    expect(query).toHaveBeenCalledTimes(6);
    for (const call of query.mock.calls) {
      expect(call[0]).toContain('ON CONFLICT (profile_code, revision) DO NOTHING');
      expect(call[0]).not.toContain('DO UPDATE');
      expect(call[1][3]).toBe(TAN_COEFFICIENT_UNIT);
    }

    query.mockClear();
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await seedTanGenerationProfiles(client, 'admin-1')).toBe(0);
  });

  it('fills missing starter revisions on an existing database without touching an existing revision', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    const client = { query } as any;

    expect(await seedTanGenerationProfiles(client, 'admin-1')).toBe(5);
    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls[0][1][0]).toBe('EBELING_TIMMONS_GENERAL_RAS');
    expect(query.mock.calls[0][1][2]).toBe(0.09216);
    expect(query.mock.calls[4][1][0]).toBe(CONTROLLED_VALUE_TAN_PROFILE_CODE);
    expect(query.mock.calls[4][1][2]).toBeNull();
    expect(query.mock.calls[4][0]).toContain('ON CONFLICT (profile_code, revision) DO NOTHING');
  });
});