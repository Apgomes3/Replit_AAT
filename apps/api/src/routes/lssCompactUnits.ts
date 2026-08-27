import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { query } from '../db';

const router = Router();

const FIELDS = `
  lcu.*,
  pm.product_code, pm.product_name
`;
const JOIN = `
  FROM lss_compact_units lcu
  LEFT JOIN product_masters pm ON lcu.product_master_id = pm.id
`;

function validateCompactUnit(body: any): string | null {
  const numericFields = [
    'min_tank_volume_m3', 'max_tank_volume_m3', 'design_flow_m3h', 'max_flow_m3h',
    'break_tank_volume_l', 'uv_power_w', 'footprint_l_mm', 'footprint_w_mm',
    'height_mm', 'dry_weight_kg', 'power_kw',
  ];
  for (const field of numericFields) {
    const value = body[field];
    if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      return `${field} must be a non-negative number`;
    }
  }
  const minVolume = body.min_tank_volume_m3 == null ? null : Number(body.min_tank_volume_m3);
  const maxVolume = body.max_tank_volume_m3 == null ? null : Number(body.max_tank_volume_m3);
  const designFlow = body.design_flow_m3h == null ? null : Number(body.design_flow_m3h);
  const maxFlow = body.max_flow_m3h == null ? null : Number(body.max_flow_m3h);
  if (minVolume != null && maxVolume != null && minVolume > maxVolume) {
    return 'Minimum tank volume cannot exceed maximum tank volume';
  }
  if (designFlow != null && maxFlow != null && designFlow > maxFlow) {
    return 'Design flow cannot exceed maximum flow';
  }
  if (body.water_type && !['Marine', 'Salt Water', 'Freshwater', 'Brackish', 'Universal'].includes(body.water_type)) {
    return 'Unsupported compact-unit water type';
  }
  return null;
}

router.get('/lss-compact-units', authenticate, async (_req: AuthRequest, res: Response) => {
  const result = await query(`SELECT ${FIELDS} ${JOIN} ORDER BY lcu.unit_code`);
  res.json(result.rows);
});

router.get('/lss-compact-units/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT ${FIELDS} ${JOIN} WHERE lcu.id=$1 OR lcu.unit_code=$1`,
    [req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unit not found' } });
  res.json(result.rows[0]);
});

router.post('/lss-compact-units', authenticate, async (req: AuthRequest, res: Response) => {
  const {
    unit_code, unit_name, manufacturer, water_type,
    min_tank_volume_m3, max_tank_volume_m3,
    design_flow_m3h, max_flow_m3h,
    break_tank_volume_l, includes_filtration, uv_power_w,
    footprint_l_mm, footprint_w_mm, height_mm,
    dry_weight_kg, power_kw,
    inlet_connection, outlet_connection,
    notes, product_master_id, status,
  } = req.body;

  if (!unit_code?.trim() || !unit_name?.trim())
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'unit_code and unit_name are required' } });
  const validationError = validateCompactUnit(req.body);
  if (validationError) return res.status(400).json({ error: { code: 'VALIDATION', message: validationError } });

  try {
    const result = await query(
      `INSERT INTO lss_compact_units (
        unit_code, unit_name, manufacturer, water_type,
        min_tank_volume_m3, max_tank_volume_m3,
        design_flow_m3h, max_flow_m3h,
        break_tank_volume_l, includes_filtration, uv_power_w,
        footprint_l_mm, footprint_w_mm, height_mm,
        dry_weight_kg, power_kw,
        inlet_connection, outlet_connection,
        notes, product_master_id, status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      ) RETURNING *`,
      [
        unit_code.trim().toUpperCase(), unit_name.trim(), manufacturer || null, water_type || null,
        min_tank_volume_m3 ?? null, max_tank_volume_m3 ?? null,
        design_flow_m3h ?? null, max_flow_m3h ?? null,
        break_tank_volume_l ?? null, includes_filtration || null, uv_power_w ?? null,
        footprint_l_mm ?? null, footprint_w_mm ?? null, height_mm ?? null,
        dry_weight_kg ?? null, power_kw ?? null,
        inlet_connection || null, outlet_connection || null,
        notes || null, product_master_id || null, status || 'Active',
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505')
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'A unit with that code already exists.' } });
    throw err;
  }
});

router.put('/lss-compact-units/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const {
    unit_code, unit_name, manufacturer, water_type,
    min_tank_volume_m3, max_tank_volume_m3,
    design_flow_m3h, max_flow_m3h,
    break_tank_volume_l, includes_filtration, uv_power_w,
    footprint_l_mm, footprint_w_mm, height_mm,
    dry_weight_kg, power_kw,
    inlet_connection, outlet_connection,
    notes, product_master_id, status,
  } = req.body;
  if (!unit_code?.trim() || !unit_name?.trim())
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'unit_code and unit_name are required' } });
  const validationError = validateCompactUnit(req.body);
  if (validationError) return res.status(400).json({ error: { code: 'VALIDATION', message: validationError } });

  try {
    const result = await query(
      `UPDATE lss_compact_units SET
        unit_code=$1, unit_name=$2, manufacturer=$3, water_type=$4,
        min_tank_volume_m3=$5, max_tank_volume_m3=$6,
        design_flow_m3h=$7, max_flow_m3h=$8,
        break_tank_volume_l=$9, includes_filtration=$10, uv_power_w=$11,
        footprint_l_mm=$12, footprint_w_mm=$13, height_mm=$14,
        dry_weight_kg=$15, power_kw=$16,
        inlet_connection=$17, outlet_connection=$18,
        notes=$19, product_master_id=$20, status=$21,
        updated_at=NOW()
       WHERE id=$22 RETURNING *`,
      [
        unit_code?.trim().toUpperCase(), unit_name?.trim(), manufacturer || null, water_type || null,
        min_tank_volume_m3 ?? null, max_tank_volume_m3 ?? null,
        design_flow_m3h ?? null, max_flow_m3h ?? null,
        break_tank_volume_l ?? null, includes_filtration || null, uv_power_w ?? null,
        footprint_l_mm ?? null, footprint_w_mm ?? null, height_mm ?? null,
        dry_weight_kg ?? null, power_kw ?? null,
        inlet_connection || null, outlet_connection || null,
        notes || null, product_master_id || null, status || 'Active',
        req.params.id,
      ],
    );
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unit not found' } });
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505')
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'A unit with that code already exists.' } });
    throw err;
  }
});

router.delete('/lss-compact-units/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const check = await query('SELECT COUNT(*) FROM systems WHERE compact_unit_id=$1', [req.params.id]);
  if (parseInt(check.rows[0].count) > 0)
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'This unit is assigned to one or more systems. Unlink them first.' } });
  const result = await query('DELETE FROM lss_compact_units WHERE id=$1 RETURNING id, unit_code', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unit not found' } });
  res.json({ deleted: true, id: result.rows[0].id });
});

export default router;
