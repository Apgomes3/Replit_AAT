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
exports.expandAllocationProducts = expandAllocationProducts;
exports.readExisting = readExisting;
exports.createWorkbookBuffer = createWorkbookBuffer;
const express_1 = require("express");
const exceljs_1 = __importDefault(require("exceljs"));
const node_crypto_1 = require("node:crypto");
const db_1 = __importStar(require("../db"));
const auth_1 = require("../middleware/auth");
const lssSystems_1 = require("../lib/lssSystems");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const transaction = async (fn) => {
    const connect = db_1.default.connect;
    const db = typeof connect === 'function' ? await connect.call(db_1.default) : { query: db_1.query };
    try {
        await db.query('BEGIN');
        const result = await fn(db);
        await db.query('COMMIT');
        return result;
    }
    catch (error) {
        await db.query('ROLLBACK');
        throw error;
    }
    finally {
        db.release?.();
    }
};
const numberOrNull = (value) => value == null || value === '' ? null : Number(value);
const safeText = (value) => value == null ? null : String(value);
function expandAllocationProducts(allocation, productById, fallback) {
    return (Array.isArray(allocation?.products) ? allocation.products : []).map((product, index) => {
        const catalog = productById.get(String(product?.product_master_id)) || {};
        return {
            ...product,
            ...catalog,
            source_id: product?.product_master_id || allocation.id,
            source_key: `${allocation.id}:${product?.product_master_id || index}`,
            description: product?.product_name || catalog.product_name || fallback,
            quantity: product?.quantity || 1,
            unit: product?.unit || 'EA',
        };
    });
}
async function sources(db, bookId) {
    const book = (await db.query('SELECT project_id FROM design_books WHERE id=$1', [bookId])).rows[0];
    if (!book)
        throw Object.assign(new Error('Design Book not found'), { status: 404, code: 'NOT_FOUND' });
    const systems = (await db.query(`SELECT * FROM systems WHERE project_id=$1 AND (LOWER(COALESCE(system_type,''))='lss'
      OR LOWER(COALESCE(system_type,'')) LIKE '%life support%'
      OR COALESCE(system_code,'') ~* '^LSS([[:space:]_-]|[0-9]|$)') ORDER BY system_code`, [book.project_id])).rows;
    if (!systems.length)
        return [];
    const ids = systems.map(s => s.id);
    const tanks = (await db.query(`SELECT t.*, pm.product_code, pm.product_name, pm.manufacturer, pm.model, pm.cost, pm.sell_price, pm.currency
     FROM tanks t LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     WHERE t.system_id=ANY($1::uuid[]) ORDER BY t.system_id,t.tank_code`, [ids])).rows;
    const equipment = (await db.query(`SELECT pei.*, pm.product_code, pm.product_name, pm.manufacturer, pm.model, pm.cost, pm.sell_price, pm.currency
     FROM project_equipment_items pei LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     WHERE pei.system_id=ANY($1::uuid[]) ORDER BY pei.system_id,pei.equip_code`, [ids])).rows;
    const pumps = (await db.query(`SELECT sps.system_id, sps.id, sps.project_equipment_item_id, sps.pump_role,
            pei.equip_code, pei.description, pei.quantity, pei.unit,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer,
            pm.model, pm.cost, pm.sell_price, pm.currency
     FROM system_pump_selections sps
     LEFT JOIN project_equipment_items pei ON pei.id=sps.project_equipment_item_id
     LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     WHERE sps.system_id=ANY($1::uuid[]) ORDER BY sps.system_id,sps.circuit_key`, [ids])).rows;
    const uv = (await db.query(`SELECT * FROM design_book_uv_selections
     WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
    const thermal = (await db.query(`SELECT t.*,pm.product_code,pm.product_name,pm.manufacturer,pm.model,pm.cost,pm.sell_price,pm.currency
     FROM design_book_thermal_selections t LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     WHERE t.design_book_id=$1 AND t.system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
    const controls = (await db.query(`SELECT * FROM design_book_lss_controls WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
    const instruments = (await db.query(`SELECT i.*, pm.product_code,pm.product_name,pm.manufacturer,pm.model,pm.cost,pm.sell_price,pm.currency
     FROM design_book_lss_instruments i LEFT JOIN product_masters pm ON pm.id=i.product_master_id
     WHERE i.design_book_id=$1 AND i.system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
    const compactIds = systems.map(s => s.compact_unit_id).filter(Boolean);
    const compact = compactIds.length ? (await db.query(`SELECT lcu.id,s.id AS system_id,e.*,pm.product_code,pm.product_name,pm.manufacturer,pm.model,pm.cost,pm.sell_price,pm.currency
     FROM lss_compact_units lcu JOIN systems s ON s.compact_unit_id=lcu.id
     JOIN lss_compact_unit_equipment e ON e.compact_unit_id=lcu.id
     LEFT JOIN product_masters pm ON pm.id=e.source_product_id
     WHERE lcu.id=ANY($1::uuid[]) AND e.included=true ORDER BY s.id,e.sort_order`, [compactIds])).rows : [];
    const fractionators = (await db.query(`SELECT * FROM system_flow_fractionator_allocations WHERE system_id=ANY($1::uuid[])`, [ids])).rows;
    const sandFilters = (await db.query(`SELECT * FROM system_flow_sand_filter_allocations WHERE system_id=ANY($1::uuid[])`, [ids])).rows;
    const ozone = (await db.query(`SELECT * FROM design_book_ozone_calculations WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
    const selectedProductIds = [...fractionators, ...sandFilters]
        .flatMap(allocation => Array.isArray(allocation.products) ? allocation.products : [])
        .map(product => String(product?.product_master_id || ''))
        .filter(id => /^[0-9a-f-]{36}$/i.test(id));
    ozone.forEach(row => {
        const raw = row.allocation_snapshot || {};
        const allocations = Array.isArray(raw.products) ? raw.products : [raw];
        allocations.forEach((product) => {
            if (Number(product?.quantity) > 0 && /^[0-9a-f-]{36}$/i.test(String(product.product_id)))
                selectedProductIds.push(String(product.product_id));
        });
    });
    const productMasters = selectedProductIds.length ? (await db.query(`SELECT id,product_code,product_name,manufacturer,model,cost,sell_price,
            COALESCE(NULLIF(currency,''),'USD') AS currency
     FROM product_masters WHERE id=ANY($1::uuid[])`, [[...new Set(selectedProductIds)]])).rows : [];
    const productById = new Map(productMasters.map(product => [String(product.id), product]));
    const uvProducts = uv.flatMap(selection => {
        const streams = Array.isArray(selection.result_snapshot?.streams) ? selection.result_snapshot.streams : [];
        return streams.filter((stream) => Number(stream?.unit_quantity) > 0 && (stream?.product_master_id || stream?.product_code || stream?.product_name))
            .map((stream, index) => ({
            ...stream,
            selection_id: selection.id,
            system_id: selection.system_id,
            stream_key: stream.side_stream_id || stream.stream_id || stream.circuit_key || index,
        }));
    });
    const uvProductIds = uvProducts.map((product) => String(product.product_master_id)).filter(id => /^[0-9a-f-]{36}$/i.test(id));
    const uvCatalog = uvProductIds.length ? (await db.query(`SELECT id,product_code,product_name,manufacturer,model,cost,sell_price,
            COALESCE(NULLIF(currency,''),'USD') AS currency
     FROM product_masters WHERE id=ANY($1::uuid[])`, [[...new Set(uvProductIds)]])).rows : [];
    const uvById = new Map(uvCatalog.map(product => [String(product.id), product]));
    const line = (kind, systemId, id, key, row, fallback, qty = 1, unit = 'EA') => {
        const cost = numberOrNull(row.cost), sell = numberOrNull(row.sell_price);
        return {
            source_kind: kind, system_id: systemId, source_id: id || null, source_key: `${kind}:${key}`,
            source_snapshot: row, description: row.description || row.product_name || row.component_name || fallback,
            quantity: numberOrNull(row.quantity) ?? qty, unit: row.unit || unit, supplier: null,
            manufacturer: row.manufacturer || null, model: row.model || null, unit_cost: cost,
            markup: cost != null && sell != null && cost > 0 ? (sell - cost) / cost * 100 : null,
            selling_price: sell, currency: row.currency || 'USD', lead_time: null, exclusions: null, notes: row.notes || null,
        };
    };
    return systems.flatMap(system => {
        const systemId = system.id;
        const rows = [
            ...tanks.filter(r => r.system_id === systemId).map(r => line('tank', systemId, r.id, r.id, r, `Tank ${r.tank_code}`, r.quantity || 1)),
            ...equipment.filter(r => r.system_id === systemId && !pumps.some(pump => pump.project_equipment_item_id === r.id)).map(r => line('equipment', systemId, r.id, r.id, r, r.equip_code, r.quantity || 1, r.unit || 'EA')),
            ...pumps.filter(r => r.system_id === systemId).map(r => line('pump', systemId, r.id, r.id, r, `${r.pump_role || 'Pump'} ${r.equip_code || ''}`)),
            ...uvProducts.filter(r => r.system_id === systemId).map(r => {
                const catalog = uvById.get(String(r.product_master_id)) || {};
                return line('uv', systemId, r.product_master_id || r.selection_id, `${r.selection_id}:${r.stream_key}`, { ...r, ...catalog }, r.product_name || catalog.product_name || 'UV system', r.unit_quantity, r.unit || 'EA');
            }),
            ...thermal.filter(r => r.system_id === systemId).map(r => {
                const snapshot = r.product_snapshot || r.result_snapshot || r;
                return line('thermal', systemId, r.id, r.id, { ...snapshot, ...r }, `${r.duty || 'Thermal'} equipment`);
            }),
            ...controls.filter(r => r.system_id === systemId).map(r => line('control_panel', systemId, r.id, r.id, r.control || r, 'Control panel')),
            ...instruments.filter(r => r.system_id === systemId).map(r => line('instrument', systemId, r.id, r.id, r, r.definition_snapshot?.name || r.tag_code || 'Field instrument')),
            ...compact.filter(r => r.system_id === systemId).map(r => line('compact_unit', systemId, r.id, r.id, r, r.component_name, r.quantity || 1, r.unit || 'EA')),
            ...fractionators.filter(r => r.system_id === systemId).flatMap(r => expandAllocationProducts(r, productById, 'Foam fractionator')
                .map(product => line('fractionator', systemId, product.source_id, product.source_key, product, product.description, product.quantity, product.unit))),
            ...sandFilters.filter(r => r.system_id === systemId).flatMap(r => expandAllocationProducts(r, productById, 'Sand filter')
                .map(product => line('filter', systemId, product.source_id, product.source_key, product, product.description, product.quantity, product.unit))),
            ...ozone.filter(r => r.system_id === systemId).flatMap(r => {
                const raw = r.allocation_snapshot || {};
                const allocations = Array.isArray(raw.products) ? raw.products : [raw];
                return allocations.filter((product) => Number(product?.quantity) > 0 && product?.product_id).map((product, index) => {
                    const catalog = productById.get(String(product.product_id)) || {};
                    return line('equipment', systemId, product.product_id, `${r.id}:${product.product_id || index}`, { ...product, ...catalog }, product.product_name || catalog.product_name || 'Ozone generator', product.quantity, product.unit || 'EA');
                });
            }),
        ];
        return rows.map((r, index) => ({ ...r, sort_order: index }));
    });
}
async function sync(db, bookId, userId) {
    let breakdown = (await db.query('SELECT * FROM design_book_equipment_breakdowns WHERE design_book_id=$1', [bookId])).rows[0];
    if (!breakdown)
        breakdown = (await db.query('INSERT INTO design_book_equipment_breakdowns (design_book_id,updated_by) VALUES ($1,$2) RETURNING *', [bookId, userId || null])).rows[0];
    const next = await sources(db, bookId);
    const existing = (await db.query('SELECT * FROM design_book_equipment_breakdown_lines WHERE breakdown_id=$1', [breakdown.id])).rows;
    const keys = new Set(next.map(row => row.source_key));
    for (const row of next) {
        const old = existing.find(item => item.source_key === row.source_key);
        if (!old) {
            await db.query(`INSERT INTO design_book_equipment_breakdown_lines
        (breakdown_id,system_id,source_kind,source_id,source_key,source_snapshot,description,quantity,unit,supplier,manufacturer,model,unit_cost,markup,selling_price,currency,lead_time,exclusions,notes,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [breakdown.id, row.system_id, row.source_kind, row.source_id, row.source_key, row.source_snapshot, row.description, row.quantity, row.unit, row.supplier, row.manufacturer, row.model, row.unit_cost, row.markup, row.selling_price, row.currency, row.lead_time, row.exclusions, row.notes, row.sort_order]);
            continue;
        }
        const overrides = old.override_fields || {};
        const value = (field) => overrides[field] ? old[field] : row[field];
        await db.query(`UPDATE design_book_equipment_breakdown_lines SET
      system_id=$1,source_id=$2,source_snapshot=$3,description=$4,quantity=$5,unit=$6,manufacturer=$7,model=$8,unit_cost=$9,markup=$10,selling_price=$11,currency=$12,notes=$13,updated_at=NOW()
      WHERE id=$14`, [row.system_id, row.source_id, row.source_snapshot, value('description'), value('quantity'), value('unit'), value('manufacturer'), value('model'), value('unit_cost'), value('markup'), value('selling_price'), value('currency'), value('notes'), old.id]);
    }
    const obsolete = existing.filter(item => item.source_kind !== 'manual' && !keys.has(item.source_key));
    if (obsolete.length)
        await db.query('DELETE FROM design_book_equipment_breakdown_lines WHERE id=ANY($1::uuid[])', [obsolete.map(item => item.id)]);
    await db.query('UPDATE design_book_equipment_breakdowns SET updated_at=NOW(),updated_by=$2 WHERE id=$1', [breakdown.id, userId || null]);
    return (await db.query(`SELECT l.*,s.system_code,s.system_name FROM design_book_equipment_breakdown_lines l
    LEFT JOIN systems s ON s.id=l.system_id WHERE l.breakdown_id=$1 ORDER BY s.system_code,l.sort_order,l.created_at`, [breakdown.id])).rows;
}
async function readExisting(db, bookId) {
    const breakdown = (await db.query('SELECT id FROM design_book_equipment_breakdowns WHERE design_book_id=$1', [bookId])).rows[0];
    if (!breakdown)
        return { initialized: false, items: [] };
    const items = (await db.query(`SELECT l.*,s.system_code,s.system_name
    FROM design_book_equipment_breakdown_lines l LEFT JOIN systems s ON s.id=l.system_id
    WHERE l.breakdown_id=$1 ORDER BY s.system_code,l.sort_order,l.created_at`, [breakdown.id])).rows;
    return { initialized: true, items };
}
router.get('/design-books/:id/equipment-breakdown', async (req, res) => {
    const result = await readExisting({ query: db_1.query }, String(req.params.id));
    res.json(result);
});
router.post('/design-books/:id/equipment-breakdown/refresh', (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const items = await transaction(db => sync(db, String(req.params.id), req.user?.id));
    res.json({ items });
});
router.put('/design-books/:id/equipment-breakdown/lines/:lineId', (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const allowed = ['description', 'quantity', 'unit', 'supplier', 'manufacturer', 'model', 'unit_cost', 'markup', 'selling_price', 'currency', 'lead_time', 'exclusions', 'notes'];
    const values = [], sets = [], fields = [];
    for (const field of allowed)
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
            if (['quantity', 'unit_cost', 'markup', 'selling_price'].includes(field) && req.body[field] !== null && (!Number.isFinite(Number(req.body[field])) || Number(req.body[field]) < 0))
                return res.status(400).json({ error: { code: 'INVALID_VALUE', message: `${field} must be non-negative` } });
            values.push(req.body[field] === '' ? null : req.body[field]);
            sets.push(`${field}=$${values.length}`);
            fields.push(field);
        }
    if (!sets.length)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'No editable fields supplied' } });
    const overrideParam = values.length + 1;
    const lineIdParam = values.length + 2;
    const bookIdParam = values.length + 3;
    const result = await (0, db_1.query)(`UPDATE design_book_equipment_breakdown_lines l SET ${sets.join(',')},override_fields=override_fields || $${overrideParam}::jsonb,updated_at=NOW()
    FROM design_book_equipment_breakdowns b
    WHERE l.id=$${lineIdParam} AND l.breakdown_id=b.id AND b.design_book_id=$${bookIdParam} RETURNING l.*`, [...values, JSON.stringify(Object.fromEntries(fields.map(f => [f, true]))), req.params.lineId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Breakdown line not found' } });
    res.json(result.rows[0]);
});
router.post('/design-books/:id/equipment-breakdown/lines', (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const body = req.body || {};
    if (!String(body.description || '').trim())
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Description is required' } });
    for (const field of ['quantity', 'unit_cost', 'markup', 'selling_price']) {
        if (body[field] != null && body[field] !== '' && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) {
            return res.status(400).json({ error: { code: 'INVALID_VALUE', message: `${field} must be non-negative` } });
        }
    }
    const created = await transaction(async (db) => {
        const book = (await db.query('SELECT project_id FROM design_books WHERE id=$1', [req.params.id])).rows[0];
        if (!book)
            throw Object.assign(new Error('Design Book not found'), { status: 404, code: 'NOT_FOUND' });
        if (body.system_id) {
            const system = (await db.query('SELECT * FROM systems WHERE id=$1 AND project_id=$2', [body.system_id, book.project_id])).rows[0];
            if (!system || !(0, lssSystems_1.isLifeSupportSystem)(system)) {
                throw Object.assign(new Error('System is not an LSS in this Design Book project'), { status: 400, code: 'INVALID_SYSTEM' });
            }
        }
        const breakdown = (await db.query('SELECT id FROM design_book_equipment_breakdowns WHERE design_book_id=$1', [req.params.id])).rows[0]
            || (await db.query('INSERT INTO design_book_equipment_breakdowns (design_book_id,updated_by) VALUES ($1,$2) RETURNING id', [req.params.id, req.user?.id])).rows[0];
        return (await db.query(`INSERT INTO design_book_equipment_breakdown_lines
      (breakdown_id,system_id,source_kind,source_key,description,quantity,unit,supplier,manufacturer,model,unit_cost,markup,selling_price,currency,lead_time,exclusions,notes,override_fields)
      VALUES ($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [breakdown.id, body.system_id || null, `manual:${(0, node_crypto_1.randomUUID)()}`, body.description.trim(), body.quantity ?? 1, body.unit || 'EA', body.supplier || null, body.manufacturer || null, body.model || null, body.unit_cost ?? null, body.markup ?? null, body.selling_price ?? null, body.currency || 'USD', body.lead_time || null, body.exclusions || null, body.notes || null, JSON.stringify({ description: true, quantity: true, unit: true })])).rows[0];
    });
    res.status(201).json(created);
});
router.delete('/design-books/:id/equipment-breakdown/lines/:lineId', (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const result = await (0, db_1.query)(`DELETE FROM design_book_equipment_breakdown_lines l USING design_book_equipment_breakdowns b
    WHERE l.id=$1 AND l.breakdown_id=b.id AND b.design_book_id=$2 AND l.source_kind='manual' RETURNING l.id`, [req.params.lineId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Manual line not found' } });
    res.status(204).end();
});
async function createWorkbookBuffer(items) {
    const workbook = new exceljs_1.default.Workbook();
    workbook.creator = 'EDP Design Book';
    const columns = ['System', 'Source', 'Description', 'Qty', 'Unit', 'Supplier', 'Manufacturer', 'Model', 'Unit Cost', 'Markup %', 'Selling Price', 'Currency', 'Lead Time', 'Exclusions', 'Notes'];
    const safeCell = (value) => {
        if (typeof value !== 'string')
            return value;
        return /^[=+\-@]/.test(value) ? `'${value}` : value;
    };
    const addRows = (sheet, rows) => {
        sheet.addRow(columns);
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
        rows.forEach(row => sheet.addRow([row.system_name || 'Unassigned', row.source_kind, row.description, Number(row.quantity), row.unit, row.supplier || '', row.manufacturer || '', row.model || '', numberOrNull(row.unit_cost), numberOrNull(row.markup), numberOrNull(row.selling_price), row.currency, row.lead_time || '', row.exclusions || '', row.notes || ''].map(safeCell)));
        sheet.columns = columns.map((header, i) => ({ header, width: Math.max(14, Math.min(34, header.length + 4, rows.reduce((n, r) => Math.max(n, String(r[header.toLowerCase().replace(/ /g, '_')] || '').length + 2), 0))) }));
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.autoFilter = { from: 'A1', to: `O${Math.max(1, rows.length + 1)}` };
    };
    const summary = workbook.addWorksheet('Summary');
    addRows(summary, items);
    const grouped = new Map();
    items.forEach(item => { const name = String(item.system_code || item.system_name || 'Unassigned').replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || 'LSS'; let list = grouped.get(name); if (!list)
        grouped.set(name, list = []); list.push(item); });
    const usedNames = new Set(['summary']);
    grouped.forEach((rows, originalName) => {
        const base = originalName || 'LSS';
        let name = base;
        let suffix = 2;
        while (usedNames.has(name.toLowerCase()))
            name = `${base.slice(0, 28)}-${suffix++}`.slice(0, 31);
        usedNames.add(name.toLowerCase());
        addRows(workbook.addWorksheet(name), rows);
    });
    return workbook.xlsx.writeBuffer();
}
router.get('/design-books/:id/equipment-breakdown/export', async (req, res) => {
    const { items } = await readExisting({ query: db_1.query }, String(req.params.id));
    const buffer = await createWorkbookBuffer(items);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="design-book-equipment-breakdown.xlsx"`);
    res.send(Buffer.from(buffer));
});
exports.default = router;
