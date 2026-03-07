import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

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
  const result = await query(
    `INSERT INTO projects (project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [project_code, project_name, client_name, site_name, country, city, timezone, project_status || 'Concept', start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, req.user!.id]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_name, client_name, site_name, country, city, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes } = req.body;
  const result = await query(
    `UPDATE projects SET project_name=$1, client_name=$2, site_name=$3, country=$4, city=$5, project_status=$6, start_date=$7, target_completion_date=$8, project_manager=$9, engineering_manager=$10, qa_owner=$11, notes=$12, updated_at=NOW()
     WHERE id=$13 RETURNING *`,
    [project_name, client_name, site_name, country, city, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  res.json(result.rows[0]);
});

router.delete('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.status(204).end();
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
  const result = await query('SELECT s.*, a.area_name, e.exhibit_name FROM systems s LEFT JOIN areas a ON s.area_id=a.id LEFT JOIN exhibits e ON s.exhibit_id=e.id WHERE s.project_id = $1 ORDER BY s.system_code', [proj.rows[0].id]);
  res.json({ items: result.rows });
});

router.get('/projects/:id/equipment', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query(
    `SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name 
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id
     WHERE ei.project_id = $1 ORDER BY ei.equipment_code`, [proj.rows[0].id]);
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
  let where = '', params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); where = `WHERE t.project_id = $1`; }
  const result = await query(`SELECT t.*, e.exhibit_name, p.project_code FROM tanks t LEFT JOIN exhibits e ON t.exhibit_id=e.id JOIN projects p ON t.project_id=p.id ${where} ORDER BY t.tank_code`, params);
  res.json({ items: result.rows });
});

router.get('/tanks/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT t.*, e.exhibit_name, p.project_code, p.project_name FROM tanks t LEFT JOIN exhibits e ON t.exhibit_id=e.id JOIN projects p ON t.project_id=p.id WHERE t.id=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  res.json(result.rows[0]);
});

router.post('/tanks', authenticate, async (req: AuthRequest, res: Response) => {
  const { tank_code, project_id, area_id, exhibit_id, tank_name, tank_type, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, primary_material } = req.body;
  const result = await query('INSERT INTO tanks (tank_code, project_id, area_id, exhibit_id, tank_name, tank_type, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, primary_material) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
    [tank_code, project_id, area_id, exhibit_id, tank_name, tank_type, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, primary_material]);
  res.status(201).json(result.rows[0]);
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
  const equipment = await query('SELECT ei.*, pm.product_code, pm.product_name FROM equipment_instances ei LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id WHERE ei.system_id=$1 ORDER BY ei.equipment_code', [result.rows[0].id]);
  res.json({ ...result.rows[0], equipment: equipment.rows });
});

router.post('/systems', authenticate, async (req: AuthRequest, res: Response) => {
  const { system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type } = req.body;
  const result = await query('INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type]);
  res.status(201).json(result.rows[0]);
});

router.put('/systems/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, status, duty_description } = req.body;
  const result = await query('UPDATE systems SET system_name=$1, system_type=$2, design_flow_m3h=$3, turnover_rate_hr=$4, water_type=$5, status=$6, duty_description=$7, updated_at=NOW() WHERE id=$8 RETURNING *',
    [system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, status, duty_description, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  res.json(result.rows[0]);
});

// EQUIPMENT INSTANCES
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
  res.status(201).json(eq);
});

router.put('/equipment-instances/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date } = req.body;
  const result = await query(
    'UPDATE equipment_instances SET equipment_name=$1, equipment_type=$2, design_flow_m3h=$3, design_head_m=$4, power_kw=$5, material_code=$6, status=$7, operational_duty=$8, serial_number=$9, installation_date=$10, commissioning_date=$11, updated_at=NOW() WHERE id=$12 RETURNING *',
    [equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
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

export default router;
