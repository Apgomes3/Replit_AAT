import type { PoolClient } from 'pg';

export const TAN_COEFFICIENT_UNIT = 'kg TAN-N/kg feed protein';
export const CONTROLLED_VALUE_TAN_PROFILE_CODE = 'SPECIES_AND_FEED_VALIDATED';

export const STARTER_TAN_PROFILES = [
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
    profile_code: CONTROLLED_VALUE_TAN_PROFILE_CODE,
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
] as const;

/**
 * Seeds only the first revision for each stable starter code. The conflict
 * target deliberately does not update any column, so later administrator
 * revisions and edits can never be overwritten by a rerun.
 */
export async function seedTanGenerationProfiles(client: PoolClient, adminId: string | null): Promise<number> {
  let seeded = 0;
  for (const profile of STARTER_TAN_PROFILES) {
    const result = await client.query(
      `INSERT INTO lss_tan_generation_profiles
       (profile_code, profile_name, revision, coefficient, coefficient_unit,
        recommended_application, scope_type, evidence_reference, status, notes, created_by)
       VALUES ($1, $2, 1, $3, $4, $5, $6, NULL, 'Draft', $7, $8)
       ON CONFLICT (profile_code, revision) DO NOTHING`,
      [
        profile.profile_code,
        profile.profile_name,
        profile.coefficient,
        TAN_COEFFICIENT_UNIT,
        profile.recommended_application,
        'Pending administrator review',
        'Starter reference — controlled evidence and scope required before approval.',
        adminId,
      ],
    );
    seeded += result.rowCount || 0;
  }
  return seeded;
}