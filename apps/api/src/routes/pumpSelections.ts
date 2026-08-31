import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import { calculatePumpSelection, evaluateSelectedPumpSuitability, PUMP_SELECTION_CALCULATION_VERSION, pumpSourceFingerprint, pumpCircuits } from '../lib/pumpSelections';
import { loadReleaseContext } from './designBooks';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));

const numberOrNull = (value: any) =>
  value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
const sourcePayload = (circuit: any, values: any) => ({
  circuit: {
    circuit_key: circuit.circuit_key, circuit_kind: circuit.circuit_kind, circuit_name: circuit.circuit_name,
    circuit_type: circuit.circuit_type, parent_loop_number: circuit.parent_loop_number,
    side_stream_id: circuit.side_stream_id, flow_m3h: circuit.flow_m3h,
  },
  design_head_m: numberOrNull(values.design_head_m),
  pump_efficiency_pct: numberOrNull(values.pump_efficiency_pct),
  motor_efficiency_pct: numberOrNull(values.motor_efficiency_pct),
});

async function candidates(runner: any, projectId: string, systemId: string) {
  return (await runner(
    `SELECT pei.id, pei.id AS project_equipment_item_id, pei.equip_code, pei.quantity, pm.id AS product_master_id,
            pm.product_code, pm.product_name, pm.manufacturer, pm.model, pm.design_flow_m3h, pm.design_head_m,
             COALESCE(pe.rated_power_kw, pm.power_kw) AS power_kw,
             pf.product_family_code, pm.product_category, pm.application_type
     FROM project_equipment_items pei
     JOIN product_masters pm ON pm.id=pei.product_master_id
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE pei.project_id=$1 AND pei.system_id=$2
       AND (pm.status IS NULL OR pm.status='Active')
       AND (
         UPPER(COALESCE(pm.product_category,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.category_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.product_family_code,'')) IN ('PUMP','PUMPS','PUMPING')
         /* Compatibility only for legacy unclassified catalog rows. */
         OR ((pm.product_category IS NULL OR BTRIM(pm.product_category)='')
             AND (pf.category_code IS NULL OR BTRIM(pf.category_code)='')
             AND (UPPER(COALESCE(pm.application_type,'')) LIKE '%PUMP%'
                  OR UPPER(pm.product_name) LIKE '%PUMP%'))
       )
     ORDER BY pei.equip_code`,
    [projectId, systemId],
  )).rows;
}

async function liveItems(runner: any, system: any) {
  const sideStreams = (await runner('SELECT * FROM system_flow_side_streams WHERE system_id=$1 ORDER BY parent_loop_number, sort_order, created_at, id', [system.id])).rows;
  const saved = (await runner('SELECT * FROM system_pump_selections WHERE system_id=$1', [system.id])).rows;
  const circuitMap = new Map(pumpCircuits(system, sideStreams).map(item => [item.circuit_key, item]));
  saved.forEach(row => {
    if (!circuitMap.has(row.circuit_key)) circuitMap.set(row.circuit_key, {
      circuit_key: row.circuit_key, circuit_kind: 'orphaned', circuit_name: row.circuit_key, circuit_type: null,
      parent_loop_number: null, side_stream_id: null, flow_m3h: null,
    });
  });
  return [...circuitMap.values()].map(circuit => {
    const row = saved.find(item => item.circuit_key === circuit.circuit_key);
    const source = sourcePayload(circuit, row || {});
    const fingerprint = pumpSourceFingerprint(source);
    const calculation = calculatePumpSelection({ flow_m3h: circuit.flow_m3h, design_head_m: row?.design_head_m, pump_efficiency_pct: row?.pump_efficiency_pct, motor_efficiency_pct: row?.motor_efficiency_pct });
    const suitability = evaluateSelectedPumpSuitability({
      selectedPump: row?.pump_snapshot, circuitFlowM3h: circuit.flow_m3h,
      designHeadM: row?.design_head_m, calculation,
    });
    const orphaned = circuit.circuit_kind === 'orphaned';
    const versionStale = !!row && row.calculation_version !== PUMP_SELECTION_CALCULATION_VERSION;
    const stale = !!row && (row.source_fingerprint !== fingerprint || versionStale);
    const reasons = orphaned
      ? ['This saved selection references a Flow Route circuit that no longer exists.']
      : [
          ...(row && row.source_fingerprint !== fingerprint ? ['Flow Route or sizing inputs changed after this pump calculation was saved. Save and calculate again.'] : []),
          ...(versionStale ? [`Pump sizing calculation version ${row.calculation_version} is outdated; recalculate using ${PUMP_SELECTION_CALCULATION_VERSION}.`] : []),
          ...(row?.project_equipment_item_id && row?.pump_snapshot ? [] : ['Select a pump assigned to this LSS system.']),
          ...calculation.reasons,
          ...suitability.reasons,
        ];
    return {
      ...circuit, project_equipment_item_id: row?.project_equipment_item_id || null,
      selected_pump: row?.pump_snapshot || null, design_head_m: row?.design_head_m == null ? null : Number(row.design_head_m),
      pump_efficiency_pct: row?.pump_efficiency_pct == null ? null : Number(row.pump_efficiency_pct),
      motor_efficiency_pct: row?.motor_efficiency_pct == null ? null : Number(row.motor_efficiency_pct),
      source_fingerprint: row?.source_fingerprint || null, current_source_fingerprint: fingerprint,
      freshness: row ? (stale ? 'stale' : 'fresh') : 'unsaved',
      status: orphaned ? 'stale' : suitability.status === 'incompatible' ? 'incompatible'
        : stale ? 'stale' : reasons.length ? 'incomplete' : calculation.status,
      reasons,
      calculation_version: row?.calculation_version || PUMP_SELECTION_CALCULATION_VERSION,
      // A saved result is engineering evidence. Do not silently relabel a
      // recomputed value as evidence from an older calculation version.
      results: row ? (row.result_snapshot?.results || row.result_snapshot || calculation.results) : calculation.results,
    };
  });
}

router.get('/systems/:id/pump-selections', async (req: AuthRequest, res: Response) => {
  const book = await query('SELECT * FROM design_books WHERE id=$1', [req.query.design_book_id]);
  if (!book.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const designBook = book.rows[0];
  if (['For Review', 'Approved'].includes(designBook.status) && designBook.review_snapshot) {
    return res.json({ items: (designBook.review_snapshot.pump_selections || []).filter((item: any) => item.system_id === req.params.id).flatMap((x: any) => x.items || []), pump_candidates: [], frozen: true });
  }
  if (designBook.status === 'Released' && designBook.release_snapshot) {
    return res.json({ items: (designBook.release_snapshot.pump_selections || []).filter((item: any) => item.system_id === req.params.id).flatMap((x: any) => x.items || []), pump_candidates: [], frozen: true });
  }
  const context = await loadReleaseContext(designBook.id, query, false, true);
  const system = context?.systems?.find((item: any) => item.id === req.params.id);
  if (!system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
  res.json({ items: await liveItems(query, system), pump_candidates: await candidates(query, designBook.project_id, String(req.params.id)), frozen: false });
});

router.put('/systems/:id/pump-selections', requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const input = req.body || {};
  const bookResult = await query('SELECT * FROM design_books WHERE id=$1', [input.design_book_id]);
  const book = bookResult.rows[0];
  if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  if (!['Draft', 'In Progress'].includes(book.status)) return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
  const context = await loadReleaseContext(book.id, query, false, true);
  const system = context?.systems?.find((item: any) => item.id === req.params.id);
  if (!system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
  const circuit = (await liveItems(query, system)).find(item => item.circuit_key === input.circuit_key);
  if (!circuit || circuit.circuit_kind === 'orphaned') return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit key is not active in the saved Flow Route.' } });
  const calculation = calculatePumpSelection({ flow_m3h: circuit.flow_m3h, design_head_m: input.design_head_m, pump_efficiency_pct: input.pump_efficiency_pct, motor_efficiency_pct: input.motor_efficiency_pct });
  if (calculation.status !== 'ready') return res.status(400).json({ error: { code: 'VALIDATION', message: calculation.reasons.join(' ') } });
  let selected: any = null;
  if (input.project_equipment_item_id) {
    selected = (await candidates(query, book.project_id, system.id)).find((item: any) => item.project_equipment_item_id === input.project_equipment_item_id);
    if (!selected) return res.status(400).json({ error: { code: 'INELIGIBLE_PUMP', message: 'Selected equipment is not an eligible pump assigned to this system and project.' } });
  }
  const source = sourcePayload(circuit, input);
  await query(`INSERT INTO system_pump_selections (system_id,circuit_key,project_equipment_item_id,design_head_m,pump_efficiency_pct,motor_efficiency_pct,source_fingerprint,pump_snapshot,calculation_version,result_snapshot,updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)
    ON CONFLICT (system_id,circuit_key) DO UPDATE SET project_equipment_item_id=EXCLUDED.project_equipment_item_id,design_head_m=EXCLUDED.design_head_m,pump_efficiency_pct=EXCLUDED.pump_efficiency_pct,motor_efficiency_pct=EXCLUDED.motor_efficiency_pct,source_fingerprint=EXCLUDED.source_fingerprint,pump_snapshot=EXCLUDED.pump_snapshot,calculation_version=EXCLUDED.calculation_version,result_snapshot=EXCLUDED.result_snapshot,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
    [system.id, input.circuit_key, selected?.project_equipment_item_id || null, input.design_head_m, input.pump_efficiency_pct, input.motor_efficiency_pct, pumpSourceFingerprint(source), JSON.stringify(selected), calculation.calculation_version, JSON.stringify(calculation), req.user!.id]);
  const item = (await liveItems(query, system)).find(value => value.circuit_key === input.circuit_key);
  res.json(item);
});

export default router;