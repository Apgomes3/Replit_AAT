// @vitest-environment node
// Runs the PIM attribute library against the PostgreSQL test database (TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import * as repo from './repository';

const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const ids: Record<string, string> = {};

describe.skipIf(!process.env.DATABASE_URL)('PIM attribute library (PostgreSQL)', () => {
  beforeAll(async () => {
    ids.user = (await query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Pim', 'Tester', 'engineer') RETURNING id`,
      [`pim-${suffix}@example.test`])).rows[0].id;
    ids.family = (await query(`INSERT INTO product_families (product_family_code, product_family_name) VALUES ($1, 'Test filters') RETURNING id`,
      [`TST-${suffix}`])).rows[0].id;
    ids.item = (await query(`INSERT INTO product_masters (product_code, product_name, product_family_id) VALUES ($1, 'Test filter', $2) RETURNING id`,
      [`TST-${suffix}`, ids.family])).rows[0].id;
    await query(`INSERT INTO product_hydraulic (product_master_id, design_flow_m3h) VALUES ($1, 42)`, [ids.item]);
  });

  afterAll(async () => {
    if (ids.item) await query('DELETE FROM product_masters WHERE id = $1', [ids.item]);
    if (ids.family) await query('DELETE FROM product_families WHERE id = $1', [ids.family]);
    await query(`DELETE FROM pim_attributes WHERE code LIKE $1`, [`%_${suffix}`]);
    if (ids.user) await query('DELETE FROM users WHERE id = $1', [ids.user]);
  });

  it('builds a family template, stores values in base units and reports completeness', async () => {
    const all = await repo.listAttributes();
    const designFlow = all.find(a => a.code === 'design_flow')!;
    expect(designFlow).toMatchObject({ storage: 'typed', is_system: true, default_unit: 'm3_h' });

    const housing = await repo.createAttribute({ code: `housing_${suffix}`, label: 'Housing', data_type: 'list', options: ['PVC', 'GRP'], group_code: 'materials' }, ids.user);
    const backwash = await repo.createAttribute({ code: `backwash_${suffix}`, label: 'Backwash flow', data_type: 'number', measure_code: 'flow', default_unit: 'm3_h', group_code: 'hydraulic' }, ids.user);

    await repo.replaceTemplate(ids.family, [
      { attribute_id: designFlow.id, required: true, variant_axis: false },
      { attribute_id: housing.id, required: true, variant_axis: true },
      { attribute_id: backwash.id, required: false, variant_axis: false },
    ]);

    let item = await repo.getItemAttributes(ids.item);
    expect(item!.attributes.find(a => a.code === 'design_flow')!.value).toBe(42); // read from product_hydraulic
    expect(item!.completeness).toMatchObject({ required: 2, filled: 1, percent: 50, missing: ['Housing'] });

    const saved = await repo.saveItemValues(ids.item, { [housing.id]: 'GRP', [backwash.id]: { value: 10, unit: 'l_s' } }, ids.user);
    item = saved!.result;
    expect(item!.completeness.percent).toBe(100);
    expect(item!.attributes.find(a => a.id === backwash.id)).toMatchObject({ value: 10, unit: 'l_s' });
    const stored = (await query(`SELECT value_number::float AS n FROM pim_item_attribute_values WHERE item_id = $1 AND attribute_id = $2`, [ids.item, backwash.id])).rows[0];
    expect(stored.n).toBe(36); // base unit m³/h

    await expect(repo.saveItemValues(ids.item, { [designFlow.id]: 50 }, ids.user)).rejects.toThrow(/engineering/);
    await expect(repo.updateAttribute(designFlow.id, { default_unit: 'l_s', measure_code: 'flow' }, ids.user)).rejects.toThrow(/Engineering attributes/);
    await expect(repo.deleteAttribute(housing.id)).rejects.toThrow(/deactivate/);

    await repo.saveItemValues(ids.item, { [housing.id]: null }, ids.user);
    expect((await repo.getItemAttributes(ids.item))!.completeness.missing).toEqual(['Housing']);
  });
});
