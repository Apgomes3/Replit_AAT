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
const express_1 = require("express");
const db_1 = __importStar(require("../db"));
const audit_1 = require("../db/audit");
const auth_1 = require("../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const tankCalculations_1 = require("../lib/tankCalculations");
const uploadsDir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(uploadsDir))
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
const imageStorage = multer_1.default.diskStorage({
    destination: uploadsDir,
    filename: (_, file, cb) => {
        const unique = `${Date.now()}-${crypto_1.default.randomBytes(6).toString('hex')}`;
        cb(null, `${unique}${path_1.default.extname(file.originalname)}`);
    },
});
const uploadImage = (0, multer_1.default)({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_, file, cb) => {
        cb(null, file.mimetype.startsWith('image/'));
    } });
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('pim'));
const AAT_SAND_FILTER_FRICTION_DEFAULT_KEY = 'aat_sand_filter_friction_loss_v1';
const withProductTransaction = async (work) => {
    const connect = db_1.default.connect;
    const client = typeof connect === 'function'
        ? await connect.call(db_1.default)
        : { query: db_1.query };
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release?.();
    }
};
const normalizeDesignFlow = (value) => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === ''))
        return null;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
        const error = new Error('Design flow must be a finite, non-negative value in m³/h');
        error.status = 400;
        error.code = 'INVALID_DESIGN_FLOW';
        throw error;
    }
    return normalized;
};
const isAatSandFilter = (product) => {
    const manufacturer = String(product.manufacturer ?? '').trim().toLowerCase();
    const identity = `${String(product.product_name ?? '')} ${String(product.model ?? '')}`.toLowerCase();
    return manufacturer === 'aat' && /(^|\W)sand[\s-]*filter(\W|$)/.test(identity);
};
const flowsConflict = (productFlow, hydraulicFlow) => productFlow != null && hydraulicFlow != null && Number(productFlow) !== Number(hydraulicFlow);
const insertAuditTx = (client, actorId, entityType, entityId, action, details) => client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details)
   VALUES ($1,$2,$3,$4,$5)`, [entityType, entityId, action, actorId, details]);
const designFlowAuditDetails = (source, designFlow, previousProductFlow, previousHydraulicFlow) => ({
    summary: 'Linked Product Master and Hydraulic design flow updated',
    source,
    design_flow_m3h: designFlow,
    previous_product_design_flow_m3h: previousProductFlow ?? null,
    previous_hydraulic_design_flow_m3h: previousHydraulicFlow ?? null,
    resolved_conflict: flowsConflict(previousProductFlow, previousHydraulicFlow),
});
const revisionOrdinal = (code) => {
    if (!/^[A-Z]+$/.test(code))
        return 0;
    return [...code].reduce((total, character) => (total * 26) + character.charCodeAt(0) - 64, 0);
};
const revisionCodeFromOrdinal = (ordinal) => {
    let remaining = ordinal;
    let code = '';
    while (remaining > 0) {
        remaining -= 1;
        code = String.fromCharCode(65 + (remaining % 26)) + code;
        remaining = Math.floor(remaining / 26);
    }
    return code || 'A';
};
const nextRevisionCode = (existing) => {
    const maximum = existing.reduce((highest, code) => Math.max(highest, revisionOrdinal(code.trim().toUpperCase())), 0);
    return revisionCodeFromOrdinal(maximum + 1);
};
const isEditableDocumentRevision = (status) => ['Draft', 'Internal Review', 'Review Commented', 'Resubmitted', 'Rejected'].includes(String(status));
const readPimTdsSource = async (client, productId) => {
    const productResult = await client.query(`SELECT pm.*, pf.product_family_code, pf.product_family_name,
            m.material_name, m.material_category, m.density, m.chemical_resistance, m.temperature_limit
     FROM product_masters pm
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN materials m ON m.material_code=pm.primary_material_code
     WHERE pm.id::text=$1 OR pm.product_code=$1
     FOR UPDATE OF pm`, [productId]);
    const product = productResult.rows[0];
    if (!product) {
        const error = new Error('Product not found');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
    }
    const canonicalId = product.id;
    const [variants, boms, vendors, dimensions, electrical, hydraulic, pneumatic, classifiers, projects, relationships, linkedDocuments] = await Promise.all([
        client.query('SELECT * FROM product_variants WHERE product_master_id=$1 ORDER BY variant_code', [canonicalId]),
        client.query(`SELECT sb.*,
                COALESCE(json_agg(json_build_object(
                  'id', bl.id, 'line_number', bl.line_number, 'component_type', bl.component_type,
                  'component_reference_code', bl.component_reference_code, 'component_name', bl.component_name,
                  'quantity', bl.quantity, 'unit', bl.unit, 'is_optional', bl.is_optional, 'remarks', bl.remarks,
                  'sub_product_id', bl.sub_product_id, 'sub_product_code', sub_pm.product_code,
                  'sub_product_name', sub_pm.product_name, 'component_code', c.component_code
                ) ORDER BY bl.line_number) FILTER (WHERE bl.id IS NOT NULL), '[]'::json) AS lines
         FROM standard_boms sb
         LEFT JOIN bom_lines bl ON bl.standard_bom_id=sb.id
         LEFT JOIN components c ON c.id=bl.component_id
         LEFT JOIN product_masters sub_pm ON sub_pm.id=bl.sub_product_id
         WHERE sb.product_master_id=$1
         GROUP BY sb.id
         ORDER BY sb.effective_from DESC`, [canonicalId]),
        client.query('SELECT * FROM vendor_options WHERE product_master_id=$1 ORDER BY vendor_option_code', [canonicalId]),
        client.query('SELECT * FROM product_dimensions WHERE product_master_id=$1', [canonicalId]),
        client.query('SELECT * FROM product_electrical WHERE product_master_id=$1', [canonicalId]),
        client.query('SELECT * FROM product_hydraulic WHERE product_master_id=$1', [canonicalId]),
        client.query('SELECT * FROM product_pneumatic WHERE product_master_id=$1', [canonicalId]),
        client.query(`SELECT fc.id, fc.label, fc.unit, fc.field_type, fc.sort_order, pcv.value_text
         FROM family_classifiers fc
         LEFT JOIN product_classifier_values pcv
           ON pcv.classifier_id=fc.id AND pcv.product_id=$1
         WHERE fc.family_id=$2
         ORDER BY fc.sort_order, fc.created_at`, [canonicalId, product.product_family_id]),
        client.query(`SELECT DISTINCT p.id, p.project_code, p.project_name, p.project_status
         FROM product_usages pu JOIN projects p ON p.id=pu.project_id
         WHERE pu.product_master_id=$1 ORDER BY p.project_code`, [canonicalId]),
        client.query(`SELECT er.* FROM entity_relationships er
         WHERE (er.source_id=$1 AND er.source_type IN ('product', 'product_master'))
            OR (er.target_id=$1 AND er.target_type IN ('product', 'product_master'))
         ORDER BY er.created_at`, [canonicalId]),
        client.query(`SELECT id, document_code, document_title, document_type, current_revision, status
         FROM documents WHERE product_id=$1 ORDER BY document_type, document_code`, [canonicalId]),
    ]);
    const capturedAt = new Date().toISOString();
    const isPneumaticProduct = String(product.product_category || '').toLowerCase() === 'pneumatic';
    const specificationRows = {
        dimensions: dimensions.rows[0] ?? null,
        electrical: electrical.rows[0] ?? null,
        hydraulic: hydraulic.rows[0] ?? null,
        pneumatic: isPneumaticProduct ? pneumatic.rows[0] ?? null : null,
    };
    const sourceSnapshot = {
        schema_version: 1,
        source: 'PIM Product Master',
        source_product_id: canonicalId,
        source_product_code: product.product_code,
        generated_at: capturedAt,
        product,
        specifications: specificationRows,
        classifier_values: classifiers.rows,
        variants: variants.rows,
        boms: boms.rows,
        vendors: vendors.rows,
        linked_context: {
            projects: projects.rows,
            relationships: relationships.rows,
            documents: linkedDocuments.rows,
        },
    };
    const knownValues = {
        product_code: product.product_code,
        product_name: product.product_name,
        product_category: product.product_category,
        application_type: product.application_type,
        manufacturer: product.manufacturer,
        model: product.model,
        design_flow_m3h: product.design_flow_m3h,
        design_pressure_bar: product.design_pressure_bar,
        design_head_m: product.design_head_m,
        power_kw: product.power_kw,
        primary_material_code: product.primary_material_code,
        image_url: product.image_url,
        notes: product.notes,
        dimensions: specificationRows.dimensions,
        electrical: specificationRows.electrical,
        hydraulic: specificationRows.hydraulic,
        pneumatic: specificationRows.pneumatic,
        bill_of_materials: boms.rows,
        vendors: vendors.rows,
        linked_projects: projects.rows,
    };
    const unavailableFields = Object.entries(knownValues)
        .filter(([, value]) => value == null || (Array.isArray(value) && value.length === 0))
        .map(([field]) => field);
    const content = {
        template: 'PIM Technical Data Sheet',
        title: `${product.product_code} — ${product.product_name}`,
        source_product_id: canonicalId,
        generated_at: capturedAt,
        sections: {
            identity: {
                product_code: product.product_code,
                product_name: product.product_name,
                manufacturer: product.manufacturer ?? null,
                model: product.model ?? null,
                image_url: product.image_url ?? null,
            },
            classification: {
                product_category: product.product_category ?? null,
                application_type: product.application_type ?? null,
                product_family: product.product_family_name ?? null,
                standard_status: product.standard_status ?? null,
                classifier_values: classifiers.rows,
            },
            engineering_values: {
                design_flow_m3h: product.design_flow_m3h ?? null,
                design_pressure_bar: product.design_pressure_bar ?? null,
                design_head_m: product.design_head_m ?? null,
                power_kw: product.power_kw ?? null,
            },
            materials: {
                primary_material_code: product.primary_material_code ?? null,
                material_name: product.material_name ?? null,
                material_category: product.material_category ?? null,
                density: product.density ?? null,
                chemical_resistance: product.chemical_resistance ?? null,
                temperature_limit: product.temperature_limit ?? null,
            },
            dimensions: specificationRows.dimensions,
            electrical: specificationRows.electrical,
            hydraulic: specificationRows.hydraulic,
            pneumatic: specificationRows.pneumatic,
            bill_of_materials: boms.rows,
            vendors: vendors.rows,
            linked_context: sourceSnapshot.linked_context,
            notes: product.notes ?? null,
        },
        unavailable_fields: unavailableFields,
    };
    return { canonicalId, product, capturedAt, sourceSnapshot, content };
};
// PRODUCT FAMILIES
router.get('/product-families', async (req, res) => {
    const result = await (0, db_1.query)('SELECT pf.*, COUNT(pm.id) as product_count FROM product_families pf LEFT JOIN product_masters pm ON pm.product_family_id=pf.id GROUP BY pf.id ORDER BY pf.product_family_code');
    res.json({ items: result.rows });
});
router.get('/product-families/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product family not found' } });
    const products = await (0, db_1.query)('SELECT * FROM product_masters WHERE product_family_id=$1 ORDER BY product_code', [result.rows[0].id]);
    res.json({ ...result.rows[0], products: products.rows });
});
router.post('/product-families', auth_1.authenticate, async (req, res) => {
    const { product_family_code, product_family_name, category_code, description } = req.body;
    const result = await (0, db_1.query)('INSERT INTO product_families (product_family_code, product_family_name, category_code, description) VALUES ($1,$2,$3,$4) RETURNING *', [product_family_code, product_family_name, category_code, description]);
    res.status(201).json(result.rows[0]);
});
router.put('/product-families/:id', auth_1.authenticate, async (req, res) => {
    const { product_family_name, category_code, description, status } = req.body;
    const result = await (0, db_1.query)('UPDATE product_families SET product_family_name=$1, category_code=$2, description=$3, status=COALESCE($4, status), updated_at=NOW() WHERE id::text=$5 RETURNING *', [product_family_name, category_code, description, status || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
    res.json(result.rows[0]);
});
// TANK FAMILIES
router.get('/tank-families', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT tf.*, COUNT(pm.id)::int as product_count
     FROM tank_families tf
     LEFT JOIN product_masters pm ON pm.tank_family_id = tf.id
     GROUP BY tf.id ORDER BY tf.sort_order, tf.name`);
    res.json({ items: result.rows });
});
router.get('/tank-families/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM tank_families WHERE id::text=$1 OR code=$1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
    const products = await (0, db_1.query)('SELECT * FROM product_masters WHERE tank_family_id=$1 ORDER BY product_code', [result.rows[0].id]);
    res.json({ ...result.rows[0], products: products.rows });
});
router.post('/tank-families', auth_1.authenticate, async (req, res) => {
    const { code, name, description, sort_order } = req.body;
    if (!code || !name)
        return res.status(400).json({ error: { code: 'INVALID', message: 'code and name are required' } });
    const result = await (0, db_1.query)('INSERT INTO tank_families (code, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *', [code.toUpperCase(), name, description || null, sort_order ?? 0]);
    res.status(201).json(result.rows[0]);
});
router.put('/tank-families/:id', auth_1.authenticate, async (req, res) => {
    const { name, description, sort_order } = req.body;
    const result = await (0, db_1.query)('UPDATE tank_families SET name=$1, description=$2, sort_order=$3, updated_at=NOW() WHERE id::text=$4 RETURNING *', [name, description || null, sort_order ?? 0, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
    res.json(result.rows[0]);
});
router.delete('/tank-families/:id', auth_1.authenticate, async (req, res) => {
    const existing = await (0, db_1.query)('SELECT id FROM tank_families WHERE id::text=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
    await (0, db_1.query)('UPDATE product_masters SET tank_family_id=NULL WHERE tank_family_id::text=$1', [req.params.id]);
    await (0, db_1.query)('DELETE FROM tank_families WHERE id::text=$1', [req.params.id]);
    res.status(204).end();
});
// PRODUCT MASTERS
router.get('/product-masters', auth_1.authenticate, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const page_size = Math.min(parseInt(req.query.page_size) || 25, 200);
    const offset = (page - 1) * page_size;
    const filters = [];
    const params = [];
    // Status values have historically been entered through more than one
    // surface, so protect the default catalog view from casing/whitespace
    // variations as well as the canonical "Obsolete" value.
    if (req.query.include_obsolete !== 'true') {
        filters.push(`LOWER(BTRIM(COALESCE(pm.standard_status, ''))) <> 'obsolete'`);
    }
    if (req.query.family_id) {
        params.push(req.query.family_id);
        filters.push(`pm.product_family_id = $${params.length}`);
    }
    if (req.query.tank_family_id) {
        params.push(req.query.tank_family_id);
        filters.push(`pm.tank_family_id = $${params.length}`);
    }
    if (req.query.category) {
        params.push(req.query.category);
        filters.push(`pm.product_category = $${params.length}`);
    }
    if (req.query.status) {
        params.push(req.query.status);
        filters.push(`pm.standard_status = $${params.length}`);
    }
    if (req.query.q) {
        params.push(`%${req.query.q}%`);
        const p = params.length;
        filters.push(`(pm.product_name ILIKE $${p} OR pm.product_code ILIKE $${p} OR pf.product_family_name ILIKE $${p} OR EXISTS (SELECT 1 FROM unnest(pm.synonyms) s WHERE s ILIKE $${p}))`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM product_masters pm LEFT JOIN product_families pf ON pm.product_family_id=pf.id ${where}`, params);
    params.push(page_size, offset);
    const result = await (0, db_1.query)(`SELECT pm.*, COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
       CASE
         WHEN pm.design_flow_m3h IS NOT NULL AND ph.design_flow_m3h IS NOT NULL
              AND pm.design_flow_m3h IS DISTINCT FROM ph.design_flow_m3h THEN 'conflict'
         WHEN pm.design_flow_m3h IS NULL AND ph.design_flow_m3h IS NULL THEN 'empty'
         ELSE 'synchronized'
       END AS design_flow_sync_status,
       pf.product_family_name, tf.name AS tank_family_name,
       COALESCE(
         pm.surface_area_m2,
         CASE
           WHEN pm.shape_type='Cylindrical' AND pm.width_mm IS NOT NULL
             THEN ROUND((PI() * POWER(pm.width_mm / 2.0, 2) / 1000000.0)::numeric, 4)
           WHEN pm.shape_type IS DISTINCT FROM 'Custom' AND pm.length_mm IS NOT NULL AND pm.width_mm IS NOT NULL
             THEN ROUND((pm.length_mm * pm.width_mm / 1000000.0)::numeric, 4)
           ELSE NULL
         END
       ) AS surface_area_m2,
       COALESCE(st.tank_code, pm.source_tank_snapshot->>'tank_code') AS source_tank_code,
       COALESCE(sp.project_code, pm.source_tank_snapshot->>'project_code') AS source_project_code,
       COALESCE(sp.project_name, pm.source_tank_snapshot->>'project_name') AS source_project_name
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     LEFT JOIN product_families pf ON pm.product_family_id=pf.id
     LEFT JOIN tank_families tf ON pm.tank_family_id=tf.id
     LEFT JOIN tanks st ON st.id=pm.source_tank_id
     LEFT JOIN projects sp ON sp.id=st.project_id
     ${where} ORDER BY pm.product_code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});
router.get('/product-masters/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT pm.*, COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
       CASE
         WHEN pm.design_flow_m3h IS NOT NULL AND ph.design_flow_m3h IS NOT NULL
              AND pm.design_flow_m3h IS DISTINCT FROM ph.design_flow_m3h THEN 'conflict'
         WHEN pm.design_flow_m3h IS NULL AND ph.design_flow_m3h IS NULL THEN 'empty'
         ELSE 'synchronized'
       END AS design_flow_sync_status,
       pm.design_flow_m3h AS product_design_flow_m3h,
       ph.design_flow_m3h AS hydraulic_design_flow_m3h,
       pf.product_family_name, m.material_name,
       COALESCE(
         pm.surface_area_m2,
         CASE
           WHEN pm.shape_type='Cylindrical' AND pm.width_mm IS NOT NULL
             THEN ROUND((PI() * POWER(pm.width_mm / 2.0, 2) / 1000000.0)::numeric, 4)
           WHEN pm.shape_type IS DISTINCT FROM 'Custom' AND pm.length_mm IS NOT NULL AND pm.width_mm IS NOT NULL
             THEN ROUND((pm.length_mm * pm.width_mm / 1000000.0)::numeric, 4)
           ELSE NULL
         END
       ) AS surface_area_m2,
       COALESCE(st.tank_code, pm.source_tank_snapshot->>'tank_code') AS source_tank_code,
       COALESCE(sp.project_code, pm.source_tank_snapshot->>'project_code') AS source_project_code,
       COALESCE(sp.project_name, pm.source_tank_snapshot->>'project_name') AS source_project_name
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     LEFT JOIN product_families pf ON pm.product_family_id=pf.id
     LEFT JOIN materials m ON pm.primary_material_code=m.material_code
     LEFT JOIN tanks st ON st.id=pm.source_tank_id
     LEFT JOIN projects sp ON sp.id=st.project_id
     WHERE pm.id::text=$1 OR pm.product_code=$1`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const variants = await (0, db_1.query)('SELECT * FROM product_variants WHERE product_master_id=$1 ORDER BY variant_code', [result.rows[0].id]);
    const boms = await (0, db_1.query)('SELECT * FROM standard_boms WHERE product_master_id=$1 ORDER BY effective_from DESC', [result.rows[0].id]);
    const vendors = await (0, db_1.query)('SELECT * FROM vendor_options WHERE product_master_id=$1 ORDER BY vendor_option_code', [result.rows[0].id]);
    const projectUsage = await (0, db_1.query)(`SELECT DISTINCT p.project_code, p.project_name, p.project_status FROM product_usages pu JOIN projects p ON pu.project_id=p.id WHERE pu.product_master_id=$1`, [result.rows[0].id]);
    const documents = await (0, db_1.query)(`SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name FROM documents d LEFT JOIN users u ON d.created_by=u.id WHERE d.product_id=$1 ORDER BY d.document_type, d.document_code`, [result.rows[0].id]);
    res.json({ ...result.rows[0], variants: variants.rows, boms: boms.rows, vendors: vendors.rows, projects: projectUsage.rows, documents: documents.rows });
});
// Generated TDS documents use the normal document lifecycle. Each revision
// carries its own source snapshot so frozen review evidence is never rewritten.
router.post('/product-masters/:id/generate-tds', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('pim'), (0, auth_1.requireModuleManage)('documents'), async (req, res, next) => {
    const connect = db_1.default?.connect;
    const client = typeof connect === 'function'
        ? await connect.call(db_1.default)
        : { query: db_1.query };
    try {
        await client.query('BEGIN');
        const { canonicalId, product, capturedAt, sourceSnapshot, content } = await readPimTdsSource(client, String(req.params.id));
        const existingDocument = await client.query(`SELECT * FROM documents
       WHERE product_id=$1 AND generated_source='pim_tds'
       FOR UPDATE`, [canonicalId]);
        let document;
        let revision;
        let action;
        if (!existingDocument.rows[0]) {
            const baseDocumentCode = `${product.product_code}-TDS`;
            const usedCodesResult = await client.query('SELECT document_code FROM documents WHERE document_code LIKE $1', [`${baseDocumentCode}%`]);
            const usedCodes = new Set(usedCodesResult.rows.map(row => row.document_code));
            let documentCode = baseDocumentCode;
            if (usedCodes.has(documentCode)) {
                documentCode = `${baseDocumentCode}-PIM`;
                let suffix = 2;
                while (usedCodes.has(documentCode)) {
                    documentCode = `${baseDocumentCode}-PIM-${suffix}`;
                    suffix += 1;
                }
            }
            const documentResult = await client.query(`INSERT INTO documents
           (document_code, document_title, document_type, discipline, product_id,
            current_revision, status, owner, notes, generated_source, created_by)
         VALUES ($1,$2,'Technical Data Sheet',$3,$4,'A','Draft',$5,$6,'pim_tds',$7)
         RETURNING *`, [
                documentCode,
                `${product.product_name} Technical Data Sheet`,
                product.product_category || 'General',
                canonicalId,
                product.manufacturer || 'PIM Product Master',
                'Generated from the current Product Master data',
                req.user.id,
            ]);
            document = documentResult.rows[0];
            const revisionResult = await client.query(`INSERT INTO document_revisions
           (document_id, revision_code, revision_purpose, status, issued_by,
            content, source_snapshot, generated_at, created_by, generated_source)
         VALUES ($1,'A','Generated from PIM Product Master','Draft',$2,$3,$4,$5,$2,'pim_tds')
         RETURNING *`, [document.id, req.user.id, content, sourceSnapshot, capturedAt]);
            revision = revisionResult.rows[0];
            action = 'created';
            await client.query(`INSERT INTO lifecycle_transitions (entity_type, entity_id, to_state, actor_id, comment)
         VALUES ('document',$1,'Draft',$2,$3)`, [document.id, req.user.id, 'Generated TDS from Product Master']);
        }
        else {
            document = existingDocument.rows[0];
            const previousDocumentStatus = document.status;
            const revisionsResult = await client.query(`SELECT * FROM document_revisions
         WHERE document_id=$1 ORDER BY created_at DESC`, [document.id]);
            const revisions = revisionsResult.rows;
            const latest = revisions[0];
            if (latest && isEditableDocumentRevision(latest.status)) {
                const revisionResult = await client.query(`UPDATE document_revisions
           SET revision_purpose='Regenerated from current PIM Product Master',
               status='Draft', content=$1, source_snapshot=$2, generated_at=$3
           WHERE id=$4
           RETURNING *`, [content, sourceSnapshot, capturedAt, latest.id]);
                revision = revisionResult.rows[0];
                action = 'updated';
            }
            else {
                const revisionCode = nextRevisionCode(revisions.map(row => row.revision_code));
                const revisionResult = await client.query(`INSERT INTO document_revisions
             (document_id, revision_code, revision_purpose, status, issued_by,
               content, source_snapshot, generated_at, created_by, generated_source)
           VALUES ($1,$2,'Generated from updated PIM Product Master','Draft',$3,$4,$5,$6,$3,'pim_tds')
           RETURNING *`, [document.id, revisionCode, req.user.id, content, sourceSnapshot, capturedAt]);
                revision = revisionResult.rows[0];
                action = 'revision_created';
            }
            const updatedDocument = await client.query(`UPDATE documents SET current_revision=$1, status='Draft', updated_at=NOW()
         WHERE id=$2 RETURNING *`, [revision.revision_code, document.id]);
            document = updatedDocument.rows[0] || { ...document, current_revision: revision.revision_code, status: 'Draft' };
            await client.query(`INSERT INTO lifecycle_transitions (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('document',$1,$2,'Draft',$3,$4)`, [document.id, previousDocumentStatus, req.user.id, 'TDS regenerated from Product Master']);
        }
        await client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details)
       VALUES ('document',$1,'GENERATE_TDS',$2,$3)`, [document.id, req.user.id, {
                summary: `${action === 'created' ? 'Generated' : 'Regenerated'} TDS from Product Master`,
                source_product_id: canonicalId,
                source_product_code: product.product_code,
                revision_code: revision.revision_code,
                generation_action: action,
            }]);
        await client.query('COMMIT');
        const unavailableFields = Array.isArray(content.unavailable_fields)
            ? content.unavailable_fields
            : [];
        res.status(action === 'created' ? 201 : 200).json({
            document,
            revision,
            generation: {
                action,
                generated_at: capturedAt,
                source_product_id: canonicalId,
                warnings: unavailableFields.length >= 8
                    ? [`Product data is sparse; ${unavailableFields.length} TDS fields are marked unavailable.`]
                    : [],
            },
        });
    }
    catch (error) {
        try {
            await client.query('ROLLBACK');
        }
        catch { }
        if (error?.code === '23505') {
            error.status = 409;
            error.code = 'TDS_CONFLICT';
            error.message = 'A document conflict prevented TDS generation. Refresh the product and try again.';
        }
        next(error);
    }
    finally {
        client.release?.();
    }
});
router.post('/product-masters/bulk-import', auth_1.authenticate, async (req, res) => {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'rows array required' } });
    const created = [];
    const linked = [];
    const errors = [];
    for (const row of rows) {
        if (!row.product_code || !row.product_name) {
            errors.push({ code: row.product_code || '?', message: 'product_code and product_name required' });
            continue;
        }
        try {
            const existing = await (0, db_1.query)('SELECT id FROM product_masters WHERE product_code=$1', [row.product_code]);
            if (existing.rows[0]) {
                linked.push(row.product_code);
                continue;
            }
            let family_id = null;
            if (row.family_code) {
                const fam = await (0, db_1.query)('SELECT id FROM product_families WHERE product_family_code=$1', [row.family_code]);
                if (fam.rows[0])
                    family_id = fam.rows[0].id;
            }
            const noteParts = [];
            if (row.dn_size)
                noteParts.push(`DN: ${row.dn_size}`);
            if (row.pressure_rating)
                noteParts.push(`Rating: ${row.pressure_rating}`);
            if (row.notes)
                noteParts.push(row.notes);
            const notes = noteParts.length ? noteParts.join(' | ') : null;
            await (0, db_1.query)('INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, primary_material_code, standard_status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [row.product_code, family_id, row.product_name, 'Piping', row.application_type || null, row.primary_material_code || null, row.standard_status || 'Active', notes]);
            created.push(row.product_code);
        }
        catch (err) {
            errors.push({ code: row.product_code, message: err.message });
        }
    }
    res.json({ created: created.length, linked: linked.length, errors, created_codes: created, linked_codes: linked });
});
router.post('/product-masters', auth_1.authenticate, async (req, res, next) => {
    const { product_code, product_family_id, tank_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, manufacturer, model, configuration, control_type, lamp_count, } = req.body;
    if (!product_code || !product_name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'product_code and product_name required' } });
    const surfaceAreaM2 = (0, tankCalculations_1.calculateWaterSurfaceAreaM2)(shape_type, length_mm ? parseFloat(length_mm) : null, width_mm ? parseFloat(width_mm) : null);
    try {
        const linkedFlow = normalizeDesignFlow(design_flow_m3h);
        const applyAatFrictionDefault = isAatSandFilter({ manufacturer, product_name, model });
        const created = await withProductTransaction(async (client) => {
            const result = await client.query(`INSERT INTO product_masters
          (product_code, product_family_id, tank_family_id, product_name, product_category, application_type,
           design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes,
           shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, surface_area_m2, cost,
            manufacturer, model, configuration, control_type, lamp_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`, [
                product_code, product_family_id || null, tank_family_id || null, product_name, product_category, application_type,
                linkedFlow, design_pressure_bar || null, design_head_m || null, power_kw || null,
                primary_material_code || null, standard_status || 'Concept', notes || null,
                shape_type || null, length_mm || null, width_mm || null, height_mm || null,
                design_water_level_mm || null, gross_volume_m3 || null, operating_volume_m3 || null, surfaceAreaM2, 0,
                manufacturer || null, model || null, configuration || null, control_type || null,
                lamp_count == null || lamp_count === '' ? null : Number(lamp_count),
            ]);
            await client.query('INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, friction_loss_mh2o, updated_at) VALUES ($1,$2,$3,NOW())', [result.rows[0].id, linkedFlow, applyAatFrictionDefault ? 5.0 : null]);
            if (applyAatFrictionDefault) {
                await client.query(`INSERT INTO product_hydraulic_catalog_defaults (product_master_id, default_key)
           VALUES ($1,$2)
           ON CONFLICT (product_master_id, default_key) DO NOTHING`, [result.rows[0].id, AAT_SAND_FILTER_FRICTION_DEFAULT_KEY]);
            }
            await insertAuditTx(client, req.user.id, 'product', result.rows[0].id, 'CREATE', {
                summary: `Product ${product_code} created`,
                product_code,
                product_name,
                standard_status: standard_status || 'Concept',
            });
            await insertAuditTx(client, req.user.id, 'product', result.rows[0].id, 'LINKED_DESIGN_FLOW_UPDATE', designFlowAuditDetails('product_create', linkedFlow, null, null));
            return { ...result.rows[0], design_flow_m3h: linkedFlow, design_flow_sync_status: linkedFlow == null ? 'empty' : 'synchronized' };
        });
        res.status(201).json(created);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/product-masters/:id', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const inUse = await (0, db_1.query)(`SELECT 1 FROM tanks WHERE product_master_id=$1
     UNION ALL SELECT 1 FROM product_usages WHERE product_master_id=$1
     UNION ALL SELECT 1 FROM uv_engineering_catalogs WHERE product_master_id=$1
     LIMIT 1`, [id]);
    if (inUse.rows.length > 0) {
        return res.status(409).json({ error: { code: 'IN_USE', message: 'Cannot delete — product is linked to existing tanks, equipment, or usages. Remove those links first.' } });
    }
    await (0, db_1.query)('DELETE FROM bom_lines WHERE standard_bom_id IN (SELECT id FROM standard_boms WHERE product_master_id=$1)', [id]);
    await (0, db_1.query)('DELETE FROM standard_boms WHERE product_master_id=$1', [id]);
    await (0, db_1.query)('DELETE FROM entity_relationships WHERE source_id=$1 OR target_id=$1', [id]);
    await (0, db_1.query)('DELETE FROM documents WHERE product_id=$1', [id]);
    const result = await (0, db_1.query)('DELETE FROM product_masters WHERE id::text=$1 RETURNING id, product_code', [id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'product', String(id), 'DELETE', {
        summary: `Product ${result.rows[0].product_code} deleted`,
        product_code: result.rows[0].product_code,
    });
    res.json({ deleted: true });
});
router.put('/product-masters/:id', auth_1.authenticate, async (req, res, next) => {
    const { product_code, product_name, product_category, application_type, design_flow_m3h, design_head_m, power_kw, primary_material_code, standard_status, image_url, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, wall_thickness_mm, weight_kg, product_family_id, tank_family_id, synonyms, cost, sell_price, currency, manufacturer, model, configuration, control_type, status, lamp_count } = req.body;
    const hasPowerKw = Object.prototype.hasOwnProperty.call(req.body, 'power_kw');
    const hasLampCount = Object.prototype.hasOwnProperty.call(req.body, 'lamp_count');
    const lampCountValue = lamp_count == null || lamp_count === '' ? null : Number(lamp_count);
    if (hasLampCount && lampCountValue != null && (!Number.isInteger(lampCountValue) || lampCountValue <= 0)) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'lamp_count must be a positive integer or blank' } });
    }
    const hasDesignFlow = Object.prototype.hasOwnProperty.call(req.body, 'design_flow_m3h');
    const synonymsArr = Array.isArray(synonyms) ? synonyms.filter(Boolean) : [];
    const costVal = (cost === null || cost === undefined || cost === '') ? 0 : parseFloat(String(cost));
    const sellVal = (sell_price === null || sell_price === undefined || sell_price === '') ? null : parseFloat(String(sell_price));
    const weightVal = weight_kg != null && weight_kg !== '' ? parseFloat(weight_kg) : null;
    // Normalise the incoming code — null means "don't change"
    const newCode = (product_code && String(product_code).trim()) ? String(product_code).trim().toUpperCase() : null;
    let previousProductFlow;
    let previousHydraulicFlow;
    let linkedDesignFlow;
    let updated;
    try {
        updated = await withProductTransaction(async (client) => {
            if (newCode) {
                const conflict = await client.query('SELECT id FROM product_masters WHERE product_code=$1 AND id::text!=$2', [newCode, req.params.id]);
                if (conflict.rows.length > 0) {
                    const error = new Error(`Product code ${newCode} is already in use`);
                    error.status = 409;
                    error.code = 'CONFLICT';
                    throw error;
                }
            }
            const current = await client.query(`SELECT pm.design_flow_m3h AS product_design_flow_m3h,
                ph.design_flow_m3h AS hydraulic_design_flow_m3h
         FROM product_masters pm
         LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
         WHERE pm.id=$1
         FOR UPDATE OF pm`, [req.params.id]);
            previousProductFlow = current.rows[0]?.product_design_flow_m3h;
            previousHydraulicFlow = current.rows[0]?.hydraulic_design_flow_m3h;
            if (flowsConflict(previousProductFlow, previousHydraulicFlow) && req.body.design_flow_conflict_resolution !== 'product_master') {
                const error = new Error('Conflicting populated design flows require an explicit product_master resolution');
                error.status = 409;
                error.code = 'DESIGN_FLOW_CONFLICT';
                throw error;
            }
            linkedDesignFlow = flowsConflict(previousProductFlow, previousHydraulicFlow)
                ? Number(previousProductFlow)
                : hasDesignFlow
                    ? normalizeDesignFlow(design_flow_m3h)
                    : previousHydraulicFlow != null
                        ? Number(previousHydraulicFlow)
                        : previousProductFlow != null
                            ? Number(previousProductFlow)
                            : null;
            const result = await client.query(`UPDATE product_masters SET product_code=COALESCE($32, product_code), product_name=$1, product_category=$2, application_type=$3, design_flow_m3h=$4, design_head_m=$5, power_kw=CASE WHEN $33 THEN $6 ELSE power_kw END, primary_material_code=$7, standard_status=$8, image_url=$9, notes=$10, shape_type=$11, length_mm=$12, width_mm=$13, height_mm=$14, design_water_level_mm=$15, gross_volume_m3=$16, operating_volume_m3=$17, product_family_id=$18, synonyms=$19, tank_family_id=$20, cost=$21, sell_price=$22, currency=$23, wall_thickness_mm=$24, weight_kg=$25, manufacturer=$26, model=$27, configuration=$28, control_type=$29, status=COALESCE($30,status), lamp_count=CASE WHEN $34 THEN $35 ELSE lamp_count END, updated_at=NOW() WHERE id=$31 RETURNING *`, [product_name, product_category, application_type, linkedDesignFlow, design_head_m || null, power_kw, primary_material_code, standard_status, image_url || null, notes, shape_type || null, length_mm || null, width_mm || null, height_mm || null, design_water_level_mm || null, gross_volume_m3 || null, operating_volume_m3 || null, product_family_id || null, synonymsArr, tank_family_id || null, costVal, sellVal, currency || 'USD', wall_thickness_mm || null, weightVal, manufacturer || null, model || null, configuration || null, control_type || null, status || null, req.params.id, newCode, hasPowerKw, hasLampCount, lampCountValue]);
            if (!result.rows[0]) {
                const error = new Error('Product not found');
                error.status = 404;
                error.code = 'NOT_FOUND';
                throw error;
            }
            await client.query(`INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, updated_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (product_master_id) DO UPDATE SET design_flow_m3h=EXCLUDED.design_flow_m3h, updated_at=NOW()`, [req.params.id, linkedDesignFlow]);
            if (flowsConflict(previousProductFlow, previousHydraulicFlow)) {
                await client.query(`UPDATE product_design_flow_reconciliations
           SET status='resolved', resolution='product_master', resolved_value_m3h=$2,
               resolved_by=$3, resolved_at=NOW()
           WHERE product_master_id=$1 AND status='unresolved'`, [req.params.id, linkedDesignFlow, req.user.id]);
            }
            if (hasDesignFlow || previousProductFlow !== previousHydraulicFlow) {
                await insertAuditTx(client, req.user.id, 'product', String(req.params.id), 'LINKED_DESIGN_FLOW_UPDATE', designFlowAuditDetails('product_master', linkedDesignFlow ?? null, previousProductFlow, previousHydraulicFlow));
            }
            return { ...result.rows[0], design_flow_m3h: linkedDesignFlow, design_flow_sync_status: linkedDesignFlow == null ? 'empty' : 'synchronized' };
        });
    }
    catch (error) {
        return next(error);
    }
    await (0, audit_1.logAudit)(req.user.id, 'product', String(req.params.id), 'UPDATE', {
        summary: 'Product details updated',
        product_code: product_code || undefined,
        product_name,
        standard_status,
        manufacturer: manufacturer || null,
        model: model || null,
        cost: costVal,
        sell_price: sellVal,
        primary_material_code: primary_material_code || null,
    });
    res.json(updated);
});
router.post('/product-masters/:id/duplicate', auth_1.authenticate, (0, auth_1.requireModuleManage)('pim'), async (req, res, next) => {
    const orig = await (0, db_1.query)(`SELECT pm.*, ph.design_flow_m3h AS hydraulic_design_flow_m3h
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     WHERE pm.id=$1`, [req.params.id]);
    if (!orig.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const src = orig.rows[0];
    let newCode = req.body.product_code ? req.body.product_code.trim().toUpperCase() : '';
    if (!newCode) {
        newCode = `${src.product_code}-COPY`;
        let suffix = 1;
        while (true) {
            const exists = await (0, db_1.query)('SELECT id FROM product_masters WHERE product_code=$1', [newCode]);
            if (!exists.rows[0])
                break;
            suffix++;
            newCode = `${src.product_code}-COPY-${suffix}`;
        }
    }
    else {
        const exists = await (0, db_1.query)('SELECT id FROM product_masters WHERE product_code=$1', [newCode]);
        if (exists.rows[0])
            return res.status(409).json({ error: { code: 'CONFLICT', message: `Product code ${newCode} already exists` } });
    }
    const newName = req.body.product_name ? req.body.product_name.trim() : `Copy of ${src.product_name}`;
    const newFamilyId = ('product_family_id' in req.body) ? (req.body.product_family_id || null) : src.product_family_id;
    const newStatus = req.body.standard_status || src.standard_status;
    try {
        const linkedFlow = src.hydraulic_design_flow_m3h != null ? Number(src.hydraulic_design_flow_m3h) : normalizeDesignFlow(src.design_flow_m3h);
        const applyAatFrictionDefault = isAatSandFilter({ manufacturer: src.manufacturer, product_name: src.product_name, model: src.model });
        const created = await withProductTransaction(async (client) => {
            const result = await client.query(`INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, design_pressure_bar, design_head_m, power_kw, primary_material_code, standard_status, notes, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3, synonyms, manufacturer, model, wall_thickness_mm, weight_kg, tank_family_id, configuration, control_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`, [newCode, newFamilyId, newName, src.product_category, src.application_type, linkedFlow, src.design_pressure_bar, src.design_head_m, src.power_kw, src.primary_material_code, newStatus, src.notes, src.shape_type, src.length_mm, src.width_mm, src.height_mm, src.design_water_level_mm, src.gross_volume_m3, src.operating_volume_m3, src.synonyms || [], src.manufacturer || null, src.model || null, src.wall_thickness_mm || null, src.weight_kg || null, src.tank_family_id || null, src.configuration || null, src.control_type || null]);
            await client.query(`INSERT INTO product_hydraulic
           (product_master_id, design_flow_m3h, min_flow_m3h, max_flow_m3h, venturi_flow_m3h,
            friction_loss_mh2o, design_head_m, design_pressure_bar, max_pressure_bar, npsh_required_m, fluid_type,
            min_temperature_c, max_temperature_c, notes, updated_at)
         SELECT $1::uuid,$2::numeric,min_flow_m3h,max_flow_m3h,venturi_flow_m3h,friction_loss_mh2o,design_head_m,design_pressure_bar,
                max_pressure_bar,npsh_required_m,fluid_type,min_temperature_c,max_temperature_c,notes,NOW()
         FROM product_hydraulic WHERE product_master_id=$3
          UNION ALL
           SELECT $1::uuid,$2::numeric,NULL,NULL,NULL,$4::numeric,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NOW()
         WHERE NOT EXISTS (SELECT 1 FROM product_hydraulic WHERE product_master_id=$3)`, [result.rows[0].id, linkedFlow, req.params.id, applyAatFrictionDefault ? 5.0 : null]);
            if (String(src.product_category || '').toLowerCase() === 'pneumatic') {
                await client.query(`INSERT INTO product_pneumatic
             (product_master_id, gas_flow_value, gas_flow_unit, operating_temperature_value, operating_temperature_unit,
              dew_point_value, dew_point_unit, inlet_port_value, inlet_port_unit, outlet_port_value, outlet_port_unit, updated_at)
           SELECT $1::uuid, gas_flow_value, gas_flow_unit, operating_temperature_value, operating_temperature_unit,
                  dew_point_value, dew_point_unit, inlet_port_value, inlet_port_unit, outlet_port_value, outlet_port_unit, NOW()
           FROM product_pneumatic
           WHERE product_master_id=$2`, [result.rows[0].id, req.params.id]);
            }
            if (applyAatFrictionDefault) {
                await client.query(`INSERT INTO product_hydraulic_catalog_defaults (product_master_id, default_key)
           VALUES ($1,$2)
           ON CONFLICT (product_master_id, default_key) DO NOTHING`, [result.rows[0].id, AAT_SAND_FILTER_FRICTION_DEFAULT_KEY]);
            }
            await insertAuditTx(client, req.user.id, 'product', result.rows[0].id, 'LINKED_DESIGN_FLOW_UPDATE', designFlowAuditDetails('product_duplicate', linkedFlow, src.design_flow_m3h, src.hydraulic_design_flow_m3h));
            return { ...result.rows[0], design_flow_m3h: linkedFlow, design_flow_sync_status: linkedFlow == null ? 'empty' : 'synchronized' };
        });
        res.status(201).json(created);
    }
    catch (error) {
        next(error);
    }
});
// PRODUCT VARIANTS
router.get('/product-variants', auth_1.authenticate, async (req, res) => {
    let where = '', params = [];
    if (req.query.product_master_id) {
        params.push(req.query.product_master_id);
        where = `WHERE pv.product_master_id=$1`;
    }
    const result = await (0, db_1.query)(`SELECT pv.*, pm.product_code, pm.product_name FROM product_variants pv JOIN product_masters pm ON pv.product_master_id=pm.id ${where} ORDER BY pv.variant_code`, params);
    res.json({ items: result.rows });
});
router.post('/product-variants', auth_1.authenticate, async (req, res) => {
    const { variant_code, product_master_id, variant_name, variant_reason, override_material_code, override_power_kw, override_region } = req.body;
    const result = await (0, db_1.query)('INSERT INTO product_variants (variant_code, product_master_id, variant_name, variant_reason, override_material_code, override_power_kw, override_region) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [variant_code, product_master_id, variant_name, variant_reason, override_material_code, override_power_kw, override_region]);
    res.status(201).json(result.rows[0]);
});
// STANDARD BOMs
router.get('/product-boms', auth_1.authenticate, async (req, res) => {
    let where = '', params = [];
    if (req.query.product_master_id) {
        params.push(req.query.product_master_id);
        where = `WHERE product_master_id=$1`;
    }
    const result = await (0, db_1.query)(`SELECT * FROM standard_boms ${where} ORDER BY effective_from DESC`, params);
    res.json({ items: result.rows });
});
router.get('/product-boms/:id', auth_1.authenticate, async (req, res) => {
    const bom = await (0, db_1.query)('SELECT sb.*, pm.product_code, pm.product_name FROM standard_boms sb JOIN product_masters pm ON sb.product_master_id=pm.id WHERE sb.id=$1', [req.params.id]);
    if (!bom.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM not found' } });
    const lines = await (0, db_1.query)(`SELECT bl.*, pm.product_code AS sub_product_code, pm.product_name AS sub_product_name
     FROM bom_lines bl
     LEFT JOIN product_masters pm ON bl.sub_product_id = pm.id
     WHERE bl.standard_bom_id=$1 ORDER BY bl.line_number`, [req.params.id]);
    res.json({ ...bom.rows[0], lines: lines.rows });
});
router.post('/product-boms', auth_1.authenticate, async (req, res) => {
    const { bom_code, product_master_id, revision_code, effective_from } = req.body;
    const result = await (0, db_1.query)('INSERT INTO standard_boms (bom_code, product_master_id, revision_code, effective_from) VALUES ($1,$2,$3,$4) RETURNING *', [bom_code, product_master_id, revision_code || 'A', effective_from]);
    res.status(201).json(result.rows[0]);
});
router.post('/product-boms/:id/lines', auth_1.authenticate, async (req, res) => {
    const { line_number, component_id, sub_product_id, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks } = req.body;
    const result = await (0, db_1.query)('INSERT INTO bom_lines (standard_bom_id, component_id, sub_product_id, line_number, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [req.params.id, component_id || null, sub_product_id || null, line_number, component_type, component_reference_code, component_name, quantity || 1, unit, is_optional || false, remarks]);
    res.status(201).json(result.rows[0]);
});
router.delete('/product-boms/:bomId/lines/:lineId', auth_1.authenticate, async (req, res) => {
    await (0, db_1.query)('DELETE FROM bom_lines WHERE id=$1 AND standard_bom_id=$2', [req.params.lineId, req.params.bomId]);
    res.status(204).end();
});
// PRODUCT RELATIONSHIPS
router.get('/product-masters/:id/relationships', auth_1.authenticate, async (req, res) => {
    const product = await (0, db_1.query)('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
    if (!product.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const pid = product.rows[0].id;
    const result = await (0, db_1.query)(`
    SELECT er.id, er.edge_type, er.properties,
      er.source_id, er.target_id,
      CASE WHEN er.source_id=$1::text THEN 'outgoing' ELSE 'incoming' END as direction,
      CASE WHEN er.source_id=$1::text THEN tgt.product_code ELSE src.product_code END as related_code,
      CASE WHEN er.source_id=$1::text THEN tgt.product_name ELSE src.product_name END as related_name,
      CASE WHEN er.source_id=$1::text THEN tgt.id ELSE src.id END as related_id,
      CASE WHEN er.source_id=$1::text THEN tgt.standard_status ELSE src.standard_status END as related_status
    FROM entity_relationships er
    LEFT JOIN product_masters src ON er.source_id=src.id::text
    LEFT JOIN product_masters tgt ON er.target_id=tgt.id::text
    WHERE (er.source_id=$1::text OR er.target_id=$1::text)
      AND er.source_type='product' AND er.target_type='product'
    ORDER BY er.edge_type`, [pid]);
    res.json({ items: result.rows });
});
router.post('/product-masters/:id/relationships', auth_1.authenticate, async (req, res) => {
    const { target_product_id, edge_type } = req.body;
    if (!target_product_id || !edge_type)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'target_product_id and edge_type required' } });
    const product = await (0, db_1.query)('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
    if (!product.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const result = await (0, db_1.query)('INSERT INTO entity_relationships (source_id, source_type, target_id, target_type, edge_type) VALUES ($1,$2,$3,$4,$5) RETURNING *', [product.rows[0].id, 'product', target_product_id, 'product', edge_type]);
    res.status(201).json(result.rows[0]);
});
// DELETE entity relationship (unlink)
router.delete('/entity-relationships/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('DELETE FROM entity_relationships WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Relationship not found' } });
    res.json({ success: true });
});
// COMPONENT VARIANTS (peer relationships via entity_relationships)
router.get('/components/:id/variants', auth_1.authenticate, async (req, res) => {
    const comp = await (0, db_1.query)('SELECT id FROM components WHERE id::text=$1 OR component_code=$1', [req.params.id]);
    if (!comp.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    const cid = comp.rows[0].id;
    const result = await (0, db_1.query)(`
    SELECT er.id, er.edge_type, er.properties,
      CASE WHEN er.source_id=$1 THEN tgt.component_code ELSE src.component_code END as related_code,
      CASE WHEN er.source_id=$1 THEN tgt.component_name ELSE src.component_name END as related_name,
      CASE WHEN er.source_id=$1 THEN tgt.id ELSE src.id END as related_id,
      CASE WHEN er.source_id=$1 THEN tgt.status ELSE src.status END as related_status,
      CASE WHEN er.source_id=$1 THEN tgt.component_type ELSE src.component_type END as related_type
    FROM entity_relationships er
    LEFT JOIN components src ON er.source_id::text=src.id::text
    LEFT JOIN components tgt ON er.target_id::text=tgt.id::text
    WHERE (er.source_id=$1 OR er.target_id=$1)
      AND er.source_type='component' AND er.target_type='component'
      AND er.edge_type='variant'
    ORDER BY er.created_at DESC`, [cid]);
    res.json({ items: result.rows });
});
router.post('/components/:id/variants', auth_1.authenticate, async (req, res) => {
    const { target_component_id } = req.body;
    if (!target_component_id)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'target_component_id required' } });
    const comp = await (0, db_1.query)('SELECT id FROM components WHERE id::text=$1 OR component_code=$1', [req.params.id]);
    if (!comp.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    const result = await (0, db_1.query)('INSERT INTO entity_relationships (source_id, source_type, target_id, target_type, edge_type) VALUES ($1,$2,$3,$4,$5) RETURNING *', [comp.rows[0].id, 'component', target_component_id, 'component', 'variant']);
    res.status(201).json(result.rows[0]);
});
// VENDOR OPTIONS
router.get('/vendor-options', auth_1.authenticate, async (req, res) => {
    let where = '', params = [];
    if (req.query.product_master_id) {
        params.push(req.query.product_master_id);
        where = `WHERE vo.product_master_id=$1`;
    }
    const result = await (0, db_1.query)(`SELECT vo.*, pm.product_code FROM vendor_options vo LEFT JOIN product_masters pm ON vo.product_master_id=pm.id ${where} ORDER BY vo.vendor_option_code`, params);
    res.json({ items: result.rows });
});
router.post('/vendor-options', auth_1.authenticate, async (req, res) => {
    const { vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status, lead_time_days, region_scope } = req.body;
    const result = await (0, db_1.query)('INSERT INTO vendor_options (vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status, lead_time_days, region_scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status || 'Approved', lead_time_days, region_scope]);
    res.status(201).json(result.rows[0]);
});
// PRODUCT USAGES
router.get('/product-usages', auth_1.authenticate, async (req, res) => {
    let where = '', params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        where = `WHERE pu.project_id=$1`;
    }
    const result = await (0, db_1.query)(`SELECT pu.*, pm.product_code, pm.product_name, p.project_code, ei.equipment_code FROM product_usages pu JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON pu.project_id=p.id LEFT JOIN equipment_instances ei ON pu.equipment_instance_id=ei.id ${where}`, params);
    res.json({ items: result.rows });
});
router.post('/product-usages', auth_1.authenticate, async (req, res) => {
    const { project_id, product_master_id, equipment_instance_id, usage_type } = req.body;
    const result = await (0, db_1.query)('INSERT INTO product_usages (project_id, product_master_id, equipment_instance_id, usage_type) VALUES ($1,$2,$3,$4) RETURNING *', [project_id, product_master_id, equipment_instance_id, usage_type || 'Standard']);
    res.status(201).json(result.rows[0]);
});
// COMPONENTS
router.get('/components', auth_1.authenticate, async (req, res) => {
    let conditions = [];
    let params = [];
    if (req.query.search) {
        params.push(`%${req.query.search}%`);
        const p = params.length;
        conditions.push(`(c.component_code ILIKE $${p} OR c.component_name ILIKE $${p} OR c.description ILIKE $${p} OR EXISTS (SELECT 1 FROM unnest(c.synonyms) s WHERE s ILIKE $${p}))`);
    }
    if (req.query.component_type) {
        params.push(req.query.component_type);
        conditions.push(`c.component_type=$${params.length}`);
    }
    if (req.query.status) {
        params.push(req.query.status);
        conditions.push(`c.status=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await (0, db_1.query)(`SELECT c.*, m.material_name FROM components c LEFT JOIN materials m ON c.primary_material_code=m.material_code ${where} ORDER BY c.component_code`, params);
    res.json({ items: result.rows });
});
router.get('/components/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT c.*, m.material_name FROM components c LEFT JOIN materials m ON c.primary_material_code=m.material_code WHERE c.id::text=$1 OR c.component_code=$1`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    const [usedIn, documents] = await Promise.all([
        (0, db_1.query)(`SELECT DISTINCT pm.id, pm.product_code, pm.product_name, pm.standard_status, bl.quantity, bl.unit
       FROM bom_lines bl JOIN standard_boms sb ON bl.standard_bom_id=sb.id JOIN product_masters pm ON sb.product_master_id=pm.id
       WHERE bl.component_id=$1 OR bl.component_reference_code=$2
       ORDER BY pm.product_code`, [result.rows[0].id, result.rows[0].component_code]),
        (0, db_1.query)(`SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM documents d LEFT JOIN users u ON d.created_by=u.id
       WHERE d.component_id=$1 ORDER BY d.document_type, d.document_code`, [result.rows[0].id]),
    ]);
    res.json({ ...result.rows[0], used_in: usedIn.rows, documents: documents.rows });
});
router.post('/components', auth_1.authenticate, async (req, res) => {
    try {
        const { component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, manufacturer, model } = req.body;
        if (!component_code || !component_name)
            return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'component_code and component_name required' } });
        const pmCode = primary_material_code || null;
        const wkg = (weight_kg === '' || weight_kg === null || weight_kg === undefined) ? null : parseFloat(String(weight_kg));
        const result = await (0, db_1.query)('INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, created_by, cost, manufacturer, model) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *', [component_code, component_name, component_type || 'Vessel', component_category || 'Mechanical', description || null, pmCode, standard_size || null, wkg, unit || 'EA', status || 'Active', notes || null, req.user.id, 0, manufacturer || null, model || null]);
        await (0, audit_1.logAudit)(req.user.id, 'component', result.rows[0].id, 'CREATE', {
            summary: `Component ${component_code} created`,
            component_code,
            component_name,
            component_type,
        });
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        console.error('[POST /components] error:', err?.message || err);
        if (err?.code === '23505')
            return res.status(409).json({ error: { code: 'DUPLICATE', message: `Component code already exists` } });
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: err?.message || 'Failed to create component' } });
    }
});
router.put('/components/:id', auth_1.authenticate, async (req, res) => {
    const { component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms, cost, sell_price, manufacturer, model } = req.body;
    const synonymsArr = Array.isArray(synonyms) ? synonyms.filter(Boolean) : [];
    const costVal = (cost === null || cost === undefined || cost === '') ? 0 : parseFloat(String(cost));
    const sellVal = (sell_price === null || sell_price === undefined || sell_price === '') ? null : parseFloat(String(sell_price));
    const result = await (0, db_1.query)('UPDATE components SET component_name=$1, component_type=$2, component_category=$3, description=$4, primary_material_code=$5, standard_size=$6, weight_kg=$7, unit=$8, status=$9, notes=$10, synonyms=$11, cost=$12, sell_price=$13, manufacturer=$14, model=$15, updated_at=NOW() WHERE id=$16 RETURNING *', [component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonymsArr, costVal, sellVal, manufacturer || null, model || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'component', String(req.params.id), 'UPDATE', {
        summary: 'Component details updated',
        component_name,
        component_type,
        status,
        manufacturer: manufacturer || null,
        model: model || null,
        cost: costVal,
        primary_material_code: primary_material_code || null,
    });
    res.json(result.rows[0]);
});
router.patch('/product-masters/:id/status', auth_1.authenticate, async (req, res) => {
    const { standard_status } = req.body;
    if (!standard_status)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'standard_status required' } });
    const result = await (0, db_1.query)('UPDATE product_masters SET standard_status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, standard_status', [standard_status, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'product', String(req.params.id), 'STATUS_CHANGE', {
        summary: `Status changed to ${standard_status}`,
        from: undefined,
        to: standard_status,
    });
    res.json(result.rows[0]);
});
router.patch('/components/:id/status', auth_1.authenticate, async (req, res) => {
    const { status } = req.body;
    if (!status)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'status required' } });
    const result = await (0, db_1.query)('UPDATE components SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, status', [status, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'component', String(req.params.id), 'STATUS_CHANGE', {
        summary: `Status changed to ${status}`,
        to: status,
    });
    res.json(result.rows[0]);
});
router.post('/components/:id/duplicate', auth_1.authenticate, async (req, res) => {
    const orig = await (0, db_1.query)('SELECT * FROM components WHERE id=$1', [req.params.id]);
    if (!orig.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    const src = orig.rows[0];
    let newCode = req.body.component_code ? req.body.component_code.trim().toUpperCase() : '';
    if (!newCode) {
        newCode = `${src.component_code}-COPY`;
        let suffix = 1;
        while (true) {
            const exists = await (0, db_1.query)('SELECT id FROM components WHERE component_code=$1', [newCode]);
            if (!exists.rows[0])
                break;
            suffix++;
            newCode = `${src.component_code}-COPY-${suffix}`;
        }
    }
    else {
        const exists = await (0, db_1.query)('SELECT id FROM components WHERE component_code=$1', [newCode]);
        if (exists.rows[0])
            return res.status(409).json({ error: { code: 'CONFLICT', message: `Component code ${newCode} already exists` } });
    }
    const newName = req.body.component_name ? req.body.component_name.trim() : `Copy of ${src.component_name}`;
    const newType = req.body.component_type || src.component_type;
    const newCategory = req.body.component_category || src.component_category;
    const newStatus = req.body.status || src.status;
    const result = await (0, db_1.query)(`INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms, created_by, manufacturer, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [newCode, newName, newType, newCategory, src.description, src.primary_material_code, src.standard_size, src.weight_kg, src.unit, newStatus, src.notes, src.synonyms || [], req.user.id, src.manufacturer || null, src.model || null]);
    res.status(201).json(result.rows[0]);
});
router.delete('/components/:id', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    const inUse = await (0, db_1.query)(`SELECT 1 FROM bom_lines WHERE component_id=$1 LIMIT 1`, [id]);
    if (inUse.rows.length > 0) {
        return res.status(409).json({ error: { code: 'IN_USE', message: 'Cannot delete — component is linked to BOM lines. Remove those links first.' } });
    }
    await (0, db_1.query)('DELETE FROM documents WHERE component_id=$1', [id]);
    await (0, db_1.query)('DELETE FROM entity_relationships WHERE source_id=$1 OR target_id=$1', [id]);
    const result = await (0, db_1.query)('DELETE FROM components WHERE id::text=$1 RETURNING id, component_code', [id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Component not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'component', String(id), 'DELETE', {
        summary: `Component ${result.rows[0].component_code} deleted`,
        component_code: result.rows[0].component_code,
    });
    res.json({ deleted: true });
});
// FAMILY CLASSIFIERS
router.get('/product-families/:id/classifiers', auth_1.authenticate, async (req, res) => {
    const fam = await (0, db_1.query)('SELECT id FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
    if (!fam.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
    const result = await (0, db_1.query)('SELECT * FROM family_classifiers WHERE family_id=$1 ORDER BY sort_order, created_at', [fam.rows[0].id]);
    res.json({ items: result.rows });
});
router.post('/product-families/:id/classifiers', auth_1.authenticate, async (req, res) => {
    const fam = await (0, db_1.query)('SELECT id FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
    if (!fam.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
    const { label, unit, field_type, sort_order } = req.body;
    const result = await (0, db_1.query)('INSERT INTO family_classifiers (family_id, label, unit, field_type, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *', [fam.rows[0].id, label, unit || null, field_type || 'text', sort_order ?? 0]);
    res.status(201).json(result.rows[0]);
});
router.put('/family-classifiers/:id', auth_1.authenticate, async (req, res) => {
    const { label, unit, field_type, sort_order } = req.body;
    const result = await (0, db_1.query)('UPDATE family_classifiers SET label=$1, unit=$2, field_type=$3, sort_order=$4 WHERE id::text=$5 RETURNING *', [label, unit || null, field_type || 'text', sort_order ?? 0, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classifier not found' } });
    res.json(result.rows[0]);
});
router.delete('/family-classifiers/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('DELETE FROM family_classifiers WHERE id::text=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classifier not found' } });
    res.json({ deleted: true });
});
// PRODUCT SPEC TABLES (dimensions, electrical, hydraulic, pneumatic)
const resolveProductId = async (param) => {
    const r = await (0, db_1.query)('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [param]);
    return r.rows[0]?.id ?? null;
};
const nullableHydraulicValue = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;
const nullableDimensionValue = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;
router.get('/product-masters/:id/dimensions', auth_1.authenticate, async (req, res) => {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const r = await (0, db_1.query)('SELECT * FROM product_dimensions WHERE product_master_id=$1', [pid]);
    res.json(r.rows[0] || {});
});
router.put('/product-masters/:id/dimensions', auth_1.authenticate, async (req, res) => {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const body = req.body || {};
    const existing = await (0, db_1.query)('SELECT length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes FROM product_dimensions WHERE product_master_id=$1', [pid]);
    const current = existing.rows[0] || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const rawDiameter = body.diameter_mm;
    const diameterBlank = rawDiameter === null || rawDiameter === undefined || (typeof rawDiameter === 'string' && rawDiameter.trim() === '');
    if (!diameterBlank && (typeof rawDiameter !== 'number' && typeof rawDiameter !== 'string' || !Number.isFinite(Number(rawDiameter)) || Number(rawDiameter) < 0)) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'diameter_mm must be a finite, non-negative measurement' } });
    }
    const rawSandMediaPerFilter = body.sand_media_per_filter_kg;
    const sandMediaPerFilterBlank = rawSandMediaPerFilter === null || rawSandMediaPerFilter === undefined || (typeof rawSandMediaPerFilter === 'string' && rawSandMediaPerFilter.trim() === '');
    if (!sandMediaPerFilterBlank && (typeof rawSandMediaPerFilter !== 'number' && typeof rawSandMediaPerFilter !== 'string' || !Number.isFinite(Number(rawSandMediaPerFilter)) || Number(rawSandMediaPerFilter) < 0)) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'sand_media_per_filter_kg must be a finite, non-negative measurement' } });
    }
    const diameter_mm = has('diameter_mm') ? (diameterBlank ? null : Number(rawDiameter)) : (current.diameter_mm ?? null);
    const sand_media_per_filter_kg = has('sand_media_per_filter_kg')
        ? (sandMediaPerFilterBlank ? null : Number(rawSandMediaPerFilter))
        : (current.sand_media_per_filter_kg ?? null);
    const length_mm = has('length_mm') ? nullableDimensionValue(body.length_mm) : (current.length_mm ?? null);
    const width_mm = has('width_mm') ? nullableDimensionValue(body.width_mm) : (current.width_mm ?? null);
    const height_mm = has('height_mm') ? nullableDimensionValue(body.height_mm) : (current.height_mm ?? null);
    const weight_kg = has('weight_kg') ? nullableDimensionValue(body.weight_kg) : (current.weight_kg ?? null);
    const inlet_dn_mm = has('inlet_dn_mm') ? nullableDimensionValue(body.inlet_dn_mm) : (current.inlet_dn_mm ?? null);
    const outlet_dn_mm = has('outlet_dn_mm') ? nullableDimensionValue(body.outlet_dn_mm) : (current.outlet_dn_mm ?? null);
    const notes = has('notes') ? nullableDimensionValue(body.notes) : (current.notes ?? null);
    const r = await (0, db_1.query)(`
    INSERT INTO product_dimensions (product_master_id, length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
    ON CONFLICT (product_master_id) DO UPDATE SET
      length_mm=$2, width_mm=$3, height_mm=$4, diameter_mm=$5, sand_media_per_filter_kg=$6, weight_kg=$7, inlet_dn_mm=$8, outlet_dn_mm=$9, notes=$10, updated_at=NOW()
    RETURNING *`, [pid, length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes]);
    res.json(r.rows[0]);
});
router.get('/product-masters/:id/electrical', auth_1.authenticate, async (req, res) => {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const r = await (0, db_1.query)('SELECT * FROM product_electrical WHERE product_master_id=$1', [pid]);
    res.json(r.rows[0] || {});
});
router.put('/product-masters/:id/electrical', auth_1.authenticate, async (req, res) => {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const { rated_power_kw, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes } = req.body;
    const r = await (0, db_1.query)(`
    INSERT INTO product_electrical (product_master_id, rated_power_kw, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (product_master_id) DO UPDATE SET
      rated_power_kw=$2, voltage_v=$3, phases=$4, frequency_hz=$5, full_load_current_a=$6, rated_speed_rpm=$7, motor_type=$8, insulation_class=$9, protection_class=$10, efficiency_class=$11, notes=$12, updated_at=NOW()
    RETURNING *`, [pid, rated_power_kw || null, voltage_v || null, phases || null, frequency_hz || null, full_load_current_a || null, rated_speed_rpm || null, motor_type || null, insulation_class || null, protection_class || null, efficiency_class || null, notes || null]);
    res.json(r.rows[0]);
});
const PNEUMATIC_UNIT_ALIASES = {
    gas_flow: { 'm3/h': 'm3/h', 'm³/h': 'm3/h', scfm: 'SCFM' },
    temperature: { c: '°C', '°c': '°C', f: '°F', '°f': '°F' },
    port: { dn: 'DN', mm: 'mm', in: 'in', inch: 'in' },
};
const isBlankPneumaticValue = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const readPneumaticPair = (body, current, valueKey, unitKey, unitKind, label, allowNegative) => {
    const hasValue = Object.prototype.hasOwnProperty.call(body, valueKey);
    const hasUnit = Object.prototype.hasOwnProperty.call(body, unitKey);
    const rawValue = hasValue ? body[valueKey] : current[valueKey];
    const rawUnit = hasUnit ? body[unitKey] : current[unitKey];
    if (isBlankPneumaticValue(rawValue)) {
        if (hasUnit && !isBlankPneumaticValue(rawUnit)) {
            const error = new Error(`${label} unit cannot be set without a value`);
            error.status = 400;
            error.code = 'INVALID_PNEUMATIC_SPEC';
            throw error;
        }
        return { value: null, unit: null };
    }
    const numericValue = typeof rawValue === 'number' || typeof rawValue === 'string'
        ? Number(rawValue)
        : Number.NaN;
    if (!Number.isFinite(numericValue) || (!allowNegative && numericValue < 0)) {
        const error = new Error(`${label} must be a finite, ${allowNegative ? '' : 'non-negative '}number`);
        error.status = 400;
        error.code = 'INVALID_PNEUMATIC_SPEC';
        throw error;
    }
    const normalizedUnit = PNEUMATIC_UNIT_ALIASES[unitKind][String(rawUnit ?? '').trim().toLowerCase()];
    if (!normalizedUnit) {
        const error = new Error(`${label} must use a supported unit`);
        error.status = 400;
        error.code = 'INVALID_PNEUMATIC_SPEC';
        throw error;
    }
    return { value: numericValue, unit: normalizedUnit };
};
router.get('/product-masters/:id/pneumatic', auth_1.authenticate, async (req, res, next) => {
    try {
        const pid = await resolveProductId(String(req.params.id));
        if (!pid)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        const productResult = await (0, db_1.query)('SELECT product_category FROM product_masters WHERE id=$1', [pid]);
        if (String(productResult.rows[0]?.product_category || '').toLowerCase() !== 'pneumatic') {
            return res.status(400).json({
                error: { code: 'INVALID_PRODUCT_CATEGORY', message: 'Pneumatic specifications are only available for products in the Pneumatic category' },
            });
        }
        const r = await (0, db_1.query)('SELECT * FROM product_pneumatic WHERE product_master_id=$1', [pid]);
        res.json(r.rows[0] || {});
    }
    catch (error) {
        next(error);
    }
});
router.put('/product-masters/:id/pneumatic', auth_1.authenticate, (0, auth_1.requireModuleManage)('pim'), async (req, res, next) => {
    try {
        const pid = await resolveProductId(String(req.params.id));
        if (!pid)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        const body = req.body || {};
        const saved = await withProductTransaction(async (client) => {
            const productResult = await client.query('SELECT product_category FROM product_masters WHERE id=$1 FOR UPDATE', [pid]);
            if (!productResult.rows[0]) {
                const error = new Error('Product not found');
                error.status = 404;
                error.code = 'NOT_FOUND';
                throw error;
            }
            if (String(productResult.rows[0].product_category || '').toLowerCase() !== 'pneumatic') {
                const error = new Error('Pneumatic specifications are only available for products in the Pneumatic category');
                error.status = 400;
                error.code = 'INVALID_PRODUCT_CATEGORY';
                throw error;
            }
            const existingResult = await client.query('SELECT * FROM product_pneumatic WHERE product_master_id=$1 FOR UPDATE', [pid]);
            const current = existingResult.rows[0] || {};
            const gasFlow = readPneumaticPair(body, current, 'gas_flow_value', 'gas_flow_unit', 'gas_flow', 'Gas flow', false);
            const operatingTemperature = readPneumaticPair(body, current, 'operating_temperature_value', 'operating_temperature_unit', 'temperature', 'Operating temperature', true);
            const dewPoint = readPneumaticPair(body, current, 'dew_point_value', 'dew_point_unit', 'temperature', 'Dew point', true);
            const inletPort = readPneumaticPair(body, current, 'inlet_port_value', 'inlet_port_unit', 'port', 'Inlet port', false);
            const outletPort = readPneumaticPair(body, current, 'outlet_port_value', 'outlet_port_unit', 'port', 'Outlet port', false);
            const r = await client.query(`INSERT INTO product_pneumatic
           (product_master_id, gas_flow_value, gas_flow_unit, operating_temperature_value, operating_temperature_unit,
            dew_point_value, dew_point_unit, inlet_port_value, inlet_port_unit, outlet_port_value, outlet_port_unit, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (product_master_id) DO UPDATE SET
           gas_flow_value=$2, gas_flow_unit=$3, operating_temperature_value=$4, operating_temperature_unit=$5,
           dew_point_value=$6, dew_point_unit=$7, inlet_port_value=$8, inlet_port_unit=$9,
           outlet_port_value=$10, outlet_port_unit=$11, updated_at=NOW()
         RETURNING *`, [pid, gasFlow.value, gasFlow.unit, operatingTemperature.value, operatingTemperature.unit,
                dewPoint.value, dewPoint.unit, inletPort.value, inletPort.unit, outletPort.value, outletPort.unit]);
            if (!r.rows[0]) {
                const error = new Error('The server did not return the saved pneumatic specifications');
                error.status = 500;
                error.code = 'PNEUMATIC_SAVE_FAILED';
                throw error;
            }
            await insertAuditTx(client, req.user.id, 'product', pid, 'PNEUMATIC_SPECIFICATION_UPDATE', {
                summary: 'Pneumatic specifications updated',
                before: current,
                after: r.rows[0],
            });
            return r.rows[0];
        });
        res.json(saved);
    }
    catch (error) {
        next(error);
    }
});
router.get('/product-masters/:id/hydraulic', auth_1.authenticate, async (req, res) => {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const r = await (0, db_1.query)(`SELECT ph.*, pm.id AS product_master_id,
       COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
       CASE
         WHEN pm.design_flow_m3h IS NOT NULL AND ph.design_flow_m3h IS NOT NULL
              AND pm.design_flow_m3h IS DISTINCT FROM ph.design_flow_m3h THEN 'conflict'
         WHEN pm.design_flow_m3h IS NULL AND ph.design_flow_m3h IS NULL THEN 'empty'
         ELSE 'synchronized'
       END AS design_flow_sync_status,
       pm.design_flow_m3h AS product_design_flow_m3h,
       ph.design_flow_m3h AS hydraulic_design_flow_m3h
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     WHERE pm.id=$1`, [pid]);
    res.json(r.rows[0] || {});
});
router.put('/product-masters/:id/hydraulic', auth_1.authenticate, async (req, res, next) => {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const body = req.body || {};
    const { design_flow_m3h, venturi_flow_m3h, friction_loss_mh2o } = body;
    const venturiFlow = venturi_flow_m3h === null || venturi_flow_m3h === undefined ||
        (typeof venturi_flow_m3h === 'string' && venturi_flow_m3h.trim() === '')
        ? null
        : (typeof venturi_flow_m3h === 'number' || typeof venturi_flow_m3h === 'string')
            ? Number(venturi_flow_m3h)
            : Number.NaN;
    if (venturiFlow !== null && (!Number.isFinite(venturiFlow) || venturiFlow < 0)) {
        return res.status(400).json({
            error: { code: 'INVALID_VENTURI_FLOW', message: 'Venturi flow must be a finite, non-negative value in m³/h' },
        });
    }
    const frictionLoss = friction_loss_mh2o === null || friction_loss_mh2o === undefined ||
        (typeof friction_loss_mh2o === 'string' && friction_loss_mh2o.trim() === '')
        ? null
        : (typeof friction_loss_mh2o === 'number' || typeof friction_loss_mh2o === 'string')
            ? Number(friction_loss_mh2o)
            : Number.NaN;
    if (frictionLoss !== null && (!Number.isFinite(frictionLoss) || frictionLoss < 0)) {
        return res.status(400).json({
            error: { code: 'INVALID_FRICTION_LOSS', message: 'Friction loss must be a finite, non-negative value in mH₂O' },
        });
    }
    const fields = ['min_flow_m3h', 'max_flow_m3h', 'friction_loss_mh2o', 'design_head_m', 'design_pressure_bar', 'max_pressure_bar', 'npsh_required_m', 'fluid_type', 'min_temperature_c', 'max_temperature_c', 'notes'];
    let previousProductFlow;
    let previousHydraulicFlow;
    let linkedDesignFlow;
    let saved;
    try {
        saved = await withProductTransaction(async (client) => {
            const currentProduct = await client.query('SELECT design_flow_m3h FROM product_masters WHERE id=$1 FOR UPDATE', [pid]);
            const currentHydraulic = await client.query('SELECT * FROM product_hydraulic WHERE product_master_id=$1 FOR UPDATE', [pid]);
            const existing = currentHydraulic.rows[0] || {};
            previousProductFlow = currentProduct.rows[0]?.design_flow_m3h;
            previousHydraulicFlow = existing.design_flow_m3h;
            if (flowsConflict(previousProductFlow, previousHydraulicFlow) && body.design_flow_conflict_resolution !== 'hydraulic') {
                const error = new Error('Conflicting populated design flows require an explicit hydraulic resolution');
                error.status = 409;
                error.code = 'DESIGN_FLOW_CONFLICT';
                throw error;
            }
            linkedDesignFlow = flowsConflict(previousProductFlow, previousHydraulicFlow)
                ? Number(previousHydraulicFlow)
                : Object.prototype.hasOwnProperty.call(body, 'design_flow_m3h')
                    ? normalizeDesignFlow(design_flow_m3h)
                    : previousHydraulicFlow != null
                        ? Number(previousHydraulicFlow)
                        : previousProductFlow != null
                            ? Number(previousProductFlow)
                            : null;
            const merged = Object.fromEntries(fields.map(field => [
                field,
                Object.prototype.hasOwnProperty.call(body, field)
                    ? field === 'friction_loss_mh2o' ? frictionLoss : nullableHydraulicValue(body[field])
                    : existing[field] ?? null,
            ]));
            const mergedVenturi = Object.prototype.hasOwnProperty.call(body, 'venturi_flow_m3h')
                ? venturiFlow
                : existing.venturi_flow_m3h ?? null;
            const r = await client.query(`
        INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, min_flow_m3h, max_flow_m3h, venturi_flow_m3h, friction_loss_mh2o, design_head_m, design_pressure_bar, max_pressure_bar, npsh_required_m, fluid_type, min_temperature_c, max_temperature_c, notes, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (product_master_id) DO UPDATE SET
          design_flow_m3h=$2, min_flow_m3h=$3, max_flow_m3h=$4, venturi_flow_m3h=$5, friction_loss_mh2o=$6, design_head_m=$7, design_pressure_bar=$8, max_pressure_bar=$9, npsh_required_m=$10, fluid_type=$11, min_temperature_c=$12, max_temperature_c=$13, notes=$14, updated_at=NOW()
        RETURNING *`, [pid, linkedDesignFlow, merged.min_flow_m3h, merged.max_flow_m3h, mergedVenturi, merged.friction_loss_mh2o, merged.design_head_m, merged.design_pressure_bar, merged.max_pressure_bar, merged.npsh_required_m, merged.fluid_type, merged.min_temperature_c, merged.max_temperature_c, merged.notes]);
            await client.query('UPDATE product_masters SET design_flow_m3h=$2, updated_at=NOW() WHERE id=$1', [pid, linkedDesignFlow]);
            if (flowsConflict(previousProductFlow, previousHydraulicFlow)) {
                await client.query(`UPDATE product_design_flow_reconciliations
           SET status='resolved', resolution='hydraulic', resolved_value_m3h=$2,
               resolved_by=$3, resolved_at=NOW()
           WHERE product_master_id=$1 AND status='unresolved'`, [pid, linkedDesignFlow, req.user.id]);
            }
            if (Object.prototype.hasOwnProperty.call(body, 'design_flow_m3h') || previousProductFlow !== previousHydraulicFlow) {
                await insertAuditTx(client, req.user.id, 'product', pid, 'LINKED_DESIGN_FLOW_UPDATE', designFlowAuditDetails('hydraulic_card', linkedDesignFlow, previousProductFlow, previousHydraulicFlow));
            }
            return { ...r.rows[0], design_flow_m3h: linkedDesignFlow, design_flow_sync_status: linkedDesignFlow == null ? 'empty' : 'synchronized' };
        });
    }
    catch (error) {
        return next(error);
    }
    await (0, audit_1.logAudit)(req.user.id, 'product', pid, 'UPDATE', {
        summary: 'Product hydraulic data updated',
        venturi_flow_m3h: venturiFlow,
        friction_loss_mh2o: frictionLoss,
    });
    res.json(saved);
});
router.post('/product-masters/design-flow/reconcile', auth_1.authenticate, async (req, res, next) => {
    const requestedProduct = req.body?.product_id || req.body?.product_code || null;
    const resolution = req.body?.resolution;
    if (resolution != null && !['hydraulic', 'product_master'].includes(resolution)) {
        return res.status(400).json({ error: { code: 'INVALID_RESOLUTION', message: 'resolution must be hydraulic or product_master' } });
    }
    try {
        const outcome = await withProductTransaction(async (client) => {
            const params = requestedProduct ? [requestedProduct] : [];
            const result = await client.query(`SELECT pm.id, pm.product_code, pm.design_flow_m3h AS product_design_flow_m3h,
                ph.design_flow_m3h AS hydraulic_design_flow_m3h
         FROM product_masters pm
         LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
         ${requestedProduct ? 'WHERE pm.id::text=$1 OR pm.product_code=$1' : ''}
         ORDER BY pm.product_code
         FOR UPDATE OF pm`, params);
            const conflicts = [];
            const reconciled = [];
            for (const row of result.rows) {
                const conflict = flowsConflict(row.product_design_flow_m3h, row.hydraulic_design_flow_m3h);
                if (conflict && !resolution) {
                    await client.query(`INSERT INTO product_design_flow_reconciliations
               (product_master_id, product_flow_m3h, hydraulic_flow_m3h, status)
             SELECT $1,$2,$3,'unresolved'
             WHERE NOT EXISTS (
               SELECT 1 FROM product_design_flow_reconciliations
               WHERE product_master_id=$1 AND status='unresolved'
             )`, [row.id, row.product_design_flow_m3h, row.hydraulic_design_flow_m3h]);
                    conflicts.push(row);
                    continue;
                }
                const value = conflict
                    ? Number(resolution === 'hydraulic' ? row.hydraulic_design_flow_m3h : row.product_design_flow_m3h)
                    : row.hydraulic_design_flow_m3h != null
                        ? Number(row.hydraulic_design_flow_m3h)
                        : row.product_design_flow_m3h != null
                            ? Number(row.product_design_flow_m3h)
                            : null;
                await client.query('UPDATE product_masters SET design_flow_m3h=$2, updated_at=NOW() WHERE id=$1', [row.id, value]);
                await client.query(`INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, updated_at)
           VALUES ($1,$2,NOW())
           ON CONFLICT (product_master_id) DO UPDATE SET design_flow_m3h=EXCLUDED.design_flow_m3h, updated_at=NOW()`, [row.id, value]);
                if (conflict) {
                    await client.query(`UPDATE product_design_flow_reconciliations
             SET status='resolved', resolution=$2, resolved_value_m3h=$3,
                 resolved_by=$4, resolved_at=NOW()
             WHERE product_master_id=$1 AND status='unresolved'`, [row.id, resolution, value, req.user.id]);
                }
                await insertAuditTx(client, req.user.id, 'product', row.id, 'LINKED_DESIGN_FLOW_UPDATE', designFlowAuditDetails('reconciliation', value, row.product_design_flow_m3h, row.hydraulic_design_flow_m3h));
                reconciled.push({ product_id: row.id, product_code: row.product_code, design_flow_m3h: value, resolution: conflict ? resolution : 'backfill' });
            }
            return { reconciled, conflicts };
        });
        if (outcome.conflicts.length) {
            return res.status(409).json({
                error: {
                    code: 'DESIGN_FLOW_CONFLICT',
                    message: 'Conflicting populated design flows require an explicit hydraulic or product_master resolution',
                },
                reconciled: outcome.reconciled,
                conflicts: outcome.conflicts,
            });
        }
        res.json({ reconciled: outcome.reconciled, conflicts: [] });
    }
    catch (error) {
        next(error);
    }
});
// PRODUCT CLASSIFIER VALUES
router.get('/product-masters/:id/classifier-values', auth_1.authenticate, async (req, res) => {
    const pm = await (0, db_1.query)('SELECT id, product_family_id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
    if (!pm.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const { id, product_family_id } = pm.rows[0];
    if (!product_family_id)
        return res.json({ classifiers: [], values: {} });
    const classifiers = await (0, db_1.query)('SELECT * FROM family_classifiers WHERE family_id=$1 ORDER BY sort_order, created_at', [product_family_id]);
    const values = await (0, db_1.query)('SELECT classifier_id, value_text FROM product_classifier_values WHERE product_id=$1', [id]);
    const valueMap = {};
    for (const v of values.rows)
        valueMap[v.classifier_id] = v.value_text;
    res.json({ classifiers: classifiers.rows, values: valueMap });
});
router.put('/product-masters/:id/classifier-values', auth_1.authenticate, async (req, res) => {
    const pm = await (0, db_1.query)('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
    if (!pm.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const productId = pm.rows[0].id;
    const { values } = req.body;
    for (const [classifierId, valueText] of Object.entries(values)) {
        if (valueText === null || valueText === undefined || valueText === '') {
            await (0, db_1.query)('DELETE FROM product_classifier_values WHERE product_id=$1 AND classifier_id=$2', [productId, classifierId]);
        }
        else {
            await (0, db_1.query)('INSERT INTO product_classifier_values (product_id, classifier_id, value_text) VALUES ($1,$2,$3) ON CONFLICT (product_id, classifier_id) DO UPDATE SET value_text=$3', [productId, classifierId, valueText]);
        }
    }
    res.json({ updated: true });
});
// PRODUCT IMAGE UPLOAD
router.post('/product-masters/:id/image', auth_1.authenticate, uploadImage.single('image'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: { code: 'NO_FILE', message: 'No image file provided' } });
    const imageUrl = `/uploads/${req.file.filename}`;
    const result = await (0, db_1.query)('UPDATE product_masters SET image_url=$1, updated_at=NOW() WHERE id::text=$2 OR product_code=$2 RETURNING id, image_url', [imageUrl, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    res.json({ image_url: imageUrl });
});
exports.default = router;
