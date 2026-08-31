// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  BIOLOGICAL_MEDIA_EVIDENCE_LOADING_UNIT,
  BIOLOGICAL_MEDIA_EVIDENCE_REVIEW_STATUS,
  BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
  MEDIA_CAPACITY_BASIS_UNIT,
  seedBiologicalMediaEvidence,
  seedBiologicalMediaProfiles,
  seedTanGenerationProfiles,
  STARTER_BIOLOGICAL_MEDIA_EVIDENCE,
  STARTER_MEDIA_PROFILES,
  STARTER_TAN_PROFILES,
  TAN_COEFFICIENT_UNIT,
  CONTROLLED_VALUE_TAN_PROFILE_CODE,
} from './biologicalMediaSeed';

describe('Biological Media review-only VTR evidence', () => {
  it('preserves ten supplied observations and seven distinct candidate recommendations', () => {
    const observations = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.filter(item => item.record_type === 'Observation');
    const candidates = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.filter(item => item.record_type === 'Candidate Recommendation');

    expect(observations).toHaveLength(10);
    expect(candidates).toHaveLength(7);
    expect(new Set(STARTER_BIOLOGICAL_MEDIA_EVIDENCE.map(item => item.evidence_code)).size).toBe(17);
    expect(candidates.map(item => item.candidate_profile_code)).toEqual([
      'FW_TF_25C',
      'FW_MBBR_25C',
      'BW_MBBR_LOW',
      'BW_MBBR_MODERATE',
      'SW_TF_CONSERVATIVE',
      'SW_TF_COMMERCIAL',
      'SW_MBBR_LOW_TAN',
    ]);
    expect(STARTER_BIOLOGICAL_MEDIA_EVIDENCE.every(item => item.promotable === false)).toBe(true);
    expect(BIOLOGICAL_MEDIA_EVIDENCE_REVIEW_STATUS).toBe('Review Needed');
  });

  it('keeps exact uncertainties, ranges, loading benchmark, and upper-performance qualifiers', () => {
    const mb3 = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_BRACKISH_MBBR_MB3')!;
    expect(mb3.observations).toEqual([
      expect.objectContaining({ value: 92, uncertainty: 26, value_text: '92 ± 26', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT }),
      expect.objectContaining({ value: 186, uncertainty: 54, value_text: '186 ± 54', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT }),
    ]);
    const redDrum = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_BRACKISH_RED_DRUM_MOVING_BEDS')!;
    expect(redDrum.observations[0]).toMatchObject({ value_min: 39, value_max: 87, value_text: 'approximately 39 to 87', qualifier: 'Average values' });
    const sand = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_MARINE_FLUIDIZED_SAND')!;
    expect(sand).toMatchObject({ evidence_classification: 'Loading benchmark', promotable: false });
    expect(sand.observations[0]).toMatchObject({ value: 500, unit: BIOLOGICAL_MEDIA_EVIDENCE_LOADING_UNIT, qualifier: 'Loading benchmark' });
    expect(sand.promotion_exclusion_reason).toContain('excluded from direct Overall-VTR promotion');
    const intensive = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_INTENSIVE_MARINE_MOVING_BED')!;
    expect(intensive.qualification).toContain('upper performance');
    expect(intensive.limitations).toBe('Not suitable as a general design value.');
  });

  it('keeps conservative and commercial curves separate and review-only', () => {
    const conservative = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.candidate_profile_code === 'SW_TF_CONSERVATIVE')!;
    const commercial = STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.candidate_profile_code === 'SW_TF_COMMERCIAL')!;

    expect(conservative.curve_guidance).toMatchObject({
      curve_name: 'Nijhof conservative marine curve',
      default_selection: 'Conservative default',
      below_threshold_note: expect.stringContaining('validated rate required'),
    });
    expect(commercial.curve_guidance).toMatchObject({
      curve_name: 'Díaz commercial marine curve',
      selection_requirement: 'Engineer selection required',
      below_threshold_note: expect.stringContaining('never zero or extrapolation'),
    });
    expect(conservative.observations).toHaveLength(8);
    expect(commercial.observations.at(-1)).toMatchObject({ condition_label: '≥3.20 mg/L', value: 102.4 });
    expect(commercial.linked_evidence_codes).toEqual([
      { code: 'OBS_MARINE_COMMERCIAL_TRICKLING_FILTER', relationship: 'related marine observation' },
    ]);
  });

  it('seeds records, observations, and links idempotently without updates', async () => {
    const sources = new Map<string, string>();
    const records = new Map<string, string>();
    const observations = new Set<string>();
    const links = new Set<string>();
    const sqlCalls: string[] = [];
    const query = vi.fn(async (sql: string, params: any[] = []) => {
      sqlCalls.push(sql);
      if (sql.includes('INSERT INTO lss_biological_media_evidence_sources')) {
        if (sources.has(params[0])) return { rowCount: 0, rows: [] };
        const id = `source-${sources.size + 1}`;
        sources.set(params[0], id);
        return { rowCount: 1, rows: [{ id }] };
      }
      if (sql.includes('SELECT id FROM lss_biological_media_evidence_sources')) {
        return { rowCount: 1, rows: [{ id: sources.get(params[0]) }] };
      }
      if (sql.includes('INSERT INTO lss_biological_media_evidence_records')) {
        if (records.has(params[0])) return { rowCount: 0, rows: [] };
        const id = `record-${records.size + 1}`;
        records.set(params[0], id);
        return { rowCount: 1, rows: [{ id }] };
      }
      if (sql.includes('SELECT id FROM lss_biological_media_evidence_records')) {
        return { rowCount: 1, rows: [{ id: records.get(params[0]) }] };
      }
      if (sql.includes('INSERT INTO lss_biological_media_evidence_observations')) {
        const key = `${params[0]}:${params[1]}`;
        const inserted = !observations.has(key);
        observations.add(key);
        return { rowCount: inserted ? 1 : 0, rows: [] };
      }
      if (sql.includes('INSERT INTO lss_biological_media_evidence_links')) {
        const key = params.join(':');
        const inserted = !links.has(key);
        links.add(key);
        return { rowCount: inserted ? 1 : 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as any;

    expect(await seedBiologicalMediaEvidence(client)).toBe(17);
    expect(await seedBiologicalMediaEvidence(client)).toBe(0);
    expect(records.size).toBe(17);
    expect(observations.size).toBeGreaterThan(17);
    expect(links.size).toBe(9);
    expect(sqlCalls.every(sql => !sql.includes('DO UPDATE'))).toBe(true);
    expect(sqlCalls.filter(sql => sql.includes('INSERT INTO lss_biological_media_evidence_records'))
      .every(sql => sql.includes('ON CONFLICT (evidence_code, revision) DO NOTHING'))).toBe(true);
  });
});

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