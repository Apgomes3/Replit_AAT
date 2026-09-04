// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  compareBiologicalMediaRuns,
  isBiologicalMediaPreviewStale,
  maximumTanRunError,
  renderBiologicalMediaRunSummary,
  serializeJsonbParam,
  validateMaxTanProfile,
  validateMediaProfile,
  validateTanProfile,
} from './biologicalMedia';

const completeMediaProfile = {
  profile_code: 'MEDIA-01',
  profile_name: 'Controlled moving-bed media',
  water_types: ['Freshwater'],
  reactor_types: ['Moving bed biofilter'],
  capacity_model: 'OVERALL_VTR',
  capacity_model_version: '1',
  capacity_basis_unit: 'g TAN/m³/day',
  operating_min_temperature_c: 10,
  operating_max_temperature_c: 28,
  operating_min_salinity_ppt: 0,
  operating_max_salinity_ppt: 5,
  media_min_depth_mm: 500,
  media_max_depth_mm: 1200,
  media_void_fraction: 0.65,
  media_bulk_density_kg_m3: 110,
  overall_vtr_g_tan_n_m3_d: 90,
  default_safety_factor: 1.2,
  minimum_media_m3: 0,
  module_increment_m3: 0.01,
  media_fill_fraction: 0.6,
  operating_min_ph: 6,
  operating_max_ph: 9,
  operating_min_tan_mg_n_l: 0,
  operating_max_tan_mg_n_l: 2,
  evidence_reference: 'ENG-REF-001',
};

describe('Biological Media controlled profile validation', () => {
  it('accepts a complete media revision for approval', () => {
    expect(validateMediaProfile(completeMediaProfile, true)).toEqual([]);
  });

  it('allows media evidence to remain incomplete while a revision is a draft', () => {
    expect(validateMediaProfile({
      ...completeMediaProfile,
      evidence_reference: '',
      status: 'Draft',
    }, false)).toEqual([]);
    expect(validateMediaProfile({
      ...completeMediaProfile,
      evidence_reference: '',
      status: 'Approved',
    }, true)).toContain('Evidence reference is required.');
  });

  it('rejects contradictory and incomplete media revisions before approval', () => {
    const errors = validateMediaProfile({
      ...completeMediaProfile,
      operating_min_temperature_c: 30,
      operating_max_temperature_c: 20,
      media_void_fraction: 1.2,
      evidence_reference: '',
    }, true);

    expect(errors).toContain('Operating temperature minimum cannot exceed maximum.');
    expect(errors).toContain('Media void fraction must be between 0 and 1.');
    expect(errors).toContain('Evidence reference is required.');
  });

  it('requires explicit labeling for provisional engineering data', () => {
    expect(validateMediaProfile({
      ...completeMediaProfile,
      is_provisional: true,
      provisional_label: '',
    }, true)).toContain('Provisional profiles require an explicit provisional label.');
  });

  it('rejects invalid TAN coefficients and ranges', () => {
    expect(validateTanProfile({
      profile_code: 'TAN-01',
      profile_name: 'Global feeding TAN',
      coefficient: 0,
      coefficient_unit: 'g TAN/kg feed',
      scope_type: 'Global feeding',
      scope_min: 10,
      scope_max: 5,
      evidence_reference: '',
    })).toEqual(expect.arrayContaining([
      'Coefficient must be greater than zero.',
      'Scope range minimum cannot exceed maximum.',
      'Evidence reference is required.',
    ]));
  });

  it('allows incomplete evidence on a draft but requires it for approval', () => {
    const draft = {
      profile_code: 'TAN-02',
      profile_name: 'Draft controlled TAN reference',
      coefficient: 0.09216,
      coefficient_unit: 'kg TAN-N/kg feed protein',
      recommended_application: 'Default where no validated species data exist.',
      scope_type: 'Pending administrator review',
      evidence_reference: '',
      status: 'Draft',
    };

    expect(validateTanProfile(draft, false)).toEqual([]);
    expect(validateTanProfile({ ...draft, status: 'Approved' }, true)).toContain('Evidence reference is required.');
  });

  it('requires the confirmed TAN coefficient unit', () => {
    expect(validateTanProfile({
      profile_code: 'TAN-03',
      profile_name: 'Wrong unit',
      coefficient: 0.08,
      coefficient_unit: 'g TAN/kg feed',
      scope_type: 'Global feeding',
      evidence_reference: 'CONTROLLED-REF',
    })).toContain('Coefficient unit must be kg TAN-N/kg feed protein.');
  });

  it('allows the species-and-feed starter to remain controlled-value-only in draft', () => {
    const draft = {
      profile_code: 'SPECIES_AND_FEED_VALIDATED',
      profile_name: 'Species and feed validated',
      coefficient: null,
      coefficient_unit: 'kg TAN-N/kg feed protein',
      scope_type: 'Species and feed validated',
      evidence_reference: '',
      status: 'Draft',
    };

    expect(validateTanProfile(draft, false)).toEqual([]);
    expect(validateTanProfile({ ...draft, status: 'Approved' }, true)).toContain('Coefficient must be greater than zero.');
    expect(validateTanProfile({ ...draft, coefficient: 'not-a-number' }, false)).toContain('Coefficient must be greater than zero.');
  });

  it('accepts zero and positive Maximum TAN profiles but rejects missing, negative, and non-finite values', () => {
    expect(validateMaxTanProfile({
      profile_code: 'ZERO_LIMIT',
      profile_name: 'Zero limit',
      max_tan_mg_n_l: 0,
    })).toEqual([]);
    expect(validateMaxTanProfile({
      profile_code: 'PUBLIC_AQUARIUM',
      profile_name: 'Public Aquarium',
      max_tan_mg_n_l: 0.1,
    })).toEqual([]);
    expect(validateMaxTanProfile({
      profile_code: '',
      profile_name: '',
      max_tan_mg_n_l: -0.1,
    })).toEqual(expect.arrayContaining([
      'Profile code is required.',
      'Profile name is required.',
      'Maximum TAN must be a finite, non-negative mg N/L value.',
    ]));
    expect(validateMaxTanProfile({
      profile_code: 'BAD',
      profile_name: 'Bad value',
      max_tan_mg_n_l: 'Infinity',
    })).toContain('Maximum TAN must be a finite, non-negative mg N/L value.');
  });

  it('allows valid Custom run values and blocks retired controlled profiles from new runs', () => {
    expect(maximumTanRunError({
      max_tan_source: 'CUSTOM',
      max_tan_mg_n_l: 0.25,
      max_tan_profile_revision_id: null,
    })).toBeNull();
    expect(maximumTanRunError({
      max_tan_source: 'CONTROLLED',
      max_tan_mg_n_l: 0.1,
      max_tan_profile_revision_id: 'profile-1',
    }, {
      id: 'profile-1',
      status: 'Approved',
    })).toBeNull();
    expect(maximumTanRunError({
      max_tan_source: 'CONTROLLED',
      max_tan_mg_n_l: 0.1,
      max_tan_profile_revision_id: 'profile-1',
    }, {
      id: 'profile-1',
      status: 'Retired',
    })).toMatch(/no longer approved/i);
  });
});

describe('Biological Media preview freshness', () => {
  const record = {
    preview_result: { status: 'VALID' },
    preview_stale: false,
    preview_input_snapshot: {
      biomass: { water_volume_m3: 42.125 },
      water: { water_type: 'FRESHWATER' },
    },
  };

  it('keeps a preview current only while authoritative linked context matches', () => {
    expect(isBiologicalMediaPreviewStale(record, {
      total_operating_volume_m3: 42.125,
      system_water_type: 'Freshwater',
    })).toBe(false);
  });

  it('marks upstream linked-volume and water-type changes stale', () => {
    expect(isBiologicalMediaPreviewStale(record, {
      total_operating_volume_m3: 43,
      system_water_type: 'Freshwater',
    })).toBe(true);
    expect(isBiologicalMediaPreviewStale(record, {
      total_operating_volume_m3: 42.125,
      system_water_type: 'Marine',
    })).toBe(true);
  });
});

describe('Biological Media run snapshot persistence', () => {
  it('serializes array snapshots as JSON rather than PostgreSQL array literals', () => {
    const species = [{ species_name: 'Shark', biomass_kg: 120 }];
    const messages = [{ code: 'MEDIA_W01', severity: 'WARNING' }];

    expect(serializeJsonbParam(species)).toBe('[{"species_name":"Shark","biomass_kg":120}]');
    expect(serializeJsonbParam(messages)).toBe('[{"code":"MEDIA_W01","severity":"WARNING"}]');
    expect(JSON.parse(serializeJsonbParam([]))).toEqual([]);
  });
});

describe('Biological Media immutable run presentation', () => {
  const run = {
    id: 'run-1',
    run_number: 3,
    status: 'Approved',
    calculation_status: 'VALID_WITH_WARNINGS',
    executed_at: '2026-08-29T09:00:00.000Z',
    engine_version: 'BIOFILTER_1_0',
    created_by_name: 'Design Engineer',
    warning_acknowledged: true,
    approved_by_name: 'Approval Engineer',
    approved_at: '2026-08-29T09:30:00.000Z',
    review_notes: 'Warnings reviewed.',
    linked_volume_context_snapshot: {
      total_operating_volume_m3: 42.125,
      system_water_type: 'Freshwater',
    },
    media_profile_snapshot: {
      profile_code: 'MEDIA-01',
      revision: 4,
      evidence_reference: 'MEDIA-EVIDENCE-R4',
    },
    tan_profile_snapshot: {
      profile_code: 'TAN-01',
      revision: 2,
      evidence_reference: 'TAN-EVIDENCE-R2',
    },
    max_tan_profile_snapshot: {
      source: 'CONTROLLED',
      profile_code: 'PUBLIC_AQUARIUM',
      profile_name: 'Public Aquarium',
      revision: 1,
      max_tan_mg_n_l: 0.1,
    },
    normalized_input_snapshot: { filter: { safety_factor: 1.2 } },
    result_snapshot: {
      biomass: { design_biomass_kg: 420 },
      feeding: { total_feed_kg_d: 8.4, tan_load_g_n_d: 100 },
      media: { required_media_l: 1100, installed_media_l: 1200 },
    },
    assumptions: ['TAN nitrogen remains the sizing mass basis.'],
    messages: [{ code: 'MEDIA_W01', severity: 'WARNING', message: 'Minimum module installed.' }],
    overrides_snapshot: [],
  };

  it('exports only frozen profile evidence, results, warnings, engine, and approval metadata', () => {
    const summary = renderBiologicalMediaRunSummary(run);
    expect(summary).toContain('MEDIA-01 r4');
    expect(summary).toContain('MEDIA-EVIDENCE-R4');
    expect(summary).toContain('BIOFILTER_1_0');
    expect(summary).toContain('Installed media: 1200 L');
    expect(summary).toContain('WARNING MEDIA_W01');
    expect(summary).toContain('Approval Engineer');
    expect(summary).toContain('PUBLIC_AQUARIUM r1');
    expect(summary).toContain('Maximum TAN concentration: 0.1 mg N/L');
  });

  it('compares frozen inputs, profile revisions, outputs, warnings, and approval state', () => {
    const comparison = compareBiologicalMediaRuns(run, {
      ...run,
      id: 'run-2',
      run_number: 4,
      status: 'Pending Review',
      media_profile_snapshot: { ...run.media_profile_snapshot, revision: 5 },
      max_tan_profile_snapshot: {
        source: 'CUSTOM',
        profile_code: null,
        profile_name: 'Custom',
        revision: null,
        max_tan_mg_n_l: 0.25,
      },
      normalized_input_snapshot: { filter: { safety_factor: 1.4 } },
      result_snapshot: { ...run.result_snapshot, media: { required_media_l: 1300, installed_media_l: 1400 } },
      messages: [],
    });
    expect(comparison.changes.inputs).toHaveLength(1);
    expect(comparison.changes.media_profile).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'revision', before: 4, after: 5 }),
    ]));
    expect(comparison.changes.max_tan_profile).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'source', before: 'CONTROLLED', after: 'CUSTOM' }),
      expect.objectContaining({ field: 'max_tan_mg_n_l', before: 0.1, after: 0.25 }),
    ]));
    expect(comparison.changes.results).toHaveLength(1);
    expect(comparison.changes.warnings).toHaveLength(1);
    expect(comparison.changes.approval).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'status', before: 'Approved', after: 'Pending Review' }),
    ]));
  });
});