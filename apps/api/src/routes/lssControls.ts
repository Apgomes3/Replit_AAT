import { Router, Response } from 'express';
import pool, { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import { loadReleaseContext } from './designBooks';
import { isLifeSupportSystem } from '../lib/lssSystems';
import { isRetiredSystem, systemLifecycleError } from '../lib/systemLifecycle';
import {
  buildInstrumentTag, hasExplicitInstrumentProductOverride,
  initialInstrumentControlLogic, initialInstrumentProduct, isControlValveCode, valveEffectiveDefinition,
} from '../lib/lssControls';
import { logAudit } from '../db/audit';
import { projectLssIoSchedule, renderLssIoSchedulePdf } from '../lib/lssIoSchedule';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));

type DbRunner = (text: string, params?: any[]) => Promise<{ rows: any[] }>;
const CONTROL_QUERY_TIMEOUT_MS = 10_000;
const controlQuery: DbRunner = (text, params) => pool.query({
  text,
  values: params,
  query_timeout: CONTROL_QUERY_TIMEOUT_MS,
} as any) as any;

async function controlStage<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await work();
    const durationMs = Date.now() - startedAt;
    if (durationMs > 1_000) {
      console.warn('[lss-control] slow load stage', { stage, durationMs });
    }
    return result;
  } catch (error: any) {
    console.error('[lss-control] load stage failed', {
      stage,
      durationMs: Date.now() - startedAt,
      code: error?.code,
      message: error?.message,
    });
    throw error;
  }
}

function controlLoadFailure(res: Response, error: any) {
  const timedOut = error?.code === '57014'
    || /timeout|timed out/i.test(String(error?.message || ''));
  if (timedOut) {
    return res.status(503).json({
      error: {
        code: 'CONTROL_LOAD_TIMEOUT',
        message: 'Control configuration is temporarily unavailable. Please retry.',
      },
    });
  }
  throw error;
}

const productSnapshot = async (runner: any, id: string | null) => {
  if (!id) return null;
  return (await runner('SELECT id, product_code, product_name, status FROM product_masters WHERE id=$1', [id])).rows[0] || null;
};
async function canManagePim(runner: any, userId: string, role?: string) {
  if (role === 'admin') return true;
  const result = await runner(
    `SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key='pim'
      WHERE u.id=$1`,
    [userId],
  );
  return result.rows[0]?.access_level === 'manage';
}
const activeDefinitions = async (runner: any) => (await runner(
  `SELECT d.*, pm.product_code AS default_product_code, pm.product_name AS default_product_name,
          pm.status AS default_product_status
   FROM field_instrument_definitions d LEFT JOIN product_masters pm ON pm.id=d.default_product_master_id
   WHERE d.is_active=true ORDER BY d.sort_order,d.tag_code`,
)).rows;
function mergeHistoricalDefinitions(definitions: any[], instruments: any[]) {
  const merged = new Map<string, any>();
  for (const definition of definitions || []) {
    if (definition?.id) merged.set(definition.id, definition);
  }
  // Inactive and released definitions are deliberately reconstructed from the
  // instance evidence. Catalogue lifecycle changes must not erase design-book
  // readability or replace the governed definition used at allocation time.
  for (const instrument of instruments || []) {
    const snapshot = instrument?.definition_snapshot;
    const id = instrument?.definition_id || snapshot?.id;
    if (id && snapshot && Object.keys(snapshot).length && !merged.has(id)) {
      merged.set(id, { ...snapshot, id });
    }
  }
  return [...merged.values()].sort((left, right) =>
    Number(left.sort_order || 0) - Number(right.sort_order || 0) ||
    String(left.tag_code || '').localeCompare(String(right.tag_code || '')),
  );
}
function frozenPayload(saved: any, snapshot: any, systemId: string) {
  const instruments = saved?.instruments ||
    (snapshot.lss_instrument_instances || []).filter((item: any) => item.system_id === systemId);
  return {
    control: saved?.control || snapshot.lss_control_configurations?.find((item: any) => item.system_id === systemId) || null,
    instruments,
    definitions: mergeHistoricalDefinitions(saved?.definitions || [], instruments),
    frozen: true,
  };
}
async function pumpMinimum(runner: any, systemId: string) {
  const result = await runner(
    `SELECT COALESCE(SUM(COALESCE(pump_quantity,1)),0)::int AS quantity
     FROM system_pump_selections WHERE system_id=$1 AND project_equipment_item_id IS NOT NULL`,
    [systemId],
  );
  return Number(result.rows[0]?.quantity || 0);
}
async function responsePayload(runner: any, bookId: string, system: any, frozen = false) {
  const definitions = await activeDefinitions(runner);
  const instruments = (await runner(
    `SELECT i.*, pm.product_code,pm.product_name,pm.status AS product_status
     FROM design_book_lss_instruments i LEFT JOIN product_masters pm ON pm.id=i.product_master_id
     WHERE i.design_book_id=$1 AND i.system_id=$2 ORDER BY i.definition_snapshot->>'tag_code',i.sequence_number`,
    [bookId, system.id],
  )).rows;
  const control = (await runner('SELECT * FROM design_book_lss_controls WHERE design_book_id=$1 AND system_id=$2', [bookId, system.id])).rows[0] || null;
  return {
    control, instruments, definitions: mergeHistoricalDefinitions(definitions, instruments),
    pump_linked_fs_minimum: await pumpMinimum(runner, system.id), frozen,
  };
}
async function bookAndSystem(bookId: string, systemId: string, runner: DbRunner = controlQuery) {
  // Control editing needs only the parent book and selected system. Loading the
  // full Design Book aggregate here used to execute every engineering package
  // query and made this small panel vulnerable to unrelated catalogue locks.
  const book = (await runner(
    'SELECT id,project_id,status,review_snapshot,release_snapshot FROM design_books WHERE id=$1',
    [bookId],
  )).rows[0] || null;
  if (!book) return { book: null, system: null };
  const system = (await runner(
    'SELECT * FROM systems WHERE id=$1 AND project_id=$2',
    [systemId, book.project_id],
  )).rows[0] || null;
  return { book, system };
}

router.get('/systems/:id/control/io-schedule.pdf', async (req: AuthRequest, res: Response) => {
  const bookId = String(req.query.design_book_id || '');
  if (!bookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  // Keep the same source-of-truth rule as the control screen: draft books
  // render saved live instances, while review/released books render only the
  // frozen package captured for that state.
  // Determine frozen state before loading the live aggregate. In particular,
  // loadReleaseContext's live aggregate joins current PIM product rows, which
  // must never be consulted while rendering a frozen book.
  const stored = (await query(
    'SELECT id,book_code,book_title,project_id,status,review_snapshot,release_snapshot FROM design_books WHERE id=$1',
    [bookId],
  )).rows[0];
  if (!stored) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design Book not found.' } });
  const frozenStatus = stored.status === 'Released' || ['For Review', 'Approved'].includes(stored.status);
  const frozenSnapshot = stored.status === 'Released' ? stored.release_snapshot
    : ['For Review', 'Approved'].includes(stored.status) ? stored.review_snapshot : null;
  if (frozenStatus && !frozenSnapshot) {
    return res.status(409).json({
      error: {
        code: 'DESIGN_BOOK_SNAPSHOT_MISSING',
        message: 'The frozen Design Book evidence required for this I/O schedule is unavailable.',
      },
    });
  }
  const book = frozenSnapshot ? stored : await loadReleaseContext(bookId, query, false, true);
  const source = frozenSnapshot || book;
  // Resolve issued work from the frozen package itself. A renamed, retired, or
  // removed live system must not change whether an issued schedule can export.
  const selectedSystem = (source.systems || []).find((system: any) => system.id === req.params.id);
  if (!selectedSystem || !isLifeSupportSystem(selectedSystem)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
  }
  const systems = [selectedSystem];
  const controls = (source.lss_controls || []).filter((item: any) =>
    item.system_id === selectedSystem.id);
  // Some older snapshots retained the flat compatibility arrays only.
  const packages = controls.length
    ? controls
    : [{
      system_id: selectedSystem.id,
      control: (source.lss_control_configurations || []).find((item: any) => item.system_id === selectedSystem.id) || null,
      instruments: (source.lss_instrument_instances || []).filter((item: any) => item.system_id === selectedSystem.id),
    }];
  const pdf = await renderLssIoSchedulePdf(book, projectLssIoSchedule(systems, packages));
  const safeBookCode = String(book.book_code || 'lss-io-schedule').replace(/[^a-z0-9_.-]/gi, '-');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeBookCode}-lss-io-schedule.pdf"`,
    'Cache-Control': 'no-store',
  });
  return res.send(pdf);
});

router.get('/systems/:id/control', async (req: AuthRequest, res: Response) => {
  const bookId = String(req.query.design_book_id || '');
  if (!bookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  try {
    const { book: stored, system: liveSystem } = await controlStage(
      'book-and-system',
      () => bookAndSystem(bookId, String(req.params.id)),
    );
    if (!stored) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design Book not found.' } });
    if (stored.status === 'Released' || ['For Review', 'Approved'].includes(stored.status)) {
      const snapshot = stored.status === 'Released' ? stored.release_snapshot : stored.review_snapshot;
      if (!snapshot) {
        return res.status(409).json({
          error: {
            code: 'DESIGN_BOOK_SNAPSHOT_MISSING',
            message: 'The frozen Design Book evidence required for this control configuration is unavailable.',
          },
        });
      }
      const system = (snapshot.systems || []).find((value: any) => value.id === req.params.id);
      if (!system || !isLifeSupportSystem(system)) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
      }
      const saved = snapshot.lss_controls?.find((item: any) => item.system_id === system.id);
      return res.json(frozenPayload(saved, snapshot, system.id));
    }
    if (!liveSystem || !isLifeSupportSystem(liveSystem)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
    }
    if (isRetiredSystem(liveSystem)) return res.status(409).json({ error: systemLifecycleError(liveSystem) });
    const payload = await controlStage(
      'configuration-payload',
      () => responsePayload(controlQuery, bookId, liveSystem),
    );
    return res.json(payload);
  } catch (error) {
    return controlLoadFailure(res, error);
  }
});

router.put('/systems/:id/control', requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const input = req.body || {};
  const bookId = String(input.design_book_id || '');
  if (!bookId || !['GPO', 'PLC'].includes(input.panel_type)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id and panel_type (GPO or PLC) are required.' } });
  const { book, system } = await bookAndSystem(bookId, String(req.params.id), query);
  if (!book || !system || !isLifeSupportSystem(system)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
  if (!['Draft', 'In Progress'].includes(book.status)) return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
  if (isRetiredSystem(system)) return res.status(409).json({ error: systemLifecycleError(system) });
  if (!Array.isArray(input.instruments)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'instruments must be an array.' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lss-instruments:${bookId}:${system.id}`]);
    const definitions = await activeDefinitions(client.query.bind(client));
      const requested = new Map<string, Array<{
        quantity: number; product_master_id: string | null; product_supplied: boolean;
         group_key: string; nominal_size: string | null;
         actuation_type: 'Electric' | 'Pneumatic';
        control_logic: string | null; control_logic_supplied: boolean;
        range_min: number | null; range_max: number | null; unit: string | null; range_supplied: boolean;
        calibration_required: boolean; calibration_interval_days: number | null;
        calibration_procedure: string | null; datasheet_reference: string | null; calibration_supplied: boolean;
      }>>();
    for (const item of input.instruments) {
      const definition = definitions.find((value: any) => value.id === item.definition_id);
      const quantity = Number(item.quantity);
      const productSupplied = hasExplicitInstrumentProductOverride(item);
      const rangeSupplied = ['range_min', 'range_max', 'unit'].some(key => Object.prototype.hasOwnProperty.call(item, key));
      const calibrationSupplied = ['calibration_required', 'calibration_interval_days', 'calibration_procedure', 'datasheet_reference']
        .some(key => Object.prototype.hasOwnProperty.call(item, key));
      if (!definition || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Each instrument needs an active definition and quantity from 0 to 99.' } });
      }
       const isValve = isControlValveCode(definition.tag_code);
      const groupKey = isValve ? String(item.group_key || '').trim() : definition.id;
      if (!groupKey || (requested.get(definition.id) || []).some(group => group.group_key === groupKey)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Each instrument definition may be supplied once.' } });
      }
      const rangeMin = item.range_min === '' || item.range_min == null ? null : Number(item.range_min);
      const rangeMax = item.range_max === '' || item.range_max == null ? null : Number(item.range_max);
      const interval = item.calibration_interval_days === '' || item.calibration_interval_days == null
        ? null : Number(item.calibration_interval_days);
      if ((rangeSupplied && !definition.allow_range_override) || (calibrationSupplied && !definition.allow_calibration_override)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: { code: 'INSTRUMENT_OVERRIDE_NOT_PERMITTED', message: `${definition.name} does not permit this evidence override.` } });
      }
      if ((rangeMin != null && !Number.isFinite(rangeMin)) || (rangeMax != null && !Number.isFinite(rangeMax)) ||
          (rangeMin != null && rangeMax != null && rangeMin > rangeMax) ||
          (interval != null && (!Number.isInteger(interval) || interval < 1))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'VALIDATION', message: `${definition.name} has an invalid range or calibration interval.` } });
      }
      // Supplying null is a deliberate product override too: clearing a
      // product must have the same PIM-manage permission as changing it.
      if (productSupplied) {
        if (!await canManagePim(client.query.bind(client), req.user!.id, req.user!.role)) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: { code: 'MODULE_READ_ONLY', message: 'PIM manage access is required to override an instrument product.' } });
        }
        const product = item.product_master_id
          ? await productSnapshot(client.query.bind(client), item.product_master_id)
          : null;
        if (item.product_master_id && (!product || product.status !== 'Active')) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: { code: 'INVALID_PRODUCT', message: 'Select an active PIM product for an instrument override.' } });
        }
      }
      const group = {
        quantity, product_master_id: item.product_master_id || null,
          group_key: groupKey, nominal_size: isValve ? String(item.nominal_size || '').trim() || null : null,
         actuation_type: (item.actuation_type === 'Pneumatic' ? 'Pneumatic' : 'Electric') as 'Electric' | 'Pneumatic',
        product_supplied: productSupplied,
          control_logic: String(item.control_logic || '').trim() || null,
          control_logic_supplied: Object.prototype.hasOwnProperty.call(item, 'control_logic'),
          range_min: rangeMin, range_max: rangeMax, unit: String(item.unit || '').trim() || null, range_supplied: rangeSupplied,
          calibration_required: item.calibration_required === true, calibration_interval_days: interval,
          calibration_procedure: String(item.calibration_procedure || '').trim() || null,
          datasheet_reference: String(item.datasheet_reference || '').trim() || null,
          calibration_supplied: calibrationSupplied,
      };
      requested.set(definition.id, [...(requested.get(definition.id) || []), group]);
    }
    const minimum = await pumpMinimum(client.query.bind(client), system.id);
    const mandatory = definitions.find((definition: any) =>
      definition.requirement_rule === 'mandatory' && (requested.get(definition.id) || []).reduce((sum, group) => sum + group.quantity, 0) < 1);
    if (mandatory) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { code: 'MANDATORY_INSTRUMENT', message: `${mandatory.name} requires at least one instrument.`, definition_id: mandatory.id } });
    }
    const underCountedPumpLinked = definitions.find((definition: any) =>
      definition.requirement_rule === 'pump_linked' && (requested.get(definition.id) || []).reduce((sum, group) => sum + group.quantity, 0) < minimum);
    if (underCountedPumpLinked) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { code: 'MANDATORY_FLOW_SWITCHES', message: `${underCountedPumpLinked.name} quantity cannot be lower than the ${minimum} configured pump(s).`, minimum, definition_id: underCountedPumpLinked.id } });
    }
    await client.query(
      `INSERT INTO design_book_lss_controls (design_book_id,system_id,panel_type,updated_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (design_book_id,system_id)
       DO UPDATE SET panel_type=EXCLUDED.panel_type,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [bookId, system.id, input.panel_type, req.user!.id],
    );
    const existing = (await client.query(
      'SELECT * FROM design_book_lss_instruments WHERE design_book_id=$1 AND system_id=$2 FOR UPDATE', [bookId, system.id],
    )).rows;
      for (const definition of definitions) {
      const groups = requested.get(definition.id) || [];
       const valve = isControlValveCode(definition.tag_code);
      const allRows = existing.filter(row => row.definition_id === definition.id).sort((a, b) => a.sequence_number - b.sequence_number);
      const used = new Set<string>();
      let sequence = allRows.reduce((max, row) => Math.max(max, Number(row.sequence_number || 0)), 0);
      for (const requestedInstrument of groups) {
      const desired = requestedInstrument.quantity;
      const rows = allRows.filter(row => {
        if (used.has(row.id)) return false;
        // Legacy rows have no group key and remain the first unsized group.
        return valve ? (row.group_key === requestedInstrument.group_key
          || (!row.group_key && requestedInstrument.group_key === groups[0].group_key)) : true;
      }).slice(0, desired);
      rows.forEach(row => used.add(row.id));
      const excess = allRows.filter(row => !used.has(row.id) && (valve ? row.group_key === requestedInstrument.group_key : true));
      if (excess.length > Math.max(0, desired - rows.length)) {
        const remove = excess.slice(Math.max(0, desired - rows.length));
        await client.query('DELETE FROM design_book_lss_instruments WHERE id = ANY($1::uuid[])', [remove.map(row => row.id)]);
        remove.forEach(row => used.add(row.id));
      }
      if (rows.length > desired) await client.query('DELETE FROM design_book_lss_instruments WHERE id = ANY($1::uuid[])', [rows.slice(desired).map(row => row.id)]);
      const requestedProduct = requestedInstrument;
        // Existing selections are frozen designer evidence. Each newly added
        // instance imports the active definition default unless the designer
        // deliberately supplied an override in this save; it must never inherit
        // a prior instance's product or a later catalogue edit.
         const selectedProduct = initialInstrumentProduct(
          definition.default_product_master_id,
          requestedProduct,
        );
        const controlLogic = initialInstrumentControlLogic(
          definition.default_control_logic,
          requestedProduct,
        );
        const rangeMin = requestedProduct?.range_supplied ? requestedProduct.range_min : definition.default_range_min;
        const rangeMax = requestedProduct?.range_supplied ? requestedProduct.range_max : definition.default_range_max;
        const unit = requestedProduct?.range_supplied ? requestedProduct.unit : definition.default_unit;
        const calibrationRequired = requestedProduct?.calibration_supplied ? requestedProduct.calibration_required : definition.default_calibration_required;
        const calibrationInterval = requestedProduct?.calibration_supplied ? requestedProduct.calibration_interval_days : definition.default_calibration_interval_days;
        const calibrationProcedure = requestedProduct?.calibration_supplied ? requestedProduct.calibration_procedure : definition.default_calibration_procedure;
        const datasheetReference = requestedProduct?.calibration_supplied ? requestedProduct.datasheet_reference : definition.default_datasheet_reference;
       const actuationType = requestedProduct.actuation_type;
       const effectiveDefinition = valveEffectiveDefinition(definition, actuationType);
       for (let index = rows.length; index < desired; index++) {
        sequence += 1;
        const product = await productSnapshot(client.query.bind(client), selectedProduct);
        await client.query(
          `INSERT INTO design_book_lss_instruments
             (design_book_id,system_id,definition_id,tag,sequence_number,control_logic,range_min,range_max,unit,
             calibration_required,calibration_interval_days,calibration_procedure,datasheet_reference,
              product_master_id,definition_snapshot,product_snapshot,group_key,nominal_size,actuation_type,created_by,updated_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$20)`,
           [bookId, system.id, definition.id, buildInstrumentTag(system.system_code, effectiveDefinition.tag_code, sequence),
             sequence, controlLogic, rangeMin, rangeMax, unit, calibrationRequired, calibrationInterval,
              calibrationProcedure, datasheetReference, selectedProduct, JSON.stringify(effectiveDefinition), JSON.stringify(product),
              requestedInstrument.group_key, requestedInstrument.nominal_size, actuationType, req.user!.id],
        );
      }
      if (rows.length) {
        for (const row of rows) {
          await client.query(
            `UPDATE design_book_lss_instruments
               SET group_key=$1,nominal_size=$2,actuation_type=$3,definition_snapshot=$4::jsonb,
                   tag=$5,updated_by=$6,updated_at=NOW()
              WHERE id=$7
                AND (group_key IS DISTINCT FROM $1
                  OR nominal_size IS DISTINCT FROM $2
                  OR actuation_type IS DISTINCT FROM $3
                  OR definition_snapshot IS DISTINCT FROM $4::jsonb
                  OR tag IS DISTINCT FROM $5)`,
            [requestedInstrument.group_key, requestedInstrument.nominal_size, actuationType,
              JSON.stringify(effectiveDefinition),
              buildInstrumentTag(system.system_code, effectiveDefinition.tag_code, row.sequence_number),
              req.user!.id, row.id],
          );
        }
      }
      if (rows.length && requestedProduct?.product_supplied) {
        const product = await productSnapshot(client.query.bind(client), selectedProduct);
        await client.query(
          `UPDATE design_book_lss_instruments
              SET product_master_id=$1,product_snapshot=$2::jsonb,updated_by=$3,updated_at=NOW()
            WHERE id=ANY($4::uuid[])
              AND (product_master_id IS DISTINCT FROM $1
                OR product_snapshot IS DISTINCT FROM $2::jsonb)`,
          [selectedProduct, JSON.stringify(product), req.user!.id, rows.slice(0, desired).map(row => row.id)],
        );
      }
      if (rows.length && requestedProduct?.control_logic_supplied) {
        await client.query(
          'UPDATE design_book_lss_instruments SET control_logic=$1,updated_by=$2,updated_at=NOW() WHERE id=ANY($3::uuid[])',
          [requestedProduct.control_logic, req.user!.id, rows.slice(0, desired).map(row => row.id)],
        );
      }
      if (rows.length && requestedProduct?.range_supplied) {
        await client.query(
          'UPDATE design_book_lss_instruments SET range_min=$1,range_max=$2,unit=$3,updated_by=$4,updated_at=NOW() WHERE id=ANY($5::uuid[])',
          [requestedProduct.range_min, requestedProduct.range_max, requestedProduct.unit, req.user!.id, rows.slice(0, desired).map(row => row.id)],
        );
      }
      if (rows.length && requestedProduct?.calibration_supplied) {
        await client.query(
          `UPDATE design_book_lss_instruments SET calibration_required=$1,calibration_interval_days=$2,
           calibration_procedure=$3,datasheet_reference=$4,updated_by=$5,updated_at=NOW() WHERE id=ANY($6::uuid[])`,
          [requestedProduct.calibration_required, requestedProduct.calibration_interval_days,
            requestedProduct.calibration_procedure, requestedProduct.datasheet_reference, req.user!.id,
            rows.slice(0, desired).map(row => row.id)],
        );
      }
      }
      // Remove rows for groups deleted by the designer.
      const leftovers = allRows.filter(row => !used.has(row.id));
      if (leftovers.length) await client.query('DELETE FROM design_book_lss_instruments WHERE id = ANY($1::uuid[])', [leftovers.map(row => row.id)]);
    }
    await client.query('COMMIT');
    await logAudit(req.user!.id, 'design_book_lss_control', `${bookId}:${system.id}`, 'UPDATE', { panel_type: input.panel_type });
    res.json(await responsePayload(query, bookId, system));
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE_TAG', message: 'Instrument tag allocation conflicted; retry the save.' } });
    throw error;
  } finally {
    client.release();
  }
});

export default router;
