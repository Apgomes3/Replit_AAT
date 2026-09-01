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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importStar(require("../db"));
const auth_1 = require("../middleware/auth");
const frictionLossCalculations_1 = require("../lib/frictionLossCalculations");
const pumpSelections_1 = require("../lib/pumpSelections");
const designBooks_1 = require("./designBooks");
const lssSystems_1 = require("../lib/lssSystems");
const systemLifecycle_1 = require("../lib/systemLifecycle");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const routeParam = (value) => Array.isArray(value) ? value[0] : value;
async function pumpCandidates(runner, projectId, systemId) {
    return (await runner(`SELECT pei.id, pei.id AS project_equipment_item_id, pei.equip_code, pei.description,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer, pm.model
     FROM project_equipment_items pei
     JOIN product_masters pm ON pm.id=pei.product_master_id
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     WHERE pei.project_id=$1 AND pei.system_id=$2
       AND (pm.status IS NULL OR pm.status='Active')
       AND (
         UPPER(COALESCE(pm.product_category,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.category_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.product_family_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR ((pm.product_category IS NULL OR BTRIM(pm.product_category)='')
             AND (pf.category_code IS NULL OR BTRIM(pf.category_code)='')
             AND (UPPER(COALESCE(pm.application_type,'')) LIKE '%PUMP%'
                  OR UPPER(pm.product_name) LIKE '%PUMP%'))
       )
     ORDER BY pei.equip_code`, [projectId, systemId])).rows;
}
async function pipingCandidates(runner, projectId, systemId) {
    return (await runner(`SELECT ppi.id, ppi.id AS project_piping_item_id, ppi.piping_code, ppi.description,
            ppi.quantity AS project_quantity, ppi.unit, ppi.system_id,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.application_type
     FROM project_piping_items ppi
     LEFT JOIN product_masters pm ON pm.id=ppi.product_master_id
     WHERE ppi.project_id=$1 AND ppi.system_id=$2
     ORDER BY ppi.piping_code`, [projectId, systemId])).rows;
}
router.get('/design-books/:bookId/friction-loss', async (req, res) => {
    const frozenResult = await (0, db_1.query)('SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1', [req.params.bookId]);
    if (!frozenResult.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const frozenBook = frozenResult.rows[0];
    const snapshot = frozenBook.status === 'Released'
        ? frozenBook.release_snapshot
        : ['For Review', 'Approved'].includes(frozenBook.status) ? frozenBook.review_snapshot : null;
    if (snapshot)
        return res.json({ items: snapshot.friction_loss_calculations || [], frozen: true });
    const context = await (0, designBooks_1.loadReleaseContext)(String(req.params.bookId), db_1.query, false, false);
    if (!context)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const frozen = ['For Review', 'Approved', 'Released'].includes(context.status);
    res.json({ items: context.friction_loss_calculations || [], frozen });
});
router.get('/design-books/:bookId/friction-loss/:systemId', async (req, res) => {
    const frozenResult = await (0, db_1.query)('SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1', [req.params.bookId]);
    if (!frozenResult.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const frozenBook = frozenResult.rows[0];
    const snapshot = frozenBook.status === 'Released'
        ? frozenBook.release_snapshot
        : ['For Review', 'Approved'].includes(frozenBook.status) ? frozenBook.review_snapshot : null;
    const systemId = routeParam(req.params.systemId);
    if (snapshot) {
        const item = (snapshot.friction_loss_calculations || []).find((entry) => entry.system_id === systemId);
        if (!item)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'LSS system not found in frozen Design Book package' } });
        return res.json({ ...item, pump_candidates: [], piping_candidates: [], frozen: true });
    }
    const context = await (0, designBooks_1.loadReleaseContext)(String(req.params.bookId), db_1.query, false, false);
    if (!context)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const item = (context.friction_loss_calculations || []).find((entry) => entry.system_id === systemId);
    if (!item)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'LSS system not found in Design Book project' } });
    const frozen = ['For Review', 'Approved', 'Released'].includes(context.status);
    res.json({
        ...item,
        pump_candidates: frozen ? [] : await pumpCandidates(db_1.query, context.project_id, systemId),
        piping_candidates: frozen ? [] : await pipingCandidates(db_1.query, context.project_id, systemId),
        frozen,
    });
});
router.put('/design-books/:bookId/friction-loss/:systemId', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const client = await db_1.default.connect();
    const runner = client.query.bind(client);
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await (0, designBooks_1.loadReleaseContext)(String(req.params.bookId), runner, true, true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (!['Draft', 'In Progress'].includes(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Friction Loss is read-only while the Design Book is under review, approved, or released.' } });
        }
        const system = context.systems?.find((entry) => entry.id === routeParam(req.params.systemId));
        if (!system || !(0, lssSystems_1.isLifeSupportSystem)(system)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'INVALID_SYSTEM', message: 'Select a Life Support system from this Design Book project.' } });
        }
        if ((0, systemLifecycle_1.isRetiredSystem)(system)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system) });
        }
        const circuit = (0, pumpSelections_1.pumpCircuits)(system, system.side_streams || [])
            .find(entry => entry.circuit_key === req.body.circuit_key);
        if (!circuit) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit is not active in the saved Flow Route.' } });
        }
        const pumps = await pumpCandidates(runner, context.project_id, system.id);
        const pumpSelectionPackage = (await (0, designBooks_1.loadPumpSelections)(runner, [system]))[0];
        const pumpSelection = pumpSelectionPackage?.items?.find((entry) => entry.circuit_key === circuit.circuit_key);
        const selectedPump = pumps.find((entry) => entry.project_equipment_item_id === pumpSelection?.project_equipment_item_id);
        if (!(0, designBooks_1.isCurrentPumpSelectionReady)(pumpSelection) ||
            !selectedPump ||
            (req.body.project_equipment_item_id &&
                req.body.project_equipment_item_id !== pumpSelection.project_equipment_item_id)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'PUMP_SELECTION_NOT_READY', message: 'Select and recalculate the pump for this exact Flow Route circuit before calculating friction loss.' } });
        }
        const piping = await pipingCandidates(runner, context.project_id, system.id);
        const requestedComponents = Array.isArray(req.body.components) ? req.body.components : [];
        const components = requestedComponents.map((component, index) => {
            const source = piping.find((entry) => entry.project_piping_item_id === component.project_piping_item_id);
            if (!source)
                return null;
            return {
                project_piping_item_id: source.project_piping_item_id,
                piping_snapshot: source,
                side: component.side,
                component_kind: component.component_kind,
                sort_order: index,
                internal_diameter_mm: component.internal_diameter_mm,
                straight_length_m: component.straight_length_m,
                material: component.material,
                absolute_roughness_mm: component.absolute_roughness_mm,
                fitting_k_value: component.fitting_k_value,
                quantity: component.quantity,
            };
        });
        if (components.some((component) => !component)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'INELIGIBLE_PIPING_ITEM', message: 'Every pipe or fitting must be assigned to this project and LSS system.' } });
        }
        const calculatedAt = new Date().toISOString();
        const calculation = (0, frictionLossCalculations_1.calculateFrictionLoss)({
            flow_m3h: circuit.flow_m3h,
            selected_pump: selectedPump,
            components,
            calculated_at: calculatedAt,
        });
        if (calculation.status !== 'ready') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'VALIDATION', message: calculation.reasons.join(' '), reasons: calculation.reasons } });
        }
        const sourceSnapshot = (0, frictionLossCalculations_1.frictionSourceSnapshot)(circuit, selectedPump, components);
        const sourceFingerprint = (0, frictionLossCalculations_1.frictionSourceFingerprint)(sourceSnapshot);
        const saved = await runner(`INSERT INTO design_book_friction_loss_calculations
         (design_book_id, system_id, circuit_key, project_equipment_item_id,
          calculation_version, status, freshness, source_fingerprint,
          source_snapshot, input_snapshot, result_snapshot, calculated_by, calculated_at)
       VALUES ($1,$2,$3,$4,$5,'Ready','fresh',$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
       ON CONFLICT (design_book_id, system_id, circuit_key) DO UPDATE SET
         project_equipment_item_id=EXCLUDED.project_equipment_item_id,
         calculation_version=EXCLUDED.calculation_version, status=EXCLUDED.status,
         freshness='fresh', source_fingerprint=EXCLUDED.source_fingerprint,
         source_snapshot=EXCLUDED.source_snapshot, input_snapshot=EXCLUDED.input_snapshot,
         result_snapshot=EXCLUDED.result_snapshot, calculated_by=EXCLUDED.calculated_by,
         calculated_at=EXCLUDED.calculated_at, updated_at=NOW()
       RETURNING *`, [
            context.id, system.id, circuit.circuit_key, selectedPump.project_equipment_item_id,
            frictionLossCalculations_1.FRICTION_LOSS_CALCULATION_VERSION, sourceFingerprint, JSON.stringify(sourceSnapshot),
            JSON.stringify({ flow_m3h: circuit.flow_m3h, components }),
            JSON.stringify(calculation), req.user.id, calculatedAt,
        ]);
        await runner('DELETE FROM design_book_friction_loss_components WHERE calculation_id=$1', [saved.rows[0].id]);
        for (const component of components) {
            await runner(`INSERT INTO design_book_friction_loss_components
           (calculation_id, project_piping_item_id, side, component_kind, sort_order,
            piping_snapshot, internal_diameter_mm, straight_length_m, material,
            absolute_roughness_mm, fitting_k_value, quantity)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`, [
                saved.rows[0].id, component.project_piping_item_id, component.side,
                component.component_kind, component.sort_order, JSON.stringify(component.piping_snapshot),
                component.internal_diameter_mm, component.straight_length_m, component.material,
                component.absolute_roughness_mm, component.fitting_k_value, component.quantity,
            ]);
        }
        const refreshed = await (0, designBooks_1.loadFrictionLossPackages)(runner, context.id, [system]);
        await client.query('COMMIT');
        res.json(refreshed[0].items.find((entry) => entry.circuit_key === circuit.circuit_key));
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
