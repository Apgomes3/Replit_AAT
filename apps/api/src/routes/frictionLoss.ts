import { Router, Response } from 'express';
import pool, { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import {
  calculateFrictionLoss,
  DEFAULT_NPSH_SAFETY_MARGIN_M,
  DEFAULT_WATER_TEMPERATURE_C,
  FRICTION_LOSS_CALCULATION_VERSION,
  frictionSourceFingerprint,
  frictionSourceSnapshot,
  STANDARD_ATMOSPHERIC_PRESSURE_KPA,
} from '../lib/frictionLossCalculations';
import {
  pumpCircuits,
} from '../lib/pumpSelections';
import {
  isCurrentPumpSelectionReady,
  loadReleaseContext,
  loadFrictionLossPackages,
  loadPumpSelections,
} from './designBooks';
import { isLifeSupportSystem } from '../lib/lssSystems';
import { isRetiredSystem, systemLifecycleError } from '../lib/systemLifecycle';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));
const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

async function pumpCandidates(runner: any, projectId: string, systemId: string) {
  return (await runner(
    `SELECT pei.id, pei.id AS project_equipment_item_id, pei.equip_code, pei.description,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer, pm.model,
            ph.npsh_required_m
     FROM project_equipment_items pei
     JOIN product_masters pm ON pm.id=pei.product_master_id
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     WHERE pei.project_id=$1 AND pei.system_id=$2
       AND (pm.status IS NULL OR pm.status='Active')
       AND (
         UPPER(COALESCE(pm.product_category,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.category_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.product_family_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR ((pm.product_category IS NULL OR BTRIM(pm.product_category)='')
             AND (pf.category_code IS NULL OR BTRIM(pf.category_code)='')
             AND (UPPER(COALESCE(pm.application_type,'')) LIKE '%PUMP%'
                  OR UPPER(pm.product_name) LIKE '%PUMP%'))
       )
     ORDER BY pei.equip_code`,
    [projectId, systemId],
  )).rows;
}

router.get('/design-books/:bookId/friction-loss', async (req: AuthRequest, res: Response) => {
  const frozenResult = await query(
    'SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1',
    [req.params.bookId],
  );
  if (!frozenResult.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const frozenBook = frozenResult.rows[0];
  const snapshot = frozenBook.status === 'Released'
    ? frozenBook.release_snapshot
    : ['For Review', 'Approved'].includes(frozenBook.status) ? frozenBook.review_snapshot : null;
  if (snapshot) return res.json({ items: snapshot.friction_loss_calculations || [], frozen: true });
  const context = await loadReleaseContext(String(req.params.bookId), query, false, false);
  if (!context) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const frozen = ['For Review', 'Approved', 'Released'].includes(context.status);
  res.json({ items: context.friction_loss_calculations || [], frozen });
});

router.get('/design-books/:bookId/friction-loss/:systemId', async (req: AuthRequest, res: Response) => {
  const frozenResult = await query(
    'SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1',
    [req.params.bookId],
  );
  if (!frozenResult.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const frozenBook = frozenResult.rows[0];
  const snapshot = frozenBook.status === 'Released'
    ? frozenBook.release_snapshot
    : ['For Review', 'Approved'].includes(frozenBook.status) ? frozenBook.review_snapshot : null;
  const systemId = routeParam(req.params.systemId);
  if (snapshot) {
    const item = (snapshot.friction_loss_calculations || []).find((entry: any) => entry.system_id === systemId);
    if (!item) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'LSS system not found in frozen Design Book package' } });
    return res.json({ ...item, pump_candidates: [], frozen: true });
  }
  const context = await loadReleaseContext(String(req.params.bookId), query, false, false);
  if (!context) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const item = (context.friction_loss_calculations || []).find((entry: any) => entry.system_id === systemId);
  if (!item) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'LSS system not found in Design Book project' } });
  const frozen = ['For Review', 'Approved', 'Released'].includes(context.status);
  res.json({
    ...item,
    pump_candidates: frozen ? [] : await pumpCandidates(query, context.project_id, systemId),
    tank_candidates: frozen ? [] : (context.tanks || []).map((tank: any) => ({
      id: tank.id, tank_code: tank.tank_code, tank_name: tank.tank_name,
      design_water_level_mm: tank.design_water_level_mm, height_mm: tank.height_mm,
    })),
    frozen,
  });
});

router.put(
  '/design-books/:bookId/friction-loss/:systemId',
  requireRole('admin', 'engineer'),
  requireModuleManage('design_books'),
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    const runner = client.query.bind(client);
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const context = await loadReleaseContext(String(req.params.bookId), runner, true, true);
      if (!context) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
      }
      if (!['Draft', 'In Progress'].includes(context.status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Friction Loss is read-only while the Design Book is under review, approved, or released.' } });
      }
      const system = context.systems?.find((entry: any) => entry.id === routeParam(req.params.systemId));
      if (!system || !isLifeSupportSystem(system)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'INVALID_SYSTEM', message: 'Select a Life Support system from this Design Book project.' } });
      }
      if (isRetiredSystem(system)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: systemLifecycleError(system) });
      }
      const circuit = pumpCircuits(system, system.side_streams || [])
        .find(entry => entry.circuit_key === req.body.circuit_key);
      if (!circuit) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit is not active in the saved Flow Route.' } });
      }
      const pumps = await pumpCandidates(runner, context.project_id, system.id);
      const pumpSelectionPackage = (await loadPumpSelections(runner, [system]))[0];
      const pumpSelection = pumpSelectionPackage?.items?.find(
        (entry: any) => entry.circuit_key === circuit.circuit_key,
      );
      const selectedPump = pumps.find(
        (entry: any) => entry.project_equipment_item_id === pumpSelection?.project_equipment_item_id,
      );
      if (!isCurrentPumpSelectionReady(pumpSelection) ||
          !selectedPump ||
          (req.body.project_equipment_item_id &&
            req.body.project_equipment_item_id !== pumpSelection.project_equipment_item_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'PUMP_SELECTION_NOT_READY', message: 'Select and recalculate the pump for this exact Flow Route circuit before calculating friction loss.' } });
      }
      const requestedComponents = Array.isArray(req.body.components) ? req.body.components : [];
      const components = requestedComponents.map((component: any, index: number) => ({
          project_piping_item_id: null,
          piping_snapshot: null,
          side: component.side,
          component_kind: component.component_kind,
          sort_order: index,
          internal_diameter_mm: component.internal_diameter_mm,
          straight_length_m: component.straight_length_m,
          material: component.material,
          absolute_roughness_mm: component.absolute_roughness_mm,
          fitting_k_value: component.fitting_k_value,
          quantity: component.quantity,
        }));
      const calculatedAt = new Date().toISOString();
      const findTank = (id: unknown) => (context.tanks || []).find((tank: any) => tank.id === id);
      const requestedBoundaries = req.body.tank_boundaries || {};
      const startTank = findTank(requestedBoundaries.start?.tank_id);
      const endTank = findTank(requestedBoundaries.end?.tank_id);
      const tankBoundaries = {
        start: {
          tank_id: startTank?.id || null,
          tank_snapshot: startTank ? { tank_id: startTank.id, tank_code: startTank.tank_code, tank_name: startTank.tank_name } : null,
          base_elevation_fl0_m: requestedBoundaries.start?.base_elevation_fl0_m,
          water_depth_m: requestedBoundaries.start?.water_depth_m,
          pump_draw_height_m: requestedBoundaries.start?.pump_draw_height_m,
          open_to_atmosphere: requestedBoundaries.start?.open_to_atmosphere !== false,
          gauge_pressure_kpa: requestedBoundaries.start?.open_to_atmosphere === false ? requestedBoundaries.start?.gauge_pressure_kpa : 0,
          atmospheric_pressure_kpa: requestedBoundaries.start?.atmospheric_pressure_kpa ?? STANDARD_ATMOSPHERIC_PRESSURE_KPA,
          water_temperature_c: requestedBoundaries.start?.water_temperature_c ?? DEFAULT_WATER_TEMPERATURE_C,
          npsh_safety_margin_m: requestedBoundaries.start?.npsh_safety_margin_m ?? DEFAULT_NPSH_SAFETY_MARGIN_M,
        },
        end: {
          tank_id: endTank?.id || null,
          tank_snapshot: endTank ? { tank_id: endTank.id, tank_code: endTank.tank_code, tank_name: endTank.tank_name } : null,
          base_elevation_fl0_m: requestedBoundaries.end?.base_elevation_fl0_m,
          water_depth_m: requestedBoundaries.end?.water_depth_m,
          open_to_atmosphere: requestedBoundaries.end?.open_to_atmosphere !== false,
          gauge_pressure_kpa: requestedBoundaries.end?.open_to_atmosphere === false ? requestedBoundaries.end?.gauge_pressure_kpa : 0,
        },
      };
      const calculation = calculateFrictionLoss({
        flow_m3h: circuit.flow_m3h,
        selected_pump: selectedPump,
        components,
        tank_boundaries: tankBoundaries,
        calculated_at: calculatedAt,
      });
      if (calculation.status !== 'ready') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'VALIDATION', message: calculation.reasons.join(' '), reasons: calculation.reasons } });
      }
      const sourceSnapshot = frictionSourceSnapshot(circuit, selectedPump, components, tankBoundaries);
      const sourceFingerprint = frictionSourceFingerprint(sourceSnapshot);
      const saved = await runner(
      `INSERT INTO design_book_friction_loss_calculations
         (design_book_id, system_id, circuit_key, project_equipment_item_id,
          calculation_version, status, freshness, source_fingerprint,
          source_snapshot, input_snapshot, result_snapshot, calculated_by, calculated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'fresh',$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
       ON CONFLICT (design_book_id, system_id, circuit_key) DO UPDATE SET
         project_equipment_item_id=EXCLUDED.project_equipment_item_id,
         calculation_version=EXCLUDED.calculation_version, status=EXCLUDED.status,
         freshness='fresh', source_fingerprint=EXCLUDED.source_fingerprint,
         source_snapshot=EXCLUDED.source_snapshot, input_snapshot=EXCLUDED.input_snapshot,
         result_snapshot=EXCLUDED.result_snapshot, calculated_by=EXCLUDED.calculated_by,
         calculated_at=EXCLUDED.calculated_at, updated_at=NOW()
       RETURNING *`,
      [
        context.id, system.id, circuit.circuit_key, selectedPump.project_equipment_item_id,
        FRICTION_LOSS_CALCULATION_VERSION,
        calculation.results.npsh_status === 'blocked'
          ? 'Blocked'
          : calculation.results.npsh_status === 'warning' ? 'Warning' : 'Ready',
        sourceFingerprint, JSON.stringify(sourceSnapshot),
         JSON.stringify({ flow_m3h: circuit.flow_m3h, components, tank_boundaries: tankBoundaries }),
        JSON.stringify(calculation), req.user!.id, calculatedAt,
      ],
    );
      await runner('DELETE FROM design_book_friction_loss_components WHERE calculation_id=$1', [saved.rows[0].id]);
      for (const component of components) {
        await runner(
        `INSERT INTO design_book_friction_loss_components
           (calculation_id, project_piping_item_id, side, component_kind, sort_order,
            piping_snapshot, internal_diameter_mm, straight_length_m, material,
            absolute_roughness_mm, fitting_k_value, quantity)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
        [
          saved.rows[0].id, component.project_piping_item_id, component.side,
          component.component_kind, component.sort_order, JSON.stringify(component.piping_snapshot),
          component.internal_diameter_mm, component.straight_length_m, component.material,
          component.absolute_roughness_mm, component.fitting_k_value, component.quantity,
        ],
      );
      }
      const refreshed = await loadFrictionLossPackages(runner, context.id, [system]);
      await client.query('COMMIT');
      res.json(refreshed[0].items.find((entry: any) => entry.circuit_key === circuit.circuit_key));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

export default router;