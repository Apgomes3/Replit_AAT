"use strict";
// @vitest-environment node
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const biologicalMediaCalculations_1 = require("./biologicalMediaCalculations");
(0, vitest_1.describe)('AAT Core Foundation engine', () => {
    vitest_1.it.each([
        ['large warm marine', 120, 24, 'Marine', 2.25, 2.7],
        ['small warm marine', 100, 24, 'Marine', 3, 3],
        ['warm freshwater', 120, 24, 'Freshwater', 3.5, 4.2],
        ['cold marine override', 120, 17.9, 'Marine', 4, 4.8],
        ['cold freshwater override', 20, 17.9, 'Freshwater', 4, 0.8],
    ])('sizes %s from net volume', (_label, volume, temperature, waterType, percentage, expectedM3) => {
        const result = (0, biologicalMediaCalculations_1.calculateAatCoreFoundation)({
            calculation_engine: 'AAT_CORE',
            biomass: { water_volume_m3: volume },
            water: { temperature_c: temperature, water_type: waterType },
        });
        (0, vitest_1.expect)(result.status).toBe('VALID');
        (0, vitest_1.expect)(result.media.foundation_percentage).toBeCloseTo(percentage);
        (0, vitest_1.expect)(result.media.required_media_m3).toBeCloseTo(expectedM3);
    });
});
const mediaProfile = {
    id: 'media-1',
    profile_code: 'BASSPRO-90',
    profile_name: 'BassPro overall VTR',
    revision: 1,
    status: 'Approved',
    water_types: ['Marine'],
    reactor_types: ['Hybrid'],
    capacity_model: 'OVERALL_VTR',
    overall_vtr_g_tan_n_m3_d: 90,
    default_safety_factor: 1.2,
    minimum_media_m3: 0,
    module_increment_m3: 0.01,
    media_fill_fraction: 0.6,
    operating_min_temperature_c: 10,
    operating_max_temperature_c: 30,
    operating_min_ph: 6,
    operating_max_ph: 9,
    operating_min_salinity_ppt: 0,
    operating_max_salinity_ppt: 40,
    operating_min_tan_mg_n_l: 0,
    operating_max_tan_mg_n_l: 2,
    zones: [
        { zone_code: 'TRICKLING', default_volume_fraction: 0.7 },
        { zone_code: 'SUBMERGED', default_volume_fraction: 0.3 },
    ],
};
const tanProfile = {
    id: 'tan-1',
    profile_code: 'AAT_CONSERVATIVE_0976',
    status: 'Approved',
    coefficient: 0.0976,
};
const bassProInput = {
    biomass: {
        method: 'VOLUME_DENSITY',
        water_volume_m3: 2.49,
        stocking_density_kg_m3: 6,
    },
    feeding: {
        mode: 'GLOBAL',
        feed_rate_pct_biomass_day: 1,
        protein_pct: 30,
        tan_generation_profile_revision_id: 'tan-1',
    },
    water: {
        water_type: 'Marine',
        temperature_c: 26,
        ph: 8.2,
        salinity_ppt: 32.5,
        tan_target_mg_n_l: 1.2,
    },
    filter: {
        reactor_type: 'Hybrid',
        media_profile_revision_id: 'media-1',
    },
};
(0, vitest_1.describe)('Biological Media deterministic preview calculations', () => {
    (0, vitest_1.it)('matches saltwater profiles to legacy Marine system values', () => {
        const result = (0, biologicalMediaCalculations_1.calculateBiologicalMediaPreview)(bassProInput, { mediaProfile: { ...mediaProfile, water_types: ['Saltwater'] }, tanProfile });
        (0, vitest_1.expect)(result.messages).not.toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({ code: 'PROFILE_001', field: 'water.water_type' }),
        ]));
    });
    (0, vitest_1.it)('matches the BassPro design benchmark without converting TAN-N mass basis', () => {
        const result = (0, biologicalMediaCalculations_1.calculateBiologicalMediaPreview)(bassProInput, { mediaProfile, tanProfile });
        (0, vitest_1.expect)(result.biomass.design_biomass_kg).toBeCloseTo(14.94, 12);
        (0, vitest_1.expect)(result.feeding.total_feed_kg_d).toBeCloseTo(0.1494, 12);
        (0, vitest_1.expect)(result.feeding.protein_input_kg_d).toBeCloseTo(0.04482, 12);
        (0, vitest_1.expect)(result.feeding.tan_load_g_n_d).toBeCloseTo(4.374432, 12);
        (0, vitest_1.expect)(result.media.design_tan_load_g_n_d).toBeCloseTo(5.2493184, 12);
        (0, vitest_1.expect)(result.media.required_media_l).toBeCloseTo(58.32576, 10);
        (0, vitest_1.expect)(result.media.installed_media_l).toBeCloseTo(60, 10);
        (0, vitest_1.expect)(result.media.nominal_capacity_g_n_d).toBeCloseTo(5.4, 12);
        (0, vitest_1.expect)(result.media.operating_utilization * 100).toBeCloseTo(81.008, 9);
        (0, vitest_1.expect)(result.media.design_utilization * 100).toBeCloseTo(97.2096, 9);
        (0, vitest_1.expect)(result.nitrification.oxygen_g_d).toBeCloseTo(19.99115424, 8);
        (0, vitest_1.expect)(result.nitrification.alkalinity_g_d).toBeCloseTo(31.23344448, 8);
        (0, vitest_1.expect)(result.media.zone_media[0].volume_m3 * 1000).toBeCloseTo(42, 12);
        (0, vitest_1.expect)(result.media.zone_media[1].volume_m3 * 1000).toBeCloseTo(18, 12);
    });
    (0, vitest_1.it)('makes equal species biomass produce the same feed and installed media', () => {
        const species = {
            ...bassProInput,
            biomass: {
                method: 'SPECIES_LIST',
                water_volume_m3: 2.49,
                species: [
                    { common_name: 'Species group A', quantity: 6, design_weight_kg: 1.2 },
                    { common_name: 'Species group B', quantity: 18, design_weight_kg: 0.43 },
                ],
            },
        };
        const result = (0, biologicalMediaCalculations_1.calculateBiologicalMediaPreview)(species, { mediaProfile, tanProfile });
        (0, vitest_1.expect)(result.biomass.design_biomass_kg).toBeCloseTo(14.94, 12);
        (0, vitest_1.expect)(result.biomass.equivalent_stocking_density_kg_m3).toBeCloseTo(6, 12);
        (0, vitest_1.expect)(result.feeding.tan_load_g_n_d).toBeCloseTo(4.374432, 12);
        (0, vitest_1.expect)(result.media.installed_media_l).toBeCloseTo(60, 12);
    });
    (0, vitest_1.it)('matches the Bower/Bidwell ammonia benchmark continuously', () => {
        const ammonia = (0, biologicalMediaCalculations_1.calculateAmmonia)(bassProInput);
        (0, vitest_1.expect)(ammonia.ionic_strength).toBeCloseTo(0.6695074074, 9);
        (0, vitest_1.expect)(ammonia.pka).toBeCloseTo(9.3142108605, 9);
        (0, vitest_1.expect)(ammonia.nh3_fraction).toBeCloseTo(0.0713877277, 9);
        (0, vitest_1.expect)(ammonia.nh3_n_mg_l).toBeCloseTo(0.0856652732, 9);
        (0, vitest_1.expect)(ammonia.nh3_mg_l).toBeCloseTo(0.104159725, 9);
        (0, vitest_1.expect)((0, biologicalMediaCalculations_1.calculateAmmonia)({
            ...bassProInput,
            water: { ...bassProInput.water, ph: 8.15, salinity_ppt: 32.4 },
        }).nh3_fraction).toBeTypeOf('number');
    });
    (0, vitest_1.it)('returns stable blocking codes for contradictory and invalid biomass inputs', () => {
        (0, vitest_1.expect)((0, biologicalMediaCalculations_1.calculateBiomass)({
            biomass: {
                method: 'VOLUME_DENSITY',
                water_volume_m3: 2.49,
                stocking_density_kg_m3: 6,
                species: [{ common_name: 'Contradiction', quantity: 1, design_weight_kg: 1 }],
            },
        }).messages.map(message => message.code)).toContain('BIO_002');
        (0, vitest_1.expect)((0, biologicalMediaCalculations_1.calculateBiomass)({
            biomass: {
                method: 'SPECIES_LIST',
                water_volume_m3: 2.49,
                species: [{ common_name: 'Invalid', quantity: 1.5, design_weight_kg: 0 }],
            },
        }).messages.map(message => message.code)).toContain('BIO_005');
    });
    (0, vitest_1.it)('keeps manual feed comparison-only and gates unapproved profiles', () => {
        const withManualFeed = {
            ...bassProInput,
            feeding: { ...bassProInput.feeding, manual_daily_feed_kg_d: 10 },
        };
        const result = (0, biologicalMediaCalculations_1.calculateBiologicalMediaPreview)(withManualFeed, {
            mediaProfile: { ...mediaProfile, status: 'Draft' },
            tanProfile,
        });
        (0, vitest_1.expect)(result.feeding.total_feed_kg_d).toBeCloseTo(0.1494, 12);
        (0, vitest_1.expect)(result.feeding.tan_load_g_n_d).toBeCloseTo(4.374432, 12);
        (0, vitest_1.expect)(result.messages.map(message => message.code)).toEqual(vitest_1.expect.arrayContaining(['FEED_W01', 'PROFILE_001']));
        (0, vitest_1.expect)(result.status).toBe('BLOCKED');
    });
});
