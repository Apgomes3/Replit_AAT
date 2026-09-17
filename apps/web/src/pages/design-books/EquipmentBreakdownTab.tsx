import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Plus, Trash2, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getLssSystems } from './ControlFieldInstrumentsTab';

type Props = { book: any; readOnly: boolean };
const editable = ['description','quantity','unit','supplier','manufacturer','model','unit_cost','markup','selling_price','currency','lead_time','exclusions','notes'];

function Field({ value, type = 'text', onChange, onCommit, disabled, saving }: { value: any; type?: string; onChange: (value: string) => void; onCommit: () => void; disabled: boolean; saving: boolean }) {
  return <div className="relative"><input type={type} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value)}
    onBlur={onCommit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
    className="min-w-[90px] w-full rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 disabled:bg-stone-50 disabled:text-stone-500" />
    {saving && <span className="absolute right-1 top-1 text-[9px] text-blue-500">Saving…</span>}</div>;
}

export default function EquipmentBreakdownTab({ book, readOnly }: Props) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const autoInitialized = useRef(false);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ system_id: '', description: '', quantity: '1', unit: 'EA', currency: 'USD' });
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['design-book-equipment-breakdown', book.id],
    queryFn: () => api.get(`/design-books/${book.id}/equipment-breakdown`).then(response => response.data),
  });
  const items: any[] = data?.items || [];
  useEffect(() => {
    if (!data || data.initialized !== false || readOnly || autoInitialized.current) return;
    autoInitialized.current = true;
    void refresh();
  }, [data, readOnly]);
  const systems = getLssSystems(book.systems || []);
  const grouped = useMemo(() => systems.map(system => ({ system, rows: items.filter(row => row.system_id === system.id) })), [systems, items]);
  const update = async (row: any, field: string, value: string) => {
    setSaving(`${row.id}:${field}`);
    try {
      const numeric = ['quantity','unit_cost','markup','selling_price'].includes(field);
      await api.put(`/design-books/${book.id}/equipment-breakdown/lines/${row.id}`, { [field]: numeric && value === '' ? null : numeric ? Number(value) : value });
      qc.invalidateQueries({ queryKey: ['design-book-equipment-breakdown', book.id] });
    } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not save breakdown line'); }
    finally { setSaving(null); }
  };
  const refresh = async () => { try { await api.post(`/design-books/${book.id}/equipment-breakdown/refresh`); await refetch(); toast.success('Equipment schedule refreshed'); } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not refresh equipment selections'); } };
  const exportXlsx = async () => {
    try {
      const response = await api.get(`/design-books/${book.id}/equipment-breakdown/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'design-book-equipment-breakdown.xlsx'; anchor.click(); URL.revokeObjectURL(url);
    } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not export equipment schedule'); }
  };
  const addManual = async () => {
    if (!manual.description.trim()) return toast.error('Description is required');
    try {
      await api.post(`/design-books/${book.id}/equipment-breakdown/lines`, { ...manual, quantity: Number(manual.quantity) || 1 });
      setManual({ system_id: '', description: '', quantity: '1', unit: 'EA', currency: 'USD' }); setShowManual(false); await refetch(); toast.success('Proposal line added');
    } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not add proposal line'); }
  };
  const removeManual = async (row: any) => { try { await api.delete(`/design-books/${book.id}/equipment-breakdown/lines/${row.id}`); await refetch(); toast.success('Proposal line removed'); } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not remove proposal line'); } };
  const table = (rows: any[]) => <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
    <table className="min-w-[1500px] w-full text-xs">
      <thead className="bg-stone-50 text-left uppercase tracking-wide text-stone-500"><tr>
        {['Source','Description','Qty','Unit','Supplier','Manufacturer','Model','Cost','Markup %','Sell Price','Currency','Lead time','Exclusions','Notes',''].map(label => <th key={label} className="px-2 py-2 font-semibold">{label}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-stone-100">{rows.map(row => <tr key={row.id} className="align-top hover:bg-blue-50/20">
        <td className="px-2 py-2 text-stone-500 whitespace-nowrap">{row.source_kind}{row.source_kind === 'manual' && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700">manual</span>}</td>
        {editable.map(field => {
          const type = ['quantity','unit_cost','markup','selling_price'].includes(field) ? 'number' : 'text';
          const key = `${row.id}:${field}`;
          const value = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : row[field];
          return <td key={field} className="min-w-[100px] px-1 py-1"><Field value={value} type={type} disabled={readOnly} saving={saving === key}
            onChange={next => setDrafts(current => ({ ...current, [key]: next }))}
            onCommit={() => {
              if (!Object.prototype.hasOwnProperty.call(drafts, key) || String(drafts[key]) === String(row[field] ?? '')) return;
              const next = drafts[key]; setDrafts(current => { const copy = { ...current }; delete copy[key]; return copy; }); update(row, field, next);
            }} /></td>;
        })}
        <td className="px-2 py-2">{!readOnly && row.source_kind === 'manual' && <button type="button" title="Remove line" onClick={() => removeManual(row)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-5">
      <div className="flex items-start gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-blue-600" /><div><h2 className="font-semibold text-stone-900">Equipment Breakdown</h2><p className="mt-1 max-w-2xl text-sm text-stone-600">Proposal and procurement schedule linked to the current LSS selections. Commercial edits never change engineering selections and remain editable after release.</p></div></div>
      <div className="flex gap-2"><button type="button" onClick={refresh} disabled={readOnly} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Refresh selections</button><button type="button" onClick={exportXlsx} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Download className="h-4 w-4" /> Export Excel</button></div>
    </div>
    {!readOnly && <div className="flex justify-end"><button type="button" onClick={() => setShowManual(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800"><Plus className="h-4 w-4" /> Add proposal line</button></div>}
    {showManual && <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 md:grid-cols-6">
      <select value={manual.system_id} onChange={event => setManual({ ...manual, system_id: event.target.value })} className="rounded-lg border border-stone-200 bg-white px-2 py-2 text-sm"><option value="">Unassigned</option>{systems.map(system => <option key={system.id} value={system.id}>{system.system_code} — {system.system_name}</option>)}</select>
      <input value={manual.description} onChange={event => setManual({ ...manual, description: event.target.value })} placeholder="Description *" className="rounded-lg border border-stone-200 px-2 py-2 text-sm md:col-span-2" /><input type="number" value={manual.quantity} onChange={event => setManual({ ...manual, quantity: event.target.value })} className="rounded-lg border border-stone-200 px-2 py-2 text-sm" /><input value={manual.unit} onChange={event => setManual({ ...manual, unit: event.target.value })} placeholder="Unit" className="rounded-lg border border-stone-200 px-2 py-2 text-sm" /><button type="button" onClick={addManual} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white">Add</button>
    </div>}
    {isLoading ? <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-400">Loading equipment schedule…</div> : data?.initialized === false && readOnly ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-10 text-center text-sm text-amber-800">This equipment schedule has not been initialized. A Design Book manager must initialize it before it can be viewed.</div> : !systems.length ? <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-500">No Life Support Systems found.</div> :
      grouped.map(({ system, rows }) => <section key={system.id} className="space-y-2"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-stone-800">{system.system_code} — {system.system_name}</h3><p className="text-xs text-stone-500">{rows.length} proposal line{rows.length === 1 ? '' : 's'}</p></div></div>{table(rows)}</section>)}
    {items.some(row => !row.system_id) && <section className="space-y-2"><h3 className="font-semibold text-stone-800">Unassigned proposal lines</h3>{table(items.filter(row => !row.system_id))}</section>}
  </div>;
}