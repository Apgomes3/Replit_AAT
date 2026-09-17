import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3, Download, GripVertical, RefreshCw, Plus, Trash2, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getLssSystems } from './ControlFieldInstrumentsTab';

type Props = { book: any; readOnly: boolean };
const editable = ['description','quantity','unit','supplier','manufacturer','model','unit_cost','markup','currency','lead_time','exclusions','notes'];
const columns = [
  { key: 'source_kind', label: 'Source' },
  { key: 'description', label: 'Description' },
  { key: 'quantity', label: 'Qty' },
  { key: 'unit', label: 'Unit' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'unit_cost', label: 'Cost' },
  { key: 'markup', label: 'Markup %' },
  { key: 'selling_price', label: 'Sell Price' },
  { key: 'total_price', label: 'Total Price' },
  { key: 'currency', label: 'Currency' },
  { key: 'lead_time', label: 'Lead time' },
  { key: 'exclusions', label: 'Exclusions' },
  { key: 'notes', label: 'Notes' },
];
const currencies = [
  { value: 'USD', label: 'USD' }, { value: 'CNY', label: 'RMB' }, { value: 'AUD', label: 'AUD' },
  { value: 'NZD', label: 'NZD' }, { value: 'EUR', label: 'EUR' },
];

export function reorderEquipmentRows(rows: any[], draggedId: string, boundaryIndex: number) {
  const fromIndex = rows.findIndex(row => row.id === draggedId);
  if (fromIndex < 0) return rows;
  const ordered = rows.filter(row => row.id !== draggedId);
  const insertionIndex = Math.max(0, Math.min(ordered.length, boundaryIndex - (fromIndex < boundaryIndex ? 1 : 0)));
  ordered.splice(insertionIndex, 0, rows[fromIndex]);
  return ordered;
}

function calculateDraftPricing(row: any, drafts: Record<string, string>) {
  const value = (field: string) => {
    const key = `${row.id}:${field}`;
    return Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : row[field];
  };
  const numeric = (field: string) => value(field) === '' || value(field) == null ? null : Number(value(field));
  const cost = numeric('unit_cost');
  const markup = numeric('markup');
  const quantity = numeric('quantity');
  const sellingPrice = cost != null && Number.isFinite(cost) && markup != null && Number.isFinite(markup)
    ? Math.round((cost * (1 + markup / 100) + Number.EPSILON) * 100) / 100
    : null;
  const totalPrice = sellingPrice != null && quantity != null && Number.isFinite(quantity)
    ? Math.round((sellingPrice * quantity + Number.EPSILON) * 100) / 100
    : null;
  return { selling_price: sellingPrice, total_price: totalPrice };
}

function Field({ value, type = 'text', onChange, onCommit, disabled, saving, contentWidth = false }: { value: any; type?: string; onChange: (value: string) => void; onCommit: () => void; disabled: boolean; saving: boolean; contentWidth?: boolean }) {
  return <div className="relative"><input type={type} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value)}
    onBlur={onCommit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
    style={contentWidth ? { width: `${Math.min(28, Math.max(9, String(value ?? '').length + 3))}ch` } : undefined}
    className={`${contentWidth ? 'min-w-[72px] max-w-[224px]' : 'min-w-[90px] w-full'} rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 disabled:bg-stone-50 disabled:text-stone-500`} />
    {saving && <span className="absolute right-1 top-1 text-[9px] text-blue-500">Saving…</span>}</div>;
}

export default function EquipmentBreakdownTab({ book, readOnly }: Props) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const autoInitialized = useRef(false);
  const [showManual, setShowManual] = useState(false);
  const [manualInsertAt, setManualInsertAt] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [insertCursor, setInsertCursor] = useState<{ systemId: string; index: number; x: number } | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [manual, setManual] = useState({ system_id: '', description: '', quantity: '1', unit: 'EA', currency: 'USD' });
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['design-book-equipment-breakdown', book.id],
    queryFn: () => api.get(`/design-books/${book.id}/equipment-breakdown`).then(response => response.data),
  });
  const items: any[] = data?.items || [];
  const hiddenColumns: string[] = data?.hidden_columns || [];
  const hidden = new Set(hiddenColumns);
  useEffect(() => {
    if (!data || data.initialized !== false || readOnly || autoInitialized.current) return;
    autoInitialized.current = true;
    void refresh();
  }, [data, readOnly]);
  const systems = getLssSystems(book.systems || []);
  const grouped = useMemo(() => systems.map(system => ({ system, rows: items.filter(row => row.system_id === system.id) })), [systems, items]);
  const update = async (row: any, field: string, value: string) => {
    setSaving(`${row.id}:${field}`);
    const numeric = ['quantity','unit_cost','markup'].includes(field);
    const nextValue = numeric && value === '' ? null : numeric ? Number(value) : value;
    const queryKey = ['design-book-equipment-breakdown', book.id];
    const previous = qc.getQueryData(queryKey);
    qc.setQueryData(queryKey, (current: any) => current ? {
      ...current,
      items: (current.items || []).map((item: any) => item.id === row.id ? { ...item, [field]: nextValue } : item),
    } : current);
    try {
      const response = await api.put(`/design-books/${book.id}/equipment-breakdown/lines/${row.id}`, { [field]: nextValue });
      qc.setQueryData(queryKey, (current: any) => current ? {
        ...current,
        items: (current.items || []).map((item: any) => item.id === row.id ? { ...item, ...response.data } : item),
      } : current);
      await qc.invalidateQueries({ queryKey });
    } catch (error: any) {
      qc.setQueryData(queryKey, previous);
      toast.error(error?.response?.data?.error?.message || 'Could not save breakdown line');
    }
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
      await api.post(`/design-books/${book.id}/equipment-breakdown/lines`, { ...manual, quantity: Number(manual.quantity) || 1, insert_at: manualInsertAt });
      setManual({ system_id: '', description: '', quantity: '1', unit: 'EA', currency: 'USD' }); setShowManual(false); setManualInsertAt(null); await refetch(); toast.success('Proposal line added');
    } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not add proposal line'); }
  };
  const removeManual = async (row: any) => { try { await api.delete(`/design-books/${book.id}/equipment-breakdown/lines/${row.id}`); await refetch(); toast.success('Proposal line removed'); } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not remove proposal line'); } };
  const setColumnVisible = async (key: string, visible: boolean) => {
    const next = visible ? hiddenColumns.filter(column => column !== key) : [...hiddenColumns, key];
    try {
      await api.put(`/design-books/${book.id}/equipment-breakdown/columns`, { hidden_columns: next });
      await refetch();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Could not save column visibility');
    }
  };
  const reorderRows = async (rows: any[], draggedId: string, boundaryIndex: number) => {
    const ordered = reorderEquipmentRows(rows, draggedId, boundaryIndex);
    if (ordered.every((row, index) => row.id === rows[index]?.id)) return;
    const ids = ordered.map(row => row.id);
    const queryKey = ['design-book-equipment-breakdown', book.id];
    const previous = qc.getQueryData(queryKey);
    qc.setQueryData(queryKey, (current: any) => {
      if (!current) return current;
      let position = 0;
      return {
        ...current,
        items: (current.items || []).map((item: any) =>
          item.system_id === rows[0]?.system_id ? { ...ordered[position++], sort_order: position - 1 } : item),
      };
    });
    try {
      await api.put(`/design-books/${book.id}/equipment-breakdown/order`, {
        system_id: rows[0]?.system_id || null,
        line_ids: ids,
      });
    } catch (error: any) {
      qc.setQueryData(queryKey, previous);
      toast.error(error?.response?.data?.error?.message || 'Could not reorder breakdown lines');
    }
  };
  const table = (rows: any[], targetSystemId = '') => {
    const addingHere = showManual && manual.system_id === targetSystemId;
    const visibleColumnCount = columns.filter(column => !hidden.has(column.key)).length + 1;
    const openManualAt = (index: number) => {
      setManual({ system_id: targetSystemId, description: '', quantity: '1', unit: 'EA', currency: 'USD' });
      setManualInsertAt(index);
      setShowManual(true);
    };
    const insertControl = (index: number) => <Fragment key={`insert-${index}`}>
      <tr className="group/insert h-2">
        <td colSpan={visibleColumnCount} className="relative h-2 p-0"
          onMouseMove={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setInsertCursor({ systemId: targetSystemId, index, x: event.clientX - rect.left });
          }}
          onMouseLeave={() => setInsertCursor(current => current?.systemId === targetSystemId && current.index === index ? null : current)}>
          {!readOnly && !addingHere && <button type="button" aria-label={`Add proposal line at position ${index + 1}`} onClick={() => openManualAt(index)}
            style={insertCursor?.systemId === targetSystemId && insertCursor.index === index ? { left: insertCursor.x } : undefined}
            className="absolute top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-blue-300 bg-white text-blue-600 opacity-0 shadow-sm transition-opacity hover:bg-blue-50 group-hover/insert:opacity-100 focus:opacity-100">
            <Plus className="h-3.5 w-3.5" />
          </button>}
        </td>
      </tr>
      {addingHere && manualInsertAt === index && <tr className="bg-amber-50/60"><td colSpan={visibleColumnCount} className="px-3 py-2">
        <div className="flex min-w-[720px] items-center gap-2">
          <input autoFocus value={manual.description} onChange={event => setManual({ ...manual, description: event.target.value })} placeholder="Proposal line description *" aria-label="Proposal line description" className="min-w-[320px] flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"/>
          <input type="number" min="0.01" step="any" value={manual.quantity} onChange={event => setManual({ ...manual, quantity: event.target.value })} aria-label="Proposal line quantity" className="w-20 rounded-lg border border-amber-200 bg-white px-2 py-2 text-sm"/>
          <input value={manual.unit} onChange={event => setManual({ ...manual, unit: event.target.value })} placeholder="Unit" aria-label="Proposal line unit" className="w-16 rounded-lg border border-amber-200 bg-white px-2 py-2 text-sm"/>
          <button type="button" onClick={addManual} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white">Add line</button>
          <button type="button" onClick={() => { setShowManual(false); setManualInsertAt(null); setManual({ system_id: '', description: '', quantity: '1', unit: 'EA', currency: 'USD' }); }} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600">Cancel</button>
        </div>
      </td></tr>}
    </Fragment>;
    return <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
    <table className="min-w-[1500px] w-full text-xs">
      <thead className="bg-stone-50 text-left uppercase tracking-wide text-stone-500"><tr>
        {columns.filter(column => !hidden.has(column.key)).map(column => <th key={column.key} className={`px-2 py-2 font-semibold ${column.key === 'quantity' ? 'w-12' : column.key === 'unit' ? 'w-14' : ['markup','currency'].includes(column.key) ? 'w-20' : ['supplier','model','unit_cost'].includes(column.key) ? 'w-px whitespace-nowrap' : ''}`}>{column.label}</th>)}<th className="w-12 px-2 py-2 font-semibold" />
      </tr></thead>
      <tbody>{rows.map((row, rowIndex) => <Fragment key={row.id}>{insertControl(rowIndex)}<tr
        onDragOver={event => { if (!readOnly && draggingId) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setDragOverIndex(rowIndex + (event.clientY > rect.top + rect.height / 2 ? 1 : 0)); } }}
        onDrop={event => {
          event.preventDefault();
          const draggedId = draggingIdRef.current || draggingId || event.dataTransfer.getData('text/plain');
          const rect = event.currentTarget.getBoundingClientRect();
          const boundaryIndex = rowIndex + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
          if (draggedId) void reorderRows(rows, draggedId, boundaryIndex);
          draggingIdRef.current = null;
          setDraggingId(null);
          setDragOverIndex(null);
        }}
        className={`align-top border-t border-stone-100 hover:bg-blue-50/20 ${dragOverIndex === rowIndex ? 'border-t-2 border-t-blue-500' : ''}`}>
        {!hidden.has('source_kind') && <td className="px-2 py-2 text-stone-500 whitespace-nowrap">{row.source_kind}{row.source_kind === 'manual' && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700">manual</span>}</td>}
        {columns.filter(column => column.key !== 'source_kind' && !hidden.has(column.key)).map(({ key: field }) => {
          const key = `${row.id}:${field}`;
          const value = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : row[field];
          if (field === 'selling_price' || field === 'total_price') {
            const calculated = calculateDraftPricing(row, drafts)[field];
            return <td key={field} className="min-w-[100px] px-2 py-2 text-stone-700" data-testid={`${field}-${row.id}`}>
              {calculated == null ? '' : calculated.toFixed(2)}
            </td>;
          }
          if (field === 'currency') {
             return <td key={field} className="w-20 min-w-[72px] px-1 py-1"><select value={normalizeCurrencyValue(value)}
              disabled={readOnly || saving === key || row.unit_cost == null} title={row.unit_cost == null ? 'Enter a Unit Cost before changing currency' : 'Currency'}
              onChange={event => void update(row, field, event.target.value)}
              className="w-full rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 disabled:bg-stone-50">
              {currencies.map(currency => <option key={currency.value} value={currency.value}>{currency.label}</option>)}
            </select></td>;
          }
          const type = ['quantity','unit_cost','markup'].includes(field) ? 'number' : 'text';
          const contentWidth = ['quantity','unit','markup','supplier','model','unit_cost'].includes(field);
          return <td key={field} className={`${field === 'quantity' ? 'w-12 min-w-[52px]' : field === 'unit' ? 'w-14 min-w-[56px]' : field === 'markup' ? 'w-20 min-w-[72px]' : contentWidth ? 'w-px whitespace-nowrap' : 'min-w-[100px]'} px-1 py-1`}><Field value={value} type={type} contentWidth={contentWidth} disabled={readOnly} saving={saving === key}
            onChange={next => setDrafts(current => ({ ...current, [key]: next }))}
            onCommit={() => {
              if (!Object.prototype.hasOwnProperty.call(drafts, key) || String(drafts[key]) === String(row[field] ?? '')) return;
              const next = drafts[key]; setDrafts(current => { const copy = { ...current }; delete copy[key]; return copy; }); update(row, field, next);
            }} /></td>;
        })}
        <td className="px-2 py-2"><div className="flex items-center gap-1">
          {!readOnly && <button type="button" draggable aria-label={`Drag ${row.description}`} title="Drag to reorder"
            onDragStart={event => { draggingIdRef.current = row.id; setDraggingId(row.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.id); }}
            onDragEnd={() => { draggingIdRef.current = null; setDraggingId(null); setDragOverIndex(null); }}
            className="cursor-grab rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing"><GripVertical className="h-4 w-4"/></button>}
          {!readOnly && row.source_kind === 'manual' && <button type="button" title="Remove line" onClick={() => removeManual(row)} className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>}
        </div></td>
       </tr></Fragment>)}{insertControl(rows.length)}
      {!readOnly && !showManual && <tr className="bg-amber-50/30">
        <td colSpan={visibleColumnCount} className="px-3 py-2">
           <button type="button" onClick={() => openManualAt(rows.length)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100">
            <Plus className="h-4 w-4"/> Add proposal line
           </button>
        </td>
      </tr>}
      </tbody>
    </table>
  </div>;
  };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-5">
      <div className="flex items-start gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-blue-600" /><div><h2 className="font-semibold text-stone-900">Equipment Breakdown</h2><p className="mt-1 max-w-2xl text-sm text-stone-600">Proposal and procurement schedule linked to the current LSS selections. Commercial edits never change engineering selections and remain editable after release.</p></div></div>
      <div className="relative flex gap-2"><button type="button" onClick={() => setShowColumns(value => !value)} disabled={readOnly} aria-expanded={showColumns} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 disabled:opacity-50"><Columns3 className="h-4 w-4" /> Columns</button><button type="button" onClick={refresh} disabled={readOnly} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Refresh selections</button><button type="button" onClick={exportXlsx} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Download className="h-4 w-4" /> Export Excel</button>
        {showColumns && <div className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-stone-200 bg-white p-3 shadow-lg"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Visible columns</p><div className="space-y-1">{columns.map(column => <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-50"><input type="checkbox" checked={!hidden.has(column.key)} onChange={event => void setColumnVisible(column.key, event.target.checked)} />{column.label}</label>)}</div></div>}
      </div>
    </div>
    {isLoading ? <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-400">Loading equipment schedule…</div> : data?.initialized === false && readOnly ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-10 text-center text-sm text-amber-800">This equipment schedule has not been initialized. A Design Book manager must initialize it before it can be viewed.</div> : !systems.length ? <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-500">No Life Support Systems found.</div> :
      grouped.map(({ system, rows }) => <section key={system.id} className="space-y-2"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-stone-800">{system.system_code} — {system.system_name}</h3><p className="text-xs text-stone-500">{rows.length} proposal line{rows.length === 1 ? '' : 's'}</p></div></div>{table(rows, system.id)}</section>)}
    {items.some(row => !row.system_id) && <section className="space-y-2"><h3 className="font-semibold text-stone-800">Unassigned proposal lines</h3>{table(items.filter(row => !row.system_id), '')}</section>}
  </div>;
}

function normalizeCurrencyValue(value: any) {
  return String(value || 'USD').toUpperCase() === 'RMB' ? 'CNY' : String(value || 'USD').toUpperCase();
}