"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSpeciesAllocation = calculateSpeciesAllocation;
function calculateSpeciesAllocation(inputs) {
    const catalogLinked = inputs.catalogLinked
        ?? (inputs.catalogAverageSizeCm != null || inputs.catalogReferenceMassKg != null);
    const averageSizeCm = catalogLinked
        ? inputs.averageSizeOverrideCm ?? inputs.catalogAverageSizeCm ?? null
        : inputs.manualAverageSizeCm ?? null;
    const referenceAverageMassKg = catalogLinked
        ? inputs.referenceMassOverrideKg ?? inputs.catalogReferenceMassKg ?? null
        : inputs.manualReferenceMassKg ?? null;
    const calculatedBiomass = inputs.quantity != null && referenceAverageMassKg != null
        ? Math.round(inputs.quantity * referenceAverageMassKg * 10000) / 10000
        : null;
    const biomassKg = catalogLinked
        ? inputs.biomassOverrideKg ?? calculatedBiomass
        : inputs.manualBiomassKg ?? calculatedBiomass;
    return {
        average_size_cm: averageSizeCm,
        reference_average_mass_kg: referenceAverageMassKg,
        biomass_kg: biomassKg,
        average_size_source: inputs.averageSizeOverrideCm != null
            ? 'override'
            : catalogLinked ? 'catalog_snapshot' : averageSizeCm != null ? 'manual' : null,
        reference_mass_source: inputs.referenceMassOverrideKg != null
            ? 'override'
            : catalogLinked ? 'catalog_snapshot' : referenceAverageMassKg != null ? 'manual' : null,
        biomass_source: inputs.biomassOverrideKg != null
            ? 'override'
            : calculatedBiomass != null && inputs.manualBiomassKg == null ? 'calculated' : biomassKg != null ? 'manual' : null,
    };
}
