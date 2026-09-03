"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STARTER_THERMAL_WALL_CONSTRUCTIONS = exports.THERMAL_WALL_CONSTRUCTION_VERSION = exports.THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE = exports.THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS = void 0;
exports.seedThermalWallConstructions = seedThermalWallConstructions;
const thermalCalculations_1 = require("../lib/thermalCalculations");
exports.THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS = 'AAT Foundations';
exports.THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE = 'AAT Foundations wall construction starter defaults';
exports.THERMAL_WALL_CONSTRUCTION_VERSION = 'AAT_FOUNDATIONS_WALL_V1.0';
exports.STARTER_THERMAL_WALL_CONSTRUCTIONS = thermalCalculations_1.THERMAL_CONSTRUCTION_DEFAULTS.map(item => ({
    ...item,
    version: exports.THERMAL_WALL_CONSTRUCTION_VERSION,
    source_basis: exports.THERMAL_WALL_CONSTRUCTION_SOURCE_BASIS,
    source_reference: exports.THERMAL_WALL_CONSTRUCTION_SOURCE_REFERENCE,
}));
async function seedThermalWallConstructions(client, approvingEngineerId) {
    let insertedCount = 0;
    for (const item of exports.STARTER_THERMAL_WALL_CONSTRUCTIONS) {
        const result = await client.query(`INSERT INTO thermal_wall_construction_defaults
         (construction_code, construction_label, material,
          conductivity_w_m_k, conductivity_units, version,
          source_basis, source_reference, notes, status, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10)
       ON CONFLICT (construction_code, version) DO NOTHING
       RETURNING id`, [
            item.code,
            item.label,
            item.material,
            item.conductivity_w_m_k,
            item.conductivity_units,
            item.version,
            item.source_basis,
            item.source_reference,
            item.notes,
            approvingEngineerId,
        ]);
        insertedCount += result.rowCount || 0;
    }
    return insertedCount;
}
