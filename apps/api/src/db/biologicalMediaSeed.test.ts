// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  seedTanGenerationProfiles,
  STARTER_TAN_PROFILES,
  TAN_COEFFICIENT_UNIT,
  CONTROLLED_VALUE_TAN_PROFILE_CODE,
} from './biologicalMediaSeed';

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