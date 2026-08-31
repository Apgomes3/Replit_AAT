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
exports.uvEngineeringConsumerRoutes = void 0;
const express_1 = require("express");
const db_1 = __importStar(require("../db"));
const audit_1 = require("../db/audit");
const auth_1 = require("../middleware/auth");
const adminRouter = (0, express_1.Router)();
const consumerRouter = (0, express_1.Router)();
exports.uvEngineeringConsumerRoutes = consumerRouter;
const STATUSES = ['Draft', 'In Review', 'Approved', 'Retired', 'Disabled'];
const EDITABLE_FIELDS = [
    'lamp_count', 'lamp_power_w', 'effective_reactor_volume_l', 'irradiance_85t_mw_cm2',
    'irradiance_95t_mw_cm2', 'compatibility', 'arrangement', 'source_evidence',
    'approved_per_lamp_flow_exception_m3h', 'notes',
];
function complete(row) {
    return Number.isInteger(Number(row.lamp_count)) && Number(row.lamp_count) > 0
        && row.lamp_power_w != null && Number(row.lamp_power_w) > 0
        && row.effective_reactor_volume_l != null && Number(row.effective_reactor_volume_l) > 0
        && row.irradiance_85t_mw_cm2 != null && Number(row.irradiance_85t_mw_cm2) > 0
        && row.irradiance_95t_mw_cm2 != null && Number(row.irradiance_95t_mw_cm2) > 0
        && !!String(row.compatibility || '').trim() && !!String(row.arrangement || '').trim()
        && !!String(row.source_evidence || '').trim();
}
function engineeringPayloadError(payload, fields = EDITABLE_FIELDS) {
    const numericFields = ['lamp_count', 'lamp_power_w', 'effective_reactor_volume_l',
        'irradiance_85t_mw_cm2', 'irradiance_95t_mw_cm2', 'approved_per_lamp_flow_exception_m3h'];
    for (const field of numericFields) {
        if (!fields.includes(field) || payload[field] === '' || payload[field] == null)
            continue;
        const value = Number(payload[field]);
        if (!Number.isFinite(value) || value <= 0 || (field === 'lamp_count' && !Number.isInteger(value))) {
            return `${field} must be a finite ${field === 'lamp_count' ? 'positive integer' : 'number greater than zero'}.`;
        }
    }
    return null;
}
const catalogSelect = `SELECT c.*, pm.product_code, pm.product_name, pm.manufacturer, pm.status AS pim_status,
  pm.product_category, pm.primary_material_code, pm.configuration, pm.control_type, pm.power_kw AS rated_power_kw,
  pf.product_family_code, pf.product_family_name,
  row_to_json(latest) AS latest_revision,
  CASE WHEN c.needs_review THEN 'Needs Review' ELSE 'Current' END AS sync_status,
  CASE WHEN c.needs_review THEN false
       WHEN pm.status <> 'Active' OR pf.product_family_code <> 'PFM-UV' THEN false
       WHEN latest.status <> 'Approved' THEN false
       WHEN latest.lamp_count IS NULL OR latest.lamp_count <= 0
         OR latest.lamp_power_w IS NULL OR latest.lamp_power_w <= 0
         OR latest.effective_reactor_volume_l IS NULL OR latest.effective_reactor_volume_l <= 0
         OR latest.irradiance_85t_mw_cm2 IS NULL OR latest.irradiance_85t_mw_cm2 <= 0
         OR latest.irradiance_95t_mw_cm2 IS NULL OR latest.irradiance_95t_mw_cm2 <= 0
         OR NULLIF(BTRIM(latest.compatibility),'') IS NULL
         OR NULLIF(BTRIM(latest.arrangement),'') IS NULL
         OR NULLIF(BTRIM(latest.source_evidence),'') IS NULL THEN false
       ELSE true END AS calculation_enabled,
  CASE WHEN c.needs_review THEN COALESCE(c.review_reason, 'PIM identity requires review')
       WHEN pm.status <> 'Active' THEN 'PIM product is inactive'
       WHEN pf.product_family_code <> 'PFM-UV' THEN 'Product is no longer in PFM-UV'
       WHEN latest.id IS NULL THEN 'Engineering revision required'
       WHEN latest.status <> 'Approved' THEN 'Engineering revision is not approved'
       WHEN latest.lamp_count IS NULL OR latest.lamp_count <= 0
         OR latest.lamp_power_w IS NULL OR latest.lamp_power_w <= 0
         OR latest.effective_reactor_volume_l IS NULL OR latest.effective_reactor_volume_l <= 0
         OR latest.irradiance_85t_mw_cm2 IS NULL OR latest.irradiance_85t_mw_cm2 <= 0
         OR latest.irradiance_95t_mw_cm2 IS NULL OR latest.irradiance_95t_mw_cm2 <= 0
         OR NULLIF(BTRIM(latest.compatibility),'') IS NULL
         OR NULLIF(BTRIM(latest.arrangement),'') IS NULL
         OR NULLIF(BTRIM(latest.source_evidence),'') IS NULL THEN 'Required engineering data is incomplete'
       ELSE 'Ready for calculations' END AS completeness_message
 FROM uv_engineering_catalogs c
 JOIN product_masters pm ON pm.id=c.product_master_id
 JOIN product_families pf ON pf.id=pm.product_family_id
 LEFT JOIN LATERAL (
   SELECT r.*
   FROM uv_engineering_revisions r
   WHERE r.catalog_id=c.id
   ORDER BY r.revision_number DESC
   LIMIT 1
 ) latest ON true`;
adminRouter.use(auth_1.authenticate, (0, auth_1.requireModuleManage)('pim'), (0, auth_1.requireRole)('admin'));
adminRouter.get('/', async (req, res) => {
    const result = await (0, db_1.query)(`${catalogSelect} ORDER BY pm.product_code`);
    res.json({ items: result.rows });
});
adminRouter.get('/:id', async (req, res) => {
    const catalog = await (0, db_1.query)(`${catalogSelect} WHERE c.id::text=$1 OR pm.id::text=$1 OR pm.product_code=$1`, [req.params.id]);
    if (!catalog.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'UV engineering catalog not found' } });
    const revisions = await (0, db_1.query)('SELECT * FROM uv_engineering_revisions WHERE catalog_id=$1 ORDER BY revision_number DESC', [catalog.rows[0].id]);
    res.json({ ...catalog.rows[0], revisions: revisions.rows });
});
adminRouter.post('/reconcile', async (req, res) => {
    const catalogs = await (0, db_1.query)(`INSERT INTO uv_engineering_catalogs (product_master_id, pim_snapshot)
    SELECT pm.id, jsonb_build_object('product_code',pm.product_code,'product_name',pm.product_name,'manufacturer',pm.manufacturer,
      'status',pm.status,'category',pm.product_category,'material',pm.primary_material_code,'configuration',pm.configuration,
      'control_type',pm.control_type,'rated_power_kw',pm.power_kw)
    FROM product_masters pm JOIN product_families pf ON pf.id=pm.product_family_id WHERE pf.product_family_code='PFM-UV'
    ON CONFLICT (product_master_id) DO NOTHING RETURNING id`);
    const revisions = await (0, db_1.query)(`INSERT INTO uv_engineering_revisions (catalog_id, revision_number, status)
    SELECT c.id, 1, 'Draft' FROM uv_engineering_catalogs c
    WHERE NOT EXISTS (SELECT 1 FROM uv_engineering_revisions r WHERE r.catalog_id=c.id) RETURNING id`);
    await (0, audit_1.logAudit)(req.user.id, 'uv_engineering', 'reconcile', 'RECONCILE', {
        summary: 'UV engineering catalogs reconciled', catalogs_created: catalogs.rows.length, drafts_created: revisions.rows.length,
    });
    res.json({ catalogs_created: catalogs.rows.length, drafts_created: revisions.rows.length });
});
adminRouter.post('/', async (req, res) => {
    const product = await (0, db_1.query)(`SELECT pm.* FROM product_masters pm JOIN product_families pf ON pf.id=pm.product_family_id
    WHERE (pm.id::text=$1 OR pm.product_code=$1) AND pf.product_family_code='PFM-UV'`, [req.body.product_id || req.body.product_code]);
    if (!product.rows[0])
        return res.status(400).json({ error: { code: 'INVALID_PRODUCT', message: 'A PFM-UV product is required.' } });
    await (0, db_1.query)(`INSERT INTO uv_engineering_catalogs (product_master_id, pim_snapshot)
    VALUES ($1, jsonb_build_object('product_code',$2,'product_name',$3,'manufacturer',$4,'status',$5,'category',$6,'material',$7,
      'configuration',$8,'control_type',$9,'rated_power_kw',$10)) ON CONFLICT (product_master_id) DO NOTHING`, [product.rows[0].id, product.rows[0].product_code, product.rows[0].product_name, product.rows[0].manufacturer, product.rows[0].status,
        product.rows[0].product_category, product.rows[0].primary_material_code, product.rows[0].configuration, product.rows[0].control_type, product.rows[0].power_kw]);
    const catalog = await (0, db_1.query)('SELECT * FROM uv_engineering_catalogs WHERE product_master_id=$1', [product.rows[0].id]);
    await (0, db_1.query)(`INSERT INTO uv_engineering_revisions (catalog_id, revision_number, status)
    SELECT $1, 1, 'Draft' WHERE NOT EXISTS (SELECT 1 FROM uv_engineering_revisions WHERE catalog_id=$1)`, [catalog.rows[0].id]);
    res.status(201).json(catalog.rows[0]);
});
adminRouter.post('/:id/revisions', async (req, res) => {
    const payloadError = engineeringPayloadError(req.body);
    if (payloadError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: payloadError } });
    const client = await db_1.default.connect();
    let created;
    try {
        await client.query('BEGIN');
        const catalog = await client.query('SELECT id FROM uv_engineering_catalogs WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!catalog.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'UV engineering catalog not found' } });
        }
        const latest = await client.query('SELECT * FROM uv_engineering_revisions WHERE catalog_id=$1 ORDER BY revision_number DESC LIMIT 1', [req.params.id]);
        let source = latest.rows[0] || null;
        if (req.body.source_revision_id) {
            const requestedSource = await client.query('SELECT * FROM uv_engineering_revisions WHERE id=$1', [req.body.source_revision_id]);
            if (!requestedSource.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: { code: 'INVALID_SOURCE_REVISION', message: 'The source UV engineering revision does not exist.' } });
            }
            if (requestedSource.rows[0].catalog_id !== req.params.id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: { code: 'INVALID_SOURCE_REVISION', message: 'The source revision belongs to a different UV product.' } });
            }
            if (latest.rows[0] && requestedSource.rows[0].id !== latest.rows[0].id) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: { code: 'STALE_SOURCE_REVISION', message: 'A newer UV engineering revision already exists. Refresh before creating another revision.' } });
            }
            source = requestedSource.rows[0];
        }
        const revisionNumber = Number(latest.rows[0]?.revision_number || 0) + 1;
        const values = EDITABLE_FIELDS.map(field => req.body[field] !== undefined ? req.body[field] : source?.[field] ?? null);
        const result = await client.query(`INSERT INTO uv_engineering_revisions (catalog_id, revision_number, status, ${EDITABLE_FIELDS.join(',')}, supersedes_id, created_by)
      VALUES ($1,$2,'Draft',${EDITABLE_FIELDS.map((_, i) => `$${i + 3}`).join(',')},$${EDITABLE_FIELDS.length + 3},$${EDITABLE_FIELDS.length + 4}) RETURNING *`, [req.params.id, revisionNumber, ...values, source?.id || null, req.user.id]);
        created = result.rows[0];
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
    await (0, audit_1.logAudit)(req.user.id, 'uv_engineering_revision', created.id, 'CREATE_REVISION', { summary: 'UV engineering draft revision created', catalog_id: req.params.id });
    res.status(201).json(created);
});
adminRouter.put('/revisions/:id', async (req, res) => {
    const existing = await (0, db_1.query)('SELECT * FROM uv_engineering_revisions WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'UV engineering revision not found' } });
    if (!['Draft', 'In Review'].includes(existing.rows[0].status))
        return res.status(409).json({ error: { code: 'IMMUTABLE_REVISION', message: 'Approved, retired, or disabled revisions cannot be edited; create a new draft revision.' } });
    const fields = EDITABLE_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(req.body, field));
    if (!fields.length)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'No editable engineering fields supplied.' } });
    const payloadError = engineeringPayloadError(req.body, fields);
    if (payloadError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: payloadError } });
    const result = await (0, db_1.query)(`UPDATE uv_engineering_revisions SET ${fields.map((field, i) => `${field}=$${i + 1}`).join(', ')}, updated_at=NOW() WHERE id=$${fields.length + 1} RETURNING *`, [...fields.map(field => req.body[field] === '' ? null : req.body[field]), req.params.id]);
    await (0, audit_1.logAudit)(req.user.id, 'uv_engineering_revision', String(req.params.id), 'UPDATE', { summary: 'UV engineering draft updated', fields });
    res.json(result.rows[0]);
});
adminRouter.patch('/revisions/:id/status', async (req, res) => {
    const existing = await (0, db_1.query)('SELECT * FROM uv_engineering_revisions WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'UV engineering revision not found' } });
    const status = req.body.status;
    if (!STATUSES.includes(status))
        return res.status(400).json({ error: { code: 'VALIDATION', message: `Status must be one of: ${STATUSES.join(', ')}` } });
    const from = existing.rows[0].status;
    if (status === from)
        return res.json(existing.rows[0]);
    if (status === 'Approved' && !complete(existing.rows[0]))
        return res.status(400).json({ error: { code: 'INCOMPLETE_REVISION', message: 'All required UV engineering fields must be complete and greater than zero before approval.' } });
    const transitions = {
        Draft: ['Draft', 'In Review', 'Approved', 'Disabled'],
        'In Review': ['In Review', 'Draft', 'Approved', 'Disabled'],
        Approved: ['Approved', 'Retired', 'Disabled'],
        Retired: ['Retired'],
        Disabled: ['Disabled'],
    };
    if (!transitions[from]?.includes(status)) {
        return res.status(409).json({ error: { code: 'IMMUTABLE_REVISION', message: `${from} revisions cannot be changed to ${status}; create a new draft revision if engineering values must change.` } });
    }
    const result = await (0, db_1.query)(`UPDATE uv_engineering_revisions SET status=$1::varchar, approved_by=CASE WHEN $1::varchar='Approved' THEN $2 ELSE approved_by END,
    approved_at=CASE WHEN $1::varchar='Approved' THEN NOW() ELSE approved_at END, retired_at=CASE WHEN $1::varchar='Retired' THEN NOW() ELSE retired_at END,
    updated_at=NOW() WHERE id=$3 RETURNING *`, [status, req.user.id, req.params.id]);
    if (status === 'Approved') {
        await (0, db_1.query)(`UPDATE uv_engineering_catalogs
      SET needs_review=false, review_reason=NULL, updated_at=NOW()
      WHERE id=$1`, [existing.rows[0].catalog_id]);
    }
    await (0, audit_1.logAudit)(req.user.id, 'uv_engineering_revision', String(req.params.id), 'STATUS_CHANGE', { summary: `UV engineering revision status changed to ${status}`, from, to: status });
    res.json(result.rows[0]);
});
consumerRouter.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('pim'));
consumerRouter.get('/uv-engineering/selectable', async (_req, res) => {
    const result = await (0, db_1.query)(`SELECT c.*, pm.product_code, pm.product_name, pm.manufacturer, pm.status AS pim_status,
      pm.product_category, pm.primary_material_code, pm.configuration, pm.control_type, pm.power_kw AS rated_power_kw,
      pf.product_family_code, pf.product_family_name, row_to_json(r) AS latest_revision,
      row_to_json(r) AS selected_revision, true AS calculation_enabled
    FROM uv_engineering_catalogs c
    JOIN product_masters pm ON pm.id=c.product_master_id
    JOIN product_families pf ON pf.id=pm.product_family_id
    JOIN LATERAL (
      SELECT approved.*
      FROM uv_engineering_revisions approved
      WHERE approved.catalog_id=c.id AND approved.status='Approved'
      ORDER BY approved.revision_number DESC
      LIMIT 1
    ) r ON true
    WHERE c.needs_review=false AND pm.status='Active' AND pf.product_family_code='PFM-UV'
      AND r.lamp_count > 0 AND r.lamp_power_w > 0 AND r.effective_reactor_volume_l > 0
      AND r.irradiance_85t_mw_cm2 > 0 AND r.irradiance_95t_mw_cm2 > 0
      AND NULLIF(BTRIM(r.compatibility),'') IS NOT NULL AND NULLIF(BTRIM(r.arrangement),'') IS NOT NULL
      AND NULLIF(BTRIM(r.source_evidence),'') IS NOT NULL
    ORDER BY pm.product_code`);
    res.json({ items: result.rows });
});
exports.default = adminRouter;
