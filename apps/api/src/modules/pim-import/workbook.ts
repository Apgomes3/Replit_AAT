// Reading the ASW price list and writing/reading the review spreadsheet.
import ExcelJS from 'exceljs';
import { cleanSize, parseKw, parseNumber } from './rules';

export type SourceRow = {
  sheetRow: number;
  category: string;
  model: string;
  description: string | null;
  size: string | null;
  sizeRestoredFromDate: boolean;
  supplier: string | null;
  brand: string | null;
  powerKw: number | null;
  currency: string | null;
  cost: number | null;
  lastUpdate: string | null;
  rrp: number | null;
  notes: string | null;
  sandKg: number | null;
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
};

/** Value of a cell: formula results, rich text and hyperlinks resolved. */
export function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as any;
    if (o.richText) return o.richText.map((r: any) => r.text).join('');
    if ('result' in o || o.formula || o.sharedFormula) {
      const r = o.result;
      return r && typeof r === 'object' && 'error' in r ? null : r ?? null;
    }
    if (o.text) return o.text;
    if (o.error) return null;
  }
  return v;
}

const text = (v: unknown) => {
  if (v == null) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, ' ').trim();
  return s || null;
};

const LSS_SHEET = 'LSS Equipment';

/** Read the LSS Equipment sheet. Columns are located by header text, not position. */
export async function readLssEquipment(file: string): Promise<SourceRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(LSS_SHEET);
  if (!ws) throw new Error(`Sheet "${LSS_SHEET}" not found in ${file}`);

  const col: Record<string, number> = {};
  ws.getRow(1).eachCell((c, i) => { const h = text(cellValue(c.value)); if (h) col[h] = i; });
  const need = (h: string) => { if (!col[h]) throw new Error(`Column "${h}" not found on "${LSS_SHEET}"`); return col[h]!; };
  const c = {
    category: need('EQUIPMENT'), model: need('Model'), description: need('Description'), size: need('Size'),
    supplier: need('Supplier'), brand: need('Brand'), power: need('Rated Power per unit (kw)'), currency: need('Currency'),
    cost: need('Cost ($$$/unit)'), lastUpdate: need('Last update'), rrp: need('RRP per unit (USD)'),
    notes: need('Notes'), notes2: need('Notes 2'), sandKg: col['KG of sand per filter'],
    length: col['Size - Length (m)'], width: col['Size - Width (m)'], height: col['Size - Height (m)'],
  };

  const rows: SourceRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r === 1) return;
    const get = (i?: number) => (i ? cellValue(row.getCell(i).value) : null);
    const category = text(get(c.category));
    const model = text(get(c.model));
    if (!category || !model) return;
    const size = cleanSize(get(c.size));
    const lastUpdate = get(c.lastUpdate);
    rows.push({
      sheetRow: r,
      category,
      model,
      description: text(get(c.description)),
      size: size.value,
      sizeRestoredFromDate: size.restoredFromDate,
      supplier: text(get(c.supplier)),
      brand: text(get(c.brand)),
      powerKw: parseKw(get(c.power)),
      currency: text(get(c.currency)),
      cost: parseNumber(get(c.cost)),
      lastUpdate: lastUpdate instanceof Date ? lastUpdate.toISOString().slice(0, 10) : text(lastUpdate),
      rrp: parseNumber(get(c.rrp)),
      notes: [text(get(c.notes)), text(get(c.notes2))].filter(Boolean).join(' · ') || null,
      sandKg: parseNumber(get(c.sandKg)),
      lengthM: parseNumber(get(c.length)),
      widthM: parseNumber(get(c.width)),
      heightM: parseNumber(get(c.height)),
    });
  });
  return rows;
}

// ---------- review spreadsheet ----------

export const DECISIONS = ['CREATE_PRODUCT', 'UPDATE_PRODUCT', 'CREATE_COMPONENT', 'UPDATE_COMPONENT', 'SKIP'] as const;
export type Decision = typeof DECISIONS[number];

export type PlanRow = {
  sheetRow: number;
  decision: Decision;
  code: string | null; // product/component code to create, or the existing code to update
  familyCode: string | null;
  componentType: string | null;
  componentCategory: string | null;
  name: string;
  description: string | null;
  model: string;
  size: string | null;
  supplier: string | null;
  brand: string | null;
  supplierCurrency: string | null;
  supplierCost: number | null;
  costUsd: number | null;
  sellPriceUsd: number | null;
  powerKw: number | null;
  ozoneGh: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  sandKg: number | null;
  notes: string | null;
  sourceCategory: string;
  matchInfo: string | null;
  warnings: string | null;
};

/** Review columns: [key, header, width, editable] — editable ones are highlighted for the reviewer. */
const COLUMNS: Array<[keyof PlanRow, string, number, boolean]> = [
  ['sheetRow', 'Price list row', 9, false],
  ['decision', 'Decision', 18, true],
  ['code', 'Code (new or existing)', 30, true],
  ['familyCode', 'Product family', 13, true],
  ['componentType', 'Component type', 14, true],
  ['componentCategory', 'Component category', 14, true],
  ['name', 'Name', 40, true],
  ['matchInfo', 'Match', 42, false],
  ['warnings', 'Warnings', 48, false],
  ['sourceCategory', 'Price list category', 22, false],
  ['model', 'Model', 26, false],
  ['description', 'Description', 40, true],
  ['size', 'Size', 12, true],
  ['supplier', 'Supplier', 14, false],
  ['brand', 'Brand', 12, false],
  ['supplierCurrency', 'Supplier currency', 10, false],
  ['supplierCost', 'Supplier cost', 12, false],
  ['costUsd', 'Cost USD (app rate)', 12, true],
  ['sellPriceUsd', 'Sell price USD (RRP)', 12, true],
  ['powerKw', 'Power kW', 9, true],
  ['ozoneGh', 'Ozone g/h', 9, true],
  ['lengthMm', 'Length mm', 9, true],
  ['widthMm', 'Width mm', 9, true],
  ['heightMm', 'Height mm', 9, true],
  ['sandKg', 'Sand kg', 8, true],
  ['notes', 'Notes', 40, true],
];

const NUMERIC: Array<keyof PlanRow> = ['sheetRow', 'supplierCost', 'costUsd', 'sellPriceUsd', 'powerKw', 'ozoneGh', 'lengthMm', 'widthMm', 'heightMm', 'sandKg'];

export async function writeReview(file: string, rows: PlanRow[], summary: Array<[string, string | number]>) {
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet('Read me');
  info.columns = [{ width: 42 }, { width: 90 }];
  summary.forEach(r => info.addRow(r));
  info.getColumn(1).font = { bold: true };

  const ws = wb.addWorksheet('Review', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  COLUMNS.forEach(([, , , editable], i) => {
    header.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: editable ? 'FF087F73' : 'FF53686B' } };
  });
  for (const r of rows) {
    const added = ws.addRow(r);
    if (r.warnings) added.getCell('warnings').font = { color: { argb: 'FFB45309' } };
    if (r.decision === 'SKIP') added.font = { color: { argb: 'FF8A9B9A' } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  // Decision drop-down on every data row.
  for (let i = 2; i <= rows.length + 1; i++) {
    ws.getCell(i, 2).dataValidation = { type: 'list', allowBlank: false, formulae: [`"${DECISIONS.join(',')}"`] };
  }
  await wb.xlsx.writeFile(file);
}

export async function readReview(file: string): Promise<PlanRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Review');
  if (!ws) throw new Error('This file has no "Review" sheet — use the file produced by the dry run.');
  const index: Record<string, number> = {};
  ws.getRow(1).eachCell((c, i) => { index[String(cellValue(c.value))] = i; });
  const rows: PlanRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r === 1) return;
    const out: any = {};
    for (const [key, header] of COLUMNS) {
      const i = index[header];
      if (!i) throw new Error(`Review sheet is missing the "${header}" column.`);
      const v = cellValue(row.getCell(i).value);
      out[key] = NUMERIC.includes(key) ? parseNumber(v) : text(v);
    }
    if (out.sheetRow == null) return;
    rows.push(out as PlanRow);
  });
  return rows;
}
