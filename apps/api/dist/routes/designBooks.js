"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const index_1 = require("../db/index");
const aquariumCalculations_1 = require("../lib/aquariumCalculations");
const router = (0, express_1.Router)();
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
    const book = await (0, index_1.query)(`SELECT db.*, p.project_code, p.project_name, p.client_name, p.site_name, p.country,
       u.first_name || ' ' || u.last_name as created_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
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
        e.exhibit_name, e.water_type as exhibit_water_type,
        s.system_code, s.system_name,
        pm.product_code, pm.product_name as product_name,
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
        ) as design_volume_m3
       FROM tanks t
       LEFT JOIN exhibits e ON t.exhibit_id = e.id
       LEFT JOIN systems s ON t.system_id = s.id
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
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
    res.json({
        ...row,
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
    });
});
router.post('/design-books', auth_1.authenticate, async (req, res) => {
    const { book_code, book_title, project_id, description, revision, status, notes } = req.body;
    if (!book_code || !book_title)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'book_code and book_title are required' } });
    const result = await (0, index_1.query)(`INSERT INTO design_books (book_code, book_title, project_id, description, revision, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [book_code, book_title, project_id || null, description || null, revision || 'A', status || 'Draft', notes || null, req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.put('/design-books/:id', auth_1.authenticate, async (req, res) => {
    const { book_title, project_id, description, revision, status, notes } = req.body;
    const result = await (0, index_1.query)(`UPDATE design_books SET book_title=$1, project_id=$2, description=$3, revision=$4, status=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`, [book_title, project_id || null, description || null, revision || 'A', status || 'Draft', notes || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    res.json(result.rows[0]);
});
router.delete('/design-books/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, index_1.query)('DELETE FROM design_books WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    res.json({ deleted: true });
});
// Species CRUD
router.post('/design-books/:id/species', auth_1.authenticate, async (req, res) => {
    const { exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order } = req.body;
    if (!exhibit_id || !species_name)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id and species_name are required' } });
    const result = await (0, index_1.query)(`INSERT INTO design_book_exhibit_species (design_book_id, exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.params.id, exhibit_id, species_name, common_name || null, quantity || null, avg_size_cm || null, biomass_kg || null, notes || null, sort_order || 0]);
    res.status(201).json(result.rows[0]);
});
router.put('/design-books/:id/species/:speciesId', auth_1.authenticate, async (req, res) => {
    const { species_name, common_name, quantity, avg_size_cm, biomass_kg, notes } = req.body;
    const result = await (0, index_1.query)(`UPDATE design_book_exhibit_species SET species_name=$1, common_name=$2, quantity=$3, avg_size_cm=$4, biomass_kg=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 AND design_book_id=$8 RETURNING *`, [species_name, common_name || null, quantity || null, avg_size_cm || null, biomass_kg || null, notes || null, req.params.speciesId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
    res.json(result.rows[0]);
});
router.put('/design-books/:id/exhibits/:exhibitId/substrate', auth_1.authenticate, async (req, res) => {
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
    const tankVolumeResult = await (0, index_1.query)(`SELECT SUM(COALESCE(t.operating_volume_m3, t.design_volume_m3, 0) * COALESCE(t.quantity, 1)) AS volume_m3
     FROM tanks t WHERE t.exhibit_id=$1`, [req.params.exhibitId]);
    const grossOperatingVolume = Number(tankVolumeResult.rows[0]?.volume_m3);
    const displacement = Number(substrate_volume_m3 || 0) + Number(theming_volume_m3 || 0);
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
        theming_type || null, theming_height_mm ?? null, theming_volume_m3 ?? null,
        theming_volume_pct ?? null, notes || null]);
    res.json(result.rows[0]);
});
router.put('/design-books/:id/exhibits/:exhibitId/hydraulics', auth_1.authenticate, async (req, res) => {
    const { target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes, weir_head_mm, weir_formula_method, weir_geometry, weir_end_contractions, weir_discharge_condition, weir_downstream_head_mm, } = req.body;
    const hasField = (field) => Object.prototype.hasOwnProperty.call(req.body, field);
    const hasWeirHead = hasField('weir_head_mm');
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
        weir_head_mm, weir_formula_method, weir_geometry, weir_end_contractions,
       weir_discharge_condition, weir_downstream_head_mm,
       calculation_version, last_calculated_at, calculation_inputs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'aquarium-hydraulics-v1',NOW(),$19)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       target_turnover_rate = EXCLUDED.target_turnover_rate,
       surface_skim_pct     = EXCLUDED.surface_skim_pct,
       bottom_drain_pct     = EXCLUDED.bottom_drain_pct,
       notes                = EXCLUDED.notes,
       weir_head_mm = CASE WHEN $13 THEN EXCLUDED.weir_head_mm ELSE design_book_exhibit_hydraulics.weir_head_mm END,
       weir_formula_method = CASE WHEN $14 THEN EXCLUDED.weir_formula_method ELSE design_book_exhibit_hydraulics.weir_formula_method END,
       weir_geometry = CASE WHEN $15 THEN EXCLUDED.weir_geometry ELSE design_book_exhibit_hydraulics.weir_geometry END,
       weir_end_contractions = CASE WHEN $16 THEN EXCLUDED.weir_end_contractions ELSE design_book_exhibit_hydraulics.weir_end_contractions END,
       weir_discharge_condition = CASE WHEN $17 THEN EXCLUDED.weir_discharge_condition ELSE design_book_exhibit_hydraulics.weir_discharge_condition END,
       weir_downstream_head_mm = CASE WHEN $18 THEN EXCLUDED.weir_downstream_head_mm ELSE design_book_exhibit_hydraulics.weir_downstream_head_mm END,
        calculation_version   = 'aquarium-hydraulics-v1',
        last_calculated_at    = NOW(),
        calculation_inputs    = $19,
       updated_at           = NOW()
     RETURNING *`, [req.params.id, req.params.exhibitId,
        target_turnover_rate ?? null, savedSurfacePct, savedBottomPct,
        notes ?? null, weir_head_mm ?? null, weir_formula_method ?? null,
        weir_geometry ?? null, weir_end_contractions ?? null,
        weir_discharge_condition ?? null, weir_downstream_head_mm ?? null,
        hasWeirHead, hasWeirMethod, hasWeirGeometry, hasWeirContractions,
        hasWeirDischarge, hasWeirDownstreamHead,
        JSON.stringify({
            target_turnover_rate: target_turnover_rate ?? null,
            surface_skim_pct: savedSurfacePct,
            bottom_drain_pct: savedBottomPct,
            turnover_unit: 'cycles_per_hour',
            flow_unit: 'm3_per_hour',
        })]);
    res.json(result.rows[0]);
});
router.delete('/design-books/:id/species/:speciesId', auth_1.authenticate, async (req, res) => {
    const result = await (0, index_1.query)('DELETE FROM design_book_exhibit_species WHERE id=$1 AND design_book_id=$2 RETURNING id', [req.params.speciesId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
    res.json({ deleted: true });
});
// ─── Versions ────────────────────────────────────────────────────────────────
router.get('/design-books/:id/versions', auth_1.authenticate, async (req, res) => {
    const result = await (0, index_1.query)(`SELECT v.id, v.version_number, v.version_label, v.notes, v.created_at,
            u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_versions v
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.design_book_id = $1
     ORDER BY v.version_number DESC`, [req.params.id]);
    res.json({ items: result.rows });
});
router.post('/design-books/:id/versions', auth_1.authenticate, async (req, res) => {
    const { version_label, notes } = req.body;
    // 1. Check book exists
    const bookRow = await (0, index_1.query)(`SELECT db.*, p.project_code, p.project_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     WHERE db.id = $1`, [req.params.id]);
    if (!bookRow.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    const book = bookRow.rows[0];
    // 2. Collect project-side data (same queries as GET /design-books/:id)
    let exhibits = [], tanks = [], systems = [];
    if (book.project_id) {
        const [exhibitRes, tankRes, sysRes] = await Promise.all([
            (0, index_1.query)(`SELECT e.*, a.area_name, a.area_code
         FROM exhibits e
         LEFT JOIN areas a ON e.area_id = a.id
         WHERE e.project_id = $1
         ORDER BY a.area_code, e.exhibit_code`, [book.project_id]),
            (0, index_1.query)(`SELECT t.*,
                e.exhibit_name, e.exhibit_code, e.water_type AS exhibit_water_type, e.id AS exhibit_id,
                s.system_code, s.system_name,
                t.operating_volume_m3 AS design_volume_m3
         FROM tanks t
         LEFT JOIN exhibits e ON t.exhibit_id = e.id
         LEFT JOIN systems s ON t.system_id = s.id
         WHERE e.project_id = $1
         ORDER BY e.exhibit_code, t.tank_code`, [book.project_id]),
            (0, index_1.query)(`SELECT s.*, e.exhibit_name, e.exhibit_code
         FROM systems s
         LEFT JOIN exhibits e ON s.exhibit_id = e.id
         WHERE s.project_id = $1
         ORDER BY s.system_code`, [book.project_id]),
        ]);
        exhibits = exhibitRes.rows;
        tanks = tankRes.rows;
        systems = sysRes.rows;
    }
    // 3. Collect design-book-owned data
    const [speciesRes, hydraulicsRes, substrateRes] = await Promise.all([
        (0, index_1.query)('SELECT * FROM design_book_exhibit_species WHERE design_book_id = $1 ORDER BY exhibit_id, sort_order', [req.params.id]),
        (0, index_1.query)('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id = $1', [req.params.id]),
        (0, index_1.query)('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id = $1', [req.params.id]),
    ]);
    const snapshot = {
        ...book,
        exhibits,
        tanks,
        systems,
        species: speciesRes.rows,
        hydraulics: hydraulicsRes.rows,
        substrate: substrateRes.rows,
        snapshotted_at: new Date().toISOString(),
    };
    // 4. Get next version number
    const numRes = await (0, index_1.query)(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM design_book_versions WHERE design_book_id = $1`, [req.params.id]);
    const version_number = numRes.rows[0].next;
    // 5. Insert version
    const inserted = await (0, index_1.query)(`INSERT INTO design_book_versions
       (design_book_id, version_number, version_label, notes, snapshot, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, version_number, version_label, notes, created_at`, [req.params.id, version_number, version_label || null, notes || null,
        JSON.stringify(snapshot), req.user.id]);
    res.status(201).json(inserted.rows[0]);
});
router.post('/design-books/:id/versions/:versionId/restore', auth_1.authenticate, async (req, res) => {
    // 1. Load the snapshot
    const verRes = await (0, index_1.query)('SELECT * FROM design_book_versions WHERE id=$1 AND design_book_id=$2', [req.params.versionId, req.params.id]);
    if (!verRes.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
    const snap = verRes.rows[0].snapshot;
    // 2. Restore book metadata
    await (0, index_1.query)(`UPDATE design_books
     SET book_title=$1, revision=$2, status=$3, description=$4, notes=$5, updated_at=NOW()
     WHERE id=$6`, [snap.book_title, snap.revision, snap.status, snap.description, snap.notes, req.params.id]);
    // 3. Restore species — delete then re-insert
    await (0, index_1.query)('DELETE FROM design_book_exhibit_species WHERE design_book_id=$1', [req.params.id]);
    if (snap.species?.length) {
        for (const sp of snap.species) {
            await (0, index_1.query)(`INSERT INTO design_book_exhibit_species
           (design_book_id, exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.params.id, sp.exhibit_id, sp.species_name, sp.common_name,
                sp.quantity ?? null, sp.avg_size_cm ?? null, sp.biomass_kg ?? null,
                sp.notes ?? null, sp.sort_order ?? 0]);
        }
    }
    // 4. Restore hydraulics — delete then re-insert
    await (0, index_1.query)('DELETE FROM design_book_exhibit_hydraulics WHERE design_book_id=$1', [req.params.id]);
    if (snap.hydraulics?.length) {
        for (const h of snap.hydraulics) {
            await (0, index_1.query)(`INSERT INTO design_book_exhibit_hydraulics
           (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
            weir_head_mm, weir_formula_method, weir_geometry, weir_end_contractions,
            weir_discharge_condition, weir_downstream_head_mm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [req.params.id, h.exhibit_id,
                h.target_turnover_rate ?? null, h.surface_skim_pct ?? 30,
                h.bottom_drain_pct ?? 70, h.notes ?? null,
                h.weir_head_mm ?? null, h.weir_formula_method ?? null,
                h.weir_geometry ?? null, h.weir_end_contractions ?? null,
                h.weir_discharge_condition ?? null, h.weir_downstream_head_mm ?? null]);
        }
    }
    // 5. Restore substrate — delete then re-insert
    await (0, index_1.query)('DELETE FROM design_book_exhibit_substrate WHERE design_book_id=$1', [req.params.id]);
    if (snap.substrate?.length) {
        for (const s of snap.substrate) {
            await (0, index_1.query)(`INSERT INTO design_book_exhibit_substrate
           (design_book_id, exhibit_id, substrate_type, substrate_volume_m3, theming_type, theming_volume_m3, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.params.id, s.exhibit_id,
                s.substrate_type ?? null, s.substrate_volume_m3 ?? null,
                s.theming_type ?? null, s.theming_volume_m3 ?? null, s.notes ?? null]);
        }
    }
    res.json({ restored: true, version_number: verRes.rows[0].version_number });
});
exports.default = router;
