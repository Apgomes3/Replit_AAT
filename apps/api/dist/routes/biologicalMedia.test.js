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
(0, vitest_1.describe)('Biological Media controlled profile validation', () => {
    (0, vitest_1.it)('accepts a complete media revision for approval', () => {
        (0, vitest_1.expect)((0, biologicalMedia_1.validateMediaProfile)(completeMediaProfile, true)).toEqual([]);
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
});
