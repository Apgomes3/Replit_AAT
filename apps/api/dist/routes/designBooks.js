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
exports.versionSnapshotTestUtils = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const index_1 = __importStar(require("../db/index"));
const crypto_1 = __importDefault(require("crypto"));
const audit_1 = require("../db/audit");
const designBookRelease_1 = require("../lib/designBookRelease");
const designBookWorkflow_1 = require("../lib/designBookWorkflow");
const aquariumCalculations_1 = require("../lib/aquariumCalculations");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('design_books'));
const routeParam = (value) => Array.isArray(value) ? value[0] : value;
async function insertAudit(runner, actorId, entityType, entityId, action, details, ipAddress) {
    await runner(`INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6)`, [entityType, entityId, action, actorId, details, ipAddress || null]);
}
async function loadReleaseContext(id, runner = index_1.query, lock = false, liveOnly = false) {
    const bookResult = await runner(`SELECT db.*, p.project_scopes, p.project_code, p.project_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     WHERE db.id = $1${lock ? ' FOR UPDATE OF db' : ''}`, [id]);
    const book = bookResult.rows[0];
    if (!book)
        return null;
    let exhibits = [];
    let tanks = [];
    let systems = [];
    if (book.project_id) {
        const exhibitResult = await runner('SELECT * FROM exhibits WHERE project_id=$1 ORDER BY exhibit_code', [book.project_id]);
        const tankResult = await runner(`SELECT t.*,
         t.gross_volume_m3 AS project_gross_volume_m3,
         t.operating_volume_m3 AS project_operating_volume_m3,
         pm.product_code AS pim_product_code,
         pm.product_name AS pim_product_name,
         tf.name AS pim_tank_family_name,
         COALESCE(t.tank_type, pm.application_type) AS eff_tank_type,
         COALESCE(t.shape_type, pm.shape_type) AS eff_shape,
         COALESCE(t.length_mm, pm.length_mm) AS eff_length_mm,
         COALESCE(t.width_mm, pm.width_mm) AS eff_width_mm,
         COALESCE(t.height_mm, pm.height_mm) AS eff_height_mm,
         COALESCE(t.design_water_level_mm, pm.design_water_level_mm) AS eff_water_level_mm,
         COALESCE(t.primary_material, pm.primary_material_code) AS eff_primary_material,
         COALESCE(t.notes, pm.notes) AS eff_notes,
         COALESCE(t.gross_volume_m3, pm.gross_volume_m3) AS gross_volume_m3,
         COALESCE(t.operating_volume_m3, pm.operating_volume_m3) AS design_volume_m3,
         COALESCE(t.surface_area_m2, pm.surface_area_m2) AS surface_area_m2
       FROM tanks t
       LEFT JOIN product_masters pm ON pm.id=t.product_master_id
       LEFT JOIN tank_families tf ON tf.id=pm.tank_family_id
       WHERE t.project_id=$1
       ORDER BY t.tank_code`, [book.project_id]);
        const systemResult = await runner('SELECT * FROM systems WHERE project_id=$1 ORDER BY system_code', [book.project_id]);
        exhibits = exhibitResult.rows;
        tanks = tankResult.rows;
        systems = systemResult.rows;
    }
    const speciesResult = await runner('SELECT * FROM design_book_exhibit_species WHERE design_book_id=$1 ORDER BY exhibit_id, sort_order', [id]);
    const hydraulicsResult = await runner('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1', [id]);
    const substrateResult = await runner('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1', [id]);
    const species = speciesResult.rows;
    const hydraulics = hydraulicsResult.rows;
    const substrate = substrateResult.rows;
    const handovers = (await runner(`SELECT h.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_review_handovers h
     LEFT JOIN users u ON u.id=h.created_by
     WHERE h.design_book_id=$1
     ORDER BY h.meeting_date DESC, h.created_at DESC`, [id])).rows;
    const calculatedAt = new Date().toISOString();
    const exhibitCalculations = exhibits.map(exhibit => (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, tanks.filter(tank => tank.exhibit_id === exhibit.id), hydraulics.find(record => record.exhibit_id === exhibit.id), substrate.find(record => record.exhibit_id === exhibit.id), calculatedAt));
    let links = [];
    if (systems.length) {
        const linksResult = await runner('SELECT sel.*, e.exhibit_code FROM system_exhibit_links sel LEFT JOIN exhibits e ON e.id=sel.exhibit_id WHERE sel.system_id = ANY($1::uuid[])', [systems.map(system => system.id)]);
        links = linksResult.rows;
    }
    const compactUnitIds = systems.map(system => system.compact_unit_id).filter(Boolean);
    const compactUnits = compactUnitIds.length
        ? (await runner('SELECT * FROM lss_compact_units WHERE id = ANY($1::uuid[])', [compactUnitIds])).rows
        : [];
    const systemCalculations = systems.map(system => (0, aquariumCalculations_1.calculateSystemEngineering)(system, links.filter(link => link.system_id === system.id), exhibitCalculations, compactUnits.find(unit => unit.id === system.compact_unit_id) || null, calculatedAt));
    const liveContext = {
        ...book,
        exhibits,
        tanks,
        systems,
        system_links: links,
        species,
        hydraulics,
        substrate,
        review_handovers: handovers,
        engineering_calculations: {
            calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            calculated_at: calculatedAt,
            exhibits: exhibitCalculations,
            systems: systemCalculations,
        },
    };
    if (!liveOnly && ['For Review', 'Approved'].includes(book.status) && book.review_snapshot) {
        return {
            ...book.review_snapshot,
            id: book.id,
            book_code: book.book_code,
            book_title: book.book_title,
            revision: book.revision,
            status: book.status,
            review_submitted_by: book.review_submitted_by,
            review_submitted_at: book.review_submitted_at,
            approved_by: book.approved_by,
            approved_at: book.approved_at,
            approval_notes: book.approval_notes,
            review_snapshot: book.review_snapshot,
        };
    }
    return liveContext;
}
async function ensureBookEditable(id, res) {
    const result = await (0, index_1.query)('SELECT status FROM design_books WHERE id=$1', [id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        return false;
    }
    if (!(0, designBookWorkflow_1.isDesignBookContentEditable)(result.rows[0].status)) {
        res.status(409).json({
            error: {
                code: 'DESIGN_BOOK_NOT_EDITABLE',
                message: 'Design Books are read-only while under review, approved, or released. Create a new revision or return to design before editing.',
            },
        });
        return false;
    }
    return true;
}
router.get('/design-books', auth_1.authenticate, async (req, res) => {
    const q = req.query.q;
    const projectId = req.query.project_id;
    const params = [];
    const filters = [];
    if (q) {
        params.push(`%${q}%`);
        filters.push(`(db.book_code ILIKE $${params.length} OR db.book_title ILIKE $${params.length} OR p.project_name ILIKE $${params.length})`);
    }
    if (projectId) {
        params.push(projectId);
        filters.push(`db.project_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await (0, index_1.query)(`SELECT db.*, p.project_code, p.project_name, p.client_name,
       u.first_name || ' ' || u.last_name as created_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
     ${where}
     ORDER BY db.created_at DESC`, params);
    res.json({ items: result.rows });
});
router.get('/design-books/:id', auth_1.authenticate, async (req, res) => {
    const book = await (0, index_1.query)(`SELECT db.*, p.project_code, p.project_name, p.client_name, p.site_name, p.country, p.project_scopes,
       u.first_name || ' ' || u.last_name as created_by_name,
       ru.first_name || ' ' || ru.last_name as released_by_name,
       su.first_name || ' ' || su.last_name as review_submitted_by_name,
       au.first_name || ' ' || au.last_name as approved_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
     LEFT JOIN users ru ON db.released_by = ru.id
     LEFT JOIN users su ON db.review_submitted_by = su.id
     LEFT JOIN users au ON db.approved_by = au.id
     WHERE db.id = $1`, [req.params.id]);
    if (!book.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const row = book.rows[0];
    let exhibits = [];
    let tanks = [];
    let systems = [];
    let species = [];
    if (row.project_id) {
        const exResult = await (0, index_1.query)(`SELECT e.*, a.area_name, a.area_code
       FROM exhibits e
       LEFT JOIN areas a ON e.area_id = a.id
       WHERE e.project_id = $1
       ORDER BY a.area_code, e.exhibit_code`, [row.project_id]);
        exhibits = exResult.rows;
        const tkResult = await (0, index_1.query)(`SELECT t.*,
        t.gross_volume_m3 as project_gross_volume_m3,
        t.operating_volume_m3 as project_operating_volume_m3,
        e.exhibit_name, e.water_type as exhibit_water_type,
        s.system_code, s.system_name,
        pm.product_code, pm.product_name as product_name,
         pm.product_code as pim_product_code,
         pm.product_name as pim_product_name,
         tf.name as pim_tank_family_name,
         COALESCE(t.tank_type, pm.application_type) as eff_tank_type,
         COALESCE(t.primary_material, pm.primary_material_code) as eff_primary_material,
         COALESCE(t.notes, pm.notes) as eff_notes,
        promoted_pm.id as promoted_product_master_id,
        promoted_pm.product_code as promoted_product_code,
        mat.material_code, mat.material_name,
        COALESCE(t.shape_type, pm.shape_type) as eff_shape,
        COALESCE(t.length_mm, pm.length_mm) as eff_length_mm,
        COALESCE(t.width_mm, pm.width_mm) as eff_width_mm,
        COALESCE(t.height_mm, pm.height_mm) as eff_height_mm,
        COALESCE(t.design_water_level_mm, pm.design_water_level_mm) as eff_water_level_mm,
        COALESCE(
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.height_mm, pm.height_mm) / 1000000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) IS DISTINCT FROM 'Cylindrical'
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0)::numeric, 4)
            ELSE NULL
          END,
          t.gross_volume_m3, pm.gross_volume_m3
        ) as gross_volume_m3,
        COALESCE(
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.design_water_level_mm, pm.design_water_level_mm) / 1000000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) IS DISTINCT FROM 'Cylindrical'
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0)::numeric, 4)
            ELSE NULL
          END,
          t.operating_volume_m3, pm.operating_volume_m3
        ) as design_volume_m3,
        COALESCE(
          t.surface_area_m2,
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) / 1000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) IS DISTINCT FROM 'Custom'
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)/1000000.0)::numeric, 4)
            ELSE NULL
          END,
          pm.surface_area_m2
        ) as surface_area_m2
       FROM tanks t
       LEFT JOIN exhibits e ON t.exhibit_id = e.id
       LEFT JOIN systems s ON t.system_id = s.id
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
        LEFT JOIN tank_families tf ON tf.id = pm.tank_family_id
       LEFT JOIN product_masters promoted_pm ON promoted_pm.source_tank_id = t.id
       LEFT JOIN materials mat ON t.material_id = mat.id
       WHERE t.project_id = $1
       ORDER BY e.exhibit_code NULLS LAST, t.sort_order, t.tank_code`, [row.project_id]);
        tanks = tkResult.rows;
        const sysResult = await (0, index_1.query)(`SELECT s.*,
         e.exhibit_code, e.exhibit_name,
         a.area_code, a.area_name,
         (SELECT COUNT(*) FROM equipment_instances ei WHERE ei.system_id = s.id) as equipment_count
       FROM systems s
       LEFT JOIN exhibits e ON s.exhibit_id = e.id
       LEFT JOIN areas a ON s.area_id = a.id
       WHERE s.project_id = $1
       ORDER BY a.area_code NULLS LAST, e.exhibit_code NULLS LAST, s.system_code`, [row.project_id]);
        systems = sysResult.rows;
    }
    const speciesResult = await (0, index_1.query)(`SELECT * FROM design_book_exhibit_species WHERE design_book_id = $1 ORDER BY exhibit_id, sort_order, species_name`, [req.params.id]);
    species = speciesResult.rows;
    const hydraulicsResult = await (0, index_1.query)(`SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id = $1`, [req.params.id]);
    const hydraulics = hydraulicsResult.rows;
    const substrateResult = await (0, index_1.query)(`SELECT * FROM design_book_exhibit_substrate WHERE design_book_id = $1`, [req.params.id]);
    const substrate = substrateResult.rows;
    // All design-book hydraulic and LSS values are calculated here from the
    // current project inputs.  Consumers receive the inputs and policy along
    // with the values, so they do not need to reproduce engineering formulas.
    const calculationTimestamp = new Date().toISOString();
    const exhibitCalculations = exhibits.map(exhibit => {
        const hydraulic = hydraulics.find(h => h.exhibit_id === exhibit.id);
        const substrateRecord = substrate.find(s => s.exhibit_id === exhibit.id);
        return (0, aquariumCalculations_1.calculateExhibitHydraulics)(exhibit, tanks.filter(tank => tank.exhibit_id === exhibit.id), hydraulic, substrateRecord, calculationTimestamp);
    });
    let systemLinks = [];
    if (systems.length > 0) {
        const linkResult = await (0, index_1.query)(`SELECT sel.*, e.exhibit_code
       FROM system_exhibit_links sel
       LEFT JOIN exhibits e ON e.id = sel.exhibit_id
       WHERE sel.system_id = ANY($1::uuid[])`, [systems.map(system => system.id)]);
        systemLinks = linkResult.rows;
    }
    const compactUnitIds = systems
        .map(system => system.compact_unit_id)
        .filter(Boolean);
    const compactUnits = compactUnitIds.length > 0
        ? (await (0, index_1.query)('SELECT * FROM lss_compact_units WHERE id = ANY($1::uuid[])', [compactUnitIds])).rows
        : [];
    const systemCalculations = systems.map(system => (0, aquariumCalculations_1.calculateSystemEngineering)(system, systemLinks.filter(link => link.system_id === system.id), exhibitCalculations, compactUnits.find(unit => unit.id === system.compact_unit_id) || null, calculationTimestamp));
    const livePackage = {
        exhibits,
        tanks,
        systems,
        species,
        hydraulics,
        substrate,
        engineering_calculations: {
            calculation_version: aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            calculated_at: calculationTimestamp,
            policy: {
                turnover_unit: 'cycles_per_hour',
                flow_unit: 'm3_per_hour',
                allocation_tolerance_pct: 0.01,
                volume_definition: 'operating water volume less substrate and theming displacement',
                rounding: 'volumes to 4 decimals m³; flows to 3 decimals m³/h',
            },
            exhibits: exhibitCalculations,
            systems: systemCalculations,
        },
    };
    const releasedPackage = row.status === 'Released' && row.release_snapshot
        ? row.release_snapshot
        : ['For Review', 'Approved'].includes(row.status) && row.review_snapshot
            ? row.review_snapshot
            : livePackage;
    res.json({
        ...row,
        ...releasedPackage,
        id: row.id,
        book_code: row.book_code,
        book_title: row.book_title,
        revision: row.revision,
        status: row.status,
        release_scope: row.release_scope,
        release_notes: row.release_notes,
        released_by_name: row.released_by_name,
        released_at: row.released_at,
    });
});
router.get('/design-books/:id/release-preflight', auth_1.authenticate, async (req, res) => {
    const context = await loadReleaseContext(routeParam(req.params.id));
    if (!context)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)(context);
    res.json({
        design_book_id: req.params.id,
        status: context.status,
        revision: context.revision,
        checklist,
        blockers: (0, designBookRelease_1.releaseBlockers)(checklist),
    });
});
router.post('/design-books', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { book_code, book_title, project_id, description, revision, status, notes } = req.body;
    if (!book_code || !book_title)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'book_code and book_title are required' } });
    if (status && status !== 'Draft') {
        return res.status(400).json({
            error: { code: 'WORKFLOW_ACTION_REQUIRED', message: 'New Design Books must start as Draft.' },
        });
    }
    const result = await (0, index_1.query)(`INSERT INTO design_books (book_code, book_title, project_id, description, revision, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [book_code, book_title, project_id || null, description || null, revision || 'A', 'Draft', notes || null, req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.put('/design-books/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { book_title, project_id, description, revision, status, notes } = req.body;
    const existing = await (0, index_1.query)('SELECT status FROM design_books WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (status && status !== existing.rows[0].status) {
        return res.status(400).json({
            error: { code: 'WORKFLOW_ACTION_REQUIRED', message: 'Use the Design Book review, approval, or release action to change workflow status.' },
        });
    }
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const result = await (0, index_1.query)(`UPDATE design_books SET book_title=$1, project_id=$2, description=$3, revision=$4, status=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 AND status <> 'Released' RETURNING *`, [book_title, project_id || null, description || null, revision || 'A', existing.rows[0].status, notes || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    res.json(result.rows[0]);
});
router.delete('/design-books/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const result = await (0, index_1.query)(`DELETE FROM design_books
     WHERE id=$1 AND status <> 'Released'
     RETURNING id`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    res.json({ deleted: true });
});
// Species CRUD
router.post('/design-books/:id/species', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const { exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order } = req.body;
    if (!exhibit_id || !species_name)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id and species_name are required' } });
    const result = await (0, index_1.query)(`INSERT INTO design_book_exhibit_species (design_book_id, exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.params.id, exhibit_id, species_name, common_name || null, quantity || null, avg_size_cm || null, biomass_kg || null, notes || null, sort_order || 0]);
    res.status(201).json(result.rows[0]);
});
router.put('/design-books/:id/species/:speciesId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const { species_name, common_name, quantity, avg_size_cm, biomass_kg, notes } = req.body;
    const result = await (0, index_1.query)(`UPDATE design_book_exhibit_species SET species_name=$1, common_name=$2, quantity=$3, avg_size_cm=$4, biomass_kg=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 AND design_book_id=$8 RETURNING *`, [species_name, common_name || null, quantity || null, avg_size_cm || null, biomass_kg || null, notes || null, req.params.speciesId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
    res.json(result.rows[0]);
});
router.put('/design-books/:id/exhibits/:exhibitId/substrate', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const { substrate_type, substrate_height_mm, substrate_volume_m3, theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes } = req.body;
    for (const [label, value] of [
        ['Substrate height', substrate_height_mm],
        ['Substrate volume', substrate_volume_m3],
        ['Theming height', theming_height_mm],
        ['Theming volume', theming_volume_m3],
        ['Theming percentage', theming_volume_pct],
    ]) {
        if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number.` } });
        }
    }
    if (theming_volume_pct != null && Number(theming_volume_pct) > 100) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Theming percentage cannot exceed 100%.' } });
    }
    const tankVolumeResult = await (0, index_1.query)(`SELECT SUM(COALESCE(t.operating_volume_m3, pm.operating_volume_m3, 0) * COALESCE(t.quantity, 1)) AS volume_m3
     FROM tanks t
     LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     WHERE t.exhibit_id=$1`, [req.params.exhibitId]);
    const grossOperatingVolume = Number(tankVolumeResult.rows[0]?.volume_m3);
    if (theming_volume_pct != null && !(grossOperatingVolume > 0)) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'A known tank operating volume is required to use percentage-based theming displacement.' },
        });
    }
    const resolvedThemingVolume = theming_volume_pct != null
        ? Math.round(grossOperatingVolume * Number(theming_volume_pct) / 100 * 1e6) / 1e6
        : (theming_volume_m3 ?? null);
    const displacement = Number(substrate_volume_m3 || 0) + Number(resolvedThemingVolume || 0);
    if (grossOperatingVolume > 0 && displacement >= grossOperatingVolume) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'Substrate and theming displacement must be less than operating volume.' },
        });
    }
    const result = await (0, index_1.query)(`INSERT INTO design_book_exhibit_substrate
       (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3, theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       substrate_type      = EXCLUDED.substrate_type,
       substrate_height_mm = EXCLUDED.substrate_height_mm,
       substrate_volume_m3 = EXCLUDED.substrate_volume_m3,
       theming_type        = EXCLUDED.theming_type,
       theming_height_mm   = EXCLUDED.theming_height_mm,
       theming_volume_m3   = EXCLUDED.theming_volume_m3,
       theming_volume_pct  = EXCLUDED.theming_volume_pct,
       notes               = EXCLUDED.notes,
       updated_at          = NOW()
     RETURNING *`, [req.params.id, req.params.exhibitId,
        substrate_type || null, substrate_height_mm ?? null, substrate_volume_m3 ?? null,
        theming_type || null, theming_height_mm ?? null, resolvedThemingVolume,
        theming_volume_pct ?? null, notes || null]);
    res.json(result.rows[0]);
});
router.put('/design-books/:id/exhibits/:exhibitId/hydraulics', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const { target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes, weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions, weir_discharge_condition, weir_downstream_head_mm, } = req.body;
    const hasField = (field) => Object.prototype.hasOwnProperty.call(req.body, field);
    const hasWeirHead = hasField('weir_head_mm');
    const hasWeirLength = hasField('weir_length_mm');
    const hasWeirMethod = hasField('weir_formula_method');
    const hasWeirGeometry = hasField('weir_geometry');
    const hasWeirContractions = hasField('weir_end_contractions');
    const hasWeirDischarge = hasField('weir_discharge_condition');
    const hasWeirDownstreamHead = hasField('weir_downstream_head_mm');
    if (weir_formula_method != null && !['francis_184', 'bazin_1888'].includes(weir_formula_method)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unsupported weir formula method' } });
    }
    if (weir_geometry != null && weir_geometry !== 'sharp_rectangular') {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Only sharp-crested rectangular weirs are supported' } });
    }
    if (weir_end_contractions != null &&
        (!Number.isInteger(Number(weir_end_contractions)) || Number(weir_end_contractions) < 0 || Number(weir_end_contractions) > 2)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir end contractions must be 0, 1, or 2' } });
    }
    if (weir_discharge_condition != null && !['free', 'submerged'].includes(weir_discharge_condition)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unsupported weir discharge condition' } });
    }
    if (weir_head_mm != null && (!Number.isFinite(Number(weir_head_mm)) || Number(weir_head_mm) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir head must be a non-negative number' } });
    }
    if (weir_length_mm != null && (!Number.isFinite(Number(weir_length_mm)) || Number(weir_length_mm) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir length must be a non-negative number' } });
    }
    if (weir_downstream_head_mm != null &&
        (!Number.isFinite(Number(weir_downstream_head_mm)) || Number(weir_downstream_head_mm) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Downstream head must be a non-negative number' } });
    }
    const numericFields = [
        ['target turnover rate', target_turnover_rate],
        ['surface skim percentage', surface_skim_pct],
        ['bottom drain percentage', bottom_drain_pct],
    ];
    for (const [label, value] of numericFields) {
        if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number` } });
        }
    }
    if (target_turnover_rate != null && Number(target_turnover_rate) === 0) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Target turnover rate must be greater than zero' } });
    }
    const savedSurfacePct = surface_skim_pct ?? 30;
    const savedBottomPct = bottom_drain_pct ?? 70;
    if (Number(savedSurfacePct) > 100 || Number(savedBottomPct) > 100 ||
        Math.abs(Number(savedSurfacePct) + Number(savedBottomPct) - 100) > aquariumCalculations_1.ALLOCATION_TOLERANCE_PCT) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: `Surface and bottom allocations must total 100% ± ${aquariumCalculations_1.ALLOCATION_TOLERANCE_PCT}%.` },
        });
    }
    const result = await (0, index_1.query)(`INSERT INTO design_book_exhibit_hydraulics
       (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
        weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
        weir_discharge_condition, weir_downstream_head_mm,
        calculation_version, last_calculated_at, calculation_inputs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        '${aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION}',NOW(),$21)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       target_turnover_rate = EXCLUDED.target_turnover_rate,
       surface_skim_pct     = EXCLUDED.surface_skim_pct,
       bottom_drain_pct     = EXCLUDED.bottom_drain_pct,
       notes                = EXCLUDED.notes,
       weir_head_mm = CASE WHEN $14 THEN EXCLUDED.weir_head_mm ELSE design_book_exhibit_hydraulics.weir_head_mm END,
       weir_length_mm = CASE WHEN $15 THEN EXCLUDED.weir_length_mm ELSE design_book_exhibit_hydraulics.weir_length_mm END,
       weir_formula_method = CASE WHEN $16 THEN EXCLUDED.weir_formula_method ELSE design_book_exhibit_hydraulics.weir_formula_method END,
       weir_geometry = CASE WHEN $17 THEN EXCLUDED.weir_geometry ELSE design_book_exhibit_hydraulics.weir_geometry END,
       weir_end_contractions = CASE WHEN $18 THEN EXCLUDED.weir_end_contractions ELSE design_book_exhibit_hydraulics.weir_end_contractions END,
       weir_discharge_condition = CASE WHEN $19 THEN EXCLUDED.weir_discharge_condition ELSE design_book_exhibit_hydraulics.weir_discharge_condition END,
       weir_downstream_head_mm = CASE WHEN $20 THEN EXCLUDED.weir_downstream_head_mm ELSE design_book_exhibit_hydraulics.weir_downstream_head_mm END,
       calculation_version   = EXCLUDED.calculation_version,
       last_calculated_at    = EXCLUDED.last_calculated_at,
       calculation_inputs    = EXCLUDED.calculation_inputs,
       updated_at           = NOW()
     RETURNING *`, [req.params.id, req.params.exhibitId,
        target_turnover_rate ?? null, savedSurfacePct, savedBottomPct,
        notes ?? null, weir_head_mm ?? null, weir_length_mm ?? null, weir_formula_method ?? null,
        weir_geometry ?? null, weir_end_contractions ?? null,
        weir_discharge_condition ?? null, weir_downstream_head_mm ?? null,
        hasWeirHead, hasWeirLength, hasWeirMethod, hasWeirGeometry, hasWeirContractions,
        hasWeirDischarge, hasWeirDownstreamHead,
        JSON.stringify({
            target_turnover_rate: target_turnover_rate ?? null,
            surface_skim_pct: savedSurfacePct,
            bottom_drain_pct: savedBottomPct,
            turnover_unit: 'cycles_per_hour',
            flow_unit: 'm3_per_hour',
            weir_head_unit: 'mm',
            weir_length_unit: 'mm',
        })]);
    res.json(result.rows[0]);
});
router.delete('/design-books/:id/species/:speciesId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    if (!await ensureBookEditable(routeParam(req.params.id), res))
        return;
    const result = await (0, index_1.query)('DELETE FROM design_book_exhibit_species WHERE id=$1 AND design_book_id=$2 RETURNING id', [req.params.speciesId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
    res.json({ deleted: true });
});
router.get('/design-books/:id/review-handovers', auth_1.authenticate, async (req, res) => {
    const result = await (0, index_1.query)(`SELECT h.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_review_handovers h
     LEFT JOIN users u ON u.id=h.created_by
     WHERE h.design_book_id=$1
     ORDER BY h.meeting_date DESC, h.created_at DESC`, [req.params.id]);
    res.json({ items: result.rows });
});
router.post('/design-books/:id/review-handovers', auth_1.authenticate, (0, auth_1.requireRole)(...Array.from(new Set([...designBookWorkflow_1.DESIGN_BOOK_DESIGNER_ROLES, ...designBookWorkflow_1.DESIGN_BOOK_MANAGER_ROLES]))), async (req, res) => {
    const { meeting_date, title, attendees, purpose, discussion_summary, decisions, action_items, open_items, acceptance_notes, } = req.body;
    const attendeeList = Array.isArray(attendees)
        ? attendees.map((value) => String(value).trim()).filter(Boolean)
        : String(attendees || '').split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    if (!meeting_date || !title?.trim()) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'Meeting date and report title are required.' },
        });
    }
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const bookResult = await client.query('SELECT status, review_snapshot FROM design_books WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!bookResult.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (bookResult.rows[0].status !== 'For Review') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'INVALID_HANDOVER_STATE', message: 'Handover reports can only be recorded while a Design Book is For Review.' },
            });
        }
        const result = await client.query(`INSERT INTO design_book_review_handovers
           (design_book_id, meeting_date, title, attendees, purpose, discussion_summary,
            decisions, action_items, open_items, acceptance_notes, created_by)
         VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`, [
            req.params.id, meeting_date, title.trim(), attendeeList, purpose || null,
            discussion_summary || null, decisions || null, action_items || null,
            open_items || null, acceptance_notes || null, req.user.id,
        ]);
        const reviewSnapshot = bookResult.rows[0].review_snapshot || {};
        const handovers = Array.isArray(reviewSnapshot.review_handovers)
            ? reviewSnapshot.review_handovers
            : [];
        await client.query('UPDATE design_books SET review_snapshot=$1::jsonb, updated_at=NOW() WHERE id=$2', [JSON.stringify({ ...reviewSnapshot, review_handovers: [...handovers, result.rows[0]] }), req.params.id]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'REVIEW_HANDOVER', {
            summary: `Review handover report recorded for ${meeting_date}`,
            handover_id: result.rows[0].id,
            title: title.trim(),
            meeting_date,
            attendees: attendeeList,
        }, req.ip);
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/submit-review', auth_1.authenticate, (0, auth_1.requireRole)(...designBookWorkflow_1.DESIGN_BOOK_DESIGNER_ROLES), async (req, res) => {
    const comment = String(req.body.comment || '').trim();
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true);
        if (!context || !(0, designBookWorkflow_1.isDesignBookContentEditable)(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'INVALID_TRANSITION', message: 'Only Draft or In Progress Design Books can be submitted for review.' },
            });
        }
        const previousStatus = context.status;
        const { release_snapshot: _releaseSnapshot, review_snapshot: _reviewSnapshot, ...reviewPackage } = context;
        const submittedAt = new Date().toISOString();
        const snapshot = {
            ...reviewPackage,
            status: 'For Review',
            review_submitted_by: req.user.id,
            review_submitted_at: submittedAt,
        };
        const result = await client.query(`UPDATE design_books
         SET status='For Review', review_submitted_by=$1, review_submitted_at=NOW(),
             review_snapshot=$2::jsonb, updated_at=NOW()
         WHERE id=$3 AND status IN ('Draft', 'In Progress')
         RETURNING *`, [req.user.id, JSON.stringify(snapshot), req.params.id]);
        if (!result.rows[0])
            throw new Error('Design Book status changed during review submission');
        await client.query(`INSERT INTO lifecycle_transitions
           (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('design_book',$1,$2,'For Review',$3,$4)`, [req.params.id, previousStatus, req.user.id, comment || null]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'SUBMIT_REVIEW', {
            summary: `Design Book submitted for review${comment ? `: ${comment}` : ''}`,
            comment,
        }, req.ip);
        await client.query('COMMIT');
        res.json(result.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/approve', auth_1.authenticate, (0, auth_1.requireRole)(...designBookWorkflow_1.DESIGN_BOOK_MANAGER_ROLES), async (req, res) => {
    const approvalNotes = String(req.body.approval_notes || '').trim();
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`UPDATE design_books
         SET status='Approved', approved_by=$1, approved_at=NOW(), approval_notes=$2, updated_at=NOW()
         WHERE id=$3 AND status='For Review'
         RETURNING *`, [req.user.id, approvalNotes || null, req.params.id]);
        if (!result.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'INVALID_TRANSITION', message: 'Only Design Books that are For Review can be approved.' },
            });
        }
        await client.query(`INSERT INTO lifecycle_transitions
           (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('design_book',$1,'For Review','Approved',$2,$3)`, [req.params.id, req.user.id, approvalNotes || null]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'APPROVE', {
            summary: `Design Book approved${approvalNotes ? `: ${approvalNotes}` : ''}`,
            approval_notes: approvalNotes,
        }, req.ip);
        await client.query('COMMIT');
        res.json(result.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/release', auth_1.authenticate, (0, auth_1.requireRole)(...designBookWorkflow_1.DESIGN_BOOK_MANAGER_ROLES), async (req, res) => {
    const { revision, included_scope, release_notes } = req.body;
    const scope = Array.isArray(included_scope)
        ? included_scope.map((value) => String(value).trim()).filter(Boolean)
        : [];
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (context.status === 'Released') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'ALREADY_RELEASED', message: 'This Design Book revision is already released.' },
            });
        }
        if (context.status !== 'Approved') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'APPROVAL_REQUIRED', message: 'The Design Book must be approved by a manager before release.' },
            });
        }
        const projectScope = Array.isArray(context.project_scopes) ? context.project_scopes : [];
        const confirmationError = (0, designBookRelease_1.validateReleaseConfirmation)({
            currentRevision: String(context.revision || '').trim(),
            confirmedRevision: String(revision || '').trim(),
            includedScope: scope,
            projectScope,
            releaseNotes: String(release_notes || '').trim(),
        });
        if (confirmationError) {
            await client.query('ROLLBACK');
            return res.status(confirmationError.status).json({ error: confirmationError });
        }
        const checklist = (0, designBookRelease_1.buildDesignBookReleaseChecklist)({ ...context, project_scopes: scope });
        const blockers = (0, designBookRelease_1.releaseBlockers)(checklist);
        const blockerError = (0, designBookRelease_1.validateReleaseBlockers)(blockers.length);
        if (blockerError) {
            await client.query('ROLLBACK');
            return res.status(blockerError.status).json({
                error: blockerError,
                checklist,
                blockers,
            });
        }
        const { release_snapshot: _existingSnapshot, release_scope: _existingScope, release_notes: _existingNotes, released_by: _existingReleaser, released_at: _existingReleasedAt, ...packageSnapshot } = context;
        const releasedAt = new Date().toISOString();
        const snapshot = {
            ...packageSnapshot,
            status: 'Released',
            released_revision: revision.trim(),
            included_scope: scope,
            release_notes: release_notes.trim(),
            released_by: req.user.id,
            released_at: releasedAt,
            release_checklist: checklist,
        };
        const updated = await client.query(`UPDATE design_books
         SET status='Released', revision=$1, release_scope=$2::text[], release_notes=$3,
             released_by=$4, released_at=NOW(), release_snapshot=$5::jsonb, updated_at=NOW()
         WHERE id=$6 AND status <> 'Released'
         RETURNING *`, [revision.trim(), scope, release_notes.trim(), req.user.id, JSON.stringify(snapshot), req.params.id]);
        if (!updated.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'ALREADY_RELEASED', message: 'This Design Book revision is already released.' },
            });
        }
        const releasedVersionSnapshot = withSnapshotIntegrity({
            ...makeVersionSnapshot({
                ...context,
                status: 'Released',
                revision: revision.trim(),
            }),
            release: {
                included_scope: scope,
                release_notes: release_notes.trim(),
                released_by: req.user.id,
                released_at: releasedAt,
                release_checklist: checklist,
            },
        });
        await insertVersion(client.query.bind(client), routeParam(req.params.id), `Released Rev ${revision.trim()}`, release_notes.trim(), releasedVersionSnapshot, req.user.id);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'RELEASE', {
            summary: `Design Book ${context.book_code} Rev ${revision.trim()} released`,
            revision: revision.trim(),
            included_scope: scope,
            release_notes: release_notes.trim(),
        }, req.ip);
        await client.query('COMMIT');
        res.json({
            ...updated.rows[0],
            checklist,
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/revisions', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const sourceResult = await (0, index_1.query)('SELECT * FROM design_books WHERE id=$1', [req.params.id]);
    const source = sourceResult.rows[0];
    if (!source)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (source.status !== 'Released') {
        return res.status(409).json({
            error: { code: 'NOT_RELEASED', message: 'Create a version snapshot for draft work; new revisions branch from released Design Books.' },
        });
    }
    const revision = String(req.body.revision || '').trim();
    const bookCode = String(req.body.book_code || '').trim();
    if (!revision || !bookCode) {
        return res.status(400).json({
            error: { code: 'VALIDATION', message: 'A new revision and unique Design Book code are required.' },
        });
    }
    const snapshot = source.release_snapshot || {};
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN');
        const created = await client.query(`INSERT INTO design_books
           (book_code, book_title, project_id, description, revision, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,'Draft',$6,$7)
         RETURNING *`, [
            bookCode,
            String(req.body.book_title || source.book_title).trim(),
            source.project_id,
            source.description,
            revision,
            req.body.notes || `Continues released ${source.book_code} Rev ${source.revision}`,
            req.user.id,
        ]);
        const next = created.rows[0];
        for (const row of snapshot.species || []) {
            await client.query(`INSERT INTO design_book_exhibit_species
             (design_book_id, exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [next.id, row.exhibit_id, row.species_name, row.common_name, row.quantity, row.avg_size_cm, row.biomass_kg, row.notes, row.sort_order || 0]);
        }
        for (const row of snapshot.hydraulics || []) {
            await client.query(`INSERT INTO design_book_exhibit_hydraulics
             (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
              weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
              weir_discharge_condition, weir_downstream_head_mm, calculation_version, last_calculated_at,
              calculation_inputs, override_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
                next.id, row.exhibit_id, row.target_turnover_rate, row.surface_skim_pct, row.bottom_drain_pct, row.notes,
                row.weir_head_mm, row.weir_length_mm, row.weir_formula_method, row.weir_geometry, row.weir_end_contractions,
                row.weir_discharge_condition, row.weir_downstream_head_mm, row.calculation_version, row.last_calculated_at,
                row.calculation_inputs, row.override_reason,
            ]);
        }
        for (const row of snapshot.substrate || []) {
            await client.query(`INSERT INTO design_book_exhibit_substrate
             (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3,
              theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
                next.id, row.exhibit_id, row.substrate_type, row.substrate_height_mm, row.substrate_volume_m3,
                row.theming_type, row.theming_height_mm, row.theming_volume_m3, row.theming_volume_pct, row.notes,
            ]);
        }
        await client.query('COMMIT');
        await (0, audit_1.logAudit)(req.user.id, 'design_book', next.id, 'CREATE_REVISION', {
            summary: `Revision ${revision} created from ${source.book_code} Rev ${source.revision}`,
            source_design_book_id: source.id,
            source_revision: source.revision,
        }, req.ip);
        res.status(201).json(next);
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
            return res.status(409).json({
                error: { code: 'CONFLICT', message: `Design Book code "${bookCode}" already exists.` },
            });
        }
        throw error;
    }
    finally {
        client.release();
    }
});
// ─── Versions ────────────────────────────────────────────────────────────────
const VERSION_SNAPSHOT_SCHEMA = 2;
const VERSION_REFERENCE_FIELDS = {
    project: ['id', 'project_code', 'project_name'],
    exhibits: ['id', 'project_id', 'exhibit_code', 'exhibit_name', 'water_type',
        'design_temperature_min', 'design_temperature_max', 'design_salinity', 'area_id', 'status', 'notes'],
    tanks: ['id', 'project_id', 'tank_code', 'exhibit_id', 'system_id', 'area_id', 'quantity',
        'tank_name', 'tank_type', 'product_master_id', 'shape_type', 'gross_volume_m3',
        'operating_volume_m3', 'surface_area_m2', 'length_mm', 'width_mm', 'height_mm', 'design_water_level_mm',
        'primary_material', 'material_id', 'wall_thickness_mm', 'inner_length_mm', 'inner_width_mm',
        'inner_height_mm', 'status', 'notes'],
    systems: ['id', 'project_id', 'system_code', 'area_id', 'exhibit_id', 'system_name', 'system_type',
        'design_flow_m3h', 'turnover_rate_hr', 'water_type', 'status', 'primary_control_panel_code',
        'duty_description', 'redundancy_strategy', 'design_basis_reference', 'system_config', 'compact_unit_id',
        'calculation_version', 'calculation_inputs', 'loop1_flow_source', 'loop1_filtration',
        'loop1_bio_degas_m3h', 'loop1_link_bio_degas', 'loop2_flow_source', 'loop2_filtration',
        'loop2_bio_degas_m3h', 'loop2_link_bio_degas', 'loop3_flow_source', 'loop3_filtration',
        'loop3_bio_degas_m3h', 'loop3_link_bio_degas'],
    system_links: ['id', 'system_id', 'exhibit_id', 'link_type', 'flow_allocation_m3h', 'notes',
        'sort_order', 'allocation_source', 'allocation_updated_at'],
};
function jsonCopy(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}
function pickFields(row, fields) {
    return fields.reduce((result, field) => {
        result[field] = row?.[field] ?? null;
        return result;
    }, {});
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function withSnapshotIntegrity(snapshot) {
    const unsigned = { ...snapshot };
    delete unsigned.integrity;
    return {
        ...unsigned,
        integrity: {
            algorithm: 'sha256',
            digest: crypto_1.default.createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
        },
    };
}
function snapshotIntegrityStatus(snapshot, persistedChecksum, requirePersisted = false) {
    if (!snapshot?.integrity?.digest)
        return 'legacy_unverified';
    if (requirePersisted && !persistedChecksum)
        return 'invalid';
    const unsigned = { ...snapshot };
    const expected = snapshot.integrity.digest;
    delete unsigned.integrity;
    const actual = crypto_1.default.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
    return expected === actual && (!persistedChecksum || persistedChecksum === actual) ? 'verified' : 'invalid';
}
function liveReferencesFromContext(context) {
    return {
        project: context.project_id
            ? pickFields(context, VERSION_REFERENCE_FIELDS.project)
            : null,
        exhibits: (context.exhibits || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.exhibits)),
        tanks: (context.tanks || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.tanks)),
        systems: (context.systems || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.systems)),
        system_links: (context.system_links || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.system_links)),
    };
}
function frozenFromSnapshot(snapshot) {
    if (snapshot?.frozen)
        return snapshot.frozen;
    // Keep snapshots made before schema 2 restorable while they are replaced by
    // verified snapshots on the next save.
    return {
        design_book: pickFields(snapshot, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
        species: snapshot?.species || [],
        hydraulics: snapshot?.hydraulics || [],
        substrate: snapshot?.substrate || [],
        ...(Array.isArray(snapshot?.review_handovers) ? { review_handovers: snapshot.review_handovers } : {}),
    };
}
function referencesFromSnapshot(snapshot) {
    if (snapshot?.live_references)
        return snapshot.live_references;
    return {
        project: snapshot?.project_id
            ? pickFields(snapshot, VERSION_REFERENCE_FIELDS.project)
            : null,
        exhibits: (snapshot?.exhibits || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.exhibits)),
        tanks: (snapshot?.tanks || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.tanks)),
        systems: (snapshot?.systems || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.systems)),
        system_links: (snapshot?.system_links || []).map((row) => pickFields(row, VERSION_REFERENCE_FIELDS.system_links)),
    };
}
function compareReferenceCollection(captured = [], current = []) {
    const capturedById = new Map(captured.filter(row => row?.id).map(row => [row.id, jsonCopy(row)]));
    const currentById = new Map(current.filter(row => row?.id).map(row => [row.id, jsonCopy(row)]));
    const added = current.filter(row => row?.id && !capturedById.has(row.id)).map(row => row.id);
    const removed = captured.filter(row => row?.id && !currentById.has(row.id)).map(row => row.id);
    const changed = captured
        .filter(row => row?.id && currentById.has(row.id))
        .filter(row => canonicalJson(capturedById.get(row.id)) !== canonicalJson(currentById.get(row.id)))
        .map(row => row.id);
    return { added, removed, changed, has_drift: added.length > 0 || removed.length > 0 || changed.length > 0 };
}
function calculateVersionDrift(snapshot, currentContext) {
    const captured = referencesFromSnapshot(snapshot);
    const current = liveReferencesFromContext(currentContext);
    const collections = {};
    for (const key of ['exhibits', 'tanks', 'systems', 'system_links']) {
        collections[key] = compareReferenceCollection(captured[key], current[key]);
    }
    const projectChanged = canonicalJson(captured.project) !== canonicalJson(current.project);
    const unresolved = [];
    for (const key of ['exhibits', 'tanks', 'systems']) {
        for (const id of collections[key].removed)
            unresolved.push({ type: key.slice(0, -1), id });
    }
    for (const id of collections.system_links.removed)
        unresolved.push({ type: 'system_link', id });
    if (captured.project?.id && !current.project)
        unresolved.unshift({ type: 'project', id: captured.project.id });
    return {
        has_drift: projectChanged || Object.values(collections).some((value) => value.has_drift),
        project_changed: projectChanged,
        collections,
        unresolved_references: unresolved,
    };
}
function makeVersionSnapshot(context, capturedAt = new Date().toISOString()) {
    const snapshot = {
        schema_version: VERSION_SNAPSHOT_SCHEMA,
        captured_at: capturedAt,
        source: {
            design_book_id: context.id,
            project_id: context.project_id || null,
            book_code: context.book_code,
            revision: context.revision,
            project_code: context.project_code || null,
            project_name: context.project_name || null,
        },
        frozen: {
            design_book: pickFields(context, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
            species: jsonCopy(context.species || []),
            hydraulics: jsonCopy(context.hydraulics || []),
            substrate: jsonCopy(context.substrate || []),
            review_handovers: jsonCopy(context.review_handovers || []),
        },
        live_references: liveReferencesFromContext(context),
        scope: {
            frozen: ['book metadata', 'species allocations', 'hydraulics', 'substrate and theming', 'review handovers'],
            live: ['project', 'exhibits', 'tanks', 'LSS systems', 'system-exhibit links'],
            restore_target: 'working_copy',
        },
    };
    return withSnapshotIntegrity(snapshot);
}
function currentRestoreStateDigest(context) {
    return crypto_1.default.createHash('sha256').update(canonicalJson({
        frozen: {
            design_book: pickFields(context, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
            species: jsonCopy(context.species || []),
            hydraulics: jsonCopy(context.hydraulics || []),
            substrate: jsonCopy(context.substrate || []),
            review_handovers: jsonCopy(context.review_handovers || []),
        },
        live_references: liveReferencesFromContext(context),
    })).digest('hex');
}
function versionPresentation(version, currentContext) {
    const snapshot = version.snapshot || {};
    const frozen = frozenFromSnapshot(snapshot);
    const drift = calculateVersionDrift(snapshot, currentContext);
    const summary = {
        schema_version: snapshot.schema_version || 1,
        integrity: snapshotIntegrityStatus(snapshot, version.snapshot_checksum, Number(version.snapshot_schema_version || snapshot.schema_version || 1) >= VERSION_SNAPSHOT_SCHEMA),
        captured_at: snapshot.captured_at || snapshot.snapshotted_at || version.created_at,
        frozen_records: {
            species: (frozen.species || []).length,
            hydraulics: (frozen.hydraulics || []).length,
            substrate_theming: (frozen.substrate || []).length,
            review_handovers: Array.isArray(frozen.review_handovers) ? frozen.review_handovers.length : null,
        },
        live_references: {
            exhibits: (referencesFromSnapshot(snapshot).exhibits || []).length,
            tanks: (referencesFromSnapshot(snapshot).tanks || []).length,
            systems: (referencesFromSnapshot(snapshot).systems || []).length,
            system_links: (referencesFromSnapshot(snapshot).system_links || []).length,
        },
        restorable_records: [
            'book metadata', 'species', 'hydraulics', 'substrate and theming',
            ...(Array.isArray(frozen.review_handovers) ? ['review handovers'] : []),
        ],
        preserved_records: Array.isArray(frozen.review_handovers) ? [] : ['review handovers (not captured by this older version)'],
        live_reference_records: ['project', 'exhibits', 'tanks', 'LSS systems', 'system-exhibit links'],
    };
    return {
        ...version,
        snapshot,
        _snap: snapshot,
        summary,
        drift,
        restore_preview: {
            before: {
                book_title: currentContext.book_title,
                revision: currentContext.revision,
                status: currentContext.status,
                species: (currentContext.species || []).length,
                hydraulics: (currentContext.hydraulics || []).length,
                substrate_theming: (currentContext.substrate || []).length,
                review_handovers: (currentContext.review_handovers || []).length,
            },
            after: {
                book_title: frozen.design_book?.book_title,
                revision: frozen.design_book?.revision,
                status: frozen.design_book?.status,
                species: (frozen.species || []).length,
                hydraulics: (frozen.hydraulics || []).length,
                substrate_theming: (frozen.substrate || []).length,
                review_handovers: Array.isArray(frozen.review_handovers)
                    ? frozen.review_handovers.length
                    : (currentContext.review_handovers || []).length,
                review_handovers_preserved: !Array.isArray(frozen.review_handovers),
            },
            token: currentRestoreStateDigest(currentContext),
            generated_at: new Date().toISOString(),
        },
    };
}
async function insertVersion(runner, bookId, versionLabel, notes, snapshot, createdBy, isRecoveryCheckpoint = false) {
    await runner('SELECT pg_advisory_xact_lock(hashtext($1))', [bookId]);
    const numberResult = await runner(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next
     FROM design_book_versions WHERE design_book_id = $1`, [bookId]);
    const inserted = await runner(`INSERT INTO design_book_versions
       (design_book_id, version_number, version_label, notes, snapshot, created_by,
        snapshot_schema_version, snapshot_checksum, is_recovery_checkpoint)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
     RETURNING id, version_number, version_label, notes, created_at, is_recovery_checkpoint`, [
        bookId,
        Number(numberResult.rows[0].next),
        versionLabel,
        notes,
        JSON.stringify(snapshot),
        createdBy,
        snapshot.schema_version || 1,
        snapshot.integrity?.digest || null,
        isRecoveryCheckpoint,
    ]);
    return inserted.rows[0];
}
exports.versionSnapshotTestUtils = {
    makeVersionSnapshot,
    snapshotIntegrityStatus,
    frozenFromSnapshot,
    calculateVersionDrift,
    currentRestoreStateDigest,
    insertVersion,
    loadReleaseContext,
};
router.get('/design-books/:id/versions', auth_1.authenticate, async (req, res) => {
    const currentContext = await loadReleaseContext(routeParam(req.params.id), index_1.query, false, true);
    if (!currentContext)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const result = await (0, index_1.query)(`SELECT v.id, v.version_number, v.version_label, v.notes, v.snapshot, v.created_at,
            v.is_recovery_checkpoint, v.snapshot_schema_version, v.snapshot_checksum,
            u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_versions v
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.design_book_id = $1
     ORDER BY v.version_number DESC`, [req.params.id]);
    res.json({ items: result.rows.map(version => versionPresentation(version, currentContext)) });
});
router.get('/design-books/:id/versions/:versionId/preview', auth_1.authenticate, async (req, res) => {
    const currentContext = await loadReleaseContext(routeParam(req.params.id), index_1.query, false, true);
    if (!currentContext)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const result = await (0, index_1.query)(`SELECT v.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_versions v
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.id=$1 AND v.design_book_id=$2`, [req.params.versionId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
    res.json(versionPresentation(result.rows[0], currentContext));
});
router.post('/design-books/:id/versions', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true, true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (!(0, designBookWorkflow_1.isDesignBookContentEditable)(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Only Draft or In Progress Design Books can be versioned.' },
            });
        }
        const snapshot = makeVersionSnapshot(context);
        const version = await insertVersion(client.query.bind(client), routeParam(req.params.id), String(req.body.version_label || '').trim() || null, String(req.body.notes || '').trim() || null, snapshot, req.user.id);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'VERSION_CREATED', {
            summary: `Design Book version ${version.version_number} created`,
            version_id: version.id,
            version_number: version.version_number,
            schema_version: snapshot.schema_version,
            snapshot_checksum: snapshot.integrity.digest,
        }, req.ip);
        await client.query('COMMIT');
        res.status(201).json({ ...version, summary: versionPresentation({ ...version, snapshot }, context).summary });
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') {
            return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'Another version was saved at the same time. Please retry.' } });
        }
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/design-books/:id/versions/:versionId/restore', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const client = await index_1.default.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const versionResult = await client.query('SELECT * FROM design_book_versions WHERE id=$1 AND design_book_id=$2', [req.params.versionId, req.params.id]);
        if (!versionResult.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
        }
        const version = versionResult.rows[0];
        const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client), true, true);
        if (!context) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
        }
        if (!(0, designBookWorkflow_1.isDesignBookContentEditable)(context.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Only Draft or In Progress Design Books can be restored.' },
            });
        }
        const currentStateToken = currentRestoreStateDigest(context);
        if (!req.body.preview_token || req.body.preview_token !== currentStateToken) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: {
                    code: 'RESTORE_PREVIEW_STALE',
                    message: 'The working copy changed after the restore preview. Review the refreshed before-and-after comparison.',
                },
            });
        }
        const integrity = snapshotIntegrityStatus(version.snapshot, version.snapshot_checksum, Number(version.snapshot_schema_version || version.snapshot?.schema_version || 1) >= VERSION_SNAPSHOT_SCHEMA);
        if (integrity === 'invalid') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'INVALID_SNAPSHOT', message: 'This version failed its integrity check and cannot be restored.' } });
        }
        const drift = calculateVersionDrift(version.snapshot, context);
        if (drift.unresolved_references.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: {
                    code: 'UNRESOLVED_REFERENCES',
                    message: 'This version refers to project records that no longer exist. Nothing was changed.',
                    references: drift.unresolved_references,
                },
                drift,
            });
        }
        const currentSnapshot = makeVersionSnapshot(context);
        const recoverySnapshot = withSnapshotIntegrity({
            ...currentSnapshot,
            recovery: {
                source_version_id: version.id,
                source_version_number: version.version_number,
                created_at: new Date().toISOString(),
            },
        });
        const checkpoint = await insertVersion(client.query.bind(client), routeParam(req.params.id), `Recovery before restoring v${version.version_number}`, `Automatic recovery checkpoint created before restoring version ${version.version_number}.`, recoverySnapshot, req.user.id, true);
        const frozen = frozenFromSnapshot(version.snapshot);
        const book = frozen.design_book || {};
        const restoredStatus = (0, designBookWorkflow_1.isDesignBookContentEditable)(book.status) ? book.status : context.status;
        await client.query(`UPDATE design_books
       SET book_title=$1, revision=$2, status=$3, description=$4, notes=$5, updated_at=NOW()
       WHERE id=$6`, [book.book_title, book.revision, restoredStatus, book.description, book.notes, req.params.id]);
        await client.query('DELETE FROM design_book_exhibit_species WHERE design_book_id=$1', [req.params.id]);
        for (const sp of frozen.species || []) {
            await client.query(`INSERT INTO design_book_exhibit_species
           (design_book_id, exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.params.id, sp.exhibit_id, sp.species_name, sp.common_name, sp.quantity ?? null, sp.avg_size_cm ?? null,
                sp.biomass_kg ?? null, sp.notes ?? null, sp.sort_order ?? 0]);
        }
        await client.query('DELETE FROM design_book_exhibit_hydraulics WHERE design_book_id=$1', [req.params.id]);
        for (const h of frozen.hydraulics || []) {
            await client.query(`INSERT INTO design_book_exhibit_hydraulics
           (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
            weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
            weir_discharge_condition, weir_downstream_head_mm, calculation_version, last_calculated_at,
            calculation_inputs, override_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)`, [req.params.id, h.exhibit_id, h.target_turnover_rate ?? null, h.surface_skim_pct ?? 30,
                h.bottom_drain_pct ?? 70, h.notes ?? null, h.weir_head_mm ?? null, h.weir_length_mm ?? null,
                h.weir_formula_method ?? null, h.weir_geometry ?? null, h.weir_end_contractions ?? null,
                h.weir_discharge_condition ?? null, h.weir_downstream_head_mm ?? null, h.calculation_version ?? null,
                h.last_calculated_at ?? null, h.calculation_inputs ? JSON.stringify(h.calculation_inputs) : null,
                h.override_reason ?? null]);
        }
        await client.query('DELETE FROM design_book_exhibit_substrate WHERE design_book_id=$1', [req.params.id]);
        for (const s of frozen.substrate || []) {
            await client.query(`INSERT INTO design_book_exhibit_substrate
           (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3,
            theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [req.params.id, s.exhibit_id, s.substrate_type ?? null, s.substrate_height_mm ?? null,
                s.substrate_volume_m3 ?? null, s.theming_type ?? null, s.theming_height_mm ?? null,
                s.theming_volume_m3 ?? null, s.theming_volume_pct ?? null, s.notes ?? null]);
        }
        if (Array.isArray(frozen.review_handovers)) {
            await client.query('DELETE FROM design_book_review_handovers WHERE design_book_id=$1', [req.params.id]);
            for (const handover of frozen.review_handovers) {
                await client.query(`INSERT INTO design_book_review_handovers
             (design_book_id, meeting_date, title, attendees, purpose, discussion_summary,
              decisions, action_items, open_items, acceptance_notes, created_by, created_at)
           VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11,COALESCE($12,NOW()))`, [req.params.id, handover.meeting_date, handover.title, handover.attendees || [],
                    handover.purpose ?? null, handover.discussion_summary ?? null, handover.decisions ?? null,
                    handover.action_items ?? null, handover.open_items ?? null, handover.acceptance_notes ?? null,
                    handover.created_by ?? null, handover.created_at ?? null]);
            }
        }
        await client.query(`INSERT INTO design_book_version_restores
         (design_book_id, source_version_id, recovery_checkpoint_id, actor_id, drift, restored_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,NOW())`, [req.params.id, version.id, checkpoint.id, req.user.id, JSON.stringify(drift)]);
        await insertAudit(client.query.bind(client), req.user.id, 'design_book', routeParam(req.params.id), 'VERSION_RESTORED', {
            summary: `Design Book restored from version ${version.version_number}`,
            source_version_id: version.id,
            source_version_number: version.version_number,
            recovery_checkpoint_id: checkpoint.id,
            drift,
        }, req.ip);
        await client.query('COMMIT');
        res.json({
            restored: true,
            version_number: version.version_number,
            recovery_checkpoint_id: checkpoint.id,
            drift,
        });
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
