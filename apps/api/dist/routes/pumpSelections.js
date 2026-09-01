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
const pumpSelections_1 = require("../lib/pumpSelections");
const designBooks_1 = require("./designBooks");
const systemLifecycle_1 = require("../lib/systemLifecycle");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const numberOrNull = (value) => value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
const allowedPumpRoles = new Set([pumpSelections_1.PUMP_ROLE_PRIMARY, pumpSelections_1.PUMP_ROLE_VENTURI]);
async function candidates(runner, projectId, systemId) {
    return (await runner(`SELECT pei.id, pei.id AS project_equipment_item_id, pei.equip_code, pei.quantity, pei.description,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer, pm.model,
            pm.design_flow_m3h, pm.design_head_m,
             COALESCE(pe.rated_power_kw, pm.power_kw) AS power_kw,
             pf.product_family_code, pm.product_category, pm.application_type
     FROM project_equipment_items pei
     LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE pei.project_id=$1 AND pei.system_id=$2
       AND (pm.id IS NULL OR pm.status IS NULL OR pm.status='Active')
       AND (
         pm.id IS NULL
         OR UPPER(COALESCE(pm.product_category,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.category_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.product_family_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pei.description,'')) LIKE '%PUMP%'
         /* Compatibility only for legacy unclassified catalog rows. */
         OR ((pm.product_category IS NULL OR BTRIM(pm.product_category)='')
             AND (pf.category_code IS NULL OR BTRIM(pf.category_code)='')
             AND (UPPER(COALESCE(pm.application_type,'')) LIKE '%PUMP%'
                  OR UPPER(pm.product_name) LIKE '%PUMP%'))
       )
     ORDER BY pei.equip_code`, [projectId, systemId])).rows;
}
async function liveItems(runner, system) {
    const sideStreams = (await runner('SELECT * FROM system_flow_side_streams WHERE system_id=$1 ORDER BY parent_loop_number, sort_order, created_at, id', [system.id])).rows;
    const saved = (await runner('SELECT * FROM system_pump_selections WHERE system_id=$1', [system.id])).rows;
    const circuitMap = new Map((0, pumpSelections_1.pumpCircuits)(system, sideStreams).map(item => [item.circuit_key, item]));
    // Retain orphaned saved rows so stale evidence remains auditable.
    saved.forEach(row => {
        if (!circuitMap.has(row.circuit_key))
            circuitMap.set(row.circuit_key, {
                circuit_key: row.circuit_key, circuit_kind: 'orphaned', circuit_name: row.circuit_key,
                circuit_type: null, parent_loop_number: null, side_stream_id: null, flow_m3h: null,
            });
    });
    return [...circuitMap.values()].flatMap(circuit => (0, pumpSelections_1.pumpLinesForCircuit)(circuit, saved));
}
// ---------------------------------------------------------------------------
// GET /systems/:id/pump-selections
// ---------------------------------------------------------------------------
router.get('/systems/:id/pump-selections', async (req, res) => {
    const book = await (0, db_1.query)('SELECT * FROM design_books WHERE id=$1', [req.query.design_book_id]);
    if (!book.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const designBook = book.rows[0];
    if (['For Review', 'Approved'].includes(designBook.status) && designBook.review_snapshot) {
        return res.json({
            items: (designBook.review_snapshot.pump_selections || [])
                .filter((item) => item.system_id === req.params.id)
                .flatMap((x) => x.items || []),
            pump_candidates: [], frozen: true,
        });
    }
    if (designBook.status === 'Released' && designBook.release_snapshot) {
        return res.json({
            items: (designBook.release_snapshot.pump_selections || [])
                .filter((item) => item.system_id === req.params.id)
                .flatMap((x) => x.items || []),
            pump_candidates: [], frozen: true,
        });
    }
    const context = await (0, designBooks_1.loadReleaseContext)(designBook.id, db_1.query, false, true);
    const system = context?.systems?.find((item) => item.id === req.params.id);
    if (!system)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
    if ((0, systemLifecycle_1.isRetiredSystem)(system))
        return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system) });
    res.json({
        items: await liveItems(db_1.query, system),
        pump_candidates: await candidates(db_1.query, designBook.project_id, String(req.params.id)),
        frozen: false,
    });
});
// ---------------------------------------------------------------------------
// PUT /systems/:id/pump-selections  — save / recalculate one pump line
// ---------------------------------------------------------------------------
router.put('/systems/:id/pump-selections', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const input = req.body || {};
    const bookResult = await (0, db_1.query)('SELECT * FROM design_books WHERE id=$1', [input.design_book_id]);
    const book = bookResult.rows[0];
    if (!book)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (!['Draft', 'In Progress'].includes(book.status))
        return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
    const context = await (0, designBooks_1.loadReleaseContext)(book.id, db_1.query, false, true);
    const system = context?.systems?.find((item) => item.id === req.params.id);
    if (!system)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
    if ((0, systemLifecycle_1.isRetiredSystem)(system))
        return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system) });
    const allLines = await liveItems(db_1.query, system);
    const pumpRole = input.pump_role || pumpSelections_1.PUMP_ROLE_PRIMARY;
    if (!allowedPumpRoles.has(pumpRole)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'pump_role must be primary or venturi.' } });
    }
    const line = allLines.find(item => item.circuit_key === input.circuit_key && item.pump_role === pumpRole);
    if (!line || line.circuit_kind === 'orphaned') {
        return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit key or pump role is not active in the saved Flow Route.' } });
    }
    // For FFVP lines the flow basis comes from the explicit venturi_flow_m3h input.
    const isVenturi = pumpRole === pumpSelections_1.PUMP_ROLE_VENTURI;
    const effectiveFlow = isVenturi
        ? numberOrNull(input.venturi_flow_m3h)
        : line.flow_m3h;
    if (isVenturi && (effectiveFlow == null || effectiveFlow <= 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Venturi duty flow is required and must be greater than zero.' } });
    }
    const calculation = (0, pumpSelections_1.calculatePumpSelection)({
        flow_m3h: effectiveFlow,
        design_head_m: input.design_head_m,
        pump_efficiency_pct: input.pump_efficiency_pct,
        motor_efficiency_pct: input.motor_efficiency_pct,
    });
    if (calculation.status !== 'ready') {
        return res.status(400).json({ error: { code: 'VALIDATION', message: calculation.reasons.join(' ') } });
    }
    let selected = null;
    if (input.project_equipment_item_id) {
        selected = (await candidates(db_1.query, book.project_id, system.id)).find((item) => item.project_equipment_item_id === input.project_equipment_item_id);
        if (!selected)
            return res.status(400).json({ error: { code: 'INELIGIBLE_PUMP', message: 'Selected equipment is not an eligible pump assigned to this system and project.' } });
    }
    // Build a label-independent fingerprint source. Circuit names are display
    // labels and must not make saved pump sizing stale when they are renamed.
    const circuit = line;
    const sourcePayload = (0, pumpSelections_1.pumpSourcePayload)(circuit, pumpRole, effectiveFlow, {
        design_head_m: numberOrNull(input.design_head_m),
        pump_efficiency_pct: numberOrNull(input.pump_efficiency_pct),
        motor_efficiency_pct: numberOrNull(input.motor_efficiency_pct),
    });
    await (0, db_1.query)(`INSERT INTO system_pump_selections
       (system_id,circuit_key,project_equipment_item_id,
        design_head_m,pump_efficiency_pct,motor_efficiency_pct,
        source_fingerprint,pump_snapshot,calculation_version,result_snapshot,updated_by,
        pump_role,venturi_flow_m3h)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13)
     ON CONFLICT (system_id,circuit_key,pump_role) DO UPDATE SET
       project_equipment_item_id=EXCLUDED.project_equipment_item_id,
       design_head_m=EXCLUDED.design_head_m,
       pump_efficiency_pct=EXCLUDED.pump_efficiency_pct,
       motor_efficiency_pct=EXCLUDED.motor_efficiency_pct,
       venturi_flow_m3h=EXCLUDED.venturi_flow_m3h,
       source_fingerprint=EXCLUDED.source_fingerprint,
       pump_snapshot=EXCLUDED.pump_snapshot,
       calculation_version=EXCLUDED.calculation_version,
       result_snapshot=EXCLUDED.result_snapshot,
       updated_by=EXCLUDED.updated_by,
       updated_at=NOW()`, [
        system.id, input.circuit_key, selected?.project_equipment_item_id || null,
        input.design_head_m, input.pump_efficiency_pct, input.motor_efficiency_pct,
        (0, pumpSelections_1.pumpSourceFingerprint)(sourcePayload),
        JSON.stringify(selected),
        calculation.calculation_version,
        JSON.stringify(calculation),
        req.user.id,
        pumpRole,
        isVenturi ? effectiveFlow : null,
    ]);
    const updatedLines = await liveItems(db_1.query, system);
    const item = updatedLines.find(value => value.circuit_key === input.circuit_key && value.pump_role === pumpRole);
    res.json(item);
});
// ---------------------------------------------------------------------------
// POST /systems/:id/pump-lines — create a project equipment pump and prepare
//   its allocation for a Flow Route circuit.
//   This creates a project_equipment_items record scoped to the current project
//   and LSS system.  The pump selection itself is saved separately via PUT.
// ---------------------------------------------------------------------------
router.post('/systems/:id/pump-lines', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const input = req.body || {};
    const bookResult = await (0, db_1.query)('SELECT * FROM design_books WHERE id=$1', [input.design_book_id]);
    const book = bookResult.rows[0];
    if (!book)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (!['Draft', 'In Progress'].includes(book.status))
        return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
    const context = await (0, designBooks_1.loadReleaseContext)(book.id, db_1.query, false, true);
    const system = context?.systems?.find((item) => item.id === req.params.id);
    if (!system)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
    if ((0, systemLifecycle_1.isRetiredSystem)(system))
        return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system) });
    const pumpRole = input.pump_role || pumpSelections_1.PUMP_ROLE_PRIMARY;
    if (!allowedPumpRoles.has(pumpRole)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'pump_role must be primary or venturi.' } });
    }
    const circuitKey = input.circuit_key;
    if (!circuitKey)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'circuit_key is required.' } });
    // Validate that the circuit exists and is active. A first FFVP line is not
    // returned by liveItems until it has been saved, so validate its parent
    // primary circuit rather than requiring the not-yet-existing venturi line.
    const allLines = await liveItems(db_1.query, system);
    const primaryLine = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === pumpSelections_1.PUMP_ROLE_PRIMARY);
    const existingLine = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === pumpRole);
    const circuitLine = pumpRole === pumpSelections_1.PUMP_ROLE_VENTURI ? primaryLine : existingLine;
    if (!circuitLine || circuitLine.circuit_kind === 'orphaned') {
        return res.status(409).json({
            error: {
                code: 'INACTIVE_PUMP_DUTY',
                message: 'This pump duty is no longer active in Flow Route. Historical evidence remains available for review.',
            },
        });
    }
    // For FFVP: only allowed on Foam Fractionator circuits.
    if (pumpRole === pumpSelections_1.PUMP_ROLE_VENTURI) {
        if (!primaryLine || !(0, pumpSelections_1.isFoamFractionatorCircuit)(primaryLine)) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'Venturi pump lines are only supported on Foam Fractionator circuits.' } });
        }
    }
    // Generate a default equip_code if none supplied.
    const equipCode = (input.equip_code || '').trim() || await generateEquipCode(book.project_id, pumpRole, circuitLine);
    const description = (input.description || '').trim() || (0, pumpSelections_1.defaultPumpLineName)(circuitLine || { circuit_name: circuitKey, circuit_type: null, circuit_kind: 'loop' }, pumpRole);
    // Check equip_code uniqueness.
    const existing = await (0, db_1.query)('SELECT id FROM project_equipment_items WHERE project_id=$1 AND equip_code=$2', [book.project_id, equipCode]);
    if (existing.rows.length) {
        return res.status(409).json({ error: { code: 'DUPLICATE_EQUIP_CODE', message: `Equipment code "${equipCode}" already exists on this project. Provide a unique code.` } });
    }
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${system.id}:${circuitKey}:${pumpRole}`]);
        const lockedSelection = (await client.query(`SELECT * FROM system_pump_selections
       WHERE system_id=$1 AND circuit_key=$2 AND pump_role=$3
       FOR UPDATE`, [system.id, circuitKey, pumpRole])).rows[0];
        if (lockedSelection?.project_equipment_item_id) {
            await client.query('COMMIT');
            const circuit = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === pumpSelections_1.PUMP_ROLE_PRIMARY);
            return res.status(200).json({
                project_equipment_item: lockedSelection.pump_snapshot,
                pump_line: (0, pumpSelections_1.buildPumpLineItem)(circuit, lockedSelection, pumpRole),
                idempotent: true,
            });
        }
        const result = await client.query(`INSERT INTO project_equipment_items
         (equip_code, project_id, system_id, description, quantity, unit, status)
       VALUES ($1,$2,$3,$4,1,'EA','Design')
       RETURNING *`, [equipCode, book.project_id, system.id, description]);
        const pei = result.rows[0];
        const circuit = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === pumpSelections_1.PUMP_ROLE_PRIMARY);
        if (!circuit) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit key is not active in the saved Flow Route.' } });
        }
        // Governed product hydraulics are the preferred seed. If the selected
        // products do not expose a complete venturi duty, use the resolved FFSP
        // Flow Route demand and persist it as the FFVP's explicit duty.
        const positiveNumberOrNull = (value) => {
            const number = numberOrNull(value);
            return number != null && number > 0 ? number : null;
        };
        const venturiFlow = pumpRole === pumpSelections_1.PUMP_ROLE_VENTURI
            ? (positiveNumberOrNull(circuit.venturi_flow_m3h)
                ?? positiveNumberOrNull(input.venturi_flow_m3h)
                ?? positiveNumberOrNull(circuit.flow_m3h))
            : null;
        const source = (0, pumpSelections_1.pumpSourcePayload)(circuit, pumpRole, pumpRole === pumpSelections_1.PUMP_ROLE_VENTURI ? venturiFlow : circuit.flow_m3h, {
            design_head_m: existingLine?.design_head_m ?? null,
            pump_efficiency_pct: existingLine?.pump_efficiency_pct ?? null,
            motor_efficiency_pct: existingLine?.motor_efficiency_pct ?? null,
        });
        const calculation = (0, pumpSelections_1.calculatePumpSelection)({
            flow_m3h: pumpRole === pumpSelections_1.PUMP_ROLE_VENTURI ? venturiFlow : circuit.flow_m3h,
            design_head_m: existingLine?.design_head_m,
            pump_efficiency_pct: existingLine?.pump_efficiency_pct,
            motor_efficiency_pct: existingLine?.motor_efficiency_pct,
        });
        const snapshot = {
            ...pei,
            id: pei.id,
            project_equipment_item_id: pei.id,
        };
        await client.query(`INSERT INTO system_pump_selections
         (system_id,circuit_key,project_equipment_item_id,design_head_m,
           pump_efficiency_pct,motor_efficiency_pct,source_fingerprint,pump_snapshot,
          calculation_version,result_snapshot,updated_by,pump_role,venturi_flow_m3h)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13)
        ON CONFLICT (system_id,circuit_key,pump_role) DO UPDATE SET
          project_equipment_item_id=EXCLUDED.project_equipment_item_id,
          design_head_m=EXCLUDED.design_head_m,
          pump_efficiency_pct=EXCLUDED.pump_efficiency_pct,
          motor_efficiency_pct=EXCLUDED.motor_efficiency_pct,
          source_fingerprint=EXCLUDED.source_fingerprint,
          pump_snapshot=EXCLUDED.pump_snapshot,
          calculation_version=EXCLUDED.calculation_version,
          result_snapshot=EXCLUDED.result_snapshot,
          updated_by=EXCLUDED.updated_by,
          venturi_flow_m3h=EXCLUDED.venturi_flow_m3h,
          updated_at=NOW()`, [
            system.id, circuitKey, pei.id,
            existingLine?.design_head_m ?? null,
            existingLine?.pump_efficiency_pct ?? null,
            existingLine?.motor_efficiency_pct ?? null,
            (0, pumpSelections_1.pumpSourceFingerprint)(source), JSON.stringify(snapshot),
            pumpSelections_1.PUMP_SELECTION_CALCULATION_VERSION, JSON.stringify(calculation),
            req.user.id, pumpRole, venturiFlow,
        ]);
        await client.query('COMMIT');
        res.status(201).json({ project_equipment_item: pei, pump_line: (0, pumpSelections_1.buildPumpLineItem)(circuit, {
                project_equipment_item_id: pei.id,
                pump_snapshot: snapshot,
                source_fingerprint: (0, pumpSelections_1.pumpSourceFingerprint)(source),
                calculation_version: pumpSelections_1.PUMP_SELECTION_CALCULATION_VERSION,
                result_snapshot: calculation,
                pump_role: pumpRole,
                venturi_flow_m3h: venturiFlow,
            }, pumpRole) });
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') {
            return res.status(409).json({ error: { code: 'DUPLICATE_PUMP_LINE', message: 'A pump line with this role or equipment code already exists.' } });
        }
        throw error;
    }
    finally {
        client.release();
    }
});
// ---------------------------------------------------------------------------
// DELETE /systems/:id/pump-lines — remove a FFVP selection row.
//   Only the venturi role can be removed this way; primary lines are removed
//   by deleting the equipment item from the project equipment list.
//   The associated project_equipment_items record is NOT deleted here so the
//   PEI remains visible in the project equipment view for audit purposes.
// ---------------------------------------------------------------------------
router.delete('/systems/:id/pump-lines', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const designBookId = req.query.design_book_id;
    const circuitKey = req.query.circuit_key;
    const pumpRole = req.query.pump_role;
    if (!designBookId || !circuitKey || !pumpRole) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id, circuit_key, and pump_role are required.' } });
    }
    if (pumpRole !== pumpSelections_1.PUMP_ROLE_VENTURI) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Only a venturi pump line can be removed via this endpoint.' } });
    }
    const bookResult = await (0, db_1.query)('SELECT * FROM design_books WHERE id=$1', [designBookId]);
    const book = bookResult.rows[0];
    if (!book)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (!['Draft', 'In Progress'].includes(book.status))
        return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
    const context = await (0, designBooks_1.loadReleaseContext)(book.id, db_1.query, false, true);
    const system = context?.systems?.find((item) => item.id === req.params.id);
    if (!system) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
    }
    if ((0, systemLifecycle_1.isRetiredSystem)(system))
        return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system) });
    const sideStreams = (await (0, db_1.query)('SELECT * FROM system_flow_side_streams WHERE system_id=$1 ORDER BY parent_loop_number, sort_order, created_at, id', [system.id])).rows;
    const circuit = (0, pumpSelections_1.pumpCircuits)(system, sideStreams).find(item => item.circuit_key === circuitKey);
    if (!circuit || !(0, pumpSelections_1.isFoamFractionatorCircuit)(circuit)) {
        return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'The venturi line belongs to an active Foam Fractionator circuit.' } });
    }
    await (0, db_1.query)('DELETE FROM system_pump_selections WHERE system_id=$1 AND circuit_key=$2 AND pump_role=$3', [req.params.id, circuitKey, pumpRole]);
    res.json({ ok: true });
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function generateEquipCode(projectId, role, circuit) {
    const prefix = role === pumpSelections_1.PUMP_ROLE_VENTURI ? 'FFVP'
        : (0, pumpSelections_1.isFoamFractionatorCircuit)(circuit) && role === pumpSelections_1.PUMP_ROLE_PRIMARY ? 'FFSP'
            : (0, pumpSelections_1.isSandFilterCircuit)(circuit) && role === pumpSelections_1.PUMP_ROLE_PRIMARY ? 'SFSP'
                : 'PUMP';
    // Find a free sequential code.
    const existing = await (0, db_1.query)(`SELECT equip_code FROM project_equipment_items WHERE project_id=$1 AND equip_code LIKE $2 ORDER BY equip_code`, [projectId, `${prefix}-%`]);
    const usedNumbers = new Set(existing.rows.map((row) => {
        const match = String(row.equip_code).match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : null;
    }).filter(Boolean));
    let seq = 1;
    while (usedNumbers.has(seq))
        seq++;
    return `${prefix}-${String(seq).padStart(3, '0')}`;
}
exports.default = router;
