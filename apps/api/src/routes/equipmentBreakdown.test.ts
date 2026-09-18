// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { calculateEquipmentPricing, convertEquipmentCurrency, createWorkbookBuffer, expandAllocationProducts, expandBioDegasPlenumProducts, expandBiologicalMediaProducts, expandSandFilterProducts, groupEquipmentInstrumentSources, normalizeEquipmentCurrency, pimMarkup, readExisting } from './equipmentBreakdown';
import { isLifeSupportSystem } from '../lib/lssSystems';

describe('equipment breakdown source normalization', () => {
  it('calculates rounded selling and total prices for normal, zero, decimal, and incomplete inputs', () => {
    expect(calculateEquipmentPricing({ unit_cost: 100, markup: 25, quantity: 2 })).toEqual({ selling_price: 125, total_price: 250 });
    expect(calculateEquipmentPricing({ unit_cost: 0, markup: 0, quantity: 0 })).toEqual({ selling_price: 0, total_price: 0 });
    expect(calculateEquipmentPricing({ unit_cost: 10.125, markup: 12.5, quantity: 3.25 })).toEqual({ selling_price: 11.39, total_price: 37.02 });
    expect(calculateEquipmentPricing({ unit_cost: 100, markup: null, quantity: 2 })).toEqual({ selling_price: null, total_price: null });
    expect(calculateEquipmentPricing({ unit_cost: 100, markup: 10, quantity: null })).toEqual({ selling_price: 110, total_price: null });
  });

  it('rounds markup derived from PIM pricing to a whole number', () => {
    expect(pimMarkup(100, 133.6)).toBe(34);
    expect(pimMarkup(100, 133.4)).toBe(33);
    expect(pimMarkup(0, 100)).toBeNull();
  });

  it('converts line costs through USD using administrator rates', () => {
    expect(convertEquipmentCurrency(100, 1, 7.25)).toBe(725);
    expect(convertEquipmentCurrency(725, 7.25, 1)).toBe(100);
    expect(convertEquipmentCurrency(100.12, 1.5, 1.65)).toBe(110.13);
    expect(convertEquipmentCurrency(100, null, 1.65)).toBeNull();
  });

  it('normalizes RMB to the stored CNY code', () => {
    expect(normalizeEquipmentCurrency('RMB')).toBe('CNY');
    expect(normalizeEquipmentCurrency('eur')).toBe('EUR');
  });
  it('recognizes an LSS-coded system even when its equipment type is specialized', () => {
    expect(isLifeSupportSystem({ system_code: 'LSS-01', system_type: 'UV Sterilization' })).toBe(true);
    expect(isLifeSupportSystem({ system_code: 'P-01', system_type: 'Pump' })).toBe(false);
  });

  it('expands every selected allocation product and overlays PIM commercial fields', () => {
    const products = expandAllocationProducts({
      id: 'allocation-1',
      products: [
        { product_master_id: 'pm-1', product_name: 'Saved name', quantity: 2 },
        { product_master_id: 'pm-2', quantity: 1, unit: 'SET' },
      ],
    }, new Map([
      ['pm-1', { product_name: 'Catalog name', cost: 100, sell_price: 150, currency: 'EUR', manufacturer: 'AAT', model: 'FF-1' }],
      ['pm-2', { product_name: 'Sand filter', cost: 200, sell_price: 300, currency: 'USD' }],
    ]), 'Equipment');

    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ source_key: 'allocation-1:pm-1', quantity: 2, cost: 100, sell_price: 150, manufacturer: 'AAT' });
    expect(products[1]).toMatchObject({ source_key: 'allocation-1:pm-2', description: 'Sand filter', unit: 'SET' });
  });

  it('does not create an allocation placeholder when products are empty', () => {
    expect(expandAllocationProducts({ id: 'allocation-2', products: [] }, new Map(), 'Sand filter')).toEqual([]);
  });

  it('adds the PIM sand/media load for every selected filter unit', () => {
    expect(expandSandFilterProducts({
      id: 'sand-allocation-1',
      products: [{ product_master_id: 'sand-filter-1', quantity: 3 }],
    }, new Map([
      ['sand-filter-1', { product_name: 'AAT Sand Filter 1200', sand_media_per_filter_kg: 250.5 }],
    ]))).toMatchObject([
      {
        line_kind: 'filter',
        source_key: 'sand-allocation-1:sand-filter-1',
        description: 'AAT Sand Filter 1200',
        quantity: 3,
        unit: 'EA',
      },
      {
        line_kind: 'filter_media',
        source_key: 'sand-allocation-1:sand-filter-1:sand-media',
        description: 'AAT Sand Filter 1200 sand/media',
        quantity: 751.5,
        unit: 'kg',
        sand_media_per_filter_kg: 250.5,
        filter_quantity: 3,
      },
    ]);
  });

  it('creates separate crate and required-media lines from a Biological Media result', () => {
    expect(expandBiologicalMediaProducts({
      id: 'bio-case-1',
      preview_result: { media: {
        required_media_l: 13681.2305,
        required_media_m3: 13.6812305,
        installed_media_l: 13681.2305,
        installed_media_m3: 13.6812305,
      } },
    })).toMatchObject([
      { source_key: 'bio-case-1:bio-crates', quantity: 58, unit: 'EA' },
      { source_key: 'bio-case-1:required-media', quantity: 13681.2305, unit: 'L' },
    ]);
  });

  it('creates a dispersion-tray line from the saved Bio/Degas plenum layout', () => {
    expect(expandBioDegasPlenumProducts({
      id: 'plenum-layout-1',
      layout: { tray_count: 2, external_length_mm: 8500 },
    })).toMatchObject([{
      source_key: 'bio-degas-plenum:plenum-layout-1:dispersion-trays',
      description: 'Dispersion tray',
      quantity: 2,
      unit: 'EA',
      plenum_layout_id: 'plenum-layout-1',
    }]);
    expect(expandBioDegasPlenumProducts({ id: 'draft', layout: {} })).toEqual([]);
  });

  it('consolidates control valves into one equipment line per size group', () => {
    const valves = Array.from({ length: 12 }, (_, index) => ({
      id: `valve-${index + 1}`,
      system_id: 'system-1',
      definition_id: 'definition-2bv',
      group_key: 'dn50-group',
      nominal_size: 'DN50',
      product_master_id: 'product-actuator-1',
      definition_snapshot: { id: 'definition-2bv', name: '2-way Ball Valve', tag_code: '2BV' },
      product_name: 'DN50 actuated ball valve',
      cost: 100,
      sell_price: 150,
    }));

    expect(groupEquipmentInstrumentSources(valves)).toMatchObject([{
      equipment_source_key: 'instrument-group:definition-2bv:dn50-group',
      description: '2-way Ball Valve — DN50',
      nominal_size: 'DN50',
      product_master_id: 'product-actuator-1',
      quantity: 12,
      instrument_ids: valves.map(valve => valve.id),
    }]);
  });

  it('keeps different valve sizes and actuators on separate equipment lines', () => {
    const grouped = groupEquipmentInstrumentSources([
      {
        id: 'valve-1', system_id: 'system-1', definition_id: 'definition-2bv',
        group_key: 'dn50-group', nominal_size: 'DN50', product_master_id: 'actuator-1',
        definition_snapshot: { name: '2-way Ball Valve', tag_code: '2BV' },
      },
      {
        id: 'valve-2', system_id: 'system-1', definition_id: 'definition-2bv',
        group_key: 'dn80-group', nominal_size: 'DN80', product_master_id: 'actuator-2',
        definition_snapshot: { name: '2-way Ball Valve', tag_code: '2BV' },
      },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.map(item => [item.nominal_size, item.product_master_id, item.quantity])).toEqual([
      ['DN50', 'actuator-1', 1],
      ['DN80', 'actuator-2', 1],
    ]);
  });

  it('consolidates matching non-valve instruments into one equipment line', () => {
    const grouped = groupEquipmentInstrumentSources([
      {
        id: 'flow-switch-1', system_id: 'system-1', definition_id: 'definition-fs',
        product_master_id: 'flow-switch-product',
        definition_snapshot: { name: 'Flow Switch', tag_code: 'FS' },
      },
      {
        id: 'flow-switch-2', system_id: 'system-1', definition_id: 'definition-fs',
        product_master_id: 'flow-switch-product',
        definition_snapshot: { name: 'Flow Switch', tag_code: 'FS' },
      },
    ]);

    expect(grouped).toMatchObject([{
      equipment_source_key: 'instrument-group:definition-fs:product:flow-switch-product',
      description: 'Flow Switch',
      quantity: 2,
      instrument_ids: ['flow-switch-1', 'flow-switch-2'],
    }]);
  });

  it('reads an uninitialized schedule without inserting or syncing it', async () => {
    const calls: string[] = [];
    const db: any = { query: async (sql: string) => { calls.push(sql); return { rows: [] }; } };
    await expect(readExisting(db, 'book-1')).resolves.toEqual({ initialized: false, items: [], hidden_columns: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('SELECT id,hidden_columns FROM design_book_equipment_breakdowns');
    expect(calls.join(' ')).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  it('writes a valid workbook with case-insensitively unique LSS sheets', async () => {
    const buffer = await createWorkbookBuffer([
      { system_code: 'LSS-A', system_name: 'First', source_kind: 'manual', description: '=unsafe', quantity: 1, unit: 'EA', currency: 'USD' },
      { system_code: 'lss-a', system_name: 'Second', source_kind: 'manual', description: 'Safe', quantity: 2, unit: 'EA', currency: 'USD' },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Summary', 'LSS-A', 'lss-a-2']);
    expect(workbook.getWorksheet('Summary')?.getRow(1).values).not.toContain('Source');
    expect(workbook.getWorksheet('Summary')?.getCell('B2').value).toBe("'=unsafe");
  });

  it('removes hidden columns from the summary and per-LSS sheets', async () => {
    const buffer = await createWorkbookBuffer([
      { system_code: 'LSS-01', system_name: 'Main', source_kind: 'pump', description: 'Pump', quantity: 1, unit: 'EA', supplier: 'Hidden supplier', currency: 'USD' },
    ], ['supplier', 'unit_cost', 'total_price']);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    expect(workbook.getWorksheet('Summary')?.getRow(1).values).not.toContain('Supplier');
    expect(workbook.getWorksheet('Summary')?.getRow(1).values).not.toContain('Unit Cost');
    expect(workbook.getWorksheet('LSS-01')?.getRow(1).values).not.toContain('Supplier');
    expect(workbook.getWorksheet('Summary')?.getRow(1).values).not.toContain('Total Price');
  });

  it('exports calculated selling and total prices and leaves incomplete values blank', async () => {
    const buffer = await createWorkbookBuffer([
      { system_code: 'LSS-01', description: 'Complete', quantity: 2, unit_cost: 10, markup: 25 },
      { system_code: 'LSS-01', description: 'Incomplete', quantity: 2, unit_cost: 10, markup: null },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Summary')!;
    const headers = (sheet.getRow(1).values as any[]).map(String);
    const sellingColumn = headers.indexOf('Selling Price');
    const totalColumn = headers.indexOf('Total Price');
    expect(sheet.getRow(2).getCell(sellingColumn).value).toBe(12.5);
    expect(sheet.getRow(2).getCell(totalColumn).value).toBe(25);
    expect(sheet.getRow(3).getCell(sellingColumn).value).toBeNull();
    expect(sheet.getRow(3).getCell(totalColumn).value).toBeNull();
  });
});