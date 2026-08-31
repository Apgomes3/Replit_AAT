"use strict";
// @vitest-environment node
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const biologicalMediaSeed_1 = require("./biologicalMediaSeed");
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
