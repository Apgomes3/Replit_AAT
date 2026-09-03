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
const WATER_COMPATIBILITY_TYPES = ['Saltwater', 'Seawater', 'Freshwater', 'Brackish water'];
const EDITABLE_FIELDS = [
    // lamp_count, material, rated power, and identity are PIM-owned. The legacy
    // compatibility/arrangement columns remain readable for old snapshots only.
    'effective_reactor_volume_l', 'irradiance_85t_mw_cm2',
    'irradiance_95t_mw_cm2', 'compatibility', 'arrangement', 'source_evidence',
    'source_basis',
    'approved_per_lamp_flow_exception_m3h', 'notes',
];
const CREATE_REVISION_FIELDS = [...EDITABLE_FIELDS, 'source_basis_verified'];
function approvalMissingItems(row) {
    const governed = row.governance_loaded === true;
    const lampCount = row.pim_lamp_count ?? row.lamp_count;
    const ratedPower = row.pim_rated_power_kw ?? row.lamp_power_w;
    const hasCompatibilityMapping = row.material_compatibility_count == null
        ? !!String(row.compatibility || '').trim()
        : Number(row.material_compatibility_count) > 0;
    const missing = [];
    if (governed && !String(row.product_code || '').trim())
        missing.push('PIM product code');
    if (governed && !String(row.product_name || '').trim())
        missing.push('PIM product name');
    if (governed && !String(row.primary_material_code || '').trim())
        missing.push('PIM primary material');
    if (!Number.isInteger(Number(lampCount)) || Number(lampCount) <= 0)
        missing.push('PIM lamp count');
    if (ratedPower == null || Number(ratedPower) <= 0)
        missing.push('PIM rated power');
    if (row.effective_reactor_volume_l == null || Number(row.effective_reactor_volume_l) <= 0)
        missing.push('positive effective reactor volume');
    if (row.irradiance_85t_mw_cm2 == null || Number(row.irradiance_85t_mw_cm2) <= 0)
        missing.push('positive irradiance at 85%T');
    if (row.irradiance_95t_mw_cm2 == null || Number(row.irradiance_95t_mw_cm2) <= 0)
        missing.push('positive irradiance at 95%T');
    if (!hasCompatibilityMapping) {
        missing.push(governed && row.primary_material_code
            ? `allowed material compatibility mapping for ${row.primary_material_code}`
            : 'governed material compatibility');
    }
    if (!String(row.source_basis || row.source_evidence || '').trim())
        missing.push('controlled source evidence');
    if (governed && row.source_basis !== 'AAT Foundations')
        missing.push('AAT Foundations source basis');
    return missing;
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
function parseCompatibilityOverrides(value) {
    if (value === undefined)
        return { provided: false, rows: [] };
    if (!Array.isArray(value))
        return { provided: true, error: 'Compatibility overrides must be an array.' };
    const seen = new Set();
    const rows = [];
    for (const item of value) {
        if (!item || !WATER_COMPATIBILITY_TYPES.includes(item.water_type) || typeof item.allowed !== 'boolean') {
            return { provided: true, error: 'Compatibility overrides must contain a valid water type and boolean allowed value.' };
        }
        if (seen.has(item.water_type)) {
            return { provided: true, error: `Compatibility override for ${item.water_type} was supplied more than once.` };
        }
        seen.add(item.water_type);
        rows.push({ water_type: item.water_type, allowed: item.allowed });
    }
    return { provided: true, rows };
}
// The four controlled water types are always shown. A null default means
// the material library has no entry yet; the effective value is false until
// an explicit revision override is saved.
const compatibilityOptionsJoin = `LEFT JOIN LATERAL (
  SELECT json_agg(json_build_object(
    'water_type', water_types.water_type,
    'default_allowed', mwc.allowed,
    'allowed', COALESCE(override.allowed, mwc.allowed, false),
    'is_override', override.id IS NOT NULL,
    'source', mwc.source,
    'notes', mwc.notes
  ) ORDER BY water_types.sort_order) AS compatibility_options
  FROM (VALUES (1, 'Saltwater'), (2, 'Seawater'), (3, 'Freshwater'), (4, 'Brackish water')) water_types(sort_order, water_type)
  LEFT JOIN material_water_compatibility mwc
    ON mwc.material_code=pm.primary_material_code AND mwc.water_type=water_types.water_type
  LEFT JOIN uv_engineering_revision_compatibility override
    ON override.revision_id=latest.id AND override.water_type=water_types.water_type
) compatibility_options ON true`;
const catalogSelect = `SELECT c.*, pm.product_code, pm.product_name, pm.manufacturer, pm.status AS pim_status,
  pm.product_category, pm.primary_material_code, pm.configuration, pm.control_type, pm.signal_type,
  pm.control_type_optional, pm.power_kw AS rated_power_kw,
  pm.lamp_count AS pim_lamp_count,
  pf.product_family_code, pf.product_family_name,
  row_to_json(latest) AS latest_revision,
  COALESCE(pm.lamp_count, latest.lamp_count) AS lamp_count,
  COALESCE(pm.power_kw, latest.lamp_power_w) AS effective_rated_power_kw,
  COALESCE(compatibility.material_compatibility_count, 0) AS material_compatibility_count,
  COALESCE(compatibility_options.compatibility_options, '[]'::json) AS compatibility_options,
  CASE WHEN c.needs_review THEN 'Needs Review' ELSE 'Current' END AS sync_status,
  CASE WHEN c.needs_review THEN false
       WHEN pm.status <> 'Active' OR pf.product_family_code <> 'PFM-UV' THEN false
       WHEN latest.status <> 'Approved' THEN false
       WHEN NULLIF(BTRIM(pm.product_code),'') IS NULL OR NULLIF(BTRIM(pm.product_name),'') IS NULL
         OR NULLIF(BTRIM(pm.primary_material_code),'') IS NULL OR pm.power_kw IS NULL OR pm.power_kw <= 0
         OR pm.lamp_count IS NULL OR pm.lamp_count <= 0
         OR latest.effective_reactor_volume_l IS NULL OR latest.effective_reactor_volume_l <= 0
         OR latest.irradiance_85t_mw_cm2 IS NULL OR latest.irradiance_85t_mw_cm2 <= 0
         OR latest.irradiance_95t_mw_cm2 IS NULL OR latest.irradiance_95t_mw_cm2 <= 0
         OR COALESCE(compatibility.material_compatibility_count, 0) = 0
         OR COALESCE(latest.source_basis, '') <> 'AAT Foundations'
         OR latest.source_basis_verified IS NOT TRUE THEN false
       ELSE true END AS calculation_enabled,
  CASE WHEN c.needs_review THEN COALESCE(c.review_reason, 'PIM identity requires review')
       WHEN pm.status <> 'Active' THEN 'PIM product is inactive'
       WHEN pf.product_family_code <> 'PFM-UV' THEN 'Product is no longer in PFM-UV'
       WHEN latest.id IS NULL THEN 'Engineering revision required'
       WHEN latest.status <> 'Approved' THEN 'Engineering revision is not approved'
       WHEN NULLIF(BTRIM(pm.product_code),'') IS NULL OR NULLIF(BTRIM(pm.product_name),'') IS NULL THEN 'PIM product identity is incomplete'
       WHEN NULLIF(BTRIM(pm.primary_material_code),'') IS NULL THEN 'PIM primary material is missing'
       WHEN pm.power_kw IS NULL OR pm.power_kw <= 0 THEN 'PIM rated power is missing or invalid'
       WHEN pm.lamp_count IS NULL OR pm.lamp_count <= 0 THEN 'PIM lamp count is missing or invalid'
       WHEN latest.effective_reactor_volume_l IS NULL OR latest.effective_reactor_volume_l <= 0
         OR latest.irradiance_85t_mw_cm2 IS NULL OR latest.irradiance_85t_mw_cm2 <= 0
         OR latest.irradiance_95t_mw_cm2 IS NULL OR latest.irradiance_95t_mw_cm2 <= 0
         THEN 'Required engineering data is incomplete'
       WHEN COALESCE(compatibility.material_compatibility_count, 0) = 0 THEN 'No governed water compatibility mapping exists for the PIM material'
       WHEN COALESCE(latest.source_basis, '') <> 'AAT Foundations'
         OR latest.source_basis_verified IS NOT TRUE THEN 'Reviewed source must be verified as AAT Foundations'
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
  ) latest ON true
  LEFT JOIN LATERAL (
     SELECT COUNT(*) FILTER (WHERE COALESCE(override.allowed, mwc.allowed, false))::int AS material_compatibility_count
     FROM (VALUES ('Saltwater'), ('Seawater'), ('Freshwater'), ('Brackish water')) water_types(water_type)
     LEFT JOIN material_water_compatibility mwc
       ON mwc.material_code=pm.primary_material_code AND mwc.water_type=water_types.water_type
     LEFT JOIN uv_engineering_revision_compatibility override
       ON override.revision_id=latest.id AND override.water_type=water_types.water_type
   ) compatibility ON true
  ${compatibilityOptionsJoin}`;
adminRouter.use(auth_1.authenticate, (0, auth_1.requireModuleManage)('pim'), (0, auth_1.requireRole)('admin', 'engineer'));
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
      'control_type',pm.control_type,'rated_power_kw',pm.power_kw,'lamp_count',pm.lamp_count)
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
    const compatibilityOverrides = parseCompatibilityOverrides(req.body.compatibility_overrides);
    if (compatibilityOverrides.error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: compatibilityOverrides.error } });
    }
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
        const values = CREATE_REVISION_FIELDS.map(field => field === 'source_basis_verified'
            ? false
            : req.body[field] !== undefined ? req.body[field] : source?.[field] ?? null);
        const result = await client.query(`INSERT INTO uv_engineering_revisions (catalog_id, revision_number, status, ${CREATE_REVISION_FIELDS.join(',')}, supersedes_id, created_by)
      VALUES ($1,$2,'Draft',${CREATE_REVISION_FIELDS.map((_, i) => `$${i + 3}`).join(',')},$${CREATE_REVISION_FIELDS.length + 3},$${CREATE_REVISION_FIELDS.length + 4}) RETURNING *`, [req.params.id, revisionNumber, ...values, source?.id || null, req.user.id]);
        created = result.rows[0];
        if (compatibilityOverrides.provided) {
            for (const override of compatibilityOverrides.rows || []) {
                await client.query(`INSERT INTO uv_engineering_revision_compatibility (revision_id, water_type, allowed)
          VALUES ($1,$2,$3)`, [created.id, override.water_type, override.allowed]);
            }
        }
        else if (source?.id) {
            await client.query(`INSERT INTO uv_engineering_revision_compatibility (revision_id, water_type, allowed)
        SELECT $1, water_type, allowed FROM uv_engineering_revision_compatibility WHERE revision_id=$2`, [created.id, source.id]);
        }
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
    if (Object.prototype.hasOwnProperty.call(req.body, 'lamp_count')) {
        const payloadError = engineeringPayloadError(req.body, ['lamp_count']);
        if (payloadError)
            return res.status(400).json({ error: { code: 'VALIDATION', message: payloadError } });
        return res.status(400).json({ error: { code: 'PIM_OWNED_FIELD', message: 'Lamp count is owned by the linked Product Master.' } });
    }
    const compatibilityOverrides = parseCompatibilityOverrides(req.body.compatibility_overrides);
    if (compatibilityOverrides.error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: compatibilityOverrides.error } });
    }
    const fields = EDITABLE_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(req.body, field));
    if (!fields.length && !compatibilityOverrides.provided) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'No editable engineering fields supplied.' } });
    }
    const payloadError = engineeringPayloadError(req.body, fields);
    if (payloadError)
        return res.status(400).json({ error: { code: 'VALIDATION', message: payloadError } });
    const result = fields.length
        ? await (0, db_1.query)(`UPDATE uv_engineering_revisions SET ${fields.map((field, i) => `${field}=$${i + 1}`).join(', ')}, updated_at=NOW() WHERE id=$${fields.length + 1} RETURNING *`, [...fields.map(field => req.body[field] === '' ? null : req.body[field]), req.params.id])
        : { rows: [existing.rows[0]] };
    if (compatibilityOverrides.provided) {
        const client = await db_1.default.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM uv_engineering_revision_compatibility WHERE revision_id=$1', [req.params.id]);
            for (const override of compatibilityOverrides.rows || []) {
                await client.query(`INSERT INTO uv_engineering_revision_compatibility (revision_id, water_type, allowed)
          VALUES ($1,$2,$3)`, [req.params.id, override.water_type, override.allowed]);
            }
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    await (0, audit_1.logAudit)(req.user.id, 'uv_engineering_revision', String(req.params.id), 'UPDATE', {
        summary: 'UV engineering draft updated',
        fields,
        compatibility_overrides: compatibilityOverrides.provided ? compatibilityOverrides.rows : undefined,
    });
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
    if (status === 'Approved') {
        const governance = await (0, db_1.query)(`SELECT true AS governance_loaded, pm.product_code, pm.product_name,
              pm.primary_material_code, pm.power_kw AS pim_rated_power_kw,
              pm.lamp_count AS pim_lamp_count,
              (SELECT COUNT(*) FILTER (WHERE COALESCE(override.allowed, mwc.allowed, false))::int
                 FROM (VALUES ('Saltwater'), ('Seawater'), ('Freshwater'), ('Brackish water')) water_types(water_type)
                 LEFT JOIN material_water_compatibility mwc
                   ON mwc.material_code=pm.primary_material_code AND mwc.water_type=water_types.water_type
                 LEFT JOIN uv_engineering_revision_compatibility override
                   ON override.revision_id=$2 AND override.water_type=water_types.water_type
              ) AS material_compatibility_count
         FROM uv_engineering_catalogs c
         JOIN product_masters pm ON pm.id=c.product_master_id
        WHERE c.id=$1`, [existing.rows[0].catalog_id, existing.rows[0].id]);
        const candidate = governance.rows[0]
            ? { ...existing.rows[0], ...governance.rows[0] }
            : existing.rows[0];
        const missingItems = approvalMissingItems(candidate);
        if (missingItems.length > 0) {
            return res.status(400).json({
                error: {
                    code: 'INCOMPLETE_REVISION',
                    message: `Approval blocked. Missing: ${missingItems.join('; ')}.`,
                    missing: missingItems,
                },
            });
        }
        if (governance.rows[0] && existing.rows[0].source_basis !== 'AAT Foundations') {
            return res.status(400).json({ error: { code: 'INVALID_SOURCE_BASIS', message: 'Reviewed source must be AAT Foundations.' } });
        }
    }
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
    source_basis_verified=CASE WHEN $1::varchar='Approved' THEN true ELSE source_basis_verified END,
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
      pm.product_category, pm.primary_material_code, pm.configuration, pm.control_type, pm.signal_type,
      pm.control_type_optional, pm.power_kw AS rated_power_kw,
      pm.lamp_count,
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
      AND NULLIF(BTRIM(pm.product_code),'') IS NOT NULL
      AND NULLIF(BTRIM(pm.product_name),'') IS NOT NULL
      AND NULLIF(BTRIM(pm.primary_material_code),'') IS NOT NULL
      AND pm.power_kw > 0 AND pm.lamp_count > 0 AND r.effective_reactor_volume_l > 0
      AND r.irradiance_85t_mw_cm2 > 0 AND r.irradiance_95t_mw_cm2 > 0
      AND r.source_basis='AAT Foundations' AND r.source_basis_verified=true
      AND EXISTS (
        SELECT 1
        FROM (VALUES ('Saltwater'), ('Seawater'), ('Freshwater'), ('Brackish water')) water_types(water_type)
        LEFT JOIN material_water_compatibility mwc
          ON mwc.material_code=pm.primary_material_code AND mwc.water_type=water_types.water_type
        LEFT JOIN uv_engineering_revision_compatibility override
          ON override.revision_id=r.id AND override.water_type=water_types.water_type
        WHERE COALESCE(override.allowed, mwc.allowed, false)
      )
    ORDER BY pm.product_code`);
    res.json({ items: result.rows });
});
exports.default = adminRouter;
