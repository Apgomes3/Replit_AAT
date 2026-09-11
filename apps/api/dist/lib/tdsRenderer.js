"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTdsPdf = void 0;
const labelFor = (key) => key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
const displayValue = (value) => {
    if (value === null || value === undefined || value === '')
        return 'Unavailable';
    if (typeof value === 'boolean')
        return value ? 'Yes' : 'No';
    if (typeof value === 'object')
        return JSON.stringify(value);
    return String(value);
};
const safePdfText = (value) => value
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
const addObject = (objects, value) => {
    objects.push(value);
    return objects.length;
};
const contentLines = (content, document, revision) => {
    const sections = content?.sections || {};
    const lines = [
        content.title || document.document_title || 'Technical Data Sheet',
        `Document: ${document.document_code || 'Unavailable'}   Revision: ${revision.revision_code || 'Unavailable'}   Status: ${revision.status || document.status || 'Unavailable'}`,
        `Generated: ${revision.generated_at || content.generated_at || 'Unavailable'}`,
        '',
    ];
    const addFields = (heading, fields) => {
        if (!fields || typeof fields !== 'object' || Array.isArray(fields))
            return;
        lines.push(heading);
        Object.entries(fields).forEach(([key, value]) => {
            if (Array.isArray(value) || (value && typeof value === 'object'))
                return;
            lines.push(`${labelFor(key)}: ${displayValue(value)}`);
        });
        lines.push('');
    };
    addFields('Product identity', sections.identity);
    addFields('Classification', sections.classification);
    addFields('Engineering values', sections.engineering_values);
    addFields('Materials', sections.materials);
    ['dimensions', 'electrical', 'hydraulic', 'pneumatic', 'tank_engineering'].forEach(key => {
        addFields(labelFor(key), sections[key]);
    });
    const classifiers = sections.classification?.classifier_values;
    if (Array.isArray(classifiers) && classifiers.length) {
        lines.push('Classification values');
        classifiers.forEach((row) => lines.push(`${displayValue(row.label || row.classifier_label)}: ${displayValue(row.value_text ?? row.value)}${row.unit ? ` ${row.unit}` : ''}`));
        lines.push('');
    }
    const boms = sections.bill_of_materials;
    if (Array.isArray(boms) && boms.length) {
        lines.push('Bill of materials');
        boms.forEach((bom) => {
            lines.push(`${displayValue(bom.bom_code || bom.code)}${bom.revision_code ? ` (Rev ${bom.revision_code})` : ''}`);
            (Array.isArray(bom.lines) ? bom.lines : []).forEach((row) => lines.push(`  ${displayValue(row.component_name)} | Qty ${displayValue(row.quantity)} ${displayValue(row.unit)}${row.remarks ? ` | ${row.remarks}` : ''}`));
        });
        lines.push('');
    }
    const vendors = sections.vendors;
    if (Array.isArray(vendors) && vendors.length) {
        lines.push('Vendor options');
        vendors.forEach((row) => lines.push(`${displayValue(row.vendor_name || row.manufacturer_name)} | ${displayValue(row.vendor_item_code)} | ${displayValue(row.approved_status)}`));
        lines.push('');
    }
    if (sections.notes !== undefined) {
        lines.push('Notes');
        lines.push(displayValue(sections.notes));
        lines.push('');
    }
    const unavailable = Array.isArray(content.unavailable_fields) ? content.unavailable_fields : [];
    if (unavailable.length) {
        lines.push('Unavailable values');
        lines.push(unavailable.map(displayValue).join(', '));
    }
    return lines;
};
/**
 * Produce a small self-contained PDF without persisting a derivative file.
 * The content model is deliberately text based so long notes and sparse records
 * remain deterministic and can flow over multiple pages.
 */
const renderTdsPdf = (content, document, revision) => {
    const lines = contentLines(content, document, revision).flatMap(line => {
        if (line.length <= 105)
            return [line];
        const wrapped = [];
        let remaining = line;
        while (remaining.length > 105) {
            let splitAt = remaining.lastIndexOf(' ', 105);
            if (splitAt < 40)
                splitAt = 105;
            wrapped.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trimStart();
        }
        wrapped.push(remaining);
        return wrapped;
    });
    const linesPerPage = fiftyLinesPerPage;
    const pages = [];
    for (let index = 0; index < lines.length; index += linesPerPage) {
        pages.push(lines.slice(index, index + linesPerPage));
    }
    if (!pages.length)
        pages.push(['Technical Data Sheet']);
    const objects = [];
    const catalogId = addObject(objects, '');
    const pagesId = addObject(objects, '');
    const fontId = addObject(objects, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];
    pages.forEach((pageLines, pageIndex) => {
        const commands = [
            'BT',
            '/F1 10 Tf',
            '50 790 Td',
            ...pageLines.flatMap((line, lineIndex) => [
                lineIndex === 0 ? '/F1 16 Tf' : '/F1 10 Tf',
                `(${safePdfText(line)}) Tj`,
                '0 -15 Td',
            ]),
            'ET',
        ].join('\n');
        const streamId = addObject(objects, `<< /Length ${Buffer.byteLength(commands, 'ascii')} >>\nstream\n${commands}\nendstream`);
        const pageId = addObject(objects, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
        pageIds.push(pageId);
        if (pageIndex < pages.length - 1) {
            // Keep page objects in a stable order; pageIndex is intentionally consumed.
        }
    });
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets[index + 1] = Buffer.byteLength(pdf, 'binary');
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, 'binary');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'binary');
};
exports.renderTdsPdf = renderTdsPdf;
// Kept as a named constant to make pagination behavior easy to audit.
const fiftyLinesPerPage = 50;
