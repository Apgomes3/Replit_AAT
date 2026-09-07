import { systemNumberToken } from './pumpSelections';

/** Tag format is deliberately shared by persistence and focused unit tests. */
export function buildInstrumentTag(systemCode: unknown, tagCode: unknown, sequence: unknown) {
  const number = Number(sequence);
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new Error('Instrument sequence must be between 1 and 99.');
  }
  const code = String(tagCode || '').trim();
  if (!/^[A-Za-z0-9-]+$/.test(code)) throw new Error('Instrument tag code is invalid.');
  return `${systemNumberToken(systemCode)}-${code}-${String(number).padStart(2, '0')}`;
}

export function requiredPumpLinkedQuantity(pumpRows: Array<{ project_equipment_item_id?: unknown; pump_quantity?: unknown }>) {
  return pumpRows.reduce((total, row) => {
    if (!row.project_equipment_item_id) return total;
    const quantity = Number(row.pump_quantity);
    return total + (Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
  }, 0);
}

/**
 * An instrument is evidence of the catalogue entry at the time it is added.
 * A requested product is an intentional designer override; otherwise a new
 * instance imports the definition's then-current AAT default.  In particular,
 * do not derive this from an older instance of the same type: that would
 * propagate a historic override (or a superseded default) to a new instance.
 */
export function initialInstrumentProduct(
  definitionDefaultProductId: string | null | undefined,
  requestedProduct: { product_supplied: boolean; product_master_id: string | null } | undefined,
) {
  return requestedProduct?.product_supplied
    ? requestedProduct.product_master_id
    : definitionDefaultProductId || null;
}

/** Mirrors product import semantics for editable, per-instance control logic. */
export function initialInstrumentControlLogic(
  definitionDefaultLogic: string | null | undefined,
  requestedLogic: { control_logic_supplied: boolean; control_logic: string | null } | undefined,
) {
  return requestedLogic?.control_logic_supplied
    ? requestedLogic.control_logic
    : String(definitionDefaultLogic || '').trim() || null;
}

/** `null` is an intentional product clear, not an omitted field. */
export function hasExplicitInstrumentProductOverride(item: any) {
  return Object.prototype.hasOwnProperty.call(item || {}, 'product_master_id');
}

/** Required evidence may retain its historic logic, but it may not be blank. */
export function hasValidRetainedRequiredControlLogic(
  requirementRule: unknown,
  rows: Array<{ control_logic?: unknown }>,
  requestedLogic: { control_logic_supplied: boolean; control_logic: string | null } | undefined,
) {
  if (!['mandatory', 'pump_linked'].includes(String(requirementRule))) return true;
  return rows.every(row => Boolean(
    requestedLogic?.control_logic_supplied
      ? requestedLogic.control_logic
      : String(row.control_logic || '').trim(),
  ));
}

export class PumpLinkedInstrumentValidationError extends Error {
  code = 'INSTRUMENT_CONTROL_LOGIC_REQUIRED';
  constructor(public definition: any) {
    super(`${definition.name} has no governed default control logic. Set a default control logic before configuring pumps.`);
  }
}

/**
 * Makes pump-linked instrument evidence follow configured pumps without
 * rewriting designer-owned evidence.  The caller must already be in the
 * transaction that changes the pump selection so a validation failure rolls
 * that change back too.
 */
export async function reconcilePumpLinkedInstruments(
  runner: any,
  input: { projectId: string; systemId: string; systemCode: string; userId: string },
) {
  const definitions = (await runner(
    `SELECT * FROM field_instrument_definitions
     WHERE is_active=true AND requirement_rule='pump_linked'
     ORDER BY sort_order,tag_code`,
  )).rows;
  if (!definitions.length) return;

  const pumpCount = Number((await runner(
    `SELECT COALESCE(SUM(COALESCE(pump_quantity,1)),0)::int AS quantity
     FROM system_pump_selections
     WHERE system_id=$1 AND project_equipment_item_id IS NOT NULL`,
    [input.systemId],
  )).rows[0]?.quantity || 0);
  if (!pumpCount) return;

  // Only editable books have live evidence. Review and release snapshots are
  // immutable evidence and intentionally never appear in this query.
  const books = (await runner(
    `SELECT id FROM design_books
     WHERE project_id=$1 AND status IN ('Draft','In Progress') FOR UPDATE`,
    [input.projectId],
  )).rows;

  for (const book of books) {
    // Shared with the manual LSS Control save path.  This prevents a manual
    // quantity edit and automatic pump reconciliation from allocating the
    // same sequence in parallel.
    await runner('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`lss-instruments:${book.id}:${input.systemId}`]);
    for (const definition of definitions) {
      const rows = (await runner(
        `SELECT id,sequence_number FROM design_book_lss_instruments
         WHERE design_book_id=$1 AND system_id=$2 AND definition_id=$3
         ORDER BY sequence_number FOR UPDATE`,
        [book.id, input.systemId, definition.id],
      )).rows;
      const missing = pumpCount - rows.length;
      if (missing <= 0) continue;
      const controlLogic = String(definition.default_control_logic || '').trim();
      if (!controlLogic) throw new PumpLinkedInstrumentValidationError(definition);

      const used = new Set(rows.map((row: any) => Number(row.sequence_number)));
      const sequences: number[] = [];
      for (let sequence = 1; sequence <= 99 && sequences.length < missing; sequence++) {
        if (!used.has(sequence)) sequences.push(sequence);
      }
      if (sequences.length < missing) {
        throw new Error(`${definition.name} cannot allocate more than 99 instrument sequences for this LSS.`);
      }
      const product = definition.default_product_master_id
        ? (await runner(
          'SELECT id,product_code,product_name,status FROM product_masters WHERE id=$1',
          [definition.default_product_master_id],
        )).rows[0] || null
        : null;
      for (const sequence of sequences) {
        await runner(
          `INSERT INTO design_book_lss_instruments
            (design_book_id,system_id,definition_id,tag,sequence_number,control_logic,range_min,range_max,unit,
             calibration_required,calibration_interval_days,calibration_procedure,datasheet_reference,
             product_master_id,definition_snapshot,product_snapshot,created_by,updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$17)`,
          [book.id, input.systemId, definition.id,
            buildInstrumentTag(input.systemCode, definition.tag_code, sequence),
            sequence, controlLogic, definition.default_range_min, definition.default_range_max, definition.default_unit,
            definition.default_calibration_required, definition.default_calibration_interval_days,
            definition.default_calibration_procedure, definition.default_datasheet_reference,
            definition.default_product_master_id || null, JSON.stringify(definition), JSON.stringify(product), input.userId],
        );
      }
    }
  }
}