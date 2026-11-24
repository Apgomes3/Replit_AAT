// Renders the PHE selection sheet model (apps/web/src/lib/plateHeatExchangerSheet.ts) to a one-page A4 PDF
// on AAT letterhead, matching the browser print view, for storing in the project's documents.
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

export type SheetRow = { n: number; desc: string; unit: string; a: string; b?: string };
export type SheetModel = {
  header: Record<string, string | undefined>; date: string;
  sections: { title: string; columns?: [string, string]; rows: SheetRow[] }[];
  notes: string[];
  chart: { hotName: string; coldName: string; points: { x: number; hot: number; cold: number }[]; hotIn: number; hotOut: number; coldIn: number; coldOut: number; dT1: number; dT2: number };
};

const MM = 72 / 25.4;
const BLUE = '#003f7d', LIGHT = '#e6edf4', LINE = '#9aa7b4', INK = '#1a1a1a', MUTED = '#6b7785';
const HOT = '#c4512b', COLD = '#2370b3';
const PRINT_DIR = path.join(__dirname, '../../../web/public/print');

const num = (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');

/** Throws when the posted model is not shaped like a sheet (it comes from the browser). */
export function assertSheetModel(m: any): asserts m is SheetModel {
  const ok = m && typeof m === 'object' && m.header && typeof m.header === 'object' && typeof m.date === 'string'
    && Array.isArray(m.sections) && m.sections.length <= 6 && m.sections.every((s: any) => typeof s?.title === 'string' && Array.isArray(s.rows) && s.rows.length <= 40
      && s.rows.every((r: any) => typeof r?.desc === 'string' && typeof r?.a === 'string'))
    && Array.isArray(m.notes) && m.notes.length <= 10 && m.notes.every((t: any) => typeof t === 'string')
    && m.chart && Array.isArray(m.chart.points) && m.chart.points.length <= 200
    && m.chart.points.every((p: any) => [p?.x, p?.hot, p?.cold].every(Number.isFinite));
  if (!ok) throw new Error('The selection sheet is not valid.');
}

export function renderPheSheetPdf(m: SheetModel, title: string): Promise<Buffer> {
  const require = createRequire(__filename);
  const fontDir = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: title, Author: 'Advanced Aquarium Technologies' } });
  const chunks: Buffer[] = [];
  doc.on('data', c => chunks.push(Buffer.from(c)));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.registerFont('R', path.join(fontDir, 'DejaVuSans.ttf'));
  doc.registerFont('B', path.join(fontDir, 'DejaVuSans-Bold.ttf'));

  const pageW = 210 * MM, pageH = 297 * MM;
  const head = path.join(PRINT_DIR, 'aat-letterhead-first.png'), foot = path.join(PRINT_DIR, 'aat-letterhead-footer.png');
  if (fs.existsSync(head)) doc.image(head, 0, 0, { width: pageW });
  if (fs.existsSync(foot)) doc.image(foot, 0, pageH - 4 * MM - pageW * 190 / 4961, { width: pageW });

  const x0 = 20 * MM, W = 170 * MM;
  let y = 47 * MM;
  const FS = 6.6, RH = 3.55 * MM, PAD = 1.4 * MM;
  const cell = (x: number, w: number, text: string, o: { bold?: boolean; fill?: string; color?: string; align?: 'left' | 'center'; h?: number } = {}) => {
    const h = o.h ?? RH;
    if (o.fill) doc.rect(x, y, w, h).fill(o.fill);
    doc.lineWidth(0.2 * MM).strokeColor(LINE).rect(x, y, w, h).stroke();
    doc.font(o.bold ? 'B' : 'R').fontSize(FS).fillColor(o.color || INK)
      .text(text ?? '', x + PAD, y + (h - FS * 1.15) / 2, { width: w - 2 * PAD, align: o.align || 'left', lineBreak: false, ellipsis: true });
  };

  doc.font('B').fontSize(11).fillColor(BLUE).text('EQUIPMENT DATA SHEET · PLATE HEAT EXCHANGER', x0, y, { lineBreak: false });
  y += 6 * MM;

  const h = m.header;
  const kW = 22 * MM, vW = W / 2 - kW;
  for (const [k1, v1, k2, v2] of [
    ['Project', h.project, 'Doc. no.', h.doc_no], ['Client', h.client, 'Item / tag', h.tag], ['Service', h.service, 'Rev / date', `${h.rev || ''} / ${m.date}`],
  ]) {
    cell(x0, kW, k1!, { bold: true, fill: LIGHT }); cell(x0 + kW, vW, v1 || '');
    cell(x0 + W / 2, kW, k2!, { bold: true, fill: LIGHT }); cell(x0 + W / 2 + kW, vW, v2 || '');
    y += RH;
  }
  y += 2.2 * MM;

  const nW = 6 * MM, uW = 17 * MM, vColW = 38 * MM, dW = W - nW - uW - 2 * vColW;
  for (const sec of m.sections) {
    cell(x0, W, sec.title, { bold: true, fill: BLUE, color: '#ffffff' }); y += RH;
    if (sec.columns) {
      cell(x0, nW, '', { fill: LIGHT }); cell(x0 + nW, dW, 'Description', { bold: true, fill: LIGHT });
      cell(x0 + nW + dW, uW, 'Unit', { bold: true, fill: LIGHT, align: 'center' });
      cell(x0 + nW + dW + uW, vColW, sec.columns[0], { bold: true, fill: LIGHT, align: 'center' });
      cell(x0 + nW + dW + uW + vColW, vColW, sec.columns[1], { bold: true, fill: LIGHT, align: 'center' });
      y += RH;
    }
    for (const r of sec.rows) {
      cell(x0, nW, String(r.n), { color: MUTED, align: 'center' });
      cell(x0 + nW, dW, r.desc);
      cell(x0 + nW + dW, uW, r.unit, { color: '#4a5562' });
      if (r.b === undefined) cell(x0 + nW + dW + uW, 2 * vColW, r.a, { align: 'center' });
      else { cell(x0 + nW + dW + uW, vColW, r.a, { align: 'center' }); cell(x0 + nW + dW + uW + vColW, vColW, r.b, { align: 'center' }); }
      y += RH;
    }
  }
  y += 2.2 * MM;

  // Profile chart (left) and notes (right)
  const cW = 92 * MM, cH = 38 * MM, top = y;
  doc.lineWidth(0.2 * MM).strokeColor(LINE).rect(x0, top, cW, cH).stroke();
  doc.font('B').fontSize(6.4).fillColor(BLUE).text('Temperature profile along the plate pack (counter-current)', x0 + 1.5 * MM, top + 1.2 * MM, { lineBreak: false });
  drawChart(doc, m.chart, x0 + 1.5 * MM, top + 4.5 * MM, cW - 3 * MM, cH - 6 * MM);
  let ny = top;
  doc.font('R').fontSize(6.4).fillColor(INK);
  for (const t of m.notes) {
    const nx = x0 + cW + 4 * MM + 3 * MM, nw = W - cW - 7 * MM;
    doc.circle(nx - 2 * MM, ny + 1.1 * MM, 0.4 * MM).fill(INK);
    doc.fillColor(INK).text(t, nx, ny, { width: nw });
    ny = doc.y + 0.4 * MM;
  }
  y = Math.max(top + cH, ny) + 2.2 * MM;

  const sw = W / 6, labels = ['Rev', 'Description', 'Date', 'Prepared', 'Checked', 'Approved'];
  const vals = [h.rev || '', 'Issued for review', m.date, h.prepared || '', h.checked || '', h.approved || ''];
  labels.forEach((l, i) => cell(x0 + i * sw, sw, l, { bold: true, fill: LIGHT, align: 'center' })); y += RH;
  vals.forEach((v, i) => cell(x0 + i * sw, sw, v, { align: 'center' }));

  doc.end();
  return done;
}

function drawChart(doc: PDFKit.PDFDocument, c: SheetModel['chart'], x: number, y: number, w: number, h: number) {
  const ml = 7 * MM, mr = 14 * MM, mb = 5 * MM, pw = w - ml - mr, ph = h - mb;
  const lo = Math.min(c.coldIn, c.coldOut, c.hotOut), hi = Math.max(c.hotIn, c.hotOut, c.coldOut);
  const pad = Math.max(1, (hi - lo) * 0.08), y0 = Math.floor(lo - pad), y1 = Math.ceil(hi + pad);
  const X = (v: number) => x + ml + v * pw, Y = (t: number) => y + (1 - (t - y0) / (y1 - y0)) * ph;
  const s0 = (y1 - y0) / 5, p = Math.pow(10, Math.floor(Math.log10(s0))), mm = s0 / p;
  const step = (mm < 1.5 ? 1 : mm < 3 ? 2 : mm < 7 ? 5 : 10) * p;
  doc.font('R').fontSize(5);
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) {
    doc.lineWidth(0.3).strokeColor('#e7e5e4').moveTo(X(0), Y(v)).lineTo(X(1), Y(v)).stroke();
    doc.fillColor('#78716c').text(num(v, step < 1 ? 1 : 0), x, Y(v) - 2, { width: ml - 1.5 * MM, align: 'right', lineBreak: false });
  }
  doc.lineWidth(0.5).strokeColor('#78716c').moveTo(X(0), y).lineTo(X(0), y + ph).lineTo(X(1), y + ph).stroke();
  for (const [key, col] of [['hot', HOT], ['cold', COLD]] as const) {
    c.points.forEach((pt, i) => (i ? doc.lineTo(X(pt.x), Y(pt[key])) : doc.moveTo(X(pt.x), Y(pt[key]))));
    doc.lineWidth(1.2).strokeColor(col).stroke();
  }
  const label = (vx: number, t: number, text: string, col: string) => doc.fillColor(col).text(text, vx, Y(t) - 2, { lineBreak: false });
  label(X(1) + 1.5 * MM, c.hotOut, `${num(c.hotOut)} °C out`, HOT);
  label(X(1) + 1.5 * MM, c.coldIn, `${num(c.coldIn)} °C in`, COLD);
  label(X(0) + 1.5 * MM, c.hotIn + (y1 - y0) * 0.06, `${num(c.hotIn)} °C in`, HOT);
  label(X(0) + 1.5 * MM, c.coldOut - (y1 - y0) * 0.07, `${num(c.coldOut)} °C out`, COLD);
  doc.fillColor(HOT).text(`${c.hotName} →`, X(0.02), y + ph + 1.5 * MM, { lineBreak: false });
  doc.fillColor(COLD).text(`← ${c.coldName}`, X(0.55), y + ph + 1.5 * MM, { width: X(0.98) - X(0.55), align: 'right', lineBreak: false });
}
