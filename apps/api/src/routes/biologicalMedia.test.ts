// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { validateMediaProfile, validateTanProfile } from './biologicalMedia';

const completeMediaProfile = {
  profile_code: 'MEDIA-01',
  profile_name: 'Controlled moving-bed media',
  water_types: ['Freshwater'],
  reactor_types: ['Moving bed biofilter'],
  capacity_model: 'Evidence-based capacity curve',
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