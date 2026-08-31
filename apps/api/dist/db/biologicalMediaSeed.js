"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STARTER_TAN_PROFILES = exports.TAN_COEFFICIENT_UNIT = void 0;
exports.seedTanGenerationProfiles = seedTanGenerationProfiles;
exports.TAN_COEFFICIENT_UNIT = 'kg TAN-N/kg feed protein';
exports.STARTER_TAN_PROFILES = [
    {
        profile_code: 'EBELING_TIMMONS_GENERAL_RAS',
        profile_name: 'Ebeling Timmons general RAS',
        coefficient: 0.09216,
        recommended_application: 'Default for teleost fish where no validated species data exist.',
    },
    {
        profile_code: 'LOSORDO_NITROGEN_RETENTION_MODEL',
        profile_name: 'Losordo nitrogen retention model',
        coefficient: 0.080,
        recommended_application: 'Less conservative production estimate.',
    },
    {
        profile_code: 'AAT_CONSERVATIVE_LEGACY',
        profile_name: 'AAT conservative legacy',
        coefficient: 0.0976,
        recommended_application: 'May remain as an AAT controlled design profile.',
    },
    {
        profile_code: 'EVENTUAL_DISSOLVED_NITROGEN',
        profile_name: 'Eventual dissolved nitrogen',
        coefficient: 0.1024,
        recommended_application: 'Includes the nitrogen assumed to be excreted as urea and later converted to TAN.',
    },
    {
        profile_code: 'SPECIES_AND_FEED_VALIDATED',
        profile_name: 'Species and feed validated',
        coefficient: 0.0976,
        recommended_application: 'Preferred when reliable measured data exist.',
    },
    {
        profile_code: 'THEORETICAL_MAXIMUM',
        profile_name: 'Theoretical maximum',
        coefficient: 0.160,
        recommended_application: 'All feed protein nitrogen becoming TAN-N; normally unrealistically conservative.',
    },
];
/**
 * Seeds only the first revision for each stable starter code. The conflict
 * target deliberately does not update any column, so later administrator
 * revisions and edits can never be overwritten by a rerun.
 */
async function seedTanGenerationProfiles(client, adminId) {
    let seeded = 0;
    for (const profile of exports.STARTER_TAN_PROFILES) {
        const result = await client.query(`INSERT INTO lss_tan_generation_profiles
       (profile_code, profile_name, revision, coefficient, coefficient_unit,
        recommended_application, scope_type, evidence_reference, status, notes, created_by)
       VALUES ($1, $2, 1, $3, $4, $5, $6, NULL, 'Draft', $7, $8)
       ON CONFLICT (profile_code, revision) DO NOTHING`, [
            profile.profile_code,
            profile.profile_name,
            profile.coefficient,
            exports.TAN_COEFFICIENT_UNIT,
            profile.recommended_application,
            'Pending administrator review',
            'Starter reference — controlled evidence and scope required before approval.',
            adminId,
        ]);
        seeded += result.rowCount || 0;
    }
    return seeded;
}
