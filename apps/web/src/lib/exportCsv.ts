export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string;
}

export function exportCsv<T>(filename: string, columns: CsvColumn<T>[], data: T[]) {
  if (data.length === 0) return;
  const escape = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const headerRow = columns.map(c => escape(c.header)).join(',');
  const dataRows = data.map(row => columns.map(c => escape(c.value(row))).join(','));
  const csv = '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function csvDate(iso?: string | null) {
  if (!iso) return '';
  return iso.includes('T') ? iso.split('T')[0] : iso;
}
