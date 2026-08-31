import { describe, expect, it } from 'vitest';
import {
  DESIGN_BOOK_TAB_ORDER,
  isDesignBookTab,
  thermalEvidenceBasis,
} from './DesignBookDetail';

describe('Design Book Thermal navigation', () => {
  it('places Thermal immediately after Life Support Systems', () => {
    expect(DESIGN_BOOK_TAB_ORDER).toEqual([
      'exhibits',
      'lss',
      'thermal',
      'piping',
      'review',
      'versions',
    ]);
  });

  it('accepts the URL-addressable Thermal tab without conflating LSS detail tabs', () => {
    expect(isDesignBookTab('thermal')).toBe(true);
    expect(isDesignBookTab('thermal-selection')).toBe(false);
  });

  it('reads immutable temperature and wall evidence from a saved calculation', () => {
    const temperature = {
      minimum_c: 24,
      maximum_c: 26,
      average_c: 25,
      calculated_temperature_c: 25,
      reviewed_override_used: false,
    };
    const wall = {
      construction_type: 'frp',
      construction_label: 'FRP',
      u_value_w_m2_k: 2.5,
      units: 'W/m²·K',
      basis_version: 'aat-thermal-construction-v1',
    };

    expect(thermalEvidenceBasis({
      water_temperature_basis: temperature,
      wall_construction_basis: wall,
    })).toEqual({ temperature, wall });
  });

  it('falls back to frozen input evidence for older result wrappers', () => {
    const temperature = { calculated_temperature_c: 27, reviewed_override_used: true };
    const wall = { source: 'reviewed custom U-value', u_value_w_m2_k: 2.75 };

    expect(thermalEvidenceBasis({
      inputs: {
        water_temperature_basis: temperature,
        wall_construction_basis: wall,
      },
    })).toEqual({ temperature, wall });
  });
});