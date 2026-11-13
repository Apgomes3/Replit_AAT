// Data access for the PIM attribute library.
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db';
import { ENGINEERING_BY_CODE } from './engineeringAttributes';
import { fromBase, unitSymbol } from './units';
import { AttributeInput, normaliseValue, StoredValue, SYSTEM_EDITABLE, TemplateEntry, ValueRule } from './validation';

type Db = Pick<PoolClient, 'query'>;

export class PimRuleError extends Error {}

const ATTRIBUTE_SELECT = `
  SELECT a.id, a.code, a.label, a.data_type, a.measure_code, a.default_unit, a.group_code, g.name AS group_name,
    a.options, a.min_value::float AS min_value, a.max_value::float AS max_value, a.description, a.storage, a.typed_source,
    a.is_system, a.active, a.sort_order, a.updated_at,
    (SELECT COUNT(*)::int FROM pim_family_attributes fa WHERE fa.attribute_id = a.id) AS family_count,
    (SELECT COUNT(*)::int FROM pim_item_attribute_values v WHERE v.attribute_id = a.id) AS value_count
  FROM pim_attributes a JOIN pim_attribute_groups g ON g.code = a.group_code`;

export async function listUnits() {
  const measures = (await query(`SELECT code, name, base_unit FROM pim_measures ORDER BY name`)).rows;
  const units = (await query(`SELECT code, measure_code, symbol, factor::float AS factor, offset_value::float AS offset_value FROM pim_units ORDER BY measure_code, sort_order`)).rows;
  return measures.map(m => ({ ...m, units: units.filter(u => u.measure_code === m.code) }));
}

export async function listGroups() {
  return (await query(`SELECT code, name, sort_order FROM pim_attribute_groups ORDER BY sort_order`)).rows;
}

export async function listAttributes() {
  return (await query(`${ATTRIBUTE_SELECT} ORDER BY g.sort_order, a.sort_order, a.label`)).rows;
}

export async function getAttribute(id: string, db: Db = { query } as Db) {
  return (await db.query(`${ATTRIBUTE_SELECT} WHERE a.id = $1`, [id])).rows[0] ?? null;
}

export async function createAttribute(input: AttributeInput, actorId: string) {
  const inserted = await query(
    `INSERT INTO pim_attributes (code, label, data_type, measure_code, default_unit, group_code, options, min_value, max_value,
       description, active, sort_order, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $13) RETURNING id`,
    [input.code, input.label, input.data_type, input.measure_code ?? null, input.default_unit ?? null, input.group_code ?? 'general',
      JSON.stringify(input.options ?? []), input.min_value ?? null, input.max_value ?? null, input.description ?? null,
      input.active ?? true, input.sort_order ?? 0, actorId],
  );
  return getAttribute(inserted.rows[0].id);
}

export async function updateAttribute(id: string, input: AttributeInput, actorId: string) {
  return withTransaction(async db => {
    const current = (await db.query(`SELECT is_system, data_type FROM pim_attributes WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!current) return null;
    const keys = Object.keys(input) as (keyof AttributeInput)[];
    if (current.is_system) {
      const locked = keys.filter(k => !(SYSTEM_EDITABLE as readonly string[]).includes(k));
      if (locked.length) throw new PimRuleError(`Engineering attributes only allow changing the label, group, description and order (not ${locked.join(', ')}).`);
    }
    if (input.data_type && input.data_type !== current.data_type) {
      const used = (await db.query(`SELECT 1 FROM pim_item_attribute_values WHERE attribute_id = $1 LIMIT 1`, [id])).rows.length;
      if (used) throw new PimRuleError('The type cannot change once products have values for this attribute.');
    }
    const set: string[] = [];
    const values: unknown[] = [id];
    for (const key of keys) {
      values.push(key === 'options' ? JSON.stringify(input.options) : input[key]);
      set.push(`${key} = $${values.length}${key === 'options' ? '::jsonb' : ''}`);
    }
    values.push(actorId);
    await db.query(`UPDATE pim_attributes SET ${[...set, `updated_by = $${values.length}`, 'updated_at = NOW()'].join(', ')} WHERE id = $1`, values);
    return getAttribute(id, db);
  });
}

/** Deletes an unused, non-system attribute. */
export async function deleteAttribute(id: string): Promise<'deleted' | 'not_found'> {
  const a = await getAttribute(id);
  if (!a) return 'not_found';
  if (a.is_system) throw new PimRuleError('Engineering attributes cannot be deleted.');
  if (a.value_count > 0) throw new PimRuleError(`${a.value_count} product(s) have a value for this attribute — deactivate it instead.`);
  await query(`DELETE FROM pim_attributes WHERE id = $1`, [id]);
  return 'deleted';
}

// ---------- family templates ----------

export async function listFamilies() {
  return (await query(`
    SELECT f.id, f.product_family_code AS code, f.product_family_name AS name, f.category_code,
      (SELECT COUNT(*)::int FROM pim_family_attributes fa WHERE fa.family_id = f.id) AS attribute_count,
      (SELECT COUNT(*)::int FROM pim_family_attributes fa WHERE fa.family_id = f.id AND fa.required) AS required_count,
      (SELECT COUNT(*)::int FROM product_masters p WHERE p.product_family_id = f.id) AS product_count
    FROM product_families f ORDER BY f.category_code NULLS LAST, f.product_family_name`)).rows;
}

const TEMPLATE_SELECT = `
  SELECT a.id, a.code, a.label, a.data_type, a.measure_code, a.default_unit, a.group_code, g.name AS group_name,
    a.options, a.min_value::float AS min_value, a.max_value::float AS max_value, a.storage, a.is_system,
    fa.required, fa.variant_axis, fa.sort_order
  FROM pim_family_attributes fa
  JOIN pim_attributes a ON a.id = fa.attribute_id
  JOIN pim_attribute_groups g ON g.code = a.group_code
  WHERE fa.family_id = $1
  ORDER BY fa.sort_order, g.sort_order, a.label`;

export async function familyExists(id: string) {
  return (await query(`SELECT 1 FROM product_families WHERE id = $1`, [id])).rows.length > 0;
}

export async function getTemplate(familyId: string, db: Db = { query } as Db) {
  return (await db.query(TEMPLATE_SELECT, [familyId])).rows;
}

export async function replaceTemplate(familyId: string, entries: TemplateEntry[]) {
  return withTransaction(async db => {
    const ids = entries.map(e => e.attribute_id);
    const known = (await db.query(`SELECT id FROM pim_attributes WHERE id = ANY($1::uuid[])`, [ids])).rows.length;
    if (known !== ids.length) throw new PimRuleError('One or more attributes no longer exist.');
    await db.query(`DELETE FROM pim_family_attributes WHERE family_id = $1`, [familyId]);
    for (const [i, e] of entries.entries()) {
      await db.query(`INSERT INTO pim_family_attributes (family_id, attribute_id, required, variant_axis, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [familyId, e.attribute_id, e.required, e.variant_axis, i]);
    }
    return getTemplate(familyId, db);
  });
}

// ---------- item values ----------

type TemplateRow = Awaited<ReturnType<typeof getTemplate>>[number];

/** Reads engineering facts from their typed columns (allow-listed in ENGINEERING_ATTRIBUTES). */
async function readTypedValues(db: Db, itemId: string, attrs: TemplateRow[]) {
  const out = new Map<string, number | string | null>();
  const byTable = new Map<string, { code: string; column: string }[]>();
  for (const a of attrs) {
    const eng = ENGINEERING_BY_CODE.get(a.code);
    if (!eng) continue;
    byTable.set(eng.table, [...(byTable.get(eng.table) ?? []), { code: a.code, column: eng.column }]);
  }
  for (const [table, cols] of byTable) {
    const key = table === 'product_masters' ? 'id' : 'product_master_id';
    const row = (await db.query(`SELECT ${cols.map(c => `"${c.column}"`).join(', ')} FROM ${table} WHERE ${key} = $1`, [itemId])).rows[0];
    for (const c of cols) {
      const v = row?.[c.column];
      out.set(c.code, v == null ? null : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
    }
  }
  return out;
}

export async function getItemAttributes(itemId: string, db: Db = { query } as Db) {
  const item = (await db.query(
    `SELECT p.id, p.product_code, p.product_name, p.product_family_id, f.product_family_name
     FROM product_masters p LEFT JOIN product_families f ON f.id = p.product_family_id WHERE p.id = $1`, [itemId])).rows[0];
  if (!item) return null;
  const attrs = item.product_family_id ? await getTemplate(item.product_family_id, db) : [];
  const typed = await readTypedValues(db, itemId, attrs.filter(a => a.storage === 'typed'));
  const stored = new Map((await db.query(
    `SELECT attribute_id, value_number::float AS value_number, value_text, value_boolean, entered_unit, updated_at
     FROM pim_item_attribute_values WHERE item_id = $1`, [itemId])).rows.map(r => [r.attribute_id, r]));

  const attributes = attrs.map(a => {
    let value: number | string | boolean | null = null;
    let unit: string | null = a.default_unit;
    if (a.storage === 'typed') value = typed.get(a.code) ?? null;
    else {
      const s = stored.get(a.id);
      if (s) {
        if (s.value_number != null) {
          unit = s.entered_unit ?? a.default_unit;
          value = unit ? fromBase(s.value_number, unit) : s.value_number;
        } else value = s.value_boolean ?? s.value_text;
      }
    }
    return { ...a, value, unit, unit_symbol: unit ? unitSymbol(unit) : null };
  });
  const required = attributes.filter(a => a.required);
  const missing = required.filter(a => a.value === null || a.value === '').map(a => a.label);
  return {
    item,
    attributes,
    completeness: {
      required: required.length,
      filled: required.length - missing.length,
      percent: required.length ? Math.round(((required.length - missing.length) / required.length) * 100) : 100,
      missing,
    },
  };
}

/** Saves sparse values ({ attribute_id: value | {value, unit} | null }). Attributes must be in the item's family template. */
export async function saveItemValues(itemId: string, values: Record<string, unknown>, actorId: string) {
  return withTransaction(async db => {
    const current = await getItemAttributes(itemId, db);
    if (!current) return null;
    const rules = new Map(current.attributes.map(a => [a.id, a as unknown as ValueRule]));
    const problems: string[] = [];
    const writes: Array<[string, StoredValue | null]> = [];
    for (const [attributeId, input] of Object.entries(values)) {
      const rule = rules.get(attributeId);
      if (!rule) { problems.push(`Attribute ${attributeId} is not part of this product's family.`); continue; }
      const r = normaliseValue(rule, input);
      if (r.error) problems.push(r.error); else writes.push([attributeId, r.value!]);
    }
    if (problems.length) throw new PimRuleError(problems.join(' '));
    for (const [attributeId, v] of writes) {
      if (v === null) { await db.query(`DELETE FROM pim_item_attribute_values WHERE item_id = $1 AND attribute_id = $2`, [itemId, attributeId]); continue; }
      await db.query(
        `INSERT INTO pim_item_attribute_values (item_id, attribute_id, value_number, value_text, value_boolean, entered_unit, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (item_id, attribute_id) DO UPDATE SET value_number = $3, value_text = $4, value_boolean = $5,
           entered_unit = $6, updated_by = $7, updated_at = NOW()`,
        [itemId, attributeId, v.value_number, v.value_text, v.value_boolean, v.entered_unit, actorId]);
    }
    return { result: await getItemAttributes(itemId, db), changed: writes.map(([id]) => rules.get(id)!.label) };
  });
}
