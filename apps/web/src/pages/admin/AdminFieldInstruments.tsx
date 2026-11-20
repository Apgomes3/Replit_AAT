import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';

type Instrument = any;
const empty = { name: '', description: '', tag_code: '', signal_type: 'digital', signal_direction: 'input', requirement_rule: 'optional', numbering_rule: 'system-type-sequence', default_control_logic: '', default_product_master_id: '', default_range_min: '', default_range_max: '', default_unit: '', allow_range_override: true, default_calibration_required: false, default_calibration_interval_days: '', default_calibration_procedure: '', default_datasheet_reference: '', allow_calibration_override: true, sort_order: '0', is_active: true };
const input = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40';
const LOAD_TIMEOUT_MS = 10_000;

export default function AdminFieldInstruments() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-field-instruments'],
    queryFn: ({ signal }) => api.get('/admin/field-instruments', {
      params: { include_inactive: true },
      signal,
      timeout: LOAD_TIMEOUT_MS,
    }).then(r => r.data),
    retry: false,
  });
  const items: Instrument[] = data?.items || data || [];
  const products: any[] = data?.products || [];
  const reset = () => { setCreating(false); setEditing(null); setForm(empty); };
  const startEdit = (item: Instrument) => {
    setCreating(false); setEditing(item.id);
    setForm({ ...empty, ...item, default_product_master_id: item.default_product_master_id || item.default_product?.id || '', sort_order: String(item.sort_order ?? 0) });
  };
  const save = async () => {
    if (!form.name.trim() || !form.tag_code.trim()) { toast.error('Name and tag code are required'); return; }
    setSaving(true);
    try {
    const payload = { ...form, name: form.name.trim(), tag_code: form.tag_code.trim(), description: form.description.trim() || null, default_control_logic: form.default_control_logic.trim() || null, default_product_master_id: form.default_product_master_id || null, default_range_min: form.default_range_min === '' ? null : Number(form.default_range_min), default_range_max: form.default_range_max === '' ? null : Number(form.default_range_max), default_unit: form.default_unit.trim() || null, default_calibration_interval_days: form.default_calibration_interval_days === '' ? null : Number(form.default_calibration_interval_days), default_calibration_procedure: form.default_calibration_procedure.trim() || null, default_datasheet_reference: form.default_datasheet_reference.trim() || null, sort_order: Number(form.sort_order || 0) };
      if (editing) await api.put(`/admin/field-instruments/${editing}`, payload);
      else await api.post('/admin/field-instruments', payload);
      toast.success(editing ? 'Field instrument updated' : 'Field instrument created');
      reset(); qc.invalidateQueries({ queryKey: ['admin-field-instruments'] });
    } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Unable to save field instrument'); }
    finally { setSaving(false); }
  };
  const editor = <div className="grid gap-3 rounded-xl border border-blue-200 bg-white p-4 md:grid-cols-3">
    <label className="text-xs font-medium text-stone-500">Name *<input autoFocus value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className={input} /></label>
    <label className="text-xs font-medium text-stone-500">Tag code *<input value={form.tag_code} onChange={e => setForm((f: any) => ({ ...f, tag_code: e.target.value }))} placeholder="e.g. FS" className={input} /></label>
    <label className="text-xs font-medium text-stone-500">Order<input type="number" value={form.sort_order} onChange={e => setForm((f: any) => ({ ...f, sort_order: e.target.value }))} className={input} /></label>
    <label className="text-xs font-medium text-stone-500 md:col-span-3">Description<input value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} className={input} /></label>
    <label className="text-xs font-medium text-stone-500">Signal type<select value={form.signal_type} onChange={e => setForm((f: any) => ({ ...f, signal_type: e.target.value }))} className={input}><option value="digital">Digital</option><option value="analog">Analog</option></select></label>
    <label className="text-xs font-medium text-stone-500">Signal direction<select value={form.signal_direction} onChange={e => setForm((f: any) => ({ ...f, signal_direction: e.target.value }))} className={input}><option value="input">Input</option><option value="output">Output</option></select></label>
    <label className="text-xs font-medium text-stone-500">Requirement rule<select value={form.requirement_rule} onChange={e => setForm((f: any) => ({ ...f, requirement_rule: e.target.value }))} className={input}><option value="optional">Optional</option><option value="mandatory">Mandatory</option><option value="pump_linked">Pump linked</option></select></label>
    <label className="text-xs font-medium text-stone-500">Numbering rule<input value={form.numbering_rule} onChange={e => setForm((f: any) => ({ ...f, numbering_rule: e.target.value }))} className={input} /></label>
    <label className="text-xs font-medium text-stone-500 md:col-span-2">Default control logic<textarea value={form.default_control_logic} onChange={e => setForm((f: any) => ({ ...f, default_control_logic: e.target.value }))} placeholder="Optional AAT functional/control logic imported when an instrument is first added" rows={3} className={input} /></label>
    <fieldset className="grid gap-3 rounded-lg border border-stone-200 p-3 md:col-span-3 md:grid-cols-4"><legend className="px-1 text-xs font-semibold text-stone-600">Measurement range</legend>
      <label className="text-xs font-medium text-stone-500">Minimum<input type="number" step="any" value={form.default_range_min} onChange={e => setForm((f: any) => ({ ...f, default_range_min: e.target.value }))} className={input} /></label>
      <label className="text-xs font-medium text-stone-500">Maximum<input type="number" step="any" value={form.default_range_max} onChange={e => setForm((f: any) => ({ ...f, default_range_max: e.target.value }))} className={input} /></label>
      <label className="text-xs font-medium text-stone-500">Unit<input value={form.default_unit} onChange={e => setForm((f: any) => ({ ...f, default_unit: e.target.value }))} placeholder="e.g. bar, °C, m³/h" className={input} /></label>
      <label className="flex items-center gap-2 self-end py-2 text-xs text-stone-700"><input type="checkbox" checked={form.allow_range_override} onChange={e => setForm((f: any) => ({ ...f, allow_range_override: e.target.checked }))} />Designers may override</label>
    </fieldset>
    <fieldset className="grid gap-3 rounded-lg border border-stone-200 p-3 md:col-span-3 md:grid-cols-3"><legend className="px-1 text-xs font-semibold text-stone-600">Calibration and datasheet evidence</legend>
      <label className="flex items-center gap-2 text-xs text-stone-700"><input type="checkbox" checked={form.default_calibration_required} onChange={e => setForm((f: any) => ({ ...f, default_calibration_required: e.target.checked }))} />Calibration required</label>
      <label className="text-xs font-medium text-stone-500">Interval (days)<input type="number" min="1" value={form.default_calibration_interval_days} onChange={e => setForm((f: any) => ({ ...f, default_calibration_interval_days: e.target.value }))} className={input} /></label>
      <label className="flex items-center gap-2 text-xs text-stone-700"><input type="checkbox" checked={form.allow_calibration_override} onChange={e => setForm((f: any) => ({ ...f, allow_calibration_override: e.target.checked }))} />Designers may override</label>
      <label className="text-xs font-medium text-stone-500 md:col-span-3">Calibration procedure<input value={form.default_calibration_procedure} onChange={e => setForm((f: any) => ({ ...f, default_calibration_procedure: e.target.value }))} className={input} /></label>
      <label className="text-xs font-medium text-stone-500 md:col-span-3">Datasheet reference<input value={form.default_datasheet_reference} onChange={e => setForm((f: any) => ({ ...f, default_datasheet_reference: e.target.value }))} placeholder="Document number, URL, or historical reference" className={input} /></label>
    </fieldset>
    <label className="text-xs font-medium text-stone-500 md:col-span-2">Default PIM product<select value={form.default_product_master_id} onChange={e => setForm((f: any) => ({ ...f, default_product_master_id: e.target.value }))} className={input}><option value="">— No default product —</option>{products.map(product => <option key={product.id} value={product.id}>{product.product_code ? `${product.product_code} — ` : ''}{product.product_name || product.name}</option>)}</select></label>
    <label className="flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={form.is_active} onChange={e => setForm((f: any) => ({ ...f, is_active: e.target.checked }))} />Active for new designs</label>
    <div className="flex items-end justify-end gap-2 md:col-span-2"><button type="button" onClick={reset} className="rounded-lg px-3 py-2 text-xs text-stone-500 hover:bg-stone-100">Cancel</button><Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}><Check className="mr-1 h-3.5 w-3.5" />{saving ? 'Saving…' : 'Save'}</Button></div>
  </div>;
  return <div className="flex min-h-0 flex-1 flex-col bg-stone-50/50"><PageHeader title="Field Instruments" subtitle="Govern tag rules, signal metadata, requirement rules, and PIM defaults for Life Support control." /><div className="flex-1 overflow-auto p-6"><div className="space-y-4"><div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => { setCreating(true); setEditing(null); setForm(empty); }}><Plus className="mr-1 h-3.5 w-3.5" />New Field Instrument</Button></div>{creating && editor}<div className="overflow-hidden rounded-xl border border-stone-200 bg-white">{isLoading ? <div className="p-8 text-center text-sm text-stone-400" role="status">Loading Field Instruments…</div> : isError ? <div className="p-6 text-sm text-red-800" role="alert"><p className="font-semibold">Field Instruments could not be loaded</p><p className="mt-1">{(error as any)?.response?.data?.error?.message || ((error as any)?.code === 'ECONNABORTED' ? 'The request took too long. Please retry.' : 'The request failed. Please retry.')}</p><button type="button" onClick={() => void refetch()} disabled={isFetching} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />{isFetching ? 'Retrying…' : 'Retry'}</button></div> : <table className="w-full text-sm"><thead className="border-b border-stone-100 bg-stone-50"><tr><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Instrument</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Signal</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Requirement</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Default product</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Status</th><th /></tr></thead><tbody className="divide-y divide-stone-100">{items.map(item => editing === item.id ? <tr key={item.id}><td colSpan={6} className="p-3">{editor}</td></tr> : <tr key={item.id} className="group hover:bg-stone-50/60"><td className="px-4 py-3"><strong className="text-stone-800">{item.name}</strong><span className="ml-2 font-mono text-xs text-blue-700">{item.tag_code}</span><p className="mt-0.5 text-xs text-stone-400">{item.description}</p></td><td className="px-4 py-3 text-stone-600">{item.signal_type} {item.signal_direction}</td><td className="px-4 py-3 text-stone-600">{item.requirement_rule}</td><td className="px-4 py-3 text-stone-600">{item.default_product?.product_name || item.default_product_name || '—'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${item.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td><td className="px-4 py-3"><button aria-label={`Edit ${item.name}`} onClick={() => startEdit(item)} className="rounded p-1.5 text-stone-400 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button></td></tr>)}</tbody></table>}</div></div></div></div>;
}