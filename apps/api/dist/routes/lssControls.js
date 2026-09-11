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
const designBooks_1 = require("./designBooks");
const lssSystems_1 = require("../lib/lssSystems");
const systemLifecycle_1 = require("../lib/systemLifecycle");
const lssControls_1 = require("../lib/lssControls");
const audit_1 = require("../db/audit");
const lssIoSchedule_1 = require("../lib/lssIoSchedule");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const CONTROL_QUERY_TIMEOUT_MS = 10000;
const controlQuery = (text, params) => db_1.default.query({
    text,
    values: params,
    query_timeout: CONTROL_QUERY_TIMEOUT_MS,
});
async function controlStage(stage, work) {
    const startedAt = Date.now();
    try {
        const result = await work();
        const durationMs = Date.now() - startedAt;
        if (durationMs > 1000) {
            console.warn('[lss-control] slow load stage', { stage, durationMs });
        }
        return result;
    }
    catch (error) {
        console.error('[lss-control] load stage failed', {
            stage,
            durationMs: Date.now() - startedAt,
            code: error?.code,
            message: error?.message,
        });
        throw error;
    }
}
function controlLoadFailure(res, error) {
    const timedOut = error?.code === '57014'
        || /timeout|timed out/i.test(String(error?.message || ''));
    if (timedOut) {
        return res.status(503).json({
            error: {
                code: 'CONTROL_LOAD_TIMEOUT',
                message: 'Control configuration is temporarily unavailable. Please retry.',
            },
        });
    }
    throw error;
}
const productSnapshot = async (runner, id) => {
    if (!id)
        return null;
    return (await runner('SELECT id, product_code, product_name, status FROM product_masters WHERE id=$1', [id])).rows[0] || null;
};
async function canManagePim(runner, userId, role) {
    if (role === 'admin')
        return true;
    const result = await runner(`SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key='pim'
      WHERE u.id=$1`, [userId]);
    return result.rows[0]?.access_level === 'manage';
}
const activeDefinitions = async (runner) => (await runner(`SELECT d.*, pm.product_code AS default_product_code, pm.product_name AS default_product_name,
          pm.status AS default_product_status
   FROM field_instrument_definitions d LEFT JOIN product_masters pm ON pm.id=d.default_product_master_id
   WHERE d.is_active=true ORDER BY d.sort_order,d.tag_code`)).rows;
function mergeHistoricalDefinitions(definitions, instruments) {
    const merged = new Map();
    for (const definition of definitions || []) {
        if (definition?.id)
            merged.set(definition.id, definition);
    }
    // Inactive and released definitions are deliberately reconstructed from the
    // instance evidence. Catalogue lifecycle changes must not erase design-book
    // readability or replace the governed definition used at allocation time.
    for (const instrument of instruments || []) {
        const snapshot = instrument?.definition_snapshot;
        const id = instrument?.definition_id || snapshot?.id;
        if (id && snapshot && Object.keys(snapshot).length && !merged.has(id)) {
            merged.set(id, { ...snapshot, id });
        }
    }
    return [...merged.values()].sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) ||
        String(left.tag_code || '').localeCompare(String(right.tag_code || '')));
}
function frozenPayload(saved, snapshot, systemId) {
    const instruments = saved?.instruments ||
        (snapshot.lss_instrument_instances || []).filter((item) => item.system_id === systemId);
    return {
        control: saved?.control || snapshot.lss_control_configurations?.find((item) => item.system_id === systemId) || null,
        instruments,
        definitions: mergeHistoricalDefinitions(saved?.definitions || [], instruments),
        frozen: true,
    };
}
async function pumpMinimum(runner, systemId) {
    const result = await runner(`SELECT COALESCE(SUM(COALESCE(pump_quantity,1)),0)::int AS quantity
     FROM system_pump_selections WHERE system_id=$1 AND project_equipment_item_id IS NOT NULL`, [systemId]);
    return Number(result.rows[0]?.quantity || 0);
}
async function responsePayload(runner, bookId, system, frozen = false) {
    const definitions = await activeDefinitions(runner);
    const instruments = (await runner(`SELECT i.*, pm.product_code,pm.product_name,pm.status AS product_status
     FROM design_book_lss_instruments i LEFT JOIN product_masters pm ON pm.id=i.product_master_id
     WHERE i.design_book_id=$1 AND i.system_id=$2 ORDER BY i.definition_snapshot->>'tag_code',i.sequence_number`, [bookId, system.id])).rows;
    const control = (await runner('SELECT * FROM design_book_lss_controls WHERE design_book_id=$1 AND system_id=$2', [bookId, system.id])).rows[0] || null;
    return {
        control, instruments, definitions: mergeHistoricalDefinitions(definitions, instruments),
        pump_linked_fs_minimum: await pumpMinimum(runner, system.id), frozen,
    };
}
async function bookAndSystem(bookId, systemId, runner = controlQuery) {
    // Control editing needs only the parent book and selected system. Loading the
    // full Design Book aggregate here used to execute every engineering package
    // query and made this small panel vulnerable to unrelated catalogue locks.
    const book = (await runner('SELECT id,project_id,status,review_snapshot,release_snapshot FROM design_books WHERE id=$1', [bookId])).rows[0] || null;
    if (!book)
        return { book: null, system: null };
    const system = (await runner('SELECT * FROM systems WHERE id=$1 AND project_id=$2', [systemId, book.project_id])).rows[0] || null;
    return { book, system };
}
router.get('/systems/:id/control/io-schedule.pdf', async (req, res) => {
    const bookId = String(req.query.design_book_id || '');
    if (!bookId)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
    // Keep the same source-of-truth rule as the control screen: draft books
    // render saved live instances, while review/released books render only the
    // frozen package captured for that state.
    // Determine frozen state before loading the live aggregate. In particular,
    // loadReleaseContext's live aggregate joins current PIM product rows, which
    // must never be consulted while rendering a frozen book.
    const stored = (await (0, db_1.query)('SELECT id,book_code,book_title,project_id,status,review_snapshot,release_snapshot FROM design_books WHERE id=$1', [bookId])).rows[0];
    if (!stored)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design Book not found.' } });
    const frozenStatus = stored.status === 'Released' || ['For Review', 'Approved'].includes(stored.status);
    const frozenSnapshot = stored.status === 'Released' ? stored.release_snapshot
        : ['For Review', 'Approved'].includes(stored.status) ? stored.review_snapshot : null;
    if (frozenStatus && !frozenSnapshot) {
        return res.status(409).json({
            error: {
                code: 'DESIGN_BOOK_SNAPSHOT_MISSING',
                message: 'The frozen Design Book evidence required for this I/O schedule is unavailable.',
            },
        });
    }
    const book = frozenSnapshot ? stored : await (0, designBooks_1.loadReleaseContext)(bookId, db_1.query, false, true);
    const source = frozenSnapshot || book;
    // Resolve issued work from the frozen package itself. A renamed, retired, or
    // removed live system must not change whether an issued schedule can export.
    const selectedSystem = (source.systems || []).find((system) => system.id === req.params.id);
    if (!selectedSystem || !(0, lssSystems_1.isLifeSupportSystem)(selectedSystem)) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
    }
    const systems = [selectedSystem];
    const controls = (source.lss_controls || []).filter((item) => item.system_id === selectedSystem.id);
    // Some older snapshots retained the flat compatibility arrays only.
    const packages = controls.length
        ? controls
        : [{
                system_id: selectedSystem.id,
                control: (source.lss_control_configurations || []).find((item) => item.system_id === selectedSystem.id) || null,
                instruments: (source.lss_instrument_instances || []).filter((item) => item.system_id === selectedSystem.id),
            }];
    const pdf = await (0, lssIoSchedule_1.renderLssIoSchedulePdf)(book, (0, lssIoSchedule_1.projectLssIoSchedule)(systems, packages));
    const safeBookCode = String(book.book_code || 'lss-io-schedule').replace(/[^a-z0-9_.-]/gi, '-');
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeBookCode}-lss-io-schedule.pdf"`,
        'Cache-Control': 'no-store',
    });
    return res.send(pdf);
});
router.get('/systems/:id/control', async (req, res) => {
    const bookId = String(req.query.design_book_id || '');
    if (!bookId)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
    try {
        const { book: stored, system: liveSystem } = await controlStage('book-and-system', () => bookAndSystem(bookId, String(req.params.id)));
        if (!stored)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design Book not found.' } });
        if (stored.status === 'Released' || ['For Review', 'Approved'].includes(stored.status)) {
            const snapshot = stored.status === 'Released' ? stored.release_snapshot : stored.review_snapshot;
            if (!snapshot) {
                return res.status(409).json({
                    error: {
                        code: 'DESIGN_BOOK_SNAPSHOT_MISSING',
                        message: 'The frozen Design Book evidence required for this control configuration is unavailable.',
                    },
                });
            }
            const system = (snapshot.systems || []).find((value) => value.id === req.params.id);
            if (!system || !(0, lssSystems_1.isLifeSupportSystem)(system)) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
            }
            const saved = snapshot.lss_controls?.find((item) => item.system_id === system.id);
            return res.json(frozenPayload(saved, snapshot, system.id));
        }
        if (!liveSystem || !(0, lssSystems_1.isLifeSupportSystem)(liveSystem)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
        }
        if ((0, systemLifecycle_1.isRetiredSystem)(liveSystem))
            return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(liveSystem) });
        const payload = await controlStage('configuration-payload', () => responsePayload(controlQuery, bookId, liveSystem));
        return res.json(payload);
    }
    catch (error) {
        return controlLoadFailure(res, error);
    }
});
router.put('/systems/:id/control', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const input = req.body || {};
    const bookId = String(input.design_book_id || '');
    if (!bookId || !['GPO', 'PLC'].includes(input.panel_type))
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id and panel_type (GPO or PLC) are required.' } });
    const { book, system } = await bookAndSystem(bookId, String(req.params.id), db_1.query);
    if (!book || !system || !(0, lssSystems_1.isLifeSupportSystem)(system))
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
    if (!['Draft', 'In Progress'].includes(book.status))
        return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
    if ((0, systemLifecycle_1.isRetiredSystem)(system))
        return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system) });
    if (!Array.isArray(input.instruments))
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'instruments must be an array.' } });
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lss-instruments:${bookId}:${system.id}`]);
        const definitions = await activeDefinitions(client.query.bind(client));
        const requested = new Map();
        for (const item of input.instruments) {
            const definition = definitions.find((value) => value.id === item.definition_id);
            const quantity = Number(item.quantity);
            const productSupplied = (0, lssControls_1.hasExplicitInstrumentProductOverride)(item);
            const rangeSupplied = ['range_min', 'range_max', 'unit'].some(key => Object.prototype.hasOwnProperty.call(item, key));
            const calibrationSupplied = ['calibration_required', 'calibration_interval_days', 'calibration_procedure', 'datasheet_reference']
                .some(key => Object.prototype.hasOwnProperty.call(item, key));
            if (!definition || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: { code: 'VALIDATION', message: 'Each instrument needs an active definition and quantity from 0 to 99.' } });
            }
            if (requested.has(definition.id)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: { code: 'VALIDATION', message: 'Each instrument definition may be supplied once.' } });
            }
            const rangeMin = item.range_min === '' || item.range_min == null ? null : Number(item.range_min);
            const rangeMax = item.range_max === '' || item.range_max == null ? null : Number(item.range_max);
            const interval = item.calibration_interval_days === '' || item.calibration_interval_days == null
                ? null : Number(item.calibration_interval_days);
            if ((rangeSupplied && !definition.allow_range_override) || (calibrationSupplied && !definition.allow_calibration_override)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: { code: 'INSTRUMENT_OVERRIDE_NOT_PERMITTED', message: `${definition.name} does not permit this evidence override.` } });
            }
            if ((rangeMin != null && !Number.isFinite(rangeMin)) || (rangeMax != null && !Number.isFinite(rangeMax)) ||
                (rangeMin != null && rangeMax != null && rangeMin > rangeMax) ||
                (interval != null && (!Number.isInteger(interval) || interval < 1))) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: { code: 'VALIDATION', message: `${definition.name} has an invalid range or calibration interval.` } });
            }
            // Supplying null is a deliberate product override too: clearing a
            // product must have the same PIM-manage permission as changing it.
            if (productSupplied) {
                if (!await canManagePim(client.query.bind(client), req.user.id, req.user.role)) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: { code: 'MODULE_READ_ONLY', message: 'PIM manage access is required to override an instrument product.' } });
                }
                const product = item.product_master_id
                    ? await productSnapshot(client.query.bind(client), item.product_master_id)
                    : null;
                if (item.product_master_id && (!product || product.status !== 'Active')) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: { code: 'INVALID_PRODUCT', message: 'Select an active PIM product for an instrument override.' } });
                }
            }
            requested.set(definition.id, {
                quantity, product_master_id: item.product_master_id || null,
                product_supplied: productSupplied,
                control_logic: String(item.control_logic || '').trim() || null,
                control_logic_supplied: Object.prototype.hasOwnProperty.call(item, 'control_logic'),
                range_min: rangeMin, range_max: rangeMax, unit: String(item.unit || '').trim() || null, range_supplied: rangeSupplied,
                calibration_required: item.calibration_required === true, calibration_interval_days: interval,
                calibration_procedure: String(item.calibration_procedure || '').trim() || null,
                datasheet_reference: String(item.datasheet_reference || '').trim() || null,
                calibration_supplied: calibrationSupplied,
            });
        }
        const minimum = await pumpMinimum(client.query.bind(client), system.id);
        const mandatory = definitions.find((definition) => definition.requirement_rule === 'mandatory' && (requested.get(definition.id)?.quantity || 0) < 1);
        if (mandatory) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'MANDATORY_INSTRUMENT', message: `${mandatory.name} requires at least one instrument.`, definition_id: mandatory.id } });
        }
        const underCountedPumpLinked = definitions.find((definition) => definition.requirement_rule === 'pump_linked' && (requested.get(definition.id)?.quantity || 0) < minimum);
        if (underCountedPumpLinked) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: { code: 'MANDATORY_FLOW_SWITCHES', message: `${underCountedPumpLinked.name} quantity cannot be lower than the ${minimum} configured pump(s).`, minimum, definition_id: underCountedPumpLinked.id } });
        }
        await client.query(`INSERT INTO design_book_lss_controls (design_book_id,system_id,panel_type,updated_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (design_book_id,system_id)
       DO UPDATE SET panel_type=EXCLUDED.panel_type,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, [bookId, system.id, input.panel_type, req.user.id]);
        const existing = (await client.query('SELECT * FROM design_book_lss_instruments WHERE design_book_id=$1 AND system_id=$2 FOR UPDATE', [bookId, system.id])).rows;
        for (const definition of definitions) {
            const desired = requested.get(definition.id)?.quantity || 0;
            const rows = existing.filter(row => row.definition_id === definition.id).sort((a, b) => a.sequence_number - b.sequence_number);
            const requestedInstrument = requested.get(definition.id);
            if (rows.length > desired)
                await client.query('DELETE FROM design_book_lss_instruments WHERE id = ANY($1::uuid[])', [rows.slice(desired).map(row => row.id)]);
            const requestedProduct = requestedInstrument;
            // Existing selections are frozen designer evidence. Each newly added
            // instance imports the active definition default unless the designer
            // deliberately supplied an override in this save; it must never inherit
            // a prior instance's product or a later catalogue edit.
            const selectedProduct = (0, lssControls_1.initialInstrumentProduct)(definition.default_product_master_id, requestedProduct);
            const controlLogic = (0, lssControls_1.initialInstrumentControlLogic)(definition.default_control_logic, requestedProduct);
            const rangeMin = requestedProduct?.range_supplied ? requestedProduct.range_min : definition.default_range_min;
            const rangeMax = requestedProduct?.range_supplied ? requestedProduct.range_max : definition.default_range_max;
            const unit = requestedProduct?.range_supplied ? requestedProduct.unit : definition.default_unit;
            const calibrationRequired = requestedProduct?.calibration_supplied ? requestedProduct.calibration_required : definition.default_calibration_required;
            const calibrationInterval = requestedProduct?.calibration_supplied ? requestedProduct.calibration_interval_days : definition.default_calibration_interval_days;
            const calibrationProcedure = requestedProduct?.calibration_supplied ? requestedProduct.calibration_procedure : definition.default_calibration_procedure;
            const datasheetReference = requestedProduct?.calibration_supplied ? requestedProduct.datasheet_reference : definition.default_datasheet_reference;
            for (let sequence = rows.length + 1; sequence <= desired; sequence++) {
                const product = await productSnapshot(client.query.bind(client), selectedProduct);
                await client.query(`INSERT INTO design_book_lss_instruments
            (design_book_id,system_id,definition_id,tag,sequence_number,control_logic,range_min,range_max,unit,
             calibration_required,calibration_interval_days,calibration_procedure,datasheet_reference,
             product_master_id,definition_snapshot,product_snapshot,created_by,updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$17)`, [bookId, system.id, definition.id, (0, lssControls_1.buildInstrumentTag)(system.system_code, definition.tag_code, sequence),
                    sequence, controlLogic, rangeMin, rangeMax, unit, calibrationRequired, calibrationInterval,
                    calibrationProcedure, datasheetReference, selectedProduct, JSON.stringify(definition), JSON.stringify(product), req.user.id]);
            }
            if (rows.length && requestedProduct?.product_supplied) {
                const product = await productSnapshot(client.query.bind(client), selectedProduct);
                await client.query('UPDATE design_book_lss_instruments SET product_master_id=$1,product_snapshot=$2::jsonb,updated_by=$3,updated_at=NOW() WHERE id=ANY($4::uuid[])', [selectedProduct, JSON.stringify(product), req.user.id, rows.slice(0, desired).map(row => row.id)]);
            }
            if (rows.length && requestedProduct?.control_logic_supplied) {
                await client.query('UPDATE design_book_lss_instruments SET control_logic=$1,updated_by=$2,updated_at=NOW() WHERE id=ANY($3::uuid[])', [requestedProduct.control_logic, req.user.id, rows.slice(0, desired).map(row => row.id)]);
            }
            if (rows.length && requestedProduct?.range_supplied) {
                await client.query('UPDATE design_book_lss_instruments SET range_min=$1,range_max=$2,unit=$3,updated_by=$4,updated_at=NOW() WHERE id=ANY($5::uuid[])', [requestedProduct.range_min, requestedProduct.range_max, requestedProduct.unit, req.user.id, rows.slice(0, desired).map(row => row.id)]);
            }
            if (rows.length && requestedProduct?.calibration_supplied) {
                await client.query(`UPDATE design_book_lss_instruments SET calibration_required=$1,calibration_interval_days=$2,
           calibration_procedure=$3,datasheet_reference=$4,updated_by=$5,updated_at=NOW() WHERE id=ANY($6::uuid[])`, [requestedProduct.calibration_required, requestedProduct.calibration_interval_days,
                    requestedProduct.calibration_procedure, requestedProduct.datasheet_reference, req.user.id,
                    rows.slice(0, desired).map(row => row.id)]);
            }
        }
        await client.query('COMMIT');
        await (0, audit_1.logAudit)(req.user.id, 'design_book_lss_control', `${bookId}:${system.id}`, 'UPDATE', { panel_type: input.panel_type });
        res.json(await responsePayload(db_1.query, bookId, system));
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505')
            return res.status(409).json({ error: { code: 'DUPLICATE_TAG', message: 'Instrument tag allocation conflicted; retry the save.' } });
        throw error;
    }
    finally {
        client.release();
    }
});
exports.default = router;
