"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.versionSnapshotTestUtils = exports.thermalCorrelationTestUtils = exports.thermalCalculationTestUtils = void 0;
exports.loadFrictionLossPackages = loadFrictionLossPackages;
exports.loadReleaseContext = loadReleaseContext;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const index_1 = __importStar(require("../db/index"));
const crypto_1 = __importDefault(require("crypto"));
const audit_1 = require("../db/audit");
const designBookRelease_1 = require("../lib/designBookRelease");
const designBookWorkflow_1 = require("../lib/designBookWorkflow");
const aquariumCalculations_1 = require("../lib/aquariumCalculations");
const thermalCalculations_1 = require("../lib/thermalCalculations");
const speciesAllocations_1 = require("../lib/speciesAllocations");
const pumpSelections_1 = require("../lib/pumpSelections");
const frictionLossCalculations_1 = require("../lib/frictionLossCalculations");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const isLifeSupportSystem = (system) => String(system?.system_type || '').trim().toLowerCase() === 'life support';
const routeParam = (value) => Array.isArray(value) ? value[0] : value;
async function attachSystemSideStreams(runner, systems) {
    if (!systems.length)
        return systems;
    const rows = (await runner(`SELECT * FROM system_flow_side_streams
     WHERE system_id = ANY($1::uuid[])
     ORDER BY parent_loop_number, sort_order, created_at, id`, [systems.map(system => system.id)])).rows;
    const fractionators = (await runner(`SELECT * FROM system_flow_fractionator_allocations
     WHERE system_id = ANY($1::uuid[]) ORDER BY parent_loop_number`, [systems.map(system => system.id)])).rows;
    return systems.map(system => ({
        ...system,
        side_streams: rows.filter(stream => stream.system_id === system.id),
        fractionator_allocations: fractionators.filter(allocation => allocation.system_id === system.id),
    }));
}
async function loadPumpSelections(runner, systems) {
    if (!systems.length)
        return [];
    const saved = (await runner('SELECT * FROM system_pump_selections WHERE system_id = ANY($1::uuid[])', [systems.map(system => system.id)])).rows;
    return systems.map(system => {
        const rows = saved.filter(row => row.system_id === system.id);
        const circuits = new Map((0, pumpSelections_1.pumpCircuits)(system, system.side_streams || []).map(item => [item.circuit_key, item]));
        rows.forEach(row => {
            if (!circuits.has(row.circuit_key))
                circuits.set(row.circuit_key, {
                    circuit_key: row.circuit_key, circuit_kind: 'orphaned', circuit_name: row.circuit_key,
                    circuit_type: null, parent_loop_number: null, side_stream_id: null, flow_m3h: null,
                });
        });
        return {
            system_id: system.id,
            items: [...circuits.values()].map(circuit => {
                const row = rows.find(value => value.circuit_key === circuit.circuit_key);
                const source = {
                    circuit: { circuit_key: circuit.circuit_key, circuit_kind: circuit.circuit_kind, circuit_name: circuit.circuit_name,
                        circuit_type: circuit.circuit_type, parent_loop_number: circuit.parent_loop_number, side_stream_id: circuit.side_stream_id, flow_m3h: circuit.flow_m3h },
                    design_head_m: row?.design_head_m == null ? null : Number(row.design_head_m),
                    pump_efficiency_pct: row?.pump_efficiency_pct == null ? null : Number(row.pump_efficiency_pct),
                    motor_efficiency_pct: row?.motor_efficiency_pct == null ? null : Number(row.motor_efficiency_pct),
                };
                const calculation = (0, pumpSelections_1.calculatePumpSelection)({ flow_m3h: circuit.flow_m3h, design_head_m: row?.design_head_m, pump_efficiency_pct: row?.pump_efficiency_pct, motor_efficiency_pct: row?.motor_efficiency_pct });
                const suitability = (0, pumpSelections_1.evaluateSelectedPumpSuitability)({
                    selectedPump: row?.pump_snapshot, circuitFlowM3h: circuit.flow_m3h,
                    designHeadM: row?.design_head_m, calculation,
                });
                const orphaned = circuit.circuit_kind === 'orphaned';
                const currentFingerprint = (0, pumpSelections_1.pumpSourceFingerprint)(source);
                const versionStale = !!row && row.calculation_version !== pumpSelections_1.PUMP_SELECTION_CALCULATION_VERSION;
                const stale = !!row && (row.source_fingerprint !== currentFingerprint || versionStale);
                const reasons = orphaned
                    ? ['This saved selection references a Flow Route circuit that no longer exists.']
                    : [
                        ...(row && row.source_fingerprint !== currentFingerprint ? ['Flow Route or sizing inputs changed after this pump calculation was saved. Save and calculate again.'] : []),
                        ...(versionStale ? [`Pump sizing calculation version ${row.calculation_version} is outdated; recalculate using ${pumpSelections_1.PUMP_SELECTION_CALCULATION_VERSION}.`] : []),
                        ...(row?.project_equipment_item_id && row?.pump_snapshot ? [] : ['Select a pump assigned to this LSS system.']),
                        ...calculation.reasons,
                        ...suitability.reasons,
                    ];
                return { ...circuit, project_equipment_item_id: row?.project_equipment_item_id || null, selected_pump: row?.pump_snapshot || null,
                    design_head_m: row?.design_head_m ?? null, pump_efficiency_pct: row?.pump_efficiency_pct ?? null, motor_efficiency_pct: row?.motor_efficiency_pct ?? null,
                    source_fingerprint: row?.source_fingerprint || null, current_source_fingerprint: currentFingerprint,
                    freshness: row ? (stale ? 'stale' : 'fresh') : 'unsaved',
                    status: orphaned ? 'stale' : suitability.status === 'incompatible' ? 'incompatible'
                        : stale ? 'stale' : reasons.length ? 'incomplete' : calculation.status, reasons,
                    calculation_version: row?.calculation_version || pumpSelections_1.PUMP_SELECTION_CALCULATION_VERSION,
                    results: row ? (row.result_snapshot?.results || row.result_snapshot || calculation.results) : calculation.results };
            }),
        };
    });
}
async function loadFrictionLossPackages(runner, designBookId, systems) {
    const lifeSupportSystems = systems.filter(isLifeSupportSystem);
    if (!lifeSupportSystems.length)
        return [];
    const savedRows = (await runner(`SELECT c.*, sps.project_equipment_item_id AS current_circuit_pump_id,
            pei.equip_code AS current_equip_code, pei.description AS current_pump_description,
            pm.id AS current_pump_product_master_id,
            pm.product_code AS current_pump_product_code, pm.product_name AS current_pump_product_name,
            pm.manufacturer AS current_pump_manufacturer, pm.model AS current_pump_model
     FROM design_book_friction_loss_calculations c
     LEFT JOIN system_pump_selections sps
       ON sps.system_id=c.system_id AND sps.circuit_key=c.circuit_key
     LEFT JOIN project_equipment_items pei ON pei.id=c.project_equipment_item_id
     LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     WHERE c.design_book_id=$1 AND c.system_id = ANY($2::uuid[])`, [designBookId, lifeSupportSystems.map(system => system.id)])).rows;
    const components = savedRows.length
        ? (await runner(`SELECT fc.*, ppi.piping_code AS current_piping_code, ppi.description AS current_description,
              ppi.quantity AS current_project_quantity, ppi.unit AS current_unit,
              ppi.system_id AS current_system_id, pm.product_code AS current_product_code,
              pm.id AS current_product_master_id, pm.product_name AS current_product_name,
              pm.application_type AS current_application_type
       FROM design_book_friction_loss_components fc
       LEFT JOIN project_piping_items ppi ON ppi.id=fc.project_piping_item_id
       LEFT JOIN product_masters pm ON pm.id=ppi.product_master_id
       WHERE fc.calculation_id = ANY($1::uuid[])
       ORDER BY fc.calculation_id, fc.side, fc.sort_order, fc.id`, [savedRows.map(row => row.id)])).rows
        : [];
    return lifeSupportSystems.map(system => {
        const rows = savedRows.filter(row => row.system_id === system.id);
        const circuitMap = new Map((0, pumpSelections_1.pumpCircuits)(system, system.side_streams || [])
            .map(circuit => [circuit.circuit_key, circuit]));
        rows.forEach(row => {
            if (!circuitMap.has(row.circuit_key)) {
                circuitMap.set(row.circuit_key, {
                    circuit_key: row.circuit_key,
                    circuit_kind: 'orphaned',
                    circuit_name: row.source_snapshot?.circuit?.circuit_name || row.circuit_key,
                    circuit_type: row.source_snapshot?.circuit?.circuit_type || null,
                    parent_loop_number: null,
                    side_stream_id: null,
                    flow_m3h: null,
                });
            }
        });
        return {
            system_id: system.id,
            system,
            items: [...circuitMap.values()].map(circuit => {
                const row = rows.find(value => value.circuit_key === circuit.circuit_key);
                if (!row) {
                    const preview = (0, frictionLossCalculations_1.calculateFrictionLoss)({ flow_m3h: circuit.flow_m3h, components: [] });
                    return {
                        ...circuit,
                        status: 'incomplete',
                        freshness: 'unsaved',
                        reasons: preview.reasons,
                        calculation_version: frictionLossCalculations_1.FRICTION_LOSS_CALCULATION_VERSION,
                        result: preview,
                        components: [],
                        selected_pump: null,
                    };
                }
                const currentPump = row.project_equipment_item_id && row.current_equip_code
                    ? {
                        id: row.project_equipment_item_id,
                        project_equipment_item_id: row.project_equipment_item_id,
                        equip_code: row.current_equip_code,
                        description: row.current_pump_description,
                        product_master_id: row.current_pump_product_master_id,
                        product_code: row.current_pump_product_code,
                        product_name: row.current_pump_product_name,
                        manufacturer: row.current_pump_manufacturer,
                        model: row.current_pump_model,
                    }
                    : null;
                const currentComponents = components.filter(component => component.calculation_id === row.id)
                    .map(component => {
                    const currentSnapshot = component.current_piping_code && component.current_system_id === system.id
                        ? {
                            project_piping_item_id: component.project_piping_item_id,
                            id: component.project_piping_item_id,
                            piping_code: component.current_piping_code,
                            description: component.current_description,
                            project_quantity: component.current_project_quantity,
                            unit: component.current_unit,
                            system_id: component.current_system_id,
                            product_master_id: component.current_product_master_id,
                            product_code: component.current_product_code,
                            product_name: component.current_product_name,
                            application_type: component.current_application_type,
                        }
                        : null;
                    return {
                        project_piping_item_id: component.project_piping_item_id,
                        piping_snapshot: currentSnapshot || component.piping_snapshot,
                        side: component.side,
                        component_kind: component.component_kind,
                        sort_order: component.sort_order,
                        internal_diameter_mm: component.internal_diameter_mm,
                        straight_length_m: component.straight_length_m,
                        material: component.material,
                        absolute_roughness_mm: component.absolute_roughness_mm,
                        fitting_k_value: component.fitting_k_value,
                        quantity: component.quantity,
                        reference_valid: !!currentSnapshot,
                    };
                });
                const currentSource = (0, frictionLossCalculations_1.frictionSourceSnapshot)(circuit, currentPump, currentComponents.map(({ reference_valid, ...item }) => item));
                const currentFingerprint = (0, frictionLossCalculations_1.frictionSourceFingerprint)(currentSource);
                const stale = circuit.circuit_kind === 'orphaned' ||
                    row.calculation_version !== frictionLossCalculations_1.FRICTION_LOSS_CALCULATION_VERSION ||
                    row.source_fingerprint !== currentFingerprint ||
                    !currentPump ||
                    row.current_circuit_pump_id !== row.project_equipment_item_id ||
                    currentComponents.some(component => !component.reference_valid);
                const staleReasons = [
                    ...(circuit.circuit_kind === 'orphaned' ? ['This saved calculation references a Flow Route circuit that no longer exists.'] : []),
                    ...(row.calculation_version !== frictionLossCalculations_1.FRICTION_LOSS_CALCULATION_VERSION ? [`Friction calculation version ${row.calculation_version} is outdated; recalculate using ${frictionLossCalculations_1.FRICTION_LOSS_CALCULATION_VERSION}.`] : []),
                    ...(!currentPump ? ['The selected pump is no longer assigned to this LSS system.'] : []),
                    ...(row.current_circuit_pump_id !== row.project_equipment_item_id
                        ? ['The pump selected for this Flow Route circuit changed after the friction calculation was saved.']
                        : []),
                    ...(currentComponents.some(component => !component.reference_valid) ? ['One or more assigned pipe or fitting items are no longer available for this LSS system.'] : []),
                    ...(row.source_fingerprint !== currentFingerprint && circuit.circuit_kind !== 'orphaned'
                        ? ['Flow Route flow, selected pump, or assigned hydraulic inputs changed after this calculation was saved. Recalculate before review or release.']
                        : []),
                ];
                return {
                    ...circuit,
                    calculation_id: row.id,
                    project_equipment_item_id: row.project_equipment_item_id,
                    selected_pump: row.source_snapshot?.selected_pump || currentPump,
                    components: row.result_snapshot?.components || currentComponents,
                    source_fingerprint: row.source_fingerprint,
                    current_source_fingerprint: currentFingerprint,
                    calculation_version: row.calculation_version,
                    freshness: stale ? 'stale' : 'fresh',
                    status: stale ? 'stale' : String(row.status || '').toLowerCase(),
                    reasons: stale ? staleReasons : (row.result_snapshot?.reasons || []),
                    result: {
                        ...row.result_snapshot,
                        status: stale ? 'stale' : row.result_snapshot?.status,
                        reasons: stale ? staleReasons : (row.result_snapshot?.reasons || []),
                    },
                    calculated_at: row.calculated_at,
                };
            }),
        };
    });
}
async function loadThermalCalculations(runner, designBookId, systems, links, exhibits, tanks, exhibitCalculations) {
    const savedRows = systems.length
        ? (await runner('SELECT * FROM design_book_thermal_calculations WHERE design_book_id=$1 AND system_id = ANY($2::uuid[])', [designBookId, systems.map(system => system.id)])).rows
        : [];
    return systems.map(system => {
        const source = (0, thermalCalculations_1.buildThermalSourceContext)({
            system,
            links: links.filter(link => link.system_id === system.id),
            exhibits,
            tanks,
            exhibitCalculations,
        });
        const saved = savedRows.find(row => row.system_id === system.id) || null;
        const correlationSnapshot = saved?.correlation_snapshot ||
            saved?.result_snapshot?.correlation_snapshot ||
            saved?.input_snapshot?.agitation_correlation_snapshot ||
            null;
        const correlationEvidenceMissing = !!saved &&
            !(0, thermalCalculations_1.isApprovedThermalCorrelationSnapshot)(correlationSnapshot);
        const stale = !!saved && (saved.source_fingerprint !== source.fingerprint ||
            saved.calculation_version !== thermalCalculations_1.THERMAL_CALCULATION_VERSION);
        const preview = (0, thermalCalculations_1.calculateThermalCalculation)(source, saved?.input_snapshot || {});
        const calculation = saved
            ? {
                ...saved.result_snapshot,
                calculation_version: saved.calculation_version,
                calculated_at: saved.calculated_at,
                source_fingerprint: saved.source_fingerprint,
                status: stale || correlationEvidenceMissing ? 'Blocked' : saved.status,
                freshness: stale ? 'stale' : saved.freshness,
                is_stale: stale,
                reasons: correlationEvidenceMissing
                    ? ['Select a current approved shared-library evaporation correlation and recalculate before review or release.']
                    : stale
                        ? ['Linked exhibits, tanks, geometry, or relationships changed since this calculation was saved. Recalculate before review or release.']
                        : (saved.result_snapshot?.reasons || []),
                correlation_snapshot: correlationSnapshot,
            }
            : null;
        return {
            system_id: system.id,
            system,
            source,
            saved,
            calculation,
            current_preview: preview,
            status: stale ? 'Stale' : correlationEvidenceMissing ? 'Blocked' : saved?.status || 'Not configured',
            freshness: stale ? 'stale' : saved?.freshness || 'unsaved',
            source_fingerprint: source.fingerprint,
        };
    });
}
async function insertThermalSnapshotRecord(runner, designBookId, item) {
    const row = item?.saved || item;
    if (!row?.system_id || !row?.calculation_version || !row?.source_fingerprint)
        return;
    await runner(`INSERT INTO design_book_thermal_calculations
       (design_book_id, system_id, calculation_version, status, freshness,
        source_fingerprint, source_snapshot, constants, formula_inputs,
        input_snapshot, result_snapshot, sensitivity_cases, correlation_snapshot,
        deviation_justification, calculated_by, calculated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)`, [
        designBookId,
        row.system_id,
        row.calculation_version,
        row.status || 'Blocked',
        row.freshness === 'stale' ? 'stale' : 'fresh',
        row.source_fingerprint,
        JSON.stringify(row.source_snapshot || item.source || {}),
        JSON.stringify(row.constants || item.calculation?.constants || {}),
        JSON.stringify(row.formula_inputs || item.calculation?.formula_inputs || {}),
        JSON.stringify(row.input_snapshot || item.calculation?.inputs || {}),
        JSON.stringify(row.result_snapshot || item.calculation || {}),
        JSON.stringify(row.sensitivity_cases || item.calculation?.sensitivity_cases || []),
        JSON.stringify(row.correlation_snapshot || item.calculation?.correlation_snapshot ||
            row.input_snapshot?.agitation_correlation_snapshot || {}),
        row.deviation_justification || null,
        row.calculated_by || null,
        row.calculated_at || new Date().toISOString(),
    ]);
}
exports.thermalCalculationTestUtils = {
    insertThermalSnapshotRecord,
};
async function insertFrictionSnapshotRecord(runner, designBookId, systemId, item) {
    if (!item?.circuit_key || !item?.project_equipment_item_id || !item?.source_fingerprint)
        return;
    const sourceSnapshot = item.source_snapshot || {
        circuit: {
            circuit_key: item.circuit_key,
            circuit_kind: item.circuit_kind,
            circuit_name: item.circuit_name,
            circuit_type: item.circuit_type,
            parent_loop_number: item.parent_loop_number,
            side_stream_id: item.side_stream_id,
            flow_m3h: item.flow_m3h,
        },
        selected_pump: item.selected_pump,
        components: item.result?.components || item.components || [],
    };
    const result = await runner(`INSERT INTO design_book_friction_loss_calculations
       (design_book_id, system_id, circuit_key, project_equipment_item_id,
        calculation_version, status, freshness, source_fingerprint,
        source_snapshot, input_snapshot, result_snapshot, calculated_by, calculated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)
     RETURNING id`, [
        designBookId, systemId, item.circuit_key, item.project_equipment_item_id,
        item.calculation_version || frictionLossCalculations_1.FRICTION_LOSS_CALCULATION_VERSION,
        String(item.status || '').toLowerCase() === 'ready' ? 'Ready' : 'Blocked',
        item.freshness === 'stale' ? 'stale' : 'fresh', item.source_fingerprint,
        JSON.stringify(sourceSnapshot),
        JSON.stringify(item.result?.inputs || {
            flow_m3h: item.flow_m3h,
            components: item.result?.components || item.components || [],
        }),
        JSON.stringify(item.result || {}),
        item.calculated_by || null, item.calculated_at || new Date().toISOString(),
    ]);
    const calculationId = result.rows[0]?.id;
    if (!calculationId)
        return;
    for (const [index, component] of (item.result?.components || item.components || []).entries()) {
        await runner(`INSERT INTO design_book_friction_loss_components
         (calculation_id, project_piping_item_id, side, component_kind, sort_order,
          piping_snapshot, internal_diameter_mm, straight_length_m, material,
          absolute_roughness_mm, fitting_k_value, quantity)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`, [
            calculationId, component.project_piping_item_id, component.side,
            component.component_kind, component.sort_order ?? index,
            JSON.stringify(component.piping_snapshot || {}), component.internal_diameter_mm,
            component.straight_length_m, component.material, component.absolute_roughness_mm,
            component.fitting_k_value, component.quantity,
        ]);
    }
}
function nullableSpeciesNumber(value, label, allowZero = false) {
    if (value == null || value === '')
        return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
        throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} number.`);
    }
    return parsed;
}
function nullableSpeciesQuantity(value) {
    if (value == null || value === '')
        return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0)
        throw new Error('Quantity must be a non-negative whole number.');
    return parsed;
}
async function loadCatalogSpecies(id) {
    if (!id)
        return null;
    const result = await (0, index_1.query)('SELECT * FROM aquarium_species_catalog WHERE id=$1', [id]);
    return result.rows[0] || null;
}
function speciesValueSources(row) {
    return {
        ...row,
        avg_size_source: row.avg_size_override_cm != null
            ? 'override'
            : row.catalog_species_id ? 'catalog_snapshot' : 'manual',
        reference_mass_source: row.reference_mass_override_kg != null
            ? 'override'
            : row.catalog_species_id ? 'catalog_snapshot' : row.reference_average_mass_kg != null ? 'manual' : null,
        biomass_source: row.catalog_species_id
            ? row.biomass_override_kg != null ? 'override' : row.biomass_kg != null ? 'calculated' : null
            : row.biomass_kg != null ? 'manual' : null,
    };
}
async function insertAudit(runner, actorId, entityType, entityId, action, details, ipAddress) {
    await runner(`INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6)`, [entityType, entityId, action, actorId, details, ipAddress || null]);
}
function positiveCorrelationCoefficient(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function correlationLibraryRow(row) {
    return {
        id: row.id,
        class_id: row.class_id,
        class_code: row.class_code,
        class_name: row.class_name,
        class_description: row.class_description,
        class_sort_order: row.class_sort_order,
        class_is_active: row.class_is_active,
        version: row.version,
        coefficient_kg_m2_s_kpa: Number(row.coefficient_kg_m2_s_kpa),
        source_reference: row.source_reference || null,
        notes: row.notes || null,
        status: row.status,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        superseded_by: row.superseded_by || null,
        superseded_at: row.superseded_at || null,
        created_at: row.created_at,
        usage_count: Number(row.usage_count || 0),
    };
}
async function resolveThermalCorrelationInputs(runner, rawInputs, capturedAt = new Date().toISOString()) {
    const correlationId = String(rawInputs.agitation_correlation_id || '').trim();
    if (!correlationId) {
        const error = new Error('Select an approved shared-library evaporation correlation before saving.');
        error.status = 400;
        error.code = 'THERMAL_CORRELATION_REQUIRED';
        throw error;
    }
    const result = await runner(`SELECT c.id, c.agitation_class_id AS class_id, c.version,
            c.coefficient_kg_m2_s_kpa, c.source_reference, c.notes,
            c.status, c.approved_by, c.approved_at,
            c.agitation_class_code AS class_code,
            c.agitation_class_name AS class_name,
            c.agitation_class_description AS class_description
     FROM thermal_mass_transfer_correlations c
     JOIN thermal_agitation_classes ac ON ac.id=c.agitation_class_id
     WHERE c.id=$1
     FOR SHARE`, [correlationId]);
    const row = result.rows[0];
    if (!row) {
        const error = new Error('The selected evaporation correlation does not exist.');
        error.status = 400;
        error.code = 'THERMAL_CORRELATION_NOT_FOUND';
        throw error;
    }
    if (row.status !== 'approved') {
        const error = new Error('The selected evaporation correlation has been superseded. Select the current approved version.');
        error.status = 409;
        error.code = 'THERMAL_CORRELATION_SUPERSEDED';
        throw error;
    }
    const deviation = rawInputs.agitation_correlation_deviation === true;
    const justification = String(rawInputs.deviation_justification || '').trim();
    if (deviation && !justification) {
        const error = new Error('A project-specific correlation deviation requires a justification.');
        error.status = 400;
        error.code = 'THERMAL_CORRELATION_DEVIATION_JUSTIFICATION_REQUIRED';
        throw error;
    }
    const libraryCoefficient = positiveCorrelationCoefficient(row.coefficient_kg_m2_s_kpa);
    const effectiveCoefficient = deviation
        ? positiveCorrelationCoefficient(rawInputs.evaporation_coefficient_kg_m2_s_kpa)
        : libraryCoefficient;
    if (effectiveCoefficient == null) {
        const error = new Error('A project-specific correlation deviation requires a positive mass-transfer coefficient.');
        error.status = 400;
        error.code = 'THERMAL_CORRELATION_DEVIATION_COEFFICIENT_REQUIRED';
        throw error;
    }
    const snapshot = {
        source: deviation ? 'project_deviation' : 'shared_library',
        correlation_id: row.id,
        class_id: row.class_id,
        agitation_class: row.class_code,
        agitation_class_name: row.class_name,
        agitation_class_description: row.class_description || null,
        version: row.version,
        coefficient_kg_m2_s_kpa: libraryCoefficient,
        effective_coefficient_kg_m2_s_kpa: effectiveCoefficient,
        approved: true,
        deviation,
        deviation_justification: deviation ? justification : null,
        source_reference: row.source_reference || null,
        notes: row.notes || null,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        captured_at: capturedAt,
    };
    return {
        ...rawInputs,
        agitation_class: row.class_code,
        agitation_correlation_class: row.class_code,
        agitation_correlation_version: row.version,
        agitation_correlation_approved: true,
        agitation_correlation_deviation: deviation,
        evaporation_coefficient_kg_m2_s_kpa: effectiveCoefficient,
        deviation_justification: deviation ? justification : '',
        agitation_correlation_snapshot: snapshot,
    };
}
exports.thermalCorrelationTestUtils = {
    resolveThermalCorrelationInputs,
};
async function loadReleaseContext(id, runner = index_1.query, lock = false, liveOnly = false) {
    const bookResult = await runner(`SELECT db.*, p.project_scopes, p.project_code, p.project_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     WHERE db.id = $1${lock ? ' FOR UPDATE OF db' : ''}`, [id]);
    const book = bookResult.rows[0];
    if (!book)
        return null;
    let exhibits = [];
    let tanks = [];
    let systems = [];
    if (book.project_id) {
        const exhibitResult = await runner('SELECT * FROM exhibits WHERE project_id=$1 ORDER BY exhibit_code', [book.project_id]);
        const tankResult = await runner(`SELECT t.*,
         t.gross_volume_m3 AS project_gross_volume_m3,
         t.operating_volume_m3 AS project_operating_volume_m3,
         pm.operating_volume_m3 AS pim_operating_volume_m3,
         pm.product_code AS pim_product_code,
         pm.product_name AS pim_product_name,
         tf.name AS pim_tank_family_name,
         COALESCE(t.tank_type, pm.application_type) AS eff_tank_type,
         COALESCE(t.shape_type, pm.shape_type) AS eff_shape,
         COALESCE(t.length_mm, pm.length_mm) AS eff_length_mm,
         COALESCE(t.width_mm, pm.width_mm) AS eff_width_mm,
         COALESCE(t.height_mm, pm.height_mm) AS eff_height_mm,
         COALESCE(t.design_water_level_mm, pm.design_water_level_mm) AS eff_water_level_mm,
         COALESCE(t.primary_material, pm.primary_material_code) AS eff_primary_material,
         COALESCE(t.notes, pm.notes) AS eff_notes,
         COALESCE(t.gross_volume_m3, pm.gross_volume_m3) AS gross_volume_m3,
         COALESCE(t.operating_volume_m3, pm.operating_volume_m3) AS design_volume_m3,
         COALESCE(
           t.surface_area_m2,
           pm.surface_area_m2,
           CASE
             WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                  AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) / 1000000.0)::numeric, 4)
             WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                  AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                  AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)/1000000.0)::numeric, 4)
             ELSE NULL
           END
         ) AS surface_area_m2
       FROM tanks t
       LEFT JOIN product_masters pm ON pm.id=t.product_master_id
       LEFT JOIN tank_families tf ON tf.id=pm.tank_family_id
       WHERE t.project_id=$1
       ORDER BY t.tank_code`, [book.project_id]);
        const systemResult = await runner('SELECT * FROM systems WHERE project_id=$1 ORDER BY system_code', [book.project_id]);
        exhibits = exhibitResult.rows;
        tanks = tankResult.rows;
        systems = await attachSystemSideStreams(runner, systemResult.rows);
    }
    const speciesResult = await runner(`SELECT s.*, c.family AS catalog_family, c.water_type AS catalog_water_type,
            c.active AS catalog_active
     FROM design_book_exhibit_species s
     LEFT JOIN aquarium_species_catalog c ON c.id=s.catalog_species_id
     WHERE s.design_book_id=$1 ORDER BY s.exhibit_id, s.sort_order`, [id]);
    const hydraulicsResult = await runner('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1', [id]);
    const substrateResult = await runner('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1', [id]);
    const species = speciesResult.rows.map(speciesValueSources);
    const hydraulics = hydraulicsResult.rows;
    const substrate = substrateResult.rows;
    const handovers = (await runner(`SELECT h.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_review_handovers h
     LEFT JOIN users u ON u.id=h.created_by
     WHERE h.design_book_id=$1
     ORDER BY h.meeting_date DESC, h.created_at DESC`, [id])).rows;
    const calculatedAt = new Date().toISOString();
    const exhibitCalculations = exhibits.map(exhibit => (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, tanks.filter(tank => tank.exhibit_id === exhibit.id), hydraulics.find(record => record.exhibit_id === exhibit.id), substrate.find(record => record.exhibit_id === exhibit.id), calculatedAt));
    let links = [];
    let biologicalMediaCases = [];
    let biologicalMediaRuns = [];
    if (systems.length) {
        const linksResult = await runner('SELECT sel.*, e.exhibit_code FROM system_exhibit_links sel LEFT JOIN exhibits e ON e.id=sel.exhibit_id WHERE sel.system_id = ANY($1::uuid[])', [systems.map(system => system.id)]);
        links = linksResult.rows;
        biologicalMediaCases = (await runner(`SELECT c.*, mp.profile_code AS media_profile_code, mp.profile_name AS media_profile_name,
              mp.revision AS media_profile_revision, mp.status AS media_profile_status,
              tp.profile_code AS tan_profile_code, tp.profile_name AS tan_profile_name,
               tp.revision AS tan_profile_revision, tp.status AS tan_profile_status,
               mt.profile_code AS max_tan_profile_code, mt.profile_name AS max_tan_profile_name,
               mt.revision AS max_tan_profile_revision, mt.status AS max_tan_profile_status,
               mt.engineering_note AS max_tan_profile_engineering_note
       FROM lss_biological_media_cases c
       LEFT JOIN lss_biological_media_profiles mp ON mp.id=c.media_profile_revision_id
       LEFT JOIN lss_tan_generation_profiles tp ON tp.id=c.tan_generation_profile_revision_id
        LEFT JOIN lss_max_tan_profiles mt ON mt.id=c.max_tan_profile_revision_id
       WHERE c.design_book_id=$1 AND c.system_id = ANY($2::uuid[])`, [id, systems.map(system => system.id)])).rows;
        if (biologicalMediaCases.length) {
            const biologicalSpecies = (await runner(`SELECT * FROM lss_biological_media_species
         WHERE case_id = ANY($1::uuid[]) ORDER BY case_id, sort_order, id`, [biologicalMediaCases.map(item => item.id)])).rows;
            biologicalMediaCases = biologicalMediaCases.map(item => ({
                ...item,
                species_rows: biologicalSpecies.filter(row => row.case_id === item.id),
            }));
            biologicalMediaRuns = (await runner(`SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name,
                au.first_name || ' ' || au.last_name AS approved_by_name
         FROM lss_biological_media_runs r
         LEFT JOIN users u ON u.id=r.created_by
         LEFT JOIN users au ON au.id=r.approved_by
         WHERE r.case_id = ANY($1::uuid[])
         ORDER BY r.case_id, r.run_number DESC`, [biologicalMediaCases.map(item => item.id)])).rows;
        }
    }
    const compactUnitIds = systems.map(system => system.compact_unit_id).filter(Boolean);
    const compactUnits = compactUnitIds.length
        ? (await runner(`SELECT lcu.*,
          COALESCE((
            SELECT json_agg(e ORDER BY e.sort_order, e.created_at, e.id)
            FROM lss_compact_unit_equipment e
            WHERE e.compact_unit_id=lcu.id
          ), '[]'::json) AS equipment
       FROM lss_compact_units lcu
       WHERE lcu.id = ANY($1::uuid[])`, [compactUnitIds])).rows
        : [];
    const systemCalculations = systems.map(system => (0, aquariumCalculations_1.calculateSystemEngineering)(system, links.filter(link => link.system_id === system.id), exhibitCalculations, compactUnits.find(unit => unit.id === system.compact_unit_id) || null, calculatedAt, system.side_streams || [], system.fractionator_allocations || []));
    const currentSystems = systems.map(system => {
        const calculation = systemCalculations.find(item => item.inputs.system_id === system.id);
        return {
            ...system,
            stored_design_flow_m3h: system.design_flow_m3h,
            design_flow_m3h: calculation?.results.design_flow_m3h ?? null,
            design_flow_source: calculation?.inputs.design_flow_source || 'linked_exhibits',
        };
    });
    const thermalCalculations = await loadThermalCalculations(runner, id, currentSystems.filter(isLifeSupportSystem), links, exhibits, tanks, exhibitCalculations);
    const pumpSelections = await loadPumpSelections(runner, currentSystems);
    const frictionLossCalculations = await loadFrictionLossPackages(runner, id, currentSystems);
    const liveContext = {
        ...book,
        exhibits,
        tanks,
        systems: currentSystems,
        compact_units: compactUnits,
        system_links: links,
        species,
        hydraulics,
        substrate,
        review_handovers: handovers,
        biological_media_cases: biologicalMediaCases,
        biological_media_runs: biologicalMediaRuns,
        thermal_calculations: thermalCalculations,
        thermal_construction_defaults: thermalCalculations_1.THERMAL_CONSTRUCTION_DEFAULTS,
        pump_selections: pumpSelections,
        friction_loss_calculations: frictionLossCalculations,
        engineering_calculations: {
            calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            calculated_at: calculatedAt,
            exhibits: exhibitCalculations,
            systems: systemCalculations,
        },
    };
    if (!liveOnly && ['For Review', 'Approved'].includes(book.status) && book.review_snapshot) {
        return {
            ...book.review_snapshot,
            id: book.id,
            book_code: book.book_code,
            book_title: book.book_title,
            revision: book.revision,
            status: book.status,
            review_submitted_by: book.review_submitted_by,
            review_submitted_at: book.review_submitted_at,
            approved_by: book.approved_by,
            approved_at: book.approved_at,
            approval_notes: book.approval_notes,
            review_snapshot: book.review_snapshot,
        };
    }
    return liveContext;
}
async function ensureBookEditable(id, res) {
    const result = await (0, index_1.query)('SELECT status FROM design_books WHERE id=$1', [id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        return false;
    }
    if (!(0, designBookWorkflow_1.isDesignBookContentEditable)(result.rows[0].status)) {
        res.status(409).json({
            error: {
                code: 'DESIGN_BOOK_NOT_EDITABLE',
                message: 'Design Books are read-only while under review, approved, or released. Create a new revision or return to design before editing.',
            },
        });
        return false;
    }
    return true;
}
const thermalCorrelationUsageRowsCte = `
  WITH thermal_correlation_usage_rows AS (
    SELECT
      db.id AS design_book_id,
      db.status AS design_book_status,
      db.book_code,
      db.book_title,
      db.revision,
      db.project_id,
      p.project_code,
      p.project_name,
      calc.system_id::text AS system_id,
      s.system_code,
      s.system_name,
      COALESCE(
        NULLIF(calc.correlation_snapshot->>'correlation_id', ''),
        NULLIF(calc.result_snapshot->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(calc.input_snapshot->'agitation_correlation_snapshot'->>'correlation_id', '')
      ) AS correlation_id,
      COALESCE(
        NULLIF(calc.correlation_snapshot->>'captured_at', ''),
        NULLIF(calc.result_snapshot->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(calc.input_snapshot->'agitation_correlation_snapshot'->>'captured_at', ''),
        calc.calculated_at::text
      ) AS captured_at
    FROM design_books db
    JOIN design_book_thermal_calculations calc ON calc.design_book_id=db.id
    LEFT JOIN projects p ON p.id=db.project_id
    LEFT JOIN systems s ON s.id=calc.system_id
    WHERE db.status IN ('Draft', 'In Progress')

    UNION ALL

    SELECT
      db.id AS design_book_id,
      db.status AS design_book_status,
      db.book_code,
      db.book_title,
      db.revision,
      db.project_id,
      p.project_code,
      p.project_name,
      item->>'system_id' AS system_id,
      item->'system'->>'system_code' AS system_code,
      item->'system'->>'system_name' AS system_name,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'correlation_id', '')
      ) AS correlation_id,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'captured_at', ''),
        db.updated_at::text
      ) AS captured_at
    FROM design_books db
    LEFT JOIN projects p ON p.id=db.project_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(db.review_snapshot->'thermal_calculations') = 'array'
          THEN db.review_snapshot->'thermal_calculations'
        ELSE '[]'::jsonb
      END
    ) AS item
    WHERE db.status IN ('For Review', 'Approved')

    UNION ALL

    SELECT
      db.id AS design_book_id,
      db.status AS design_book_status,
      db.book_code,
      db.book_title,
      db.revision,
      db.project_id,
      p.project_code,
      p.project_name,
      item->>'system_id' AS system_id,
      item->'system'->>'system_code' AS system_code,
      item->'system'->>'system_name' AS system_name,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'correlation_id', '')
      ) AS correlation_id,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'captured_at', ''),
        db.updated_at::text
      ) AS captured_at
    FROM design_books db
    LEFT JOIN projects p ON p.id=db.project_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(db.release_snapshot->'thermal_calculations') = 'array'
          THEN db.release_snapshot->'thermal_calculations'
        ELSE '[]'::jsonb
      END
    ) AS item
    WHERE db.status='Released'
  ),
  thermal_correlation_usage_counts AS (
    SELECT correlation_id, COUNT(*)::int AS usage_count
    FROM thermal_correlation_usage_rows
    WHERE correlation_id IS NOT NULL
    GROUP BY correlation_id
  )
`;
const thermalCorrelationUsagesSelect = `
${thermalCorrelationUsageRowsCte}
  SELECT design_book_id, design_book_status, book_code, book_title, revision,
         project_id, project_code, project_name, system_id, system_code,
         system_name, correlation_id, captured_at
  FROM thermal_correlation_usage_rows
  WHERE correlation_id=$1
  ORDER BY
    CASE design_book_status
      WHEN 'Draft' THEN 1
      WHEN 'In Progress' THEN 2
      WHEN 'For Review' THEN 3
      WHEN 'Approved' THEN 4
      WHEN 'Released' THEN 5
      ELSE 6
    END,
    COALESCE(project_name, ''),
    COALESCE(book_code, ''),
    COALESCE(system_code, ''),
    captured_at DESC`;
async function lockAndReloadThermalCorrelationUsages(runner, correlationId) {
    const initial = await runner(thermalCorrelationUsagesSelect, [correlationId]);
    const designBookIds = [...new Set(initial.rows.map(usage => String(usage.design_book_id || '')).filter(Boolean))];
    if (designBookIds.length) {
        await runner(`SELECT id FROM design_books
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR SHARE`, [designBookIds]);
    }
    return (await runner(thermalCorrelationUsagesSelect, [correlationId])).rows;
}
function thermalCorrelationImpactToken(correlationId, usages) {
    const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
    if (!secret)
        throw new Error('SESSION_SECRET or JWT_SECRET is required for thermal correlation impact confirmation.');
    const fingerprint = crypto_1.default.createHash('sha256').update(JSON.stringify(usages.map(usage => ({
        design_book_id: usage.design_book_id,
        design_book_status: usage.design_book_status,
        project_id: usage.project_id,
        system_id: usage.system_id,
        captured_at: usage.captured_at,
    })))).digest('hex');
    const signature = crypto_1.default.createHmac('sha256', secret)
        .update(`${correlationId}.${fingerprint}`)
        .digest('hex');
    return `${fingerprint}.${signature}`;
}
function thermalCorrelationImpactConfirmed(correlationId, usages, token) {
    const expected = thermalCorrelationImpactToken(correlationId, usages);
    const supplied = String(token || '');
    if (supplied.length !== expected.length)
        return false;
    return crypto_1.default.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
function sendThermalCorrelationImpactChanged(res) {
    return res.status(409).json({
        error: {
            code: 'THERMAL_CORRELATION_IMPACT_CHANGED',
            message: 'Correlation usage changed or has not been confirmed. Reopen the usage view before superseding.',
        },
    });
}
const thermalCorrelationLibrarySelect = `
${thermalCorrelationUsageRowsCte}
  SELECT c.id, c.agitation_class_id AS class_id,
         c.agitation_class_code AS class_code,
         c.agitation_class_name AS class_name,
         c.agitation_class_description AS class_description,
         ac.sort_order AS class_sort_order, ac.is_active AS class_is_active,
         c.version, c.coefficient_kg_m2_s_kpa, c.source_reference, c.notes,
          c.status, c.approved_by, c.approved_at,
          c.superseded_by, c.superseded_at, c.created_at,
          COALESCE(uc.usage_count, 0)::int AS usage_count
   FROM thermal_mass_transfer_correlations c
   JOIN thermal_agitation_classes ac ON ac.id=c.agitation_class_id
   LEFT JOIN thermal_correlation_usage_counts uc ON uc.correlation_id=c.id::text`;
router.get('/thermal-correlations', async (_req, res) => {
    const [classes, result] = await Promise.all([
        (0, index_1.query)(`SELECT id, class_code, class_name, description, sort_order, is_active, created_at, updated_at
       FROM thermal_agitation_classes
       ORDER BY sort_order, class_name`),
        (0, index_1.query)(`${thermalCorrelationLibrarySelect}
       ORDER BY ac.sort_order, c.agitation_class_name, c.approved_at DESC, c.created_at DESC`),
    ]);
    res.json({ classes: classes.rows, items: result.rows.map(correlationLibraryRow) });
});
router.get('/thermal-correlations/versions/:versionId/usages', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const correlationResult = await client.query(`${thermalCorrelationLibrarySelect} WHERE c.id=$1`, [req.params.versionId]);
        if (!correlationResult.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: { code: 'THERMAL_CORRELATION_NOT_FOUND', message: 'Thermal correlation version not found.' },
            });
        }
        const usages = await client.query(thermalCorrelationUsagesSelect, [req.params.versionId]);
        await client.query('COMMIT');
        res.json({
            correlation: correlationLibraryRow(correlationResult.rows[0]),
            usages: usages.rows,
            impact_token: thermalCorrelationImpactToken(routeParam(req.params.versionId), usages.rows),
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/thermal-correlations/classes', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const classCode = String(req.body.class_code || '').trim();
    const className = String(req.body.class_name || '').trim();
    if (!classCode || !className) {
        return res.status(400).json({
            error: { code: 'THERMAL_CLASS_REQUIRED', message: 'Class code and class name are required.' },
        });
    }
    try {
        const result = await (0, index_1.query)(`INSERT INTO thermal_agitation_classes
           (class_code, class_name, description, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`, [
            classCode,
            className,
            String(req.body.description || '').trim() || null,
            Number.isInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0,
            req.user.id,
        ]);
        await insertAudit(index_1.query, req.user.id, 'thermal_agitation_class', result.rows[0].id, 'CREATE', {
            summary: `Thermal agitation class ${classCode} created`,
        }, req.ip);
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        if (error?.code === '23505') {
            return res.status(409).json({
                error: { code: 'THERMAL_CLASS_EXISTS', message: 'That agitation class code already exists.' },
            });
        }
        throw error;
    }
});
router.put('/thermal-correlations/classes/:classId', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const classCode = String(req.body.class_code || '').trim();
    const className = String(req.body.class_name || '').trim();
    if (!classCode || !className) {
        return res.status(400).json({
            error: { code: 'THERMAL_CLASS_REQUIRED', message: 'Class code and class name are required.' },
        });
    }
    const result = await (0, index_1.query)(`UPDATE thermal_agitation_classes
       SET class_code=$1, class_name=$2, description=$3, sort_order=$4,
           is_active=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING *`, [
        classCode,
        className,
        String(req.body.description || '').trim() || null,
        Number.isInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0,
        req.body.is_active !== false,
        req.params.classId,
    ]);
    if (!result.rows[0]) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agitation class not found.' } });
    }
    await insertAudit(index_1.query, req.user.id, 'thermal_agitation_class', result.rows[0].id, 'UPDATE', {
        summary: `Thermal agitation class ${classCode} updated; existing correlation versions remain unchanged`,
    }, req.ip);
    res.json(result.rows[0]);
});
router.post('/thermal-correlations/classes/:classId/versions', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const version = String(req.body.version || '').trim();
    const coefficient = positiveCorrelationCoefficient(req.body.coefficient_kg_m2_s_kpa);
    const sourceReference = String(req.body.source_reference || '').trim();
    if (!version || coefficient == null || !sourceReference) {
        return res.status(400).json({
            error: {
                code: 'THERMAL_CORRELATION_REQUIRED',
                message: 'Version, positive mass-transfer coefficient, and source reference are required.',
            },
        });
    }
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN');
        const classResult = await client.query('SELECT * FROM thermal_agitation_classes WHERE id=$1 AND is_active=true FOR UPDATE', [req.params.classId]);
        const agitationClass = classResult.rows[0];
        if (!agitationClass) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Active agitation class not found.' },
            });
        }
        const currentApproved = await client.query(`SELECT id FROM thermal_mass_transfer_correlations
         WHERE agitation_class_id=$1 AND status='approved'
         FOR UPDATE`, [agitationClass.id]);
        if (currentApproved.rows[0]) {
            const usages = await lockAndReloadThermalCorrelationUsages(client.query.bind(client), currentApproved.rows[0].id);
            if (!thermalCorrelationImpactConfirmed(currentApproved.rows[0].id, usages, req.body.impact_token)) {
                await client.query('ROLLBACK');
                return sendThermalCorrelationImpactChanged(res);
            }
        }
        await client.query(`UPDATE thermal_mass_transfer_correlations
         SET status='superseded', superseded_by=$1, superseded_at=NOW()
         WHERE agitation_class_id=$2 AND status='approved'`, [req.user.id, agitationClass.id]);
        const inserted = await client.query(`INSERT INTO thermal_mass_transfer_correlations
           (agitation_class_id, agitation_class_code, agitation_class_name,
            agitation_class_description, version, coefficient_kg_m2_s_kpa,
            source_reference, notes, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`, [
            agitationClass.id,
            agitationClass.class_code,
            agitationClass.class_name,
            agitationClass.description,
            version,
            coefficient,
            sourceReference,
            String(req.body.notes || '').trim() || null,
            req.user.id,
        ]);
        await insertAudit(client.query.bind(client), req.user.id, 'thermal_correlation', inserted.rows[0].id, 'APPROVE_VERSION', {
            summary: `${agitationClass.class_code} correlation ${version} approved`,
            agitation_class_id: agitationClass.id,
            coefficient_kg_m2_s_kpa: coefficient,
            source_reference: sourceReference,
        }, req.ip);
        await client.query('COMMIT');
        const response = await (0, index_1.query)(`${thermalCorrelationLibrarySelect} WHERE c.id=$1`, [inserted.rows[0].id]);
        res.status(201).json(correlationLibraryRow(response.rows[0]));
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') {
            return res.status(409).json({
                error: { code: 'THERMAL_CORRELATION_VERSION_EXISTS', message: 'That version already exists for this agitation class.' },
            });
        }
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/thermal-correlations/versions/:versionId/supersede', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const client = await index_1.default.connect();
    try {
        // Read committed is intentional: after the exclusive correlation lock is
        // acquired, the usage query must see any thermal save that committed
        // while this transaction was waiting for that lock.
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const current = await client.query(`SELECT id FROM thermal_mass_transfer_correlations
         WHERE id=$1 AND status='approved'
         FOR UPDATE`, [req.params.versionId]);
        if (!current.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: { code: 'THERMAL_CORRELATION_NOT_APPROVED', message: 'Approved correlation version not found.' },
            });
        }
        const usages = await lockAndReloadThermalCorrelationUsages(client.query.bind(client), routeParam(req.params.versionId));
        if (!thermalCorrelationImpactConfirmed(routeParam(req.params.versionId), usages, req.body.impact_token)) {
            await client.query('ROLLBACK');
            return sendThermalCorrelationImpactChanged(res);
        }
        const result = await client.query(`UPDATE thermal_mass_transfer_correlations
         SET status='superseded', superseded_by=$1, superseded_at=NOW()
         WHERE id=$2 AND status='approved'
         RETURNING *`, [req.user.id, req.params.versionId]);
        await insertAudit(client.query.bind(client), req.user.id, 'thermal_correlation', result.rows[0].id, 'SUPERSEDE', {
            summary: `Thermal correlation ${result.rows[0].version} superseded`,
            reason: String(req.body.reason || '').trim() || null,
            confirmed_usage_count: usages.length,
        }, req.ip);
        await client.query('COMMIT');
        res.json(result.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.get('/design-books/:id/thermal', auth_1.authenticate, async (req, res) => {
    const frozen = await (0, index_1.query)('SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1', [req.params.id]);
    if (!frozen.rows[0]) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    }
    const book = frozen.rows[0];
    if (book.status === 'Released' && book.release_snapshot) {
        return res.json({ items: book.release_snapshot.thermal_calculations || [], frozen: true });
    }
    if (['For Review', 'Approved'].includes(book.status) && book.review_snapshot) {
        return res.json({ items: book.review_snapshot.thermal_calculations || [], frozen: true });
    }
    const context = await loadReleaseContext(routeParam(req.params.id), index_1.query, false, true);
    res.json({ items: context?.thermal_calculations || [], frozen: false });
});
async function saveThermalCalculation(req, res) {
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true, true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (!(0, designBookWorkflow_1.isDesignBookContentEditable)(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: {
                    code: 'DESIGN_BOOK_NOT_EDITABLE',
                    message: 'Thermal calculations are read-only while the Design Book is under review, approved, or released.',
                },
            });
        }
        const item = (context.thermal_calculations || []).find((candidate) => candidate.system_id === req.params.systemId);
        if (!item) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: { code: 'INVALID_SYSTEM', message: 'The selected LSS system does not belong to this Design Book project.' },
            });
        }
        const requestedInputs = req.body?.inputs && typeof req.body.inputs === 'object'
            ? req.body.inputs
            : req.body || {};
        const calculatedAt = new Date().toISOString();
        const inputs = await resolveThermalCorrelationInputs(client.query.bind(client), requestedInputs, calculatedAt);
        const calculation = (0, thermalCalculations_1.calculateThermalCalculation)(item.source, inputs, calculatedAt);
        const saved = await client.query(`INSERT INTO design_book_thermal_calculations
         (design_book_id, system_id, calculation_version, status, freshness,
          source_fingerprint, source_snapshot, constants, formula_inputs,
          input_snapshot, result_snapshot, sensitivity_cases, correlation_snapshot,
          deviation_justification, calculated_by, calculated_at)
       VALUES ($1,$2,$3,$4,'fresh',$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)
       ON CONFLICT (design_book_id, system_id)
       DO UPDATE SET
         calculation_version=EXCLUDED.calculation_version,
         status=EXCLUDED.status,
         freshness='fresh',
         source_fingerprint=EXCLUDED.source_fingerprint,
         source_snapshot=EXCLUDED.source_snapshot,
         constants=EXCLUDED.constants,
         formula_inputs=EXCLUDED.formula_inputs,
         input_snapshot=EXCLUDED.input_snapshot,
         result_snapshot=EXCLUDED.result_snapshot,
         sensitivity_cases=EXCLUDED.sensitivity_cases,
         correlation_snapshot=EXCLUDED.correlation_snapshot,
         deviation_justification=EXCLUDED.deviation_justification,
         calculated_by=EXCLUDED.calculated_by,
         calculated_at=EXCLUDED.calculated_at,
         updated_at=NOW()
       RETURNING *`, [
            req.params.id,
            req.params.systemId,
            calculation.calculation_version,
            calculation.status,
            calculation.source_fingerprint,
            JSON.stringify(calculation.source_snapshot),
            JSON.stringify(calculation.constants),
            JSON.stringify(calculation.formula_inputs),
            JSON.stringify(calculation.inputs),
            JSON.stringify(calculation),
            JSON.stringify(calculation.sensitivity_cases),
            JSON.stringify(calculation.correlation_snapshot || {}),
            String(calculation.inputs.deviation_justification || '').trim() || null,
            req.user.id,
            calculation.calculated_at,
        ]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'THERMAL_CALCULATED', {
            summary: `${item.system.system_code || item.system.system_name} thermal calculation saved`,
            system_id: req.params.systemId,
            calculation_version: calculation.calculation_version,
            calculation_status: calculation.status,
            source_fingerprint: calculation.source_fingerprint,
            correlation_id: calculation.correlation_snapshot?.correlation_id || null,
            correlation_version: calculation.correlation_snapshot?.version || null,
            correlation_deviation: calculation.correlation_snapshot?.deviation || false,
            water_temperature_basis: calculation.water_temperature_basis,
            wall_construction_basis: calculation.wall_construction_basis,
            deviation_justification: String(calculation.inputs.deviation_justification || '').trim() || null,
        }, req.ip);
        await client.query('COMMIT');
        res.json({
            ...item,
            saved: saved.rows[0],
            calculation,
            current_preview: calculation,
            status: calculation.status,
            freshness: 'fresh',
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
router.post('/design-books/:id/thermal/:systemId/calculate', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), saveThermalCalculation);
router.put('/design-books/:id/thermal/:systemId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), saveThermalCalculation);
router.get('/design-books', auth_1.authenticate, async (req, res) => {
    const q = req.query.q;
    const projectId = req.query.project_id;
    const params = [];
    const filters = [];
    if (q) {
        params.push(`%${q}%`);
        filters.push(`(db.book_code ILIKE $${params.length} OR db.book_title ILIKE $${params.length} OR p.project_name ILIKE $${params.length})`);
    }
    if (projectId) {
        params.push(projectId);
        filters.push(`db.project_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await (0, index_1.query)(`SELECT db.*, p.project_code, p.project_name, p.client_name,
       u.first_name || ' ' || u.last_name as created_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
     ${where}
     ORDER BY db.created_at DESC`, params);
    res.json({ items: result.rows });
});
router.get('/design-books/:id', auth_1.authenticate, async (req, res) => {
    const book = await (0, index_1.query)(`SELECT db.*, p.project_code, p.project_name, p.client_name, p.site_name, p.country, p.project_scopes,
       u.first_name || ' ' || u.last_name as created_by_name,
       ru.first_name || ' ' || ru.last_name as released_by_name,
       su.first_name || ' ' || su.last_name as review_submitted_by_name,
       au.first_name || ' ' || au.last_name as approved_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
     LEFT JOIN users ru ON db.released_by = ru.id
     LEFT JOIN users su ON db.review_submitted_by = su.id
     LEFT JOIN users au ON db.approved_by = au.id
     WHERE db.id = $1`, [req.params.id]);
    if (!book.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const row = book.rows[0];
    let exhibits = [];
    let tanks = [];
    let systems = [];
    let species = [];
    if (row.project_id) {
        const exResult = await (0, index_1.query)(`SELECT e.*, a.area_name, a.area_code
       FROM exhibits e
       LEFT JOIN areas a ON e.area_id = a.id
       WHERE e.project_id = $1
       ORDER BY a.area_code, e.exhibit_code`, [row.project_id]);
        exhibits = exResult.rows;
        const tkResult = await (0, index_1.query)(`SELECT t.*,
        t.gross_volume_m3 as project_gross_volume_m3,
        t.operating_volume_m3 as project_operating_volume_m3,
        pm.operating_volume_m3 as pim_operating_volume_m3,
        e.exhibit_name, e.water_type as exhibit_water_type,
        s.system_code, s.system_name,
        pm.product_code, pm.product_name as product_name,
         pm.product_code as pim_product_code,
         pm.product_name as pim_product_name,
         tf.name as pim_tank_family_name,
         COALESCE(t.tank_type, pm.application_type) as eff_tank_type,
         COALESCE(t.primary_material, pm.primary_material_code) as eff_primary_material,
         COALESCE(t.notes, pm.notes) as eff_notes,
        promoted_pm.id as promoted_product_master_id,
        promoted_pm.product_code as promoted_product_code,
        mat.material_code, mat.material_name,
        COALESCE(t.shape_type, pm.shape_type) as eff_shape,
        COALESCE(t.length_mm, pm.length_mm) as eff_length_mm,
        COALESCE(t.width_mm, pm.width_mm) as eff_width_mm,
        COALESCE(t.height_mm, pm.height_mm) as eff_height_mm,
        COALESCE(t.design_water_level_mm, pm.design_water_level_mm) as eff_water_level_mm,
        COALESCE(
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.height_mm, pm.height_mm) / 1000000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0)::numeric, 4)
            ELSE NULL
          END,
          t.gross_volume_m3, pm.gross_volume_m3
        ) as gross_volume_m3,
        COALESCE(
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.design_water_level_mm, pm.design_water_level_mm) / 1000000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0)::numeric, 4)
            ELSE NULL
          END,
          t.operating_volume_m3, pm.operating_volume_m3
        ) as design_volume_m3,
        COALESCE(
          t.surface_area_m2,
          pm.surface_area_m2,
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) / 1000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)/1000000.0)::numeric, 4)
            ELSE NULL
          END
        ) as surface_area_m2
       FROM tanks t
       LEFT JOIN exhibits e ON t.exhibit_id = e.id
       LEFT JOIN systems s ON t.system_id = s.id
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
        LEFT JOIN tank_families tf ON tf.id = pm.tank_family_id
       LEFT JOIN product_masters promoted_pm ON promoted_pm.source_tank_id = t.id
       LEFT JOIN materials mat ON t.material_id = mat.id
       WHERE t.project_id = $1
       ORDER BY e.exhibit_code NULLS LAST, t.sort_order, t.tank_code`, [row.project_id]);
        tanks = tkResult.rows;
        const sysResult = await (0, index_1.query)(`SELECT s.*,
         e.exhibit_code, e.exhibit_name,
         a.area_code, a.area_name,
         (SELECT COUNT(*) FROM equipment_instances ei WHERE ei.system_id = s.id) as equipment_count
       FROM systems s
       LEFT JOIN exhibits e ON s.exhibit_id = e.id
       LEFT JOIN areas a ON s.area_id = a.id
       WHERE s.project_id = $1
       ORDER BY a.area_code NULLS LAST, e.exhibit_code NULLS LAST, s.system_code`, [row.project_id]);
        systems = await attachSystemSideStreams(index_1.query, sysResult.rows);
    }
    const speciesResult = await (0, index_1.query)(`SELECT s.*, c.family AS catalog_family, c.water_type AS catalog_water_type,
            c.active AS catalog_active
     FROM design_book_exhibit_species s
     LEFT JOIN aquarium_species_catalog c ON c.id=s.catalog_species_id
     WHERE s.design_book_id = $1 ORDER BY s.exhibit_id, s.sort_order, s.species_name`, [req.params.id]);
    species = speciesResult.rows.map(speciesValueSources);
    const hydraulicsResult = await (0, index_1.query)(`SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id = $1`, [req.params.id]);
    const hydraulics = hydraulicsResult.rows;
    const substrateResult = await (0, index_1.query)(`SELECT * FROM design_book_exhibit_substrate WHERE design_book_id = $1`, [req.params.id]);
    const substrate = substrateResult.rows;
    // All design-book hydraulic and LSS values are calculated here from the
    // current project inputs.  Consumers receive the inputs and policy along
    // with the values, so they do not need to reproduce engineering formulas.
    const calculationTimestamp = new Date().toISOString();
    const exhibitCalculations = exhibits.map(exhibit => {
        const hydraulic = hydraulics.find(h => h.exhibit_id === exhibit.id);
        const substrateRecord = substrate.find(s => s.exhibit_id === exhibit.id);
        return (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, tanks.filter(tank => tank.exhibit_id === exhibit.id), hydraulic, substrateRecord, calculationTimestamp);
    });
    let systemLinks = [];
    if (systems.length > 0) {
        const linkResult = await (0, index_1.query)(`SELECT sel.*, e.exhibit_code
       FROM system_exhibit_links sel
       LEFT JOIN exhibits e ON e.id = sel.exhibit_id
       WHERE sel.system_id = ANY($1::uuid[])`, [systems.map(system => system.id)]);
        systemLinks = linkResult.rows;
    }
    const compactUnitIds = systems
        .map(system => system.compact_unit_id)
        .filter(Boolean);
    const compactUnits = compactUnitIds.length > 0
        ? (await (0, index_1.query)(`SELECT lcu.*,
          COALESCE((
            SELECT json_agg(e ORDER BY e.sort_order, e.created_at, e.id)
            FROM lss_compact_unit_equipment e
            WHERE e.compact_unit_id=lcu.id
          ), '[]'::json) AS equipment
       FROM lss_compact_units lcu
       WHERE lcu.id = ANY($1::uuid[])`, [compactUnitIds])).rows
        : [];
    const systemCalculations = systems.map(system => (0, aquariumCalculations_1.calculateSystemEngineering)(system, systemLinks.filter(link => link.system_id === system.id), exhibitCalculations, compactUnits.find(unit => unit.id === system.compact_unit_id) || null, calculationTimestamp, system.side_streams || [], system.fractionator_allocations || []));
    const currentSystems = systems.map(system => {
        const calculation = systemCalculations.find(item => item.inputs.system_id === system.id);
        return {
            ...system,
            stored_design_flow_m3h: system.design_flow_m3h,
            design_flow_m3h: calculation?.results.design_flow_m3h ?? null,
            design_flow_source: calculation?.inputs.design_flow_source || 'linked_exhibits',
        };
    });
    const thermalCalculations = await loadThermalCalculations(index_1.query, routeParam(req.params.id), currentSystems.filter(isLifeSupportSystem), systemLinks, exhibits, tanks, exhibitCalculations);
    const pumpSelections = await loadPumpSelections(index_1.query, currentSystems);
    const frictionLossCalculations = await loadFrictionLossPackages(index_1.query, routeParam(req.params.id), currentSystems);
    const livePackage = {
        exhibits,
        tanks,
        systems: currentSystems,
        compact_units: compactUnits,
        system_links: systemLinks,
        species,
        hydraulics,
        substrate,
        thermal_calculations: thermalCalculations,
        thermal_construction_defaults: thermalCalculations_1.THERMAL_CONSTRUCTION_DEFAULTS,
        pump_selections: pumpSelections,
        friction_loss_calculations: frictionLossCalculations,
        engineering_calculations: {
            calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            calculated_at: calculationTimestamp,
            policy: {
                turnover_unit: 'cycles_per_hour',
                flow_unit: 'm3_per_hour',
                allocation_tolerance_pct: 0.01,
                volume_definition: 'operating water volume less substrate and theming displacement',
                rounding: 'volumes to 4 decimals m³; flows to 3 decimals m³/h',
            },
            exhibits: exhibitCalculations,
            systems: systemCalculations,
        },
    };
    // Editable books must always expose the current project assembly. In
    // particular, thermal entries are previews derived from eligible current
    // systems and do not depend on a saved thermal row. Frozen packages remain
    // authoritative once the book enters review or is released.
    const responsePackage = row.status === 'Released' && row.release_snapshot
        ? row.release_snapshot
        : ['For Review', 'Approved'].includes(row.status) && row.review_snapshot
            ? row.review_snapshot
            : {
                ...livePackage,
                thermal_calculations: currentSystems
                    .filter(isLifeSupportSystem)
                    .map(system => thermalCalculations.find(item => item.system_id === system.id))
                    .filter(Boolean),
            };
    res.json({
        ...row,
        ...responsePackage,
        id: row.id,
        book_code: row.book_code,
        book_title: row.book_title,
        revision: row.revision,
        status: row.status,
        release_scope: row.release_scope,
        release_notes: row.release_notes,
        released_by_name: row.released_by_name,
        released_at: row.released_at,
    });
});
router.get('/design-books/:id/release-preflight', auth_1.authenticate, async (req, res) => {
    const context = await loadReleaseContext(routeParam(req.params.id));
    if (!context)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context);
    res.json({
        design_book_id: req.params.id,
        status: context.status,
        revision: context.revision,
        checklist,
        blockers: (0, designBookRelease_1.releaseBlockers)(checklist),
    });
});
router.post('/design-books', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { book_code, book_title, project_id, description, revision, status, notes } = req.body;
    if (!book_code || !book_title)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'book_code and book_title are required' } });
    if (status && status !== 'Draft') {
        return res.status(400).json({
            error: { code: 'WORKFLOW_ACTION_REQUIRED', message: 'New Design Books must start as Draft.' },
        });
    }
    const result = await (0, index_1.query)(`INSERT INTO design_books (book_code, book_title, project_id, description, revision, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [book_code, book_title, project_id || null, description || null, revision || 'A', 'Draft', notes || null, req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.put('/design-books/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { book_title, project_id, description, revision, status, notes } = req.body;
    const existing = await (0, index_1.query)('SELECT status FROM design_books WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (status && status !== existing.rows[0].status) {
        return res.status(400).json({
            error: { code: 'WORKFLOW_ACTION_REQUIRED', message: 'Use the Design Book review, approval, or release action to change workflow status.' },
        });
    }
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const result = await (0, index_1.query)(`UPDATE design_books SET book_title=$1, project_id=$2, description=$3, revision=$4, status=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 AND status <> 'Released' RETURNING *`, [book_title, project_id || null, description || null, revision || 'A', existing.rows[0].status, notes || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    res.json(result.rows[0]);
});
router.delete('/design-books/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const result = await (0, index_1.query)(`DELETE FROM design_books
     WHERE id=$1 AND status <> 'Released'
     RETURNING id`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    res.json({ deleted: true });
});
// Species CRUD
router.post('/design-books/:id/species', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const catalogId = req.body.catalog_species_id || req.body.catalog_id || null;
    const catalog = await loadCatalogSpecies(catalogId);
    if (catalogId && !catalog)
        return res.status(400).json({ error: { code: 'INVALID_CATALOG_SPECIES', message: 'Selected catalog species does not exist.' } });
    if (catalog && !catalog.active)
        return res.status(409).json({ error: { code: 'INACTIVE_CATALOG_SPECIES', message: 'Inactive catalog species cannot be added to a new allocation.' } });
    const speciesName = String(catalog?.scientific_name || req.body.species_name || '').trim();
    const exhibitId = String(req.body.exhibit_id || '').trim();
    if (!exhibitId || !speciesName)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id and a catalog or custom scientific name are required.' } });
    try {
        const quantity = nullableSpeciesQuantity(req.body.quantity);
        const avgSizeOverride = catalog ? nullableSpeciesNumber(req.body.avg_size_override_cm, 'Average size override') : null;
        const massOverride = catalog ? nullableSpeciesNumber(req.body.reference_mass_override_kg, 'Reference mass override') : null;
        const biomassOverride = catalog
            ? nullableSpeciesNumber(req.body.biomass_override_kg ?? req.body.biomass_kg, 'Biomass override', true)
            : null;
        const manualAverageSize = catalog ? null : nullableSpeciesNumber(req.body.avg_size_cm, 'Average size');
        const manualReferenceMass = catalog ? null : nullableSpeciesNumber(req.body.reference_average_mass_kg, 'Reference average mass');
        const manualBiomass = catalog ? null : nullableSpeciesNumber(req.body.biomass_kg, 'Biomass', true);
        const calculated = (0, speciesAllocations_1.calculateSpeciesAllocation)({
            quantity,
            catalogLinked: !!catalog,
            catalogAverageSizeCm: catalog ? nullableSpeciesNumber(catalog.average_size_cm, 'Catalog average size') : null,
            catalogReferenceMassKg: catalog ? nullableSpeciesNumber(catalog.reference_average_mass_kg, 'Catalog reference mass') : null,
            manualAverageSizeCm: manualAverageSize,
            manualReferenceMassKg: manualReferenceMass,
            manualBiomassKg: manualBiomass,
            averageSizeOverrideCm: avgSizeOverride,
            referenceMassOverrideKg: massOverride,
            biomassOverrideKg: biomassOverride,
        });
        const result = await (0, index_1.query)(`INSERT INTO design_book_exhibit_species
         (design_book_id, exhibit_id, catalog_species_id, species_name, common_name, quantity,
          avg_size_cm, reference_average_mass_kg, biomass_kg, avg_size_override_cm,
          reference_mass_override_kg, biomass_override_kg, notes, sort_order)
       SELECT db.id, e.id, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
       FROM design_books db
       JOIN exhibits e ON e.id=$2 AND e.project_id=db.project_id
       WHERE db.id=$1
       RETURNING *`, [req.params.id, exhibitId, catalogId, speciesName, catalog?.common_name || req.body.common_name || null,
            quantity, calculated.average_size_cm, calculated.reference_average_mass_kg, calculated.biomass_kg,
            avgSizeOverride, massOverride, biomassOverride,
            req.body.notes || null, Number(req.body.sort_order) || 0]);
        if (!result.rows[0]) {
            return res.status(400).json({ error: { code: 'INVALID_EXHIBIT', message: 'Exhibit must belong to the Design Book project.' } });
        }
        res.status(201).json(speciesValueSources(result.rows[0]));
    }
    catch (error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
});
router.put('/design-books/:id/species/:speciesId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const existingResult = await (0, index_1.query)(`SELECT s.*
     FROM design_book_exhibit_species s
     JOIN design_books db ON db.id=s.design_book_id
     JOIN exhibits e ON e.id=s.exhibit_id AND e.project_id=db.project_id
     WHERE s.id=$1 AND s.design_book_id=$2`, [req.params.speciesId, req.params.id]);
    const existing = existingResult.rows[0];
    if (!existing)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
    const catalogId = req.body.catalog_species_id !== undefined || req.body.catalog_id !== undefined
        ? req.body.catalog_species_id || req.body.catalog_id || null
        : existing.catalog_species_id;
    const catalog = await loadCatalogSpecies(catalogId);
    if (catalogId && !catalog)
        return res.status(400).json({ error: { code: 'INVALID_CATALOG_SPECIES', message: 'Selected catalog species does not exist.' } });
    const catalogChanged = String(catalogId || '') !== String(existing.catalog_species_id || '');
    if (catalog && !catalog.active && catalogChanged) {
        return res.status(409).json({ error: { code: 'INACTIVE_CATALOG_SPECIES', message: 'Inactive catalog species cannot be selected for a new allocation.' } });
    }
    try {
        const quantity = nullableSpeciesQuantity(Object.prototype.hasOwnProperty.call(req.body, 'quantity') ? req.body.quantity : existing.quantity);
        const hasAvgOverride = Object.prototype.hasOwnProperty.call(req.body, 'avg_size_override_cm');
        const hasMassOverride = Object.prototype.hasOwnProperty.call(req.body, 'reference_mass_override_kg');
        const hasBiomassOverride = Object.prototype.hasOwnProperty.call(req.body, 'biomass_override_kg')
            || Object.prototype.hasOwnProperty.call(req.body, 'biomass_kg');
        const avgSizeOverride = catalog
            ? nullableSpeciesNumber(hasAvgOverride ? req.body.avg_size_override_cm : existing.avg_size_override_cm, 'Average size override')
            : null;
        const massOverride = catalog
            ? nullableSpeciesNumber(hasMassOverride ? req.body.reference_mass_override_kg : existing.reference_mass_override_kg, 'Reference mass override')
            : null;
        const biomassOverride = catalog
            ? nullableSpeciesNumber(hasBiomassOverride ? req.body.biomass_override_kg ?? req.body.biomass_kg : existing.biomass_override_kg, 'Biomass override', true)
            : null;
        const refreshCatalog = catalogChanged || req.body.refresh_catalog === true;
        const averageCatalogBaseline = refreshCatalog || (hasAvgOverride && avgSizeOverride == null && existing.avg_size_override_cm != null)
            ? catalog?.average_size_cm
            : existing.avg_size_cm;
        const massCatalogBaseline = refreshCatalog || (hasMassOverride && massOverride == null && existing.reference_mass_override_kg != null)
            ? catalog?.reference_average_mass_kg
            : existing.reference_average_mass_kg;
        const manualAverageSize = catalog ? null : nullableSpeciesNumber(Object.prototype.hasOwnProperty.call(req.body, 'avg_size_cm') ? req.body.avg_size_cm : existing.avg_size_cm, 'Average size');
        const manualReferenceMass = catalog ? null : nullableSpeciesNumber(Object.prototype.hasOwnProperty.call(req.body, 'reference_average_mass_kg')
            ? req.body.reference_average_mass_kg
            : existing.reference_average_mass_kg, 'Reference average mass');
        const manualBiomass = catalog ? null : nullableSpeciesNumber(Object.prototype.hasOwnProperty.call(req.body, 'biomass_kg') ? req.body.biomass_kg : existing.biomass_kg, 'Biomass', true);
        const calculated = (0, speciesAllocations_1.calculateSpeciesAllocation)({
            quantity,
            catalogLinked: !!catalog,
            catalogAverageSizeCm: catalog ? nullableSpeciesNumber(averageCatalogBaseline, 'Catalog average size') : null,
            catalogReferenceMassKg: catalog ? nullableSpeciesNumber(massCatalogBaseline, 'Catalog reference mass') : null,
            manualAverageSizeCm: manualAverageSize,
            manualReferenceMassKg: manualReferenceMass,
            manualBiomassKg: manualBiomass,
            averageSizeOverrideCm: avgSizeOverride,
            referenceMassOverrideKg: massOverride,
            biomassOverrideKg: biomassOverride,
        });
        const speciesName = String(catalog && refreshCatalog ? catalog.scientific_name : req.body.species_name || existing.species_name).trim();
        const commonName = catalog && refreshCatalog
            ? catalog.common_name
            : req.body.common_name !== undefined ? req.body.common_name || null : existing.common_name;
        if (!speciesName)
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'Scientific name is required.' } });
        const result = await (0, index_1.query)(`UPDATE design_book_exhibit_species
       SET catalog_species_id=$1, species_name=$2, common_name=$3, quantity=$4,
           avg_size_cm=$5, reference_average_mass_kg=$6, biomass_kg=$7,
           avg_size_override_cm=$8, reference_mass_override_kg=$9,
           biomass_override_kg=$10, notes=$11, updated_at=NOW()
       WHERE id=$12 AND design_book_id=$13 RETURNING *`, [catalogId, speciesName, commonName, quantity,
            calculated.average_size_cm, calculated.reference_average_mass_kg, calculated.biomass_kg,
            avgSizeOverride, massOverride, biomassOverride,
            req.body.notes !== undefined ? req.body.notes || null : existing.notes,
            req.params.speciesId, req.params.id]);
        res.json(speciesValueSources(result.rows[0]));
    }
    catch (error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
});
router.put('/design-books/:id/exhibits/:exhibitId/substrate', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const { substrate_type, substrate_height_mm, substrate_volume_m3, theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes } = req.body;
    for (const [label, value] of [
        ['Substrate height', substrate_height_mm],
        ['Substrate volume', substrate_volume_m3],
        ['Theming height', theming_height_mm],
        ['Theming volume', theming_volume_m3],
        ['Theming percentage', theming_volume_pct],
    ]) {
        if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number.` } });
        }
    }
    if (theming_volume_pct != null && Number(theming_volume_pct) > 100) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Theming percentage cannot exceed 100%.' } });
    }
    const tankVolumeResult = await (0, index_1.query)(`SELECT SUM(COALESCE(t.operating_volume_m3, pm.operating_volume_m3, 0) * COALESCE(t.quantity, 1)) AS volume_m3
     FROM tanks t
     LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     WHERE t.exhibit_id=$1`, [req.params.exhibitId]);
    const grossOperatingVolume = Number(tankVolumeResult.rows[0]?.volume_m3);
    if (theming_volume_pct != null && !(grossOperatingVolume > 0)) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'A known tank operating volume is required to use percentage-based theming displacement.' },
        });
    }
    const resolvedThemingVolume = theming_volume_pct != null
        ? Math.round(grossOperatingVolume * Number(theming_volume_pct) / 100 * 1e6) / 1e6
        : (theming_volume_m3 ?? null);
    const displacement = Number(substrate_volume_m3 || 0) + Number(resolvedThemingVolume || 0);
    if (grossOperatingVolume > 0 && displacement >= grossOperatingVolume) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'Substrate and theming displacement must be less than operating volume.' },
        });
    }
    const result = await (0, index_1.query)(`INSERT INTO design_book_exhibit_substrate
       (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3, theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       substrate_type      = EXCLUDED.substrate_type,
       substrate_height_mm = EXCLUDED.substrate_height_mm,
       substrate_volume_m3 = EXCLUDED.substrate_volume_m3,
       theming_type        = EXCLUDED.theming_type,
       theming_height_mm   = EXCLUDED.theming_height_mm,
       theming_volume_m3   = EXCLUDED.theming_volume_m3,
       theming_volume_pct  = EXCLUDED.theming_volume_pct,
       notes               = EXCLUDED.notes,
       updated_at          = NOW()
     RETURNING *`, [req.params.id, req.params.exhibitId,
        substrate_type || null, substrate_height_mm ?? null, substrate_volume_m3 ?? null,
        theming_type || null, theming_height_mm ?? null, resolvedThemingVolume,
        theming_volume_pct ?? null, notes || null]);
    res.json(result.rows[0]);
});
router.put('/design-books/:id/exhibits/:exhibitId/hydraulics', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const { target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes, weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions, weir_discharge_condition, weir_downstream_head_mm, } = req.body;
    const hasField = (field) => Object.prototype.hasOwnProperty.call(req.body, field);
    const hasWeirHead = hasField('weir_head_mm');
    const hasWeirLength = hasField('weir_length_mm');
    const hasWeirMethod = hasField('weir_formula_method');
    const hasWeirGeometry = hasField('weir_geometry');
    const hasWeirContractions = hasField('weir_end_contractions');
    const hasWeirDischarge = hasField('weir_discharge_condition');
    const hasWeirDownstreamHead = hasField('weir_downstream_head_mm');
    if (weir_formula_method != null && !['francis_184', 'bazin_1888'].includes(weir_formula_method)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unsupported weir formula method' } });
    }
    if (weir_geometry != null && weir_geometry !== 'sharp_rectangular') {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Only sharp-crested rectangular weirs are supported' } });
    }
    if (weir_end_contractions != null &&
        (!Number.isInteger(Number(weir_end_contractions)) || Number(weir_end_contractions) < 0 || Number(weir_end_contractions) > 2)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir end contractions must be 0, 1, or 2' } });
    }
    if (weir_discharge_condition != null && !['free', 'submerged'].includes(weir_discharge_condition)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unsupported weir discharge condition' } });
    }
    if (weir_head_mm != null && (!Number.isFinite(Number(weir_head_mm)) || Number(weir_head_mm) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir head must be a non-negative number' } });
    }
    if (weir_length_mm != null && (!Number.isFinite(Number(weir_length_mm)) || Number(weir_length_mm) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir length must be a non-negative number' } });
    }
    if (weir_downstream_head_mm != null &&
        (!Number.isFinite(Number(weir_downstream_head_mm)) || Number(weir_downstream_head_mm) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Downstream head must be a non-negative number' } });
    }
    const numericFields = [
        ['target turnover rate', target_turnover_rate],
        ['surface skim percentage', surface_skim_pct],
        ['bottom drain percentage', bottom_drain_pct],
    ];
    for (const [label, value] of numericFields) {
        if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number` } });
        }
    }
    if (target_turnover_rate != null && Number(target_turnover_rate) === 0) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Target turnover rate must be greater than zero' } });
    }
    const savedSurfacePct = surface_skim_pct ?? 30;
    const savedBottomPct = bottom_drain_pct ?? 70;
    if (Number(savedSurfacePct) > 100 || Number(savedBottomPct) > 100 ||
        Math.abs(Number(savedSurfacePct) + Number(savedBottomPct) - 100) > aquariumCalculations_1.ALLOCATION_TOLERANCE_PCT) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: `Surface and bottom allocations must total 100% ± ${aquariumCalculations_1.ALLOCATION_TOLERANCE_PCT}%.` },
        });
    }
    const result = await (0, index_1.query)(`INSERT INTO design_book_exhibit_hydraulics
       (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
        weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
        weir_discharge_condition, weir_downstream_head_mm,
        calculation_version, last_calculated_at, calculation_inputs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        '${aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION}',NOW(),$21)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       target_turnover_rate = EXCLUDED.target_turnover_rate,
       surface_skim_pct     = EXCLUDED.surface_skim_pct,
       bottom_drain_pct     = EXCLUDED.bottom_drain_pct,
       notes                = EXCLUDED.notes,
       weir_head_mm = CASE WHEN $14 THEN EXCLUDED.weir_head_mm ELSE design_book_exhibit_hydraulics.weir_head_mm END,
       weir_length_mm = CASE WHEN $15 THEN EXCLUDED.weir_length_mm ELSE design_book_exhibit_hydraulics.weir_length_mm END,
       weir_formula_method = CASE WHEN $16 THEN EXCLUDED.weir_formula_method ELSE design_book_exhibit_hydraulics.weir_formula_method END,
       weir_geometry = CASE WHEN $17 THEN EXCLUDED.weir_geometry ELSE design_book_exhibit_hydraulics.weir_geometry END,
       weir_end_contractions = CASE WHEN $18 THEN EXCLUDED.weir_end_contractions ELSE design_book_exhibit_hydraulics.weir_end_contractions END,
       weir_discharge_condition = CASE WHEN $19 THEN EXCLUDED.weir_discharge_condition ELSE design_book_exhibit_hydraulics.weir_discharge_condition END,
       weir_downstream_head_mm = CASE WHEN $20 THEN EXCLUDED.weir_downstream_head_mm ELSE design_book_exhibit_hydraulics.weir_downstream_head_mm END,
       calculation_version   = EXCLUDED.calculation_version,
       last_calculated_at    = EXCLUDED.last_calculated_at,
       calculation_inputs    = EXCLUDED.calculation_inputs,
       updated_at           = NOW()
     RETURNING *`, [req.params.id, req.params.exhibitId,
        target_turnover_rate ?? null, savedSurfacePct, savedBottomPct,
        notes ?? null, weir_head_mm ?? null, weir_length_mm ?? null, weir_formula_method ?? null,
        weir_geometry ?? null, weir_end_contractions ?? null,
        weir_discharge_condition ?? null, weir_downstream_head_mm ?? null,
        hasWeirHead, hasWeirLength, hasWeirMethod, hasWeirGeometry, hasWeirContractions,
        hasWeirDischarge, hasWeirDownstreamHead,
        JSON.stringify({
            target_turnover_rate: target_turnover_rate ?? null,
            surface_skim_pct: savedSurfacePct,
            bottom_drain_pct: savedBottomPct,
            turnover_unit: 'cycles_per_hour',
            flow_unit: 'm3_per_hour',
            weir_head_unit: 'mm',
            weir_length_unit: 'mm',
        })]);
    res.json(result.rows[0]);
});
router.delete('/design-books/:id/species/:speciesId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const result = await (0, index_1.query)('DELETE FROM design_book_exhibit_species WHERE id=$1 AND design_book_id=$2 RETURNING id', [req.params.speciesId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
    res.json({ deleted: true });
});
router.get('/design-books/:id/review-handovers', auth_1.authenticate, async (req, res) => {
    const result = await (0, index_1.query)(`SELECT h.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_review_handovers h
     LEFT JOIN users u ON u.id=h.created_by
     WHERE h.design_book_id=$1
     ORDER BY h.meeting_date DESC, h.created_at DESC`, [req.params.id]);
    res.json({ items: result.rows });
});
router.post('/design-books/:id/review-handovers', auth_1.authenticate, (0, auth_1.requireRole)(...Array.from(new Set([...designBookWorkflow_1.DESIGN_BOOK_DESIGNER_ROLES, ...designBookWorkflow_1.DESIGN_BOOK_MANAGER_ROLES]))), async (req, res) => {
    const { meeting_date, title, attendees, purpose, discussion_summary, decisions, action_items, open_items, acceptance_notes, } = req.body;
    const attendeeList = Array.isArray(attendees)
        ? attendees.map((value) => String(value).trim()).filter(Boolean)
        : String(attendees || '').split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    if (!meeting_date || !title?.trim()) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'Meeting date and report title are required.' },
        });
    }
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const bookResult = await client.query('SELECT status, review_snapshot FROM design_books WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!bookResult.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (bookResult.rows[0].status !== 'For Review') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'INVALID_HANDOVER_STATE', message: 'Handover reports can only be recorded while a Design Book is For Review.' },
            });
        }
        const result = await client.query(`INSERT INTO design_book_review_handovers
           (design_book_id, meeting_date, title, attendees, purpose, discussion_summary,
            decisions, action_items, open_items, acceptance_notes, created_by)
         VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`, [
            req.params.id, meeting_date, title.trim(), attendeeList, purpose || null,
            discussion_summary || null, decisions || null, action_items || null,
            open_items || null, acceptance_notes || null, req.user.id,
        ]);
        const reviewSnapshot = bookResult.rows[0].review_snapshot || {};
        const handovers = Array.isArray(reviewSnapshot.review_handovers)
            ? reviewSnapshot.review_handovers
            : [];
        await client.query('UPDATE design_books SET review_snapshot=$1::jsonb, updated_at=NOW() WHERE id=$2', [JSON.stringify({ ...reviewSnapshot, review_handovers: [...handovers, result.rows[0]] }), req.params.id]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'REVIEW_HANDOVER', {
            summary: `Review handover report recorded for ${meeting_date}`,
            handover_id: result.rows[0].id,
            title: title.trim(),
            meeting_date,
            attendees: attendeeList,
        }, req.ip);
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/submit-review', auth_1.authenticate, (0, auth_1.requireRole)(...designBookWorkflow_1.DESIGN_BOOK_DESIGNER_ROLES), async (req, res) => {
    const comment = String(req.body.comment || '').trim();
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true);
        if (!context || !(0, designBookWorkflow_1.isDesignBookContentEditable)(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'INVALID_TRANSITION', message: 'Only Draft or In Progress Design Books can be submitted for review.' },
            });
        }
        const previousStatus = context.status;
        const { release_snapshot: _releaseSnapshot, review_snapshot: _reviewSnapshot, ...reviewPackage } = context;
        const submittedAt = new Date().toISOString();
        const snapshot = {
            ...reviewPackage,
            status: 'For Review',
            review_submitted_by: req.user.id,
            review_submitted_at: submittedAt,
        };
        const result = await client.query(`UPDATE design_books
         SET status='For Review', review_submitted_by=$1, review_submitted_at=NOW(),
             review_snapshot=$2::jsonb, updated_at=NOW()
         WHERE id=$3 AND status IN ('Draft', 'In Progress')
         RETURNING *`, [req.user.id, JSON.stringify(snapshot), req.params.id]);
        if (!result.rows[0])
            throw new Error('Design Book status changed during review submission');
        await client.query(`INSERT INTO lifecycle_transitions
           (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('design_book',$1,$2,'For Review',$3,$4)`, [req.params.id, previousStatus, req.user.id, comment || null]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'SUBMIT_REVIEW', {
            summary: `Design Book submitted for review${comment ? `: ${comment}` : ''}`,
            comment,
        }, req.ip);
        await client.query('COMMIT');
        res.json(result.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/approve', auth_1.authenticate, (0, auth_1.requireRole)(...designBookWorkflow_1.DESIGN_BOOK_MANAGER_ROLES), async (req, res) => {
    const approvalNotes = String(req.body.approval_notes || '').trim();
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`UPDATE design_books
         SET status='Approved', approved_by=$1, approved_at=NOW(), approval_notes=$2, updated_at=NOW()
         WHERE id=$3 AND status='For Review'
         RETURNING *`, [req.user.id, approvalNotes || null, req.params.id]);
        if (!result.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'INVALID_TRANSITION', message: 'Only Design Books that are For Review can be approved.' },
            });
        }
        await client.query(`INSERT INTO lifecycle_transitions
           (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('design_book',$1,'For Review','Approved',$2,$3)`, [req.params.id, req.user.id, approvalNotes || null]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'APPROVE', {
            summary: `Design Book approved${approvalNotes ? `: ${approvalNotes}` : ''}`,
            approval_notes: approvalNotes,
        }, req.ip);
        await client.query('COMMIT');
        res.json(result.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/release', auth_1.authenticate, (0, auth_1.requireRole)(...designBookWorkflow_1.DESIGN_BOOK_MANAGER_ROLES), async (req, res) => {
    const { revision, included_scope, release_notes } = req.body;
    const scope = Array.isArray(included_scope)
        ? included_scope.map((value) => String(value).trim()).filter(Boolean)
        : [];
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (context.status === 'Released') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'ALREADY_RELEASED', message: 'This Design Book revision is already released.' },
            });
        }
        if (context.status !== 'Approved') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'APPROVAL_REQUIRED', message: 'The Design Book must be approved by a manager before release.' },
            });
        }
        const projectScope = Array.isArray(context.project_scopes) ? context.project_scopes : [];
        const confirmationError = (0, designBookRelease_1.validateReleaseConfirmation)({
            currentRevision: String(context.revision || '').trim(),
            confirmedRevision: String(revision || '').trim(),
            includedScope: scope,
            projectScope,
            releaseNotes: String(release_notes || '').trim(),
        });
        if (confirmationError) {
            await client.query('ROLLBACK');
            return res.status(confirmationError.status).json({ error: confirmationError });
        }
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)({ ...context, project_scopes: scope });
        const blockers = (0, designBookRelease_1.releaseBlockers)(checklist);
        const blockerError = (0, designBookRelease_1.validateReleaseBlockers)(blockers.length);
        if (blockerError) {
            await client.query('ROLLBACK');
            return res.status(blockerError.status).json({
                error: blockerError,
                checklist,
                blockers,
            });
        }
        const { release_snapshot: _existingSnapshot, release_scope: _existingScope, release_notes: _existingNotes, released_by: _existingReleaser, released_at: _existingReleasedAt, ...packageSnapshot } = context;
        const releasedAt = new Date().toISOString();
        const snapshot = {
            ...packageSnapshot,
            status: 'Released',
            released_revision: revision.trim(),
            included_scope: scope,
            release_notes: release_notes.trim(),
            released_by: req.user.id,
            released_at: releasedAt,
            release_checklist: checklist,
        };
        const updated = await client.query(`UPDATE design_books
         SET status='Released', revision=$1, release_scope=$2::text[], release_notes=$3,
             released_by=$4, released_at=NOW(), release_snapshot=$5::jsonb, updated_at=NOW()
         WHERE id=$6 AND status <> 'Released'
         RETURNING *`, [revision.trim(), scope, release_notes.trim(), req.user.id, JSON.stringify(snapshot), req.params.id]);
        if (!updated.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'ALREADY_RELEASED', message: 'This Design Book revision is already released.' },
            });
        }
        const releasedVersionSnapshot = withSnapshotIntegrity({
            ...makeVersionSnapshot({
                ...context,
                status: 'Released',
                revision: revision.trim(),
            }),
            release: {
                included_scope: scope,
                release_notes: release_notes.trim(),
                released_by: req.user.id,
                released_at: releasedAt,
                release_checklist: checklist,
            },
        });
        await insertVersion(client.query.bind(client), routeParam(req.params.id), `Released Rev ${revision.trim()}`, release_notes.trim(), releasedVersionSnapshot, req.user.id);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'RELEASE', {
            summary: `Design Book ${context.book_code} Rev ${revision.trim()} released`,
            revision: revision.trim(),
            included_scope: scope,
            release_notes: release_notes.trim(),
        }, req.ip);
        await client.query('COMMIT');
        res.json({
            ...updated.rows[0],
            checklist,
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/revisions', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const sourceResult = await (0, index_1.query)('SELECT * FROM design_books WHERE id=$1', [req.params.id]);
    const source = sourceResult.rows[0];
    if (!source)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (source.status !== 'Released') {
        return res.status(409).json({
            error: { code: 'NOT_RELEASED', message: 'Create a version snapshot for draft work; new revisions branch from released Design Books.' },
        });
    }
    const revision = String(req.body.revision || '').trim();
    const bookCode = String(req.body.book_code || '').trim();
    if (!revision || !bookCode) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'A new revision and unique Design Book code are required.' },
        });
    }
    const snapshot = source.release_snapshot || {};
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN');
        const created = await client.query(`INSERT INTO design_books
           (book_code, book_title, project_id, description, revision, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,'Draft',$6,$7)
         RETURNING *`, [
            bookCode,
            String(req.body.book_title || source.book_title).trim(),
            source.project_id,
            source.description,
            revision,
            req.body.notes || `Continues released ${source.book_code} Rev ${source.revision}`,
            req.user.id,
        ]);
        const next = created.rows[0];
        for (const row of snapshot.species || []) {
            await client.query(`INSERT INTO design_book_exhibit_species
             (design_book_id, exhibit_id, catalog_species_id, species_name, common_name, quantity,
              avg_size_cm, reference_average_mass_kg, biomass_kg, avg_size_override_cm,
              reference_mass_override_kg, biomass_override_kg, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [next.id, row.exhibit_id, row.catalog_species_id, row.species_name, row.common_name,
                row.quantity, row.avg_size_cm, row.reference_average_mass_kg, row.biomass_kg,
                row.avg_size_override_cm, row.reference_mass_override_kg, row.biomass_override_kg,
                row.notes, row.sort_order || 0]);
        }
        for (const row of snapshot.hydraulics || []) {
            await client.query(`INSERT INTO design_book_exhibit_hydraulics
             (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
              weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
              weir_discharge_condition, weir_downstream_head_mm, calculation_version, last_calculated_at,
              calculation_inputs, override_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
                next.id, row.exhibit_id, row.target_turnover_rate, row.surface_skim_pct, row.bottom_drain_pct, row.notes,
                row.weir_head_mm, row.weir_length_mm, row.weir_formula_method, row.weir_geometry, row.weir_end_contractions,
                row.weir_discharge_condition, row.weir_downstream_head_mm, row.calculation_version, row.last_calculated_at,
                row.calculation_inputs, row.override_reason,
            ]);
        }
        for (const row of snapshot.substrate || []) {
            await client.query(`INSERT INTO design_book_exhibit_substrate
             (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3,
              theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
                next.id, row.exhibit_id, row.substrate_type, row.substrate_height_mm, row.substrate_volume_m3,
                row.theming_type, row.theming_height_mm, row.theming_volume_m3, row.theming_volume_pct, row.notes,
            ]);
        }
        for (const row of snapshot.thermal_calculations || []) {
            await insertThermalSnapshotRecord(client.query.bind(client), next.id, row);
        }
        for (const group of snapshot.friction_loss_calculations || []) {
            for (const item of group.items || []) {
                await insertFrictionSnapshotRecord(client.query.bind(client), next.id, group.system_id, item);
            }
        }
        await client.query('COMMIT');
        await (0, audit_1.logAudit)(req.user.id, 'design_book', next.id, 'CREATE_REVISION', {
            summary: `Revision ${revision} created from ${source.book_code} Rev ${source.revision}`,
            source_design_book_id: source.id,
            source_revision: source.revision,
        }, req.ip);
        res.status(201).json(next);
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
            return res.status(409).json({
                error: { code: 'CONFLICT', message: `Design Book code "${bookCode}" already exists.` },
            });
        }
        throw error;
    }
    finally {
        client.release();
    }
});
// ─── Versions ────────────────────────────────────────────────────────────────
const VERSION_SNAPSHOT_SCHEMA = 5;
const VERSION_REFERENCE_FIELDS = {
    project: ['id', 'project_code', 'project_name'],
    exhibits: ['id', 'project_id', 'exhibit_code', 'exhibit_name', 'water_type',
        'design_temperature_min', 'design_temperature_max', 'design_salinity', 'area_id', 'status', 'notes'],
    tanks: ['id', 'project_id', 'tank_code', 'exhibit_id', 'system_id', 'area_id', 'quantity',
        'tank_name', 'tank_type', 'product_master_id', 'shape_type', 'gross_volume_m3',
        'operating_volume_m3', 'surface_area_m2', 'custom_footprint', 'length_mm', 'width_mm', 'height_mm', 'design_water_level_mm',
        'primary_material', 'material_id', 'wall_thickness_mm', 'inner_length_mm', 'inner_width_mm',
        'inner_height_mm', 'status', 'notes'],
    systems: ['id', 'project_id', 'system_code', 'area_id', 'exhibit_id', 'system_name', 'system_type',
        'design_flow_m3h', 'turnover_rate_hr', 'water_type', 'status', 'primary_control_panel_code',
        'duty_description', 'redundancy_strategy', 'design_basis_reference', 'system_config', 'compact_unit_id',
        'calculation_version', 'calculation_inputs', 'loop1_name', 'loop1_flow_source', 'loop1_filtration',
        'loop1_flow_pct', 'loop1_bio_degas_pct', 'loop1_bio_degas_m3h', 'loop1_link_bio_degas',
        'loop2_name', 'loop2_flow_source', 'loop2_filtration', 'loop2_flow_pct', 'loop2_bio_degas_pct',
        'loop2_bio_degas_m3h', 'loop2_link_bio_degas', 'loop3_name', 'loop3_flow_source', 'loop3_filtration',
        'loop3_flow_pct', 'loop3_bio_degas_pct', 'loop3_bio_degas_m3h', 'loop3_link_bio_degas',
        'side_streams'],
    system_links: ['id', 'system_id', 'exhibit_id', 'link_type', 'flow_allocation_m3h', 'notes',
        'sort_order', 'allocation_source', 'allocation_updated_at'],
};
function jsonCopy(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}
function pickFields(row, fields) {
    return fields.reduce((result, field) => {
        result[field] = row?.[field] ?? null;
        return result;
    }, {});
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function withSnapshotIntegrity(snapshot) {
    const unsigned = { ...snapshot };
    delete unsigned.integrity;
    return {
        ...unsigned,
        integrity: {
            algorithm: 'sha256',
            digest: crypto_1.default.createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
        },
    };
}
function snapshotIntegrityStatus(snapshot, persistedChecksum, requirePersisted = false) {
    if (!snapshot?.integrity?.digest)
        return 'legacy_unverified';
    if (requirePersisted && !persistedChecksum)
        return 'invalid';
    const unsigned = { ...snapshot };
    const expected = snapshot.integrity.digest;
    delete unsigned.integrity;
    const actual = crypto_1.default.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
    return expected === actual && (!persistedChecksum || persistedChecksum === actual) ? 'verified' : 'invalid';
}
function liveReferencesFromContext(context) {
    return {
        project: context.project_id
            ? pickFields(context, VERSION_REFERENCE_FIELDS.project)
            : null,
        exhibits: (context.exhibits || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.exhibits)),
        tanks: (context.tanks || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.tanks)),
        systems: (context.systems || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.systems)),
        system_links: (context.system_links || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.system_links)),
    };
}
function frozenFromSnapshot(snapshot) {
    if (snapshot?.frozen)
        return snapshot.frozen;
    // Keep snapshots made before schema 2 restorable while they are replaced by
    // verified snapshots on the next save.
    return {
        design_book: pickFields(snapshot, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
        species: snapshot?.species || [],
        hydraulics: snapshot?.hydraulics || [],
        substrate: snapshot?.substrate || [],
        thermal_calculations: snapshot?.thermal_calculations || [],
        friction_loss_calculations: snapshot?.friction_loss_calculations || [],
        ...(Array.isArray(snapshot?.review_handovers) ? { review_handovers: snapshot.review_handovers } : {}),
    };
}
function referencesFromSnapshot(snapshot) {
    if (snapshot?.live_references)
        return snapshot.live_references;
    return {
        project: snapshot?.project_id
            ? pickFields(snapshot, VERSION_REFERENCE_FIELDS.project)
            : null,
        exhibits: (snapshot?.exhibits || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.exhibits)),
        tanks: (snapshot?.tanks || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.tanks)),
        systems: (snapshot?.systems || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.systems)),
        system_links: (snapshot?.system_links || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.system_links)),
    };
}
function compareReferenceCollection(captured = [], current = []) {
    const capturedById = new Map(captured.filter(row => row?.id).map(row => [row.id, jsonCopy(row)]));
    const currentById = new Map(current.filter(row => row?.id).map(row => [row.id, jsonCopy(row)]));
    const added = current.filter(row => row?.id && !capturedById.has(row.id)).map(row => row.id);
    const removed = captured.filter(row => row?.id && !currentById.has(row.id)).map(row => row.id);
    const changed = captured
        .filter(row => row?.id && currentById.has(row.id))
        .filter(row => canonicalJson(capturedById.get(row.id)) !== canonicalJson(currentById.get(row.id)))
        .map(row => row.id);
    return { added, removed, changed, has_drift: added.length > 0 || removed.length > 0 || changed.length > 0 };
}
function calculateVersionDrift(snapshot, currentContext) {
    const captured = referencesFromSnapshot(snapshot);
    const current = liveReferencesFromContext(currentContext);
    const collections = {};
    for (const key of ['exhibits', 'tanks', 'systems', 'system_links']) {
        collections[key] = compareReferenceCollection(captured[key], current[key]);
    }
    const projectChanged = canonicalJson(captured.project) !== canonicalJson(current.project);
    const unresolved = [];
    for (const key of ['exhibits', 'tanks', 'systems']) {
        for (const id of collections[key].removed)
            unresolved.push({ type: key.slice(0, -1), id });
    }
    for (const id of collections.system_links.removed)
        unresolved.push({ type: 'system_link', id });
    if (captured.project?.id && !current.project)
        unresolved.unshift({ type: 'project', id: captured.project.id });
    return {
        has_drift: projectChanged || Object.values(collections).some((value) => value.has_drift),
        project_changed: projectChanged,
        collections,
        unresolved_references: unresolved,
    };
}
function makeVersionSnapshot(context, capturedAt = new Date().toISOString()) {
    const snapshot = {
        schema_version: VERSION_SNAPSHOT_SCHEMA,
        captured_at: capturedAt,
        source: {
            design_book_id: context.id,
            project_id: context.project_id || null,
            book_code: context.book_code,
            revision: context.revision,
            project_code: context.project_code || null,
            project_name: context.project_name || null,
        },
        frozen: {
            design_book: pickFields(context, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
            species: jsonCopy(context.species || []),
            hydraulics: jsonCopy(context.hydraulics || []),
            substrate: jsonCopy(context.substrate || []),
            thermal_calculations: jsonCopy(context.thermal_calculations || []),
            friction_loss_calculations: jsonCopy(context.friction_loss_calculations || []),
            review_handovers: jsonCopy(context.review_handovers || []),
        },
        live_references: liveReferencesFromContext(context),
        scope: {
            frozen: ['book metadata', 'species allocations', 'hydraulics', 'substrate and theming', 'thermal calculations', 'friction loss calculations', 'review handovers'],
            live: ['project', 'exhibits', 'tanks', 'LSS systems', 'system-exhibit links'],
            restore_target: 'working_copy',
        },
    };
    return withSnapshotIntegrity(snapshot);
}
function currentRestoreStateDigest(context) {
    return crypto_1.default.createHash('sha256').update(canonicalJson({
        frozen: {
            design_book: pickFields(context, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
            species: jsonCopy(context.species || []),
            hydraulics: jsonCopy(context.hydraulics || []),
            substrate: jsonCopy(context.substrate || []),
            thermal_calculations: jsonCopy(context.thermal_calculations || []),
            friction_loss_calculations: jsonCopy(context.friction_loss_calculations || []),
            review_handovers: jsonCopy(context.review_handovers || []),
        },
        live_references: liveReferencesFromContext(context),
    })).digest('hex');
}
function versionPresentation(version, currentContext) {
    const snapshot = version.snapshot || {};
    const frozen = frozenFromSnapshot(snapshot);
    const drift = calculateVersionDrift(snapshot, currentContext);
    const summary = {
        schema_version: snapshot.schema_version || 1,
        integrity: snapshotIntegrityStatus(snapshot, version.snapshot_checksum, Number(version.snapshot_schema_version || snapshot.schema_version || 1) >= VERSION_SNAPSHOT_SCHEMA),
        captured_at: snapshot.captured_at || snapshot.snapshotted_at || version.created_at,
        frozen_records: {
            species: (frozen.species || []).length,
            hydraulics: (frozen.hydraulics || []).length,
            substrate_theming: (frozen.substrate || []).length,
            thermal_calculations: (frozen.thermal_calculations || []).length,
            friction_loss_calculations: (frozen.friction_loss_calculations || []).reduce((sum, group) => sum + (group.items || []).length, 0),
            review_handovers: Array.isArray(frozen.review_handovers) ? frozen.review_handovers.length : null,
        },
        live_references: {
            exhibits: (referencesFromSnapshot(snapshot).exhibits || []).length,
            tanks: (referencesFromSnapshot(snapshot).tanks || []).length,
            systems: (referencesFromSnapshot(snapshot).systems || []).length,
            system_links: (referencesFromSnapshot(snapshot).system_links || []).length,
        },
        restorable_records: [
            'book metadata', 'species', 'hydraulics', 'substrate and theming', 'thermal calculations', 'friction loss calculations',
            ...(Array.isArray(frozen.review_handovers) ? ['review handovers'] : []),
        ],
        preserved_records: Array.isArray(frozen.review_handovers) ? [] : ['review handovers (not captured by this older version)'],
        live_reference_records: ['project', 'exhibits', 'tanks', 'LSS systems', 'system-exhibit links'],
    };
    return {
        ...version,
        snapshot,
        _snap: snapshot,
        summary,
        drift,
        restore_preview: {
            before: {
                book_title: currentContext.book_title,
                revision: currentContext.revision,
                status: currentContext.status,
                species: (currentContext.species || []).length,
                hydraulics: (currentContext.hydraulics || []).length,
                substrate_theming: (currentContext.substrate || []).length,
                thermal_calculations: (currentContext.thermal_calculations || []).length,
                review_handovers: (currentContext.review_handovers || []).length,
            },
            after: {
                book_title: frozen.design_book?.book_title,
                revision: frozen.design_book?.revision,
                status: frozen.design_book?.status,
                species: (frozen.species || []).length,
                hydraulics: (frozen.hydraulics || []).length,
                substrate_theming: (frozen.substrate || []).length,
                thermal_calculations: (frozen.thermal_calculations || []).length,
                review_handovers: Array.isArray(frozen.review_handovers)
                    ? frozen.review_handovers.length
                    : (currentContext.review_handovers || []).length,
                review_handovers_preserved: !Array.isArray(frozen.review_handovers),
            },
            token: currentRestoreStateDigest(currentContext),
            generated_at: new Date().toISOString(),
        },
    };
}
async function insertVersion(runner, bookId, versionLabel, notes, snapshot, createdBy, isRecoveryCheckpoint = false) {
    await runner('SELECT pg_advisory_xact_lock(hashtext($1))', [bookId]);
    const numberResult = await runner(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next
     FROM design_book_versions WHERE design_book_id = $1`, [bookId]);
    const inserted = await runner(`INSERT INTO design_book_versions
       (design_book_id, version_number, version_label, notes, snapshot, created_by,
        snapshot_schema_version, snapshot_checksum, is_recovery_checkpoint)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
     RETURNING id, version_number, version_label, notes, created_at, is_recovery_checkpoint`, [
        bookId,
        Number(numberResult.rows[0].next),
        versionLabel,
        notes,
        JSON.stringify(snapshot),
        createdBy,
        snapshot.schema_version || 1,
        snapshot.integrity?.digest || null,
        isRecoveryCheckpoint,
    ]);
    return inserted.rows[0];
}
exports.versionSnapshotTestUtils = {
    makeVersionSnapshot,
    snapshotIntegrityStatus,
    frozenFromSnapshot,
    calculateVersionDrift,
    currentRestoreStateDigest,
    insertVersion,
    loadReleaseContext,
};
router.get('/design-books/:id/versions', auth_1.authenticate, async (req, res) => {
    const currentContext = await loadReleaseContext(routeParam(req.params.id), index_1.query, false, true);
    if (!currentContext)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const result = await (0, index_1.query)(`SELECT v.id, v.version_number, v.version_label, v.notes, v.snapshot, v.created_at,
            v.is_recovery_checkpoint, v.snapshot_schema_version, v.snapshot_checksum,
            u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_versions v
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.design_book_id = $1
     ORDER BY v.version_number DESC`, [req.params.id]);
    res.json({ items: result.rows.map(version => versionPresentation(version, currentContext)) });
});
router.get('/design-books/:id/versions/:versionId/preview', auth_1.authenticate, async (req, res) => {
    const currentContext = await loadReleaseContext(routeParam(req.params.id), index_1.query, false, true);
    if (!currentContext)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const result = await (0, index_1.query)(`SELECT v.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_versions v
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.id=$1 AND v.design_book_id=$2`, [req.params.versionId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
    res.json(versionPresentation(result.rows[0], currentContext));
});
router.post('/design-books/:id/versions', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true, true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (!(0, designBookWorkflow_1.isDesignBookContentEditable)(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Only Draft or In Progress Design Books can be versioned.' },
            });
        }
        const snapshot = makeVersionSnapshot(context);
        const version = await insertVersion(client.query.bind(client), routeParam(req.params.id), String(req.body.version_label || '').trim() || null, String(req.body.notes || '').trim() || null, snapshot, req.user.id);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'VERSION_CREATED', {
            summary: `Design Book version ${version.version_number} created`,
            version_id: version.id,
            version_number: version.version_number,
            schema_version: snapshot.schema_version,
            snapshot_checksum: snapshot.integrity.digest,
        }, req.ip);
        await client.query('COMMIT');
        res.status(201).json({ ...version, summary: versionPresentation({ ...version, snapshot }, context).summary });
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') {
            return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'Another version was saved at the same time. Please retry.' } });
        }
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/versions/:versionId/restore', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const versionResult = await client.query('SELECT * FROM design_book_versions WHERE id=$1 AND design_book_id=$2', [req.params.versionId, req.params.id]);
        if (!versionResult.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
        }
        const version = versionResult.rows[0];
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true, true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (!(0, designBookWorkflow_1.isDesignBookContentEditable)(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Only Draft or In Progress Design Books can be restored.' },
            });
        }
        const currentStateToken = currentRestoreStateDigest(context);
        if (!req.body.preview_token || req.body.preview_token !== currentStateToken) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: {
                    code: 'RESTORE_PREVIEW_STALE',
                    message: 'The working copy changed after the restore preview. Review the refreshed before-and-after comparison.',
                },
            });
        }
        const integrity = snapshotIntegrityStatus(version.snapshot, version.snapshot_checksum, Number(version.snapshot_schema_version || version.snapshot?.schema_version || 1) >= VERSION_SNAPSHOT_SCHEMA);
        if (integrity === 'invalid') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'INVALID_SNAPSHOT', message: 'This version failed its integrity check and cannot be restored.' } });
        }
        const drift = calculateVersionDrift(version.snapshot, context);
        if (drift.unresolved_references.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: {
                    code: 'UNRESOLVED_REFERENCES',
                    message: 'This version refers to project records that no longer exist. Nothing was changed.',
                    references: drift.unresolved_references,
                },
                drift,
            });
        }
        const currentSnapshot = makeVersionSnapshot(context);
        const recoverySnapshot = withSnapshotIntegrity({
            ...currentSnapshot,
            recovery: {
                source_version_id: version.id,
                source_version_number: version.version_number,
                created_at: new Date().toISOString(),
            },
        });
        const checkpoint = await insertVersion(client.query.bind(client), routeParam(req.params.id), `Recovery before restoring v${version.version_number}`, `Automatic recovery checkpoint created before restoring version ${version.version_number}.`, recoverySnapshot, req.user.id, true);
        const frozen = frozenFromSnapshot(version.snapshot);
        const book = frozen.design_book || {};
        const restoredStatus = (0, designBookWorkflow_1.isDesignBookContentEditable)(book.status) ? book.status : context.status;
        await client.query(`UPDATE design_books
       SET book_title=$1, revision=$2, status=$3, description=$4, notes=$5, updated_at=NOW()
       WHERE id=$6`, [book.book_title, book.revision, restoredStatus, book.description, book.notes, req.params.id]);
        await client.query('DELETE FROM design_book_exhibit_species WHERE design_book_id=$1', [req.params.id]);
        for (const sp of frozen.species || []) {
            await client.query(`INSERT INTO design_book_exhibit_species
           (design_book_id, exhibit_id, catalog_species_id, species_name, common_name, quantity,
            avg_size_cm, reference_average_mass_kg, biomass_kg, avg_size_override_cm,
            reference_mass_override_kg, biomass_override_kg, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [req.params.id, sp.exhibit_id, sp.catalog_species_id ?? null, sp.species_name, sp.common_name,
                sp.quantity ?? null, sp.avg_size_cm ?? null, sp.reference_average_mass_kg ?? null,
                sp.biomass_kg ?? null, sp.avg_size_override_cm ?? null, sp.reference_mass_override_kg ?? null,
                sp.biomass_override_kg ?? null, sp.notes ?? null, sp.sort_order ?? 0]);
        }
        await client.query('DELETE FROM design_book_exhibit_hydraulics WHERE design_book_id=$1', [req.params.id]);
        for (const h of frozen.hydraulics || []) {
            await client.query(`INSERT INTO design_book_exhibit_hydraulics
           (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
            weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
            weir_discharge_condition, weir_downstream_head_mm, calculation_version, last_calculated_at,
            calculation_inputs, override_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)`, [req.params.id, h.exhibit_id, h.target_turnover_rate ?? null, h.surface_skim_pct ?? 30,
                h.bottom_drain_pct ?? 70, h.notes ?? null, h.weir_head_mm ?? null, h.weir_length_mm ?? null,
                h.weir_formula_method ?? null, h.weir_geometry ?? null, h.weir_end_contractions ?? null,
                h.weir_discharge_condition ?? null, h.weir_downstream_head_mm ?? null, h.calculation_version ?? null,
                h.last_calculated_at ?? null, h.calculation_inputs ? JSON.stringify(h.calculation_inputs) : null,
                h.override_reason ?? null]);
        }
        await client.query('DELETE FROM design_book_exhibit_substrate WHERE design_book_id=$1', [req.params.id]);
        for (const s of frozen.substrate || []) {
            await client.query(`INSERT INTO design_book_exhibit_substrate
           (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3,
            theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [req.params.id, s.exhibit_id, s.substrate_type ?? null, s.substrate_height_mm ?? null,
                s.substrate_volume_m3 ?? null, s.theming_type ?? null, s.theming_height_mm ?? null,
                s.theming_volume_m3 ?? null, s.theming_volume_pct ?? null, s.notes ?? null]);
        }
        await client.query('DELETE FROM design_book_thermal_calculations WHERE design_book_id=$1', [req.params.id]);
        for (const thermal of frozen.thermal_calculations || []) {
            await insertThermalSnapshotRecord(client.query.bind(client), routeParam(req.params.id), thermal);
        }
        await client.query('DELETE FROM design_book_friction_loss_calculations WHERE design_book_id=$1', [req.params.id]);
        for (const group of frozen.friction_loss_calculations || []) {
            for (const item of group.items || []) {
                await insertFrictionSnapshotRecord(client.query.bind(client), routeParam(req.params.id), group.system_id, item);
            }
        }
        if (Array.isArray(frozen.review_handovers)) {
            await client.query('DELETE FROM design_book_review_handovers WHERE design_book_id=$1', [req.params.id]);
            for (const handover of frozen.review_handovers) {
                await client.query(`INSERT INTO design_book_review_handovers
             (design_book_id, meeting_date, title, attendees, purpose, discussion_summary,
              decisions, action_items, open_items, acceptance_notes, created_by, created_at)
           VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11,COALESCE($12,NOW()))`, [req.params.id, handover.meeting_date, handover.title, handover.attendees || [],
                    handover.purpose ?? null, handover.discussion_summary ?? null, handover.decisions ?? null,
                    handover.action_items ?? null, handover.open_items ?? null, handover.acceptance_notes ?? null,
                    handover.created_by ?? null, handover.created_at ?? null]);
            }
        }
        await client.query(`INSERT INTO design_book_version_restores
         (design_book_id, source_version_id, recovery_checkpoint_id, actor_id, drift, restored_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,NOW())`, [req.params.id, version.id, checkpoint.id, req.user.id, JSON.stringify(drift)]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'VERSION_RESTORED', {
            summary: `Design Book restored from version ${version.version_number}`,
            source_version_id: version.id,
            source_version_number: version.version_number,
            recovery_checkpoint_id: checkpoint.id,
            drift,
        }, req.ip);
        await client.query('COMMIT');
        res.json({
            restored: true,
            version_number: version.version_number,
            recovery_checkpoint_id: checkpoint.id,
            drift,
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
exports.default = router;
