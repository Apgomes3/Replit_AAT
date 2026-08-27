"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../db/audit");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const aquariumCalculations_1 = require("../lib/aquariumCalculations");
const uploadsDir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(uploadsDir))
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
const logoStorage = multer_1.default.diskStorage({
    destination: uploadsDir,
    filename: (_, file, cb) => {
        const unique = `${Date.now()}-${crypto_1.default.randomBytes(6).toString('hex')}`;
        cb(null, `logo-${unique}${path_1.default.extname(file.originalname)}`);
    },
});
const uploadLogo = (0, multer_1.default)({
    storage: logoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
});
const router = (0, express_1.Router)();
const paginate = (req) => {
    const page = parseInt(req.query.page) || 1;
    const page_size = Math.min(parseInt(req.query.page_size) || 25, 200);
    const offset = (page - 1) * page_size;
    return { page, page_size, offset };
};
const buildSort = (sort, allowed = ['project_code', 'project_name', 'project_status', 'created_at']) => {
    if (!sort)
        return 'created_at DESC';
    const dir = sort.startsWith('-') ? 'DESC' : 'ASC';
    const col = sort.replace(/^-/, '');
    return allowed.includes(col) ? `${col} ${dir}` : 'created_at DESC';
};
// PROJECTS
router.get('/projects', auth_1.authenticate, async (req, res) => {
    const { page, page_size, offset } = paginate(req);
    const filters = [];
    const params = [];
    if (req.query.status) {
        params.push(req.query.status);
        filters.push(`project_status = $${params.length}`);
    }
    if (req.query.q) {
        params.push(`%${req.query.q}%`);
        filters.push(`(project_name ILIKE $${params.length} OR project_code ILIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const sort = buildSort(req.query.sort);
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM projects ${where}`, params);
    const total = parseInt(countRes.rows[0].count);
    params.push(page_size, offset);
    const result = await (0, db_1.query)(`SELECT * FROM projects ${where} ORDER BY ${sort} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ items: result.rows, pagination: { page, page_size, total } });
});
router.get('/projects/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    res.json(result.rows[0]);
});
router.post('/projects', auth_1.authenticate, async (req, res) => {
    const { project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, scopes } = req.body;
    if (!project_code || !project_name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_code and project_name required' } });
    const toDate = (v) => (v === '' || v == null) ? null : v;
    const toStr = (v) => (v === '' || v == null) ? null : String(v);
    const resolvedScopes = (Array.isArray(scopes) && scopes.length > 0) ? scopes : ['LSS', 'Tanks', 'Waterproofing', 'Theming', 'Acrylic'];
    const result = await (0, db_1.query)(`INSERT INTO projects (project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, project_scopes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [project_code, project_name, toStr(client_name), toStr(site_name), toStr(country), toStr(city), toStr(timezone), project_status || 'Concept', toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), resolvedScopes, req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.put('/projects/:id', auth_1.authenticate, async (req, res) => {
    const { project_name, client_name, site_name, country, city, latitude, longitude, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, project_scopes } = req.body;
    const toDate = (v) => (v === '' || v == null) ? null : v;
    const toNum = (v) => (v === '' || v == null) ? null : Number(v);
    const toStr = (v) => (v === '' || v == null) ? null : String(v);
    const result = await (0, db_1.query)(`UPDATE projects SET project_name=$1, client_name=$2, site_name=$3, country=$4, city=$5, latitude=$6, longitude=$7, project_status=$8, start_date=$9, target_completion_date=$10, project_manager=$11, engineering_manager=$12, qa_owner=$13, notes=$14, project_scopes=COALESCE($15, project_scopes), updated_at=NOW()
     WHERE id=$16 RETURNING *`, [toStr(project_name), toStr(client_name), toStr(site_name), toStr(country), toStr(city), toNum(latitude), toNum(longitude), project_status, toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), Array.isArray(project_scopes) ? project_scopes : null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'project', result.rows[0].id, 'UPDATE', {
        summary: 'Project details updated',
        project_name: result.rows[0].project_name,
        project_status: result.rows[0].project_status,
    });
    res.json(result.rows[0]);
});
router.patch('/projects/:id/scopes', auth_1.authenticate, async (req, res) => {
    try {
        const { scopes } = req.body;
        if (!Array.isArray(scopes) || scopes.length === 0) {
            return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'scopes must be a non-empty array' } });
        }
        const result = await (0, db_1.query)('UPDATE projects SET project_scopes=$1::text[], updated_at=NOW() WHERE id=$2 RETURNING id, project_scopes', [scopes, req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
    }
});
router.delete('/projects/:id', auth_1.authenticate, async (req, res) => {
    await (0, db_1.query)('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.status(204).end();
});
router.post('/projects/:id/logo', auth_1.authenticate, uploadLogo.single('logo'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: { code: 'NO_FILE', message: 'Image file required' } });
    const logoUrl = `/uploads/${req.file.filename}`;
    const result = await (0, db_1.query)('UPDATE projects SET logo_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [logoUrl, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    res.json(result.rows[0]);
});
// AREAS
router.get('/projects/:id/areas', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)('SELECT * FROM areas WHERE project_id = $1 ORDER BY area_code', [proj.rows[0].id]);
    res.json({ items: result.rows });
});
router.get('/projects/:id/systems', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)(`SELECT s.*, a.area_name, e.exhibit_name,
      COALESCE(SUM(t.quantity), 0)::int AS tank_count,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2)
                      * COALESCE(t.height_mm, pm.height_mm) / 1000000000.0 * COALESCE(t.quantity, 1)
          WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
               AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0 * COALESCE(t.quantity, 1)
          WHEN COALESCE(t.gross_volume_m3, pm.gross_volume_m3) IS NOT NULL
            THEN COALESCE(t.gross_volume_m3, pm.gross_volume_m3) * COALESCE(t.quantity, 1)
          ELSE 0
        END
      ), 0)::numeric AS total_volume_m3,
      COALESCE(SUM(
        COALESCE(t.operating_volume_m3, pm.operating_volume_m3, 0) * COALESCE(t.quantity, 1)
      ), 0)::numeric AS total_operating_volume_m3
     FROM systems s
     LEFT JOIN areas a ON s.area_id=a.id
     LEFT JOIN exhibits e ON s.exhibit_id=e.id
     LEFT JOIN tanks t ON t.system_id=s.id
     LEFT JOIN product_masters pm ON t.product_master_id=pm.id
     WHERE s.project_id = $1
     GROUP BY s.id, a.area_name, e.exhibit_name
     ORDER BY s.sort_order, s.system_code`, [proj.rows[0].id]);
    res.json({ items: result.rows });
});
router.get('/projects/:id/equipment', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)(`SELECT pei.*, s.system_code, s.system_name, pm.product_code, pm.product_name
     FROM project_equipment_items pei
     LEFT JOIN systems s ON pei.system_id = s.id
     LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
     WHERE pei.project_id = $1 ORDER BY pei.equip_code`, [proj.rows[0].id]);
    res.json({ items: result.rows });
});
router.get('/projects/:id/documents', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)('SELECT * FROM documents WHERE project_id = $1 ORDER BY document_code', [proj.rows[0].id]);
    res.json({ items: result.rows });
});
router.get('/projects/:id/change-requests', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)('SELECT cr.*, u.first_name || \' \' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id WHERE cr.project_id = $1 ORDER BY cr.created_at DESC', [proj.rows[0].id]);
    res.json({ items: result.rows });
});
// AREAS standalone
router.get('/areas', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT a.*, p.project_code FROM areas a JOIN projects p ON a.project_id=p.id ORDER BY a.area_code');
    res.json({ items: result.rows });
});
router.get('/areas/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT a.*, p.project_code, p.project_name FROM areas a JOIN projects p ON a.project_id=p.id WHERE a.id = $1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Area not found' } });
    res.json(result.rows[0]);
});
router.post('/areas', auth_1.authenticate, async (req, res) => {
    const { area_code, project_id, area_name, discipline_scope, notes } = req.body;
    const result = await (0, db_1.query)('INSERT INTO areas (area_code, project_id, area_name, discipline_scope, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *', [area_code, project_id, area_name, discipline_scope, notes]);
    res.status(201).json(result.rows[0]);
});
// EXHIBITS
router.get('/exhibits', auth_1.authenticate, async (req, res) => {
    const filters = [], params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`e.project_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await (0, db_1.query)(`SELECT e.*, a.area_name, p.project_code FROM exhibits e LEFT JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id ${where} ORDER BY e.exhibit_code`, params);
    res.json({ items: result.rows });
});
router.put('/exhibits/:id', auth_1.authenticate, async (req, res) => {
    const { exhibit_code, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity, area_id, notes } = req.body;
    if (!exhibit_name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'exhibit_name is required' } });
    const result = await (0, db_1.query)(`UPDATE exhibits SET exhibit_code=$1, exhibit_name=$2, water_type=$3, design_temperature_min=$4, design_temperature_max=$5, design_salinity=$6, area_id=$7, notes=$8, updated_at=NOW() WHERE id=$9 RETURNING *`, [exhibit_code, exhibit_name, water_type || null, design_temperature_min || null, design_temperature_max || null, design_salinity || null, area_id || null, notes || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
    res.json(result.rows[0]);
});
router.delete('/exhibits/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('DELETE FROM exhibits WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
    res.json({ deleted: true });
});
router.get('/exhibits/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT e.*, a.area_name, p.project_code, p.project_name FROM exhibits e JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id WHERE e.id=$1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
    res.json(result.rows[0]);
});
router.post('/exhibits', auth_1.authenticate, async (req, res) => {
    const { exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity } = req.body;
    const result = await (0, db_1.query)('INSERT INTO exhibits (exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity]);
    res.status(201).json(result.rows[0]);
});
// TANKS
router.get('/tanks', auth_1.authenticate, async (req, res) => {
    const filters = [], params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`t.project_id = $${params.length}`);
    }
    if (req.query.system_id) {
        params.push(req.query.system_id);
        filters.push(`t.system_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    // Auto-create missing tank_instances rows for multi-unit tanks (idempotent)
    const instanceFilters = ['t.quantity > 1', ...filters];
    await (0, db_1.query)(`INSERT INTO tank_instances (tank_id, instance_index, tag)
     SELECT t.id, gs.i,
       t.tank_code || '-' || LPAD(gs.i::text, CASE WHEN t.quantity > 99 THEN 3 WHEN t.quantity > 9 THEN 2 ELSE 1 END, '0')
     FROM tanks t
     CROSS JOIN LATERAL generate_series(1, t.quantity) AS gs(i)
     WHERE ${instanceFilters.join(' AND ')}
       AND NOT EXISTS (
         SELECT 1 FROM tank_instances ti WHERE ti.tank_id = t.id AND ti.instance_index = gs.i
       )
     ON CONFLICT (tank_id, instance_index) DO NOTHING`, params);
    const result = await (0, db_1.query)(`SELECT t.*, e.exhibit_name, p.project_code,
      s.system_code, s.system_name,
      pm.product_code, pm.product_name as product_name, pm.application_type as product_type,
      pm.primary_material_code as product_material,
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
        (SELECT json_agg(
          json_build_object(
            'id', ti.id, 'tank_id', ti.tank_id, 'instance_index', ti.instance_index,
            'tag', ti.tag, 'notes', ti.notes, 'display_name', ti.display_name,
            'exhibit_id', ti.exhibit_id, 'exhibit_name', ex.exhibit_name
          ) ORDER BY ti.instance_index
        ) FROM tank_instances ti LEFT JOIN exhibits ex ON ti.exhibit_id = ex.id WHERE ti.tank_id = t.id),
        '[]'::json
      ) AS instances
     FROM tanks t
     LEFT JOIN exhibits e ON t.exhibit_id=e.id
     JOIN projects p ON t.project_id=p.id
     LEFT JOIN systems s ON t.system_id=s.id
     LEFT JOIN product_masters pm ON t.product_master_id=pm.id
     ${where} ORDER BY t.sort_order, t.tank_code`, params);
    res.json({ items: result.rows });
});
router.get('/tanks/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT t.*, e.exhibit_name, p.project_code, p.project_name,
      pm.product_code, pm.product_name as product_name, pm.application_type as product_type,
      pm.primary_material_code as product_material,
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
     FROM tanks t LEFT JOIN exhibits e ON t.exhibit_id=e.id JOIN projects p ON t.project_id=p.id
     LEFT JOIN product_masters pm ON t.product_master_id=pm.id WHERE t.id=$1`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json(result.rows[0]);
});
router.post('/tanks', auth_1.authenticate, async (req, res) => {
    const { tank_code, project_id, tank_name, tank_type, product_master_id, system_id, exhibit_id, quantity, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes } = req.body;
    if (!tank_code || !project_id || !tank_name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tank_code, project_id and tank_name required' } });
    const qty = Math.max(1, parseInt(quantity) || 1);
    const l = length_mm ? parseFloat(length_mm) : null;
    const w = width_mm ? parseFloat(width_mm) : null;
    const h = height_mm ? parseFloat(height_mm) : null;
    const wl = design_water_level_mm ? parseFloat(design_water_level_mm) : null;
    // Auto-calculate volumes from dimensions when not explicitly provided
    const isCyl = (shape_type || '').toLowerCase() === 'cylindrical';
    const calcGross = (gross_volume_m3 != null && gross_volume_m3 !== '')
        ? parseFloat(gross_volume_m3)
        : isCyl
            ? (w && h ? Math.round(Math.PI * (w / 2) * (w / 2) * h / 1e9 * 1e4) / 1e4 : null)
            : (l && w && h ? Math.round(l * w * h / 1e9 * 1e4) / 1e4 : null);
    const calcOp = (operating_volume_m3 != null && operating_volume_m3 !== '')
        ? parseFloat(operating_volume_m3)
        : isCyl
            ? (w && wl ? Math.round(Math.PI * (w / 2) * (w / 2) * wl / 1e9 * 1e4) / 1e4 : null)
            : (l && w && wl ? Math.round(l * w * wl / 1e9 * 1e4) / 1e4 : null);
    const result = await (0, db_1.query)('INSERT INTO tanks (tank_code, project_id, exhibit_id, system_id, quantity, tank_name, tank_type, product_master_id, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *', [tank_code, project_id, exhibit_id || null, system_id || null, qty, tank_name, tank_type || null, product_master_id || null, shape_type || null, calcGross, calcOp, l, w, h, wl, primary_material || null, status || 'Active', notes || null]);
    const tank = result.rows[0];
    if (qty > 1) {
        const pad = qty > 99 ? 3 : qty > 9 ? 2 : 1;
        const instanceRows = Array.from({ length: qty }, (_, i) => ({
            tank_id: tank.id,
            instance_index: i + 1,
            tag: `${tank_code.toUpperCase()}-${String(i + 1).padStart(pad, '0')}`,
        }));
        for (const inst of instanceRows) {
            await (0, db_1.query)('INSERT INTO tank_instances (tank_id, instance_index, tag) VALUES ($1,$2,$3) ON CONFLICT (tank_id, instance_index) DO NOTHING', [inst.tank_id, inst.instance_index, inst.tag]);
        }
    }
    res.status(201).json(tank);
});
router.post('/tanks/:id/duplicate', auth_1.authenticate, async (req, res) => {
    const orig = await (0, db_1.query)('SELECT * FROM tanks WHERE id=$1', [req.params.id]);
    if (!orig.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    const t = orig.rows[0];
    const existing = await (0, db_1.query)('SELECT tank_code FROM tanks WHERE project_id=$1', [t.project_id]);
    const usedCodes = new Set(existing.rows.map((r) => r.tank_code.toUpperCase()));
    let newCode = `${t.tank_code}-2`;
    let n = 2;
    while (usedCodes.has(newCode.toUpperCase())) {
        n++;
        newCode = `${t.tank_code}-${n}`;
    }
    const qty = t.quantity ?? 1;
    const result = await (0, db_1.query)('INSERT INTO tanks (tank_code, project_id, system_id, quantity, tank_name, tank_type, product_master_id, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *', [newCode.toUpperCase(), t.project_id, t.system_id, qty, `${t.tank_name} (Copy)`, t.tank_type, t.product_master_id, t.shape_type, t.gross_volume_m3, t.operating_volume_m3, t.length_mm, t.width_mm, t.height_mm, t.design_water_level_mm, t.primary_material, t.status || 'Active', t.notes]);
    const newTank = result.rows[0];
    if (qty > 1) {
        const pad = qty > 99 ? 3 : qty > 9 ? 2 : 1;
        for (let i = 1; i <= qty; i++) {
            await (0, db_1.query)('INSERT INTO tank_instances (tank_id, instance_index, tag) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [newTank.id, i, `${newCode.toUpperCase()}-${String(i).padStart(pad, '0')}`]);
        }
    }
    res.status(201).json(newTank);
});
router.patch('/systems/reorder', auth_1.authenticate, async (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds))
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'orderedIds must be an array' } });
    for (let i = 0; i < orderedIds.length; i++) {
        await (0, db_1.query)('UPDATE systems SET sort_order=$1 WHERE id=$2', [i, orderedIds[i]]);
    }
    res.json({ ok: true });
});
router.patch('/tanks/reorder', auth_1.authenticate, async (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds))
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'orderedIds must be an array' } });
    for (let i = 0; i < orderedIds.length; i++) {
        await (0, db_1.query)('UPDATE tanks SET sort_order=$1 WHERE id=$2', [i, orderedIds[i]]);
    }
    res.json({ ok: true });
});
router.patch('/tanks/:id', auth_1.authenticate, async (req, res) => {
    try {
        const { system_id, product_master_id } = req.body;
        const hasPM = 'product_master_id' in req.body;
        const result = hasPM
            ? await (0, db_1.query)('UPDATE tanks SET system_id=$1, product_master_id=$2, updated_at=NOW() WHERE id=$3 RETURNING *', [system_id !== undefined ? (system_id || null) : undefined, product_master_id || null, req.params.id])
            : await (0, db_1.query)('UPDATE tanks SET system_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [system_id || null, req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
        res.json(result.rows[0]);
    }
    catch (err) {
        throw err;
    }
});
router.put('/tanks/:id', auth_1.authenticate, async (req, res) => {
    const { tank_code, tank_name, tank_type, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes, quantity, gross_volume_m3, operating_volume_m3, system_id, exhibit_id, material_id, wall_thickness_mm, inner_length_mm, inner_width_mm, inner_height_mm, } = req.body;
    if (!tank_name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tank_name is required' } });
    const l = length_mm ? parseFloat(length_mm) : null;
    const w = width_mm ? parseFloat(width_mm) : null;
    const h = height_mm ? parseFloat(height_mm) : null;
    const wl = design_water_level_mm ? parseFloat(design_water_level_mm) : null;
    const t = wall_thickness_mm ? parseFloat(wall_thickness_mm) : 0;
    const isCustom = (shape_type || '').toLowerCase() === 'custom';
    const isCyl = (shape_type || '').toLowerCase() === 'cylindrical';
    // Use inner dims when wall thickness is set (open-top: subtract one wall from height)
    const il = !isCyl && l && t ? l - 2 * t : l;
    const iw = w && t ? w - 2 * t : w;
    const ih = h && t ? h - t : h;
    const calcGross = isCustom
        ? (gross_volume_m3 != null && gross_volume_m3 !== '' ? parseFloat(gross_volume_m3) : null)
        : isCyl
            ? (iw && ih ? Math.round(Math.PI * (iw / 2) * (iw / 2) * ih / 1e9 * 1e4) / 1e4 : null)
            : (il && iw && ih ? Math.round(il * iw * ih / 1e9 * 1e4) / 1e4 : null);
    const calcOp = isCustom
        ? (operating_volume_m3 != null && operating_volume_m3 !== '' ? parseFloat(operating_volume_m3) : null)
        : isCyl
            ? (iw && wl ? Math.round(Math.PI * (iw / 2) * (iw / 2) * wl / 1e9 * 1e4) / 1e4 : null)
            : (il && iw && wl ? Math.round(il * iw * wl / 1e9 * 1e4) / 1e4 : null);
    const qty = Math.max(1, parseInt(quantity) || 1);
    const hasExhibit = 'exhibit_id' in req.body;
    const result = await (0, db_1.query)(`UPDATE tanks SET
      tank_code=COALESCE($1, tank_code), tank_name=$2, tank_type=$3, shape_type=$4,
      length_mm=$5, width_mm=$6, height_mm=$7, design_water_level_mm=$8,
      gross_volume_m3=$9, operating_volume_m3=$10,
      primary_material=$11, status=$12, notes=$13, quantity=$14,
      system_id=$15, material_id=$16, wall_thickness_mm=$17,
      inner_length_mm=$18, inner_width_mm=$19, inner_height_mm=$20,
      ${hasExhibit ? 'exhibit_id=$22,' : ''} updated_at=NOW()
    WHERE id=$21 RETURNING *`, hasExhibit
        ? [tank_code ? tank_code.trim().toUpperCase() : null, tank_name, tank_type || null, shape_type || null,
            l, w, h, wl, calcGross, calcOp,
            primary_material || null, status || 'Active', notes || null, qty,
            system_id || null,
            material_id || null, wall_thickness_mm ?? null,
            inner_length_mm ?? null, inner_width_mm ?? null, inner_height_mm ?? null,
            req.params.id, exhibit_id || null]
        : [tank_code ? tank_code.trim().toUpperCase() : null, tank_name, tank_type || null, shape_type || null,
            l, w, h, wl, calcGross, calcOp,
            primary_material || null, status || 'Active', notes || null, qty,
            system_id || null,
            material_id || null, wall_thickness_mm ?? null,
            inner_length_mm ?? null, inner_width_mm ?? null, inner_height_mm ?? null,
            req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json(result.rows[0]);
});
// Quick exhibit assignment for tanks
router.patch('/tanks/:id/exhibit', auth_1.authenticate, async (req, res) => {
    const { exhibit_id } = req.body;
    const result = await (0, db_1.query)('UPDATE tanks SET exhibit_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [exhibit_id || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json(result.rows[0]);
});
router.delete('/tanks/:id', auth_1.authenticate, async (req, res) => {
    await (0, db_1.query)('DELETE FROM tank_instances WHERE tank_id=$1', [req.params.id]);
    const result = await (0, db_1.query)('DELETE FROM tanks WHERE id=$1 RETURNING id, tank_code', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json({ deleted: true });
});
router.patch('/tank-instances/:id', auth_1.authenticate, async (req, res) => {
    const { tag, display_name, exhibit_id } = req.body;
    if (tag !== undefined && (!tag || !tag.trim()))
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tag cannot be empty' } });
    const result = await (0, db_1.query)(`UPDATE tank_instances SET
      tag = COALESCE($1, tag),
      display_name = $2,
      exhibit_id = $3
    WHERE id=$4 RETURNING *`, [tag ? tag.trim().toUpperCase() : null, display_name || null, exhibit_id || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank instance not found' } });
    res.json(result.rows[0]);
});
// SYSTEMS
router.get('/systems', auth_1.authenticate, async (req, res) => {
    const { page, page_size, offset } = paginate(req);
    const filters = [];
    const params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`s.project_id = $${params.length}`);
    }
    if (req.query.status) {
        params.push(req.query.status);
        filters.push(`s.status = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM systems s ${where}`, params);
    params.push(page_size, offset);
    const result = await (0, db_1.query)(`SELECT s.*, a.area_name, e.exhibit_name, p.project_code FROM systems s LEFT JOIN areas a ON s.area_id=a.id LEFT JOIN exhibits e ON s.exhibit_id=e.id JOIN projects p ON s.project_id=p.id ${where} ORDER BY s.system_code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});
router.get('/systems/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT s.*, a.area_name, e.exhibit_name, p.project_code, p.project_name FROM systems s LEFT JOIN areas a ON s.area_id=a.id LEFT JOIN exhibits e ON s.exhibit_id=e.id JOIN projects p ON s.project_id=p.id WHERE s.id::text=$1 OR s.system_code=$1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    const sysId = result.rows[0].id;
    const [equipment, tanks] = await Promise.all([
        (0, db_1.query)(`SELECT pei.*, pm.product_code, pm.product_name, c.component_code, c.component_name,
              po.id   AS released_po_id,
              po.po_code AS released_po_code
       FROM project_equipment_items pei
       LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
       LEFT JOIN components c ON pei.component_id = c.id
       LEFT JOIN LATERAL (
         SELECT po_id FROM po_items
         WHERE project_equipment_item_id = pei.id LIMIT 1
       ) poi ON true
       LEFT JOIN purchase_orders po ON po.id = poi.po_id
       WHERE pei.system_id = $1 ORDER BY pei.equip_code`, [sysId]),
        (0, db_1.query)(`SELECT t.id, t.tank_code, t.tank_name, t.tank_type, t.quantity,
              t.product_master_id,
              COALESCE(t.gross_volume_m3, pm.gross_volume_m3)       AS gross_volume_m3,
              COALESCE(t.operating_volume_m3, pm.operating_volume_m3) AS operating_volume_m3,
              t.length_mm, t.width_mm, t.height_mm,
              t.primary_material, t.status,
              pm.product_code, pm.product_name,
              po.id      AS released_po_id,
              po.po_code AS released_po_code
       FROM tanks t
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
       LEFT JOIN LATERAL (
         SELECT po_id FROM po_items WHERE tank_id = t.id LIMIT 1
       ) poi ON true
       LEFT JOIN purchase_orders po ON po.id = poi.po_id
       WHERE t.system_id = $1
       ORDER BY t.tank_code`, [sysId]),
    ]);
    res.json({ ...result.rows[0], equipment: equipment.rows, tanks: tanks.rows });
});
router.post('/systems', auth_1.authenticate, async (req, res) => {
    try {
        const { system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, status, duty_description, redundancy_strategy } = req.body;
        if (!system_code || !project_id || !system_name) {
            return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'system_code, project_id and system_name are required' } });
        }
        const result = await (0, db_1.query)('INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, status, duty_description, redundancy_strategy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [system_code, project_id, area_id || null, exhibit_id || null, system_name, system_type, design_flow_m3h || null, turnover_rate_hr || null, water_type, status || 'Draft', duty_description || null, redundancy_strategy || null]);
        await (0, audit_1.logAudit)(req.user.id, 'system', result.rows[0].id, 'CREATE', {
            summary: `System ${system_code} created`,
            system_code,
            system_name,
            system_type,
        });
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: { code: 'CONFLICT', message: `System code "${req.body.system_code}" already exists in this project. Use a different code.` } });
        }
        throw err;
    }
});
router.put('/systems/:id', auth_1.authenticate, async (req, res) => {
    try {
        const { system_code, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, status, duty_description, redundancy_strategy, loop1_flow_source, loop1_filtration, loop1_bio_degas_m3h, loop1_link_bio_degas, loop2_flow_source, loop2_filtration, loop2_bio_degas_m3h, loop2_link_bio_degas, loop3_flow_source, loop3_filtration, loop3_bio_degas_m3h, loop3_link_bio_degas, system_config, compact_unit_id, design_book_id, } = req.body;
        for (const [label, value] of [
            ['Design flow', design_flow_m3h],
            ['Turnover rate', turnover_rate_hr],
            ['Loop 1 bio/degas flow', loop1_bio_degas_m3h],
            ['Loop 2 bio/degas flow', loop2_bio_degas_m3h],
            ['Loop 3 bio/degas flow', loop3_bio_degas_m3h],
        ]) {
            if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
                return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number.` } });
            }
        }
        const currentResult = await (0, db_1.query)('SELECT id, project_id, water_type FROM systems WHERE id=$1', [req.params.id]);
        if (!currentResult.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        const intendedWaterType = water_type || currentResult.rows[0].water_type;
        const linkedWaterTypes = await (0, db_1.query)(`SELECT e.exhibit_code, e.water_type
       FROM system_exhibit_links sel
       JOIN exhibits e ON e.id=sel.exhibit_id
       WHERE sel.system_id=$1`, [req.params.id]);
        const incompatibleLink = linkedWaterTypes.rows.find((link) => !(0, aquariumCalculations_1.compatibleWaterTypes)(intendedWaterType, link.water_type));
        if (incompatibleLink) {
            return res.status(409).json({
                error: {
                    code: 'INCOMPATIBLE_WATER_TYPE',
                    message: `${incompatibleLink.exhibit_code} uses ${incompatibleLink.water_type} water and is incompatible with a ${intendedWaterType} system.`,
                },
            });
        }
        if ((system_config || 'bespoke') === 'compact') {
            if (!compact_unit_id) {
                return res.status(400).json({ error: { code: 'VALIDATION', message: 'Select a compact unit before saving compact configuration.' } });
            }
            if (!design_book_id) {
                return res.status(400).json({ error: { code: 'VALIDATION', message: 'A Design Book calculation context is required for compact-unit validation.' } });
            }
            const designBookResult = await (0, db_1.query)('SELECT id FROM design_books WHERE id=$1 AND project_id=$2', [design_book_id, currentResult.rows[0].project_id]);
            if (!designBookResult.rows[0]) {
                return res.status(409).json({
                    error: { code: 'DESIGN_BOOK_CONTEXT_MISMATCH', message: 'The Design Book must belong to the same project as the system.' },
                });
            }
            const unitResult = await (0, db_1.query)('SELECT * FROM lss_compact_units WHERE id=$1', [compact_unit_id]);
            const unit = unitResult.rows[0];
            if (!unit)
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Compact unit not found.' } });
            if (unit.status !== 'Active') {
                return res.status(409).json({ error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: `Compact unit is ${unit.status.toLowerCase()} and cannot be selected.` } });
            }
            if (!(0, aquariumCalculations_1.compatibleWaterTypes)(intendedWaterType, unit.water_type)) {
                return res.status(409).json({
                    error: { code: 'INCOMPATIBLE_WATER_TYPE', message: `${unit.unit_code} is rated for ${unit.water_type}, not ${intendedWaterType}.` },
                });
            }
            const intendedFlow = Number(design_flow_m3h);
            if (Number.isFinite(intendedFlow) && unit.max_flow_m3h != null &&
                intendedFlow > Number(unit.max_flow_m3h)) {
                return res.status(409).json({
                    error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: `Design flow exceeds ${unit.unit_code}'s ${unit.max_flow_m3h} m³/h catalog limit.` },
                });
            }
            const linkedExhibitsResult = await (0, db_1.query)(`SELECT e.*
           FROM system_exhibit_links sel
           JOIN exhibits e ON e.id=sel.exhibit_id
           WHERE sel.system_id=$1`, [req.params.id]);
            const linkedExhibits = linkedExhibitsResult.rows;
            const exhibitIds = linkedExhibits.map((item) => item.id);
            if (exhibitIds.length > 0) {
                const [tankResult, hydraulicResult, substrateResult] = await Promise.all([
                    (0, db_1.query)('SELECT * FROM tanks WHERE exhibit_id = ANY($1::uuid[])', [exhibitIds]),
                    (0, db_1.query)('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [design_book_id, exhibitIds]),
                    (0, db_1.query)('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [design_book_id, exhibitIds]),
                ]);
                const calculations = linkedExhibits.map((linkedExhibit) => (0, aquariumCalculations_1.calculateExhibitHydraulics)(linkedExhibit, tankResult.rows.filter((item) => item.exhibit_id === linkedExhibit.id), hydraulicResult.rows.find((item) => item.exhibit_id === linkedExhibit.id), substrateResult.rows.find((item) => item.exhibit_id === linkedExhibit.id)));
                const invalidCalculation = calculations.find((item) => item.status === 'invalid');
                if (invalidCalculation) {
                    return res.status(409).json({
                        error: { code: 'INVALID_ENGINEERING_INPUTS', message: invalidCalculation.reasons.join(' ') },
                    });
                }
                const effectiveVolume = calculations.reduce((sum, item) => sum + (item.results.operating_volume_m3 || 0), 0);
                const calculatedFlow = calculations.reduce((sum, item) => sum + (item.results.total_return_flow_m3h || 0), 0);
                const suitability = (0, aquariumCalculations_1.evaluateCompactUnit)(unit, intendedWaterType, effectiveVolume, Number.isFinite(intendedFlow) && intendedFlow > 0 ? intendedFlow : calculatedFlow);
                if (!suitability.suitable) {
                    return res.status(409).json({
                        error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: suitability.reasons.join(' ') },
                    });
                }
            }
        }
        const result = await (0, db_1.query)(`UPDATE systems SET
        system_code=COALESCE($1,system_code), system_name=$2, system_type=$3,
        design_flow_m3h=$4, turnover_rate_hr=$5, water_type=$6, status=$7,
        duty_description=$8, redundancy_strategy=$9,
        loop1_flow_source=$10, loop1_filtration=$11, loop1_bio_degas_m3h=$12, loop1_link_bio_degas=$13,
        loop2_flow_source=$14, loop2_filtration=$15, loop2_bio_degas_m3h=$16, loop2_link_bio_degas=$17,
        loop3_flow_source=$18, loop3_filtration=$19, loop3_bio_degas_m3h=$20, loop3_link_bio_degas=$21,
        system_config=$22, compact_unit_id=$23,
        calculation_version=$24, last_calculated_at=NOW(), calculation_inputs=$25,
        updated_at=NOW()
       WHERE id=$26 RETURNING *`, [
            system_code || null, system_name, system_type,
            design_flow_m3h || null, turnover_rate_hr || null, water_type, status,
            duty_description, redundancy_strategy,
            loop1_flow_source || null, loop1_filtration || null,
            loop1_bio_degas_m3h ?? null, loop1_link_bio_degas ?? false,
            loop2_flow_source || null, loop2_filtration || null,
            loop2_bio_degas_m3h ?? null, loop2_link_bio_degas ?? false,
            loop3_flow_source || null, loop3_filtration || null,
            loop3_bio_degas_m3h ?? null, loop3_link_bio_degas ?? false,
            system_config || 'bespoke', compact_unit_id || null,
            aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            JSON.stringify({
                design_flow_m3h: design_flow_m3h ?? null,
                turnover_rate_hr: turnover_rate_hr ?? null,
                turnover_unit: 'cycles_per_hour',
                flow_unit: 'm3_per_hour',
                system_config: system_config || 'bespoke',
                compact_unit_id: compact_unit_id || null,
            }),
            req.params.id,
        ]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        await (0, audit_1.logAudit)(req.user.id, 'system', req.params.id, 'UPDATE', {
            summary: 'System details updated',
            system_name,
            system_type,
            status,
            design_flow_m3h,
            water_type,
        });
        res.json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'A system with that code already exists in this project.' } });
        }
        throw err;
    }
});
router.delete('/systems/:id', auth_1.authenticate, async (req, res) => {
    try {
        const result = await (0, db_1.query)('DELETE FROM systems WHERE id=$1 RETURNING id, system_code', [req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        res.json({ deleted: true, id: result.rows[0].id });
    }
    catch (err) {
        if (err.code === '23503') {
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'Cannot delete system — it has equipment or other items linked to it. Remove those first.' } });
        }
        throw err;
    }
});
router.post('/systems/:id/duplicate', auth_1.authenticate, async (req, res) => {
    const src = await (0, db_1.query)('SELECT * FROM systems WHERE id=$1', [req.params.id]);
    if (!src.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    const s = src.rows[0];
    const newCode = `${s.system_code}-COPY`;
    const result = await (0, db_1.query)(`INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, duty_description, redundancy_strategy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [newCode, s.project_id, s.area_id, s.exhibit_id, `${s.system_name} (Copy)`, s.system_type, s.design_flow_m3h, s.turnover_rate_hr, s.water_type, s.duty_description, s.redundancy_strategy]);
    res.status(201).json(result.rows[0]);
});
// SYSTEM ↔ EXHIBIT LINKS
router.get('/systems/:id/exhibit-links', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
     FROM system_exhibit_links sel
     JOIN exhibits e ON sel.exhibit_id = e.id
     WHERE sel.system_id = $1
     ORDER BY sel.sort_order, e.exhibit_code`, [req.params.id]);
    res.json(result.rows);
});
router.post('/systems/:id/exhibit-links', auth_1.authenticate, async (req, res) => {
    const { exhibit_id, link_type, flow_allocation_m3h, notes, sort_order } = req.body;
    if (!exhibit_id)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id is required' } });
    if (flow_allocation_m3h != null &&
        (!Number.isFinite(Number(flow_allocation_m3h)) || Number(flow_allocation_m3h) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Flow allocation must be a non-negative number.' } });
    }
    try {
        const ownership = await (0, db_1.query)(`SELECT s.project_id AS system_project_id, s.water_type AS system_water_type,
              e.project_id AS exhibit_project_id, e.water_type AS exhibit_water_type,
              e.exhibit_code
       FROM systems s CROSS JOIN exhibits e
       WHERE s.id=$1 AND e.id=$2`, [req.params.id, exhibit_id]);
        const candidate = ownership.rows[0];
        if (!candidate)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System or exhibit not found.' } });
        if (candidate.system_project_id !== candidate.exhibit_project_id) {
            return res.status(409).json({ error: { code: 'OWNERSHIP_MISMATCH', message: 'The exhibit and system must belong to the same project.' } });
        }
        if (!(0, aquariumCalculations_1.compatibleWaterTypes)(candidate.system_water_type, candidate.exhibit_water_type)) {
            return res.status(409).json({
                error: {
                    code: 'INCOMPATIBLE_WATER_TYPE',
                    message: `${candidate.exhibit_code} uses ${candidate.exhibit_water_type} water and cannot be linked to a ${candidate.system_water_type} system.`,
                },
            });
        }
        const allocationSource = flow_allocation_m3h != null ? 'manual_override' : 'calculated';
        const result = await (0, db_1.query)(`INSERT INTO system_exhibit_links
         (system_id, exhibit_id, link_type, flow_allocation_m3h, notes, sort_order, allocation_source, allocation_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       RETURNING *`, [req.params.id, exhibit_id, link_type || 'Primary', flow_allocation_m3h ?? null, notes || null, sort_order ?? 0, allocationSource]);
        const enriched = await (0, db_1.query)(`SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
       FROM system_exhibit_links sel JOIN exhibits e ON sel.exhibit_id = e.id WHERE sel.id = $1`, [result.rows[0].id]);
        res.status(201).json(enriched.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'This exhibit is already linked to the system.' } });
        throw err;
    }
});
router.put('/systems/:id/exhibit-links/:linkId', auth_1.authenticate, async (req, res) => {
    const { link_type, flow_allocation_m3h, notes } = req.body;
    if (flow_allocation_m3h != null &&
        (!Number.isFinite(Number(flow_allocation_m3h)) || Number(flow_allocation_m3h) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Flow allocation must be a non-negative number.' } });
    }
    const result = await (0, db_1.query)(`UPDATE system_exhibit_links
     SET link_type=$1, flow_allocation_m3h=$2, notes=$3,
         allocation_source=$4, allocation_updated_at=NOW()
     WHERE id=$5 AND system_id=$6 RETURNING *`, [link_type || 'Primary', flow_allocation_m3h ?? null, notes || null,
        flow_allocation_m3h != null ? 'manual_override' : 'calculated',
        req.params.linkId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
    const enriched = await (0, db_1.query)(`SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
     FROM system_exhibit_links sel JOIN exhibits e ON sel.exhibit_id = e.id WHERE sel.id = $1`, [result.rows[0].id]);
    res.json(enriched.rows[0]);
});
router.delete('/systems/:id/exhibit-links/:linkId', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('DELETE FROM system_exhibit_links WHERE id=$1 AND system_id=$2 RETURNING id', [req.params.linkId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
    res.json({ deleted: true });
});
// EQUIPMENT ITEMS (direct product-to-project/system relationship)
router.post('/equipment-items', auth_1.authenticate, async (req, res) => {
    const { equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
    if (!equip_code || !project_id)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'equip_code and project_id are required' } });
    try {
        const result = await (0, db_1.query)(`INSERT INTO project_equipment_items (equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [equip_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
            component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
        if (system_id)
            await (0, audit_1.logAudit)(req.user.id, 'system', system_id, 'ADD_EQUIPMENT', {
                summary: `Equipment ${equip_code.trim().toUpperCase()} added to system`,
                equip_code: equip_code.trim().toUpperCase(),
                description,
                quantity,
                unit,
            });
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'Equipment code already exists in this project' } });
        throw err;
    }
});
router.put('/equipment-items/:id', auth_1.authenticate, async (req, res) => {
    const { equip_code, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
    const result = await (0, db_1.query)(`UPDATE project_equipment_items SET equip_code=COALESCE($1,equip_code), system_id=$2, product_master_id=$3,
     component_id=$4, description=$5, quantity=$6, unit=$7, notes=$8, status=$9, updated_at=NOW()
     WHERE id=$10 RETURNING *`, [equip_code ? equip_code.trim().toUpperCase() : null, system_id || null, product_master_id || null,
        component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design', req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
    if (system_id)
        await (0, audit_1.logAudit)(req.user.id, 'system', system_id, 'UPDATE_EQUIPMENT', {
            summary: `Equipment ${result.rows[0].equip_code} updated`,
            equip_code: result.rows[0].equip_code,
            description,
            quantity,
            status,
        });
    res.json(result.rows[0]);
});
router.delete('/equipment-items/:id', auth_1.authenticate, async (req, res) => {
    const existing = await (0, db_1.query)('SELECT * FROM project_equipment_items WHERE id=$1', [req.params.id]);
    const item = existing.rows[0];
    const result = await (0, db_1.query)('DELETE FROM project_equipment_items WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
    if (item?.system_id)
        await (0, audit_1.logAudit)(req.user.id, 'system', item.system_id, 'REMOVE_EQUIPMENT', {
            summary: `Equipment ${item.equip_code} removed from system`,
            equip_code: item.equip_code,
            description: item.description,
        });
    res.json({ success: true });
});
// EQUIPMENT INSTANCES (legacy - kept for reference only)
router.get('/equipment-instances', auth_1.authenticate, async (req, res) => {
    const { page, page_size, offset } = paginate(req);
    const filters = [];
    const params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`ei.project_id = $${params.length}`);
    }
    if (req.query.system_id) {
        params.push(req.query.system_id);
        filters.push(`ei.system_id = $${params.length}`);
    }
    if (req.query.status) {
        params.push(req.query.status);
        filters.push(`ei.status = $${params.length}`);
    }
    if (req.query.q) {
        params.push(`%${req.query.q}%`);
        filters.push(`(ei.equipment_code ILIKE $${params.length} OR ei.equipment_name ILIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM equipment_instances ei ${where}`, params);
    params.push(page_size, offset);
    const result = await (0, db_1.query)(`SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id
     ${where} ORDER BY ei.equipment_code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});
router.get('/equipment-instances/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code, p.project_name, m.material_name
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id LEFT JOIN materials m ON ei.material_code=m.material_code
     WHERE ei.id::text=$1 OR ei.equipment_code=$1`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
    const documents = await (0, db_1.query)(`SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name FROM documents d LEFT JOIN users u ON d.created_by=u.id WHERE d.equipment_id=$1 ORDER BY d.document_type, d.document_code`, [result.rows[0].id]);
    res.json({ ...result.rows[0], documents: documents.rows });
});
router.post('/equipment-instances', auth_1.authenticate, async (req, res) => {
    const { equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference, product_master_id } = req.body;
    const result = await (0, db_1.query)('INSERT INTO equipment_instances (equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference]);
    const eq = result.rows[0];
    if (product_master_id && eq?.id) {
        await (0, db_1.query)('INSERT INTO product_usages (product_master_id, equipment_instance_id, project_id) VALUES ($1,$2,$3)', [product_master_id, eq.id, project_id]);
    }
    await (0, audit_1.logAudit)(req.user.id, 'equipment', eq.id, 'CREATE', {
        summary: `Equipment ${equipment_code} created`,
        equipment_code,
        equipment_name,
        equipment_type,
    });
    res.status(201).json(eq);
});
router.put('/equipment-instances/:id', auth_1.authenticate, async (req, res) => {
    const { equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date } = req.body;
    const result = await (0, db_1.query)('UPDATE equipment_instances SET equipment_name=$1, equipment_type=$2, design_flow_m3h=$3, design_head_m=$4, power_kw=$5, material_code=$6, status=$7, operational_duty=$8, serial_number=$9, installation_date=$10, commissioning_date=$11, updated_at=NOW() WHERE id=$12 RETURNING *', [equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'equipment', req.params.id, 'UPDATE', {
        summary: 'Equipment details updated',
        equipment_name,
        equipment_type,
        status,
        serial_number,
    });
    res.json(result.rows[0]);
});
// LIFECYCLE TRANSITIONS
router.post('/lifecycle/transition', auth_1.authenticate, async (req, res) => {
    const { entity_type, entity_id, to_state, comment } = req.body;
    if (!entity_type || !entity_id || !to_state)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'entity_type, entity_id, to_state required' } });
    const table = entity_type === 'system' ? 'systems' : entity_type === 'equipment' ? 'equipment_instances' : entity_type === 'document' ? 'documents' : null;
    let from_state = null;
    if (table) {
        const current = await (0, db_1.query)(`SELECT status FROM ${table} WHERE id=$1`, [entity_id]);
        from_state = current.rows[0]?.status;
        await (0, db_1.query)(`UPDATE ${table} SET status=$1, updated_at=NOW() WHERE id=$2`, [to_state, entity_id]);
    }
    await (0, db_1.query)('INSERT INTO lifecycle_transitions (entity_type, entity_id, from_state, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5,$6)', [entity_type, entity_id, from_state, to_state, req.user.id, comment]);
    await (0, audit_1.logAudit)(req.user.id, entity_type, entity_id, 'STATE_TRANSITION', {
        summary: `Status changed from ${from_state || 'Unknown'} → ${to_state}`,
        from: from_state,
        to: to_state,
        comment,
    });
    res.json({ success: true, from_state, to_state });
});
router.get('/lifecycle/:entity_type/:entity_id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT lt.*, u.first_name || \' \' || u.last_name as actor_name FROM lifecycle_transitions lt LEFT JOIN users u ON lt.actor_id=u.id WHERE lt.entity_type=$1 AND lt.entity_id=$2::uuid ORDER BY lt.transitioned_at ASC', [req.params.entity_type, req.params.entity_id]);
    res.json({ items: result.rows });
});
router.get('/audit/:entity_type/:entity_id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT al.*, u.first_name || ' ' || u.last_name as actor_name, u.email as actor_email
     FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id
     WHERE al.entity_type=$1 AND al.entity_id=$2
     ORDER BY al.created_at DESC LIMIT 200`, [req.params.entity_type, req.params.entity_id]);
    res.json({ items: result.rows });
});
// CHANGE REQUESTS
router.get('/change-requests', auth_1.authenticate, async (req, res) => {
    let where = '', params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        where = `WHERE cr.project_id=$1`;
    }
    const result = await (0, db_1.query)(`SELECT cr.*, u.first_name || ' ' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id ${where} ORDER BY cr.created_at DESC`, params);
    res.json({ items: result.rows });
});
router.post('/change-requests', auth_1.authenticate, async (req, res) => {
    const { project_id, title, change_reason, risk_level, affected_entities } = req.body;
    const change_code = `CR-${Date.now().toString(36).toUpperCase()}`;
    const result = await (0, db_1.query)('INSERT INTO change_requests (change_code, project_id, title, change_reason, risk_level, affected_entities, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [change_code, project_id, title, change_reason, risk_level || 'Medium', JSON.stringify(affected_entities || []), req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.put('/change-requests/:id', auth_1.authenticate, async (req, res) => {
    const { status, title, change_reason, risk_level } = req.body;
    const result = await (0, db_1.query)('UPDATE change_requests SET status=$1, title=$2, change_reason=$3, risk_level=$4, updated_at=NOW() WHERE id=$5 RETURNING *', [status, title, change_reason, risk_level, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Change request not found' } });
    res.json(result.rows[0]);
});
// PROJECT PIPING ITEMS
router.get('/projects/:id/piping', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT ppi.*, pm.product_code, pm.product_name, pm.application_type,
            s.system_code, s.system_name
     FROM project_piping_items ppi
     LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
     LEFT JOIN systems s ON ppi.system_id = s.id
     WHERE ppi.project_id = $1
     ORDER BY ppi.piping_code`, [req.params.id]);
    res.json({ items: result.rows });
});
router.post('/piping-items', auth_1.authenticate, async (req, res) => {
    const { piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status } = req.body;
    if (!piping_code || !project_id)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'piping_code and project_id are required' } });
    const result = await (0, db_1.query)(`INSERT INTO project_piping_items (piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [piping_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
        description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
    res.status(201).json(result.rows[0]);
});
router.put('/piping-items/:id', auth_1.authenticate, async (req, res) => {
    const { description, quantity, unit, notes, status, system_id } = req.body;
    const result = await (0, db_1.query)(`UPDATE project_piping_items SET description=$1, quantity=$2, unit=$3, notes=$4, status=$5, system_id=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`, [description || null, quantity || 1, unit || 'EA', notes || null, status, system_id || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Piping item not found' } });
    res.json(result.rows[0]);
});
router.delete('/piping-items/:id', auth_1.authenticate, async (req, res) => {
    await (0, db_1.query)('DELETE FROM project_piping_items WHERE id=$1', [req.params.id]);
    res.json({ success: true });
});
// BOM RELEASES
router.get('/projects/:id/bom-releases', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name,
            (SELECT COUNT(*) FROM bom_release_lines WHERE bom_release_id = br.id) as line_count
     FROM bom_releases br
     LEFT JOIN users u ON br.created_by = u.id
     WHERE br.project_id = $1
     ORDER BY br.created_at DESC`, [req.params.id]);
    res.json({ items: result.rows });
});
router.get('/bom-releases/:id', auth_1.authenticate, async (req, res) => {
    const release = await (0, db_1.query)(`SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name
     FROM bom_releases br LEFT JOIN users u ON br.created_by=u.id
     WHERE br.id=$1`, [req.params.id]);
    if (!release.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
    const lines = await (0, db_1.query)('SELECT * FROM bom_release_lines WHERE bom_release_id=$1 ORDER BY section, line_number', [req.params.id]);
    res.json({ ...release.rows[0], lines: lines.rows });
});
router.post('/bom-releases', auth_1.authenticate, async (req, res) => {
    const { project_id, title, revision, notes, include_sections } = req.body;
    if (!project_id)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_id is required' } });
    const sections = Array.isArray(include_sections) && include_sections.length > 0
        ? include_sections
        : ['Products', 'Tank', 'Piping'];
    const countResult = await (0, db_1.query)('SELECT COUNT(*) FROM bom_releases WHERE project_id=$1', [project_id]);
    const num = (parseInt(countResult.rows[0].count) + 1).toString().padStart(3, '0');
    const projResult = await (0, db_1.query)('SELECT project_code FROM projects WHERE id=$1', [project_id]);
    const projectCode = projResult.rows[0]?.project_code || 'PRJ';
    const release_code = `BOM-${projectCode}-${num}`;
    const result = await (0, db_1.query)(`INSERT INTO bom_releases (release_code, project_id, title, revision, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [release_code, project_id, title || `BOM Release ${num}`, revision || 'A', notes || null, req.user.id]);
    const releaseId = result.rows[0].id;
    let lineNum = 1;
    if (sections.includes('Products')) {
        const equipment = await (0, db_1.query)(`SELECT pei.equip_code as tag_code,
              COALESCE(pei.description, pm.product_name) as description,
              pm.product_code, pm.product_name, pei.quantity, pei.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_equipment_items pei
       LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
       LEFT JOIN systems s ON pei.system_id = s.id
       WHERE pei.project_id = $1
       ORDER BY pei.equip_code`, [project_id]);
        for (const row of equipment.rows) {
            await (0, db_1.query)(`INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Products',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
        }
    }
    if (sections.includes('Tank')) {
        const tanks = await (0, db_1.query)(`SELECT t.tank_code as tag_code, t.tank_name as description,
              pm.product_code, pm.product_name, 1 as quantity, 'EA' as unit,
              NULL as system_ref, a.area_name as area_ref
       FROM tanks t
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
       LEFT JOIN areas a ON t.area_id = a.id
       WHERE t.project_id = $1
       ORDER BY t.tank_code`, [project_id]);
        for (const row of tanks.rows) {
            await (0, db_1.query)(`INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Tank',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
        }
    }
    if (sections.includes('Piping')) {
        const piping = await (0, db_1.query)(`SELECT ppi.piping_code as tag_code, COALESCE(ppi.description, pm.product_name) as description,
              pm.product_code, pm.product_name, ppi.quantity, ppi.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_piping_items ppi
       LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
       LEFT JOIN systems s ON ppi.system_id = s.id
       WHERE ppi.project_id = $1
       ORDER BY ppi.piping_code`, [project_id]);
        for (const row of piping.rows) {
            await (0, db_1.query)(`INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Piping',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
        }
    }
    const final = await (0, db_1.query)('SELECT * FROM bom_releases WHERE id=$1', [releaseId]);
    res.status(201).json(final.rows[0]);
});
router.get('/projects/:id/items-for-po', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const projectId = proj.rows[0].id;
    const equipment = await (0, db_1.query)(`WITH released_eq AS (
       SELECT DISTINCT ON (pi.project_equipment_item_id)
         pi.project_equipment_item_id, pi.po_id, po.po_code
       FROM po_items pi
       JOIN purchase_orders po ON pi.po_id = po.id
       WHERE pi.project_equipment_item_id IS NOT NULL
       ORDER BY pi.project_equipment_item_id, pi.created_at DESC
     )
     SELECT pei.id, pei.equip_code AS tag_code,
            COALESCE(pei.description, pm.product_name) AS description,
            pm.id AS product_master_id, pm.product_code, pm.product_name,
            pm.cost, pm.sell_price,
            pei.quantity, pei.unit,
            s.id AS system_id, s.system_code, s.system_name,
            r.po_id AS released_po_id, r.po_code AS released_po_code
     FROM project_equipment_items pei
     LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
     LEFT JOIN systems s ON pei.system_id = s.id
     LEFT JOIN released_eq r ON r.project_equipment_item_id = pei.id
     WHERE pei.project_id = $1 AND pei.product_master_id IS NOT NULL
     ORDER BY s.system_code NULLS LAST, pei.equip_code`, [projectId]);
    const tanks = await (0, db_1.query)(`WITH released_tanks AS (
       SELECT DISTINCT ON (pi.tank_id)
         pi.tank_id, pi.po_id, po.po_code
       FROM po_items pi
       JOIN purchase_orders po ON pi.po_id = po.id
       WHERE pi.tank_id IS NOT NULL
       ORDER BY pi.tank_id, pi.created_at DESC
     )
     SELECT t.id, t.tank_code AS tag_code, t.tank_name AS description,
            pm.id AS product_master_id, pm.product_code, pm.product_name,
            pm.cost, pm.sell_price,
            COALESCE(t.quantity, 1) AS quantity, 'EA' AS unit,
            NULL::uuid AS system_id, NULL AS system_code, NULL AS system_name,
            r.po_id AS released_po_id, r.po_code AS released_po_code
     FROM tanks t
     LEFT JOIN product_masters pm ON t.product_master_id = pm.id
     LEFT JOIN released_tanks r ON r.tank_id = t.id
     WHERE t.project_id = $1 AND t.product_master_id IS NOT NULL
     ORDER BY t.tank_code`, [projectId]);
    res.json({ equipment: equipment.rows, tanks: tanks.rows });
});
router.post('/bom-releases/:id/issue', auth_1.authenticate, async (req, res) => {
    const { issued_date } = req.body;
    const result = await (0, db_1.query)(`UPDATE bom_releases SET status='Issued', issued_date=COALESCE($1::date, CURRENT_DATE), updated_at=NOW()
     WHERE id=$2 AND status='Draft' RETURNING *`, [issued_date || null, req.params.id]);
    if (!result.rows[0])
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Release not found or already issued' } });
    res.json(result.rows[0]);
});
router.delete('/bom-releases/:id', auth_1.authenticate, async (req, res) => {
    const check = await (0, db_1.query)('SELECT status FROM bom_releases WHERE id=$1', [req.params.id]);
    if (!check.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
    if (check.rows[0].status === 'Issued')
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Cannot delete an issued release' } });
    await (0, db_1.query)('DELETE FROM bom_releases WHERE id=$1', [req.params.id]);
    res.json({ success: true });
});
exports.default = router;
