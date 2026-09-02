import { useState, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Upload, CheckCircle, AlertCircle, FileText } from 'lucide-react';

type ImportType = 'products' | 'equipment' | 'documents' | 'components';

interface ImportResult { imported: number; skipped: number; errors: string[]; total: number; }

const COMPONENT_FIELDS = [
  { key: 'component_code', label: 'component_code', required: true },
  { key: 'component_name', label: 'component_name', required: true },
  { key: 'component_type', label: 'component_type', required: false },
  { key: 'component_category', label: 'component_category', required: false },
  { key: 'description', label: 'description', required: false },
  { key: 'primary_material_code', label: 'primary_material_code', required: false },
  { key: 'standard_size', label: 'standard_size', required: false },
  { key: 'weight_kg', label: 'weight_kg', required: false },
  { key: 'unit', label: 'unit', required: false },
  { key: 'status', label: 'status', required: false },
  { key: 'notes', label: 'notes', required: false },
  { key: 'synonyms', label: 'synonyms', required: false },
  { key: 'cost', label: 'cost', required: false },
  { key: 'sell_price', label: 'sell_price', required: false },
  { key: 'manufacturer', label: 'manufacturer', required: false },
  { key: 'model', label: 'model', required: false },
] as const;

const COMPONENT_EXAMPLES: Record<string, string> = {
  component_code: 'CMP-VALVE-001',
  component_name: 'Butterfly Valve',
  component_type: 'Valve',
  component_category: 'Mechanical',
  description: 'Example component',
  primary_material_code: 'MAT-SS316',
  standard_size: 'DN100',
  weight_kg: '12.5',
  unit: 'EA',
  status: 'Active',
  notes: 'Example notes',
  synonyms: 'BFV; isolation valve',
  cost: '125.00',
  sell_price: '175.00',
  manufacturer: 'Example Manufacturer',
  model: 'BV-100',
};

const templates: Record<'products' | 'equipment' | 'documents', { headers: string[]; example: string[] }> = {
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
  const [selectedComponentFields, setSelectedComponentFields] = useState<string[]>(
    COMPONENT_FIELDS.map(field => field.key),
  );
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    const form = new FormData();
    form.append('file', file);
    if (type === 'components') {
      form.append('fields', JSON.stringify(selectedComponentFields));
    }
    try {
      const res = await api.post(`/import/${type}`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(res.data);
      toast.success(`Imported ${res.data.imported} records`);
    } catch (err: any) {
      const responseData = err.response?.data;
      if (responseData && typeof responseData.imported === 'number') {
        setResult({
          imported: responseData.imported,
          skipped: responseData.skipped || 0,
          errors: responseData.errors || responseData.error?.details || [responseData.error?.message || 'Import failed'],
          total: responseData.total || 0,
        });
      }
      toast.error(responseData?.error?.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const componentHeaders = selectedComponentFields;

  const downloadTemplate = () => {
    const t = type === 'components'
      ? {
        headers: componentHeaders,
        example: componentHeaders.map(header => COMPONENT_EXAMPLES[header] || ''),
      }
      : templates[type];
    const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const csv = [t.headers.map(csvCell).join(','), t.example.map(csvCell).join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `template_${type}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const toggleComponentField = (field: string) => {
    if (COMPONENT_FIELDS.find(item => item.key === field)?.required) return;
    setSelectedComponentFields(current => current.includes(field)
      ? current.filter(item => item !== field)
      : [...current, field]);
  };

  const selectAllComponentFields = () => {
    setSelectedComponentFields(COMPONENT_FIELDS.map(field => field.key));
  };

  const resetComponentFields = () => {
    setSelectedComponentFields(COMPONENT_FIELDS.filter(field => field.required).map(field => field.key));
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="CSV Import" subtitle="Bulk load engineering data from CSV files" />
      <div className="flex-1 p-6 max-w-2xl">
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div>
            <label className="text-xs text-slate-500 uppercase tracking-wide block mb-2">Import Type</label>
            <div className="flex gap-2">
              {(['products', 'equipment', 'documents', 'components'] as ImportType[]).map(t => (
                <button key={t} onClick={() => { setType(t); setFile(null); setResult(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className={`px-3 py-1.5 text-sm rounded capitalize border transition-colors ${type === t ? 'bg-blue-600 text-white border-blue-600' : 'text-slate-600 border-slate-300 hover:border-slate-400'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
               <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                 {type === 'components' ? 'Selected CSV Columns' : 'Required CSV Columns'}
               </span>
              <button onClick={downloadTemplate} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><FileText className="w-3 h-3" />Download Template</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
               {(type === 'components' ? componentHeaders : templates[type].headers).map(h => (
                <span key={h} className="font-mono text-xs bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">{h}</span>
              ))}
            </div>
          </div>

           {type === 'components' && (
             <div className="border border-slate-200 rounded-lg p-4 space-y-3">
               <div className="flex items-start justify-between gap-4">
                 <div>
                   <div className="text-xs font-medium text-slate-600 uppercase tracking-wide">Component fields</div>
                   <p className="text-xs text-slate-500 mt-1">
                     Required fields are always included. Choose optional columns to include in the template and import.
                   </p>
                 </div>
                 <div className="flex gap-2 shrink-0">
                   <button type="button" onClick={selectAllComponentFields} className="text-xs text-blue-600 hover:underline">Select all</button>
                   <button type="button" onClick={resetComponentFields} className="text-xs text-slate-500 hover:underline">Reset optional</button>
                 </div>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                 {COMPONENT_FIELDS.map(field => (
                   <label key={field.key} className={`flex items-center gap-2 text-sm ${field.required ? 'text-slate-800' : 'text-slate-600'}`}>
                     <input
                       type="checkbox"
                       checked={selectedComponentFields.includes(field.key)}
                       disabled={field.required}
                       onChange={() => toggleComponentField(field.key)}
                       aria-label={field.key}
                       className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                     />
                     <span className="font-mono text-xs">{field.label}</span>
                     {field.required && <span className="text-[10px] uppercase tracking-wide text-slate-400">required</span>}
                   </label>
                 ))}
               </div>
               <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                 Use semicolons to separate multiple <span className="font-mono">synonyms</span> (for example, <span className="font-mono">BFV; isolation valve</span>).
                 Use the exact <span className="font-mono">material_code</span> from the Materials library for <span className="font-mono">primary_material_code</span>.
                 Blank optional values use the same defaults as creating a component.
               </p>
             </div>
           )}

          <div>
             <label htmlFor="csv-import-file" className="text-xs text-slate-500 uppercase tracking-wide block mb-2">CSV File</label>
             <input id="csv-import-file" ref={fileRef} type="file" accept=".csv" onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); }}
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
                <div className="text-center"><div className="text-2xl font-bold text-blue-500">{result.skipped}</div><div className="text-xs text-slate-500">Skipped</div></div>
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
