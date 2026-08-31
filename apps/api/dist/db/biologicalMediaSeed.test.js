"use strict";
// @vitest-environment node
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const biologicalMediaSeed_1 = require("./biologicalMediaSeed");
(0, vitest_1.describe)('Biological Media review-only VTR evidence', () => {
    (0, vitest_1.it)('preserves ten supplied observations and seven distinct candidate recommendations', () => {
        const observations = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.filter(item => item.record_type === 'Observation');
        const candidates = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.filter(item => item.record_type === 'Candidate Recommendation');
        (0, vitest_1.expect)(observations).toHaveLength(10);
        (0, vitest_1.expect)(candidates).toHaveLength(7);
        (0, vitest_1.expect)(new Set(biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.map(item => item.evidence_code)).size).toBe(17);
        (0, vitest_1.expect)(candidates.map(item => item.candidate_profile_code)).toEqual([
            'FW_TF_25C',
            'FW_MBBR_25C',
            'BW_MBBR_LOW',
            'BW_MBBR_MODERATE',
            'SW_TF_CONSERVATIVE',
            'SW_TF_COMMERCIAL',
            'SW_MBBR_LOW_TAN',
        ]);
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.every(item => item.promotable === false)).toBe(true);
        (0, vitest_1.expect)(biologicalMediaSeed_1.BIOLOGICAL_MEDIA_EVIDENCE_REVIEW_STATUS).toBe('Review Needed');
    });
    (0, vitest_1.it)('keeps exact uncertainties, ranges, loading benchmark, and upper-performance qualifiers', () => {
        const mb3 = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_BRACKISH_MBBR_MB3');
        (0, vitest_1.expect)(mb3.observations).toEqual([
            vitest_1.expect.objectContaining({ value: 92, uncertainty: 26, value_text: '92 ± 26', unit: biologicalMediaSeed_1.BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT }),
            vitest_1.expect.objectContaining({ value: 186, uncertainty: 54, value_text: '186 ± 54', unit: biologicalMediaSeed_1.BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT }),
        ]);
        const redDrum = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_BRACKISH_RED_DRUM_MOVING_BEDS');
        (0, vitest_1.expect)(redDrum.observations[0]).toMatchObject({ value_min: 39, value_max: 87, value_text: 'approximately 39 to 87', qualifier: 'Average values' });
        const sand = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_MARINE_FLUIDIZED_SAND');
        (0, vitest_1.expect)(sand).toMatchObject({ evidence_classification: 'Loading benchmark', promotable: false });
        (0, vitest_1.expect)(sand.observations[0]).toMatchObject({ value: 500, unit: biologicalMediaSeed_1.BIOLOGICAL_MEDIA_EVIDENCE_LOADING_UNIT, qualifier: 'Loading benchmark' });
        (0, vitest_1.expect)(sand.promotion_exclusion_reason).toContain('excluded from direct Overall-VTR promotion');
        const intensive = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.evidence_code === 'OBS_INTENSIVE_MARINE_MOVING_BED');
        (0, vitest_1.expect)(intensive.qualification).toContain('upper performance');
        (0, vitest_1.expect)(intensive.limitations).toBe('Not suitable as a general design value.');
    });
    (0, vitest_1.it)('keeps conservative and commercial curves separate and review-only', () => {
        const conservative = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.candidate_profile_code === 'SW_TF_CONSERVATIVE');
        const commercial = biologicalMediaSeed_1.STARTER_BIOLOGICAL_MEDIA_EVIDENCE.find(item => item.candidate_profile_code === 'SW_TF_COMMERCIAL');
        (0, vitest_1.expect)(conservative.curve_guidance).toMatchObject({
            curve_name: 'Nijhof conservative marine curve',
            default_selection: 'Conservative default',
            below_threshold_note: vitest_1.expect.stringContaining('validated rate required'),
        });
        (0, vitest_1.expect)(commercial.curve_guidance).toMatchObject({
            curve_name: 'Díaz commercial marine curve',
            selection_requirement: 'Engineer selection required',
            below_threshold_note: vitest_1.expect.stringContaining('never zero or extrapolation'),
        });
        (0, vitest_1.expect)(conservative.observations).toHaveLength(8);
        (0, vitest_1.expect)(commercial.observations.at(-1)).toMatchObject({ condition_label: '≥3.20 mg/L', value: 102.4 });
        (0, vitest_1.expect)(commercial.linked_evidence_codes).toEqual([
            { code: 'OBS_MARINE_COMMERCIAL_TRICKLING_FILTER', relationship: 'related marine observation' },
        ]);
    });
    (0, vitest_1.it)('seeds records, observations, and links idempotently without updates', async () => {
        const sources = new Map();
        const records = new Map();
        const observations = new Set();
        const links = new Set();
        const sqlCalls = [];
        const query = vitest_1.vi.fn(async (sql, params = []) => {
            sqlCalls.push(sql);
            if (sql.includes('INSERT INTO lss_biological_media_evidence_sources')) {
                if (sources.has(params[0]))
                    return { rowCount: 0, rows: [] };
                const id = `source-${sources.size + 1}`;
                sources.set(params[0], id);
                return { rowCount: 1, rows: [{ id }] };
            }
            if (sql.includes('SELECT id FROM lss_biological_media_evidence_sources')) {
                return { rowCount: 1, rows: [{ id: sources.get(params[0]) }] };
            }
            if (sql.includes('INSERT INTO lss_biological_media_evidence_records')) {
                if (records.has(params[0]))
                    return { rowCount: 0, rows: [] };
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
        const client = { query };
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedBiologicalMediaEvidence)(client)).toBe(17);
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedBiologicalMediaEvidence)(client)).toBe(0);
        (0, vitest_1.expect)(records.size).toBe(17);
        (0, vitest_1.expect)(observations.size).toBeGreaterThan(17);
        (0, vitest_1.expect)(links.size).toBe(9);
        (0, vitest_1.expect)(sqlCalls.every(sql => !sql.includes('DO UPDATE'))).toBe(true);
        (0, vitest_1.expect)(sqlCalls.filter(sql => sql.includes('INSERT INTO lss_biological_media_evidence_records'))
            .every(sql => sql.includes('ON CONFLICT (evidence_code, revision) DO NOTHING'))).toBe(true);
    });
});
(0, vitest_1.describe)('Biological Media Overall VTR starter profiles', () => {
    (0, vitest_1.it)('preserves the four preliminary reference values, units, and qualifications', () => {
        (0, vitest_1.expect)(biologicalMediaSeed_1.MEDIA_CAPACITY_BASIS_UNIT).toBe('g TAN-N/m³ media/day');
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES).toHaveLength(4);
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES.map(profile => ({
            code: profile.profile_code,
            rate: profile.overall_vtr_g_tan_n_m3_d,
        }))).toEqual([
            { code: 'FW_TF_25C', rate: 90 },
            { code: 'FW_MBBR_25C', rate: 350 },
            { code: 'FW_FB_8C_200', rate: 92 },
            { code: 'FW_MB_8C_850', rate: 231 },
        ]);
        (0, vitest_1.expect)(new Set(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES.map(profile => profile.profile_code)).size).toBe(4);
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES.every(profile => profile.provisional_label.includes('review required'))).toBe(true);
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES[0].notes).toContain('alkalinity ≥100 mg/L as CaCO₃');
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES[0].notes).toContain('Not a universal media capacity');
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES[1].media_fill_fraction).toBe(0.7);
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES[2].notes).toContain('8°C');
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES[3].notes).toContain('approximately 231');
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_MEDIA_PROFILES[3].notes).toContain('maximum-rate study result');
    });
    (0, vitest_1.it)('seeds draft revision one idempotently without evidence or destructive conflict handling', async () => {
        const query = vitest_1.vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
        const client = { query };
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedBiologicalMediaProfiles)(client, 'admin-1')).toBe(4);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(4);
        for (const call of query.mock.calls) {
            (0, vitest_1.expect)(call[0]).toContain("NULL,true,$18,'Draft'");
            (0, vitest_1.expect)(call[0]).toContain('ON CONFLICT (profile_code, revision) DO NOTHING');
            (0, vitest_1.expect)(call[0]).not.toContain('DO UPDATE');
            (0, vitest_1.expect)(call[1][4]).toBe(biologicalMediaSeed_1.MEDIA_CAPACITY_BASIS_UNIT);
        }
        query.mockClear();
        query.mockResolvedValue({ rowCount: 0, rows: [] });
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedBiologicalMediaProfiles)(client, 'admin-1')).toBe(0);
    });
    (0, vitest_1.it)('fills only missing starter revisions on an existing database', async () => {
        const query = vitest_1.vi.fn()
            .mockResolvedValueOnce({ rowCount: 0, rows: [] })
            .mockResolvedValue({ rowCount: 1, rows: [] });
        const client = { query };
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedBiologicalMediaProfiles)(client, 'admin-1')).toBe(3);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(4);
        (0, vitest_1.expect)(query.mock.calls[0][1][0]).toBe('FW_TF_25C');
        (0, vitest_1.expect)(query.mock.calls[1][1][0]).toBe('FW_MBBR_25C');
        (0, vitest_1.expect)(query.mock.calls[3][1][9]).toBe(231);
    });
});
(0, vitest_1.describe)('Biological Media TAN starter profiles', () => {
    (0, vitest_1.it)('uses the exact controlled starter values, names, and recommendations', () => {
        (0, vitest_1.expect)(biologicalMediaSeed_1.TAN_COEFFICIENT_UNIT).toBe('kg TAN-N/kg feed protein');
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_TAN_PROFILES).toEqual([
            vitest_1.expect.objectContaining({ profile_name: 'Ebeling Timmons general RAS', coefficient: 0.09216, recommended_application: 'Default for teleost fish where no validated species data exist.' }),
            vitest_1.expect.objectContaining({ profile_name: 'Losordo nitrogen retention model', coefficient: 0.080, recommended_application: 'Less conservative production estimate.' }),
            vitest_1.expect.objectContaining({ profile_name: 'AAT conservative legacy', coefficient: 0.0976, recommended_application: 'May remain as an AAT controlled design profile.' }),
            vitest_1.expect.objectContaining({ profile_name: 'Eventual dissolved nitrogen', coefficient: 0.1024, recommended_application: 'Includes the nitrogen assumed to be excreted as urea and later converted to TAN.' }),
            vitest_1.expect.objectContaining({ profile_name: 'Species and feed validated', coefficient: null, recommended_application: vitest_1.expect.stringContaining('administrator-controlled') }),
            vitest_1.expect.objectContaining({ profile_name: 'Theoretical maximum', coefficient: 0.160, recommended_application: 'All feed protein nitrogen becoming TAN-N; normally unrealistically conservative.' }),
        ]);
        (0, vitest_1.expect)(new Set(biologicalMediaSeed_1.STARTER_TAN_PROFILES.map(profile => profile.profile_code)).size).toBe(6);
    });
    (0, vitest_1.it)('is idempotent and never overwrites revision one', async () => {
        const query = vitest_1.vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
        const client = { query };
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedTanGenerationProfiles)(client, 'admin-1')).toBe(6);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(6);
        for (const call of query.mock.calls) {
            (0, vitest_1.expect)(call[0]).toContain('ON CONFLICT (profile_code, revision) DO NOTHING');
            (0, vitest_1.expect)(call[0]).not.toContain('DO UPDATE');
            (0, vitest_1.expect)(call[1][3]).toBe(biologicalMediaSeed_1.TAN_COEFFICIENT_UNIT);
        }
        query.mockClear();
        query.mockResolvedValue({ rowCount: 0, rows: [] });
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedTanGenerationProfiles)(client, 'admin-1')).toBe(0);
    });
    (0, vitest_1.it)('fills missing starter revisions on an existing database without touching an existing revision', async () => {
        const query = vitest_1.vi.fn()
            .mockResolvedValueOnce({ rowCount: 0, rows: [] })
            .mockResolvedValue({ rowCount: 1, rows: [] });
        const client = { query };
        (0, vitest_1.expect)(await (0, biologicalMediaSeed_1.seedTanGenerationProfiles)(client, 'admin-1')).toBe(5);
        (0, vitest_1.expect)(query).toHaveBeenCalledTimes(6);
        (0, vitest_1.expect)(query.mock.calls[0][1][0]).toBe('EBELING_TIMMONS_GENERAL_RAS');
        (0, vitest_1.expect)(query.mock.calls[0][1][2]).toBe(0.09216);
        (0, vitest_1.expect)(query.mock.calls[4][1][0]).toBe(biologicalMediaSeed_1.CONTROLLED_VALUE_TAN_PROFILE_CODE);
        (0, vitest_1.expect)(query.mock.calls[4][1][2]).toBeNull();
        (0, vitest_1.expect)(query.mock.calls[4][0]).toContain('ON CONFLICT (profile_code, revision) DO NOTHING');
    });
});
