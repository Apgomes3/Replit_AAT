"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const aquariumCalculations_1 = require("./aquariumCalculations");
const pumpSelections_1 = require("./pumpSelections");
const designBookRelease_1 = require("./designBookRelease");
function readyContext() {
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
                calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            }],
        systems: [{
                id: 'system-1',
                water_type: 'Freshwater',
                system_config: 'bespoke',
                system_type: 'Life Support',
                status: 'Design',
                design_flow_m3h: 120,
                calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
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
                calculation: { status: 'Ready' },
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
                        calculation_version: pumpSelections_1.PUMP_SELECTION_CALCULATION_VERSION,
                    }],
            }],
    };
}
(0, vitest_1.describe)('Design Book release policy', () => {
    (0, vitest_1.it)('allows a complete engineering package to proceed without blockers', () => {
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(readyContext());
        (0, vitest_1.expect)((0, designBookRelease_1.releaseBlockers)(checklist)).toEqual([]);
        (0, vitest_1.expect)(checklist.every(check => check.status === 'pass')).toBe(true);
    });
    (0, vitest_1.it)('blocks release when a pump duty exceeds the supported motor series', () => {
        const context = readyContext();
        const selection = context.pump_selections[0].items[0];
        selection.status = 'incomplete';
        selection.results = {
            motor_input_kw: 340,
            recommended_motor_kw: null,
        };
        selection.reasons = [
            'Calculated motor input 340 kW exceeds the largest configured standard motor size of 315 kW.',
        ];
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context);
        (0, vitest_1.expect)(checklist.find(check => check.key === 'pump_selections')).toMatchObject({
            status: 'blocked',
            severity: 'blocker',
        });
        (0, vitest_1.expect)((0, designBookRelease_1.releaseBlockers)(checklist).map(check => check.key)).toContain('pump_selections');
    });
    (0, vitest_1.it)('accepts a valid linked-exhibit design flow without a stored legacy flow value', () => {
        const context = readyContext();
        context.systems[0].design_flow_m3h = null;
        context.systems[0].calculation_inputs = {
            design_flow_source: 'linked_exhibits',
            turnover_source: 'primary_exhibit',
        };
        context.engineering_calculations.systems = [{
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
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context);
        (0, vitest_1.expect)(checklist.find(check => check.key === 'lss_configuration')?.status).toBe('pass');
        (0, vitest_1.expect)((0, designBookRelease_1.releaseBlockers)(checklist)).toEqual([]);
    });
    (0, vitest_1.it)('blocks release when required metadata and engineering records are incomplete', () => {
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)({
            id: 'book-1',
            project_scopes: ['Aquarium', 'LSS'],
        });
        const blockerKeys = (0, designBookRelease_1.releaseBlockers)(checklist).map(check => check.key);
        (0, vitest_1.expect)(blockerKeys).toEqual(vitest_1.expect.arrayContaining([
            'metadata', 'scope', 'exhibits', 'tanks', 'hydraulics', 'lss_configuration', 'flow_route',
        ]));
    });
    (0, vitest_1.it)('classifies species and unassigned tank findings as warnings, not blockers', () => {
        const context = readyContext();
        context.species = [];
        context.tanks.push({ id: 'tank-2', exhibit_id: null });
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context);
        (0, vitest_1.expect)(checklist.find(check => check.key === 'species')?.status).toBe('warning');
        (0, vitest_1.expect)(checklist.find(check => check.key === 'unassigned_tanks')?.status).toBe('warning');
        (0, vitest_1.expect)((0, designBookRelease_1.releaseBlockers)(checklist)).toEqual([]);
    });
    (0, vitest_1.it)('blocks stale and unresolved calculations', () => {
        const context = readyContext();
        context.hydraulics[0].calculation_version = 'legacy';
        context.engineering_calculations.exhibits = [{
                status: 'invalid',
                is_stale: true,
                reasons: ['Target turnover is missing.'],
                inputs: { exhibit_id: 'exhibit-1' },
            }];
        const blockerKeys = (0, designBookRelease_1.releaseBlockers)((0, designBookRelease_1.buildDesignBookReleaseChecklist)(context)).map(check => check.key);
        (0, vitest_1.expect)(blockerKeys).toEqual(vitest_1.expect.arrayContaining(['calculations', 'calculation_freshness']));
    });
    (0, vitest_1.it)('blocks release when a thermal result is stale or not Ready', () => {
        const context = readyContext();
        context.thermal_calculations[0].freshness = 'stale';
        context.thermal_calculations[0].status = 'Stale';
        const thermal = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context)
            .find(check => check.key === 'thermal_calculations');
        (0, vitest_1.expect)(thermal?.status).toBe('blocked');
        (0, vitest_1.expect)(thermal?.href).toBe('/design-books/book-1?tab=thermal');
    });
    (0, vitest_1.it)('does not require a thermal calculation for Utility systems', () => {
        const context = readyContext();
        context.systems.push({
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
        context.engineering_calculations.systems.push({
            status: 'valid',
            inputs: { system_id: 'utility-1' },
        });
        const thermal = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context)
            .find(check => check.key === 'thermal_calculations');
        (0, vitest_1.expect)(thermal?.status).toBe('pass');
        (0, vitest_1.expect)(thermal?.affected_ids).toBeUndefined();
    });
    (0, vitest_1.it)('blocks an invalid LSS system calculation', () => {
        const context = readyContext();
        context.engineering_calculations.systems = [{
                status: 'invalid',
                reasons: ['Linked flow allocation does not reconcile.'],
                inputs: { system_id: 'system-1' },
            }];
        const calculations = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context).find(check => check.key === 'calculations');
        (0, vitest_1.expect)(calculations?.status).toBe('blocked');
        (0, vitest_1.expect)(calculations?.affected_ids).toContain('system-1');
    });
    (0, vitest_1.it)('warns separately about nullable loop and linked Bio/Degas percentages', () => {
        const context = readyContext();
        context.systems[0] = {
            ...context.systems[0],
            loop1_flow_pct: null,
            loop1_bio_degas_pct: null,
            loop1_link_bio_degas: true,
        };
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context);
        const loopWarning = checklist.find(check => check.key === 'flow_route_allocations');
        const branchWarning = checklist.find(check => check.key === 'bio_degas_allocations');
        (0, vitest_1.expect)(loopWarning?.status).toBe('warning');
        (0, vitest_1.expect)(loopWarning?.message).toMatch(/Loop 1/);
        (0, vitest_1.expect)(loopWarning?.message).toMatch(/Blank means unreviewed/);
        (0, vitest_1.expect)(branchWarning?.status).toBe('warning');
        (0, vitest_1.expect)(branchWarning?.message).toMatch(/Bio\/Degas/);
        (0, vitest_1.expect)(branchWarning?.message).toMatch(/Blank means unreviewed/);
        (0, vitest_1.expect)((0, designBookRelease_1.releaseBlockers)(checklist).map(check => check.key)).not.toContain('flow_route_allocations');
        (0, vitest_1.expect)((0, designBookRelease_1.releaseBlockers)(checklist).map(check => check.key)).not.toContain('bio_degas_allocations');
    });
    (0, vitest_1.it)('treats reviewed zero allocations as intentional rather than unreviewed', () => {
        const context = readyContext();
        context.systems[0] = {
            ...context.systems[0],
            loop1_flow_pct: 0,
            loop1_bio_degas_pct: 0,
            loop1_link_bio_degas: true,
        };
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context);
        (0, vitest_1.expect)(checklist.find(check => check.key === 'flow_route_allocations')).toMatchObject({
            status: 'pass',
        });
        (0, vitest_1.expect)(checklist.find(check => check.key === 'bio_degas_allocations')).toMatchObject({
            status: 'pass',
        });
        (0, vitest_1.expect)(checklist.find(check => check.key === 'flow_route_allocations')?.message).toMatch(/0%/);
        (0, vitest_1.expect)(checklist.find(check => check.key === 'bio_degas_allocations')?.message).toMatch(/intentional/);
    });
    (0, vitest_1.it)('blocks release until every Biological Media case has a current approved run', () => {
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
        (0, vitest_1.expect)((0, designBookRelease_1.buildDesignBookReleaseChecklist)(context).find(check => check.key === 'biological_media_runs')).toMatchObject({
            status: 'blocked',
            affected_ids: ['system-1'],
        });
        context.biological_media_runs[0].status = 'Approved';
        (0, vitest_1.expect)((0, designBookRelease_1.buildDesignBookReleaseChecklist)(context).find(check => check.key === 'biological_media_runs')?.status).toBe('pass');
        context.biological_media_cases[0].preview_stale = true;
        (0, vitest_1.expect)((0, designBookRelease_1.buildDesignBookReleaseChecklist)(context).find(check => check.key === 'biological_media_runs')?.status).toBe('blocked');
        context.biological_media_cases[0].preview_stale = false;
        context.engineering_calculations.exhibits[0].results.operating_volume_m3 = 43;
        (0, vitest_1.expect)((0, designBookRelease_1.buildDesignBookReleaseChecklist)(context).find(check => check.key === 'biological_media_runs')?.status).toBe('blocked');
    });
    (0, vitest_1.it)('never allows release while any blocker remains', () => {
        (0, vitest_1.expect)((0, designBookRelease_1.validateReleaseBlockers)(2)?.code).toBe('RELEASE_BLOCKED');
        (0, vitest_1.expect)((0, designBookRelease_1.validateReleaseBlockers)(0)).toBeNull();
    });
    (0, vitest_1.it)('rejects revision mismatches and scope outside the linked project', () => {
        (0, vitest_1.expect)((0, designBookRelease_1.validateReleaseConfirmation)({
            currentRevision: 'B',
            confirmedRevision: 'A',
            includedScope: ['LSS'],
            projectScope: ['LSS'],
            releaseNotes: 'Release package',
        })?.code).toBe('REVISION_MISMATCH');
        (0, vitest_1.expect)((0, designBookRelease_1.validateReleaseConfirmation)({
            currentRevision: 'B',
            confirmedRevision: 'B',
            includedScope: ['Construction'],
            projectScope: ['LSS'],
            releaseNotes: 'Release package',
        })?.code).toBe('INVALID_RELEASE_SCOPE');
    });
});
