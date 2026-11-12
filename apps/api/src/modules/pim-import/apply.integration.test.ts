// @vitest-environment node
// Applies an import plan to the PostgreSQL test database (TEST_DATABASE_URL).
import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import { applyPlan, loadExisting, validatePlan } from './apply';
import type { PlanRow } from './workbook';

const sfx = Date.now().toString(36).toUpperCase();
const created = { products: [] as string[], components: [] as string[], families: [] as string[] };

const row = (over: Partial<PlanRow>): PlanRow => ({
  sheetRow: 2, decision: 'CREATE_PRODUCT', code: null, familyCode: null, componentType: null, componentCategory: null,
  name: 'Item', description: null, model: 'M', size: null, supplier: 'AAT', brand: null, supplierCurrency: 'CNY',
  supplierCost: 671, costUsd: 100, sellPriceUsd: 250, powerKw: null, ozoneGh: null, lengthMm: null, widthMm: null,
  heightMm: null, sandKg: null, notes: 'ASW price list test', sourceCategory: 'Test', matchInfo: null, warnings: null, ...over,
});

describe.skipIf(!process.env.DATABASE_URL)('price list import apply (PostgreSQL)', () => {
  afterAll(async () => {
    const ids = `SELECT id FROM product_masters WHERE product_code = ANY($1::text[])`;
    for (const table of ['vendor_options', 'product_electrical', 'product_dimensions']) {
      await query(`DELETE FROM ${table} WHERE product_master_id IN (${ids})`, [created.products]);
    }
    await query(`DELETE FROM product_masters WHERE product_code = ANY($1::text[])`, [created.products]);
    await query(`DELETE FROM components WHERE component_code = ANY($1::text[])`, [created.components]);
    if (created.families.length) await query(`DELETE FROM product_families WHERE product_family_code = ANY($1::text[])`, [created.families]);
  });

  it('creates and updates products and components, without duplicating on re-run', async () => {
    // An existing product the import should update (price only; name kept).
    const familyId = (await query(`SELECT id FROM product_families ORDER BY product_family_code LIMIT 1`)).rows[0].id;
    const existingCode = `T-EXIST-${sfx}`;
    await query(`INSERT INTO product_masters (product_code, product_name, product_family_id, cost, cost_is_override)
                 VALUES ($1, 'Kept name', $2, 0, false)`, [existingCode, familyId]);
    created.products.push(existingCode);

    const newProduct = `T-NEW-${sfx}`;
    const newComponent = `COMP-T-${sfx}`;
    const plan: PlanRow[] = [
      row({ sheetRow: 2, code: newProduct, familyCode: 'PFM-BAG', name: 'Bag filter housing', model: `BF-${sfx}`, powerKw: 0.5, lengthMm: 1200, sandKg: 40 }),
      row({ sheetRow: 3, decision: 'UPDATE_PRODUCT', code: existingCode, name: 'Price list name', model: `EX-${sfx}`, costUsd: 321.5, sellPriceUsd: 600 }),
      row({ sheetRow: 4, decision: 'CREATE_COMPONENT', code: newComponent, componentType: 'Filter Sock', componentCategory: 'Filtration', name: 'Filter Sock T2', size: '5' }),
      row({ sheetRow: 5, decision: 'SKIP' }),
    ];
    const { familyCodes } = await loadExisting({ query } as any);
    expect(validatePlan(plan, familyCodes)).toEqual([]);

    const familyExisted = familyCodes.has('PFM-BAG');
    const result = await applyPlan(plan, null);
    if (!familyExisted) created.families.push('PFM-BAG');
    created.products.push(newProduct);
    created.components.push(newComponent);
    expect(result).toMatchObject({ createdProducts: [newProduct], updatedProducts: [existingCode], createdComponents: [newComponent], skipped: 1 });

    const p = (await query(
      `SELECT pm.cost::float, pm.sell_price::float, pm.cost_is_override, pm.currency, pf.product_family_code AS fam,
              pe.rated_power_kw::float AS kw, pd.length_mm::float AS len, pd.sand_media_per_filter_kg::float AS sand
       FROM product_masters pm JOIN product_families pf ON pf.id = pm.product_family_id
       LEFT JOIN product_electrical pe ON pe.product_master_id = pm.id LEFT JOIN product_dimensions pd ON pd.product_master_id = pm.id
       WHERE pm.product_code = $1`, [newProduct])).rows[0];
    expect(p).toEqual({ cost: 100, sell_price: 250, cost_is_override: true, currency: 'USD', fam: 'PFM-BAG', kw: 0.5, len: 1200, sand: 40 });

    const u = (await query(`SELECT product_name, cost::float, sell_price::float, cost_is_override, model FROM product_masters WHERE product_code = $1`, [existingCode])).rows[0];
    expect(u).toEqual({ product_name: 'Kept name', cost: 321.5, sell_price: 600, cost_is_override: true, model: `EX-${sfx}` });

    const c = (await query(`SELECT component_type, component_category, standard_size, cost::float, currency FROM components WHERE component_code = $1`, [newComponent])).rows[0];
    expect(c).toEqual({ component_type: 'Filter Sock', component_category: 'Filtration', standard_size: '5', cost: 100, currency: 'USD' });

    // Re-running as updates must refresh prices, not add vendor options.
    await applyPlan([
      row({ sheetRow: 2, decision: 'UPDATE_PRODUCT', code: newProduct, model: `BF-${sfx}`, supplierCost: 700, costUsd: 104.32 }),
      row({ sheetRow: 4, decision: 'UPDATE_COMPONENT', code: newComponent, costUsd: 110 }),
    ], null);
    const vo = (await query(
      `SELECT vo.unit_price::float, vo.currency FROM vendor_options vo JOIN product_masters pm ON pm.id = vo.product_master_id WHERE pm.product_code = $1`, [newProduct])).rows;
    expect(vo).toEqual([{ unit_price: 700, currency: 'CNY' }]);
    expect((await query(`SELECT cost::float FROM components WHERE component_code = $1`, [newComponent])).rows[0].cost).toBe(110);
  });

  it('refuses a plan with problems before writing anything', async () => {
    const { familyCodes } = await loadExisting({ query } as any);
    const problems = validatePlan([
      row({ sheetRow: 7, code: null, familyCode: 'PFM-BAG' }),
      row({ sheetRow: 8, code: 'X'.repeat(60), familyCode: 'NOPE' }),
      row({ sheetRow: 9, code: `T-OK-${sfx}`, familyCode: 'PFM-BAG', costUsd: null }),
    ], familyCodes);
    expect(problems.join('\n')).toMatch(/Row 7: Code is required/);
    expect(problems.join('\n')).toMatch(/Row 8: code .* longer than 50/);
    expect(problems.join('\n')).toMatch(/Row 8: unknown product family "NOPE"/);
    expect(problems.join('\n')).toMatch(/Row 9: Cost USD is missing/);
  });
});
