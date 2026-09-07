import path from 'node:path';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';

type RecordValue = Record<string, any>;

export type LssIoScheduleRow = {
  system_id: string;
  system_code: string | null;
  system_name: string | null;
  panel: string | null;
  tag: string | null;
  instrument: string | null;
  signal_type: string | null;
  direction: string | null;
  assigned_product: string | null;
  control_logic: string | null;
};

const text = (value: unknown) => {
  const result = String(value ?? '').trim();
  return result || null;
};

const assignedProduct = (instrument: RecordValue) => {
  // An instance snapshot is the governed selection evidence. Do not infer an
  // export value from its product_master_id: that would make frozen books read
  // today's PIM record rather than the product selected when the book froze.
  const product = instrument.product_snapshot;
  if (!product || typeof product !== 'object') return null;
  const code = text(product.product_code);
  const name = text(product.product_name);
  return [code, name].filter(Boolean).join(' — ') || null;
};

const directionRank = (direction: string | null) => {
  const normalized = String(direction || '').toLowerCase();
  return normalized === 'input' ? 0 : normalized === 'output' ? 1 : 2;
};

export function projectLssIoSchedule(
  systems: RecordValue[],
  controlPackages: RecordValue[],
): LssIoScheduleRow[] {
  const systemById = new Map((systems || []).map(system => [system.id, system]));
  return (controlPackages || [])
    .flatMap(item => (item.instruments || []).map((instrument: RecordValue) => {
      const definition = instrument.definition_snapshot || {};
      const system = systemById.get(item.system_id || instrument.system_id) || {};
      return {
        system_id: String(item.system_id || instrument.system_id || ''),
        system_code: text(system.system_code),
        system_name: text(system.system_name),
        panel: text(item.control?.panel_type),
        tag: text(instrument.tag),
        instrument: text(definition.name),
        signal_type: text(definition.signal_type),
        direction: text(definition.signal_direction),
        assigned_product: assignedProduct(instrument),
        control_logic: text(instrument.control_logic),
        _sort_order: Number(definition.sort_order || 0),
        _tag_code: text(definition.tag_code) || '',
        _sequence: Number(instrument.sequence_number || 0),
        _id: text(instrument.id) || '',
      };
    }))
    .sort((left: any, right: any) =>
      String(left.system_code || '').localeCompare(String(right.system_code || '')) ||
      String(left.system_name || '').localeCompare(String(right.system_name || '')) ||
      String(left.panel || '').localeCompare(String(right.panel || '')) ||
      directionRank(left.direction) - directionRank(right.direction) ||
      String(left.direction || '').localeCompare(String(right.direction || '')) ||
      String(left.tag || '').localeCompare(String(right.tag || '')) ||
      left._sort_order - right._sort_order ||
      left._tag_code.localeCompare(right._tag_code) ||
      left._sequence - right._sequence ||
      left._id.localeCompare(right._id),
    )
    .map(({ _sort_order, _tag_code, _sequence, _id, ...row }: any) => row);
}

/** Render the saved I/O evidence directly, without persisting a derivative. */
export function renderLssIoSchedulePdf(book: RecordValue, rows: LssIoScheduleRow[]): Promise<Buffer> {
  const require = createRequire(__filename);
  const fontPath = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', 'DejaVuSans.ttf');
  const boldFontPath = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', 'DejaVuSans-Bold.ttf');
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, info: { Title: 'LSS I/O Schedule' } });
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Schedule', fontPath);
  doc.registerFont('ScheduleBold', boldFontPath);

  doc.font('ScheduleBold').fontSize(16).text('LSS I/O Schedule');
  doc.font('Schedule').fontSize(9).fillColor('#374151')
    .text(`Design Book: ${text(book.book_code) || 'Unavailable'}  ${text(book.book_title) || ''}`.trim())
    .text(`Status: ${text(book.status) || 'Unavailable'}`);
  doc.moveDown(0.8);

  const groups = new Map<string, { panel: string; direction: string; rows: LssIoScheduleRow[] }>();
  rows.forEach(row => {
    const panel = row.panel || 'Unassigned';
    const direction = row.direction || 'Unspecified';
    const key = `${panel}\u0000${direction}`;
    const group = groups.get(key) || { panel, direction, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  });
  if (!rows.length) {
    doc.font('Schedule').fontSize(10).fillColor('#6B7280').text('No saved instrument instances are available.');
  }
  groups.forEach(group => {
    if (doc.y > 720) doc.addPage();
    doc.font('ScheduleBold').fontSize(11).fillColor('#1F2937')
      .text(`${group.panel} panel · ${group.direction} signals`);
    doc.moveDown(0.3);
    group.rows.forEach(row => {
      if (doc.y > 700) {
        doc.addPage();
        doc.font('ScheduleBold').fontSize(11).fillColor('#1F2937')
          .text(`${group.panel} panel · ${group.direction} signals (continued)`);
        doc.moveDown(0.3);
      }
      doc.font('ScheduleBold').fontSize(8).fillColor('#111827')
        .text(`${row.tag || 'Unavailable'}  ·  ${row.instrument || 'Unavailable'}`);
      doc.font('Schedule').fontSize(7.5).fillColor('#374151')
        .text(`Signal: ${row.signal_type || 'Unavailable'} · Direction: ${row.direction || 'Unavailable'}`)
        .text(`Assigned product: ${row.assigned_product || 'Unassigned'}`)
        .text(`Saved control logic: ${row.control_logic || 'Unassigned'}`);
      doc.moveDown(0.55);
    });
    doc.moveDown(0.4);
  });
  doc.end();
  return completed;
}