// PIM product routes: Family classifiers and engineering data: dimensions, electrical, pneumatic, thermal, hydraulic, design flow, classifier values, image.
// Mounted by ./index.ts behind authentication and PIM module access, in the original order.
import { Router, NextFunction, Response } from 'express';
import { query } from '../../../db';
import { logAudit } from '../../../db/audit';
import { authenticate, requireModuleManage, AuthRequest } from '../../../middleware/auth';
import { uploadImage, withProductTransaction, normalizeDesignFlow, flowsConflict, insertAuditTx, designFlowAuditDetails, resolveProductId, nullableHydraulicValue, nullableDimensionValue, readPneumaticPair, THERMAL_FLOW_SWITCH_STATUSES, THERMAL_CAPACITY_UNITS, thermalNumericFields, nullableThermalValue } from './shared';

const router = Router();

// FAMILY CLASSIFIERS
router.get('/product-families/:id/classifiers', authenticate, async (req: AuthRequest, res: Response) => {
  const fam = await query('SELECT id FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
  if (!fam.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
  const result = await query('SELECT * FROM family_classifiers WHERE family_id=$1 ORDER BY sort_order, created_at', [fam.rows[0].id]);
  res.json({ items: result.rows });
});

router.post('/product-families/:id/classifiers', authenticate, async (req: AuthRequest, res: Response) => {
  const fam = await query('SELECT id FROM product_families WHERE id::text=$1 OR product_family_code=$1', [req.params.id]);
  if (!fam.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Family not found' } });
  const { label, unit, field_type, sort_order } = req.body;
  const result = await query(
    'INSERT INTO family_classifiers (family_id, label, unit, field_type, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [fam.rows[0].id, label, unit || null, field_type || 'text', sort_order ?? 0]);
  res.status(201).json(result.rows[0]);
});

router.put('/family-classifiers/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { label, unit, field_type, sort_order } = req.body;
  const result = await query(
    'UPDATE family_classifiers SET label=$1, unit=$2, field_type=$3, sort_order=$4 WHERE id::text=$5 RETURNING *',
    [label, unit || null, field_type || 'text', sort_order ?? 0, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classifier not found' } });
  res.json(result.rows[0]);
});

router.delete('/family-classifiers/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('DELETE FROM family_classifiers WHERE id::text=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Classifier not found' } });
  res.json({ deleted: true });
});

router.get('/product-masters/:id/dimensions', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const r = await query('SELECT * FROM product_dimensions WHERE product_master_id=$1', [pid]);
  res.json(r.rows[0] || {});
});

router.put('/product-masters/:id/dimensions', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const body = req.body || {};
  const existing = await query('SELECT length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes FROM product_dimensions WHERE product_master_id=$1', [pid]);
  const current = existing.rows[0] || {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const rawDiameter = body.diameter_mm;
  const diameterBlank = rawDiameter === null || rawDiameter === undefined || (typeof rawDiameter === 'string' && rawDiameter.trim() === '');
  if (!diameterBlank && (typeof rawDiameter !== 'number' && typeof rawDiameter !== 'string' || !Number.isFinite(Number(rawDiameter)) || Number(rawDiameter) < 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'diameter_mm must be a finite, non-negative measurement' } });
  }
  const rawSandMediaPerFilter = body.sand_media_per_filter_kg;
  const sandMediaPerFilterBlank = rawSandMediaPerFilter === null || rawSandMediaPerFilter === undefined || (typeof rawSandMediaPerFilter === 'string' && rawSandMediaPerFilter.trim() === '');
  if (!sandMediaPerFilterBlank && (typeof rawSandMediaPerFilter !== 'number' && typeof rawSandMediaPerFilter !== 'string' || !Number.isFinite(Number(rawSandMediaPerFilter)) || Number(rawSandMediaPerFilter) < 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'sand_media_per_filter_kg must be a finite, non-negative measurement' } });
  }
  const diameter_mm = has('diameter_mm') ? (diameterBlank ? null : Number(rawDiameter)) : (current.diameter_mm ?? null);
  const sand_media_per_filter_kg = has('sand_media_per_filter_kg')
    ? (sandMediaPerFilterBlank ? null : Number(rawSandMediaPerFilter))
    : (current.sand_media_per_filter_kg ?? null);
  const length_mm = has('length_mm') ? nullableDimensionValue(body.length_mm) : (current.length_mm ?? null);
  const width_mm = has('width_mm') ? nullableDimensionValue(body.width_mm) : (current.width_mm ?? null);
  const height_mm = has('height_mm') ? nullableDimensionValue(body.height_mm) : (current.height_mm ?? null);
  const weight_kg = has('weight_kg') ? nullableDimensionValue(body.weight_kg) : (current.weight_kg ?? null);
  const inlet_dn_mm = has('inlet_dn_mm') ? nullableDimensionValue(body.inlet_dn_mm) : (current.inlet_dn_mm ?? null);
  const outlet_dn_mm = has('outlet_dn_mm') ? nullableDimensionValue(body.outlet_dn_mm) : (current.outlet_dn_mm ?? null);
  const notes = has('notes') ? nullableDimensionValue(body.notes) : (current.notes ?? null);
  const r = await query(`
    INSERT INTO product_dimensions (product_master_id, length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
    ON CONFLICT (product_master_id) DO UPDATE SET
      length_mm=$2, width_mm=$3, height_mm=$4, diameter_mm=$5, sand_media_per_filter_kg=$6, weight_kg=$7, inlet_dn_mm=$8, outlet_dn_mm=$9, notes=$10, updated_at=NOW()
    RETURNING *`, [pid, length_mm, width_mm, height_mm, diameter_mm, sand_media_per_filter_kg, weight_kg, inlet_dn_mm, outlet_dn_mm, notes]);
  res.json(r.rows[0]);
});

router.get('/product-masters/:id/electrical', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const r = await query('SELECT * FROM product_electrical WHERE product_master_id=$1', [pid]);
  res.json(r.rows[0] || {});
});

router.put('/product-masters/:id/electrical', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const body = req.body || {};
  const { rated_power_kw, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes, lamp_count } = body;
  const hasRatedPower = Object.prototype.hasOwnProperty.call(body, 'rated_power_kw');
  const hasLampCount = Object.prototype.hasOwnProperty.call(body, 'lamp_count');
  const hasLampPower = Object.prototype.hasOwnProperty.call(body, 'lamp_power_w');
  const ratedPowerValue = rated_power_kw == null || rated_power_kw === '' ? null : Number(rated_power_kw);
  const lampCountValue = lamp_count == null || lamp_count === '' ? null : Number(lamp_count);
  const lampPowerValue = body.lamp_power_w == null || body.lamp_power_w === '' ? null : Number(body.lamp_power_w);
  if (ratedPowerValue != null && (!Number.isFinite(ratedPowerValue) || ratedPowerValue <= 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'rated_power_kw must be a number greater than zero or blank' } });
  }
  if (lampCountValue != null && (!Number.isInteger(lampCountValue) || lampCountValue <= 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'lamp_count must be a positive integer or blank' } });
  }
  if (lampPowerValue != null && (!Number.isFinite(lampPowerValue) || lampPowerValue <= 0)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'lamp_power_w must be a number greater than zero or blank' } });
  }
  const saved = await withProductTransaction(async client => {
    const current = await client.query(
      `SELECT pm.lamp_count, pm.power_kw, pe.lamp_power_w
       FROM product_masters pm
       LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
       WHERE pm.id=$1
       FOR UPDATE OF pm`,
      [pid],
    );
    const currentProduct = current.rows[0] || {};
    const effectiveLampCount = hasLampCount ? lampCountValue : currentProduct.lamp_count;
    const effectiveLampPower = hasLampPower ? lampPowerValue : currentProduct.lamp_power_w;
    const hasLampInputs = hasLampCount || hasLampPower;
    const calculatedRatedPower = effectiveLampCount != null && effectiveLampPower != null
      ? Number(effectiveLampCount) * Number(effectiveLampPower) / 1000
      : null;
    const effectiveRatedPower = hasLampInputs
      ? calculatedRatedPower
      : hasRatedPower
        ? ratedPowerValue
        : currentProduct.power_kw;
    const electrical = await client.query(`
      INSERT INTO product_electrical (product_master_id, rated_power_kw, lamp_power_w, voltage_v, phases, frequency_hz, full_load_current_a, rated_speed_rpm, motor_type, insulation_class, protection_class, efficiency_class, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT (product_master_id) DO UPDATE SET
        rated_power_kw=$2, lamp_power_w=$3, voltage_v=$4, phases=$5, frequency_hz=$6, full_load_current_a=$7, rated_speed_rpm=$8, motor_type=$9, insulation_class=$10, protection_class=$11, efficiency_class=$12, notes=$13, updated_at=NOW()
      RETURNING *`, [pid, effectiveRatedPower, effectiveLampPower, voltage_v||null, phases||null, frequency_hz||null, full_load_current_a||null, rated_speed_rpm||null, motor_type||null, insulation_class||null, protection_class||null, efficiency_class||null, notes||null]);
    await client.query(
      `UPDATE product_masters
       SET power_kw=CASE WHEN $2 THEN $3 ELSE power_kw END,
           lamp_count=CASE WHEN $4 THEN $5 ELSE lamp_count END,
           updated_at=NOW()
       WHERE id=$1`,
      [pid, hasRatedPower || hasLampInputs, effectiveRatedPower, hasLampCount, lampCountValue],
    );
    return electrical.rows[0];
  });
  res.json(saved);
});

router.get('/product-masters/:id/pneumatic', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const productResult = await query('SELECT product_category FROM product_masters WHERE id=$1', [pid]);
    if (String(productResult.rows[0]?.product_category || '').toLowerCase() !== 'pneumatic') {
      return res.status(400).json({
        error: { code: 'INVALID_PRODUCT_CATEGORY', message: 'Pneumatic specifications are only available for products in the Pneumatic category' },
      });
    }
    const r = await query('SELECT * FROM product_pneumatic WHERE product_master_id=$1', [pid]);
    res.json(r.rows[0] || {});
  } catch (error) {
    next(error);
  }
});

router.get('/product-masters/:id/thermal', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const productResult = await query('SELECT product_category FROM product_masters WHERE id=$1', [pid]);
    if (String(productResult.rows[0]?.product_category || '').toLowerCase() !== 'thermal') {
      return res.status(400).json({
        error: { code: 'INVALID_PRODUCT_CATEGORY', message: 'Thermal specifications are only available for products in the Thermal category' },
      });
    }
    const r = await query('SELECT * FROM product_thermal WHERE product_master_id=$1', [pid]);
    res.json(r.rows[0] || {});
  } catch (error) {
    next(error);
  }
});

router.put('/product-masters/:id/thermal', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const body = req.body || {};
    const saved = await withProductTransaction(async client => {
      const productResult = await client.query(
        'SELECT product_category FROM product_masters WHERE id=$1 FOR UPDATE',
        [pid],
      );
      if (!productResult.rows[0]) {
        const error: any = new Error('Product not found');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (String(productResult.rows[0].product_category || '').toLowerCase() !== 'thermal') {
        const error: any = new Error('Thermal specifications are only available for products in the Thermal category');
        error.status = 400;
        error.code = 'INVALID_PRODUCT_CATEGORY';
        throw error;
      }

      const existingResult = await client.query(
        'SELECT * FROM product_thermal WHERE product_master_id=$1 FOR UPDATE',
        [pid],
      );
      const current = existingResult.rows[0] || {};
      const values: Record<string, unknown> = {};
      for (const field of thermalNumericFields) {
        const raw = Object.prototype.hasOwnProperty.call(body, field) ? body[field] : current[field] ?? null;
        const value = nullableThermalValue(raw);
        if (value === null) {
          values[field] = null;
          continue;
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          const error: any = new Error(`${field} must be a finite number or blank`);
          error.status = 400;
          error.code = 'INVALID_THERMAL_SPEC';
          throw error;
        }
        values[field] = parsed;
      }
      if (values.thermal_capacity_kw !== null && Number(values.thermal_capacity_kw) < 0) {
        const error: any = new Error('Thermal capacity must be non-negative');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      if (values.flow_rate_m3h !== null && Number(values.flow_rate_m3h) < 0) {
        const error: any = new Error('Flow rate must be non-negative');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      if (values.pressure_rating_bar !== null && Number(values.pressure_rating_bar) < 0) {
        const error: any = new Error('Pressure rating must be non-negative');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      if (values.efficiency_pct !== null && (Number(values.efficiency_pct) < 0 || Number(values.efficiency_pct) > 100)) {
        const error: any = new Error('Efficiency must be between 0 and 100 percent');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      for (const field of ['primary_inlet_dn_mm', 'primary_outlet_dn_mm', 'secondary_inlet_dn_mm', 'secondary_outlet_dn_mm']) {
        if (values[field] !== null && Number(values[field]) <= 0) {
          const error: any = new Error(`${field} must be a positive number`);
          error.status = 400;
          error.code = 'INVALID_THERMAL_SPEC';
          throw error;
        }
      }
      if (values.operating_temperature_min_c !== null && values.operating_temperature_max_c !== null
        && Number(values.operating_temperature_min_c) > Number(values.operating_temperature_max_c)) {
        const error: any = new Error('Minimum operating temperature cannot exceed maximum operating temperature');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }

      const flowSwitch = Object.prototype.hasOwnProperty.call(body, 'flow_switch_status')
        ? nullableThermalValue(body.flow_switch_status)
        : current.flow_switch_status ?? null;
      if (flowSwitch !== null && !THERMAL_FLOW_SWITCH_STATUSES.has(String(flowSwitch))) {
        const error: any = new Error('Flow switch status must be Included, Optional, or Not included');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      const thermalCapacityUnit = String(
        Object.prototype.hasOwnProperty.call(body, 'thermal_capacity_unit')
          ? body.thermal_capacity_unit || 'kW'
          : current.thermal_capacity_unit || 'kW',
      );
      if (!THERMAL_CAPACITY_UNITS.has(thermalCapacityUnit)) {
        const error: any = new Error('Thermal capacity unit must be kW, BTU/h, or TON');
        error.status = 400;
        error.code = 'INVALID_THERMAL_SPEC';
        throw error;
      }
      const textValue = (field: string) => Object.prototype.hasOwnProperty.call(body, field)
        ? nullableThermalValue(body[field])
        : current[field] ?? null;
      const r = await client.query(
        `INSERT INTO product_thermal
           (product_master_id, thermal_capacity_kw, thermal_capacity_unit, thermal_duty, fluid_type,
            operating_temperature_min_c, operating_temperature_max_c, design_temperature_c,
            flow_rate_m3h, pressure_rating_bar, efficiency_pct,
            primary_inlet_dn_mm, primary_outlet_dn_mm, secondary_inlet_dn_mm, secondary_outlet_dn_mm,
            flow_switch_status, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
         ON CONFLICT (product_master_id) DO UPDATE SET
           thermal_capacity_kw=$2, thermal_capacity_unit=$3, thermal_duty=$4, fluid_type=$5,
           operating_temperature_min_c=$6, operating_temperature_max_c=$7, design_temperature_c=$8,
           flow_rate_m3h=$9, pressure_rating_bar=$10, efficiency_pct=$11,
           primary_inlet_dn_mm=$12, primary_outlet_dn_mm=$13, secondary_inlet_dn_mm=$14, secondary_outlet_dn_mm=$15,
           flow_switch_status=$16, notes=$17, updated_at=NOW()
         RETURNING *`,
        [pid, values.thermal_capacity_kw, thermalCapacityUnit, textValue('thermal_duty'), textValue('fluid_type'),
          values.operating_temperature_min_c, values.operating_temperature_max_c, values.design_temperature_c,
          values.flow_rate_m3h, values.pressure_rating_bar, values.efficiency_pct,
          values.primary_inlet_dn_mm, values.primary_outlet_dn_mm, values.secondary_inlet_dn_mm, values.secondary_outlet_dn_mm,
          flowSwitch, textValue('notes')],
      );
      if (!r.rows[0]) {
        const error: any = new Error('The server did not return the saved thermal specifications');
        error.status = 500;
        error.code = 'THERMAL_SAVE_FAILED';
        throw error;
      }
      await insertAuditTx(client, req.user!.id, 'product', pid, 'THERMAL_SPECIFICATION_UPDATE', {
        summary: 'Thermal specifications updated',
        before: current,
        after: r.rows[0],
      });
      return r.rows[0];
    });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.put('/product-masters/:id/pneumatic', authenticate, requireModuleManage('pim'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pid = await resolveProductId(String(req.params.id));
    if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    const body = req.body || {};
    const saved = await withProductTransaction(async client => {
      const productResult = await client.query(
        'SELECT product_category FROM product_masters WHERE id=$1 FOR UPDATE',
        [pid],
      );
      if (!productResult.rows[0]) {
        const error: any = new Error('Product not found');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (String(productResult.rows[0].product_category || '').toLowerCase() !== 'pneumatic') {
        const error: any = new Error('Pneumatic specifications are only available for products in the Pneumatic category');
        error.status = 400;
        error.code = 'INVALID_PRODUCT_CATEGORY';
        throw error;
      }

      const existingResult = await client.query(
        'SELECT * FROM product_pneumatic WHERE product_master_id=$1 FOR UPDATE',
        [pid],
      );
      const current = existingResult.rows[0] || {};
      const gasFlow = readPneumaticPair(body, current, 'gas_flow_value', 'gas_flow_unit', 'gas_flow', 'Gas flow', false);
      const operatingTemperature = readPneumaticPair(body, current, 'operating_temperature_value', 'operating_temperature_unit', 'temperature', 'Operating temperature', true);
      const dewPoint = readPneumaticPair(body, current, 'dew_point_value', 'dew_point_unit', 'temperature', 'Dew point', true);
      const inletPort = readPneumaticPair(body, current, 'inlet_port_value', 'inlet_port_unit', 'port', 'Inlet port', false);
      const outletPort = readPneumaticPair(body, current, 'outlet_port_value', 'outlet_port_unit', 'port', 'Outlet port', false);
      const r = await client.query(
        `INSERT INTO product_pneumatic
           (product_master_id, gas_flow_value, gas_flow_unit, operating_temperature_value, operating_temperature_unit,
            dew_point_value, dew_point_unit, inlet_port_value, inlet_port_unit, outlet_port_value, outlet_port_unit, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (product_master_id) DO UPDATE SET
           gas_flow_value=$2, gas_flow_unit=$3, operating_temperature_value=$4, operating_temperature_unit=$5,
           dew_point_value=$6, dew_point_unit=$7, inlet_port_value=$8, inlet_port_unit=$9,
           outlet_port_value=$10, outlet_port_unit=$11, updated_at=NOW()
         RETURNING *`,
        [pid, gasFlow.value, gasFlow.unit, operatingTemperature.value, operatingTemperature.unit,
          dewPoint.value, dewPoint.unit, inletPort.value, inletPort.unit, outletPort.value, outletPort.unit],
      );
      if (!r.rows[0]) {
        const error: any = new Error('The server did not return the saved pneumatic specifications');
        error.status = 500;
        error.code = 'PNEUMATIC_SAVE_FAILED';
        throw error;
      }
      await insertAuditTx(client, req.user!.id, 'product', pid, 'PNEUMATIC_SPECIFICATION_UPDATE', {
        summary: 'Pneumatic specifications updated',
        before: current,
        after: r.rows[0],
      });
      return r.rows[0];
    });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.get('/product-masters/:id/hydraulic', authenticate, async (req: AuthRequest, res: Response) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const r = await query(
    `SELECT ph.*, pm.id AS product_master_id,
       COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
       CASE
         WHEN pm.design_flow_m3h IS NOT NULL AND ph.design_flow_m3h IS NOT NULL
              AND pm.design_flow_m3h IS DISTINCT FROM ph.design_flow_m3h THEN 'conflict'
         WHEN pm.design_flow_m3h IS NULL AND ph.design_flow_m3h IS NULL THEN 'empty'
         ELSE 'synchronized'
       END AS design_flow_sync_status,
       pm.design_flow_m3h AS product_design_flow_m3h,
       ph.design_flow_m3h AS hydraulic_design_flow_m3h
     FROM product_masters pm
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     WHERE pm.id=$1`,
    [pid],
  );
  res.json(r.rows[0] || {});
});

router.put('/product-masters/:id/hydraulic', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const pid = await resolveProductId(String(req.params.id));
  if (!pid) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const body = req.body || {};
  const { design_flow_m3h, venturi_flow_m3h, friction_loss_mh2o } = body;
  const parseDn = (value: unknown) => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
  };
  const suctionDn = parseDn(body.suction_dn_mm);
  const dischargeDn = parseDn(body.discharge_dn_mm);
  if (Number.isNaN(suctionDn) || Number.isNaN(dischargeDn)) {
    return res.status(400).json({
      error: { code: 'INVALID_DN_SIZE', message: 'Suction and discharge DN sizes must be positive numbers when provided.' },
    });
  }
  const venturiFlow = venturi_flow_m3h === null || venturi_flow_m3h === undefined ||
    (typeof venturi_flow_m3h === 'string' && venturi_flow_m3h.trim() === '')
    ? null
    : (typeof venturi_flow_m3h === 'number' || typeof venturi_flow_m3h === 'string')
      ? Number(venturi_flow_m3h)
      : Number.NaN;
  if (venturiFlow !== null && (!Number.isFinite(venturiFlow) || venturiFlow < 0)) {
    return res.status(400).json({
      error: { code: 'INVALID_VENTURI_FLOW', message: 'Venturi flow must be a finite, non-negative value in m³/h' },
    });
  }
  const frictionLoss = friction_loss_mh2o === null || friction_loss_mh2o === undefined ||
    (typeof friction_loss_mh2o === 'string' && friction_loss_mh2o.trim() === '')
    ? null
    : (typeof friction_loss_mh2o === 'number' || typeof friction_loss_mh2o === 'string')
      ? Number(friction_loss_mh2o)
      : Number.NaN;
  if (frictionLoss !== null && (!Number.isFinite(frictionLoss) || frictionLoss < 0)) {
    return res.status(400).json({
      error: { code: 'INVALID_FRICTION_LOSS', message: 'Friction loss must be a finite, non-negative value in mH₂O' },
    });
  }
  const fields = ['min_flow_m3h', 'max_flow_m3h', 'friction_loss_mh2o', 'design_head_m', 'design_pressure_bar', 'max_pressure_bar', 'npsh_required_m', 'fluid_type', 'min_temperature_c', 'max_temperature_c', 'notes', 'suction_dn_mm', 'discharge_dn_mm'] as const;
  let previousProductFlow: unknown;
  let previousHydraulicFlow: unknown;
  let linkedDesignFlow: number | null;
  let saved: any;
  try {
    saved = await withProductTransaction(async client => {
      const currentProduct = await client.query('SELECT design_flow_m3h FROM product_masters WHERE id=$1 FOR UPDATE', [pid]);
      const currentHydraulic = await client.query('SELECT * FROM product_hydraulic WHERE product_master_id=$1 FOR UPDATE', [pid]);
      const existing = currentHydraulic.rows[0] || {};
      previousProductFlow = currentProduct.rows[0]?.design_flow_m3h;
      previousHydraulicFlow = existing.design_flow_m3h;
      if (flowsConflict(previousProductFlow, previousHydraulicFlow) && body.design_flow_conflict_resolution !== 'hydraulic') {
        const error: any = new Error('Conflicting populated design flows require an explicit hydraulic resolution');
        error.status = 409;
        error.code = 'DESIGN_FLOW_CONFLICT';
        throw error;
      }
      linkedDesignFlow = flowsConflict(previousProductFlow, previousHydraulicFlow)
        ? Number(previousHydraulicFlow)
        : Object.prototype.hasOwnProperty.call(body, 'design_flow_m3h')
          ? normalizeDesignFlow(design_flow_m3h)
          : previousHydraulicFlow != null
            ? Number(previousHydraulicFlow)
            : previousProductFlow != null
              ? Number(previousProductFlow)
              : null;
      const merged = Object.fromEntries(fields.map(field => [
        field,
        Object.prototype.hasOwnProperty.call(body, field)
          ? field === 'friction_loss_mh2o' ? frictionLoss : nullableHydraulicValue(body[field])
          : existing[field] ?? null,
      ]));
      const mergedVenturi = Object.prototype.hasOwnProperty.call(body, 'venturi_flow_m3h')
        ? venturiFlow
        : existing.venturi_flow_m3h ?? null;
      const r = await client.query(`
        INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, min_flow_m3h, max_flow_m3h, venturi_flow_m3h, friction_loss_mh2o, design_head_m, design_pressure_bar, max_pressure_bar, npsh_required_m, fluid_type, min_temperature_c, max_temperature_c, notes, suction_dn_mm, discharge_dn_mm, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
        ON CONFLICT (product_master_id) DO UPDATE SET
          design_flow_m3h=$2, min_flow_m3h=$3, max_flow_m3h=$4, venturi_flow_m3h=$5, friction_loss_mh2o=$6, design_head_m=$7, design_pressure_bar=$8, max_pressure_bar=$9, npsh_required_m=$10, fluid_type=$11, min_temperature_c=$12, max_temperature_c=$13, notes=$14, suction_dn_mm=$15, discharge_dn_mm=$16, updated_at=NOW()
        RETURNING *`, [
          pid, linkedDesignFlow, merged.min_flow_m3h, merged.max_flow_m3h, mergedVenturi,
          merged.friction_loss_mh2o, merged.design_head_m, merged.design_pressure_bar,
          merged.max_pressure_bar, merged.npsh_required_m, merged.fluid_type,
          merged.min_temperature_c, merged.max_temperature_c, merged.notes,
          Object.prototype.hasOwnProperty.call(body, 'suction_dn_mm') ? suctionDn : existing.suction_dn_mm ?? null,
          Object.prototype.hasOwnProperty.call(body, 'discharge_dn_mm') ? dischargeDn : existing.discharge_dn_mm ?? null,
        ]);
      await client.query('UPDATE product_masters SET design_flow_m3h=$2, updated_at=NOW() WHERE id=$1', [pid, linkedDesignFlow]);
      if (flowsConflict(previousProductFlow, previousHydraulicFlow)) {
        await client.query(
          `UPDATE product_design_flow_reconciliations
           SET status='resolved', resolution='hydraulic', resolved_value_m3h=$2,
               resolved_by=$3, resolved_at=NOW()
           WHERE product_master_id=$1 AND status='unresolved'`,
          [pid, linkedDesignFlow, req.user!.id],
        );
      }
      if (Object.prototype.hasOwnProperty.call(body, 'design_flow_m3h') || previousProductFlow !== previousHydraulicFlow) {
        await insertAuditTx(client, req.user!.id, 'product', pid, 'LINKED_DESIGN_FLOW_UPDATE',
          designFlowAuditDetails('hydraulic_card', linkedDesignFlow, previousProductFlow, previousHydraulicFlow));
      }
      return { ...r.rows[0], design_flow_m3h: linkedDesignFlow, design_flow_sync_status: linkedDesignFlow == null ? 'empty' : 'synchronized' };
    });
  } catch (error) {
    return next(error);
  }
  await logAudit(req.user!.id, 'product', pid, 'UPDATE', {
    summary: 'Product hydraulic data updated',
    venturi_flow_m3h: venturiFlow,
    friction_loss_mh2o: frictionLoss,
  });
  res.json(saved);
});

router.post('/product-masters/design-flow/reconcile', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const requestedProduct = req.body?.product_id || req.body?.product_code || null;
  const resolution = req.body?.resolution;
  if (resolution != null && !['hydraulic', 'product_master'].includes(resolution)) {
    return res.status(400).json({ error: { code: 'INVALID_RESOLUTION', message: 'resolution must be hydraulic or product_master' } });
  }
  try {
    const outcome = await withProductTransaction(async client => {
      const params = requestedProduct ? [requestedProduct] : [];
      const result = await client.query(
        `SELECT pm.id, pm.product_code, pm.design_flow_m3h AS product_design_flow_m3h,
                ph.design_flow_m3h AS hydraulic_design_flow_m3h
         FROM product_masters pm
         LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
         ${requestedProduct ? 'WHERE pm.id::text=$1 OR pm.product_code=$1' : ''}
         ORDER BY pm.product_code
         FOR UPDATE OF pm`,
        params,
      );
      const conflicts: any[] = [];
      const reconciled: any[] = [];
      for (const row of result.rows) {
        const conflict = flowsConflict(row.product_design_flow_m3h, row.hydraulic_design_flow_m3h);
        if (conflict && !resolution) {
          await client.query(
            `INSERT INTO product_design_flow_reconciliations
               (product_master_id, product_flow_m3h, hydraulic_flow_m3h, status)
             SELECT $1,$2,$3,'unresolved'
             WHERE NOT EXISTS (
               SELECT 1 FROM product_design_flow_reconciliations
               WHERE product_master_id=$1 AND status='unresolved'
             )`,
            [row.id, row.product_design_flow_m3h, row.hydraulic_design_flow_m3h],
          );
          conflicts.push(row);
          continue;
        }
        const value = conflict
          ? Number(resolution === 'hydraulic' ? row.hydraulic_design_flow_m3h : row.product_design_flow_m3h)
          : row.hydraulic_design_flow_m3h != null
            ? Number(row.hydraulic_design_flow_m3h)
            : row.product_design_flow_m3h != null
              ? Number(row.product_design_flow_m3h)
              : null;
        await client.query('UPDATE product_masters SET design_flow_m3h=$2, updated_at=NOW() WHERE id=$1', [row.id, value]);
        await client.query(
          `INSERT INTO product_hydraulic (product_master_id, design_flow_m3h, updated_at)
           VALUES ($1,$2,NOW())
           ON CONFLICT (product_master_id) DO UPDATE SET design_flow_m3h=EXCLUDED.design_flow_m3h, updated_at=NOW()`,
          [row.id, value],
        );
        if (conflict) {
          await client.query(
            `UPDATE product_design_flow_reconciliations
             SET status='resolved', resolution=$2, resolved_value_m3h=$3,
                 resolved_by=$4, resolved_at=NOW()
             WHERE product_master_id=$1 AND status='unresolved'`,
            [row.id, resolution, value, req.user!.id],
          );
        }
        await insertAuditTx(client, req.user!.id, 'product', row.id, 'LINKED_DESIGN_FLOW_UPDATE',
          designFlowAuditDetails('reconciliation', value, row.product_design_flow_m3h, row.hydraulic_design_flow_m3h));
        reconciled.push({ product_id: row.id, product_code: row.product_code, design_flow_m3h: value, resolution: conflict ? resolution : 'backfill' });
      }
      return { reconciled, conflicts };
    });
    if (outcome.conflicts.length) {
      return res.status(409).json({
        error: {
          code: 'DESIGN_FLOW_CONFLICT',
          message: 'Conflicting populated design flows require an explicit hydraulic or product_master resolution',
        },
        reconciled: outcome.reconciled,
        conflicts: outcome.conflicts,
      });
    }
    res.json({ reconciled: outcome.reconciled, conflicts: [] });
  } catch (error) {
    next(error);
  }
});

// PRODUCT CLASSIFIER VALUES
router.get('/product-masters/:id/classifier-values', authenticate, async (req: AuthRequest, res: Response) => {
  const pm = await query('SELECT id, product_family_id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
  if (!pm.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const { id, product_family_id } = pm.rows[0];
  if (!product_family_id) return res.json({ classifiers: [], values: {} });
  const classifiers = await query('SELECT * FROM family_classifiers WHERE family_id=$1 ORDER BY sort_order, created_at', [product_family_id]);
  const values = await query('SELECT classifier_id, value_text FROM product_classifier_values WHERE product_id=$1', [id]);
  const valueMap: Record<string, string> = {};
  for (const v of values.rows) valueMap[v.classifier_id] = v.value_text;
  res.json({ classifiers: classifiers.rows, values: valueMap });
});

router.put('/product-masters/:id/classifier-values', authenticate, async (req: AuthRequest, res: Response) => {
  const pm = await query('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [req.params.id]);
  if (!pm.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const productId = pm.rows[0].id;
  const { values } = req.body as { values: Record<string, string> };
  for (const [classifierId, valueText] of Object.entries(values)) {
    if (valueText === null || valueText === undefined || valueText === '') {
      await query('DELETE FROM product_classifier_values WHERE product_id=$1 AND classifier_id=$2', [productId, classifierId]);
    } else {
      await query(
        'INSERT INTO product_classifier_values (product_id, classifier_id, value_text) VALUES ($1,$2,$3) ON CONFLICT (product_id, classifier_id) DO UPDATE SET value_text=$3',
        [productId, classifierId, valueText]);
    }
  }
  res.json({ updated: true });
});

// PRODUCT IMAGE UPLOAD
router.post('/product-masters/:id/image', authenticate, uploadImage.single('image'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No image file provided' } });
  const imageUrl = `/uploads/${req.file.filename}`;
  const result = await query('UPDATE product_masters SET image_url=$1, updated_at=NOW() WHERE id::text=$2 OR product_code=$2 RETURNING id, image_url', [imageUrl, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  res.json({ image_url: imageUrl });
});

export default router;
