// Pure input validation for the PIM attribute library (no database access).
import { measureOf, toBase, convert } from './units';

export const DATA_TYPES = ['number', 'text', 'list', 'boolean'] as const;
export type DataType = typeof DATA_TYPES[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };
const has = (b: any, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export type AttributeInput = {
  code?: string;
  label?: string;
  data_type?: DataType;
  measure_code?: string | null;
  default_unit?: string | null;
  group_code?: string;
  options?: string[];
  min_value?: number | null;
  max_value?: number | null;
  description?: string | null;
  active?: boolean;
  sort_order?: number;
};

/** Fields an admin may change on a system (engineering) attribute; the rest belongs to the code. */
export const SYSTEM_EDITABLE = ['label', 'group_code', 'description', 'sort_order'] as const;

export function validateAttributeInput(body: any, opts: { creating: boolean }): Result<AttributeInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be an object.' };
  const out: AttributeInput = {};

  if (opts.creating) {
    if (typeof body.code !== 'string' || !/^[a-z][a-z0-9_]{1,59}$/.test(body.code.trim())) {
      return { error: 'code is required: lower-case letters, digits and _ (e.g. housing_material).' };
    }
    out.code = body.code.trim();
  } else if (has(body, 'code')) {
    return { error: 'code cannot be changed.' };
  }

  if (has(body, 'label') || opts.creating) {
    if (typeof body.label !== 'string' || !body.label.trim()) return { error: 'label is required.' };
    if (body.label.trim().length > 150) return { error: 'label must be at most 150 characters.' };
    out.label = body.label.trim();
  }

  if (has(body, 'data_type') || opts.creating) {
    if (!DATA_TYPES.includes(body.data_type)) return { error: `data_type must be one of ${DATA_TYPES.join(', ')}.` };
    out.data_type = body.data_type;
  }

  if (has(body, 'default_unit') || has(body, 'measure_code')) {
    const unit = body.default_unit || null;
    if (unit === null) { out.measure_code = null; out.default_unit = null; }
    else {
      const measure = measureOf(unit);
      if (!measure) return { error: `Unknown unit "${unit}".` };
      if (body.measure_code && body.measure_code !== measure) return { error: `Unit ${unit} does not belong to ${body.measure_code}.` };
      out.measure_code = measure; out.default_unit = unit;
    }
  }
  if (out.default_unit && out.data_type && out.data_type !== 'number') return { error: 'Only number attributes can have a unit.' };

  if (has(body, 'group_code')) {
    if (typeof body.group_code !== 'string' || !body.group_code) return { error: 'group_code is required.' };
    out.group_code = body.group_code;
  }

  if (has(body, 'options')) {
    if (!Array.isArray(body.options) || body.options.some((o: unknown) => typeof o !== 'string')) return { error: 'options must be a list of text values.' };
    const options = [...new Set<string>(body.options.map((o: string) => o.trim()).filter(Boolean))];
    if (options.length > 200) return { error: 'A list attribute can have at most 200 options.' };
    out.options = options;
  }
  if (out.data_type === 'list' && opts.creating && !out.options?.length) return { error: 'A list attribute needs at least one option.' };

  for (const key of ['min_value', 'max_value'] as const) {
    if (!has(body, key)) continue;
    const v = body[key];
    if (v === null || v === '') { out[key] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n)) return { error: `${key} must be a number.` };
    out[key] = n;
  }
  if (out.min_value != null && out.max_value != null && out.max_value < out.min_value) return { error: 'max_value cannot be below min_value.' };

  if (has(body, 'description')) {
    if (body.description !== null && typeof body.description !== 'string') return { error: 'description must be text.' };
    out.description = body.description?.trim() || null;
  }
  if (has(body, 'active')) {
    if (typeof body.active !== 'boolean') return { error: 'active must be true or false.' };
    out.active = body.active;
  }
  if (has(body, 'sort_order')) {
    if (!Number.isInteger(body.sort_order)) return { error: 'sort_order must be a whole number.' };
    out.sort_order = body.sort_order;
  }
  return { value: out };
}

export type TemplateEntry = { attribute_id: string; required: boolean; variant_axis: boolean };

export function validateTemplate(body: any): Result<TemplateEntry[]> {
  const list = body?.attributes;
  if (!Array.isArray(list)) return { error: 'attributes must be a list.' };
  const seen = new Set<string>();
  const out: TemplateEntry[] = [];
  for (const entry of list) {
    if (!isUuid(entry?.attribute_id)) return { error: 'Each entry needs a valid attribute_id.' };
    if (seen.has(entry.attribute_id)) return { error: 'An attribute can only appear once in a family.' };
    seen.add(entry.attribute_id);
    out.push({ attribute_id: entry.attribute_id, required: entry.required === true, variant_axis: entry.variant_axis === true });
  }
  return { value: out };
}

/** The attribute definition needed to check and store a value. */
export type ValueRule = {
  id: string; label: string; data_type: DataType; default_unit: string | null;
  options: string[]; min_value: number | null; max_value: number | null; storage: 'typed' | 'value';
};

export type StoredValue = { value_number: number | null; value_text: string | null; value_boolean: boolean | null; entered_unit: string | null };

/** Checks one value against its attribute and returns what to store (numbers in the base unit), or null to clear it. */
export function normaliseValue(rule: ValueRule, input: any): Result<StoredValue | null> {
  if (rule.storage === 'typed') return { error: `${rule.label} is an engineering value — edit it on the product's technical data.` };
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input.value : input;
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const empty = { value_number: null, value_text: null, value_boolean: null, entered_unit: null };

  switch (rule.data_type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n)) return { error: `${rule.label} must be a number.` };
      const unit: string | null = (input && typeof input === 'object' && input.unit) || rule.default_unit;
      if (rule.default_unit) {
        if (!unit || measureOf(unit) !== measureOf(rule.default_unit)) return { error: `${rule.label}: unit ${unit} is not a unit of this attribute.` };
        const inDefault = convert(n, unit, rule.default_unit);
        if (rule.min_value != null && inDefault < rule.min_value) return { error: `${rule.label} must be at least ${rule.min_value}.` };
        if (rule.max_value != null && inDefault > rule.max_value) return { error: `${rule.label} must be at most ${rule.max_value}.` };
        return { value: { ...empty, value_number: toBase(n, unit), entered_unit: unit } };
      }
      if (rule.min_value != null && n < rule.min_value) return { error: `${rule.label} must be at least ${rule.min_value}.` };
      if (rule.max_value != null && n > rule.max_value) return { error: `${rule.label} must be at most ${rule.max_value}.` };
      return { value: { ...empty, value_number: n } };
    }
    case 'boolean':
      if (typeof raw !== 'boolean') return { error: `${rule.label} must be yes or no.` };
      return { value: { ...empty, value_boolean: raw } };
    case 'list':
      if (typeof raw !== 'string' || !rule.options.includes(raw)) return { error: `${rule.label} must be one of: ${rule.options.join(', ')}.` };
      return { value: { ...empty, value_text: raw } };
    default: {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: `${rule.label} must be text.` };
      const text = String(raw).trim();
      if (text.length > 2000) return { error: `${rule.label} must be at most 2000 characters.` };
      return { value: text ? { ...empty, value_text: text } : null };
    }
  }
}
