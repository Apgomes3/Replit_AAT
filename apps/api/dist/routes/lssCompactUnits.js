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
exports.lssCompactUnitTestUtils = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = __importStar(require("../db"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const FIELDS = `
  lcu.*,
  pm.product_code, pm.product_name
`;
const JOIN = `
  FROM lss_compact_units lcu
  LEFT JOIN product_masters pm ON lcu.product_master_id = pm.id
`;
const EQUIPMENT_JSON = `
  COALESCE((
    SELECT json_agg(e ORDER BY e.sort_order, e.created_at, e.id)
    FROM lss_compact_unit_equipment e
    WHERE e.compact_unit_id = lcu.id
  ), '[]'::json) AS equipment
`;
const BOM_LINE_SELECT = `
  SELECT bl.*,
         c.component_code AS source_component_code,
         c.standard_size AS source_size_or_power,
         c.unit AS component_unit,
         COALESCE(bl.component_name, c.component_name, sub_pm.product_name) AS resolved_component_name,
         sub_pm.product_code AS sub_product_code,
         sub_pm.product_name AS sub_product_name,
         sub_pm.power_kw AS sub_product_power_kw,
         sub_pm.length_mm AS sub_product_length_mm,
         sub_pm.width_mm AS sub_product_width_mm
  FROM bom_lines bl
  LEFT JOIN components c ON c.id = bl.component_id
  LEFT JOIN product_masters sub_pm ON sub_pm.id = bl.sub_product_id
  WHERE bl.standard_bom_id=$1
  ORDER BY bl.line_number
`;
function isFiltrationLine(line) {
    return /(filter|filtrat|screen|strainer|uv|ozone|foam|protein|bio(?:logical)?|media|skimmer|fractionator|polish)/i
        .test([line.component_type, line.component_name, line.resolved_component_name].filter(Boolean).join(' '));
}
function normalizedBomLine(line, bom) {
    const dimensions = [line.sub_product_length_mm, line.sub_product_width_mm]
        .filter(value => value != null)
        .join(' × ');
    const sourceSizeOrPower = line.source_size_or_power
        || (line.sub_product_power_kw != null ? `${line.sub_product_power_kw} kW` : '')
        || (dimensions ? `${dimensions} mm` : null);
    return {
        source_bom_line_id: line.id,
        source_component_id: line.component_id || null,
        source_bom_id: bom.id,
        line_number: line.line_number,
        component_type: line.component_type || null,
        component_reference_code: line.component_reference_code || line.source_component_code || null,
        component_name: line.resolved_component_name || line.component_name || 'Unnamed equipment',
        quantity: line.quantity == null ? 1 : Number(line.quantity),
        unit: line.unit || line.component_unit || 'EA',
        is_optional: Boolean(line.is_optional),
        included: true,
        is_filtration: isFiltrationLine(line),
        size_or_power: sourceSizeOrPower || null,
        size_or_power_override: null,
        remarks: line.remarks || null,
        is_custom: false,
    };
}
async function loadApplicableBom(productMasterId, runner = db_1.query) {
    const bomResult = await runner(`SELECT sb.*, pm.product_code, pm.product_name
     FROM standard_boms sb
     JOIN product_masters pm ON pm.id=sb.product_master_id
     WHERE sb.product_master_id=$1
       AND sb.status='Active'
       AND (sb.effective_from IS NULL OR sb.effective_from <= CURRENT_DATE)
       AND (sb.effective_to IS NULL OR sb.effective_to >= CURRENT_DATE)
     ORDER BY sb.effective_from DESC NULLS LAST, sb.updated_at DESC NULLS LAST`, [productMasterId]);
    const bom = bomResult.rows[0] || null;
    if (!bom)
        return { available: false, reason: 'missing_bom', bom: null, lines: [] };
    const lines = (await runner(BOM_LINE_SELECT, [bom.id])).rows.map((line) => normalizedBomLine(line, bom));
    if (!lines.length)
        return { available: false, reason: 'empty_bom', bom, lines: [] };
    return { available: true, reason: null, bom, lines };
}
function validateEquipment(equipment) {
    if (equipment == null)
        return null;
    if (!Array.isArray(equipment))
        return 'equipment must be an array';
    for (const [index, line] of equipment.entries()) {
        if (!line || typeof line !== 'object')
            return `equipment[${index}] must be an object`;
        if (!String(line.component_name || '').trim())
            return `equipment[${index}].component_name is required`;
        if (line.quantity != null && line.quantity !== '' &&
            (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) < 0)) {
            return `equipment[${index}].quantity must be a non-negative number`;
        }
        for (const field of ['included', 'is_optional', 'is_filtration', 'is_custom']) {
            if (line[field] != null && typeof line[field] !== 'boolean') {
                return `equipment[${index}].${field} must be boolean`;
            }
        }
    }
    return null;
}
async function resolveProvenance(body) {
    if (!body.source_bom_id) {
        const hasSourceLines = Array.isArray(body.equipment)
            && body.equipment.some((line) => line?.source_bom_line_id || line?.source_component_id || line?.source_bom_id);
        if (hasSourceLines)
            return { error: 'Source BOM provenance is required for imported equipment lines.' };
        return {
            source_bom_id: null,
            source_bom_code: null,
            source_bom_revision: null,
            equipment: body.equipment,
        };
    }
    if (!body.product_master_id)
        return { error: 'A source BOM requires a linked Product Master.' };
    const bomResult = await (0, db_1.query)(`SELECT id, bom_code, revision_code
     FROM standard_boms
     WHERE id=$1 AND product_master_id=$2`, [body.source_bom_id, body.product_master_id]);
    const bom = bomResult.rows[0];
    if (!bom)
        return { error: 'The source BOM does not belong to the linked Product Master.' };
    const importedLines = (body.equipment || []).filter((line) => line.source_bom_line_id);
    if (importedLines.length) {
        const ids = importedLines.map((line) => line.source_bom_line_id);
        const lineResult = await (0, db_1.query)(`SELECT id, component_id
       FROM bom_lines
       WHERE standard_bom_id=$1 AND id = ANY($2::uuid[])`, [bom.id, ids]);
        const validById = new Map(lineResult.rows.map(line => [String(line.id), line]));
        for (const line of importedLines) {
            const source = validById.get(String(line.source_bom_line_id));
            if (!source)
                return { error: 'One or more equipment lines do not belong to the source BOM.' };
            if (line.source_bom_id && String(line.source_bom_id) !== String(bom.id)) {
                return { error: 'Equipment source BOM provenance is inconsistent.' };
            }
            if (line.source_component_id && String(line.source_component_id) !== String(source.component_id || '')) {
                return { error: 'Equipment source component provenance is inconsistent.' };
            }
        }
    }
    for (const line of body.equipment || []) {
        if (!line.source_bom_line_id && (line.source_bom_id || line.source_component_id)) {
            return { error: 'Custom equipment cannot claim BOM or component provenance without a source BOM line.' };
        }
    }
    const validLines = importedLines.length
        ? (await (0, db_1.query)(`SELECT id, component_id
       FROM bom_lines
       WHERE standard_bom_id=$1 AND id = ANY($2::uuid[])`, [bom.id, importedLines.map((line) => line.source_bom_line_id)])).rows
        : [];
    const canonicalById = new Map(validLines.map(line => [String(line.id), line]));
    return {
        source_bom_id: bom.id,
        source_bom_code: bom.bom_code,
        source_bom_revision: bom.revision_code,
        equipment: (body.equipment || []).map((line) => {
            const source = line.source_bom_line_id
                ? canonicalById.get(String(line.source_bom_line_id))
                : null;
            return {
                ...line,
                source_bom_id: source ? bom.id : null,
                source_component_id: source?.component_id || null,
            };
        }),
    };
}
async function insertEquipment(runner, compactUnitId, equipment = []) {
    for (const [index, line] of equipment.entries()) {
        await runner(`INSERT INTO lss_compact_unit_equipment
       (compact_unit_id, sort_order, source_bom_line_id, source_component_id, source_bom_id,
        component_type, component_reference_code, component_name, quantity, unit,
        is_optional, included, is_filtration, size_or_power, size_or_power_override,
        remarks, is_custom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
            compactUnitId, line.sort_order ?? index, line.source_bom_line_id || null,
            line.source_component_id || null, line.source_bom_id || null,
            line.component_type || null, line.component_reference_code || null,
            String(line.component_name).trim(), line.quantity == null || line.quantity === '' ? 1 : Number(line.quantity),
            line.unit || 'EA', Boolean(line.is_optional), line.included !== false,
            Boolean(line.is_filtration), line.size_or_power || line.size_power || null,
            line.size_or_power_override || line.size_power_override || null,
            line.remarks || null, Boolean(line.is_custom),
        ]);
    }
}
function validateCompactUnit(body) {
    const numericFields = [
        'min_tank_volume_m3', 'max_tank_volume_m3', 'design_flow_m3h', 'max_flow_m3h',
        'break_tank_volume_l', 'uv_power_w', 'footprint_l_mm', 'footprint_w_mm',
        'height_mm', 'dry_weight_kg', 'power_kw',
    ];
    for (const field of numericFields) {
        const value = body[field];
        if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            return `${field} must be a non-negative number`;
        }
    }
    const minVolume = body.min_tank_volume_m3 == null ? null : Number(body.min_tank_volume_m3);
    const maxVolume = body.max_tank_volume_m3 == null ? null : Number(body.max_tank_volume_m3);
    const designFlow = body.design_flow_m3h == null ? null : Number(body.design_flow_m3h);
    const maxFlow = body.max_flow_m3h == null ? null : Number(body.max_flow_m3h);
    if (minVolume != null && maxVolume != null && minVolume > maxVolume) {
        return 'Minimum tank volume cannot exceed maximum tank volume';
    }
    if (designFlow != null && maxFlow != null && designFlow > maxFlow) {
        return 'Design flow cannot exceed maximum flow';
    }
    if (body.water_type && !['Marine', 'Salt Water', 'Freshwater', 'Brackish', 'Universal'].includes(body.water_type)) {
        return 'Unsupported compact-unit water type';
    }
    return null;
}
router.get('/lss-compact-units', auth_1.authenticate, async (_req, res) => {
    const result = await (0, db_1.query)(`SELECT ${FIELDS}, ${EQUIPMENT_JSON} ${JOIN} ORDER BY lcu.unit_code`);
    res.json(result.rows);
});
// Read-only import preview. Nothing in the LSS catalog is changed by this route.
router.get('/lss-compact-units/bom/:productMasterId', auth_1.authenticate, async (req, res) => {
    try {
        res.json(await loadApplicableBom(String(req.params.productMasterId)));
    }
    catch {
        res.status(502).json({
            error: { code: 'BOM_IMPORT_FAILED', message: 'The Product Master BOM could not be loaded. You can configure the unit manually.' },
        });
    }
});
router.get('/lss-compact-units/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT ${FIELDS}, ${EQUIPMENT_JSON} ${JOIN} WHERE lcu.id=$1 OR lcu.unit_code=$1`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unit not found' } });
    res.json(result.rows[0]);
});
router.post('/lss-compact-units', auth_1.authenticate, (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const { unit_code, unit_name, manufacturer, water_type, min_tank_volume_m3, max_tank_volume_m3, design_flow_m3h, max_flow_m3h, break_tank_volume_l, includes_filtration, uv_power_w, footprint_l_mm, footprint_w_mm, height_mm, dry_weight_kg, power_kw, inlet_connection, outlet_connection, notes, product_master_id, status, source_bom_id, source_bom_code, source_bom_revision, equipment, } = req.body;
    if (!unit_code?.trim() || !unit_name?.trim())
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'unit_code and unit_name are required' } });
    const validationError = validateCompactUnit(req.body);
    if (validationError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: validationError } });
    const equipmentError = validateEquipment(equipment);
    if (equipmentError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: equipmentError } });
    const provenance = await resolveProvenance(req.body);
    if (provenance.error)
        return res.status(400).json({ error: { code: 'INVALID_PROVENANCE', message: provenance.error } });
    try {
        const client = await db_1.default.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`INSERT INTO lss_compact_units (
        unit_code, unit_name, manufacturer, water_type,
        min_tank_volume_m3, max_tank_volume_m3,
        design_flow_m3h, max_flow_m3h,
        break_tank_volume_l, includes_filtration, uv_power_w,
        footprint_l_mm, footprint_w_mm, height_mm,
        dry_weight_kg, power_kw,
        inlet_connection, outlet_connection,
        notes, product_master_id, status, source_bom_id, source_bom_code, source_bom_revision
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      ) RETURNING *`, [
                unit_code.trim().toUpperCase(), unit_name.trim(), manufacturer || null, water_type || null,
                min_tank_volume_m3 ?? null, max_tank_volume_m3 ?? null,
                design_flow_m3h ?? null, max_flow_m3h ?? null,
                break_tank_volume_l ?? null, includes_filtration || null, uv_power_w ?? null,
                footprint_l_mm ?? null, footprint_w_mm ?? null, height_mm ?? null,
                dry_weight_kg ?? null, power_kw ?? null,
                inlet_connection || null, outlet_connection || null,
                notes || null, product_master_id || null, status || 'Active',
                provenance.source_bom_id, provenance.source_bom_code, provenance.source_bom_revision,
            ]);
            await insertEquipment(client.query.bind(client), result.rows[0].id, provenance.equipment || []);
            await client.query('COMMIT');
            res.status(201).json({ ...result.rows[0], equipment: equipment || [] });
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'A unit with that code already exists.' } });
        throw err;
    }
});
router.put('/lss-compact-units/:id', auth_1.authenticate, (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const { unit_code, unit_name, manufacturer, water_type, min_tank_volume_m3, max_tank_volume_m3, design_flow_m3h, max_flow_m3h, break_tank_volume_l, includes_filtration, uv_power_w, footprint_l_mm, footprint_w_mm, height_mm, dry_weight_kg, power_kw, inlet_connection, outlet_connection, notes, product_master_id, status, source_bom_id, source_bom_code, source_bom_revision, equipment, } = req.body;
    if (!unit_code?.trim() || !unit_name?.trim())
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'unit_code and unit_name are required' } });
    const validationError = validateCompactUnit(req.body);
    if (validationError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: validationError } });
    const equipmentError = validateEquipment(equipment);
    if (equipmentError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: equipmentError } });
    const provenance = await resolveProvenance(req.body);
    if (provenance.error)
        return res.status(400).json({ error: { code: 'INVALID_PROVENANCE', message: provenance.error } });
    try {
        const client = await db_1.default.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`UPDATE lss_compact_units SET
        unit_code=$1, unit_name=$2, manufacturer=$3, water_type=$4,
        min_tank_volume_m3=$5, max_tank_volume_m3=$6,
        design_flow_m3h=$7, max_flow_m3h=$8,
        break_tank_volume_l=$9, includes_filtration=$10, uv_power_w=$11,
        footprint_l_mm=$12, footprint_w_mm=$13, height_mm=$14,
        dry_weight_kg=$15, power_kw=$16,
        inlet_connection=$17, outlet_connection=$18,
        notes=$19, product_master_id=$20, status=$21,
        source_bom_id=$22, source_bom_code=$23, source_bom_revision=$24,
        updated_at=NOW()
       WHERE id=$25 RETURNING *`, [
                unit_code?.trim().toUpperCase(), unit_name?.trim(), manufacturer || null, water_type || null,
                min_tank_volume_m3 ?? null, max_tank_volume_m3 ?? null,
                design_flow_m3h ?? null, max_flow_m3h ?? null,
                break_tank_volume_l ?? null, includes_filtration || null, uv_power_w ?? null,
                footprint_l_mm ?? null, footprint_w_mm ?? null, height_mm ?? null,
                dry_weight_kg ?? null, power_kw ?? null,
                inlet_connection || null, outlet_connection || null,
                notes || null, product_master_id || null, status || 'Active',
                provenance.source_bom_id, provenance.source_bom_code, provenance.source_bom_revision,
                req.params.id,
            ]);
            if (!result.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unit not found' } });
            }
            if (equipment !== undefined) {
                await client.query('DELETE FROM lss_compact_unit_equipment WHERE compact_unit_id=$1', [result.rows[0].id]);
                await insertEquipment(client.query.bind(client), result.rows[0].id, provenance.equipment || []);
            }
            await client.query('COMMIT');
            res.json({ ...result.rows[0], equipment: equipment === undefined ? undefined : equipment });
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'A unit with that code already exists.' } });
        throw err;
    }
});
router.post('/lss-compact-units/:id/reimport-bom', auth_1.authenticate, (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    if (req.body?.confirm !== true) {
        return res.status(400).json({
            error: { code: 'CONFIRMATION_REQUIRED', message: 'Confirm the BOM reimport before replacing the standard baseline.' },
        });
    }
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        const unitResult = await client.query('SELECT * FROM lss_compact_units WHERE id=$1 FOR UPDATE', [req.params.id]);
        const unit = unitResult.rows[0];
        if (!unit) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unit not found' } });
        }
        if (!unit.product_master_id) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'NO_PRODUCT_MASTER', message: 'Link a Product Master before importing a BOM.' } });
        }
        const imported = await loadApplicableBom(unit.product_master_id, client.query.bind(client));
        if (!imported.available) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: imported.reason === 'empty_bom' ? 'EMPTY_BOM' : 'MISSING_BOM', message: 'No usable Product Master BOM is available. The unit remains unchanged.' },
                ...imported,
            });
        }
        const current = (await client.query('SELECT * FROM lss_compact_unit_equipment WHERE compact_unit_id=$1 ORDER BY sort_order, created_at, id', [unit.id])).rows;
        const currentBySource = new Map(current.filter(line => line.source_bom_line_id).map(line => [String(line.source_bom_line_id), line]));
        const currentByReference = new Map(current.filter(line => line.component_reference_code).map(line => [String(line.component_reference_code), line]));
        const merged = imported.lines.map((line) => {
            const previous = currentBySource.get(String(line.source_bom_line_id))
                || currentByReference.get(String(line.component_reference_code || ''));
            return previous ? {
                ...line,
                included: previous.included,
                quantity: previous.quantity,
                size_or_power_override: previous.size_or_power_override || null,
                component_name: previous.is_custom ? previous.component_name : line.component_name,
                remarks: previous.remarks || line.remarks,
                is_custom: previous.is_custom,
            } : line;
        });
        const importedReferences = new Set(merged.map(line => line.source_bom_line_id));
        current.filter(line => line.is_custom && !importedReferences.has(line.source_bom_line_id))
            .forEach(line => merged.push({ ...line, id: undefined, sort_order: merged.length }));
        await client.query(`UPDATE lss_compact_units
       SET source_bom_id=$1, source_bom_code=$2, source_bom_revision=$3, updated_at=NOW()
       WHERE id=$4`, [imported.bom.id, imported.bom.bom_code, imported.bom.revision_code, unit.id]);
        await client.query('DELETE FROM lss_compact_unit_equipment WHERE compact_unit_id=$1', [unit.id]);
        await insertEquipment(client.query.bind(client), unit.id, merged);
        await client.query('COMMIT');
        res.json({ ...imported, equipment: merged, preserved_overrides: current.length > 0 });
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
});
router.delete('/lss-compact-units/:id', auth_1.authenticate, (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const check = await (0, db_1.query)('SELECT COUNT(*) FROM systems WHERE compact_unit_id=$1', [req.params.id]);
    if (parseInt(check.rows[0].count) > 0)
        return res.status(409).json({ error: { code: 'CONFLICT', message: 'This unit is assigned to one or more systems. Unlink them first.' } });
    const result = await (0, db_1.query)('DELETE FROM lss_compact_units WHERE id=$1 RETURNING id, unit_code', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unit not found' } });
    res.json({ deleted: true, id: result.rows[0].id });
});
exports.default = router;
exports.lssCompactUnitTestUtils = {
    isFiltrationLine,
    normalizedBomLine,
    validateCompactUnit,
    validateEquipment,
};
