import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import { calculateOzoneRequirement } from '../lib/ozoneCalculations';
import { loadReleaseContext } from './designBooks';
import { isRetiredSystem, systemLifecycleError } from '../lib/systemLifecycle';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));

const allowedUnits = new Set(['mg/h', 'g/h', 'lb/h']);

async function contextFor(book: any, systemId: string) {
  const context = await loadReleaseContext(book.id, query, false, true);
  const system = context?.systems?.find((item: any) => item.id === systemId);
  if (!system) return null;
  const pumpPackage = context.pump_selections?.find((item: any) => item.system_id === systemId);
  return { context, system, pumpLines: pumpPackage?.items || [] };
}

router.get('/systems/:id/ozone-calculation', async (req: AuthRequest, res: Response) => {
  const book = (await query('SELECT * FROM design_books WHERE id=$1', [req.query.design_book_id])).rows[0];
  if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const snapshot = book.status === 'Released'
    ? book.release_snapshot
    : ['For Review', 'Approved'].includes(book.status) ? book.review_snapshot : null;
  if (snapshot) {
    const frozen = (snapshot.ozone_calculations || []).find((item: any) => item.system_id === req.params.id);
    return res.json({ ...(frozen || {}), frozen: true });
  }
  const live = await contextFor(book, String(req.params.id));
  if (!live) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
  const saved = (await query(
    'SELECT * FROM design_book_ozone_calculations WHERE design_book_id=$1 AND system_id=$2',
    [book.id, req.params.id],
  )).rows[0] || null;
  const target = saved?.target_concentration_mg_l ?? 0.05;
  const keys = saved?.ffvp_plenum_circuit_keys || [];
  const result = calculateOzoneRequirement({
    target_concentration_mg_l: target,
    pump_lines: live.pumpLines,
    ffvp_plenum_circuit_keys: keys,
  });
  res.json({
    ...saved,
    target_concentration_mg_l: Number(target),
    display_unit: saved?.display_unit || 'g/h',
    ffvp_plenum_circuit_keys: keys,
    pump_lines: live.pumpLines.filter((line: any) => ['FFSP', 'FFVP'].includes(line.pump_duty_tag)),
    result,
    frozen: false,
  });
});

router.put('/systems/:id/ozone-calculation', requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const book = (await query('SELECT * FROM design_books WHERE id=$1', [req.body.design_book_id])).rows[0];
  if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  if (!['Draft', 'In Progress'].includes(book.status)) {
    return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
  }
  const live = await contextFor(book, String(req.params.id));
  if (!live) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
  if (isRetiredSystem(live.system)) return res.status(409).json({ error: systemLifecycleError(live.system) });
  const target = Number(req.body.target_concentration_mg_l);
  if (!Number.isFinite(target) || target < 0.01 || target > 0.2) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Target ozone concentration must be between 0.01 and 0.20 mg/L.' } });
  }
  const displayUnit = allowedUnits.has(req.body.display_unit) ? req.body.display_unit : 'g/h';
  const availableFfvpKeys = new Set(live.pumpLines
    .filter((line: any) => line.pump_duty_tag === 'FFVP')
    .map((line: any) => line.circuit_key));
  const keys = Array.isArray(req.body.ffvp_plenum_circuit_keys)
    ? [...new Set(req.body.ffvp_plenum_circuit_keys.filter((key: any) => availableFfvpKeys.has(key)))]
    : [];
  const result = calculateOzoneRequirement({
    target_concentration_mg_l: target,
    pump_lines: live.pumpLines,
    ffvp_plenum_circuit_keys: keys as string[],
  });
  if (result.status !== 'ready') {
    return res.status(400).json({ error: { code: 'OZONE_FLOW_INCOMPLETE', message: result.reasons.join(' ') } });
  }
  const inputSnapshot = {
    target_concentration_mg_l: target,
    display_unit: displayUnit,
    ffvp_plenum_circuit_keys: keys,
    ffsp_lines: result.ffsp_lines,
    applicable_ffvp_lines: result.applicable_ffvp_lines,
  };
  const saved = (await query(
    `INSERT INTO design_book_ozone_calculations
       (design_book_id,system_id,target_concentration_mg_l,display_unit,ffvp_plenum_circuit_keys,
        input_snapshot,result_snapshot,calculated_by,calculated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,NOW())
     ON CONFLICT (design_book_id,system_id) DO UPDATE SET
       target_concentration_mg_l=EXCLUDED.target_concentration_mg_l,
       display_unit=EXCLUDED.display_unit,
       ffvp_plenum_circuit_keys=EXCLUDED.ffvp_plenum_circuit_keys,
       input_snapshot=EXCLUDED.input_snapshot,result_snapshot=EXCLUDED.result_snapshot,
       calculated_by=EXCLUDED.calculated_by,calculated_at=NOW(),updated_at=NOW()
     RETURNING *`,
    [book.id, req.params.id, target, displayUnit, JSON.stringify(keys),
      JSON.stringify(inputSnapshot), JSON.stringify(result), req.user!.id],
  )).rows[0];
  res.json({ ...saved, pump_lines: live.pumpLines.filter((line: any) => ['FFSP', 'FFVP'].includes(line.pump_duty_tag)), result });
});

export default router;