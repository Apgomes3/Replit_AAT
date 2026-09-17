// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createWorkbookBuffer, expandAllocationProducts, readExisting } from './equipmentBreakdown';

describe('equipment breakdown source normalization', () => {
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

  it('reads an uninitialized schedule without inserting or syncing it', async () => {
    const calls: string[] = [];
    const db: any = { query: async (sql: string) => { calls.push(sql); return { rows: [] }; } };
    await expect(readExisting(db, 'book-1')).resolves.toEqual({ initialized: false, items: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('SELECT id FROM design_book_equipment_breakdowns');
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
    expect(workbook.getWorksheet('Summary')?.getCell('C2').value).toBe("'=unsafe");
  });
});