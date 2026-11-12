// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPlan, ExistingProduct } from './plan';
import type { SourceRow } from './workbook';

let rowNo = 1;
const src = (over: Partial<SourceRow>): SourceRow => ({
  sheetRow: ++rowNo, category: 'Foam Fractionators', model: 'X', description: null, size: null, sizeRestoredFromDate: false,
  supplier: 'AAT', brand: null, powerKw: null, currency: 'RMB', cost: 671, lastUpdate: '2023-01-01', rrp: 150, notes: null,
  sandKg: null, lengthM: null, widthM: null, heightM: null, ...over,
});

const products: ExistingProduct[] = [
  { code: 'PM-FF-160', name: 'Foam Fractionator FF-160', model: 'FF-160', familyCode: 'PFM-FF', powerKw: 4, ozoneGh: null },
  { code: 'AAT-SF-1200', name: 'Sand Filter 1200', model: 'SF1200', familyCode: 'PFM-SF', powerKw: null, ozoneGh: null },
  { code: 'AAT-LPUV-80-PVC', name: '0.08 kW Low Pressure UV (PVC)', model: '80 PVC', familyCode: 'PFM-UV', powerKw: 0.08, ozoneGh: null },
  { code: 'PM-OZ-5', name: 'AAT Ozone Generator 5G', model: 'OZ-05', familyCode: 'PFM-OZ', powerKw: 0.128, ozoneGh: 5 },
];
const ctx = { products, components: [{ code: 'COMP-OLD', name: 'Old', model: 'T2-5µm-PE/PP' }], ratesPerUsd: { USD: 1, CNY: 6.71 }, priceListDate: '2024-06-24' };

describe('import plan', () => {
  it('updates exact model/code matches and converts the cost', () => {
    const [ff, sf] = buildPlan([src({ model: 'FF-160' }), src({ category: 'Sand Filter', model: 'SF-1200' })], ctx);
    expect(ff).toMatchObject({ decision: 'UPDATE_PRODUCT', code: 'PM-FF-160', costUsd: 100, sellPriceUsd: 150, warnings: null });
    expect(sf).toMatchObject({ decision: 'UPDATE_PRODUCT', code: 'AAT-SF-1200' });
  });

  it('prefers the product in the same family when several share a model', () => {
    const shared = [...products,
      { code: 'AAT-SF-1800', name: 'Sand Filter 1800', model: 'SF 1800', familyCode: 'PFM-SF', powerKw: null, ozoneGh: null },
      { code: 'LMU-SF1800-STD', name: 'LSS Medium Unit - SF 1800', model: 'SF 1800', familyCode: 'PFM-LMU', powerKw: null, ozoneGh: null }];
    const [sf] = buildPlan([src({ category: 'Sand Filter', model: 'SF-1800' })], { ...ctx, products: shared });
    expect(sf).toMatchObject({ decision: 'UPDATE_PRODUCT', code: 'AAT-SF-1800' });
  });

  it('does not match a specification across different manufacturers', () => {
    const withMaker = products.map(p => (p.code === 'PM-OZ-5' ? { ...p, manufacturer: 'AAT / BNP' } : p));
    const [triogen, bnp] = buildPlan([
      src({ category: 'Ozone Generator', model: 'triogen O3 S5', size: '5', supplier: 'Triogen' }),
      src({ category: 'Ozone Generator', model: 'BNP SOZ-YB-5G', size: '5', supplier: 'BNP' }),
    ], { ...ctx, products: withMaker });
    expect(triogen).toMatchObject({ decision: 'CREATE_PRODUCT' });
    expect(bnp).toMatchObject({ decision: 'UPDATE_PRODUCT', code: 'PM-OZ-5' });
  });

  it('suggests a single specification match but asks for confirmation', () => {
    const [oz] = buildPlan([src({ category: 'Ozone Generator', model: 'AAT-B3-5', size: '5', description: '5g/hr OG + Air Dryer' })], ctx);
    expect(oz).toMatchObject({ decision: 'UPDATE_PRODUCT', code: 'PM-OZ-5', ozoneGh: 5 });
    expect(oz!.warnings).toMatch(/Suggested match/);
  });

  it('creates new products when several rows resemble one existing product', () => {
    const rows = buildPlan([
      src({ category: 'UV (LPUV)', model: 'AAT-LPUV-PVC-80- GPO SKID', description: 'UPVC housing, 0.08kW', powerKw: 0.08 }),
      src({ category: 'UV (LPUV)', model: 'AAT-LPUV-PVC-80- PLC SKID', description: 'UPVC housing, 0.08kW', powerKw: 0.08 }),
    ], ctx);
    expect(rows.map(r => r.decision)).toEqual(['CREATE_PRODUCT', 'CREATE_PRODUCT']);
    expect(rows.map(r => r.code)).toEqual(['AAT-LPUV-PVC-80-GPO-SKID', 'AAT-LPUV-PVC-80-PLC-SKID']);
    expect(rows[0]!.warnings).toMatch(/resemble AAT-LPUV-80-PVC/);
  });

  it('makes components, skips labour, duplicates and rows without cost', () => {
    const rows = buildPlan([
      src({ category: 'Bag Filter Sock', model: 'T2-5µm-PE/PP', size: '5', sizeRestoredFromDate: true }),
      src({ category: 'Bag Filter Sock', model: 'T2-10µm-PE/PP' }),
      src({ category: 'Skid Fab Labour', model: 'Labour SKID 1' }),
      src({ category: 'Pump (SW)', model: 'CRP 125-100-250', cost: 108310, currency: 'RMB' }),
      src({ category: 'Pump (SW)', model: 'CRP 125-100-250', cost: 108310, currency: 'RMB' }),
      src({ category: 'Bag Filter Sock', model: 'T2-3µm-PE/PP', cost: null }),
    ], ctx);
    expect(rows[0]).toMatchObject({ decision: 'UPDATE_COMPONENT', code: 'COMP-OLD' });
    expect(rows[0]!.warnings).toMatch(/stored as a date/);
    expect(rows[1]).toMatchObject({ decision: 'CREATE_COMPONENT', code: 'COMP-T2-10UM-PE-PP', name: 'Filter Sock T2-10µm-PE/PP', componentCategory: 'Filtration' });
    expect(rows[2]).toMatchObject({ decision: 'SKIP' });
    expect(rows[2]!.warnings).toMatch(/Labour/);
    expect(rows[4]).toMatchObject({ decision: 'SKIP' });
    expect(rows[4]!.warnings).toMatch(/Duplicate of price list row/);
    expect(rows[5]).toMatchObject({ decision: 'SKIP' });
    expect(rows[5]!.warnings).toMatch(/No supplier cost/);
  });

  it('flags currencies without an app rate and disambiguates generic models', () => {
    const rows = buildPlan([
      src({ category: 'UV (MPUV)', model: 'CF105', currency: 'GBP', cost: 8889 }),
      src({ category: 'Sump / Break tank', model: 'AAT Sump', description: 'Sump (L 2.4m x W 1.2m x H 2m)', size: '3.96' }),
      src({ category: 'Sump / Break tank', model: 'AAT Sump', description: 'Sump (L 4m x W 1.2m x H 1m)', size: '3.04' }),
    ], ctx);
    expect(rows[0]).toMatchObject({ decision: 'CREATE_PRODUCT', costUsd: null });
    expect(rows[0]!.warnings).toMatch(/No GBP rate/);
    expect(rows[1]).toMatchObject({ code: 'AAT-SUMP-3-96', name: 'AAT Sump – Sump (L 2.4m x W 1.2m x H 2m)', familyCode: 'PFM-SUMP' });
    expect(rows[2]!.code).toBe('AAT-SUMP-3-04');
  });
});
