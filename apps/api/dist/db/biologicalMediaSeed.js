"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STARTER_MEDIA_PROFILES = exports.STARTER_TAN_PROFILES = exports.CONTROLLED_VALUE_TAN_PROFILE_CODE = exports.MEDIA_CAPACITY_BASIS_UNIT = exports.TAN_COEFFICIENT_UNIT = void 0;
exports.seedTanGenerationProfiles = seedTanGenerationProfiles;
exports.seedBiologicalMediaProfiles = seedBiologicalMediaProfiles;
exports.TAN_COEFFICIENT_UNIT = 'kg TAN-N/kg feed protein';
exports.MEDIA_CAPACITY_BASIS_UNIT = 'g TAN-N/m³ media/day';
exports.CONTROLLED_VALUE_TAN_PROFILE_CODE = 'SPECIES_AND_FEED_VALIDATED';
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
        profile_code: exports.CONTROLLED_VALUE_TAN_PROFILE_CODE,
        profile_name: 'Species and feed validated',
        coefficient: null,
        recommended_application: 'Requires an administrator-controlled, evidence-based value for the validated species and feed; no default is supplied.',
    },
    {
        profile_code: 'THEORETICAL_MAXIMUM',
        profile_name: 'Theoretical maximum',
        coefficient: 0.160,
        recommended_application: 'All feed protein nitrogen becoming TAN-N; normally unrealistically conservative.',
    },
];
const PRELIMINARY_MEDIA_LABEL = 'Preliminary engineering reference — administrator review required';
exports.STARTER_MEDIA_PROFILES = [
    {
        profile_code: 'FW_TF_25C',
        profile_name: 'Freshwater trickling filter — 200 m²/m³ plastic media',
        water_types: ['Freshwater'],
        reactor_types: ['Trickling filter'],
        overall_vtr_g_tan_n_m3_d: 90,
        operating_min_temperature_c: 25,
        operating_max_temperature_c: 25,
        operating_min_salinity_ppt: 0,
        operating_max_salinity_ppt: 0,
        operating_min_ph: 7.2,
        operating_max_ph: 7.2,
        operating_min_tan_mg_n_l: 2,
        operating_max_tan_mg_n_l: 2,
        operating_min_do_mg_l: 4,
        operating_max_do_mg_l: null,
        media_fill_fraction: null,
        provisional_label: PRELIMINARY_MEDIA_LABEL,
        notes: 'Conservative tested-condition reference only: warm freshwater at 25°C, pH 7.2, reference TAN 2 mg N/L, alkalinity ≥100 mg/L as CaCO₃, DO ≥4 mg/L, mature biofilm, and plastic media approximately 200 m²/m³. Not a universal media capacity; confirm the actual media, hydraulics, and evidence before approval.',
    },
    {
        profile_code: 'FW_MBBR_25C',
        profile_name: 'Freshwater MBBR — warm-water reference',
        water_types: ['Freshwater'],
        reactor_types: ['Moving bed biofilter', 'MBBR'],
        overall_vtr_g_tan_n_m3_d: 350,
        operating_min_temperature_c: 25,
        operating_max_temperature_c: 25,
        operating_min_salinity_ppt: 0,
        operating_max_salinity_ppt: 0,
        operating_min_ph: 7.2,
        operating_max_ph: 7.2,
        operating_min_tan_mg_n_l: 2,
        operating_max_tan_mg_n_l: 2,
        operating_min_do_mg_l: 4,
        operating_max_do_mg_l: null,
        media_fill_fraction: 0.7,
        provisional_label: PRELIMINARY_MEDIA_LABEL,
        notes: 'Tested-condition reference only: warm freshwater at 25°C, pH 7.2, reference TAN 2 mg N/L, alkalinity ≥100 mg/L as CaCO₃, DO ≥4 mg/L, mature biofilm, correct mixing and aeration, and reactor media fill no greater than 70%. Not a universal MBBR capacity; confirm the actual media and hydraulics before approval.',
    },
    {
        profile_code: 'FW_FB_8C_200',
        profile_name: 'Cold freshwater fixed bed — 200 m²/m³ media',
        water_types: ['Freshwater'],
        reactor_types: ['Fixed bed biofilter'],
        overall_vtr_g_tan_n_m3_d: 92,
        operating_min_temperature_c: 8,
        operating_max_temperature_c: 8,
        operating_min_salinity_ppt: 0,
        operating_max_salinity_ppt: 0,
        operating_min_ph: null,
        operating_max_ph: null,
        operating_min_tan_mg_n_l: 2.79,
        operating_max_tan_mg_n_l: 2.99,
        operating_min_do_mg_l: null,
        operating_max_do_mg_l: null,
        media_fill_fraction: null,
        provisional_label: PRELIMINARY_MEDIA_LABEL,
        notes: 'Conservative study-condition reference only: cold freshwater at 8°C, fixed Bioblok polyethylene media at 200 m²/m³, conditioned inlet TAN 2.89 ± 0.10 mg N/L, mature biofilm after approximately 3.5 months, and study flow 1–4 L/s. pH and alkalinity were not supplied for this seed; do not broaden the tested point or treat it as universal capacity.',
    },
    {
        profile_code: 'FW_MB_8C_850',
        profile_name: 'Cold freshwater moving bed — 850 m²/m³ media',
        water_types: ['Freshwater'],
        reactor_types: ['Moving bed biofilter'],
        overall_vtr_g_tan_n_m3_d: 231,
        operating_min_temperature_c: 8,
        operating_max_temperature_c: 8,
        operating_min_salinity_ppt: 0,
        operating_max_salinity_ppt: 0,
        operating_min_ph: null,
        operating_max_ph: null,
        operating_min_tan_mg_n_l: 2.79,
        operating_max_tan_mg_n_l: 2.99,
        operating_min_do_mg_l: null,
        operating_max_do_mg_l: null,
        media_fill_fraction: null,
        provisional_label: PRELIMINARY_MEDIA_LABEL,
        notes: 'Approximate study-condition reference only: approximately 231 g TAN-N/m³ media/day in cold freshwater at 8°C, moving Biomedia polypropylene carriers at 850 m²/m³, conditioned inlet TAN 2.89 ± 0.10 mg N/L, mature biofilm after approximately 3.5 months, and study flow 1–4 L/s. pH and alkalinity were not supplied for this seed; do not treat this maximum-rate study result as universal design capacity.',
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
/**
 * Seeds only revision one for each stable media-profile code. Conflicts are
 * intentionally ignored so reruns cannot overwrite an administrator's draft
 * edits, status changes, or later revisions.
 */
async function seedBiologicalMediaProfiles(client, adminId) {
    let seeded = 0;
    for (const profile of exports.STARTER_MEDIA_PROFILES) {
        const result = await client.query(`INSERT INTO lss_biological_media_profiles
       (profile_code, profile_name, revision, water_types, reactor_types,
        capacity_model, capacity_model_version, capacity_basis_unit,
        operating_min_temperature_c, operating_max_temperature_c,
        operating_min_salinity_ppt, operating_max_salinity_ppt,
        overall_vtr_g_tan_n_m3_d, media_fill_fraction,
        operating_min_ph, operating_max_ph,
        operating_min_tan_mg_n_l, operating_max_tan_mg_n_l,
        operating_min_do_mg_l, operating_max_do_mg_l,
        evidence_reference, is_provisional, provisional_label, status, notes, created_by)
       VALUES ($1,$2,1,$3,$4,'OVERALL_VTR','1',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        NULL,true,$18,'Draft',$19,$20)
       ON CONFLICT (profile_code, revision) DO NOTHING`, [
            profile.profile_code,
            profile.profile_name,
            profile.water_types,
            profile.reactor_types,
            exports.MEDIA_CAPACITY_BASIS_UNIT,
            profile.operating_min_temperature_c,
            profile.operating_max_temperature_c,
            profile.operating_min_salinity_ppt,
            profile.operating_max_salinity_ppt,
            profile.overall_vtr_g_tan_n_m3_d,
            profile.media_fill_fraction,
            profile.operating_min_ph,
            profile.operating_max_ph,
            profile.operating_min_tan_mg_n_l,
            profile.operating_max_tan_mg_n_l,
            profile.operating_min_do_mg_l,
            profile.operating_max_do_mg_l,
            profile.provisional_label,
            profile.notes,
            adminId,
        ]);
        seeded += result.rowCount || 0;
    }
    return seeded;
}
