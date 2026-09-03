import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { describe, expect, it } from 'vitest';
import Button, { THERMAL_BUTTON_COLORS } from '../../components/ui/Button';
import {
  DESIGN_BOOK_TAB_ORDER,
  isDesignBookTab,
  SystemConfigBadge,
  thermalEvidenceBasis,
  thermalCorrelationDefaults,
  thermalCorrelationVersionsForClass,
  normalizeThermalWallConstruction,
  thermalExhibitTankWallBasis,
  thermalExhibitTankWallBases,
  thermalLinkedFreeSurfaceArea,
  thermalWallBasesAreMixed,
  thermalWallFormValues,
  thermalWallOverrideFlags,
  thermalWallReplacementIsValid,
  ThermalNumericField,
  MassTransferCoefficientControl,
  WallUValueControl,
  WaterTemperatureOverrideControl,
  EffectiveRadiantSurroundingsTemperature,
  SurfaceActivityGuidance,
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
  it('uses current linked tank free-surface values, including custom tanks', () => {
    expect(thermalLinkedFreeSurfaceArea({
      linked_tanks: [
        { tank_id: 'custom-1', shape: 'custom', free_surface_area_m2: 12.5 },
        { tank_id: 'custom-2', shape: 'custom', free_surface_area_m2: 3.25 },
      ],
    })).toBe(15.75);
    expect(thermalLinkedFreeSurfaceArea({
      linked_tanks: [{ tank_id: 'custom-1', shape: 'custom', free_surface_area_m2: null }],
    })).toBeNull();
    expect(thermalLinkedFreeSurfaceArea({
      linked_tanks: [{ tank_id: 'custom-1', shape: 'custom', surface_area_m2: '12.5' }],
    })).toBe(12.5);
    expect(thermalLinkedFreeSurfaceArea({
      linked_tanks: [{
        tank_id: 'custom-1',
        shape: 'custom',
        quantity: 1,
        free_surface_area_m2: null,
        dimensions: { inner_length_mm: 7600, inner_width_mm: 7600 },
      }],
    })).toBe(57.76);
  });
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
    })).toEqual({
      temperature,
      wall: expect.objectContaining({
        construction_type: 'frp',
        construction_label: 'FRP',
        label: 'FRP',
        units: 'W/m²·K',
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
        assumption_label: 'Saved Thermal wall assumption — FRP',
        basis_version: 'aat-thermal-construction-v1',
      }),
    });
  });

  it('falls back to frozen input evidence for older result wrappers', () => {
    const temperature = { calculated_temperature_c: 27, reviewed_override_used: true };
    const wall = { source: 'reviewed custom U-value', u_value_w_m2_k: 2.75 };

    expect(thermalEvidenceBasis({
      inputs: {
        water_temperature_basis: temperature,
        wall_construction_basis: wall,
      },
    })).toEqual({
      temperature,
      wall: expect.objectContaining({
        source: 'reviewed custom U-value',
        u_value_w_m2_k: 2.75,
        units: 'W/m²·K',
        assumption_label: 'Saved Thermal wall assumption',
      }),
    });
  });

  it('normalizes saved metre layers and database-default field names for the form', () => {
    expect(normalizeThermalWallConstruction({
      construction_code: 'acrylic',
      construction_label: 'Acrylic',
      material: 'Acrylic / PMMA',
      thickness_mm: '12',
      conductivity_w_m_k: '0.19',
      version: 'AAT_FOUNDATIONS_WALL_V1.0',
    })).toMatchObject({
      code: 'acrylic',
      label: 'Acrylic',
      thickness_mm: 12,
      thickness_units: 'mm',
      conductivity_units: 'W/m·K',
      basis_version: 'AAT_FOUNDATIONS_WALL_V1.0',
    });

    expect(thermalWallFormValues({
      construction_type: 'frp',
      construction_label: 'FRP',
      effective_layers: [{
        material: 'Project FRP',
        thickness_m: 0.008,
        conductivity_w_m_k: 0.3,
      }],
    })).toEqual({
      wall_material: 'Project FRP',
      wall_thickness_mm: 8,
      wall_conductivity_w_m_k: 0.3,
    });
  });

  it('reads wall evidence through a saved-calculation response wrapper', () => {
    expect(thermalEvidenceBasis({
      saved: {
        input_snapshot: {
          wall_construction_basis: {
            construction_type: 'concrete',
            construction_label: 'Concrete',
            assumption_label: 'Governed concrete basis',
            basis_version: 'WALL-V1',
            effective_layers: [{
              material: 'Reinforced concrete',
              thickness_m: 0.15,
              conductivity_w_m_k: 1.4,
            }],
          },
        },
      },
    }).wall).toMatchObject({
      code: 'concrete',
      label: 'Concrete',
      material: 'Reinforced concrete',
      thickness_mm: 150,
      conductivity_w_m_k: 1.4,
      thickness_units: 'mm',
      conductivity_units: 'W/m·K',
      assumption_label: 'Governed concrete basis',
      basis_version: 'WALL-V1',
    });
  });

  it('keeps reviewed custom U-value evidence distinct from a wall construction', () => {
    const wall = thermalEvidenceBasis({
      calculation: {
        wall_construction_basis: {
          source: 'reviewed custom U-value',
          u_value_w_m2_k: 2.75,
          reviewed: true,
        },
      },
    }).wall;

    expect(wall).toMatchObject({
      label: '',
      material: '',
      thickness_mm: '',
      conductivity_w_m_k: '',
      units: 'W/m²·K',
      reviewed: true,
    });
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
    expect(thermalWallReplacementIsValid({ ...valid, conductivity_w_m_k: -0.1 })).toBe(false);
    expect(thermalWallReplacementIsValid({ ...valid, source_reference: '' })).toBe(false);
  });
});

describe('Exhibit tank wall basis', () => {
  it('calculates material resistance and overall U-value from the tank thickness', () => {
    const basis = thermalExhibitTankWallBasis({
      linked_tanks: [{
        tank_code: 'TK-ACR-01',
        wall_material: 'Acrylic',
        wall_thickness_mm: 12,
      }],
    }, [{
      code: 'acrylic',
      label: 'Acrylic',
      material: 'Acrylic / PMMA',
      thickness_mm: 12,
      conductivity_w_m_k: 0.19,
    }]);

    expect(basis).toMatchObject({
      code: 'acrylic',
      material: 'Acrylic',
      thickness_mm: 12,
      conductivity_w_m_k: 0.19,
      source_basis: 'Linked exhibit tank with governed material conductivity',
    });
    expect(basis.material_resistance_m2_k_w).toBeCloseTo(0.012 / 0.19, 10);
    expect(basis.material_u_value_w_m2_k).toBeCloseTo(0.19 / 0.012, 10);
    expect(basis.u_value_w_m2_k).toBeCloseTo(
      1 / (1 / 150 + 0.012 / 0.19 + 1 / 5),
      10,
    );
  });

  it('keeps distinct mixed tank materials, thicknesses, quantities, and areas', () => {
    const bases = thermalExhibitTankWallBases({
      linked_tanks: [
        {
          tank_id: 'tank-acrylic',
          tank_code: 'TK-ACR',
          quantity: 2,
          exposed_wall_area_m2: 6,
          wall_material: 'Acrylic',
          wall_thickness_mm: 10,
        },
        {
          tank_id: 'tank-concrete',
          tank_code: 'TK-CON',
          quantity: 3,
          exposed_wall_area_m2: 12,
          wall_material: 'Concrete',
          wall_thickness_mm: 200,
        },
      ],
    }, [
      {
        code: 'acrylic',
        label: 'Acrylic',
        material: 'Acrylic / PMMA',
        conductivity_w_m_k: 0.19,
      },
      {
        code: 'concrete',
        label: 'Concrete',
        material: 'Reinforced concrete',
        conductivity_w_m_k: 1.4,
      },
    ]);

    expect(bases).toHaveLength(2);
    expect(thermalWallBasesAreMixed(bases)).toBe(true);
    expect(bases[0]).toMatchObject({
      tank_id: 'tank-acrylic',
      tank_code: 'TK-ACR',
      quantity: 2,
      exposed_wall_area_m2: 6,
      material: 'Acrylic',
      thickness_mm: 10,
      conductivity_w_m_k: 0.19,
    });
    expect(bases[0].u_value_w_m2_k).toBeCloseTo(19, 12);
    expect(bases[1]).toMatchObject({
      tank_id: 'tank-concrete',
      tank_code: 'TK-CON',
      quantity: 3,
      exposed_wall_area_m2: 12,
      material: 'Concrete',
      thickness_mm: 200,
      conductivity_w_m_k: 1.4,
    });
    expect(bases[1].u_value_w_m2_k).toBeCloseTo(7, 12);
  });

  it('normalizes every frozen tank wall basis from saved Thermal evidence', () => {
    const wall = thermalEvidenceBasis({
      wall_construction_basis: {
        source: 'exhibit tank wall with governed material conductivity',
        u_value_w_m2_k: 11,
        tank_bases: [{
          tank_id: 'tank-1',
          material: 'Acrylic',
          thickness_mm: 10,
          conductivity_w_m_k: 0.19,
          u_value_w_m2_k: 19,
        }, {
          tank_id: 'tank-2',
          material: 'Concrete',
          thickness_mm: 200,
          conductivity_w_m_k: 1.4,
          u_value_w_m2_k: 7,
        }],
      },
    }).wall;

    expect(wall.tank_bases).toEqual([
      expect.objectContaining({
        tank_id: 'tank-1',
        thickness_mm: 10,
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
      }),
      expect.objectContaining({
        tank_id: 'tank-2',
        thickness_mm: 200,
        thickness_units: 'mm',
        conductivity_units: 'W/m·K',
      }),
    ]);
    expect(thermalWallBasesAreMixed(wall.tank_bases)).toBe(true);
  });
});

describe('Design Book Thermal numeric fields', () => {
  it('preserves the input element and focus while typing multiple characters', async () => {
    function ThermalFieldHarness() {
      const [value, setValue] = useState('');
      return createElement(ThermalNumericField, {
        name: 'ambient_air_temperature_c',
        label: 'Ambient air temperature',
        unit: '°C',
        value,
        onChange: event => setValue(event.target.value),
      });
    }

    const user = userEvent.setup();
    render(createElement(ThermalFieldHarness));
    const input = screen.getByRole('spinbutton', { name: 'Ambient air temperature' });

    await user.type(input, '123.45');

    expect(screen.getByRole('spinbutton', { name: 'Ambient air temperature' })).toBe(input);
    expect(input).toHaveValue('123.45');
    expect(input).toHaveFocus();
  });
});

describe('Surface-activity guidance', () => {
  it('keeps the guidance collapsed until the details link is clicked', async () => {
    const user = userEvent.setup();
    render(createElement(SurfaceActivityGuidance, {
      selectedAgitationClass: {
        description: 'Typical operating circulation with ordinary surface movement.',
        guidance: 'Choose for normal filtration circulation without sustained aeration.',
      },
    }));

    expect(screen.queryByText('Typical operating circulation with ordinary surface movement.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See more details' }));

    expect(screen.getByText('Typical operating circulation with ordinary surface movement.')).toBeInTheDocument();
    expect(screen.getByText('Choose for normal filtration circulation without sustained aeration.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Effective water temperature', () => {
  function TemperatureHarness() {
    const [override, setOverride] = useState<string | number>('');
    return createElement(WaterTemperatureOverrideControl, {
      average: 25,
      overrideValue: override,
      onOverrideChange: event => setOverride(event.target.value),
    });
  }

  it('allows an override and resets it to the arithmetic average', async () => {
    const user = userEvent.setup();
    render(createElement(TemperatureHarness));

    expect(screen.getByText('Arithmetic average')).toBeInTheDocument();
    expect(screen.getByText('25.0 °C')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Override' }));
    const input = screen.getByRole('spinbutton', { name: 'Reviewed water temperature override' });
    expect(input).toHaveValue(25);

    await user.clear(input);
    await user.type(input, '27');

    expect(input).toHaveValue('27');
    expect(screen.getByText('Reviewed calculation temperature')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText('Arithmetic average')).toBeInTheDocument();
    expect(screen.getByText('25.0 °C')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override' })).toBeInTheDocument();
  });
});

describe('Effective radiant surroundings temperature', () => {
  function RadiantTemperatureHarness() {
    const [override, setOverride] = useState<string | number>('');
    return createElement(EffectiveRadiantSurroundingsTemperature, {
      ambientValue: 20,
      overrideValue: override,
      onOverrideChange: event => setOverride(event.target.value),
    });
  }

  it('keeps the value compact until an override is requested, then supports reset', async () => {
    const user = userEvent.setup();
    render(createElement(RadiantTemperatureHarness));

    expect(screen.getByText(/Effective Radiant Surroundings Temperature:/)).toBeInTheDocument();
    expect(screen.getByText('20.0 °C')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Override' }));
    const input = screen.getByRole('spinbutton', {
      name: 'Effective Radiant Surroundings Temperature override',
    });
    expect(input).toHaveValue(20);

    await user.clear(input);
    await user.type(input, '24');
    expect(input).toHaveValue('24');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText('20.0 °C')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override' })).toBeInTheDocument();
  });
});

describe('Mass-transfer coefficient override', () => {
  function CoefficientHarness() {
    const [value, setValue] = useState<string | number>('0.000001');
    const [overridden, setOverridden] = useState(false);
    return createElement(MassTransferCoefficientControl, {
      value,
      overridden,
      canOverride: true,
      onChange: event => setValue(event.target.value),
      onOverride: () => setOverridden(true),
      onReset: () => {
        setValue('0.000001');
        setOverridden(false);
      },
    });
  }

  it('keeps the approved coefficient locked until Override and restores it on Reset', async () => {
    const user = userEvent.setup();
    render(createElement(CoefficientHarness));
    const input = screen.getByRole('spinbutton', { name: 'Mass-transfer coefficient' });

    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Override mass-transfer coefficient' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Override mass-transfer coefficient' }));
    expect(input).toBeEnabled();

    await user.clear(input);
    await user.type(input, '0.000002');
    expect(input).toHaveValue('0.000002');
    expect(screen.getByText(/Mass-transfer coefficient.*Override/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset mass-transfer coefficient override' }));

    expect(input).toBeDisabled();
    expect(input).toHaveValue(0.000001);
    expect(screen.getByRole('button', { name: 'Override mass-transfer coefficient' })).toBeInTheDocument();
  });
});

describe('Wall U-value override', () => {
  function WallUValueHarness() {
    const [override, setOverride] = useState<string | number>('');
    const governedValue = 3.7061118335500645;
    return createElement(WallUValueControl, {
      governedValue,
      overrideValue: override,
      canOverride: true,
      info: 'Acrylic / PMMA thickness: 12.00 mm',
      onChange: event => setOverride(event.target.value),
      onOverride: () => setOverride(governedValue),
      onReset: () => setOverride(''),
    });
  }

  it('shows the governed value and acrylic thickness until a reviewed override is requested', async () => {
    const user = userEvent.setup();
    render(createElement(WallUValueHarness));
    const input = screen.getByRole('spinbutton', { name: 'Wall U-value' });

    expect(input).toBeDisabled();
    expect(input).toHaveValue(3.7061118335500645);
    expect(screen.getByText('Acrylic / PMMA thickness: 12.00 mm')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Override wall U-value' }));
    expect(input).toBeEnabled();

    await user.clear(input);
    await user.type(input, '2.75');
    expect(input).toHaveValue('2.75');

    await user.click(screen.getByRole('button', { name: 'Reset wall U-value override' }));

    expect(input).toBeDisabled();
    expect(input).toHaveValue(3.7061118335500645);
    expect(screen.getByRole('button', { name: 'Override wall U-value' })).toBeInTheDocument();
  });
});

describe('Design Book Thermal calculation action', () => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrastRatio = (foreground: string, background: string) => {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  };

  it('keeps governed Thermal actions readable across normal, hover, loading, and disabled states', () => {
    render(
      createElement(
        'div',
        null,
        createElement(Button, {
          variant: 'thermal',
          children: 'Approve version',
        }),
        createElement(Button, {
          variant: 'thermal',
          disabled: true,
          children: 'Approving…',
        }),
      ),
    );

    const normalButton = screen.getByRole('button', { name: 'Approve version' });
    expect(normalButton).toHaveClass(
      'bg-[#9d5637]',
      'text-white',
      'hover:bg-[#7d442f]',
      'border-[#7d442f]',
      'focus-visible:ring-[#b86843]',
    );
    expect(contrastRatio(THERMAL_BUTTON_COLORS.foreground, THERMAL_BUTTON_COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(THERMAL_BUTTON_COLORS.foreground, THERMAL_BUTTON_COLORS.hoverBackground)).toBeGreaterThanOrEqual(4.5);

    const loadingButton = screen.getByRole('button', { name: 'Approving…' });
    expect(loadingButton).toHaveClass(
      'bg-[#9d5637]',
      'text-white',
      'hover:bg-[#7d442f]',
      'disabled:bg-[#f3efe8]',
      'disabled:text-[#5c4439]',
      'disabled:hover:bg-[#f3efe8]',
      'disabled:hover:text-[#5c4439]',
      'disabled:opacity-100',
      'focus-visible:ring-[#b86843]',
    );
    expect(contrastRatio(THERMAL_BUTTON_COLORS.disabledForeground, THERMAL_BUTTON_COLORS.disabledBackground)).toBeGreaterThanOrEqual(4.5);
    expect(loadingButton).toBeDisabled();
  });
});
