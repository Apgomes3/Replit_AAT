import { Router, Response } from 'express';
import pool, { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import { loadReleaseContext } from './designBooks';
import { isLifeSupportSystem } from '../lib/lssSystems';
import { isRetiredSystem, systemLifecycleError } from '../lib/systemLifecycle';
import {
  buildInstrumentTag, hasExplicitInstrumentProductOverride, hasValidRetainedRequiredControlLogic,
  initialInstrumentControlLogic, initialInstrumentProduct,
} from '../lib/lssControls';
import { logAudit } from '../db/audit';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));

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
async function bookAndSystem(bookId: string, systemId: string) {
  const context = await loadReleaseContext(bookId, query, false, true);
  const system = context?.systems?.find((value: any) => value.id === systemId);
  return { book: context, system };
}

router.get('/systems/:id/control', async (req: AuthRequest, res: Response) => {
  const bookId = String(req.query.design_book_id || '');
  if (!bookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  const { book, system } = await bookAndSystem(bookId, String(req.params.id));
  if (!book || !system || !isLifeSupportSystem(system)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
  if (book.status === 'Released' && book.release_snapshot) {
    const saved = book.release_snapshot.lss_controls?.find((item: any) => item.system_id === system.id);
    const snapshot = book.release_snapshot;
    return res.json(frozenPayload(saved, snapshot, system.id));
  }
  if (['For Review', 'Approved'].includes(book.status) && book.review_snapshot) {
    const saved = book.review_snapshot.lss_controls?.find((item: any) => item.system_id === system.id);
    const snapshot = book.review_snapshot;
    return res.json(frozenPayload(saved, snapshot, system.id));
  }
  if (isRetiredSystem(system)) return res.status(409).json({ error: systemLifecycleError(system) });
  res.json(await responsePayload(query, bookId, system));
});

router.put('/systems/:id/control', requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const input = req.body || {};
  const bookId = String(input.design_book_id || '');
  if (!bookId || !['GPO', 'PLC'].includes(input.panel_type)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id and panel_type (GPO or PLC) are required.' } });
  const { book, system } = await bookAndSystem(bookId, String(req.params.id));
  if (!book || !system || !isLifeSupportSystem(system)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Life Support System not found in Design Book project.' } });
  if (!['Draft', 'In Progress'].includes(book.status)) return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Design Book is not editable.' } });
  if (isRetiredSystem(system)) return res.status(409).json({ error: systemLifecycleError(system) });
  if (!Array.isArray(input.instruments)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'instruments must be an array.' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lss-instruments:${bookId}:${system.id}`]);
    const definitions = await activeDefinitions(client.query.bind(client));
      const requested = new Map<string, {
        quantity: number; product_master_id: string | null; product_supplied: boolean;
        control_logic: string | null; control_logic_supplied: boolean;
      }>();
    for (const item of input.instruments) {
      const definition = definitions.find((value: any) => value.id === item.definition_id);
      const quantity = Number(item.quantity);
      const productSupplied = hasExplicitInstrumentProductOverride(item);
      if (!definition || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Each instrument needs an active definition and quantity from 0 to 99.' } });
      }
      if (requested.has(definition.id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Each instrument definition may be supplied once.' } });
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
      requested.set(definition.id, {
        quantity, product_master_id: item.product_master_id || null,
        product_supplied: productSupplied,
          control_logic: String(item.control_logic || '').trim() || null,
          control_logic_supplied: Object.prototype.hasOwnProperty.call(item, 'control_logic'),
      });
    }
    const minimum = await pumpMinimum(client.query.bind(client), system.id);
    const mandatory = definitions.find((definition: any) =>
      definition.requirement_rule === 'mandatory' && (requested.get(definition.id)?.quantity || 0) < 1);
    if (mandatory) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { code: 'MANDATORY_INSTRUMENT', message: `${mandatory.name} requires at least one instrument.`, definition_id: mandatory.id } });
    }
    const underCountedPumpLinked = definitions.find((definition: any) =>
      definition.requirement_rule === 'pump_linked' && (requested.get(definition.id)?.quantity || 0) < minimum);
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
    // Inactive definitions are intentionally retained as historical evidence.
    // They are not editable in this form, so do not let a save silently retain
    // an invalid required instance that has no control logic.
    const inactiveRequiredWithoutLogic = existing.find(row =>
      !definitions.some((definition: any) => definition.id === row.definition_id) &&
      ['mandatory', 'pump_linked'].includes(String(row.definition_snapshot?.requirement_rule)) &&
      !String(row.control_logic || '').trim());
    if (inactiveRequiredWithoutLogic) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: {
          code: 'INSTRUMENT_CONTROL_LOGIC_REQUIRED',
          message: 'A retained required instrument instance has no control logic and cannot be saved.',
          definition_id: inactiveRequiredWithoutLogic.definition_id,
        },
      });
    }
      for (const definition of definitions) {
      const desired = requested.get(definition.id)?.quantity || 0;
      const rows = existing.filter(row => row.definition_id === definition.id).sort((a, b) => a.sequence_number - b.sequence_number);
      const retainedRows = rows.slice(0, desired);
      const requestedInstrument = requested.get(definition.id);
      // Required evidence must never be left without executable logic. A
      // supplied value applies to every retained instance; otherwise each
      // retained row keeps its own historic designer evidence.
      if (!hasValidRetainedRequiredControlLogic(
        definition.requirement_rule, retainedRows, requestedInstrument,
      )) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: {
            code: 'INSTRUMENT_CONTROL_LOGIC_REQUIRED',
            message: `${definition.name} requires control logic for every retained instrument instance.`,
            definition_id: definition.id,
          },
        });
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
        if (desired > rows.length && !controlLogic) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: {
              code: 'INSTRUMENT_CONTROL_LOGIC_REQUIRED',
              message: `${definition.name} has no governed default control logic. Define its control logic in LSS Control before saving.`,
            },
          });
        }
      for (let sequence = rows.length + 1; sequence <= desired; sequence++) {
        const product = await productSnapshot(client.query.bind(client), selectedProduct);
        await client.query(
          `INSERT INTO design_book_lss_instruments
           (design_book_id,system_id,definition_id,tag,sequence_number,control_logic,product_master_id,definition_snapshot,product_snapshot,created_by,updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$10)`,
          [bookId, system.id, definition.id, buildInstrumentTag(system.system_code, definition.tag_code, sequence),
             sequence, controlLogic, selectedProduct, JSON.stringify(definition), JSON.stringify(product), req.user!.id],
        );
      }
      if (rows.length && requestedProduct?.product_supplied) {
        const product = await productSnapshot(client.query.bind(client), selectedProduct);
        await client.query(
          'UPDATE design_book_lss_instruments SET product_master_id=$1,product_snapshot=$2::jsonb,updated_by=$3,updated_at=NOW() WHERE id=ANY($4::uuid[])',
          [selectedProduct, JSON.stringify(product), req.user!.id, rows.slice(0, desired).map(row => row.id)],
        );
      }
      if (rows.length && requestedProduct?.control_logic_supplied) {
        await client.query(
          'UPDATE design_book_lss_instruments SET control_logic=$1,updated_by=$2,updated_at=NOW() WHERE id=ANY($3::uuid[])',
          [requestedProduct.control_logic, req.user!.id, rows.slice(0, desired).map(row => row.id)],
        );
      }
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