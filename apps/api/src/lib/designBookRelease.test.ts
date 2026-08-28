import { describe, expect, it } from 'vitest';
import { AQUARIUM_CALCULATION_VERSION } from './aquariumCalculations';
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
      exhibits: [{ status: 'valid', inputs: { exhibit_id: 'exhibit-1' } }],
      systems: [{ status: 'valid', inputs: { system_id: 'system-1' } }],
    },
  };
}

describe('Design Book release policy', () => {
  it('allows a complete engineering package to proceed without blockers', () => {
    const checklist = buildDesignBookReleaseChecklist(readyContext());
    expect(releaseBlockers(checklist)).toEqual([]);
    expect(checklist.every(check => check.status === 'pass')).toBe(true);
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