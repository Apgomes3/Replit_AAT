import { Router, Response } from 'express';
import pool, { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import {
  calculatePumpSelection, evaluateSelectedPumpSuitability, PUMP_SELECTION_CALCULATION_VERSION,
  pumpSourceFingerprint, pumpCircuits, isFoamFractionatorCircuit, pumpLinesForCircuit,
  buildPumpLineItem, pumpSourcePayload, PUMP_ROLE_PRIMARY, PUMP_ROLE_VENTURI, defaultPumpLineName,
  inferPumpDutyType, buildPumpTags,
} from '../lib/pumpSelections';
import { loadReleaseContext } from './designBooks';
import { isRetiredSystem, systemLifecycleError } from '../lib/systemLifecycle';
import { isLifeSupportSystem } from '../lib/lssSystems';
import { reconcilePumpLinkedInstruments } from '../lib/lssControls';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));

const numberOrNull = (value: any) =>
  value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
const pumpQuantityOrNull = (value: any) => {
  if (value === null || value === undefined || value === '') return 1;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : null;
};
const allowedPumpRoles = new Set([PUMP_ROLE_PRIMARY, PUMP_ROLE_VENTURI]);
const allowedInstallationLocations = new Set(['external', 'submerged']);

async function candidates(runner: any, projectId: string, systemId: string) {
  return (await runner(
    `/* pump-selection-candidates */
     SELECT COALESCE(pei.id, pm.id) AS id,
            pei.id AS project_equipment_item_id, pei.equip_code, pei.quantity, pei.description,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer, pm.model,
            COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
            COALESCE(ph.design_head_m, pm.design_head_m) AS design_head_m,
            ph.npsh_required_m,
            COALESCE(pe.rated_power_kw, pm.power_kw) AS power_kw,
            pf.product_family_code, pm.product_category, pm.application_type,
            COALESCE(pei.status, pm.standard_status) AS status
     FROM product_masters pm
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     LEFT JOIN LATERAL (
       SELECT item.*
       FROM project_equipment_items item
       WHERE item.project_id=$1 AND item.system_id=$2 AND item.product_master_id=pm.id
       ORDER BY item.updated_at DESC, item.created_at DESC
       LIMIT 1
     ) pei ON TRUE
     WHERE (pm.status IS NULL OR pm.status='Active')
       AND LOWER(BTRIM(COALESCE(pm.standard_status,''))) <> 'obsolete'
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
     UNION ALL
     SELECT pei.id, pei.id, pei.equip_code, pei.quantity, pei.description,
            NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, pei.status
     FROM project_equipment_items pei
     WHERE pei.project_id=$1 AND pei.system_id=$2
       AND pei.product_master_id IS NULL
       AND UPPER(COALESCE(pei.description,'')) LIKE '%PUMP%'
     ORDER BY product_code NULLS LAST, equip_code NULLS LAST`,
    [projectId, systemId],
  )).rows;
}

async function eligiblePumpProduct(runner: any, productMasterId: string) {
  return (await runner(
    `SELECT pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer, pm.model,
            COALESCE(ph.design_flow_m3h, pm.design_flow_m3h) AS design_flow_m3h,
            COALESCE(ph.design_head_m, pm.design_head_m) AS design_head_m,
            ph.npsh_required_m,
            COALESCE(pe.rated_power_kw, pm.power_kw) AS power_kw,
            pm.product_category, pm.application_type, pm.standard_status
     FROM product_masters pm
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE pm.id=$1
       AND (pm.status IS NULL OR pm.status='Active')
       AND LOWER(BTRIM(COALESCE(pm.standard_status,''))) <> 'obsolete'
       AND (
         UPPER(COALESCE(pm.product_category,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.category_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.product_family_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR ((pm.product_category IS NULL OR BTRIM(pm.product_category)='')
             AND (pf.category_code IS NULL OR BTRIM(pf.category_code)='')
             AND (UPPER(COALESCE(pm.application_type,'')) LIKE '%PUMP%'
                  OR UPPER(pm.product_name) LIKE '%PUMP%'))
       )`,
    [productMasterId],
  )).rows[0] || null;
}

async function activeDutyTypes(runner: any) {
  return (await runner(
    'SELECT id, tag, pump_name, flow_route_role, sort_order, is_active FROM pump_duty_types WHERE is_active=true ORDER BY sort_order, tag',
  )).rows;
}

async function liveItems(runner: any, system: any) {
  const sideStreams = (await runner(
    'SELECT * FROM system_flow_side_streams WHERE system_id=$1 ORDER BY parent_loop_number, sort_order, created_at, id',
    [system.id],
  )).rows;
  const saved = (await runner('SELECT * FROM system_pump_selections WHERE system_id=$1', [system.id])).rows;
  const dutyTypes = await activeDutyTypes(runner);
  const circuitMap = new Map(pumpCircuits(system, sideStreams).map(item => [item.circuit_key, item]));

  // Retain orphaned saved rows so stale evidence remains auditable.
  saved.forEach(row => {
    if (!circuitMap.has(row.circuit_key)) circuitMap.set(row.circuit_key, {
      circuit_key: row.circuit_key, circuit_kind: 'orphaned', circuit_name: row.circuit_key,
      circuit_type: null, parent_loop_number: null, side_stream_id: null, flow_m3h: null,
    });
  });

  return [...circuitMap.values()].flatMap(circuit =>
    pumpLinesForCircuit(circuit, saved, dutyTypes),
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
  if (isRetiredSystem(system)) return res.status(409).json({ error: systemLifecycleError(system) });
  res.json({
    items: await liveItems(query, system),
    pump_candidates: await candidates(query, designBook.project_id, String(req.params.id)),
    pump_duty_types: await activeDutyTypes(query),
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
  if (isRetiredSystem(system)) return res.status(409).json({ error: systemLifecycleError(system) });

  const allLines = await liveItems(query, system);
  const pumpRole = input.pump_role || PUMP_ROLE_PRIMARY;
  if (!allowedPumpRoles.has(pumpRole)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'pump_role must be primary or venturi.' } });
  }
  const line = allLines.find(item => item.circuit_key === input.circuit_key && item.pump_role === pumpRole);
  if (!line || line.circuit_kind === 'orphaned') {
    return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit key or pump role is not active in the saved Flow Route.' } });
  }

  const pumpQuantity = pumpQuantityOrNull(input.pump_quantity);
  if (pumpQuantity == null) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Pump quantity must be between 1 and 99.' } });
  }
  if (!allowedInstallationLocations.has(input.installation_location)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'installation_location must be external or submerged.' } });
  }
  // For FFVP lines the flow basis comes from the explicit venturi_flow_m3h input.
  const isVenturi = pumpRole === PUMP_ROLE_VENTURI;
  const totalFlow = isVenturi
    ? numberOrNull(input.venturi_flow_m3h)
    : line.flow_m3h;
  const effectiveFlow = totalFlow == null ? null : Number(totalFlow) / pumpQuantity;

  if (isVenturi && (totalFlow == null || totalFlow <= 0)) {
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

  // Build a label-independent fingerprint source. Circuit names are display
  // labels and must not make saved pump sizing stale when they are renamed.
  const circuit = line;
  const dutyType = line.pump_duty_tag
    ? { id: line.pump_duty_type_id, tag: line.pump_duty_tag, pump_name: line.pump_duty_name }
    : inferPumpDutyType(circuit, pumpRole, await activeDutyTypes(query));
  if (!dutyType) {
    return res.status(400).json({
      error: { code: 'PUMP_RELATIONSHIP_REQUIRED', message: 'No active Platform Admin pump duty relationship matches this Flow Route circuit.' },
    });
  }
  const sourcePayload = pumpSourcePayload(circuit, pumpRole, effectiveFlow, {
    design_head_m: numberOrNull(input.design_head_m),
    pump_efficiency_pct: numberOrNull(input.pump_efficiency_pct),
    motor_efficiency_pct: numberOrNull(input.motor_efficiency_pct),
    pump_quantity: pumpQuantity,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lss-pump:${system.id}`]);
    await client.query(
    `INSERT INTO system_pump_selections
       (system_id,circuit_key,project_equipment_item_id,
        design_head_m,pump_efficiency_pct,motor_efficiency_pct,
        source_fingerprint,pump_snapshot,calculation_version,result_snapshot,updated_by,
          pump_role,venturi_flow_m3h,pump_quantity,pump_duty_type_id,pump_duty_snapshot,installation_location)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16::jsonb,$17)
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
        pump_quantity=EXCLUDED.pump_quantity,
        pump_duty_type_id=EXCLUDED.pump_duty_type_id,
        pump_duty_snapshot=EXCLUDED.pump_duty_snapshot,
        installation_location=EXCLUDED.installation_location,
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
      isVenturi ? totalFlow : null,
      pumpQuantity,
      dutyType.id || null,
      JSON.stringify({ tag: dutyType.tag, pump_name: dutyType.pump_name }),
       input.installation_location,
    ],
    );
    if (isLifeSupportSystem(system)) {
      await reconcilePumpLinkedInstruments(client.query.bind(client), {
        projectId: book.project_id, systemId: system.id, systemCode: system.system_code, userId: req.user!.id,
      });
    }
    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

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
  if (isRetiredSystem(system)) return res.status(409).json({ error: systemLifecycleError(system) });

  const pumpRole = input.pump_role || PUMP_ROLE_PRIMARY;
  if (!allowedPumpRoles.has(pumpRole)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'pump_role must be primary or venturi.' } });
  }
  const circuitKey = input.circuit_key;
  if (!circuitKey) return res.status(400).json({ error: { code: 'VALIDATION', message: 'circuit_key is required.' } });

  // Validate that the circuit exists and is active. A first FFVP line is not
  // returned by liveItems until it has been saved, so validate its parent
  // primary circuit rather than requiring the not-yet-existing venturi line.
  const allLines = await liveItems(query, system);
  const primaryLine = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === PUMP_ROLE_PRIMARY);
  const existingLine = allLines.find(item => item.circuit_key === circuitKey && item.pump_role === pumpRole);
  const circuitLine = pumpRole === PUMP_ROLE_VENTURI ? primaryLine : existingLine;
  if (!circuitLine || circuitLine.circuit_kind === 'orphaned') {
    return res.status(409).json({
      error: {
        code: 'INACTIVE_PUMP_DUTY',
        message: 'This pump duty is no longer active in Flow Route. Historical evidence remains available for review.',
      },
    });
  }

  // For FFVP: only allowed on Foam Fractionator circuits.
  if (pumpRole === PUMP_ROLE_VENTURI) {
    if (!primaryLine || !isFoamFractionatorCircuit(primaryLine)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Venturi pump lines are only supported on Foam Fractionator circuits.' } });
    }
  }

  // Generate a default equip_code if none supplied.
  const pumpQuantity = pumpQuantityOrNull(input.pump_quantity);
  if (pumpQuantity == null) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Pump quantity must be between 1 and 99.' } });
  }
  const requestedProduct = input.product_master_id
    ? await eligiblePumpProduct(query, String(input.product_master_id))
    : null;
  if (input.product_master_id && !requestedProduct) {
    return res.status(400).json({
      error: { code: 'INELIGIBLE_PUMP_PRODUCT', message: 'Select an active product from the PIM Pump category.' },
    });
  }
  let dutyType = inferPumpDutyType(circuitLine, pumpRole, await activeDutyTypes(query));
  if (!dutyType && input.pump_duty_type_id) {
    const requestedDuty = (await activeDutyTypes(query)).find((item: any) => item.id === input.pump_duty_type_id);
    if (!requestedDuty) {
      return res.status(400).json({ error: { code: 'INVALID_PUMP_DUTY', message: 'Select an active pump duty type.' } });
    }
    dutyType = requestedDuty;
  }
  if (!dutyType) {
    return res.status(400).json({
      error: { code: 'PUMP_RELATIONSHIP_REQUIRED', message: 'No active Platform Admin pump duty relationship matches this Flow Route circuit.' },
    });
  }
  const pumpTags = buildPumpTags(system.system_code, dutyType.tag, pumpQuantity);
  const equipCode = (input.equip_code || '').trim() || pumpTags[0];
  const description = (input.description || '').trim() || defaultPumpLineName(
    circuitLine || { circuit_name: circuitKey, circuit_type: null, circuit_kind: 'loop' },
    pumpRole,
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`${system.id}:${circuitKey}:${pumpRole}`],
    );
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lss-pump:${system.id}`]);
    const lockedSelection = (await client.query(
      `SELECT * FROM system_pump_selections
       WHERE system_id=$1 AND circuit_key=$2 AND pump_role=$3
       FOR UPDATE`,
      [system.id, circuitKey, pumpRole],
    )).rows[0];
    const existingCodeItem = (await client.query(
      `/* existing-pump-code */
       SELECT * FROM project_equipment_items
        WHERE project_id=$1 AND equip_code=$2
        FOR UPDATE`,
      [book.project_id, equipCode],
    )).rows[0] || null;
    if (lockedSelection?.project_equipment_item_id) {
      const refreshedEquipment = (await client.query(
        `UPDATE project_equipment_items
          SET quantity=$1, description=$2,
              product_master_id=COALESCE($3,product_master_id),
              status=CASE WHEN $3::uuid IS NOT NULL THEN 'Draft' ELSE status END,
              updated_at=NOW()
          WHERE id=$4 RETURNING *`,
        [pumpQuantity, `${dutyType.tag} — ${dutyType.pump_name}`, requestedProduct?.product_master_id || null, lockedSelection.project_equipment_item_id],
      )).rows[0] || lockedSelection.pump_snapshot;
      const refreshedSnapshot = {
        ...refreshedEquipment,
        ...(requestedProduct || {}),
        project_equipment_item_id: refreshedEquipment.id || lockedSelection.project_equipment_item_id,
      };
      await client.query(
        `UPDATE system_pump_selections
         SET pump_quantity=$1,pump_snapshot=$2::jsonb,pump_duty_type_id=$3,pump_duty_snapshot=$4::jsonb,updated_at=NOW()
         WHERE system_id=$5 AND circuit_key=$6 AND pump_role=$7`,
        [
          pumpQuantity,
            JSON.stringify(refreshedSnapshot),
          dutyType.id || null,
          JSON.stringify({ tag: dutyType.tag, pump_name: dutyType.pump_name }),
          system.id,
          circuitKey,
          pumpRole,
        ],
      );
       if (isLifeSupportSystem(system)) {
         await reconcilePumpLinkedInstruments(client.query.bind(client), {
           projectId: book.project_id, systemId: system.id, systemCode: system.system_code, userId: req.user!.id,
         });
       }
       await client.query('COMMIT');
      const circuit = allLines.find(item =>
        item.circuit_key === circuitKey && item.pump_role === PUMP_ROLE_PRIMARY)!;
      return res.status(200).json({
        project_equipment_item: refreshedEquipment,
        pump_line: buildPumpLineItem(circuit, {
          ...lockedSelection,
          pump_quantity: pumpQuantity,
          pump_snapshot: refreshedSnapshot,
          pump_duty_type_id: dutyType.id || null,
          pump_duty_snapshot: { tag: dutyType.tag, pump_name: dutyType.pump_name },
        }, pumpRole),
        idempotent: true,
      });
    }
    const reusedExistingCode = !!existingCodeItem;
    const previousSystemId = existingCodeItem?.system_id || null;
    const pei = reusedExistingCode
      ? (await client.query(
        `UPDATE project_equipment_items
            SET system_id=$1, quantity=$2, description=$3,
                product_master_id=COALESCE($4,product_master_id),
                status=CASE WHEN $4::uuid IS NOT NULL THEN 'Draft' ELSE status END,
                updated_at=NOW()
          WHERE id=$5
          RETURNING *`,
        [
          system.id,
          pumpQuantity,
          description,
          requestedProduct?.product_master_id || null,
          existingCodeItem.id,
        ],
      )).rows[0]
      : (await client.query(
        `INSERT INTO project_equipment_items
           (equip_code, project_id, system_id, description, quantity, unit, status, product_master_id)
         VALUES ($1,$2,$3,$4,$5,'EA','Draft',$6)
         RETURNING *`,
        [equipCode, book.project_id, system.id, description, pumpQuantity, requestedProduct?.product_master_id || null],
      )).rows[0];
    if (reusedExistingCode && previousSystemId && previousSystemId !== system.id) {
      await client.query(
        `UPDATE system_pump_selections
            SET project_equipment_item_id=NULL, pump_snapshot=NULL, updated_at=NOW()
          WHERE system_id=$1 AND project_equipment_item_id=$2`,
        [previousSystemId, existingCodeItem.id],
      );
    }
    const circuit = allLines.find(item =>
      item.circuit_key === circuitKey && item.pump_role === PUMP_ROLE_PRIMARY);
    if (!circuit) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit key is not active in the saved Flow Route.' } });
    }
    // Governed product hydraulics are the preferred seed. If the selected
    // products do not expose a complete venturi duty, use the resolved FFSP
    // Flow Route demand and persist it as the FFVP's explicit duty.
    const positiveNumberOrNull = (value: any) => {
      const number = numberOrNull(value);
      return number != null && number > 0 ? number : null;
    };
    const venturiFlow = pumpRole === PUMP_ROLE_VENTURI
      ? (positiveNumberOrNull(circuit.venturi_flow_m3h)
        ?? positiveNumberOrNull(input.venturi_flow_m3h)
        ?? positiveNumberOrNull(circuit.flow_m3h))
      : null;
    const totalFlow = pumpRole === PUMP_ROLE_VENTURI ? venturiFlow : numberOrNull(circuit.flow_m3h);
    const effectiveFlow = totalFlow == null ? null : totalFlow / pumpQuantity;
    const source = pumpSourcePayload(circuit, pumpRole, effectiveFlow, {
      design_head_m: existingLine?.design_head_m ?? null,
      pump_efficiency_pct: existingLine?.pump_efficiency_pct ?? null,
      motor_efficiency_pct: existingLine?.motor_efficiency_pct ?? null,
      pump_quantity: pumpQuantity,
    });
    const calculation = calculatePumpSelection({
      flow_m3h: effectiveFlow,
      design_head_m: existingLine?.design_head_m,
      pump_efficiency_pct: existingLine?.pump_efficiency_pct,
      motor_efficiency_pct: existingLine?.motor_efficiency_pct,
    });
    const snapshot = {
      ...pei,
      ...(requestedProduct || {}),
      id: pei.id,
      project_equipment_item_id: pei.id,
    };
    await client.query(
      `INSERT INTO system_pump_selections
         (system_id,circuit_key,project_equipment_item_id,design_head_m,
           pump_efficiency_pct,motor_efficiency_pct,source_fingerprint,pump_snapshot,
           calculation_version,result_snapshot,updated_by,pump_role,venturi_flow_m3h,pump_quantity,
           pump_duty_type_id,pump_duty_snapshot)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16::jsonb)
        ON CONFLICT (system_id,circuit_key,pump_role) DO UPDATE SET
          project_equipment_item_id=EXCLUDED.project_equipment_item_id,
          design_head_m=EXCLUDED.design_head_m,
          pump_efficiency_pct=EXCLUDED.pump_efficiency_pct,
          motor_efficiency_pct=EXCLUDED.motor_efficiency_pct,
          source_fingerprint=EXCLUDED.source_fingerprint,
          pump_snapshot=EXCLUDED.pump_snapshot,
          calculation_version=EXCLUDED.calculation_version,
          result_snapshot=EXCLUDED.result_snapshot,
          updated_by=EXCLUDED.updated_by,
          venturi_flow_m3h=EXCLUDED.venturi_flow_m3h,
           pump_quantity=EXCLUDED.pump_quantity,
          pump_duty_type_id=EXCLUDED.pump_duty_type_id,
          pump_duty_snapshot=EXCLUDED.pump_duty_snapshot,
          updated_at=NOW()`,
      [
        system.id, circuitKey, pei.id,
        existingLine?.design_head_m ?? null,
        existingLine?.pump_efficiency_pct ?? null,
        existingLine?.motor_efficiency_pct ?? null,
        pumpSourceFingerprint(source), JSON.stringify(snapshot),
        PUMP_SELECTION_CALCULATION_VERSION, JSON.stringify(calculation),
        req.user!.id, pumpRole, venturiFlow, pumpQuantity,
        dutyType.id || null, JSON.stringify({ tag: dutyType.tag, pump_name: dutyType.pump_name }),
      ],
    );
    if (isLifeSupportSystem(system)) {
      await reconcilePumpLinkedInstruments(client.query.bind(client), {
        projectId: book.project_id, systemId: system.id, systemCode: system.system_code, userId: req.user!.id,
      });
    }
    await client.query('COMMIT');
    res.status(reusedExistingCode ? 200 : 201).json({ project_equipment_item: pei, pump_line: buildPumpLineItem(circuit, {
      project_equipment_item_id: pei.id,
      pump_snapshot: snapshot,
      source_fingerprint: pumpSourceFingerprint(source),
      calculation_version: PUMP_SELECTION_CALCULATION_VERSION,
      result_snapshot: calculation,
      pump_role: pumpRole,
      venturi_flow_m3h: venturiFlow,
      pump_quantity: pumpQuantity,
      pump_duty_type_id: dutyType.id || null,
      pump_duty_snapshot: { tag: dutyType.tag, pump_name: dutyType.pump_name },
    }, pumpRole), ...(reusedExistingCode ? { reassigned_existing_code: true } : {}) });
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
  if (isRetiredSystem(system)) return res.status(409).json({ error: systemLifecycleError(system) });
  const sideStreams = (await query(
    'SELECT * FROM system_flow_side_streams WHERE system_id=$1 ORDER BY parent_loop_number, sort_order, created_at, id',
    [system.id],
  )).rows;
  const circuit = pumpCircuits(system, sideStreams).find(item => item.circuit_key === circuitKey);
  if (!circuit || !isFoamFractionatorCircuit(circuit)) {
    return res.status(400).json({ error: { code: 'INVALID_CIRCUIT', message: 'The venturi line belongs to an active Foam Fractionator circuit.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lss-pump:${system.id}`]);
    await client.query(
      'DELETE FROM system_pump_selections WHERE system_id=$1 AND circuit_key=$2 AND pump_role=$3',
      [req.params.id, circuitKey, pumpRole],
    );
    if (isLifeSupportSystem(system)) {
      await reconcilePumpLinkedInstruments(client.query.bind(client), {
        projectId: book.project_id, systemId: system.id, systemCode: system.system_code, userId: req.user!.id,
      });
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export default router;
