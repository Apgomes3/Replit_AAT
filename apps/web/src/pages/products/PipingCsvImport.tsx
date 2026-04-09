import { useState, useRef } from 'react';
import Papa from 'papaparse';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Upload, Download, X, CheckCircle, AlertCircle, Link2 } from 'lucide-react';
import Button from '../../components/ui/Button';

const EXPECTED_COLUMNS = ['product_code', 'product_name', 'application_type', 'primary_material_code', 'family_code', 'dn_size', 'pressure_rating', 'standard_status', 'notes'];

const CSV_TEMPLATE = [
  EXPECTED_COLUMNS.join(','),
  'PM-FIT-SS-001,90 Degree Elbow DN50,Fitting,SS316,PF-PIPE-SS,50,PN16,Active,',
  'PM-FIT-SS-002,Tee DN50,Fitting,SS316,PF-PIPE-SS,50,PN16,Active,',
  'PM-VAL-SS-001,Gate Valve DN50,Valve,SS316,PF-VALVE-SS,50,PN16,Active,',
  'PM-PIPE-SS-001,Pipe 3m DN50,Pipe,SS316,PF-PIPE-SS,50,SCH40,Active,',
].join('\n');

type ParsedRow = {
  product_code: string;
  product_name: string;
  application_type?: string;
  primary_material_code?: string;
  family_code?: string;
  dn_size?: string;
  pressure_rating?: string;
  standard_status?: string;
  notes?: string;
  _valid: boolean;
  _error?: string;
};

type ImportResult = {
  created: number;
  linked: number;
  errors: Array<{ code: string; message: string }>;
  created_codes: string[];
  linked_codes: string[];
};

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export default function PipingCsvImport({ onClose, onImported }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'piping_fittings_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed: ParsedRow[] = (results.data as any[]).map((row, i) => {
          const code = (row.product_code || '').trim();
          const name = (row.product_name || '').trim();
          const valid = !!code && !!name;
          return {
            product_code: code,
            product_name: name,
            application_type: (row.application_type || '').trim() || undefined,
            primary_material_code: (row.primary_material_code || '').trim() || undefined,
            family_code: (row.family_code || '').trim() || undefined,
            dn_size: (row.dn_size || '').trim() || undefined,
            pressure_rating: (row.pressure_rating || '').trim() || undefined,
            standard_status: (row.standard_status || '').trim() || undefined,
            notes: (row.notes || '').trim() || undefined,
            _valid: valid,
            _error: !code ? 'Missing product_code' : !name ? 'Missing product_name' : undefined,
          };
        });
        setRows(parsed);
        setResult(null);
      },
      error: () => toast.error('Failed to parse CSV file'),
    });
  };

  const handleImport = async () => {
    const validRows = rows.filter(r => r._valid);
    if (!validRows.length) return;
    setImporting(true);
    try {
      const res = await api.post('/product-masters/bulk-import', {
        rows: validRows.map(({ _valid, _error, ...r }) => r),
      });
      setResult(res.data);
      onImported();
      toast.success(`Import complete: ${res.data.created} created, ${res.data.linked} linked to existing`);
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const validCount = rows.filter(r => r._valid).length;
  const errorCount = rows.filter(r => !r._valid).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-800">Import Piping Fittings from CSV</h2>
            <p className="text-sm text-slate-500 mt-0.5">Items will be created in the Shark OS and linked by product code</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {!rows.length && !result && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center cursor-pointer hover:border-amber-600/40 hover:bg-slate-50 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              >
                <Upload className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <div className="text-sm font-medium text-slate-600">Drop your CSV file here or click to browse</div>
                <div className="text-xs text-slate-400 mt-1">Supports .csv files with headers</div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Expected columns</div>
                <div className="flex flex-wrap gap-1.5">
                  {EXPECTED_COLUMNS.map(col => (
                    <span key={col} className={`text-xs px-2 py-0.5 rounded font-mono ${col === 'product_code' || col === 'product_name' ? 'bg-amber-600/10 text-amber-600 font-semibold' : 'bg-slate-200 text-slate-600'}`}>
                      {col}{(col === 'product_code' || col === 'product_name') ? ' *' : ''}
                    </span>
                  ))}
                </div>
                <button onClick={downloadTemplate} className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 hover:underline">
                  <Download className="w-3.5 h-3.5" /> Download template CSV
                </button>
              </div>
            </div>
          )}

          {rows.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">{rows.length} rows parsed</span>
                  {validCount > 0 && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle className="w-3.5 h-3.5" />{validCount} valid</span>}
                  {errorCount > 0 && <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle className="w-3.5 h-3.5" />{errorCount} errors</span>}
                </div>
                <button onClick={() => { setRows([]); if (fileRef.current) fileRef.current.value = ''; }}
                  className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium"></th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Code</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Name</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Type</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Material</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">DN</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Rating</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Family</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, i) => (
                      <tr key={i} className={row._valid ? '' : 'bg-red-50'}>
                        <td className="px-3 py-1.5">
                          {row._valid
                            ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                            : <AlertCircle className="w-3.5 h-3.5 text-red-400" title={row._error} />}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-700">{row.product_code || <span className="text-red-400 italic">missing</span>}</td>
                        <td className="px-3 py-1.5 text-slate-700">{row.product_name || <span className="text-red-400 italic">missing</span>}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.application_type || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.primary_material_code || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.dn_size || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.pressure_rating || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.family_code || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.standard_status || 'Active'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-emerald-700">{result.created}</div>
                  <div className="text-sm text-emerald-600 mt-1">New items created</div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-700">{result.linked}</div>
                  <div className="text-sm text-blue-600 mt-1">Linked to existing</div>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-red-700">{result.errors.length}</div>
                  <div className="text-sm text-red-600 mt-1">Errors</div>
                </div>
              </div>

              {result.linked_codes.length > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 mb-2"><Link2 className="w-3.5 h-3.5" />Linked to existing library items</div>
                  <div className="flex flex-wrap gap-1">
                    {result.linked_codes.map(c => <span key={c} className="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{c}</span>)}
                  </div>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-lg p-4">
                  <div className="text-xs font-medium text-red-700 mb-2">Import errors</div>
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-600"><span className="font-mono">{e.code}</span>: {e.message}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <Download className="w-4 h-4" /> Template
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {rows.length > 0 && !result && (
              <Button variant="primary" onClick={handleImport} disabled={importing || validCount === 0}>
                {importing ? 'Importing…' : `Import ${validCount} item${validCount !== 1 ? 's' : ''}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
