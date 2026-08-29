"use strict";
/**
 * Deterministic Biological Media preview calculations.
 *
 * This module has no database or request dependencies.  Profiles and draft
 * values are passed in explicitly so a preview can be reproduced from its
 * normalized input snapshot.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAmmoniaSpeciation = exports.calculateBiologicalMedia = exports.VALIDATION_TOLERANCE = exports.FEEDING_MODES = exports.BIOMASS_METHODS = exports.BIOLOGICAL_MEDIA_ENGINE_VERSION = void 0;
exports.normalizeBiologicalMediaInput = normalizeBiologicalMediaInput;
exports.calculateBiomass = calculateBiomass;
exports.calculateFeeding = calculateFeeding;
exports.calculateAmmonia = calculateAmmonia;
exports.validateMediaProfileForPreview = validateMediaProfileForPreview;
exports.calculateMediaCapacity = calculateMediaCapacity;
exports.calculateMediaVolume = calculateMediaVolume;
exports.calculateNitrificationDemand = calculateNitrificationDemand;
exports.calculateOptionalHydraulics = calculateOptionalHydraulics;
exports.calculateBiologicalMediaPreview = calculateBiologicalMediaPreview;
exports.BIOLOGICAL_MEDIA_ENGINE_VERSION = 'BIOFILTER_1_0';
exports.BIOMASS_METHODS = ['VOLUME_DENSITY', 'SPECIES_LIST'];
exports.FEEDING_MODES = ['GLOBAL', 'PER_SPECIES'];
exports.VALIDATION_TOLERANCE = 0.001;
const finite = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};
const text = (value) => {
    if (value === null || value === undefined)
        return null;
    const s = String(value).trim();
    return s || null;
};
const first = (...values) => values.find(value => value !== undefined);
const upper = (value) => text(value)?.toUpperCase().replace(/[\s-]+/g, '_') || null;
const pctFraction = (value) => {
    const n = finite(value);
    return n == null ? null : n > 1 ? n / 100 : n;
};
const percentage = (value) => {
    const n = finite(value);
    return n == null ? null : n / 100;
};
function add(messages, code, message, field_path, severity = 'BLOCKING') {
    messages.push({ code, severity, field_path, message });
}
function biomassInput(input) {
    return input?.biomass || input;
}
function feedingInput(input) {
    return input?.feeding || input;
}
function waterInput(input) {
    return input?.water || input;
}
function filterInput(input) {
    return input?.filter || input;
}
function normalizeBiologicalMediaInput(input) {
    const biomass = biomassInput(input);
    const feeding = feedingInput(input);
    const water = waterInput(input);
    const filter = filterInput(input);
    const method = upper(first(biomass.method, input?.biomass_method));
    const species = Array.isArray(biomass.species)
        ? biomass.species
        : Array.isArray(input?.species_rows) ? input.species_rows : [];
    return {
        biomass: {
            method,
            water_volume_m3: finite(first(biomass.water_volume_m3, input?.water_volume_m3)),
            stocking_density_kg_m3: finite(first(biomass.stocking_density_kg_m3, input?.stocking_density_kg_m3)),
            species: species.map((row, index) => ({
                id: row.id || null,
                species_profile_id: row.species_profile_id || row.catalog_species_id || row.catalog_id || null,
                common_name_snapshot: text(first(row.common_name_snapshot, row.common_name, row.species_name)),
                scientific_name_snapshot: text(first(row.scientific_name_snapshot, row.scientific_name)),
                life_stage: text(row.life_stage),
                quantity: finite(row.quantity),
                design_weight_kg: finite(first(row.design_weight_kg, row.weight_kg, row.entered_design_weight_kg)),
                entered_weight_kg: finite(first(row.entered_weight_kg, row.design_weight_kg, row.weight_kg)),
                notes: text(row.notes),
                sort_order: finite(row.sort_order) ?? index,
            })),
        },
        feeding: {
            mode: upper(first(feeding.mode, input?.feeding_mode)) || 'GLOBAL',
            feed_rate_fraction_day: feeding.feed_rate_fraction_day != null || input?.feed_rate_fraction_day != null
                ? finite(first(feeding.feed_rate_fraction_day, input?.feed_rate_fraction_day))
                : percentage(first(feeding.feed_rate_pct_biomass_day, input?.feed_rate_pct_biomass_day)),
            protein_fraction: feeding.protein_fraction != null || input?.protein_fraction != null
                ? finite(first(feeding.protein_fraction, input?.protein_fraction))
                : percentage(first(feeding.protein_pct, input?.protein_pct)),
            manual_feed_check_kg_d: finite(first(feeding.manual_feed_check_kg_d, feeding.manual_daily_feed_kg_d, input?.manual_daily_feed_kg_d)),
            tan_generation_profile_revision_id: first(feeding.tan_generation_profile_revision_id, feeding.tan_profile_id, input?.tan_generation_profile_revision_id) || null,
            tan_coefficient: finite(first(feeding.tan_coefficient, feeding.coefficient, input?.tan_coefficient)),
            lines: Array.isArray(feeding.lines) ? feeding.lines : Array.isArray(input?.feed_lines) ? input.feed_lines : [],
        },
        water: {
            water_type: upper(first(water.water_type, input?.water_type)),
            temperature_c: finite(first(water.temperature_c, input?.temperature_c)),
            ph: finite(first(water.ph, water.pH, input?.ph)),
            salinity_ppt: finite(first(water.salinity_ppt, input?.salinity_ppt)),
            tan_target_mg_n_l: finite(first(water.tan_target_mg_n_l, water.max_tan_mg_n_l, input?.tan_target_mg_n_l, input?.max_tan_mg_n_l)),
            do_in_mg_l: finite(first(water.do_in_mg_l, input?.do_in_mg_l)),
            do_out_min_mg_l: finite(first(water.do_out_min_mg_l, input?.do_out_min_mg_l)),
            alkalinity_mg_l_caco3: finite(first(water.alkalinity_mg_l_caco3, input?.alkalinity_mg_l_caco3)),
            system_flow_m3_h: finite(first(water.system_flow_m3_h, water.actual_flow_m3_h, input?.system_flow_m3_h)),
        },
        filter: {
            reactor_type: text(first(filter.reactor_type, input?.reactor_type)),
            media_profile_revision_id: first(filter.media_profile_revision_id, filter.media_profile_id, input?.media_profile_revision_id) || null,
            safety_factor: finite(first(filter.safety_factor, input?.safety_factor)),
        },
    };
}
function calculateBiomass(input) {
    const normalized = normalizeBiologicalMediaInput(input);
    const { biomass } = normalized;
    const messages = [];
    const method = biomass.method;
    const hasVolumeInputs = biomass.water_volume_m3 != null || biomass.stocking_density_kg_m3 != null;
    const hasSpeciesRows = biomass.species.length > 0;
    if (!exports.BIOMASS_METHODS.includes(method)) {
        add(messages, 'BIO_001', 'Select exactly one biomass method.');
    }
    if ((method === 'VOLUME_DENSITY' && hasSpeciesRows)
        || (method === 'SPECIES_LIST' && biomass.stocking_density_kg_m3 != null)
        || (!method && hasVolumeInputs && hasSpeciesRows)) {
        add(messages, 'BIO_002', 'Volume and density and species-list biomass inputs cannot both be active.');
    }
    let designBiomassKg = null;
    const rows = biomass.species.map((row, index) => {
        const validQuantity = row.quantity != null && Number.isInteger(row.quantity) && row.quantity > 0;
        const validWeight = row.design_weight_kg != null && row.design_weight_kg > 0;
        if (method === 'SPECIES_LIST' && !validQuantity) {
            add(messages, 'BIO_005', `Species row ${index + 1} quantity must be a positive whole number.`, `biomass.species.${index}.quantity`);
        }
        if (method === 'SPECIES_LIST' && !validWeight) {
            add(messages, 'BIO_005', `Species row ${index + 1} design weight must be positive.`, `biomass.species.${index}.design_weight_kg`);
        }
        return {
            ...row,
            biomass_kg: validQuantity && validWeight ? row.quantity * row.design_weight_kg : null,
            entered_weight_kg: row.entered_weight_kg,
        };
    });
    if (method === 'VOLUME_DENSITY') {
        if (biomass.water_volume_m3 == null || biomass.water_volume_m3 <= 0
            || biomass.stocking_density_kg_m3 == null || biomass.stocking_density_kg_m3 <= 0) {
            add(messages, 'BIO_003', 'Water volume and stocking density must both be greater than zero.');
        }
        else {
            designBiomassKg = biomass.water_volume_m3 * biomass.stocking_density_kg_m3;
        }
    }
    else if (method === 'SPECIES_LIST') {
        if (!hasSpeciesRows)
            add(messages, 'BIO_004', 'Add at least one species row for the species-list method.');
        if (!messages.some(message => message.code === 'BIO_005')) {
            designBiomassKg = rows.reduce((sum, row) => sum + row.biomass_kg, 0);
        }
    }
    if (designBiomassKg != null && designBiomassKg <= 0) {
        add(messages, 'BIO_003', 'Design biomass must be greater than zero.');
        designBiomassKg = null;
    }
    const equivalentStockingDensityKgM3 = designBiomassKg != null
        && biomass.water_volume_m3 != null && biomass.water_volume_m3 > 0
        ? designBiomassKg / biomass.water_volume_m3
        : null;
    return {
        method,
        water_volume_m3: biomass.water_volume_m3,
        stocking_density_kg_m3: biomass.stocking_density_kg_m3,
        species_rows: rows,
        design_biomass_kg: designBiomassKg,
        equivalent_stocking_density_kg_m3: equivalentStockingDensityKgM3,
        messages,
    };
}
function calculateFeeding(input, biomassResult = calculateBiomass(input), tanProfile) {
    const normalized = normalizeBiologicalMediaInput(input);
    const feeding = normalized.feeding;
    const messages = [...biomassResult.messages];
    const coefficient = finite(first(tanProfile?.coefficient, tanProfile?.kg_tan_n_per_kg_protein, feeding.tan_coefficient));
    const profileIsGeneral = Boolean(tanProfile?.is_general || upper(tanProfile?.profile_code)?.includes('GENERAL'));
    if (!tanProfile || tanProfile.status !== 'Approved') {
        add(messages, 'FEED_001', 'The selected TAN generation profile must be an approved revision.', 'feeding.tan_generation_profile_revision_id');
    }
    if (feeding.mode === 'GLOBAL') {
        if (feeding.feed_rate_fraction_day == null || feeding.feed_rate_fraction_day <= 0
            || feeding.protein_fraction == null || feeding.protein_fraction <= 0
            || coefficient == null || coefficient <= 0) {
            add(messages, 'FEED_001', 'Global feed rate, protein fraction, and an approved TAN coefficient are required and must be positive.');
        }
        if (feeding.feed_rate_fraction_day != null && feeding.feed_rate_fraction_day > 1) {
            add(messages, 'FEED_001', 'Feed rate fraction cannot exceed 100%.', 'feeding.feed_rate_pct_biomass_day');
        }
        if (feeding.protein_fraction != null && feeding.protein_fraction > 1) {
            add(messages, 'FEED_001', 'Protein fraction cannot exceed 100%.', 'feeding.protein_pct');
        }
    }
    else if (feeding.mode !== 'PER_SPECIES') {
        add(messages, 'FEED_001', 'Select GLOBAL or PER_SPECIES feeding mode.', 'feeding.mode');
    }
    const contributions = [];
    if (feeding.mode === 'GLOBAL' && biomassResult.design_biomass_kg != null
        && feeding.feed_rate_fraction_day != null && feeding.protein_fraction != null && coefficient != null) {
        const totalFeed = biomassResult.design_biomass_kg * feeding.feed_rate_fraction_day;
        const protein = totalFeed * feeding.protein_fraction;
        contributions.push({
            label: 'Global feeding',
            biomass_kg: biomassResult.design_biomass_kg,
            feed_kg_d: totalFeed,
            protein_kg_d: protein,
            tan_load_g_n_d: protein * coefficient * 1000,
            tan_coefficient: coefficient,
        });
    }
    else if (feeding.mode === 'PER_SPECIES') {
        const lines = feeding.lines.length ? feeding.lines : biomassResult.species_rows.map((row) => ({
            species_row_id: row.id,
            feed_rate_fraction_day: feeding.feed_rate_fraction_day,
            protein_fraction: feeding.protein_fraction,
            diet_allocation_fraction: 1,
            tan_coefficient: coefficient,
        }));
        const grouped = new Map();
        for (const line of lines) {
            const row = biomassResult.species_rows.find((item) => item.id === line.species_row_id || item.sort_order === line.species_row_index);
            const biomass = row?.biomass_kg;
            const rate = line.feed_rate_fraction_day != null
                ? finite(line.feed_rate_fraction_day) : percentage(line.feed_rate_pct_biomass_day);
            const proteinFraction = line.protein_fraction != null
                ? finite(line.protein_fraction) : percentage(line.protein_pct);
            const allocation = line.diet_allocation_fraction != null
                ? finite(line.diet_allocation_fraction) : percentage(line.diet_allocation_pct) ?? 1;
            const lineCoefficient = finite(first(line.tan_coefficient, line.coefficient, coefficient));
            if (biomass == null || rate == null || rate <= 0 || proteinFraction == null || proteinFraction <= 0
                || allocation < 0 || lineCoefficient == null || lineCoefficient <= 0) {
                add(messages, 'FEED_001', 'Each feeding line needs positive feed, protein, allocation, and TAN coefficient values.');
                continue;
            }
            const key = String(line.species_row_id || line.species_row_index || 'global');
            grouped.set(key, (grouped.get(key) || 0) + allocation);
            const feed = biomass * rate * allocation;
            const protein = feed * proteinFraction;
            contributions.push({
                species_row_id: line.species_row_id || null,
                feed_kg_d: feed,
                protein_kg_d: protein,
                tan_load_g_n_d: protein * lineCoefficient * 1000,
                tan_coefficient: lineCoefficient,
            });
        }
        for (const total of grouped.values()) {
            if (Math.abs(total - 1) > exports.VALIDATION_TOLERANCE) {
                add(messages, 'FEED_002', 'Diet allocations for a feeding group must total 1.000.');
            }
        }
    }
    const totalFeed = contributions.reduce((sum, row) => sum + row.feed_kg_d, 0);
    const proteinInput = contributions.reduce((sum, row) => sum + row.protein_kg_d, 0);
    const tanLoad = contributions.reduce((sum, row) => sum + row.tan_load_g_n_d, 0);
    if (feeding.manual_feed_check_kg_d != null && totalFeed > 0
        && Math.abs(feeding.manual_feed_check_kg_d - totalFeed) / totalFeed > 0.05) {
        add(messages, 'FEED_W01', 'Manual feed differs from calculated feed by more than 5%; it is comparison-only.', 'feeding.manual_daily_feed_kg_d', 'WARNING');
    }
    if (profileIsGeneral) {
        add(messages, 'FEED_W02', 'A general TAN generation coefficient was used instead of project-validated data.', 'feeding.tan_generation_profile_revision_id', 'WARNING');
    }
    return {
        mode: feeding.mode,
        feed_rate_fraction_day: feeding.feed_rate_fraction_day,
        protein_fraction: feeding.protein_fraction,
        manual_feed_check_kg_d: feeding.manual_feed_check_kg_d,
        tan_coefficient: coefficient,
        contributions,
        total_feed_kg_d: contributions.length ? totalFeed : null,
        protein_input_kg_d: contributions.length ? proteinInput : null,
        tan_load_g_n_d: contributions.length ? tanLoad : null,
        messages,
    };
}
function calculateAmmonia(input) {
    const normalized = normalizeBiologicalMediaInput(input);
    const water = normalized.water;
    const messages = [];
    if (water.temperature_c == null || water.ph == null || water.salinity_ppt == null || water.tan_target_mg_n_l == null
        || water.ph < 0 || water.ph > 14 || water.salinity_ppt < 0 || water.tan_target_mg_n_l < 0) {
        add(messages, 'WATER_001', 'Temperature, pH, salinity, and maximum TAN nitrogen are required; pH must be 0–14 and salinity/TAN cannot be negative.');
        return { messages, temperature_c: water.temperature_c, ph: water.ph, salinity_ppt: water.salinity_ppt };
    }
    const kelvin = water.temperature_c + 273.15;
    const ionicStrength = 19.9273 * water.salinity_ppt / (1000 - 1.005109 * water.salinity_ppt);
    const pKa = 0.09018 + 2729.92 / kelvin + (0.1552 - 0.000314 * water.temperature_c) * ionicStrength;
    const nh3Fraction = 1 / (1 + (10 ** (pKa - water.ph)));
    const nh3NitrogenMgL = water.tan_target_mg_n_l * nh3Fraction;
    return {
        temperature_c: water.temperature_c,
        ph: water.ph,
        salinity_ppt: water.salinity_ppt,
        tan_target_mg_n_l: water.tan_target_mg_n_l,
        temperature_kelvin: kelvin,
        ionic_strength: ionicStrength,
        pka: pKa,
        nh3_fraction: nh3Fraction,
        nh3_percent: nh3Fraction * 100,
        nh3_n_mg_l: nh3NitrogenMgL,
        nh3_mg_l: nh3NitrogenMgL * 17.031 / 14.007,
        messages,
    };
}
function profileField(profile, ...keys) {
    return finite(first(...keys.map(key => profile?.[key])));
}
function validateMediaProfileForPreview(profile, input) {
    const normalized = normalizeBiologicalMediaInput(input);
    const messages = [];
    if (!profile || profile.status !== 'Approved') {
        add(messages, 'PROFILE_001', 'The selected media profile must be an approved revision.');
        return messages;
    }
    if (!normalized.filter.reactor_type) {
        add(messages, 'PROFILE_001', 'A reactor type is required to verify media-profile compatibility.', 'filter.reactor_type');
    }
    const waterType = normalized.water.water_type?.replace('SALT_WATER', 'MARINE');
    const waterTypes = Array.isArray(profile.water_types) ? profile.water_types.map((v) => upper(v)) : [];
    if (waterType && !waterTypes.includes(waterType) && !waterTypes.includes('UNIVERSAL')) {
        add(messages, 'PROFILE_001', `The selected media profile is not approved for ${waterType}.`, 'water.water_type');
    }
    const reactors = Array.isArray(profile.reactor_types) ? profile.reactor_types.map((v) => String(v).trim().toLowerCase()) : [];
    if (normalized.filter.reactor_type && reactors.length
        && !reactors.includes(normalized.filter.reactor_type.toLowerCase())) {
        add(messages, 'PROFILE_001', `The selected media profile is not approved for reactor type ${normalized.filter.reactor_type}.`, 'filter.reactor_type');
    }
    const envelope = [
        ['temperature_c', normalized.water.temperature_c, 'operating_min_temperature_c', 'operating_max_temperature_c'],
        ['ph', normalized.water.ph, 'operating_min_ph', 'operating_max_ph'],
        ['salinity_ppt', normalized.water.salinity_ppt, 'operating_min_salinity_ppt', 'operating_max_salinity_ppt'],
        ['tan_target_mg_n_l', normalized.water.tan_target_mg_n_l, 'operating_min_tan_mg_n_l', 'operating_max_tan_mg_n_l'],
        ['do_in_mg_l', normalized.water.do_in_mg_l, 'operating_min_do_mg_l', 'operating_max_do_mg_l'],
        ['system_flow_m3_h', normalized.water.system_flow_m3_h, 'operating_min_flow_m3_h', 'operating_max_flow_m3_h'],
    ];
    for (const [field, value, minKey, maxKey] of envelope) {
        if (value == null)
            continue;
        const min = profileField(profile, minKey, minKey.replace('operating_', ''));
        const max = profileField(profile, maxKey, maxKey.replace('operating_', ''));
        if ((min != null && value < min) || (max != null && value > max)) {
            add(messages, 'PROFILE_002', `${field} is outside the approved media profile operating envelope.`, `water.${field}`);
        }
    }
    return messages;
}
function calculateMediaCapacity(profile) {
    const model = upper(first(profile?.capacity_model, profile?.capacity_model_code));
    const overallVtr = profileField(profile, 'overall_vtr_g_tan_n_m3_d', 'overall_vtr_g_n_m3_d', 'approved_overall_vtr_g_tan_n_m3_d');
    const zones = Array.isArray(profile?.zones) ? profile.zones : [];
    const hasOverall = overallVtr != null && overallVtr > 0;
    const hasZones = zones.length > 0;
    const messages = [];
    if (model === 'OVERALL_VTR' && !hasOverall)
        add(messages, 'PROFILE_003', 'The overall VTR capacity model is missing its approved VTR.');
    if (model === 'ZONE_WEIGHTED' && !hasZones)
        add(messages, 'PROFILE_003', 'The weighted-zone capacity model has no enabled zones.');
    if (hasOverall && hasZones && model === 'OVERALL_VTR') {
        // Zones are physical allocation only in the overall model, never a second
        // capacity model.
    }
    if (model !== 'OVERALL_VTR' && model !== 'ZONE_WEIGHTED') {
        add(messages, 'PROFILE_003', 'The selected media profile has an incomplete or unsupported capacity model.');
    }
    let capacity = hasOverall && model === 'OVERALL_VTR' ? overallVtr : null;
    let zoneCapacity = [];
    if (model === 'ZONE_WEIGHTED') {
        let totalFraction = 0;
        zoneCapacity = zones.map((zone) => {
            const fraction = finite(first(zone.default_volume_fraction, zone.volume_fraction)) ?? 0;
            const vtr = profileField(zone, 'vtr_g_tan_n_m3_d', 'vtr_g_n_m3_d');
            const ssa = profileField(zone, 'effective_ssa_m2_m3');
            const atr = profileField(zone, 'atr_g_tan_n_m2_d', 'atr_g_n_m2_d');
            const rate = vtr ?? (ssa != null && atr != null ? ssa * atr : null);
            totalFraction += fraction;
            return { zone_code: zone.zone_code, volume_fraction: fraction, capacity_g_tan_n_m3_d: rate };
        });
        if (Math.abs(totalFraction - 1) > exports.VALIDATION_TOLERANCE) {
            add(messages, 'ZONE_001', 'Enabled zone volume fractions must total 1.000.');
        }
        if (zoneCapacity.some(zone => zone.capacity_g_tan_n_m3_d == null || zone.capacity_g_tan_n_m3_d <= 0)) {
            add(messages, 'PROFILE_003', 'Every enabled zone needs an approved VTR or effective SSA and ATR.');
        }
        else {
            capacity = zoneCapacity.reduce((sum, zone) => sum + zone.volume_fraction * zone.capacity_g_tan_n_m3_d, 0);
        }
    }
    return { model, capacity_g_tan_n_m3_d: capacity, zones: zoneCapacity, messages };
}
function calculateMediaVolume(input, feedResult, profile, capacityResult = calculateMediaCapacity(profile)) {
    const normalized = normalizeBiologicalMediaInput(input);
    const messages = [...capacityResult.messages];
    const load = feedResult.tan_load_g_n_d;
    const safetyFactor = normalized.filter.safety_factor ?? profile?.default_safety_factor;
    const minimumM3 = profileField(profile, 'minimum_media_m3', 'minimum_media_volume_m3');
    const minimumL = profileField(profile, 'minimum_media_l');
    const minMediaM3 = minimumM3 ?? (minimumL != null ? minimumL / 1000 : null);
    const moduleM3 = profileField(profile, 'module_increment_m3')
        ?? ((profileField(profile, 'module_increment_l') || 0) / 1000);
    const fillFraction = profileField(profile, 'media_fill_fraction', 'media_void_fraction');
    if (load == null || load <= 0 || capacityResult.capacity_g_tan_n_m3_d == null
        || safetyFactor == null || safetyFactor <= 0 || minMediaM3 == null
        || moduleM3 == null || moduleM3 <= 0 || fillFraction == null || fillFraction <= 0 || fillFraction > 1) {
        add(messages, 'PROFILE_003', 'Complete approved VTR, safety factor, minimum media, and module increment fields are required before sizing.');
        return { messages, required_media_m3: null, installed_media_m3: null };
    }
    if (safetyFactor < (profile?.default_safety_factor ?? safetyFactor)) {
        add(messages, 'MEDIA_W02', 'The selected safety factor is below the approved profile default.', 'filter.safety_factor', 'WARNING');
    }
    const designLoad = load * safetyFactor;
    const required = designLoad / capacityResult.capacity_g_tan_n_m3_d;
    const installed = Math.max(minMediaM3 || 0, Math.ceil((required - 1e-12) / moduleM3) * moduleM3);
    if (required < (minMediaM3 || 0)) {
        add(messages, 'MEDIA_W01', 'Required media is below the profile minimum practical volume; the minimum will be installed.', 'filter.minimum_media_m3', 'WARNING');
    }
    const nominalCapacity = installed * capacityResult.capacity_g_tan_n_m3_d;
    const zones = capacityResult.model === 'OVERALL_VTR'
        ? (Array.isArray(profile?.zones) ? profile.zones : []).map((zone) => ({
            zone_code: zone.zone_code,
            volume_fraction: finite(first(zone.default_volume_fraction, zone.volume_fraction)) ?? 0,
            volume_m3: installed * (finite(first(zone.default_volume_fraction, zone.volume_fraction)) ?? 0),
        }))
        : capacityResult.zones.map((zone) => ({ ...zone, volume_m3: installed * zone.volume_fraction }));
    return {
        safety_factor: safetyFactor,
        design_tan_load_g_n_d: designLoad,
        required_media_m3: required,
        required_media_l: required * 1000,
        installed_media_m3: installed,
        installed_media_l: installed * 1000,
        nominal_capacity_g_n_d: nominalCapacity,
        operating_utilization: load / nominalCapacity,
        design_utilization: designLoad / nominalCapacity,
        operating_capacity_margin_g_n_d: nominalCapacity - load,
        zone_media: zones,
        vessel_volume_m3: fillFraction != null && fillFraction > 0 && fillFraction <= 1 ? installed / fillFraction : null,
        messages,
    };
}
function calculateNitrificationDemand(tanLoad) {
    if (tanLoad == null)
        return {
            oxygen_g_d: null, alkalinity_g_d: null, nitrate_n_g_d: null, nitrate_g_d: null,
        };
    const nitrateN = 0.98 * tanLoad;
    return {
        oxygen_g_d: 4.57 * tanLoad,
        alkalinity_g_d: 7.14 * tanLoad,
        nitrate_n_g_d: nitrateN,
        nitrate_g_d: nitrateN * 62.0049 / 14.0067,
    };
}
function calculateOptionalHydraulics(input, feedResult, nitrification) {
    const water = normalizeBiologicalMediaInput(input).water;
    const messages = [];
    const result = {};
    if (water.alkalinity_mg_l_caco3 == null) {
        add(messages, 'WATER_W03', 'Alkalinity was not supplied; theoretical demand is shown but depletion cannot be checked.', 'water.alkalinity_mg_l_caco3', 'WARNING');
    }
    if (water.system_flow_m3_h == null || water.do_in_mg_l == null || water.do_out_min_mg_l == null) {
        add(messages, 'MEDIA_W03', 'Flow or dissolved-oxygen geometry information is absent, so hydraulic performance has not been checked.', undefined, 'WARNING');
        return { ...result, messages };
    }
    if (feedResult.tan_load_g_n_d != null && water.tan_target_mg_n_l > 0) {
        result.tan_flow_m3_h = feedResult.tan_load_g_n_d / water.tan_target_mg_n_l / 24;
    }
    const doDelta = water.do_in_mg_l - water.do_out_min_mg_l;
    if (doDelta > 0 && nitrification.oxygen_g_d != null) {
        result.oxygen_flow_m3_h = nitrification.oxygen_g_d / doDelta / 24;
    }
    result.actual_flow_m3_h = water.system_flow_m3_h;
    result.flow_check = result.tan_flow_m3_h != null && water.system_flow_m3_h >= result.tan_flow_m3_h ? 'pass' : 'review';
    return { ...result, messages };
}
function calculateBiologicalMediaPreview(input, options = {}) {
    const normalized = normalizeBiologicalMediaInput(input);
    const biomass = calculateBiomass(normalized);
    const feeding = calculateFeeding(normalized, biomass, options.tanProfile);
    const ammonia = calculateAmmonia(normalized);
    const mediaProfileMessages = validateMediaProfileForPreview(options.mediaProfile, normalized);
    const capacity = calculateMediaCapacity(options.mediaProfile || {});
    const media = calculateMediaVolume(normalized, feeding, options.mediaProfile || {}, capacity);
    const nitrification = calculateNitrificationDemand(feeding.tan_load_g_n_d);
    const hydraulics = calculateOptionalHydraulics(normalized, feeding, nitrification);
    const messages = [
        ...biomass.messages,
        ...feeding.messages.filter(message => !biomass.messages.includes(message)),
        ...ammonia.messages,
        ...mediaProfileMessages,
        ...media.messages,
        ...hydraulics.messages,
    ];
    const blocking = messages.some(message => message.severity === 'BLOCKING');
    const warnings = messages.some(message => message.severity === 'WARNING');
    return {
        engine_version: exports.BIOLOGICAL_MEDIA_ENGINE_VERSION,
        status: blocking ? 'BLOCKED' : warnings ? 'VALID_WITH_WARNINGS' : 'VALID',
        messages,
        assumptions: [
            'TAN nitrogen remains the sizing mass basis; the NH3 molecular-mass conversion is display-only.',
            'No temperature, pH, salinity, TAN concentration, growth, oxygen, carbon-dioxide, solids, or other workbook correction multipliers were applied.',
            'The result is a deterministic concept-sizing preview, not a detailed-design certification or immutable calculation run.',
        ],
        biomass,
        feeding,
        ammonia,
        media: mediaProfileMessages.length || capacity.messages.length ? { ...media } : media,
        capacity,
        nitrification,
        hydraulics,
    };
}
// Explicit aliases make the pure services convenient for callers and tests.
exports.calculateBiologicalMedia = calculateBiologicalMediaPreview;
exports.calculateAmmoniaSpeciation = calculateAmmonia;
