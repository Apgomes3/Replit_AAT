// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fillMissingUsdCosts, validatePlan } from './apply';
import type { PlanRow } from './workbook';

const row = (over: Partial<PlanRow>): PlanRow => ({
  sheetRow: 2, decision: 'CREATE_PRODUCT', code: 'NEW-1', familyCode: 'PFM-FF', componentType: null, componentCategory: null,
  name: 'Item', description: null, model: 'M', size: null, supplier: 'AAT', brand: null, supplierCurrency: 'CNY',
  supplierCost: 671, costUsd: 100, sellPriceUsd: 250, powerKw: null, ozoneGh: null, lengthMm: null, widthMm: null,
  heightMm: null, sandKg: null, notes: null, sourceCategory: 'Test', matchInfo: null, warnings: null, ...over,
});
const families = new Set(['PFM-FF', 'PFM-OZ']);
const existing = { products: new Set(['PM-OZ-10', 'PM-FF-160']), components: new Set(['COMP-OLD']) };

describe('reviewed plan validation', () => {
  it('converts a supplier cost typed by the reviewer when Cost USD is empty', () => {
    const rows = [row({ sheetRow: 9, supplierCost: 4.5, supplierCurrency: 'CNY', costUsd: null }), row({ sheetRow: 10, decision: 'SKIP', costUsd: null })];
    expect(fillMissingUsdCosts(rows, { CNY: 6.71 })).toEqual([9]);
    expect(rows[0]!.costUsd).toBe(0.67);
    expect(rows[1]!.costUsd).toBeNull();
  });

  it('requires UPDATE rows to name an existing code, once', () => {
    const problems = validatePlan([
      row({ sheetRow: 355, decision: 'UPDATE_PRODUCT', code: 'BNP-NEW-CODE' }),
      row({ sheetRow: 357, decision: 'UPDATE_PRODUCT', code: 'PM-OZ-10' }),
      row({ sheetRow: 360, decision: 'UPDATE_PRODUCT', code: 'pm-oz-10' }),
    ], families, existing).join('\n');
    expect(problems).toMatch(/Row 355: UPDATE needs the existing product code .*BNP-NEW-CODE/);
    expect(problems).toMatch(/Row 360: pm-oz-10 is also updated by row 357/);
    expect(problems).not.toMatch(/Row 357/);
  });

  it('rejects creating an existing code and a component row marked as product', () => {
    const problems = validatePlan([
      row({ sheetRow: 4, code: 'PM-FF-160' }),
      row({ sheetRow: 9, code: null, familyCode: null, componentType: 'Filter Sock' }),
    ], families, existing).join('\n');
    expect(problems).toMatch(/Row 4: code PM-FF-160 already exists/);
    expect(problems).toMatch(/Row 9: this row is a component \(Filter Sock\) — use CREATE_COMPONENT/);
  });
});
