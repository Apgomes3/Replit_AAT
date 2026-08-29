// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { isBiologicalMediaPreviewStale, validateMediaProfile, validateTanProfile } from './biologicalMedia';

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