"use strict";
// @vitest-environment node
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const biologicalMedia_1 = require("./biologicalMedia");
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
(0, vitest_1.describe)('Biological Media controlled profile validation', () => {
    (0, vitest_1.it)('accepts a complete media revision for approval', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.validateMediaProfile)(completeMediaProfile, true)).toEqual([]);
    });
    (0, vitest_1.it)('allows media evidence to remain incomplete while a revision is a draft', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.validateMediaProfile)({
            ...completeMediaProfile,
            evidence_reference: '',
            status: 'Draft',
        }, false)).toEqual([]);
        (0, vitest_1.expect)((0, biologicalMedia_1.validateMediaProfile)({
            ...completeMediaProfile,
            evidence_reference: '',
            status: 'Approved',
        }, true)).toContain('Evidence reference is required.');
    });
    (0, vitest_1.it)('rejects contradictory and incomplete media revisions before approval', () => {
        const errors = (0, biologicalMedia_1.validateMediaProfile)({
            ...completeMediaProfile,
            operating_min_temperature_c: 30,
            operating_max_temperature_c: 20,
            media_void_fraction: 1.2,
            evidence_reference: '',
        }, true);
        (0, vitest_1.expect)(errors).toContain('Operating temperature minimum cannot exceed maximum.');
        (0, vitest_1.expect)(errors).toContain('Media void fraction must be between 0 and 1.');
        (0, vitest_1.expect)(errors).toContain('Evidence reference is required.');
    });
    (0, vitest_1.it)('requires explicit labeling for provisional engineering data', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.validateMediaProfile)({
            ...completeMediaProfile,
            is_provisional: true,
            provisional_label: '',
        }, true)).toContain('Provisional profiles require an explicit provisional label.');
    });
    (0, vitest_1.it)('rejects invalid TAN coefficients and ranges', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.validateTanProfile)({
            profile_code: 'TAN-01',
            profile_name: 'Global feeding TAN',
            coefficient: 0,
            coefficient_unit: 'g TAN/kg feed',
            scope_type: 'Global feeding',
            scope_min: 10,
            scope_max: 5,
            evidence_reference: '',
        })).toEqual(vitest_1.expect.arrayContaining([
            'Coefficient must be greater than zero.',
            'Scope range minimum cannot exceed maximum.',
            'Evidence reference is required.',
        ]));
    });
    (0, vitest_1.it)('allows incomplete evidence on a draft but requires it for approval', () => {
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
        (0, vitest_1.expect)((0, biologicalMedia_1.validateTanProfile)(draft, false)).toEqual([]);
        (0, vitest_1.expect)((0, biologicalMedia_1.validateTanProfile)({ ...draft, status: 'Approved' }, true)).toContain('Evidence reference is required.');
    });
    (0, vitest_1.it)('requires the confirmed TAN coefficient unit', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.validateTanProfile)({
            profile_code: 'TAN-03',
            profile_name: 'Wrong unit',
            coefficient: 0.08,
            coefficient_unit: 'g TAN/kg feed',
            scope_type: 'Global feeding',
            evidence_reference: 'CONTROLLED-REF',
        })).toContain('Coefficient unit must be kg TAN-N/kg feed protein.');
    });
});
(0, vitest_1.describe)('Biological Media preview freshness', () => {
    const record = {
        preview_result: { status: 'VALID' },
        preview_stale: false,
        preview_input_snapshot: {
            biomass: { water_volume_m3: 42.125 },
            water: { water_type: 'FRESHWATER' },
        },
    };
    (0, vitest_1.it)('keeps a preview current only while authoritative linked context matches', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.isBiologicalMediaPreviewStale)(record, {
            total_operating_volume_m3: 42.125,
            system_water_type: 'Freshwater',
        })).toBe(false);
    });
    (0, vitest_1.it)('marks upstream linked-volume and water-type changes stale', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.isBiologicalMediaPreviewStale)(record, {
            total_operating_volume_m3: 43,
            system_water_type: 'Freshwater',
        })).toBe(true);
        (0, vitest_1.expect)((0, biologicalMedia_1.isBiologicalMediaPreviewStale)(record, {
            total_operating_volume_m3: 42.125,
            system_water_type: 'Marine',
        })).toBe(true);
    });
});
(0, vitest_1.describe)('Biological Media immutable run presentation', () => {
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
    (0, vitest_1.it)('exports only frozen profile evidence, results, warnings, engine, and approval metadata', () => {
        const summary = (0, biologicalMedia_1.renderBiologicalMediaRunSummary)(run);
        (0, vitest_1.expect)(summary).toContain('MEDIA-01 r4');
        (0, vitest_1.expect)(summary).toContain('MEDIA-EVIDENCE-R4');
        (0, vitest_1.expect)(summary).toContain('BIOFILTER_1_0');
        (0, vitest_1.expect)(summary).toContain('Installed media: 1200 L');
        (0, vitest_1.expect)(summary).toContain('WARNING MEDIA_W01');
        (0, vitest_1.expect)(summary).toContain('Approval Engineer');
    });
    (0, vitest_1.it)('compares frozen inputs, profile revisions, outputs, warnings, and approval state', () => {
        const comparison = (0, biologicalMedia_1.compareBiologicalMediaRuns)(run, {
            ...run,
            id: 'run-2',
            run_number: 4,
            status: 'Pending Review',
            media_profile_snapshot: { ...run.media_profile_snapshot, revision: 5 },
            normalized_input_snapshot: { filter: { safety_factor: 1.4 } },
            result_snapshot: { ...run.result_snapshot, media: { required_media_l: 1300, installed_media_l: 1400 } },
            messages: [],
        });
        (0, vitest_1.expect)(comparison.changes.inputs).toHaveLength(1);
        (0, vitest_1.expect)(comparison.changes.media_profile).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({ field: 'revision', before: 4, after: 5 }),
        ]));
        (0, vitest_1.expect)(comparison.changes.results).toHaveLength(1);
        (0, vitest_1.expect)(comparison.changes.warnings).toHaveLength(1);
        (0, vitest_1.expect)(comparison.changes.approval).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({ field: 'status', before: 'Approved', after: 'Pending Review' }),
        ]));
    });
});
