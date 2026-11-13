// PIM attribute library (redesign step 1 — docs/pim-redesign-proposal.md §4.2–4.4, §6).
// Run by db/migrate.ts after the core schema; every statement is idempotent.
//
//  pim_measures / pim_units     measures (flow, power…) and their units with conversion factors
//  pim_attribute_groups          Hydraulic, Electrical, Dimensions…
//  pim_attributes                the attribute library; storage 'typed' = an engineering fact kept in its
//                                typed column (read through ENGINEERING_ATTRIBUTES), 'value' = sparse value
//  pim_family_attributes         family templates: which attributes a family has, required, variant axis
//  pim_item_attribute_values     sparse values, stored in the measure's base unit
//
// Nothing existing is removed: family_classifiers stays until nothing reads it (§5).
import { ATTRIBUTE_GROUPS, ENGINEERING_ATTRIBUTES } from './engineeringAttributes';
import { MEASURES } from './units';

const lit = (v: string | number | null | undefined) =>
  v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;

const measureRows = MEASURES.map(m => `(${lit(m.code)}, ${lit(m.name)}, ${lit(m.base)})`).join(',\n  ');
const unitRows = MEASURES.flatMap(m => m.units.map((u, i) =>
  `(${lit(u.code)}, ${lit(m.code)}, ${lit(u.symbol)}, ${u.factor}, ${u.offset ?? 0}, ${i})`)).join(',\n  ');
const groupRows = ATTRIBUTE_GROUPS.map(([code, name], i) => `(${lit(code)}, ${lit(name)}, ${i})`).join(',\n  ');
const engineeringRows = ENGINEERING_ATTRIBUTES.map((a, i) =>
  `(${lit(a.code)}, ${lit(a.label)}, ${lit(a.dataType ?? 'number')}, ${lit(a.measure)}, ${lit(a.unit)}, ${lit(a.group)}, 'typed', ${lit(`${a.table}.${a.column}`)}, true, ${i})`).join(',\n  ');

export const PIM_SCHEMA = `
CREATE TABLE IF NOT EXISTS pim_measures (
  code VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  base_unit VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS pim_units (
  code VARCHAR(20) PRIMARY KEY,
  measure_code VARCHAR(30) NOT NULL REFERENCES pim_measures(code) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  factor NUMERIC NOT NULL CHECK (factor > 0),
  offset_value NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pim_attribute_groups (
  code VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pim_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(60) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label VARCHAR(150) NOT NULL,
  data_type VARCHAR(20) NOT NULL CHECK (data_type IN ('number', 'text', 'list', 'boolean')),
  measure_code VARCHAR(30) REFERENCES pim_measures(code),
  default_unit VARCHAR(20) REFERENCES pim_units(code),
  group_code VARCHAR(30) NOT NULL DEFAULT 'general' REFERENCES pim_attribute_groups(code),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_value NUMERIC,
  max_value NUMERIC,
  description TEXT,
  storage VARCHAR(10) NOT NULL DEFAULT 'value' CHECK (storage IN ('typed', 'value')),
  typed_source VARCHAR(100),
  is_system BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (measure_code IS NULL OR data_type = 'number'),
  CHECK ((measure_code IS NULL) = (default_unit IS NULL)),
  CHECK (storage = 'value' OR (is_system AND typed_source IS NOT NULL)),
  CHECK (min_value IS NULL OR max_value IS NULL OR max_value >= min_value)
);
CREATE INDEX IF NOT EXISTS idx_pim_attributes_group ON pim_attributes (group_code, sort_order);

CREATE TABLE IF NOT EXISTS pim_family_attributes (
  family_id UUID NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
  attribute_id UUID NOT NULL REFERENCES pim_attributes(id) ON DELETE CASCADE,
  required BOOLEAN NOT NULL DEFAULT false,
  variant_axis BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (family_id, attribute_id)
);
CREATE INDEX IF NOT EXISTS idx_pim_family_attributes_attribute ON pim_family_attributes (attribute_id);

-- Items are product_masters rows until the one-catalogue merge (decision 1).
CREATE TABLE IF NOT EXISTS pim_item_attribute_values (
  item_id UUID NOT NULL REFERENCES product_masters(id) ON DELETE CASCADE,
  attribute_id UUID NOT NULL REFERENCES pim_attributes(id) ON DELETE CASCADE,
  value_number NUMERIC,
  value_text TEXT,
  value_boolean BOOLEAN,
  entered_unit VARCHAR(20) REFERENCES pim_units(code),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, attribute_id),
  CHECK (num_nonnulls(value_number, value_text, value_boolean) = 1)
);
CREATE INDEX IF NOT EXISTS idx_pim_item_attribute_values_attribute ON pim_item_attribute_values (attribute_id);

-- Reference data, kept in sync with units.ts / engineeringAttributes.ts.
INSERT INTO pim_measures (code, name, base_unit) VALUES
  ${measureRows}
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, base_unit = EXCLUDED.base_unit;

INSERT INTO pim_units (code, measure_code, symbol, factor, offset_value, sort_order) VALUES
  ${unitRows}
ON CONFLICT (code) DO UPDATE SET measure_code = EXCLUDED.measure_code, symbol = EXCLUDED.symbol,
  factor = EXCLUDED.factor, offset_value = EXCLUDED.offset_value, sort_order = EXCLUDED.sort_order;

INSERT INTO pim_attribute_groups (code, name, sort_order) VALUES
  ${groupRows}
ON CONFLICT (code) DO NOTHING;

-- Engineering facts: storage and source are owned by the code; label and group can be edited in the app.
INSERT INTO pim_attributes (code, label, data_type, measure_code, default_unit, group_code, storage, typed_source, is_system, sort_order) VALUES
  ${engineeringRows}
ON CONFLICT (code) DO UPDATE SET data_type = EXCLUDED.data_type, measure_code = EXCLUDED.measure_code,
  default_unit = EXCLUDED.default_unit, storage = 'typed', typed_source = EXCLUDED.typed_source, is_system = true;

-- Carry the old family classifiers over to family templates where an attribute has the same label.
INSERT INTO pim_family_attributes (family_id, attribute_id, sort_order)
SELECT fc.family_id, a.id, fc.sort_order
FROM family_classifiers fc
JOIN pim_attributes a ON LOWER(a.label) = LOWER(TRIM(fc.label))
WHERE fc.family_id IS NOT NULL
ON CONFLICT DO NOTHING;
`;
