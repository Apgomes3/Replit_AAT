// Helpers shared by the PIM product routes (moved from routes/products.ts).
import pool, { query } from '../../../db';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export const uploadsDir = path.join(__dirname, '../../../../uploads');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

export async function refreshDefaultBomCost(db: { query: typeof query }, productId: string) {
  await db.query(
    `WITH latest_bom AS (
       SELECT id FROM standard_boms WHERE product_master_id=$1
       ORDER BY effective_from DESC NULLS LAST, created_at DESC LIMIT 1
     ), priced AS (
       SELECT COALESCE(bl.quantity,1) AS quantity,
              COALESCE(c.cost,sp.cost) AS line_cost,
              COALESCE(c.currency,sp.currency,'USD') AS line_currency,
              pm.currency AS product_currency,
              line_rate.rate_per_usd AS line_rate,
              product_rate.rate_per_usd AS product_rate
       FROM latest_bom lb
       LEFT JOIN bom_lines bl ON bl.standard_bom_id=lb.id
       LEFT JOIN components c ON c.id=bl.component_id
       LEFT JOIN product_masters sp ON sp.id=bl.sub_product_id
       JOIN product_masters pm ON pm.id=$1
       LEFT JOIN platform_exchange_rates line_rate ON line_rate.currency_code=COALESCE(c.currency,sp.currency,'USD')
       LEFT JOIN platform_exchange_rates product_rate ON product_rate.currency_code=pm.currency
     ), total AS (
       SELECT CASE WHEN COUNT(*) FILTER (
          WHERE line_cost IS NOT NULL AND line_currency<>product_currency
            AND (line_rate IS NULL OR product_rate IS NULL)
        ) > 0 THEN NULL
        ELSE COALESCE(SUM(quantity * CASE
          WHEN line_cost IS NULL THEN 0
          WHEN line_currency=product_currency THEN line_cost
          ELSE line_cost / line_rate * product_rate
        END),0) END AS value
       FROM priced
     )
     UPDATE product_masters SET cost=(SELECT value FROM total),updated_at=NOW()
     WHERE id=$1 AND cost_is_override=false`,
    [productId],
  );
}

export const imageStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

export const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_, file, cb) => {
  cb(null, file.mimetype.startsWith('image/'));
} });

export type DbClient = { query: typeof query; release?: () => void };

export const AAT_SAND_FILTER_FRICTION_DEFAULT_KEY = 'aat_sand_filter_friction_loss_v1';

export const withProductTransaction = async <T>(work: (client: DbClient) => Promise<T>): Promise<T> => {
  const connect = (pool as any).connect;
  const client: DbClient = typeof connect === 'function'
    ? await connect.call(pool)
    : { query };
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
};

export const normalizeDesignFlow = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    const error: any = new Error('Design flow must be a finite, non-negative value in m³/h');
    error.status = 400;
    error.code = 'INVALID_DESIGN_FLOW';
    throw error;
  }
  return normalized;
};

export const isAatSandFilter = (product: {
  manufacturer?: unknown;
  product_name?: unknown;
  model?: unknown;
}) => {
  const manufacturer = String(product.manufacturer ?? '').trim().toLowerCase();
  const identity = `${String(product.product_name ?? '')} ${String(product.model ?? '')}`.toLowerCase();
  return manufacturer === 'aat' && /(^|\W)sand[\s-]*filter(\W|$)/.test(identity);
};

export const flowsConflict = (productFlow: unknown, hydraulicFlow: unknown) =>
  productFlow != null && hydraulicFlow != null && Number(productFlow) !== Number(hydraulicFlow);

export const insertAuditTx = (
  client: DbClient,
  actorId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  details: Record<string, any>,
) => client.query(
  `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details)
   VALUES ($1,$2,$3,$4,$5)`,
  [entityType, entityId, action, actorId, details],
);

export const designFlowAuditDetails = (
  source: 'product_master' | 'hydraulic_card' | 'reconciliation' | 'product_create' | 'product_duplicate',
  designFlow: number | null,
  previousProductFlow: unknown,
  previousHydraulicFlow: unknown,
) => ({
  summary: 'Linked Product Master and Hydraulic design flow updated',
  source,
  design_flow_m3h: designFlow,
  previous_product_design_flow_m3h: previousProductFlow ?? null,
  previous_hydraulic_design_flow_m3h: previousHydraulicFlow ?? null,
  resolved_conflict: flowsConflict(previousProductFlow, previousHydraulicFlow),
});

export const revisionOrdinal = (code: string) => {
  if (!/^[A-Z]+$/.test(code)) return 0;
  return [...code].reduce(
    (total, character) => (total * 26) + character.charCodeAt(0) - 64,
    0,
  );
};

export const revisionCodeFromOrdinal = (ordinal: number) => {
  let remaining = ordinal;
  let code = '';
  while (remaining > 0) {
    remaining -= 1;
    code = String.fromCharCode(65 + (remaining % 26)) + code;
    remaining = Math.floor(remaining / 26);
  }
  return code || 'A';
};

export const nextRevisionCode = (existing: string[]) => {
  const maximum = existing.reduce(
    (highest, code) => Math.max(highest, revisionOrdinal(code.trim().toUpperCase())),
    0,
  );
  return revisionCodeFromOrdinal(maximum + 1);
};

export const isEditableDocumentRevision = (status: unknown) =>
  ['Draft', 'Internal Review', 'Review Commented', 'Resubmitted', 'Rejected'].includes(String(status));

export const readPimTdsSource = async (client: DbClient, productId: string) => {
  const productResult = await client.query(
    `SELECT pm.*, pf.product_family_code, pf.product_family_name,
            m.material_name, m.material_category, m.density, m.chemical_resistance, m.temperature_limit
     FROM product_masters pm
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN materials m ON m.material_code=pm.primary_material_code
     WHERE pm.id::text=$1 OR pm.product_code=$1
     FOR UPDATE OF pm`,
    [productId],
  );
  const product = productResult.rows[0];
  if (!product) {
    const error: any = new Error('Product not found');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  const canonicalId = product.id;

  const [variants, boms, vendors, dimensions, electrical, hydraulic, pneumatic, classifiers, projects, relationships, linkedDocuments] =
    await Promise.all([
      client.query('SELECT * FROM product_variants WHERE product_master_id=$1 ORDER BY variant_code', [canonicalId]),
      client.query(
        `SELECT sb.*,
                COALESCE(json_agg(json_build_object(
                  'id', bl.id, 'line_number', bl.line_number, 'component_type', bl.component_type,
                  'component_reference_code', bl.component_reference_code, 'component_name', bl.component_name,
                  'quantity', bl.quantity, 'unit', bl.unit, 'is_optional', bl.is_optional, 'remarks', bl.remarks,
                  'sub_product_id', bl.sub_product_id, 'sub_product_code', sub_pm.product_code,
                  'sub_product_name', sub_pm.product_name, 'component_code', c.component_code
                ) ORDER BY bl.line_number) FILTER (WHERE bl.id IS NOT NULL), '[]'::json) AS lines
         FROM standard_boms sb
         LEFT JOIN bom_lines bl ON bl.standard_bom_id=sb.id
         LEFT JOIN components c ON c.id=bl.component_id
         LEFT JOIN product_masters sub_pm ON sub_pm.id=bl.sub_product_id
         WHERE sb.product_master_id=$1
         GROUP BY sb.id
         ORDER BY sb.effective_from DESC`,
        [canonicalId],
      ),
      client.query('SELECT * FROM vendor_options WHERE product_master_id=$1 ORDER BY vendor_option_code', [canonicalId]),
      client.query('SELECT * FROM product_dimensions WHERE product_master_id=$1', [canonicalId]),
      client.query('SELECT * FROM product_electrical WHERE product_master_id=$1', [canonicalId]),
      client.query('SELECT * FROM product_hydraulic WHERE product_master_id=$1', [canonicalId]),
      client.query('SELECT * FROM product_pneumatic WHERE product_master_id=$1', [canonicalId]),
      client.query(
        `SELECT fc.id, fc.label, fc.unit, fc.field_type, fc.sort_order, pcv.value_text
         FROM family_classifiers fc
         LEFT JOIN product_classifier_values pcv
           ON pcv.classifier_id=fc.id AND pcv.product_id=$1
         WHERE fc.family_id=$2
         ORDER BY fc.sort_order, fc.created_at`,
        [canonicalId, product.product_family_id],
      ),
      client.query(
        `SELECT DISTINCT p.id, p.project_code, p.project_name, p.project_status
         FROM product_usages pu JOIN projects p ON p.id=pu.project_id
         WHERE pu.product_master_id=$1 ORDER BY p.project_code`,
        [canonicalId],
      ),
      client.query(
        `SELECT er.* FROM entity_relationships er
         WHERE (er.source_id=$1 AND er.source_type IN ('product', 'product_master'))
            OR (er.target_id=$1 AND er.target_type IN ('product', 'product_master'))
         ORDER BY er.created_at`,
        [canonicalId],
      ),
      client.query(
        `SELECT id, document_code, document_title, document_type, current_revision, status
         FROM documents WHERE product_id=$1 ORDER BY document_type, document_code`,
        [canonicalId],
      ),
    ]);

  const capturedAt = new Date().toISOString();
  const isPneumaticProduct = String(product.product_category || '').toLowerCase() === 'pneumatic';
  const specificationRows = {
    dimensions: dimensions.rows[0] ?? null,
    electrical: electrical.rows[0] ?? null,
    hydraulic: hydraulic.rows[0] ?? null,
    pneumatic: isPneumaticProduct ? pneumatic.rows[0] ?? null : null,
  };
  const sourceSnapshot = {
    schema_version: 1,
    source: 'PIM Product Master',
    source_product_id: canonicalId,
    source_product_code: product.product_code,
    generated_at: capturedAt,
    product,
    specifications: specificationRows,
    classifier_values: classifiers.rows,
    variants: variants.rows,
    boms: boms.rows,
    vendors: vendors.rows,
    linked_context: {
      projects: projects.rows,
      relationships: relationships.rows,
      documents: linkedDocuments.rows,
    },
  };

  const knownValues: Record<string, unknown> = {
    product_code: product.product_code,
    product_name: product.product_name,
    product_category: product.product_category,
    application_type: product.application_type,
    manufacturer: product.manufacturer,
    model: product.model,
    design_flow_m3h: product.design_flow_m3h,
    design_pressure_bar: product.design_pressure_bar,
    design_head_m: product.design_head_m,
    power_kw: product.power_kw,
    primary_material_code: product.primary_material_code,
    image_url: product.image_url,
    product_description: product.product_description,
    tank_classification: product.tank_classification,
    tank_engineering_details: product.tank_engineering_details,
    notes: product.notes,
    dimensions: specificationRows.dimensions,
    electrical: specificationRows.electrical,
    hydraulic: specificationRows.hydraulic,
    pneumatic: specificationRows.pneumatic,
    bill_of_materials: boms.rows,
    vendors: vendors.rows,
    linked_projects: projects.rows,
  };
  const unavailableFields = Object.entries(knownValues)
    .filter(([, value]) => value == null || (Array.isArray(value) && value.length === 0))
    .map(([field]) => field);

  const content = {
    template: 'PIM Technical Data Sheet',
    title: `${product.product_code} — ${product.product_name}`,
    source_product_id: canonicalId,
    generated_at: capturedAt,
    sections: {
      identity: {
        product_code: product.product_code,
        product_name: product.product_name,
        manufacturer: product.manufacturer ?? null,
        model: product.model ?? null,
        image_url: product.image_url ?? null,
        product_description: product.product_description ?? null,
      },
      classification: {
        product_category: product.product_category ?? null,
        application_type: product.application_type ?? null,
        product_family: product.product_family_name ?? null,
        standard_status: product.standard_status ?? null,
        tank_classification: product.tank_classification ?? null,
        classifier_values: classifiers.rows,
      },
      engineering_values: {
        design_flow_m3h: product.design_flow_m3h ?? null,
        design_pressure_bar: product.design_pressure_bar ?? null,
        design_head_m: product.design_head_m ?? null,
        power_kw: product.power_kw ?? null,
      },
      materials: {
        primary_material_code: product.primary_material_code ?? null,
        material_name: product.material_name ?? null,
        material_category: product.material_category ?? null,
        density: product.density ?? null,
        chemical_resistance: product.chemical_resistance ?? null,
        temperature_limit: product.temperature_limit ?? null,
      },
      dimensions: specificationRows.dimensions,
      electrical: specificationRows.electrical,
      hydraulic: specificationRows.hydraulic,
      pneumatic: specificationRows.pneumatic,
      tank_engineering: product.product_category === 'Tank' ? (product.tank_engineering_details || {}) : null,
      bill_of_materials: boms.rows,
      vendors: vendors.rows,
      linked_context: sourceSnapshot.linked_context,
      notes: product.notes ?? null,
    },
    unavailable_fields: unavailableFields,
  };

  return { canonicalId, product, capturedAt, sourceSnapshot, content };
};

// PRODUCT MASTERS
// Catalogue screens load the whole list at once (client-side family filter and counts), so the cap must
// stay above the catalogue size; 200 silently hid products once the ASW import took it to 300.
export const PRODUCT_LIST_MAX_PAGE_SIZE = 1000;

export const TANK_CLASSIFICATIONS = [
  'Cylindrical atmospheric FRP tank',
  'Rectangular atmospheric FRP tank',
  'Atmospheric FRP steel tank',
] as const;

export function validateTankEngineeringPayload(category: unknown, classification: unknown, input: unknown) {
  const hasTankPayload = Boolean(classification) ||
    (input != null && typeof input === 'object' && !Array.isArray(input) && Object.keys(input as object).length > 0);
  if (String(category || '').toLowerCase() !== 'tank' && hasTankPayload) {
    return { error: 'Tank classification and engineering details can only be saved on Tank products.', details: {} };
  }
  if (classification && !TANK_CLASSIFICATIONS.includes(classification as any)) {
    return { error: 'Unsupported tank classification.', details: {} };
  }
  if (input != null && (typeof input !== 'object' || Array.isArray(input))) {
    return { error: 'tank_engineering_details must be an object.', details: {} };
  }
  const details: Record<string, any> = input ? { ...(input as Record<string, any>) } : {};
  for (const key of ['operating_temperature_min_c', 'operating_temperature_max_c', 'max_operating_pressure_bar', 'max_possible_pressure_bar']) {
    if (details[key] != null && details[key] !== '' && !Number.isFinite(Number(details[key]))) {
      return { error: `${key} must be a finite number or blank.`, details };
    }
  }
  if (details.operating_temperature_min_c != null && details.operating_temperature_max_c != null &&
      Number(details.operating_temperature_min_c) > Number(details.operating_temperature_max_c)) {
    return { error: 'Minimum operating temperature cannot exceed maximum operating temperature.', details };
  }
  if ((details.max_operating_pressure_bar != null && Number(details.max_operating_pressure_bar) < 0) ||
      (details.max_possible_pressure_bar != null && Number(details.max_possible_pressure_bar) < 0)) {
    return { error: 'Tank pressures must be non-negative.', details };
  }
  if (details.max_operating_pressure_bar != null && details.max_possible_pressure_bar != null &&
      Number(details.max_operating_pressure_bar) > Number(details.max_possible_pressure_bar)) {
    return { error: 'Maximum operating pressure cannot exceed maximum possible pressure.', details };
  }
  return { error: null, details };
}

// PRODUCT SPEC TABLES (dimensions, electrical, hydraulic, pneumatic, thermal)
export const resolveProductId = async (param: string): Promise<string | null> => {
  const r = await query('SELECT id FROM product_masters WHERE id::text=$1 OR product_code=$1', [param]);
  return r.rows[0]?.id ?? null;
};

export const nullableHydraulicValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;

export const nullableDimensionValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;

export const PNEUMATIC_UNIT_ALIASES: Record<string, Record<string, string>> = {
  gas_flow: { 'm3/h': 'm3/h', 'm³/h': 'm3/h', scfm: 'SCFM' },
  temperature: { c: '°C', '°c': '°C', f: '°F', '°f': '°F' },
  port: { dn: 'DN', mm: 'mm', in: 'in', inch: 'in' },
};

export const isBlankPneumaticValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

export const readPneumaticPair = (
  body: Record<string, any>,
  current: Record<string, any>,
  valueKey: string,
  unitKey: string,
  unitKind: keyof typeof PNEUMATIC_UNIT_ALIASES,
  label: string,
  allowNegative: boolean,
) => {
  const hasValue = Object.prototype.hasOwnProperty.call(body, valueKey);
  const hasUnit = Object.prototype.hasOwnProperty.call(body, unitKey);
  const rawValue = hasValue ? body[valueKey] : current[valueKey];
  const rawUnit = hasUnit ? body[unitKey] : current[unitKey];

  if (isBlankPneumaticValue(rawValue)) {
    if (hasUnit && !isBlankPneumaticValue(rawUnit)) {
      const error: any = new Error(`${label} unit cannot be set without a value`);
      error.status = 400;
      error.code = 'INVALID_PNEUMATIC_SPEC';
      throw error;
    }
    return { value: null, unit: null };
  }

  const numericValue = typeof rawValue === 'number' || typeof rawValue === 'string'
    ? Number(rawValue)
    : Number.NaN;
  if (!Number.isFinite(numericValue) || (!allowNegative && numericValue < 0)) {
    const error: any = new Error(`${label} must be a finite, ${allowNegative ? '' : 'non-negative '}number`);
    error.status = 400;
    error.code = 'INVALID_PNEUMATIC_SPEC';
    throw error;
  }

  const normalizedUnit = PNEUMATIC_UNIT_ALIASES[unitKind][String(rawUnit ?? '').trim().toLowerCase()];
  if (!normalizedUnit) {
    const error: any = new Error(`${label} must use a supported unit`);
    error.status = 400;
    error.code = 'INVALID_PNEUMATIC_SPEC';
    throw error;
  }
  return { value: numericValue, unit: normalizedUnit };
};

export const THERMAL_FLOW_SWITCH_STATUSES = new Set(['included', 'optional', 'not_included']);

export const THERMAL_CAPACITY_UNITS = new Set(['kW', 'BTU/h', 'TON']);

export const thermalNumericFields = [
  'thermal_capacity_kw',
  'operating_temperature_min_c',
  'operating_temperature_max_c',
  'design_temperature_c',
  'flow_rate_m3h',
  'pressure_rating_bar',
  'efficiency_pct',
  'primary_inlet_dn_mm',
  'primary_outlet_dn_mm',
  'secondary_inlet_dn_mm',
  'secondary_outlet_dn_mm',
] as const;

export const nullableThermalValue = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value;
