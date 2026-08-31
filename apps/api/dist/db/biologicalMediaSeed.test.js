"use strict";
// @vitest-environment node
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const biologicalMediaSeed_1 = require("./biologicalMediaSeed");
(0, vitest_1.describe)('Biological Media TAN starter profiles', () => {
    (0, vitest_1.it)('uses the exact controlled starter values, names, and recommendations', () => {
        (0, vitest_1.expect)(biologicalMediaSeed_1.TAN_COEFFICIENT_UNIT).toBe('kg TAN-N/kg feed protein');
        (0, vitest_1.expect)(biologicalMediaSeed_1.STARTER_TAN_PROFILES).toEqual([
            vitest_1.expect.objectContaining({ profile_name: 'Ebeling Timmons general RAS', coefficient: 0.09216, recommended_application: 'Default for teleost fish where no validated species data exist.' }),
            vitest_1.expect.objectContaining({ profile_name: 'Losordo nitrogen retention model', coefficient: 0.080, recommended_application: 'Less conservative production estimate.' }),
            vitest_1.expect.objectContaining({ profile_name: 'AAT conservative legacy', coefficient: 0.0976, recommended_application: 'May remain as an AAT controlled design profile.' }),
            vitest_1.expect.objectContaining({ profile_name: 'Eventual dissolved nitrogen', coefficient: 0.1024, recommended_application: 'Includes the nitrogen assumed to be excreted as urea and later converted to TAN.' }),
            vitest_1.expect.objectContaining({ profile_name: 'Species and feed validated', coefficient: 0.0976, recommended_application: 'Preferred when reliable measured data exist.' }),
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
});
