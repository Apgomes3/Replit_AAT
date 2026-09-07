import { describe, expect, it } from 'vitest';
import { AQUARIUM_CALCULATION_VERSION } from './aquariumCalculations';
import { PUMP_SELECTION_CALCULATION_VERSION } from './pumpSelections';
import { FRICTION_LOSS_CALCULATION_VERSION } from './frictionLossCalculations';
import {
  buildDesignBookReleaseChecklist,
  releaseBlockers,
  validateReleaseConfirmation,
  validateReleaseBlockers,
  type DesignBookReleaseContext,
} from './designBookRelease';

function readyContext(): DesignBookReleaseContext {
  return {
    id: 'book-1',
    book_code: 'DB-001',
    book_title: 'Aquarium Engineering',
    revision: 'A',
    project_id: 'project-1',
    project_scopes: ['Aquarium', 'LSS'],
    exhibits: [{ id: 'exhibit-1' }],
    tanks: [{ id: 'tank-1', exhibit_id: 'exhibit-1' }],
    species: [{ id: 'species-1', exhibit_id: 'exhibit-1' }],
    hydraulics: [{
      exhibit_id: 'exhibit-1',
      calculation_version: AQUARIUM_CALCULATION_VERSION,
    }],
    systems: [{
      id: 'system-1',
      water_type: 'Freshwater',
      system_config: 'bespoke',
      system_type: 'Life Support',
      status: 'Design',
      design_flow_m3h: 120,
      calculation_version: AQUARIUM_CALCULATION_VERSION,
      loop1_flow_source: 'Exhibit return',
      loop1_filtration: 'Mechanical and biological',
      loop1_flow_pct: 100,
      loop1_bio_degas_pct: 100,
      loop1_bio_degas_m3h: 120,
    }],
    engineering_calculations: {
      exhibits: [{ status: 'valid', inputs: { exhibit_id: 'exhibit-1' }, results: { operating_volume_m3: 42.125 } }],
      systems: [{ status: 'valid', inputs: { system_id: 'system-1' } }],
    },
    thermal_calculations: [{
      system_id: 'system-1',
      status: 'Ready',
      freshness: 'fresh',
      calculation: {
        status: 'Ready',
        correlation_snapshot: {
          source: 'shared_library',
          correlation_id: 'correlation-1',
          agitation_class: 'Moderate',
          version: '2026.1',
          coefficient_kg_m2_s_kpa: 0.000001,
          effective_coefficient_kg_m2_s_kpa: 0.000001,
          approved: true,
          deviation: false,
        },
      },
    }],
    pump_selections: [{
      system_id: 'system-1',
      items: [{
        circuit_key: 'loop:1',
        project_equipment_item_id: 'pump-item-1',
        selected_pump: {
          id: 'pump-item-1',
          project_equipment_item_id: 'pump-item-1',
          product_code: 'PUMP-101',
          product_name: 'Duty Pump',
        },
        status: 'ready',
        freshness: 'fresh',
        calculation_version: PUMP_SELECTION_CALCULATION_VERSION,
      }],
    }],
  };
}

describe('Design Book release policy', () => {
  it('allows a complete engineering package to proceed without blockers', () => {
    const checklist = buildDesignBookReleaseChecklist(readyContext());
    expect(releaseBlockers(checklist)).toEqual([]);
    expect(checklist.every(check => check.status === 'pass')).toBe(true);
  });

  it('blocks release when active mandatory and pump-linked instrument definitions are under-counted', () => {
    const context = readyContext();
    context.pump_selections![0].items[0].pump_quantity = 2;
    context.lss_controls = [{
      system_id: 'system-1',
      definitions: [
        { id: 'mandatory-definition', name: 'High level switch', requirement_rule: 'mandatory' },
        { id: 'pump-definition', name: 'Flow switch', requirement_rule: 'pump_linked' },
      ],
      instruments: [{ definition_id: 'pump-definition' }],
    }];

    const check = buildDesignBookReleaseChecklist(context)
      .find(item => item.key === 'lss_field_instruments');

    expect(check).toMatchObject({
      status: 'blocked',
      affected_ids: ['system-1'],
    });
    expect(check?.message).toContain('High level switch');
    expect(check?.message).toContain('Flow switch');
  });

  it('blocks required instrument evidence with blank logic and links directly to its control tab', () => {
    const context = readyContext();
    context.lss_controls = [{
      system_id: 'system-1',
      definitions: [{ id: 'flow-switch', name: 'Flow switch', requirement_rule: 'pump_linked' }],
      instruments: [{ definition_id: 'flow-switch', control_logic: '  ' }],
    }];

    const check = buildDesignBookReleaseChecklist(context)
      .find(item => item.key === 'lss_field_instruments');

    expect(check).toMatchObject({
      status: 'blocked',
      href: '/design-books/book-1?tab=control&system=system-1',
      affected_ids: ['system-1'],
    });
    expect(check?.message).toContain('blank control logic');
  });

  it('blocks blank logic on retained required evidence from a now-inactive definition snapshot', () => {
    const context = readyContext();
    context.lss_controls = [{
      system_id: 'system-1',
      definitions: [],
      instruments: [{
        definition_id: 'retired-flow-switch',
        control_logic: null,
        definition_snapshot: { id: 'retired-flow-switch', name: 'Retired flow switch', requirement_rule: 'pump_linked' },
      }],
    }];

    expect(buildDesignBookReleaseChecklist(context)
      .find(item => item.key === 'lss_field_instruments')).toMatchObject({ status: 'blocked' });
  });

  it('blocks a current release package that includes a retired LSS', () => {
    const context = readyContext();
    context.systems![0].status = 'Superseded';

    const lifecycle = buildDesignBookReleaseChecklist(context)
      .find(check => check.key === 'lss_lifecycle');

    expect(lifecycle).toMatchObject({
      status: 'blocked',
      severity: 'blocker',
      affected_ids: ['system-1'],
    });
    expect(releaseBlockers(buildDesignBookReleaseChecklist(context)).map(check => check.key))
      .toContain('lss_lifecycle');
  });

  it('recognizes established LSS type names in engineering release checks', () => {
    const context = readyContext();
    context.systems![0].system_type = 'Single Exhibit LSS';

    const checklist = buildDesignBookReleaseChecklist(context);

    expect(checklist.find(check => check.key === 'thermal_calculations')?.status).toBe('pass');
    expect(checklist.find(check => check.key === 'pump_selections')?.status).toBe('pass');
  });

  it('blocks friction evidence captured against a different circuit pump', () => {
    const context = readyContext();
    context.friction_loss_calculations = [{
      system_id: 'system-1',
      items: [{
        circuit_key: 'loop:1',
        project_equipment_item_id: 'pump-item-2',
        selected_pump: { id: 'pump-item-2', project_equipment_item_id: 'pump-item-2' },
        freshness: 'fresh',
        status: 'ready',
        calculation_version: FRICTION_LOSS_CALCULATION_VERSION,
        result: { results: { combined_head_loss_m: 3.2 } },
      }],
    }];

    const friction = buildDesignBookReleaseChecklist(context)
      .find(check => check.key === 'friction_loss_calculations');

    expect(friction?.status).toBe('blocked');
    expect(friction?.message).toContain('does not use the current Flow Route pump selection');
  });

  it('blocks release when a pump duty exceeds the supported motor series', () => {
    const context = readyContext();
    const selection = context.pump_selections![0].items[0];
    selection.status = 'incomplete';
    selection.results = {
      motor_input_kw: 340,
      recommended_motor_kw: null,
    };
    selection.reasons = [
      'Calculated motor input 340 kW exceeds the largest configured standard motor size of 315 kW.',
    ];

    const checklist = buildDesignBookReleaseChecklist(context);
    expect(checklist.find(check => check.key === 'pump_selections')).toMatchObject({
      status: 'blocked',
      severity: 'blocker',
    });
    expect(releaseBlockers(checklist).map(check => check.key)).toContain('pump_selections');
  });

  it('accepts a valid linked-exhibit design flow without a stored legacy flow value', () => {
    const context = readyContext();
    context.systems![0].design_flow_m3h = null;
    context.systems![0].calculation_inputs = {
      design_flow_source: 'linked_exhibits',
      turnover_source: 'primary_exhibit',
    };
    context.engineering_calculations!.systems = [{
      status: 'valid',
      freshness: 'fresh',
      inputs: {
        system_id: 'system-1',
        design_flow_source: 'linked_exhibits',
        turnover_source: 'primary_exhibit',
      },
      results: {
        calculated_required_flow_m3h: 120,
        design_flow_m3h: 120,
        turnover_rate_cycles_per_hour: 4,
      },
    }];

    const checklist = buildDesignBookReleaseChecklist(context);

    expect(checklist.find(check => check.key === 'lss_configuration')?.status).toBe('pass');
    expect(releaseBlockers(checklist)).toEqual([]);
  });

  it('blocks release when required metadata and engineering records are incomplete', () => {
    const checklist = buildDesignBookReleaseChecklist({
      id: 'book-1',
      project_scopes: ['Aquarium', 'LSS'],
    });
    const blockerKeys = releaseBlockers(checklist).map(check => check.key);
    expect(blockerKeys).toEqual(expect.arrayContaining([
      'metadata', 'scope', 'exhibits', 'tanks', 'hydraulics', 'lss_configuration', 'flow_route',
    ]));
  });

  it('classifies species and unassigned tank findings as warnings, not blockers', () => {
    const context = readyContext();
    context.species = [];
    context.tanks!.push({ id: 'tank-2', exhibit_id: null });
    const checklist = buildDesignBookReleaseChecklist(context);
    expect(checklist.find(check => check.key === 'species')?.status).toBe('warning');
    expect(checklist.find(check => check.key === 'unassigned_tanks')?.status).toBe('warning');
    expect(releaseBlockers(checklist)).toEqual([]);
  });

  it('blocks stale and unresolved calculations', () => {
    const context = readyContext();
    context.hydraulics![0].calculation_version = 'legacy';
    context.engineering_calculations!.exhibits = [{
      status: 'invalid',
      is_stale: true,
      reasons: ['Target turnover is missing.'],
      inputs: { exhibit_id: 'exhibit-1' },
    }];
    const blockerKeys = releaseBlockers(buildDesignBookReleaseChecklist(context)).map(check => check.key);
    expect(blockerKeys).toEqual(expect.arrayContaining(['calculations', 'calculation_freshness']));
  });

  it('blocks release when a thermal result is stale or not Ready', () => {
    const context = readyContext();
    context.thermal_calculations![0].freshness = 'stale';
    context.thermal_calculations![0].status = 'Stale';
    const thermal = buildDesignBookReleaseChecklist(context)
      .find(check => check.key === 'thermal_calculations');
    expect(thermal?.status).toBe('blocked');
    expect(thermal?.href).toBe('/design-books/book-1?tab=thermal');
  });

  it('blocks release when thermal approval evidence is not an authoritative library snapshot', () => {
    const context = readyContext();
    context.thermal_calculations![0].calculation.correlation_snapshot = {
      source: 'legacy_manual',
      agitation_class: 'Moderate',
      version: 'typed-by-user',
      coefficient_kg_m2_s_kpa: 0.000001,
      effective_coefficient_kg_m2_s_kpa: 0.000001,
      approved: true,
      deviation: false,
    };
    const thermal = buildDesignBookReleaseChecklist(context)
      .find(check => check.key === 'thermal_calculations');
    expect(thermal?.status).toBe('blocked');
    expect(thermal?.affected_ids).toEqual(['system-1']);
  });

  it('does not require a thermal calculation for Utility systems', () => {
    const context = readyContext();
    context.systems!.push({
      id: 'utility-1',
      system_code: 'CHW-01',
      system_type: 'Utility',
      system_config: 'Chilled Water',
      status: 'Design',
      design_flow_m3h: 50,
      loop1_flow_source: 'Plant',
      loop1_filtration: 'None',
      loop1_flow_pct: 100,
    });
    context.engineering_calculations!.systems!.push({
      status: 'valid',
      inputs: { system_id: 'utility-1' },
    });
    const thermal = buildDesignBookReleaseChecklist(context)
      .find(check => check.key === 'thermal_calculations');
    expect(thermal?.status).toBe('pass');
    expect(thermal?.affected_ids).toBeUndefined();
  });

  it('blocks an invalid LSS system calculation', () => {
    const context = readyContext();
    context.engineering_calculations!.systems = [{
      status: 'invalid',
      reasons: ['Linked flow allocation does not reconcile.'],
      inputs: { system_id: 'system-1' },
    }];
    const calculations = buildDesignBookReleaseChecklist(context).find(check => check.key === 'calculations');
    expect(calculations?.status).toBe('blocked');
    expect(calculations?.affected_ids).toContain('system-1');
  });

  it('warns separately about nullable loop and linked Bio/Degas percentages', () => {
    const context = readyContext();
    context.systems![0] = {
      ...context.systems![0],
      loop1_flow_pct: null,
      loop1_bio_degas_pct: null,
      loop1_link_bio_degas: true,
    };

    const checklist = buildDesignBookReleaseChecklist(context);
    const loopWarning = checklist.find(check => check.key === 'flow_route_allocations');
    const branchWarning = checklist.find(check => check.key === 'bio_degas_allocations');

    expect(loopWarning?.status).toBe('warning');
    expect(loopWarning?.message).toMatch(/Loop 1/);
    expect(loopWarning?.message).toMatch(/Blank means unreviewed/);
    expect(branchWarning?.status).toBe('warning');
    expect(branchWarning?.message).toMatch(/Bio\/Degas/);
    expect(branchWarning?.message).toMatch(/Blank means unreviewed/);
    expect(releaseBlockers(checklist).map(check => check.key)).not.toContain('flow_route_allocations');
    expect(releaseBlockers(checklist).map(check => check.key)).not.toContain('bio_degas_allocations');
  });

  it('treats reviewed zero allocations as intentional rather than unreviewed', () => {
    const context = readyContext();
    context.systems![0] = {
      ...context.systems![0],
      loop1_flow_pct: 0,
      loop1_bio_degas_pct: 0,
      loop1_link_bio_degas: true,
    };

    const checklist = buildDesignBookReleaseChecklist(context);

    expect(checklist.find(check => check.key === 'flow_route_allocations')).toMatchObject({
      status: 'pass',
    });
    expect(checklist.find(check => check.key === 'bio_degas_allocations')).toMatchObject({
      status: 'pass',
    });
    expect(checklist.find(check => check.key === 'flow_route_allocations')?.message).toMatch(/0%/);
    expect(checklist.find(check => check.key === 'bio_degas_allocations')?.message).toMatch(/intentional/);
  });

  it('does not warn that a valid matched circulation loop lacks an allocation percentage', () => {
    const context = readyContext();
    context.systems![0] = {
      ...context.systems![0],
      loop2_flow_source: 'Break Tank',
      loop2_filtration: 'Pressurized Bag Filter',
      loop2_flow_mode: 'matched',
      loop2_match_loop_number: 1,
      loop2_flow_pct: null,
    };

    const checklist = buildDesignBookReleaseChecklist(context);
    expect(checklist.find(check => check.key === 'flow_route')?.status).toBe('pass');
    expect(checklist.find(check => check.key === 'flow_route_allocations')?.status).toBe('pass');
  });

  it('blocks release when a matched circulation target is missing', () => {
    const context = readyContext();
    context.systems![0] = {
      ...context.systems![0],
      loop2_flow_source: 'Plenum Tank',
      loop2_filtration: 'Pressurized Bag Filter',
      loop2_flow_mode: 'matched',
      loop2_match_loop_number: 3,
    };

    const flowRoute = buildDesignBookReleaseChecklist(context)
      .find(check => check.key === 'flow_route');
    expect(flowRoute).toMatchObject({ status: 'blocked', severity: 'blocker' });
  });

  it('blocks release when persisted matched flow uses a non-circulation source', () => {
    const context = readyContext();
    context.systems![0] = {
      ...context.systems![0],
      loop2_flow_source: 'Exhibit return',
      loop2_filtration: 'Pressurized Bag Filter',
      loop2_flow_mode: 'matched',
      loop2_match_loop_number: 1,
    };

    const flowRoute = buildDesignBookReleaseChecklist(context)
      .find(check => check.key === 'flow_route');
    expect(flowRoute).toMatchObject({ status: 'blocked', severity: 'blocker' });
  });

  it('blocks release until every Biological Media case has a current approved run', () => {
    const context = readyContext();
    context.system_links = [{ system_id: 'system-1', exhibit_id: 'exhibit-1' }];
    const inputSnapshot = { biomass: { water_volume_m3: 42.125 }, water: { water_type: 'FRESHWATER' } };
    context.biological_media_cases = [{
      id: 'case-1',
      system_id: 'system-1',
      preview_stale: false,
      preview_input_snapshot: inputSnapshot,
    }];
    context.biological_media_runs = [{
      id: 'run-1',
      case_id: 'case-1',
      run_number: 1,
      status: 'Pending Review',
      normalized_input_snapshot: inputSnapshot,
      linked_volume_context_snapshot: {
        total_operating_volume_m3: 42.125,
        system_water_type: 'Freshwater',
      },
      overrides_snapshot: [],
    }];

    expect(buildDesignBookReleaseChecklist(context).find(check => check.key === 'biological_media_runs')).toMatchObject({
      status: 'blocked',
      affected_ids: ['system-1'],
    });

    context.biological_media_runs[0].status = 'Approved';
    expect(buildDesignBookReleaseChecklist(context).find(check => check.key === 'biological_media_runs')?.status).toBe('pass');

    context.biological_media_cases[0].preview_stale = true;
    expect(buildDesignBookReleaseChecklist(context).find(check => check.key === 'biological_media_runs')?.status).toBe('blocked');

    context.biological_media_cases[0].preview_stale = false;
    context.engineering_calculations!.exhibits![0].results.operating_volume_m3 = 43;
    expect(buildDesignBookReleaseChecklist(context).find(check => check.key === 'biological_media_runs')?.status).toBe('blocked');
  });

  it('never allows release while any blocker remains', () => {
    expect(validateReleaseBlockers(2)?.code).toBe('RELEASE_BLOCKED');
    expect(validateReleaseBlockers(0)).toBeNull();
  });

  it('rejects revision mismatches and scope outside the linked project', () => {
    expect(validateReleaseConfirmation({
      currentRevision: 'B',
      confirmedRevision: 'A',
      includedScope: ['LSS'],
      projectScope: ['LSS'],
      releaseNotes: 'Release package',
    })?.code).toBe('REVISION_MISMATCH');
    expect(validateReleaseConfirmation({
      currentRevision: 'B',
      confirmedRevision: 'B',
      includedScope: ['Construction'],
      projectScope: ['LSS'],
      releaseNotes: 'Release package',
    })?.code).toBe('INVALID_RELEASE_SCOPE');
  });
});