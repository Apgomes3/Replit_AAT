// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ENGINEERING_ATTRIBUTES } from './engineeringAttributes';
import { convert, fromBase, MEASURES, measureOf, toBase } from './units';
import { normaliseValue, validateAttributeInput, validateTemplate, ValueRule } from './validation';

describe('units', () => {
  it('converts within a measure', () => {
    expect(convert(10, 'l_s', 'm3_h')).toBe(36);
    expect(convert(1, 'hp', 'kw')).toBe(0.745699872);
    expect(convert(10, 'mh2o', 'bar')).toBe(0.980665);
    expect(convert(212, 'f', 'c')).toBe(100);
    expect(convert(0, 'c', 'k')).toBe(273.15);
    expect(fromBase(toBase(2.5, 'm'), 'm')).toBe(2.5);
  });

  it('refuses conversions across measures and unknown units', () => {
    expect(() => convert(1, 'kw', 'bar')).toThrow();
    expect(() => toBase(1, 'furlong')).toThrow();
  });

  it('has unique unit codes and a base unit in every measure', () => {
    const codes = MEASURES.flatMap(m => m.units.map(u => u.code));
    expect(new Set(codes).size).toBe(codes.length);
    for (const m of MEASURES) expect(m.units.find(u => u.code === m.base)).toMatchObject({ factor: 1 });
  });

  it('registers every engineering fact with a matching unit', () => {
    const codes = ENGINEERING_ATTRIBUTES.map(a => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of ENGINEERING_ATTRIBUTES) {
      expect(a.code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(a.column).toMatch(/^[a-z0-9_]+$/);
      if (a.unit) expect(measureOf(a.unit)).toBe(a.measure);
    }
  });
});

describe('attribute input', () => {
  it('derives the measure from the unit and checks codes', () => {
    expect(validateAttributeInput({ code: 'pipe_size', label: 'Pipe size', data_type: 'number', default_unit: 'mm' }, { creating: true }).value)
      .toMatchObject({ measure_code: 'length', default_unit: 'mm' });
    expect(validateAttributeInput({ code: 'Pipe Size', label: 'x', data_type: 'text' }, { creating: true }).error).toMatch(/code/);
    expect(validateAttributeInput({ code: 'colour', label: 'Colour', data_type: 'text', default_unit: 'mm' }, { creating: true }).error).toMatch(/unit/);
    expect(validateAttributeInput({ code: 'housing', label: 'Housing', data_type: 'list' }, { creating: true }).error).toMatch(/option/);
    expect(validateAttributeInput({ code: 'x' }, { creating: false }).error).toMatch(/cannot be changed/);
  });

  it('rejects duplicate attributes in a family template', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(validateTemplate({ attributes: [{ attribute_id: id }, { attribute_id: id }] }).error).toMatch(/once/);
    expect(validateTemplate({ attributes: [{ attribute_id: id, required: true }] }).value).toEqual([{ attribute_id: id, required: true, variant_axis: false }]);
  });
});

describe('item values', () => {
  const rule = (o: Partial<ValueRule>): ValueRule => ({ id: 'a', label: 'Flow', data_type: 'number', default_unit: 'm3_h', options: [], min_value: null, max_value: null, storage: 'value', ...o });

  it('stores numbers in the base unit and checks limits in the default unit', () => {
    expect(normaliseValue(rule({}), { value: 10, unit: 'l_s' }).value).toMatchObject({ value_number: 36, entered_unit: 'l_s' });
    expect(normaliseValue(rule({}), '12,5').value).toMatchObject({ value_number: 12.5, entered_unit: 'm3_h' });
    expect(normaliseValue(rule({ max_value: 30 }), { value: 10, unit: 'l_s' }).error).toMatch(/at most 30/);
    expect(normaliseValue(rule({}), { value: 1, unit: 'kw' }).error).toMatch(/unit/);
  });

  it('checks lists, booleans, text and engineering values', () => {
    expect(normaliseValue(rule({ data_type: 'list', default_unit: null, options: ['PVC', 'GRP'] }), 'GRP').value).toMatchObject({ value_text: 'GRP' });
    expect(normaliseValue(rule({ data_type: 'list', default_unit: null, options: ['PVC'] }), 'Steel').error).toMatch(/one of/);
    expect(normaliseValue(rule({ data_type: 'boolean', default_unit: null }), true).value).toMatchObject({ value_boolean: true });
    expect(normaliseValue(rule({ data_type: 'text', default_unit: null }), '  ').value).toBeNull();
    expect(normaliseValue(rule({}), null).value).toBeNull();
    expect(normaliseValue(rule({ storage: 'typed' }), 5).error).toMatch(/engineering/);
  });
});
