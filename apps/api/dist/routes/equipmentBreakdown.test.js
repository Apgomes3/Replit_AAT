"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @vitest-environment node
const vitest_1 = require("vitest");
const exceljs_1 = __importDefault(require("exceljs"));
const equipmentBreakdown_1 = require("./equipmentBreakdown");
(0, vitest_1.describe)('equipment breakdown source normalization', () => {
    (0, vitest_1.it)('expands every selected allocation product and overlays PIM commercial fields', () => {
        const products = (0, equipmentBreakdown_1.expandAllocationProducts)({
            id: 'allocation-1',
            products: [
                { product_master_id: 'pm-1', product_name: 'Saved name', quantity: 2 },
                { product_master_id: 'pm-2', quantity: 1, unit: 'SET' },
            ],
        }, new Map([
            ['pm-1', { product_name: 'Catalog name', cost: 100, sell_price: 150, currency: 'EUR', manufacturer: 'AAT', model: 'FF-1' }],
            ['pm-2', { product_name: 'Sand filter', cost: 200, sell_price: 300, currency: 'USD' }],
        ]), 'Equipment');
        (0, vitest_1.expect)(products).toHaveLength(2);
        (0, vitest_1.expect)(products[0]).toMatchObject({ source_key: 'allocation-1:pm-1', quantity: 2, cost: 100, sell_price: 150, manufacturer: 'AAT' });
        (0, vitest_1.expect)(products[1]).toMatchObject({ source_key: 'allocation-1:pm-2', description: 'Sand filter', unit: 'SET' });
    });
    (0, vitest_1.it)('does not create an allocation placeholder when products are empty', () => {
        (0, vitest_1.expect)((0, equipmentBreakdown_1.expandAllocationProducts)({ id: 'allocation-2', products: [] }, new Map(), 'Sand filter')).toEqual([]);
    });
    (0, vitest_1.it)('reads an uninitialized schedule without inserting or syncing it', async () => {
        const calls = [];
        const db = { query: async (sql) => { calls.push(sql); return { rows: [] }; } };
        await (0, vitest_1.expect)((0, equipmentBreakdown_1.readExisting)(db, 'book-1')).resolves.toEqual({ initialized: false, items: [] });
        (0, vitest_1.expect)(calls).toHaveLength(1);
        (0, vitest_1.expect)(calls[0]).toContain('SELECT id FROM design_book_equipment_breakdowns');
        (0, vitest_1.expect)(calls.join(' ')).not.toMatch(/INSERT|UPDATE|DELETE/i);
    });
    (0, vitest_1.it)('writes a valid workbook with case-insensitively unique LSS sheets', async () => {
        const buffer = await (0, equipmentBreakdown_1.createWorkbookBuffer)([
            { system_code: 'LSS-A', system_name: 'First', source_kind: 'manual', description: '=unsafe', quantity: 1, unit: 'EA', currency: 'USD' },
            { system_code: 'lss-a', system_name: 'Second', source_kind: 'manual', description: 'Safe', quantity: 2, unit: 'EA', currency: 'USD' },
        ]);
        const workbook = new exceljs_1.default.Workbook();
        await workbook.xlsx.load(buffer);
        (0, vitest_1.expect)(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Summary', 'LSS-A', 'lss-a-2']);
        (0, vitest_1.expect)(workbook.getWorksheet('Summary')?.getCell('C2').value).toBe("'=unsafe");
    });
});
