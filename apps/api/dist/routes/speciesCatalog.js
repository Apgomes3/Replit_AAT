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
const audit_1 = require("../db/audit");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const routeParam = (value) => Array.isArray(value) ? value[0] : value;
const WATER_TYPES = new Set(['Marine', 'Freshwater', 'Brackish', 'Universal']);
function text(value, label, required = false) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (required && !result)
        throw new Error(`${label} is required`);
    if (result.length > 255)
        throw new Error(`${label} must be 255 characters or fewer`);
    return result || null;
}
function measurement(value, label, required = false) {
    if (value === '' || value == null) {
        if (required)
            throw new Error(`${label} is required`);
        return null;
    }
    const result = Number(value);
    if (!Number.isFinite(result) || result <= 0)
        throw new Error(`${label} must be greater than zero`);
    return result;
}
function catalogPayload(body) {
    const waterType = text(body.water_type, 'Water type', true);
    if (!WATER_TYPES.has(waterType))
        throw new Error('Water type must be Marine, Freshwater, Brackish, or Universal');
    if (body.active !== undefined && typeof body.active !== 'boolean') {
        throw new Error('Active must be true or false');
    }
    return {
        scientific_name: text(body.scientific_name, 'Scientific name', true),
        common_name: text(body.common_name, 'Common name'),
        family: text(body.family, 'Family', true),
        water_type: waterType,
        average_size_cm: measurement(body.average_size_cm, 'Average size'),
        reference_average_mass_kg: measurement(body.reference_average_mass_kg, 'Reference average mass'),
        source: text(body.source, 'Source / provenance', true),
        active: body.active === undefined ? true : body.active,
    };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : 'Unexpected catalog error';
}
router.get('/species-catalog/facets', async (_req, res) => {
    const [families, waterTypes] = await Promise.all([
        (0, db_1.query)(`SELECT family, COUNT(*)::int AS count FROM aquarium_species_catalog WHERE active=true GROUP BY family ORDER BY family`),
        (0, db_1.query)(`SELECT water_type, COUNT(*)::int AS count FROM aquarium_species_catalog WHERE active=true GROUP BY water_type ORDER BY water_type`),
    ]);
    res.json({ families: families.rows, water_types: waterTypes.rows });
});
router.get('/species-catalog', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const waterType = String(req.query.water_type || '').trim();
    const family = String(req.query.family || '').trim();
    const includeInactive = req.query.include_inactive === 'true';
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const params = [];
    const conditions = [];
    if (!includeInactive)
        conditions.push('active=true');
    if (q) {
        params.push(`%${q}%`);
        conditions.push(`(scientific_name ILIKE $${params.length} OR common_name ILIKE $${params.length} OR family ILIKE $${params.length})`);
    }
    if (waterType) {
        params.push(waterType);
        conditions.push(`water_type=$${params.length}`);
    }
    if (family) {
        params.push(family);
        conditions.push(`family=$${params.length}`);
    }
    params.push(limit, offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await (0, db_1.query)(`SELECT *, COUNT(*) OVER()::int AS total_count
     FROM aquarium_species_catalog ${where}
     ORDER BY water_type, family, scientific_name
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({
        items: result.rows.map(({ total_count, ...row }) => row),
        total: result.rows[0]?.total_count || 0,
        limit,
        offset,
    });
});
router.get('/species-catalog/:id', async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM aquarium_species_catalog WHERE id=$1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species catalog record not found' } });
    res.json(result.rows[0]);
});
router.post('/species-catalog', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    let payload;
    try {
        payload = catalogPayload(req.body);
    }
    catch (error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: errorMessage(error) } });
    }
    try {
        const result = await (0, db_1.query)(`INSERT INTO aquarium_species_catalog
         (scientific_name, common_name, family, water_type, average_size_cm,
          reference_average_mass_kg, source, active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`, [payload.scientific_name, payload.common_name, payload.family, payload.water_type,
            payload.average_size_cm, payload.reference_average_mass_kg, payload.source, payload.active, req.user.id]);
        await (0, audit_1.logAudit)(req.user.id, 'aquarium_species_catalog', result.rows[0].id, 'CREATE', payload, req.ip);
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        if (error?.code === '23505')
            return res.status(409).json({ error: { code: 'DUPLICATE_SCIENTIFIC_NAME', message: 'Scientific name already exists in the catalog.' } });
        throw error;
    }
});
router.put('/species-catalog/:id', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    let payload;
    try {
        payload = catalogPayload(req.body);
    }
    catch (error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: errorMessage(error) } });
    }
    try {
        const result = await (0, db_1.query)(`UPDATE aquarium_species_catalog
       SET scientific_name=$1, common_name=$2, family=$3, water_type=$4,
           average_size_cm=$5, reference_average_mass_kg=$6, source=$7,
           active=$8, updated_by=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`, [payload.scientific_name, payload.common_name, payload.family, payload.water_type,
            payload.average_size_cm, payload.reference_average_mass_kg, payload.source, payload.active,
            req.user.id, req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species catalog record not found' } });
        await (0, audit_1.logAudit)(req.user.id, 'aquarium_species_catalog', routeParam(req.params.id), 'UPDATE', payload, req.ip);
        res.json(result.rows[0]);
    }
    catch (error) {
        if (error?.code === '23505')
            return res.status(409).json({ error: { code: 'DUPLICATE_SCIENTIFIC_NAME', message: 'Scientific name already exists in the catalog.' } });
        throw error;
    }
});
router.post('/species-catalog/import', (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('design_books'), async (req, res) => {
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!records.length || records.length > 1000) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Import must contain between 1 and 1,000 records.' } });
    }
    const prepared = [];
    const names = new Set();
    try {
        for (const record of records) {
            const payload = catalogPayload(record);
            const key = payload.scientific_name.toLowerCase();
            if (names.has(key))
                throw new Error(`Duplicate scientific name in import: ${payload.scientific_name}`);
            names.add(key);
            prepared.push(payload);
        }
    }
    catch (error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: errorMessage(error) } });
    }
    const client = await db_1.default.connect();
    let inserted = 0;
    try {
        await client.query('BEGIN');
        for (const payload of prepared) {
            const result = await client.query(`INSERT INTO aquarium_species_catalog
           (scientific_name, common_name, family, water_type, average_size_cm,
            reference_average_mass_kg, source, active, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
         ON CONFLICT DO NOTHING RETURNING id`, [payload.scientific_name, payload.common_name, payload.family, payload.water_type,
                payload.average_size_cm, payload.reference_average_mass_kg, payload.source, payload.active, req.user.id]);
            inserted += result.rowCount || 0;
        }
        await client.query('COMMIT');
        await (0, audit_1.logAudit)(req.user.id, 'aquarium_species_catalog', 'import', 'IMPORT', {
            requested: records.length, inserted, skipped: records.length - inserted,
        }, req.ip);
        res.status(201).json({ requested: records.length, inserted, skipped: records.length - inserted });
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
