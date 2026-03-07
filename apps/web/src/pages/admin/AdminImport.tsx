import { useState, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Upload, CheckCircle, AlertCircle, FileText } from 'lucide-react';

type ImportType = 'products' | 'equipment' | 'documents';

interface ImportResult { imported: number; skipped: number; errors: string[]; total: number; }

const templates: Record<ImportType, { headers: string[]; example: string[] }> = {
  products: {
    headers: ['product_code', 'product_name', 'product_family_code', 'product_category', 'application_type', 'design_flow_m3h', 'power_kw', 'primary_material_code', 'standard_status'],
    example: ['PM-PUMP-NEW-001', 'New Pump Type', 'PFM-PUMP', 'Pumping', 'LSS Primary', '800', '15', 'MAT-SS316', 'Concept'],
  },
  equipment: {
    headers: ['equipment_code', 'project_code', 'system_code', 'equipment_type', 'equipment_name', 'design_flow_m3h', 'power_kw', 'material_code'],
    example: ['EQI-TY-NEW-01', 'PRJ-TY-001', 'SYS-LSS-SHARK-01', 'Filter', 'New Filter Unit', '500', '2.5', 'MAT-SS316'],
  },
  documents: {
    headers: ['document_code', 'document_title', 'document_type', 'discipline', 'project_code'],
    example: ['DOC-PID-NEW-01', 'New P&ID Drawing', 'PID', 'Mechanical', 'PRJ-TY-001'],
  },
};

export default function AdminImport() {
  const [type, setType] = useState<ImportType>('products');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.post(`/import/${type}`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(res.data);
      toast.success(`Imported ${res.data.imported} records`);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const t = templates[type];
    const csv = [t.headers.join(','), t.example.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `template_${type}.csv`; a.click();
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="CSV Import" subtitle="Bulk load engineering data from CSV files" />
      <div className="flex-1 p-6 max-w-2xl">
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div>
            <label className="text-xs text-slate-500 uppercase tracking-wide block mb-2">Import Type</label>
            <div className="flex gap-2">
              {(['products', 'equipment', 'documents'] as ImportType[]).map(t => (
                <button key={t} onClick={() => { setType(t); setFile(null); setResult(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className={`px-3 py-1.5 text-sm rounded capitalize border transition-colors ${type === t ? 'bg-[#3E5C76] text-white border-[#3E5C76]' : 'text-slate-600 border-slate-300 hover:border-slate-400'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">Required CSV Columns</span>
              <button onClick={downloadTemplate} className="text-xs text-[#3E5C76] hover:underline flex items-center gap-1"><FileText className="w-3 h-3" />Download Template</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {templates[type].headers.map(h => (
                <span key={h} className="font-mono text-xs bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">{h}</span>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 uppercase tracking-wide block mb-2">CSV File</label>
            <input ref={fileRef} type="file" accept=".csv" onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); }}
              className="w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-slate-300 file:text-xs file:font-medium file:bg-white file:text-slate-700 hover:file:bg-slate-50" />
          </div>

          <div className="flex gap-2">
            <Button variant="primary" onClick={handleImport} disabled={!file || loading}>
              <Upload className="w-4 h-4" />{loading ? 'Importing...' : `Import ${type}`}
            </Button>
          </div>

          {result && (
            <div className="border border-slate-200 rounded-lg p-4">
              <div className="font-medium text-slate-700 mb-3">Import Results</div>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div className="text-center"><div className="text-2xl font-bold text-green-600">{result.imported}</div><div className="text-xs text-slate-500">Imported</div></div>
                <div className="text-center"><div className="text-2xl font-bold text-amber-500">{result.skipped}</div><div className="text-xs text-slate-500">Skipped</div></div>
                <div className="text-center"><div className="text-2xl font-bold text-slate-400">{result.total}</div><div className="text-xs text-slate-500">Total</div></div>
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />{e}
                    </div>
                  ))}
                </div>
              )}
              {result.errors.length === 0 && <div className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle className="w-3.5 h-3.5" />All records processed successfully</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
