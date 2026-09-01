import { Router, Response } from 'express';
import pool, { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import {
  calculatePumpSelection, evaluateSelectedPumpSuitability, PUMP_SELECTION_CALCULATION_VERSION,
  pumpSourceFingerprint, pumpCircuits, isFoamFractionatorCircuit, pumpLinesForCircuit,
  buildPumpLineItem, PUMP_ROLE_PRIMARY, PUMP_ROLE_VENTURI, defaultPumpLineName,
} from '../lib/pumpSelections';
import { loadReleaseContext } from './designBooks';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));

const numberOrNull = (value: any) =>
  value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
const allowedPumpRoles = new Set([PUMP_ROLE_PRIMARY, PUMP_ROLE_VENTURI]);

async function candidates(runner: any, projectId: string, systemId: string) {
  return (await runner(
    `SELECT pei.id, pei.id AS project_equipment_item_id, pei.equip_code, pei.quantity, pei.description,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer, pm.model,
            pm.design_flow_m3h, pm.design_head_m,
             COALESCE(pe.rated_power_kw, pm.power_kw) AS power_kw,
             pf.product_family_code, pm.product_category, pm.application_type
     FROM project_equipment_items pei
     LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE pei.project_id=$1 AND pei.system_id=$2
       AND (pm.id IS NULL OR pm.status IS NULL OR pm.status='Active')
       AND (
         pm.id IS NULL
         OR UPPER(COALESCE(pm.product_category,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.category_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.product_family_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pei.description,'')) LIKE '%PUMP%'
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
  const sideStreams = (await runner(
    'SELECT * FROM system_flow_side_streams WHERE system_id=$1 ORDER BY parent_loop_number, sort_order, created_at, id',
    [system.id],
  )).rows;
  const saved = (await runner('SELECT * FROM system_pump_selections WHERE system_id=$1', [system.id])).rows;
  const circuitMap = new Map(pumpCircuits(system, sideStreams).map(item => [item.circuit_key, item]));

  // Retain orphaned saved rows so stale evidence remains auditable.
  saved.forEach(row => {
    if (!circuitMap.has(row.circuit_key)) circuitMap.set(row.circuit_key, {
      circuit_key: row.circuit_key, circuit_kind: 'orphaned', circuit_name: row.circuit_key,
      circuit_type: null, parent_loop_number: null, side_stream_id: null, flow_m3h: null,
    });
  });

  return [...circuitMap.values()].flatMap(circuit =>
    pumpLinesForCircuit(circuit, saved),
  );
}

// ---------------------------------------------------------------------------
// GET /systems/:id/pump-selections
// ---------------------------------------------------------------------------
router.get('/systems/:id/pump-selections', async (req: AuthRequest, res: Response) => {
  const book = await query('SELECT * FROM design_books WHERE id=$1', [req.query.design_book_id]);
  if (!book.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const designBook = book.rows[0];
  if (['For Review', 'Approved'].includes(designBook.status) && designBook.review_snapshot) {
    return res.json({
      items: (designBook.review_snapshot.pump_selections || [])
        .filter((item: any) => item.system_id === req.params.id)
        .flatMap((x: any) => x.items || []),
      pump_candidates: [], frozen: true,
    });
  }
  if (designBook.status === 'Released' && designBook.release_snapshot) {
    return res.json({
      items: (designBook.release_snapshot.pump_selections || [])
        .filter((item: any) => item.system_id === req.params.id)
        .flatMap((x: any) => x.items || []),
      pump_candidates: [], frozen: true,
    });
  }
  const context = await loadReleaseContext(designBook.id, query, false, true);
  const system = context?.systems?.find((item: any) => item.id === req.params.id);
  if (!system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
  res.json({
    items: await liveItems(query, system),
    pump_candidates: await candidates(query, designBook.project_id, String(req.params.id)),
    frozen: false,
  });
});

// ---------------------------------------------------------------------------
// PUT /systems/:id/pump-selections  — save / recalculate one pump line
// ---------------------------------------------------------------------------
router.put('/systems/:id/pump-selections', requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const input = req.body || {};
  const bookResult = await query('SELECT * FROM design_books WHERE id=$1', [input.design_book_id]);
  const book = bookResult.rows[0];
  if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  if (!['Draft', 'In Progress'].includes(book.status)) return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });

  const context = await loadReleaseContext(book.id, query, false, true);
  const system = context?.systems?.find((item: any) => item.id === req.params.id);
  if (!system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });

  const allLines = await liveItems(query, system);
  const pumpRole = input.pump_role || PUMP_ROLE_PRIMARY;
  if (!allowedPumpRoles.has(pumpRole)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'pump_role must be primary or venturi.' } });
  }
  const line = allLines.find(item => item.circuit_key === input.circuit_key && item.pump_role === pumpRole);
  if (!line || line.circuit_kind === 'orphaned') {
    return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit key or pump role is not active in the saved Flow Route.' } });
  }

  // For FFVP lines the flow basis comes from the explicit venturi_flow_m3h input.
  const isVenturi = pumpRole === PUMP_ROLE_VENTURI;
  const effectiveFlow = isVenturi
    ? numberOrNull(input.venturi_flow_m3h)
    : line.flow_m3h;

  if (isVenturi && (effectiveFlow == null || effectiveFlow <= 0)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Venturi duty flow is required and must be greater than zero.' } });
  }

  const calculation = calculatePumpSelection({
    flow_m3h: effectiveFlow,
    design_head_m: input.design_head_m,
    pump_efficiency_pct: input.pump_efficiency_pct,
    motor_efficiency_pct: input.motor_efficiency_pct,
  });
  if (calculation.status !== 'ready') {
    return res.status(400).json({ error: { code: 'VALIDATION', message: calculation.reasons.join(' ') } });
  }

  let selected: any = null;
  if (input.project_equipment_item_id) {
    selected = (await candidates(query, book.project_id, system.id)).find((item: any) => item.project_equipment_item_id === input.project_equipment_item_id);
    if (!selected) return res.status(400).json({ error: { code: 'INELIGIBLE_PUMP', message: 'Selected equipment is not an eligible pump assigned to this system and project.' } });
  }

  // Build the fingerprint-source payload that includes role and venturi flow.
  const circuit = line;
  const sourcePayload = {
    circuit: {
      circuit_key: circuit.circuit_key, circuit_kind: circuit.circuit_kind,
      circuit_name: circuit.circuit_name, circuit_type: circuit.circuit_type,
      parent_loop_number: circuit.parent_loop_number, side_stream_id: circuit.side_stream_id,
      flow_m3h: circuit.flow_m3h,
    },
    pump_role: pumpRole,
    ...(isVenturi ? { venturi_flow_m3h: effectiveFlow } : {}),
    design_head_m: numberOrNull(input.design_head_m),
    pump_efficiency_pct: numberOrNull(input.pump_efficiency_pct),
    motor_efficiency_pct: numberOrNull(input.motor_efficiency_pct),
  };

  await query(
    `INSERT INTO system_pump_selections
       (system_id,circuit_key,project_equipment_item_id,
        design_head_m,pump_efficiency_pct,motor_efficiency_pct,
        source_fingerprint,pump_snapshot,calculation_version,result_snapshot,updated_by,
        pump_role,venturi_flow_m3h)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13)
     ON CONFLICT (system_id,circuit_key,pump_role) DO UPDATE SET
       project_equipment_item_id=EXCLUDED.project_equipment_item_id,
       design_head_m=EXCLUDED.design_head_m,
       pump_efficiency_pct=EXCLUDED.pump_efficiency_pct,
       motor_efficiency_pct=EXCLUDED.motor_efficiency_pct,
       venturi_flow_m3h=EXCLUDED.venturi_flow_m3h,
       source_fingerprint=EXCLUDED.source_fingerprint,
       pump_snapshot=EXCLUDED.pump_snapshot,
       calculation_version=EXCLUDED.calculation_version,
       result_snapshot=EXCLUDED.result_snapshot,
       updated_by=EXCLUDED.updated_by,
       updated_at=NOW()`,
    [
      system.id, input.circuit_key, selected?.project_equipment_item_id || null,
      input.design_head_m, input.pump_efficiency_pct, input.motor_efficiency_pct,
      pumpSourceFingerprint(sourcePayload),
      JSON.stringify(selected),
      calculation.calculation_version,
      JSON.stringify(calculation),
      req.user!.id,
      pumpRole,
      isVenturi ? effectiveFlow : null,
    ],
  );

  const updatedLines = await liveItems(query, system);
  const item = updatedLines.find(value => value.circuit_key === input.circuit_key && value.pump_role === pumpRole);
  res.json(item);
});

// ---------------------------------------------------------------------------
// POST /systems/:id/pump-lines — create a project equipment pump and prepare
//   its allocation for a Flow Route circuit.
//   This creates a project_equipment_items record scoped to the current project
//   and LSS system.  The pump selection itself is saved separately via PUT.
// ---------------------------------------------------------------------------
router.post('/systems/:id/pump-lines', requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const input = req.body || {};
  const bookResult = await query('SELECT * FROM design_books WHERE id=$1', [input.design_book_id]);
  const book = bookResult.rows[0];
  if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  if (!['Draft', 'In Progress'].includes(book.status)) return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });

  const context = await loadReleaseContext(book.id, query, false, true);
  const system = context?.systems?.find((item: any) => item.id === req.params.id);
  if (!system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });

  const pumpRole = input.pump_role || PUMP_ROLE_PRIMARY;
  if (!allowedPumpRoles.has(pumpRole)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'pump_role must be primary or venturi.' } });
  }
  const circuitKey = input.circuit_key;
  if (!circuitKey) return res.status(400).json({ error: { code: 'VALIDATION', message: 'circuit_key is required.' } });

  // Validate that the circuit exists and is active.
  const allLines = await liveItems(query, system);
  const existingLine = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === pumpRole);

  // For FFVP: only allowed on Foam Fractionator circuits.
  if (pumpRole === PUMP_ROLE_VENTURI) {
    const primaryLine = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === PUMP_ROLE_PRIMARY);
    if (!primaryLine || !isFoamFractionatorCircuit(primaryLine)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Venturi pump lines are only supported on Foam Fractionator circuits.' } });
    }
  }

  // Reject creating a duplicate pump line (would break the unique constraint).
  if (existingLine && existingLine.project_equipment_item_id) {
    return res.status(409).json({ error: { code: 'DUPLICATE_PUMP_LINE', message: `A pump is already allocated to this circuit (${circuitKey}) with role "${pumpRole}".` } });
  }

  // Generate a default equip_code if none supplied.
  const equipCode = (input.equip_code || '').trim() || await generateEquipCode(
    book.project_id,
    pumpRole,
    !!existingLine && isFoamFractionatorCircuit(existingLine),
  );
  const description = (input.description || '').trim() || defaultPumpLineName(
    existingLine || { circuit_name: circuitKey, circuit_type: null, circuit_kind: 'loop' },
    pumpRole,
  );

  // Check equip_code uniqueness.
  const existing = await query(
    'SELECT id FROM project_equipment_items WHERE project_id=$1 AND equip_code=$2',
    [book.project_id, equipCode],
  );
  if (existing.rows.length) {
    return res.status(409).json({ error: { code: 'DUPLICATE_EQUIP_CODE', message: `Equipment code "${equipCode}" already exists on this project. Provide a unique code.` } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO project_equipment_items
         (equip_code, project_id, system_id, description, quantity, unit, status)
       VALUES ($1,$2,$3,$4,1,'EA','Design')
       RETURNING *`,
      [equipCode, book.project_id, system.id, description],
    );
    const pei = result.rows[0];
    const circuit = allLines.find(item =>
      item.circuit_key === circuitKey && item.pump_role === PUMP_ROLE_PRIMARY);
    if (!circuit) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit key is not active in the saved Flow Route.' } });
    }
    const venturiFlow = pumpRole === PUMP_ROLE_VENTURI
      ? numberOrNull(input.venturi_flow_m3h)
      : null;
    const source = {
      circuit: {
        circuit_key: circuit.circuit_key, circuit_kind: circuit.circuit_kind,
        circuit_name: circuit.circuit_name, circuit_type: circuit.circuit_type,
        parent_loop_number: circuit.parent_loop_number, side_stream_id: circuit.side_stream_id,
        flow_m3h: circuit.flow_m3h,
      },
      pump_role: pumpRole,
      ...(pumpRole === PUMP_ROLE_VENTURI ? { venturi_flow_m3h: venturiFlow } : {}),
      design_head_m: null,
      pump_efficiency_pct: null,
      motor_efficiency_pct: null,
    };
    const calculation = calculatePumpSelection({
      flow_m3h: pumpRole === PUMP_ROLE_VENTURI ? venturiFlow : circuit.flow_m3h,
      design_head_m: null,
      pump_efficiency_pct: null,
      motor_efficiency_pct: null,
    });
    const snapshot = {
      ...pei,
      id: pei.id,
      project_equipment_item_id: pei.id,
    };
    await client.query(
      `INSERT INTO system_pump_selections
         (system_id,circuit_key,project_equipment_item_id,design_head_m,
          pump_efficiency_pct,motor_efficiency_pct,source_fingerprint,pump_snapshot,
          calculation_version,result_snapshot,updated_by,pump_role,venturi_flow_m3h)
       VALUES ($1,$2,$3,NULL,NULL,NULL,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10)`,
      [
        system.id, circuitKey, pei.id, pumpSourceFingerprint(source),
        JSON.stringify(snapshot), PUMP_SELECTION_CALCULATION_VERSION,
        JSON.stringify(calculation), req.user!.id, pumpRole, venturiFlow,
      ],
    );
    await client.query('COMMIT');
    res.status(201).json({ project_equipment_item: pei, pump_line: buildPumpLineItem(circuit, {
      project_equipment_item_id: pei.id,
      pump_snapshot: snapshot,
      source_fingerprint: pumpSourceFingerprint(source),
      calculation_version: PUMP_SELECTION_CALCULATION_VERSION,
      result_snapshot: calculation,
      pump_role: pumpRole,
      venturi_flow_m3h: venturiFlow,
    }, pumpRole) });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') {
      return res.status(409).json({ error: { code: 'DUPLICATE_PUMP_LINE', message: 'A pump line with this role or equipment code already exists.' } });
    }
    throw error;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// DELETE /systems/:id/pump-lines — remove a FFVP selection row.
//   Only the venturi role can be removed this way; primary lines are removed
//   by deleting the equipment item from the project equipment list.
//   The associated project_equipment_items record is NOT deleted here so the
//   PEI remains visible in the project equipment view for audit purposes.
// ---------------------------------------------------------------------------
router.delete('/systems/:id/pump-lines', requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const designBookId = req.query.design_book_id as string;
  const circuitKey = req.query.circuit_key as string;
  const pumpRole = req.query.pump_role as string;

  if (!designBookId || !circuitKey || !pumpRole) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id, circuit_key, and pump_role are required.' } });
  }
  if (pumpRole !== PUMP_ROLE_VENTURI) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Only a venturi pump line can be removed via this endpoint.' } });
  }

  const bookResult = await query('SELECT * FROM design_books WHERE id=$1', [designBookId]);
  const book = bookResult.rows[0];
  if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  if (!['Draft', 'In Progress'].includes(book.status)) return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });

  const context = await loadReleaseContext(book.id, query, false, true);
  const system = context?.systems?.find((item: any) => item.id === req.params.id);
  if (!system) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found in Design Book project' } });
  }
  const sideStreams = (await query(
    'SELECT * FROM system_flow_side_streams WHERE system_id=$1 ORDER BY parent_loop_number, sort_order, created_at, id',
    [system.id],
  )).rows;
  const circuit = pumpCircuits(system, sideStreams).find(item => item.circuit_key === circuitKey);
  if (!circuit || !isFoamFractionatorCircuit(circuit)) {
    return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'The venturi line belongs to an active Foam Fractionator circuit.' } });
  }

  await query(
    'DELETE FROM system_pump_selections WHERE system_id=$1 AND circuit_key=$2 AND pump_role=$3',
    [req.params.id, circuitKey, pumpRole],
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateEquipCode(projectId: string, role: string, foamFractionator: boolean): Promise<string> {
  const prefix = role === PUMP_ROLE_VENTURI ? 'FFVP'
    : foamFractionator && role === PUMP_ROLE_PRIMARY ? 'FFSP'
    : 'PUMP';
  // Find a free sequential code.
  const existing = await query(
    `SELECT equip_code FROM project_equipment_items WHERE project_id=$1 AND equip_code LIKE $2 ORDER BY equip_code`,
    [projectId, `${prefix}-%`],
  );
  const usedNumbers = new Set(
    existing.rows.map((row: any) => {
      const match = String(row.equip_code).match(/-(\d+)$/);
      return match ? parseInt(match[1], 10) : null;
    }).filter(Boolean),
  );
  let seq = 1;
  while (usedNumbers.has(seq)) seq++;
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

export default router;
