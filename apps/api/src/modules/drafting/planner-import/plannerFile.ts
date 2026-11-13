// Reads a Microsoft Planner "Export plan to Excel" file.
// Planner writes a minimal .xlsx (inline strings, no cell references) that exceljs cannot open,
// so the sheet XML is read directly.
import fs from 'fs';
import zlib from 'zlib';

/** Extract one file from a zip archive (the .xlsx container). */
export function unzipEntry(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not an .xlsx (zip) file');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in the file`);
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Rows of the first worksheet as arrays of cell text. */
export function readSheetRows(xml: string): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)) {
    const cells: string[] = [];
    let pos = 0;
    for (const cm of rm[1]!.matchAll(/<(?:x:)?c((?:\s+[a-z]+="[^"]*")*)\s*(?:\/>|>([\s\S]*?)<\/(?:x:)?c>)/g)) {
      const ref = cm[1]!.match(/\sr="([A-Z]+\d+)"/);
      if (ref) pos = colIndex(ref[1]!); // Planner omits r=, so cells are positional
      const inner = cm[2] ?? '';
      const texts = inner.match(/<(?:x:)?t[^>]*>([\s\S]*?)<\/(?:x:)?t>/g);
      const value = inner.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/);
      cells[pos++] = texts ? decode(texts.map(t => t.replace(/<[^>]+>/g, '')).join('')) : value ? decode(value[1]!) : '';
    }
    rows.push(cells);
  }
  return rows;
}

export type PlannerTask = Record<string, string>;

/** The task table: header row starts with "Task number"; rows above it are the plan summary. */
export function tasksFromRows(rows: string[][]): PlannerTask[] {
  const h = rows.findIndex(r => r[0] === 'Task number');
  if (h < 0) throw new Error('No "Task number" header row — is this a Planner "Export plan to Excel" file?');
  const header = rows[h]!;
  return rows.slice(h + 1)
    .filter(r => r.some(Boolean))
    .map(r => Object.fromEntries(header.map((name, i) => [name, (r[i] ?? '').trim()])));
}

export function readPlannerFile(file: string): PlannerTask[] {
  return tasksFromRows(readSheetRows(unzipEntry(fs.readFileSync(file), 'xl/worksheets/sheet1.xml')));
}

/** Excel serial day number → YYYY-MM-DD (null for blanks). */
export function serialToIso(value: string | undefined): string | null {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0) return null;
  return new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10);
}
