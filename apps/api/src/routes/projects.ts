import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logAudit } from '../db/audit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const logoStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `logo-${unique}${path.extname(file.originalname)}`);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

const paginate = (req: any) => {
  const page = parseInt(req.query.page) || 1;
  const page_size = Math.min(parseInt(req.query.page_size) || 25, 200);
  const offset = (page - 1) * page_size;
  return { page, page_size, offset };
};

const buildSort = (sort?: string, allowed = ['project_code', 'project_name', 'project_status', 'created_at']) => {
  if (!sort) return 'created_at DESC';
  const dir = sort.startsWith('-') ? 'DESC' : 'ASC';
  const col = sort.replace(/^-/, '');
  return allowed.includes(col) ? `${col} ${dir}` : 'created_at DESC';
};

// PROJECTS
router.get('/projects', authenticate, async (req: AuthRequest, res: Response) => {
  const { page, page_size, offset } = paginate(req);
  const filters: string[] = [];
  const params: any[] = [];

  if (req.query.status) { params.push(req.query.status); filters.push(`project_status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); filters.push(`(project_name ILIKE $${params.length} OR project_code ILIKE $${params.length})`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const sort = buildSort(req.query.sort as string);

  const countRes = await query(`SELECT COUNT(*) FROM projects ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  params.push(page_size, offset);
  const result = await query(`SELECT * FROM projects ${where} ORDER BY ${sort} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({ items: result.rows, pagination: { page, page_size, total } });
});

router.get('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  res.json(result.rows[0]);
});

router.post('/projects', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes } = req.body;
  if (!project_code || !project_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_code and project_name required' } });
  const toDate = (v: any) => (v === '' || v == null) ? null : v;
  const toStr  = (v: any) => (v === '' || v == null) ? null : String(v);
  const result = await query(
    `INSERT INTO projects (project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [project_code, project_name, toStr(client_name), toStr(site_name), toStr(country), toStr(city), toStr(timezone), project_status || 'Concept', toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), req.user!.id]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_name, client_name, site_name, country, city, latitude, longitude, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes } = req.body;
  const toDate = (v: any) => (v === '' || v == null) ? null : v;
  const toNum  = (v: any) => (v === '' || v == null) ? null : Number(v);
  const toStr  = (v: any) => (v === '' || v == null) ? null : String(v);
  const result = await query(
    `UPDATE projects SET project_name=$1, client_name=$2, site_name=$3, country=$4, city=$5, latitude=$6, longitude=$7, project_status=$8, start_date=$9, target_completion_date=$10, project_manager=$11, engineering_manager=$12, qa_owner=$13, notes=$14, updated_at=NOW()
     WHERE id=$15 RETURNING *`,
    [toStr(project_name), toStr(client_name), toStr(site_name), toStr(country), toStr(city), toNum(latitude), toNum(longitude), project_status, toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  res.json(result.rows[0]);
});

router.delete('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

router.post('/projects/:id/logo', authenticate, uploadLogo.single('logo'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'Image file required' } });
  const logoUrl = `/uploads/${req.file.filename}`;
  const result = await query(
    'UPDATE projects SET logo_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [logoUrl, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  res.json(result.rows[0]);
});

// AREAS
router.get('/projects/:id/areas', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query('SELECT * FROM areas WHERE project_id = $1 ORDER BY area_code', [proj.rows[0].id]);
  res.json({ items: result.rows });
});

router.get('/projects/:id/systems', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query(
    `SELECT s.*, a.area_name, e.exhibit_name,
      COALESCE(SUM(t.quantity), 0)::int AS tank_count,
      COALESCE(SUM(
        CASE WHEN COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
              AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
              AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
          THEN COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0 * t.quantity
          ELSE 0 END
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
     ORDER BY s.system_code`,
    [proj.rows[0].id]);
  res.json({ items: result.rows });
});

router.get('/projects/:id/equipment', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query(
    `SELECT pei.*, s.system_code, s.system_name, pm.product_code, pm.product_name
     FROM project_equipment_items pei
     LEFT JOIN systems s ON pei.system_id = s.id
     LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
     WHERE pei.project_id = $1 ORDER BY pei.equip_code`, [proj.rows[0].id]);
  res.json({ items: result.rows });
});

router.get('/projects/:id/documents', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query('SELECT * FROM documents WHERE project_id = $1 ORDER BY document_code', [proj.rows[0].id]);
  res.json({ items: result.rows });
});

router.get('/projects/:id/change-requests', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query('SELECT cr.*, u.first_name || \' \' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id WHERE cr.project_id = $1 ORDER BY cr.created_at DESC', [proj.rows[0].id]);
  res.json({ items: result.rows });
});

// AREAS standalone
router.get('/areas', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT a.*, p.project_code FROM areas a JOIN projects p ON a.project_id=p.id ORDER BY a.area_code');
  res.json({ items: result.rows });
});

router.get('/areas/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT a.*, p.project_code, p.project_name FROM areas a JOIN projects p ON a.project_id=p.id WHERE a.id = $1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Area not found' } });
  res.json(result.rows[0]);
});

router.post('/areas', authenticate, async (req: AuthRequest, res: Response) => {
  const { area_code, project_id, area_name, discipline_scope, notes } = req.body;
  const result = await query('INSERT INTO areas (area_code, project_id, area_name, discipline_scope, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *', [area_code, project_id, area_name, discipline_scope, notes]);
  res.status(201).json(result.rows[0]);
});

// EXHIBITS
router.get('/exhibits', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT e.*, a.area_name, p.project_code FROM exhibits e JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id ORDER BY e.exhibit_code');
  res.json({ items: result.rows });
});

router.get('/exhibits/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT e.*, a.area_name, p.project_code, p.project_name FROM exhibits e JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id WHERE e.id=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
  res.json(result.rows[0]);
});

router.post('/exhibits', authenticate, async (req: AuthRequest, res: Response) => {
  const { exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity } = req.body;
  const result = await query('INSERT INTO exhibits (exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity]);
  res.status(201).json(result.rows[0]);
});

// TANKS
router.get('/tanks', authenticate, async (req: AuthRequest, res: Response) => {
  const filters: string[] = [], params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`t.project_id = $${params.length}`); }
  if (req.query.system_id) { params.push(req.query.system_id); filters.push(`t.system_id = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  // Auto-create missing tank_instances rows for multi-unit tanks (idempotent)
  const instanceFilters = ['t.quantity > 1', ...filters];
  await query(
    `INSERT INTO tank_instances (tank_id, instance_index, tag)
     SELECT t.id, gs.i,
       t.tank_code || '-' || LPAD(gs.i::text, CASE WHEN t.quantity > 99 THEN 3 WHEN t.quantity > 9 THEN 2 ELSE 1 END, '0')
     FROM tanks t
     CROSS JOIN LATERAL generate_series(1, t.quantity) AS gs(i)
     WHERE ${instanceFilters.join(' AND ')}
       AND NOT EXISTS (
         SELECT 1 FROM tank_instances ti WHERE ti.tank_id = t.id AND ti.instance_index = gs.i
       )
     ON CONFLICT (tank_id, instance_index) DO NOTHING`,
    params
  );

  const result = await query(
    `SELECT t.*, e.exhibit_name, p.project_code,
      s.system_code, s.system_name,
      pm.product_code, pm.product_name as product_name, pm.application_type as product_type,
      pm.primary_material_code as product_material,
      COALESCE(t.shape_type, pm.shape_type) as eff_shape,
      COALESCE(t.length_mm, pm.length_mm) as eff_length_mm,
      COALESCE(t.width_mm, pm.width_mm) as eff_width_mm,
      COALESCE(t.height_mm, pm.height_mm) as eff_height_mm,
      COALESCE(t.design_water_level_mm, pm.design_water_level_mm) as eff_water_level_mm,
      CASE WHEN COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
            AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
            AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
        THEN ROUND(COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0,4)
        ELSE NULL END as gross_volume_m3,
      CASE WHEN COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
            AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
            AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
        THEN ROUND(COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0,4)
        ELSE NULL END as design_volume_m3,
      COALESCE(
        (SELECT json_agg(ti ORDER BY ti.instance_index)
         FROM tank_instances ti WHERE ti.tank_id = t.id),
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

router.get('/tanks/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT t.*, e.exhibit_name, p.project_code, p.project_name,
      pm.product_code, pm.product_name as product_name, pm.application_type as product_type,
      pm.primary_material_code as product_material,
      COALESCE(t.shape_type, pm.shape_type) as eff_shape,
      COALESCE(t.length_mm, pm.length_mm) as eff_length_mm,
      COALESCE(t.width_mm, pm.width_mm) as eff_width_mm,
      COALESCE(t.height_mm, pm.height_mm) as eff_height_mm,
      COALESCE(t.design_water_level_mm, pm.design_water_level_mm) as eff_water_level_mm,
      CASE WHEN COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
            AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
            AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
        THEN ROUND(COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0,4)
        ELSE NULL END as gross_volume_m3,
      CASE WHEN COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
            AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
            AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
        THEN ROUND(COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0,4)
        ELSE NULL END as design_volume_m3
     FROM tanks t LEFT JOIN exhibits e ON t.exhibit_id=e.id JOIN projects p ON t.project_id=p.id
     LEFT JOIN product_masters pm ON t.product_master_id=pm.id WHERE t.id=$1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  res.json(result.rows[0]);
});

router.post('/tanks', authenticate, async (req: AuthRequest, res: Response) => {
  const { tank_code, project_id, tank_name, tank_type, product_master_id, system_id, quantity, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes } = req.body;
  if (!tank_code || !project_id || !tank_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tank_code, project_id and tank_name required' } });
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
  const result = await query(
    'INSERT INTO tanks (tank_code, project_id, system_id, quantity, tank_name, tank_type, product_master_id, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',
    [tank_code, project_id, system_id || null, qty, tank_name, tank_type || null, product_master_id || null, shape_type || null, calcGross, calcOp, l, w, h, wl, primary_material || null, status || 'Active', notes || null]);
  const tank = result.rows[0];
  if (qty > 1) {
    const pad = qty > 99 ? 3 : qty > 9 ? 2 : 1;
    const instanceRows = Array.from({ length: qty }, (_, i) => ({
      tank_id: tank.id,
      instance_index: i + 1,
      tag: `${tank_code.toUpperCase()}-${String(i + 1).padStart(pad, '0')}`,
    }));
    for (const inst of instanceRows) {
      await query(
        'INSERT INTO tank_instances (tank_id, instance_index, tag) VALUES ($1,$2,$3) ON CONFLICT (tank_id, instance_index) DO NOTHING',
        [inst.tank_id, inst.instance_index, inst.tag]);
    }
  }
  res.status(201).json(tank);
});

router.patch('/tanks/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { system_id, product_master_id } = req.body;
    const hasPM = 'product_master_id' in req.body;
    const result = hasPM
      ? await query(
          'UPDATE tanks SET system_id=$1, product_master_id=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
          [system_id !== undefined ? (system_id || null) : undefined, product_master_id || null, req.params.id])
      : await query(
          'UPDATE tanks SET system_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
          [system_id || null, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json(result.rows[0]);
  } catch (err: any) { throw err; }
});

router.put('/tanks/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { tank_code, tank_name, tank_type, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes, quantity, gross_volume_m3, operating_volume_m3, system_id } = req.body;
  if (!tank_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tank_name is required' } });
  const l = length_mm ? parseFloat(length_mm) : null;
  const w = width_mm ? parseFloat(width_mm) : null;
  const h = height_mm ? parseFloat(height_mm) : null;
  const wl = design_water_level_mm ? parseFloat(design_water_level_mm) : null;
  const isCustom = (shape_type || '').toLowerCase() === 'custom';
  const isCyl = (shape_type || '').toLowerCase() === 'cylindrical';
  const calcGross = isCustom
    ? (gross_volume_m3 != null && gross_volume_m3 !== '' ? parseFloat(gross_volume_m3) : null)
    : isCyl
      ? (w && h ? Math.round(Math.PI * (w / 2) * (w / 2) * h / 1e9 * 1e4) / 1e4 : null)
      : (l && w && h ? Math.round(l * w * h / 1e9 * 1e4) / 1e4 : null);
  const calcOp = isCustom
    ? (operating_volume_m3 != null && operating_volume_m3 !== '' ? parseFloat(operating_volume_m3) : null)
    : isCyl
      ? (w && wl ? Math.round(Math.PI * (w / 2) * (w / 2) * wl / 1e9 * 1e4) / 1e4 : null)
      : (l && w && wl ? Math.round(l * w * wl / 1e9 * 1e4) / 1e4 : null);
  const qty = Math.max(1, parseInt(quantity) || 1);
  const result = await query(
    `UPDATE tanks SET
      tank_code=COALESCE($1, tank_code), tank_name=$2, tank_type=$3, shape_type=$4,
      length_mm=$5, width_mm=$6, height_mm=$7, design_water_level_mm=$8,
      gross_volume_m3=$9, operating_volume_m3=$10,
      primary_material=$11, status=$12, notes=$13, quantity=$14,
      system_id=$15, updated_at=NOW()
    WHERE id=$16 RETURNING *`,
    [tank_code ? tank_code.trim().toUpperCase() : null, tank_name, tank_type || null, shape_type || null,
     l, w, h, wl, calcGross, calcOp,
     primary_material || null, status || 'Active', notes || null, qty,
     system_id || null,
     req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  res.json(result.rows[0]);
});

router.patch('/tanks/reorder', authenticate, async (req: AuthRequest, res: Response) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'orderedIds must be an array' } });
  for (let i = 0; i < orderedIds.length; i++) {
    await query('UPDATE tanks SET sort_order=$1 WHERE id=$2', [i, orderedIds[i]]);
  }
  res.json({ ok: true });
});

router.delete('/tanks/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM tank_instances WHERE tank_id=$1', [req.params.id]);
  const result = await query('DELETE FROM tanks WHERE id=$1 RETURNING id, tank_code', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  res.json({ deleted: true });
});

router.patch('/tank-instances/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { tag } = req.body;
  if (!tag || !tag.trim()) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tag is required' } });
  const result = await query(
    'UPDATE tank_instances SET tag=$1 WHERE id=$2 RETURNING *',
    [tag.trim().toUpperCase(), req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank instance not found' } });
  res.json(result.rows[0]);
});

// SYSTEMS
router.get('/systems', authenticate, async (req: AuthRequest, res: Response) => {
  const { page, page_size, offset } = paginate(req);
  const filters: string[] = [];
  const params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`s.project_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`s.status = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM systems s ${where}`, params);
  params.push(page_size, offset);
  const result = await query(`SELECT s.*, a.area_name, e.exhibit_name, p.project_code FROM systems s LEFT JOIN areas a ON s.area_id=a.id LEFT JOIN exhibits e ON s.exhibit_id=e.id JOIN projects p ON s.project_id=p.id ${where} ORDER BY s.system_code LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});

router.get('/systems/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT s.*, a.area_name, e.exhibit_name, p.project_code, p.project_name FROM systems s LEFT JOIN areas a ON s.area_id=a.id LEFT JOIN exhibits e ON s.exhibit_id=e.id JOIN projects p ON s.project_id=p.id WHERE s.id::text=$1 OR s.system_code=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  const sysId = result.rows[0].id;
  const [equipment, tanks] = await Promise.all([
    query(
      `SELECT pei.*, pm.product_code, pm.product_name, c.component_code, c.component_name,
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
    query(
      `SELECT t.id, t.tank_code, t.tank_name, t.tank_type, t.quantity,
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

router.post('/systems', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type } = req.body;
    if (!system_code || !project_id || !system_name) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'system_code, project_id and system_name are required' } });
    }
    const result = await query('INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [system_code, project_id, area_id || null, exhibit_id || null, system_name, system_type, design_flow_m3h || null, turnover_rate_hr || null, water_type]);
    await logAudit(req.user!.id, 'system', result.rows[0].id, 'CREATE', { system_code, system_name, system_type });
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: `System code "${req.body.system_code}" already exists in this project. Use a different code.` } });
    }
    throw err;
  }
});

router.put('/systems/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { system_code, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, status, duty_description, redundancy_strategy } = req.body;
    const result = await query(
      'UPDATE systems SET system_code=COALESCE($1,system_code), system_name=$2, system_type=$3, design_flow_m3h=$4, turnover_rate_hr=$5, water_type=$6, status=$7, duty_description=$8, redundancy_strategy=$9, updated_at=NOW() WHERE id=$10 RETURNING *',
      [system_code || null, system_name, system_type, design_flow_m3h || null, turnover_rate_hr || null, water_type, status, duty_description, redundancy_strategy, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    await logAudit(req.user!.id, 'system', req.params.id, 'UPDATE', { system_name, system_type, status, design_flow_m3h, water_type });
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'A system with that code already exists in this project.' } });
    }
    throw err;
  }
});

router.delete('/systems/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('DELETE FROM systems WHERE id=$1 RETURNING id, system_code', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err: any) {
    if (err.code === '23503') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Cannot delete system — it has equipment or other items linked to it. Remove those first.' } });
    }
    throw err;
  }
});

router.post('/systems/:id/duplicate', authenticate, async (req: AuthRequest, res: Response) => {
  const src = await query('SELECT * FROM systems WHERE id=$1', [req.params.id]);
  if (!src.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  const s = src.rows[0];
  const newCode = `${s.system_code}-COPY`;
  const result = await query(
    `INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, duty_description, redundancy_strategy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [newCode, s.project_id, s.area_id, s.exhibit_id, `${s.system_name} (Copy)`, s.system_type, s.design_flow_m3h, s.turnover_rate_hr, s.water_type, s.duty_description, s.redundancy_strategy]);
  res.status(201).json(result.rows[0]);
});

// EQUIPMENT ITEMS (direct product-to-project/system relationship)
router.post('/equipment-items', authenticate, async (req: AuthRequest, res: Response) => {
  const { equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
  if (!equip_code || !project_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'equip_code and project_id are required' } });
  try {
    const result = await query(
      `INSERT INTO project_equipment_items (equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [equip_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
       component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
    if (system_id) await logAudit(req.user!.id, 'system', system_id, 'ADD_EQUIPMENT', { equip_code: equip_code.trim().toUpperCase(), description, quantity, unit });
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Equipment code already exists in this project' } });
    throw err;
  }
});

router.put('/equipment-items/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { equip_code, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
  const result = await query(
    `UPDATE project_equipment_items SET equip_code=COALESCE($1,equip_code), system_id=$2, product_master_id=$3,
     component_id=$4, description=$5, quantity=$6, unit=$7, notes=$8, status=$9, updated_at=NOW()
     WHERE id=$10 RETURNING *`,
    [equip_code ? equip_code.trim().toUpperCase() : null, system_id || null, product_master_id || null,
     component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design', req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
  if (system_id) await logAudit(req.user!.id, 'system', system_id, 'UPDATE_EQUIPMENT', { equip_code: result.rows[0].equip_code, description, quantity, status });
  res.json(result.rows[0]);
});

router.delete('/equipment-items/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT * FROM project_equipment_items WHERE id=$1', [req.params.id]);
  const item = existing.rows[0];
  const result = await query('DELETE FROM project_equipment_items WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
  if (item?.system_id) await logAudit(req.user!.id, 'system', item.system_id, 'REMOVE_EQUIPMENT', { equip_code: item.equip_code, description: item.description });
  res.json({ success: true });
});

// EQUIPMENT INSTANCES (legacy - kept for reference only)
router.get('/equipment-instances', authenticate, async (req: AuthRequest, res: Response) => {
  const { page, page_size, offset } = paginate(req);
  const filters: string[] = [];
  const params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`ei.project_id = $${params.length}`); }
  if (req.query.system_id) { params.push(req.query.system_id); filters.push(`ei.system_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`ei.status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); filters.push(`(ei.equipment_code ILIKE $${params.length} OR ei.equipment_name ILIKE $${params.length})`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM equipment_instances ei ${where}`, params);
  params.push(page_size, offset);
  const result = await query(
    `SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id
     ${where} ORDER BY ei.equipment_code LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});

router.get('/equipment-instances/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code, p.project_name, m.material_name
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id LEFT JOIN materials m ON ei.material_code=m.material_code
     WHERE ei.id::text=$1 OR ei.equipment_code=$1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
  const documents = await query(
    `SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name FROM documents d LEFT JOIN users u ON d.created_by=u.id WHERE d.equipment_id=$1 ORDER BY d.document_type, d.document_code`,
    [result.rows[0].id]);
  res.json({ ...result.rows[0], documents: documents.rows });
});

router.post('/equipment-instances', authenticate, async (req: AuthRequest, res: Response) => {
  const { equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference, product_master_id } = req.body;
  const result = await query(
    'INSERT INTO equipment_instances (equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference]);
  const eq = result.rows[0];
  if (product_master_id && eq?.id) {
    await query(
      'INSERT INTO product_usages (product_master_id, equipment_instance_id, project_id) VALUES ($1,$2,$3)',
      [product_master_id, eq.id, project_id]
    );
  }
  await logAudit(req.user!.id, 'equipment', eq.id, 'CREATE', { equipment_code, equipment_name, equipment_type });
  res.status(201).json(eq);
});

router.put('/equipment-instances/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date } = req.body;
  const result = await query(
    'UPDATE equipment_instances SET equipment_name=$1, equipment_type=$2, design_flow_m3h=$3, design_head_m=$4, power_kw=$5, material_code=$6, status=$7, operational_duty=$8, serial_number=$9, installation_date=$10, commissioning_date=$11, updated_at=NOW() WHERE id=$12 RETURNING *',
    [equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
  await logAudit(req.user!.id, 'equipment', req.params.id, 'UPDATE', { equipment_name, equipment_type, status, serial_number });
  res.json(result.rows[0]);
});

// LIFECYCLE TRANSITIONS
router.post('/lifecycle/transition', authenticate, async (req: AuthRequest, res: Response) => {
  const { entity_type, entity_id, to_state, comment } = req.body;
  if (!entity_type || !entity_id || !to_state) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'entity_type, entity_id, to_state required' } });

  const table = entity_type === 'system' ? 'systems' : entity_type === 'equipment' ? 'equipment_instances' : entity_type === 'document' ? 'documents' : null;

  let from_state = null;
  if (table) {
    const current = await query(`SELECT status FROM ${table} WHERE id=$1`, [entity_id]);
    from_state = current.rows[0]?.status;
    await query(`UPDATE ${table} SET status=$1, updated_at=NOW() WHERE id=$2`, [to_state, entity_id]);
  }

  await query('INSERT INTO lifecycle_transitions (entity_type, entity_id, from_state, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5,$6)',
    [entity_type, entity_id, from_state, to_state, req.user!.id, comment]);

  await query('INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details) VALUES ($1,$2,$3,$4,$5)',
    [entity_type, entity_id, 'STATE_TRANSITION', req.user!.id, JSON.stringify({ from: from_state, to: to_state, comment })]);

  res.json({ success: true, from_state, to_state });
});

router.get('/lifecycle/:entity_type/:entity_id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    'SELECT lt.*, u.first_name || \' \' || u.last_name as actor_name FROM lifecycle_transitions lt LEFT JOIN users u ON lt.actor_id=u.id WHERE lt.entity_type=$1 AND lt.entity_id=$2::uuid ORDER BY lt.transitioned_at ASC',
    [req.params.entity_type, req.params.entity_id]);
  res.json({ items: result.rows });
});

router.get('/audit/:entity_type/:entity_id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT al.*, u.first_name || ' ' || u.last_name as actor_name, u.email as actor_email
     FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id
     WHERE al.entity_type=$1 AND al.entity_id=$2
     ORDER BY al.created_at DESC LIMIT 200`,
    [req.params.entity_type, req.params.entity_id]);
  res.json({ items: result.rows });
});

// CHANGE REQUESTS
router.get('/change-requests', authenticate, async (req: AuthRequest, res: Response) => {
  let where = '', params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); where = `WHERE cr.project_id=$1`; }
  const result = await query(`SELECT cr.*, u.first_name || ' ' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id ${where} ORDER BY cr.created_at DESC`, params);
  res.json({ items: result.rows });
});

router.post('/change-requests', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, title, change_reason, risk_level, affected_entities } = req.body;
  const change_code = `CR-${Date.now().toString(36).toUpperCase()}`;
  const result = await query(
    'INSERT INTO change_requests (change_code, project_id, title, change_reason, risk_level, affected_entities, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [change_code, project_id, title, change_reason, risk_level || 'Medium', JSON.stringify(affected_entities || []), req.user!.id]);
  res.status(201).json(result.rows[0]);
});

router.put('/change-requests/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { status, title, change_reason, risk_level } = req.body;
  const result = await query('UPDATE change_requests SET status=$1, title=$2, change_reason=$3, risk_level=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
    [status, title, change_reason, risk_level, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Change request not found' } });
  res.json(result.rows[0]);
});

// PROJECT PIPING ITEMS
router.get('/projects/:id/piping', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT ppi.*, pm.product_code, pm.product_name, pm.application_type,
            s.system_code, s.system_name
     FROM project_piping_items ppi
     LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
     LEFT JOIN systems s ON ppi.system_id = s.id
     WHERE ppi.project_id = $1
     ORDER BY ppi.piping_code`,
    [req.params.id]);
  res.json({ items: result.rows });
});

router.post('/piping-items', authenticate, async (req: AuthRequest, res: Response) => {
  const { piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status } = req.body;
  if (!piping_code || !project_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'piping_code and project_id are required' } });
  const result = await query(
    `INSERT INTO project_piping_items (piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [piping_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
     description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
  res.status(201).json(result.rows[0]);
});

router.put('/piping-items/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { description, quantity, unit, notes, status, system_id } = req.body;
  const result = await query(
    `UPDATE project_piping_items SET description=$1, quantity=$2, unit=$3, notes=$4, status=$5, system_id=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [description || null, quantity || 1, unit || 'EA', notes || null, status, system_id || null, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Piping item not found' } });
  res.json(result.rows[0]);
});

router.delete('/piping-items/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM project_piping_items WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// BOM RELEASES
router.get('/projects/:id/bom-releases', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name,
            (SELECT COUNT(*) FROM bom_release_lines WHERE bom_release_id = br.id) as line_count
     FROM bom_releases br
     LEFT JOIN users u ON br.created_by = u.id
     WHERE br.project_id = $1
     ORDER BY br.created_at DESC`,
    [req.params.id]);
  res.json({ items: result.rows });
});

router.get('/bom-releases/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const release = await query(
    `SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name
     FROM bom_releases br LEFT JOIN users u ON br.created_by=u.id
     WHERE br.id=$1`, [req.params.id]);
  if (!release.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
  const lines = await query(
    'SELECT * FROM bom_release_lines WHERE bom_release_id=$1 ORDER BY section, line_number',
    [req.params.id]);
  res.json({ ...release.rows[0], lines: lines.rows });
});

router.post('/bom-releases', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, title, revision, notes, include_sections } = req.body;
  if (!project_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_id is required' } });

  const sections: string[] = Array.isArray(include_sections) && include_sections.length > 0
    ? include_sections
    : ['Products', 'Tank', 'Piping'];

  const countResult = await query('SELECT COUNT(*) FROM bom_releases WHERE project_id=$1', [project_id]);
  const num = (parseInt(countResult.rows[0].count) + 1).toString().padStart(3, '0');
  const projResult = await query('SELECT project_code FROM projects WHERE id=$1', [project_id]);
  const projectCode = projResult.rows[0]?.project_code || 'PRJ';
  const release_code = `BOM-${projectCode}-${num}`;
  const result = await query(
    `INSERT INTO bom_releases (release_code, project_id, title, revision, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [release_code, project_id, title || `BOM Release ${num}`, revision || 'A', notes || null, req.user!.id]);
  const releaseId = result.rows[0].id;

  let lineNum = 1;

  if (sections.includes('Products')) {
    const equipment = await query(
      `SELECT pei.equip_code as tag_code,
              COALESCE(pei.description, pm.product_name) as description,
              pm.product_code, pm.product_name, pei.quantity, pei.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_equipment_items pei
       LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
       LEFT JOIN systems s ON pei.system_id = s.id
       WHERE pei.project_id = $1
       ORDER BY pei.equip_code`,
      [project_id]);
    for (const row of equipment.rows) {
      await query(
        `INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Products',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
    }
  }

  if (sections.includes('Tank')) {
    const tanks = await query(
      `SELECT t.tank_code as tag_code, t.tank_name as description,
              pm.product_code, pm.product_name, 1 as quantity, 'EA' as unit,
              NULL as system_ref, a.area_name as area_ref
       FROM tanks t
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
       LEFT JOIN areas a ON t.area_id = a.id
       WHERE t.project_id = $1
       ORDER BY t.tank_code`,
      [project_id]);
    for (const row of tanks.rows) {
      await query(
        `INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Tank',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
    }
  }

  if (sections.includes('Piping')) {
    const piping = await query(
      `SELECT ppi.piping_code as tag_code, COALESCE(ppi.description, pm.product_name) as description,
              pm.product_code, pm.product_name, ppi.quantity, ppi.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_piping_items ppi
       LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
       LEFT JOIN systems s ON ppi.system_id = s.id
       WHERE ppi.project_id = $1
       ORDER BY ppi.piping_code`,
      [project_id]);
    for (const row of piping.rows) {
      await query(
        `INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Piping',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
    }
  }

  const final = await query('SELECT * FROM bom_releases WHERE id=$1', [releaseId]);
  res.status(201).json(final.rows[0]);
});

router.get('/projects/:id/items-for-po', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const projectId = proj.rows[0].id;

  const equipment = await query(
    `WITH released_eq AS (
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
     ORDER BY s.system_code NULLS LAST, pei.equip_code`,
    [projectId]);

  const tanks = await query(
    `WITH released_tanks AS (
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
     ORDER BY t.tank_code`,
    [projectId]);

  res.json({ equipment: equipment.rows, tanks: tanks.rows });
});

router.post('/bom-releases/:id/issue', authenticate, async (req: AuthRequest, res: Response) => {
  const { issued_date } = req.body;
  const result = await query(
    `UPDATE bom_releases SET status='Issued', issued_date=COALESCE($1::date, CURRENT_DATE), updated_at=NOW()
     WHERE id=$2 AND status='Draft' RETURNING *`,
    [issued_date || null, req.params.id]);
  if (!result.rows[0]) return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Release not found or already issued' } });
  res.json(result.rows[0]);
});

router.delete('/bom-releases/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const check = await query('SELECT status FROM bom_releases WHERE id=$1', [req.params.id]);
  if (!check.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
  if (check.rows[0].status === 'Issued') return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Cannot delete an issued release' } });
  await query('DELETE FROM bom_releases WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

export default router;
