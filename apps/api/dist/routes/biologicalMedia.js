"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMediaProfile = validateMediaProfile;
exports.validateTanProfile = validateTanProfile;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../db");
const aquariumCalculations_1 = require("../lib/aquariumCalculations");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const PROFILE_STATUSES = ['Draft', 'In Review', 'Approved', 'Retired'];
const routeParam = (value) => Array.isArray(value) ? value[0] : value;
function text(value) {
    if (value == null)
        return null;
    const result = String(value).trim();
    return result || null;
}
function numberOrNull(value) {
    if (value == null || value === '')
        return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}
function arrayOfText(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}
function rangeError(min, max, label) {
    return min != null && max != null && min > max
        ? `${label} minimum cannot exceed maximum.`
        : null;
}
function validateMediaProfile(body, approving = body.status === 'Approved') {
    const errors = [];
    if (!text(body.profile_code))
        errors.push('Profile code is required.');
    if (!text(body.profile_name))
        errors.push('Profile name is required.');
    if (!arrayOfText(body.water_types).length)
        errors.push('Select at least one compatible water type.');
    if (!arrayOfText(body.reactor_types).length)
        errors.push('Select at least one compatible reactor type.');
    if (!text(body.capacity_model))
        errors.push('Capacity model metadata is required.');
    if (!text(body.capacity_model_version))
        errors.push('Capacity model version is required.');
    if (!text(body.capacity_basis_unit))
        errors.push('Capacity basis unit is required.');
    const ranges = [
        ['operating_min_temperature_c', body.operating_min_temperature_c, body.operating_max_temperature_c, 'Operating temperature'],
        ['operating_min_salinity_ppt', body.operating_min_salinity_ppt, body.operating_max_salinity_ppt, 'Operating salinity'],
        ['media_min_depth_mm', body.media_min_depth_mm, body.media_max_depth_mm, 'Media depth'],
    ];
    for (const [, minValue, maxValue, label] of ranges) {
        const min = numberOrNull(minValue);
        const max = numberOrNull(maxValue);
        if ((minValue != null && minValue !== '' && min == null) || (maxValue != null && maxValue !== '' && max == null)) {
            errors.push(`${label} bounds must be numbers.`);
        }
        else {
            const error = rangeError(min, max, label);
            if (error)
                errors.push(error);
            if (min != null && min < 0 || max != null && max < 0)
                errors.push(`${label} bounds cannot be negative.`);
        }
    }
    const voidFraction = numberOrNull(body.media_void_fraction);
    if (voidFraction != null && (voidFraction < 0 || voidFraction > 1))
        errors.push('Media void fraction must be between 0 and 1.');
    if (body.media_bulk_density_kg_m3 != null && body.media_bulk_density_kg_m3 !== ''
        && (numberOrNull(body.media_bulk_density_kg_m3) == null || Number(body.media_bulk_density_kg_m3) < 0)) {
        errors.push('Media bulk density must be a non-negative number.');
    }
    if (!text(body.evidence_reference))
        errors.push('Evidence reference is required.');
    if (body.is_provisional && !text(body.provisional_label))
        errors.push('Provisional profiles require an explicit provisional label.');
    if (approving) {
        for (const [field, label] of [
            ['operating_min_temperature_c', 'Minimum operating temperature'],
            ['operating_max_temperature_c', 'Maximum operating temperature'],
            ['operating_min_salinity_ppt', 'Minimum operating salinity'],
            ['operating_max_salinity_ppt', 'Maximum operating salinity'],
            ['media_min_depth_mm', 'Minimum media depth'],
            ['media_max_depth_mm', 'Maximum media depth'],
            ['media_void_fraction', 'Media void fraction'],
            ['media_bulk_density_kg_m3', 'Media bulk density'],
        ]) {
            if (numberOrNull(body[field]) == null)
                errors.push(`${label} is required before approval.`);
        }
    }
    return errors;
}
function validateTanProfile(body) {
    const errors = [];
    if (!text(body.profile_code))
        errors.push('Profile code is required.');
    if (!text(body.profile_name))
        errors.push('Profile name is required.');
    const coefficient = numberOrNull(body.coefficient);
    if (coefficient == null || coefficient <= 0)
        errors.push('Coefficient must be greater than zero.');
    if (!text(body.coefficient_unit))
        errors.push('Coefficient unit is required.');
    if (!text(body.scope_type))
        errors.push('Scope type is required.');
    const min = numberOrNull(body.scope_min);
    const max = numberOrNull(body.scope_max);
    if ((body.scope_min != null && body.scope_min !== '' && min == null) || (body.scope_max != null && body.scope_max !== '' && max == null)) {
        errors.push('Scope range bounds must be numbers.');
    }
    else {
        const error = rangeError(min, max, 'Scope range');
        if (error)
            errors.push(error);
        if (min != null && min < 0 || max != null && max < 0)
            errors.push('Scope range cannot be negative.');
    }
    if (!text(body.evidence_reference))
        errors.push('Evidence reference is required.');
    return errors;
}
function databaseProfileError(error) {
    if (error?.code === '23505')
        return { code: 'DUPLICATE_REVISION', message: 'That profile code and revision already exists.' };
    if (error?.code === '23514')
        return { code: 'VALIDATION', message: 'The profile contains a contradictory value or range.' };
    if (error?.code === '55000')
        return { code: 'IMMUTABLE_REVISION', message: error.message };
    return null;
}
async function nextRevision(table, code) {
    const result = await (0, db_1.query)(`SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM ${table} WHERE profile_code=$1`, [code]);
    return Number(result.rows[0].revision);
}
async function profileRevision(table, id) {
    const result = await (0, db_1.query)(`SELECT * FROM ${table} WHERE id=$1`, [id]);
    return result.rows[0] || null;
}
async function requireApprovedProfile(table, id, label) {
    if (!id)
        return null;
    const result = await (0, db_1.query)(`SELECT * FROM ${table} WHERE id=$1`, [id]);
    const profile = result.rows[0];
    if (!profile)
        return `${label} was not found.`;
    if (profile.status !== 'Approved')
        return `${label} must be an approved revision; ${profile.status.toLowerCase()} revisions cannot be used here.`;
    return null;
}
async function linkedVolumeContext(systemId, designBookId) {
    const book = await (0, db_1.query)('SELECT id, project_id FROM design_books WHERE id=$1', [designBookId]);
    const system = await (0, db_1.query)('SELECT id, project_id, water_type FROM systems WHERE id=$1', [systemId]);
    if (!book.rows[0] || !system.rows[0])
        return { error: { code: 'NOT_FOUND', message: 'System or Design Book not found.' } };
    if (book.rows[0].project_id !== system.rows[0].project_id) {
        return { error: { code: 'CONTEXT_MISMATCH', message: 'The Design Book and LSS system must belong to the same project.' } };
    }
    const links = await (0, db_1.query)(`SELECT sel.exhibit_id, e.exhibit_code, e.exhibit_name, e.water_type
     FROM system_exhibit_links sel JOIN exhibits e ON e.id=sel.exhibit_id
     WHERE sel.system_id=$1 ORDER BY sel.sort_order, e.exhibit_code`, [systemId]);
    const exhibitIds = links.rows.map((link) => link.exhibit_id);
    if (!exhibitIds.length) {
        return {
            system_water_type: system.rows[0].water_type,
            linked_exhibits: [],
            total_operating_volume_m3: null,
            status: 'blocked',
            reasons: ['No linked exhibits are configured for this system.'],
        };
    }
    const [exhibits, tanks, hydraulics, substrate] = await Promise.all([
        (0, db_1.query)('SELECT * FROM exhibits WHERE id = ANY($1::uuid[])', [exhibitIds]),
        (0, db_1.query)(`SELECT t.*, t.operating_volume_m3 AS project_operating_volume_m3,
              pm.operating_volume_m3 AS pim_operating_volume_m3,
              COALESCE(t.shape_type, pm.shape_type) AS eff_shape,
              COALESCE(t.length_mm, pm.length_mm) AS eff_length_mm,
              COALESCE(t.width_mm, pm.width_mm) AS eff_width_mm,
              COALESCE(t.height_mm, pm.height_mm) AS eff_height_mm,
              COALESCE(t.design_water_level_mm, pm.design_water_level_mm) AS eff_water_level_mm
       FROM tanks t LEFT JOIN product_masters pm ON pm.id=t.product_master_id
       WHERE t.exhibit_id = ANY($1::uuid[])`, [exhibitIds]),
        (0, db_1.query)('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [designBookId, exhibitIds]),
        (0, db_1.query)('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [designBookId, exhibitIds]),
    ]);
    const linkedExhibits = links.rows.map((link) => {
        const exhibit = exhibits.rows.find((item) => item.id === link.exhibit_id);
        const exhibitTanks = tanks.rows.filter((item) => item.exhibit_id === link.exhibit_id);
        const calculation = (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, exhibitTanks, hydraulics.rows.find((item) => item.exhibit_id === link.exhibit_id), substrate.rows.find((item) => item.exhibit_id === link.exhibit_id));
        return {
            exhibit_id: link.exhibit_id,
            exhibit_code: link.exhibit_code,
            exhibit_name: link.exhibit_name,
            water_type: exhibit?.water_type || link.water_type,
            operating_volume_m3: Number(calculation.results.operating_volume_m3) > 0
                ? calculation.results.operating_volume_m3
                : null,
        };
    });
    const usable = linkedExhibits.every(item => item.operating_volume_m3 != null && item.operating_volume_m3 > 0);
    return {
        system_water_type: system.rows[0].water_type,
        linked_exhibits: linkedExhibits,
        total_operating_volume_m3: usable
            ? linkedExhibits.reduce((sum, item) => sum + Number(item.operating_volume_m3), 0)
            : null,
        status: usable ? 'ready' : 'blocked',
        reasons: usable ? [] : ['Every linked exhibit needs a positive current operating water volume.'],
    };
}
async function caseResponse(systemId, designBookId) {
    const bookPackageResult = await (0, db_1.query)('SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1', [designBookId]);
    const bookPackage = bookPackageResult.rows[0];
    if (!bookPackage)
        return { error: { code: 'NOT_FOUND', message: 'Design Book not found.' } };
    const snapshot = bookPackage.status === 'Released'
        ? bookPackage.release_snapshot
        : ['For Review', 'Approved'].includes(bookPackage.status)
            ? bookPackage.review_snapshot
            : null;
    if (snapshot) {
        const snapshotSystem = (snapshot.systems || []).find((item) => item.id === systemId);
        if (!snapshotSystem)
            return { error: { code: 'NOT_FOUND', message: 'System is not included in this frozen Design Book package.' } };
        const snapshotLinks = (snapshot.system_links || []).filter((item) => item.system_id === systemId);
        const snapshotCalculations = snapshot.engineering_calculations?.exhibits || [];
        const linkedExhibits = snapshotLinks.map((link) => {
            const exhibit = (snapshot.exhibits || []).find((item) => item.id === link.exhibit_id);
            const calculation = snapshotCalculations.find((item) => item.inputs?.exhibit_id === link.exhibit_id);
            const volume = Number(calculation?.results?.operating_volume_m3);
            return {
                exhibit_id: link.exhibit_id,
                exhibit_code: link.exhibit_code || exhibit?.exhibit_code,
                exhibit_name: exhibit?.exhibit_name,
                water_type: exhibit?.water_type,
                operating_volume_m3: Number.isFinite(volume) && volume > 0 ? volume : null,
            };
        });
        const usable = linkedExhibits.length > 0
            && linkedExhibits.every((item) => item.operating_volume_m3 != null);
        const context = {
            system_water_type: snapshotSystem.water_type,
            linked_exhibits: linkedExhibits,
            total_operating_volume_m3: usable
                ? linkedExhibits.reduce((sum, item) => sum + Number(item.operating_volume_m3), 0)
                : null,
            status: usable ? 'ready' : 'blocked',
            reasons: usable ? [] : ['The frozen package has no complete linked-exhibit operating water-volume context.'],
            source: 'frozen_design_book_package',
        };
        const record = (snapshot.biological_media_cases || []).find((item) => item.system_id === systemId && item.design_book_id === designBookId) || null;
        const missingInputs = [];
        if (!record)
            missingInputs.push('Create the biological media draft.');
        if (record && !record.reactor_type)
            missingInputs.push('Choose a reactor type.');
        if (record && !record.media_profile_revision_id)
            missingInputs.push('Select an approved media profile revision.');
        if (record && !record.tan_generation_profile_revision_id)
            missingInputs.push('Select an approved TAN generation profile revision.');
        const readinessStatus = !usable ? 'Blocked' : missingInputs.length ? 'Incomplete' : 'Draft';
        return {
            case: record,
            context,
            readiness_status: readinessStatus,
            input_completeness: { complete: missingInputs.length === 0 && usable, missing: missingInputs },
        };
    }
    const [caseResult, context] = await Promise.all([
        (0, db_1.query)(`SELECT c.*, mp.profile_code AS media_profile_code, mp.profile_name AS media_profile_name,
              mp.revision AS media_profile_revision, mp.status AS media_profile_status,
              tp.profile_code AS tan_profile_code, tp.profile_name AS tan_profile_name,
              tp.revision AS tan_profile_revision, tp.status AS tan_profile_status
       FROM lss_biological_media_cases c
       LEFT JOIN lss_biological_media_profiles mp ON mp.id=c.media_profile_revision_id
       LEFT JOIN lss_tan_generation_profiles tp ON tp.id=c.tan_generation_profile_revision_id
       WHERE c.system_id=$1 AND c.design_book_id=$2`, [systemId, designBookId]),
        linkedVolumeContext(systemId, designBookId),
    ]);
    if ('error' in context)
        return context;
    const record = caseResult.rows[0] || null;
    const missingInputs = [];
    if (!record)
        missingInputs.push('Create the biological media draft.');
    if (record && !record.reactor_type)
        missingInputs.push('Choose a reactor type.');
    if (record && !record.media_profile_revision_id)
        missingInputs.push('Select an approved media profile revision.');
    if (record && !record.tan_generation_profile_revision_id)
        missingInputs.push('Select an approved TAN generation profile revision.');
    const blocked = context.status === 'blocked';
    const readinessStatus = blocked ? 'Blocked' : missingInputs.length ? 'Incomplete' : 'Draft';
    return {
        case: record,
        context,
        readiness_status: readinessStatus,
        input_completeness: { complete: missingInputs.length === 0 && !blocked, missing: missingInputs },
    };
}
router.get('/systems/:id/biological-media', async (req, res) => {
    const designBookId = text(req.query.design_book_id);
    if (!designBookId)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
    const result = await caseResponse(routeParam(req.params.id), designBookId);
    if ('error' in result)
        return res.status(result.error.code === 'NOT_FOUND' ? 404 : 409).json({ error: result.error });
    res.json(result);
});
router.put('/systems/:id/biological-media', (0, auth_1.requireModuleManage)('design_books'), (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const designBookId = text(req.body.design_book_id);
    if (!designBookId)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
    const editable = await (0, db_1.query)(`SELECT db.status AS book_status, s.status AS system_status
     FROM design_books db JOIN systems s ON s.project_id=db.project_id
     WHERE db.id=$1 AND s.id=$2`, [designBookId, routeParam(req.params.id)]);
    if (!editable.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System or Design Book not found.' } });
    if (!['Draft', 'In Progress'].includes(editable.rows[0].book_status)
        || ['For Review', 'Approved', 'Released'].includes(editable.rows[0].system_status)) {
        return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Biological Media drafts are read-only for frozen Design Books or reviewed systems.' } });
    }
    const reactorType = text(req.body.reactor_type);
    if (reactorType && reactorType.length > 120)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Reactor type must be 120 characters or fewer.' } });
    const mediaId = text(req.body.media_profile_revision_id);
    const tanId = text(req.body.tan_generation_profile_revision_id);
    const mediaError = await requireApprovedProfile('lss_biological_media_profiles', mediaId, 'Media profile');
    const tanError = await requireApprovedProfile('lss_tan_generation_profiles', tanId, 'TAN generation profile');
    if (mediaError || tanError)
        return res.status(409).json({ error: { code: 'PROFILE_NOT_APPROVED', message: mediaError || tanError } });
    const systemId = routeParam(req.params.id);
    const context = await linkedVolumeContext(systemId, designBookId);
    if ('error' in context)
        return res.status(context.error.code === 'NOT_FOUND' ? 404 : 409).json({ error: context.error });
    if (mediaId) {
        const selected = await profileRevision('lss_biological_media_profiles', mediaId);
        const waterCompatible = selected.water_types.includes(context.system_water_type)
            || selected.water_types.includes('Universal');
        const reactorCompatible = !reactorType || selected.reactor_types.includes(reactorType);
        if (!waterCompatible || !reactorCompatible) {
            return res.status(409).json({
                error: {
                    code: 'PROFILE_INCOMPATIBLE',
                    message: !waterCompatible
                        ? `The selected media profile is not approved for ${context.system_water_type || 'this system water type'}.`
                        : `The selected media profile is not approved for reactor type ${reactorType}.`,
                },
            });
        }
    }
    const status = context.status === 'blocked' || !reactorType || !mediaId || !tanId ? (context.status === 'blocked' ? 'Blocked' : 'Incomplete') : 'Draft';
    try {
        const result = await (0, db_1.query)(`INSERT INTO lss_biological_media_cases
       (system_id, design_book_id, reactor_type, media_profile_revision_id, tan_generation_profile_revision_id, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (system_id, design_book_id) DO UPDATE SET
         reactor_type=EXCLUDED.reactor_type,
         media_profile_revision_id=EXCLUDED.media_profile_revision_id,
         tan_generation_profile_revision_id=EXCLUDED.tan_generation_profile_revision_id,
         status=EXCLUDED.status, notes=EXCLUDED.notes, updated_at=NOW()
       RETURNING *`, [systemId, designBookId, reactorType, mediaId, tanId, status, text(req.body.notes), req.user.id]);
        res.json(await caseResponse(systemId, designBookId));
    }
    catch (error) {
        const mapped = databaseProfileError(error);
        if (mapped)
            return res.status(mapped.code === 'IMMUTABLE_REVISION' ? 409 : 400).json({ error: mapped });
        throw error;
    }
});
router.get('/biological-media/media-profiles', async (_req, res) => {
    const includeRetired = _req.query.include_retired === 'true';
    const result = await (0, db_1.query)(`SELECT * FROM lss_biological_media_profiles
     ${includeRetired ? '' : "WHERE status <> 'Retired'"} ORDER BY profile_code, revision DESC`);
    res.json({ items: result.rows });
});
router.get('/biological-media/tan-profiles', async (req, res) => {
    const includeRetired = req.query.include_retired === 'true';
    const result = await (0, db_1.query)(`SELECT * FROM lss_tan_generation_profiles
     ${includeRetired ? '' : "WHERE status <> 'Retired'"} ORDER BY profile_code, revision DESC`);
    res.json({ items: result.rows });
});
router.post('/admin/biological-media/media-profiles', (0, auth_1.requireModuleManage)('design_books'), (0, auth_1.requireRole)('admin'), async (req, res) => {
    const errors = validateMediaProfile(req.body, false);
    if (errors.length)
        return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
    const code = text(req.body.profile_code);
    const revision = await nextRevision('lss_biological_media_profiles', code);
    try {
        const result = await (0, db_1.query)(`INSERT INTO lss_biological_media_profiles
       (profile_code, profile_name, revision, water_types, reactor_types, capacity_model, capacity_model_version,
        capacity_basis_unit, operating_min_temperature_c, operating_max_temperature_c, operating_min_salinity_ppt,
        operating_max_salinity_ppt, media_min_depth_mm, media_max_depth_mm, media_void_fraction,
        media_bulk_density_kg_m3, evidence_reference, is_provisional, provisional_label, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`, [code, text(req.body.profile_name), revision, arrayOfText(req.body.water_types), arrayOfText(req.body.reactor_types),
            text(req.body.capacity_model), text(req.body.capacity_model_version), text(req.body.capacity_basis_unit),
            ...['operating_min_temperature_c', 'operating_max_temperature_c', 'operating_min_salinity_ppt', 'operating_max_salinity_ppt',
                'media_min_depth_mm', 'media_max_depth_mm', 'media_void_fraction', 'media_bulk_density_kg_m3'].map(field => numberOrNull(req.body[field])),
            text(req.body.evidence_reference), !!req.body.is_provisional, text(req.body.provisional_label),
            'Draft', text(req.body.notes), req.user.id]);
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        const mapped = databaseProfileError(error);
        if (mapped)
            return res.status(400).json({ error: mapped });
        throw error;
    }
});
router.post('/admin/biological-media/media-profiles/:id/revisions', (0, auth_1.requireModuleManage)('design_books'), (0, auth_1.requireRole)('admin'), async (req, res) => {
    const source = await profileRevision('lss_biological_media_profiles', routeParam(req.params.id));
    if (!source)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Media profile revision not found.' } });
    const body = { ...source, ...req.body, profile_code: source.profile_code };
    const errors = validateMediaProfile(body, false);
    if (errors.length)
        return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
    const revision = await nextRevision('lss_biological_media_profiles', body.profile_code);
    const result = await (0, db_1.query)(`INSERT INTO lss_biological_media_profiles
     (profile_code, profile_name, revision, water_types, reactor_types, capacity_model, capacity_model_version,
      capacity_basis_unit, operating_min_temperature_c, operating_max_temperature_c, operating_min_salinity_ppt,
      operating_max_salinity_ppt, media_min_depth_mm, media_max_depth_mm, media_void_fraction,
      media_bulk_density_kg_m3, evidence_reference, is_provisional, provisional_label, status, notes, supersedes_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'Draft',$20,$21,$22) RETURNING *`, [body.profile_code, text(body.profile_name), revision, arrayOfText(body.water_types), arrayOfText(body.reactor_types),
        text(body.capacity_model), text(body.capacity_model_version), text(body.capacity_basis_unit),
        ...['operating_min_temperature_c', 'operating_max_temperature_c', 'operating_min_salinity_ppt', 'operating_max_salinity_ppt',
            'media_min_depth_mm', 'media_max_depth_mm', 'media_void_fraction', 'media_bulk_density_kg_m3'].map(field => numberOrNull(body[field])),
        text(body.evidence_reference), !!body.is_provisional, text(body.provisional_label), text(body.notes), source.id, req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.post('/admin/biological-media/tan-profiles', (0, auth_1.requireModuleManage)('design_books'), (0, auth_1.requireRole)('admin'), async (req, res) => {
    const errors = validateTanProfile(req.body);
    if (errors.length)
        return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
    const code = text(req.body.profile_code);
    const revision = await nextRevision('lss_tan_generation_profiles', code);
    const result = await (0, db_1.query)(`INSERT INTO lss_tan_generation_profiles
     (profile_code, profile_name, revision, coefficient, coefficient_unit, scope_type, scope_unit, scope_min,
      scope_max, evidence_reference, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [code, text(req.body.profile_name), revision, numberOrNull(req.body.coefficient), text(req.body.coefficient_unit),
        text(req.body.scope_type), text(req.body.scope_unit), numberOrNull(req.body.scope_min), numberOrNull(req.body.scope_max),
        text(req.body.evidence_reference), 'Draft',
        text(req.body.notes), req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.post('/admin/biological-media/tan-profiles/:id/revisions', (0, auth_1.requireModuleManage)('design_books'), (0, auth_1.requireRole)('admin'), async (req, res) => {
    const source = await profileRevision('lss_tan_generation_profiles', routeParam(req.params.id));
    if (!source)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'TAN profile revision not found.' } });
    const body = { ...source, ...req.body, profile_code: source.profile_code };
    const errors = validateTanProfile(body);
    if (errors.length)
        return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
    const revision = await nextRevision('lss_tan_generation_profiles', body.profile_code);
    const result = await (0, db_1.query)(`INSERT INTO lss_tan_generation_profiles
     (profile_code, profile_name, revision, coefficient, coefficient_unit, scope_type, scope_unit, scope_min,
      scope_max, evidence_reference, status, notes, supersedes_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Draft',$11,$12,$13) RETURNING *`, [body.profile_code, text(body.profile_name), revision, numberOrNull(body.coefficient), text(body.coefficient_unit),
        text(body.scope_type), text(body.scope_unit), numberOrNull(body.scope_min), numberOrNull(body.scope_max),
        text(body.evidence_reference), text(body.notes), source.id, req.user.id]);
    res.status(201).json(result.rows[0]);
});
async function updateProfileStatus(table, id, body, req, res) {
    const existing = await profileRevision(table, id);
    if (!existing)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Profile revision not found.' } });
    const requestedStatus = text(body.status);
    if (existing.status === 'Retired' || (existing.status === 'Approved' && requestedStatus !== 'Retired')) {
        return res.status(409).json({ error: { code: 'IMMUTABLE_REVISION', message: 'Approved or retired revisions cannot be edited; create a new revision instead.' } });
    }
    const nextStatus = requestedStatus;
    if (!nextStatus || !PROFILE_STATUSES.includes(nextStatus))
        return res.status(400).json({ error: { code: 'VALIDATION', message: `Status must be one of: ${PROFILE_STATUSES.join(', ')}.` } });
    const merged = { ...existing, ...body, status: nextStatus };
    const errors = table.includes('tan_') ? validateTanProfile(merged) : validateMediaProfile(merged, nextStatus === 'Approved');
    if (nextStatus === 'Approved' && errors.length)
        return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
    try {
        const result = await (0, db_1.query)(`UPDATE ${table} SET status=$1, approved_by=CASE WHEN $1='Approved' THEN $2 ELSE approved_by END,
       approved_at=CASE WHEN $1='Approved' THEN NOW() ELSE approved_at END,
       retired_at=CASE WHEN $1='Retired' THEN NOW() ELSE retired_at END, updated_at=NOW()
       WHERE id=$3 RETURNING *`, [nextStatus, req.user.id, id]);
        return res.json(result.rows[0]);
    }
    catch (error) {
        const mapped = databaseProfileError(error);
        if (mapped)
            return res.status(409).json({ error: mapped });
        throw error;
    }
}
router.patch('/admin/biological-media/media-profiles/:id/status', (0, auth_1.requireModuleManage)('design_books'), (0, auth_1.requireRole)('admin'), async (req, res) => updateProfileStatus('lss_biological_media_profiles', routeParam(req.params.id), req.body, req, res));
router.patch('/admin/biological-media/tan-profiles/:id/status', (0, auth_1.requireModuleManage)('design_books'), (0, auth_1.requireRole)('admin'), async (req, res) => updateProfileStatus('lss_tan_generation_profiles', routeParam(req.params.id), req.body, req, res));
exports.default = router;
