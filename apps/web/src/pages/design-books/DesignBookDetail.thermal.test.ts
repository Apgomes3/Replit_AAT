import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DESIGN_BOOK_TAB_ORDER,
  isDesignBookTab,
  SystemConfigBadge,
  thermalEvidenceBasis,
  thermalCorrelationDefaults,
  thermalCorrelationVersionsForClass,
  thermalWallFormValues,
  thermalWallOverrideFlags,
  thermalWallReplacementIsValid,
} from './DesignBookDetail';

describe('Design Book Life Support Systems list', () => {
  it('labels bespoke and compact configurations explicitly', () => {
    render(
      createElement(
        'div',
        null,
        createElement(SystemConfigBadge, { config: 'bespoke' }),
        createElement(SystemConfigBadge, { config: 'compact' }),
      ),
    );

    expect(screen.getByText('Bespoke')).toBeInTheDocument();
    expect(screen.getByText('LSS Compact Unit')).toBeInTheDocument();
  });
});

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

  it('filters approved versions to the selected surface-activity class', () => {
    const items = [
      { id: 'calm-current', class_code: 'calm_covered', version: '2', status: 'approved' },
      { id: 'calm-old', class_code: 'calm_covered', version: '1', status: 'superseded' },
      { id: 'active-current', class_code: 'splashing_active', version: '1', status: 'approved' },
    ];
    expect(thermalCorrelationVersionsForClass(items, 'calm_covered', 'calm-old')
      .map(item => item.id)).toEqual(['calm-current', 'calm-old']);
    expect(thermalCorrelationVersionsForClass(items, 'calm_covered')
      .map(item => item.id)).toEqual(['calm-current']);
  });

  it('maps approved database values into the guided form defaults', () => {
    expect(thermalCorrelationDefaults({
      coefficient_kg_m2_s_kpa: 1.2e-6,
      lower_agitation_class_code: 'calm_covered',
      lower_class_coefficient_kg_m2_s_kpa: 0.8e-6,
      adjustment_value: 0.15,
      upper_agitation_class_code: 'high_agitation_aerated',
      upper_class_coefficient_kg_m2_s_kpa: 1.8e-6,
    })).toEqual({
      evaporation_coefficient_kg_m2_s_kpa: 1.2e-6,
      adjacent_lower_class: 'calm_covered',
      adjacent_lower_coefficient: 0.8e-6,
      correlation_adjustment_value: 0.15,
      adjacent_upper_class: 'high_agitation_aerated',
      adjacent_upper_coefficient: 1.8e-6,
    });
  });

  it('populates and resets effective wall values from a governed construction', () => {
    const acrylic = {
      material: 'Acrylic / PMMA',
      thickness_mm: 12,
      conductivity_w_m_k: 0.19,
    };
    expect(thermalWallFormValues(acrylic)).toEqual({
      wall_material: 'Acrylic / PMMA',
      wall_thickness_mm: 12,
      wall_conductivity_w_m_k: 0.19,
    });
    expect(thermalWallOverrideFlags(thermalWallFormValues(acrylic), acrylic)).toEqual({
      material: false,
      thickness_mm: false,
      conductivity_w_m_k: false,
    });
    expect(thermalWallOverrideFlags({
      wall_material: 'Project acrylic',
      wall_thickness_mm: '20',
      wall_conductivity_w_m_k: '0.2',
    }, acrylic)).toEqual({
      material: true,
      thickness_mm: true,
      conductivity_w_m_k: true,
    });
  });

  it('blocks incomplete and non-positive wall replacement approvals', () => {
    const valid = {
      construction_code: 'acrylic',
      construction_label: 'Acrylic',
      material: 'Acrylic / PMMA',
      thickness_mm: '20',
      conductivity_w_m_k: '0.19',
      source_basis: 'AAT Foundations',
      source_reference: 'AAT Foundations 2026',
      version: 'AAT_FOUNDATIONS_WALL_V2.0',
      notes: '',
    };

    expect(thermalWallReplacementIsValid(valid)).toBe(true);
    expect(thermalWallReplacementIsValid({ ...valid, material: '' })).toBe(false);
    expect(thermalWallReplacementIsValid({ ...valid, thickness_mm: 0 })).toBe(false);
    expect(thermalWallReplacementIsValid({ ...valid, conductivity_w_m_k: -0.1 })).toBe(false);
    expect(thermalWallReplacementIsValid({ ...valid, source_reference: '' })).toBe(false);
  });
});