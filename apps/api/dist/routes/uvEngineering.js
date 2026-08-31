"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uvEngineeringConsumerRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
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
    return Number(row.lamp_count) > 0 && row.lamp_power_w != null && row.effective_reactor_volume_l != null
        && row.irradiance_85t_mw_cm2 != null && row.irradiance_95t_mw_cm2 != null
        && !!String(row.compatibility || '').trim() && !!String(row.arrangement || '').trim()
        && !!String(row.source_evidence || '').trim();
}
const catalogSelect = `SELECT c.*, pm.product_code, pm.product_name, pm.manufacturer, pm.status AS pim_status,
  pm.product_category, pm.primary_material_code, pm.configuration, pm.control_type, pm.power_kw AS rated_power_kw,
  pf.product_family_code, pf.product_family_name
 FROM uv_engineering_catalogs c
 JOIN product_masters pm ON pm.id=c.product_master_id
 JOIN product_families pf ON pf.id=pm.product_family_id`;
adminRouter.use(auth_1.authenticate, (0, auth_1.requireModuleManage)('pim'), (0, auth_1.requireRole)('admin'));
adminRouter.get('/', async (req, res) => {
    const result = await (0, db_1.query)(`${catalogSelect}
    LEFT JOIN LATERAL (SELECT status, revision_number FROM uv_engineering_revisions r WHERE r.catalog_id=c.id ORDER BY revision_number DESC LIMIT 1) latest ON true
    ORDER BY pm.product_code`);
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
    const source = await (0, db_1.query)('SELECT * FROM uv_engineering_revisions WHERE id=$1', [req.body.source_revision_id || req.params.id]);
    let catalogId = req.params.id;
    if (source.rows[0])
        catalogId = source.rows[0].catalog_id;
    const catalog = await (0, db_1.query)('SELECT id FROM uv_engineering_catalogs WHERE id=$1', [catalogId]);
    if (!catalog.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'UV engineering catalog not found' } });
    const next = await (0, db_1.query)('SELECT COALESCE(MAX(revision_number),0)+1 AS revision_number FROM uv_engineering_revisions WHERE catalog_id=$1', [catalogId]);
    const src = source.rows[0] || {};
    const values = EDITABLE_FIELDS.map(field => req.body[field] !== undefined ? req.body[field] : src[field] ?? null);
    const result = await (0, db_1.query)(`INSERT INTO uv_engineering_revisions (catalog_id, revision_number, status, ${EDITABLE_FIELDS.join(',')}, supersedes_id, created_by)
    VALUES ($1,$2,'Draft',${EDITABLE_FIELDS.map((_, i) => `$${i + 3}`).join(',')},$${EDITABLE_FIELDS.length + 3},$${EDITABLE_FIELDS.length + 4}) RETURNING *`, [catalogId, next.rows[0].revision_number, ...values, src.id || null, req.user.id]);
    await (0, audit_1.logAudit)(req.user.id, 'uv_engineering_revision', result.rows[0].id, 'CREATE_REVISION', { summary: 'UV engineering draft revision created', catalog_id: catalogId });
    res.status(201).json(result.rows[0]);
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
    if (status === 'Approved' && !complete(existing.rows[0]))
        return res.status(400).json({ error: { code: 'INCOMPLETE_REVISION', message: 'All required UV engineering fields must be complete before approval.' } });
    if (existing.rows[0].status === 'Retired')
        return res.status(409).json({ error: { code: 'IMMUTABLE_REVISION', message: 'Retired revisions cannot be changed.' } });
    const result = await (0, db_1.query)(`UPDATE uv_engineering_revisions SET status=$1::varchar, approved_by=CASE WHEN $1::varchar='Approved' THEN $2 ELSE approved_by END,
    approved_at=CASE WHEN $1::varchar='Approved' THEN NOW() ELSE approved_at END, retired_at=CASE WHEN $1::varchar='Retired' THEN NOW() ELSE retired_at END,
    updated_at=NOW() WHERE id=$3 RETURNING *`, [status, req.user.id, req.params.id]);
    await (0, audit_1.logAudit)(req.user.id, 'uv_engineering_revision', String(req.params.id), 'STATUS_CHANGE', { summary: `UV engineering revision status changed to ${status}`, from: existing.rows[0].status, to: status });
    res.json(result.rows[0]);
});
consumerRouter.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('pim'));
consumerRouter.get('/uv-engineering/selectable', async (_req, res) => {
    const result = await (0, db_1.query)(`${catalogSelect} JOIN uv_engineering_revisions r ON r.catalog_id=c.id
    WHERE pm.status='Active' AND pf.product_family_code='PFM-UV' AND r.status='Approved'
      AND r.lamp_count > 0 AND r.lamp_power_w IS NOT NULL AND r.effective_reactor_volume_l IS NOT NULL
      AND r.irradiance_85t_mw_cm2 IS NOT NULL AND r.irradiance_95t_mw_cm2 IS NOT NULL
      AND NULLIF(BTRIM(r.compatibility),'') IS NOT NULL AND NULLIF(BTRIM(r.arrangement),'') IS NOT NULL
      AND NULLIF(BTRIM(r.source_evidence),'') IS NOT NULL ORDER BY pm.product_code, r.revision_number DESC`);
    res.json({ items: result.rows });
});
exports.default = adminRouter;
