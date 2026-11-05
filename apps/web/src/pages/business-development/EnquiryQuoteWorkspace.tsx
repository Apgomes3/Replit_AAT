import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FilePlus2, FileText, Lock, Package, Pencil, Plus, RefreshCw, Search, Settings2, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { useModalFocus } from '../../hooks/useModalFocus';

const pretty = (s: string) => s?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';
const errMsg = (err: any, fallback: string) => err?.response?.data?.error?.message || fallback;
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TERMINAL = ['issued', 'accepted', 'rejected', 'expired'];

export interface PimProduct {
  id: number | string;
  product_code: string;
  product_name: string;
  product_description?: string | null;
  product_category?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  sell_price?: number | string | null;
  currency?: string | null;
}

interface Props {
  enquiryId: string;
  enquiry: any;
  canManage: boolean;
  canImportEquipmentAccess: boolean;
}

const inputCls = 'mt-1 w-full border border-[#dce7e2] rounded-lg px-2.5 py-2 text-sm bg-white focus:border-[#087f73] transition-colors';
const lineSource = (line: any): 'pim' | 'engineering' | 'manual' =>
  line?.source_snapshot?.source_type === 'pim_product' ? 'pim' : line?.source_line_id ? 'engineering' : 'manual';
const lineTotal = (line: any) => Number(line.total ?? line.amount ?? Number(line.quantity || 0) * Number(line.unit_price || 0));

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function SourceBadge({ line }: { line: any }) {
  const s = lineSource(line);
  if (s === 'pim') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#20333a] text-white text-[9px] font-extrabold uppercase tracking-wider"><Package className="w-2.5 h-2.5" />PIM</span>;
  if (s === 'engineering') return <span className="inline-flex px-1.5 py-0.5 rounded bg-[#e4f2ee] text-[#087f73] text-[9px] font-extrabold uppercase tracking-wider">Engineering</span>;
  return <span className="inline-flex px-1.5 py-0.5 rounded bg-[#f3f5f4] text-[#75817e] text-[9px] font-extrabold uppercase tracking-wider">Manual</span>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useModalFocus<HTMLDivElement>({ onClose });
  return createPortal(<div className="fixed inset-0 z-50 bg-[#20333a]/40 p-4 flex items-center justify-center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90dvh] flex flex-col shadow-2xl`}>
      <div className="flex items-center justify-between px-5 pt-5 pb-3"><h2 className="font-extrabold">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[#6f8082] hover:bg-[#f3f5f4] hover:text-[#20333a] transition-colors"><X className="w-4 h-4" /></button></div>
      <div className="px-5 pb-5 overflow-y-auto">{children}</div>
    </div>
  </div>, document.body);
}

function ProductPicker({ enquiryId, quoteCurrency, onClose, onAdd, busy }: { enquiryId: string; quoteCurrency: string; onClose: () => void; onAdd: (p: PimProduct, f: { quantity: number; unit_price: number; unit: string; description: string }, key: string) => Promise<boolean>; busy: boolean }) {
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const [picked, setPicked] = useState<PimProduct | null>(null);
  const [idemKey, setIdemKey] = useState('');
  const [form, setForm] = useState({ quantity: '1', unit: 'ea', unit_price: '', description: '' });
  const catalog = useQuery({
    queryKey: ['enquiry-quote-products', enquiryId, term],
    queryFn: () => api.get(`/enquiries/${enquiryId}/quote/products`, { params: { search: term || undefined } }).then(r => r.data),
  });
  const items: PimProduct[] = catalog.data?.items || [];
  const choose = (p: PimProduct) => {
    const sameCur = (p.currency || '').toUpperCase() === quoteCurrency.toUpperCase();
    const seed = sameCur && p.sell_price != null && p.sell_price !== '' ? String(Number(p.sell_price)) : '';
    setPicked(p);
    setIdemKey(crypto.randomUUID());
    setForm({ quantity: '1', unit: 'ea', unit_price: seed, description: p.product_description || p.product_name || '' });
  };
  const qty = Number(form.quantity);
  const price = form.unit_price.trim() === '' ? NaN : Number(form.unit_price);
  const valid = Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || !valid) return;
    const ok = await onAdd(picked, { quantity: qty, unit_price: price, unit: form.unit.trim(), description: form.description.trim() }, idemKey);
    if (ok) setPicked(null);
  };
  const mismatch = picked && (picked.currency || '').toUpperCase() !== quoteCurrency.toUpperCase();
  const noPrice = picked && (picked.sell_price == null || picked.sell_price === '');
  return <Modal title="Add PIM product" onClose={onClose} wide>
    {!picked ? <>
      <label className="relative block"><span className="sr-only">Search PIM products</span><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9b9a]" /><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, manufacturer, model" className="w-full border border-[#dce7e2] rounded-lg pl-9 pr-3 py-2.5 text-sm focus:border-[#087f73]" /></label>
      <p className="text-[11px] text-[#8a9b9a] mt-2">Prices quoted in <strong className="font-mono text-[#20333a]">{quoteCurrency}</strong>. Showing the top server matches; refine the search to narrow.</p>
      <div className="mt-3 border border-[#edf2ef] rounded-xl divide-y divide-[#edf2ef] min-h-[220px]" aria-live="polite">
        {catalog.isLoading ? [0, 1, 2, 3].map(i => <div key={i} className="p-3 flex gap-3"><div className="h-4 w-20 skeleton" /><div className="h-4 flex-1 skeleton" /></div>)
          : catalog.isError ? <div className="p-8 text-center text-sm text-rose-700">Product catalog could not be loaded. <button onClick={() => catalog.refetch()} className="underline font-bold">Retry</button></div>
          : items.length === 0 ? <div className="p-10 text-center"><Package className="w-8 h-8 text-[#b8d9d0] mx-auto mb-2" /><p className="font-bold text-sm">No products found</p><p className="text-xs text-[#6f8082] mt-1">{term ? `Nothing matches "${term}".` : 'The PIM catalog is empty.'}</p></div>
          : items.map(p => {
            const same = (p.currency || '').toUpperCase() === quoteCurrency.toUpperCase();
            return <button key={p.id} type="button" onClick={() => choose(p)} className="w-full text-left p-3 flex items-center gap-3 hover:bg-[#f5f8f6] transition-colors group">
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-xs text-[#087f73]">{p.product_code}</span>{p.product_category && <span className="text-[10px] text-[#8a9b9a] uppercase tracking-wider">{p.product_category}</span>}</div><div className="text-sm font-bold truncate">{p.product_name}</div><div className="text-[11px] text-[#6f8082] truncate">{[p.manufacturer, p.model].filter(Boolean).join(' · ') || '—'}</div></div>
              <div className="text-right shrink-0">{p.sell_price == null || p.sell_price === '' ? <span className="text-[11px] font-bold text-[#c36f3d]">No price</span> : <span className={`font-mono text-xs ${same ? 'text-[#20333a]' : 'text-[#c36f3d]'}`}>{p.currency} {money(Number(p.sell_price))}</span>}</div>
              <Plus className="w-4 h-4 text-[#8a9b9a] group-hover:text-[#087f73] transition-colors" />
            </button>;
          })}
      </div>
    </> : <form onSubmit={submit} className="animate-fade-in-up">
      <div className="rounded-xl bg-[#f5f8f6] border border-[#edf2ef] p-3"><div className="font-mono text-xs text-[#087f73]">{picked.product_code}</div><div className="font-bold text-sm">{picked.product_name}</div><div className="text-[11px] text-[#6f8082] mt-0.5">Catalog: {picked.sell_price == null || picked.sell_price === '' ? 'no price' : `${picked.currency} ${money(Number(picked.sell_price))}`}</div></div>
      {(mismatch || noPrice) && <div role="alert" className="mt-3 p-3 rounded-lg bg-[#fff5ed] border border-[#f1d7c2] text-xs text-[#8c512e] flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{noPrice ? 'This product has no catalog price.' : `Catalog price is in ${picked.currency || 'an unknown currency'}, not ${quoteCurrency}. No conversion is applied.`} Enter an explicit selling price in <strong>{quoteCurrency}</strong> (zero is allowed).</span></div>}
      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <label className="text-xs font-bold">Quantity<input type="number" min="0" step="any" required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className={inputCls} /></label>
        <label className="text-xs font-bold">Unit<input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className={inputCls} /></label>
        <label className="text-xs font-bold">Unit price ({quoteCurrency})<input type="number" min="0" step="any" required value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} className={`${inputCls} font-mono`} /></label>
        <label className="sm:col-span-3 text-xs font-bold">Description<textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} /></label>
      </div>
      {!valid && <p className="text-[11px] text-[#c36f3d] mt-2">Quantity must be greater than zero and unit price zero or more.</p>}
      <div className="flex justify-between items-center gap-2 mt-5"><button type="button" onClick={() => setPicked(null)} className="text-sm font-bold text-[#6f8082] hover:text-[#087f73]">Back to results</button><div className="flex items-center gap-3"><span className="font-mono text-sm">{valid ? `${quoteCurrency} ${money(qty * price)}` : '—'}</span><button disabled={!valid || busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold disabled:opacity-40 hover:bg-[#075c56] transition-colors"><Plus className="w-4 h-4" />{busy ? 'Adding…' : 'Add to quote'}</button></div></div>
    </form>}
  </Modal>;
}

function CustomLineForm({ quoteCurrency, busy, onClose, onAdd }: { quoteCurrency: string; busy: boolean; onClose: () => void; onAdd: (f: { description: string; quantity: number; unit: string; unit_price: number }, key: string) => Promise<boolean> }) {
  const [idemKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ description: '', quantity: '1', unit: 'LS', unit_price: '' });
  const [touched, setTouched] = useState(false);
  const qty = Number(form.quantity);
  const price = form.unit_price.trim() === '' ? NaN : Number(form.unit_price);
  const desc = form.description.trim();
  const unit = form.unit.trim();
  const errors: string[] = [];
  if (!desc) errors.push('Description is required.');
  else if (desc.length > 10000) errors.push('Description must be 10000 characters or fewer.');
  if (!(Number.isFinite(qty) && qty > 0)) errors.push('Quantity must be greater than zero.');
  if (!unit) errors.push('Unit is required.');
  else if (unit.length > 50) errors.push('Unit must be 50 characters or fewer.');
  if (form.unit_price.trim() === '') errors.push('Unit selling price is required (zero is allowed).');
  else if (!(Number.isFinite(price) && price >= 0)) errors.push('Unit selling price must be zero or more.');
  const valid = errors.length === 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const ok = await onAdd({ description: desc, quantity: qty, unit, unit_price: price }, idemKey);
    if (ok) onClose();
  };
  return <Modal title="Add custom line" onClose={onClose}>
    <form onSubmit={submit} noValidate>
      <p className="text-xs text-[#6f8082]">Commercial lines outside the PIM catalog, for example <strong>Installation and commissioning</strong>, <strong>Freight to site</strong> or <strong>Crating and export packing</strong>.</p>
      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <label className="sm:col-span-3 text-xs font-bold">Description<textarea rows={3} maxLength={10000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Installation and commissioning, 3 technicians x 5 days" className={inputCls} /></label>
        <label className="text-xs font-bold">Quantity<input type="number" min="0" step="any" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className={inputCls} /></label>
        <label className="text-xs font-bold">Unit<input maxLength={50} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className={inputCls} /></label>
        <label className="text-xs font-bold">Unit selling price ({quoteCurrency})<input type="number" min="0" step="any" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} className={`${inputCls} font-mono`} /></label>
        <label className="text-xs font-bold">Currency<input aria-label="Line currency" value={quoteCurrency} readOnly disabled className={`${inputCls} font-mono bg-[#f3f5f4]`} /></label>
      </div>
      {touched && !valid && <ul role="alert" className="mt-3 p-3 rounded-lg bg-[#fff5ed] border border-[#f1d7c2] text-xs text-[#8c512e] list-disc pl-6">{errors.map(m => <li key={m}>{m}</li>)}</ul>}
      <div className="flex justify-between items-center gap-2 mt-5"><button type="button" onClick={onClose} className="text-sm font-bold text-[#6f8082] hover:text-[#087f73]">Cancel</button><div className="flex items-center gap-3"><span className="font-mono text-sm">{valid ? `${quoteCurrency} ${money(qty * price)}` : '—'}</span><button type="submit" disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#087f73] text-white text-sm font-bold disabled:opacity-40 hover:bg-[#075c56] transition-colors"><Plus className="w-4 h-4" />{busy ? 'Adding…' : 'Add custom line'}</button></div></div>
    </form>
  </Modal>;
}

export default function EnquiryQuoteWorkspace({ enquiryId, enquiry: d, canManage, canImportEquipmentAccess }: Props) {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const canUsePim = user?.role === 'admin' || (user?.moduleAccess as any)?.pim !== 'hidden';
  const quote = d?.quote || null;
  const isDraft = !quote || quote.status === 'draft';
  const editable = canManage && isDraft;
  const canAddPim = editable && canUsePim;
  const canImportEquipment = canImportEquipmentAccess && isDraft;
  const hasBook = !!(d?.design_book_id || d?.design_book);
  const lines: any[] = quote?.lines || d?.quote_lines || [];
  const [busy, setBusy] = useState(false);
  const [newCurrency, setNewCurrency] = useState('USD');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importConfirm, setImportConfirm] = useState(false);
  const [deleteLine, setDeleteLineState] = useState<any>(null);
  const setDeleteLine = (line: any) => setDeleteLineState(line ? { ...line, quoteVersion: quote?.updated_at } : null);
  const [editId, setEditId] = useState<any>(null);
  const [editVersion, setEditVersion] = useState<string | null>(null);
  const [edit, setEdit] = useState({ description: '', quantity: '', unit: '', unit_price: '' });
  const [quoteForm, setQuoteForm] = useState({ status: 'draft', currency: 'USD', notes: '' });
  const busyRef = useRef(false);
  const [conflict, setConflict] = useState<'edit' | 'delete' | null>(null);
  const reloadLatest = async () => {
    await refresh();
    setEditId(null);
    setDeleteLine(null);
    setConflict(null);
    toast.success('Current quote loaded. Reopen the line to review and edit the latest values.');
  };
  const quoteCurrency = (quote?.currency || newCurrency || 'USD').toUpperCase();
  const refresh = () => qc.invalidateQueries({ queryKey: ['enquiry', enquiryId] });
  const run = async (fn: () => Promise<any>, ok: string, fail: string, scope?: 'edit' | 'delete') => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true);
    try { await fn(); await refresh(); toast.success(ok); return true; }
    catch (err: any) { if (scope && err?.response?.status === 409) setConflict(scope); toast.error(errMsg(err, fail)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };

  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) { const c = String(l.currency || quote?.currency || 'USD').toUpperCase(); m.set(c, (m.get(c) || 0) + lineTotal(l)); }
    return [...m.entries()];
  }, [lines, quote?.currency]);
  const quoteStatuses = quote?.status === 'issued' ? ['issued', 'accepted', 'rejected', 'expired'] : TERMINAL.includes(quote?.status) ? [quote.status] : ['draft', 'issued'];
  const engineeringCount = lines.filter(l => lineSource(l) === 'engineering').length;
  const pimCount = lines.filter(l => lineSource(l) === 'pim').length;

  const createQuote = () => run(() => api.post(`/enquiries/${enquiryId}/quote`, { currency: quoteCurrency }), `Draft quote created in ${quoteCurrency}`, 'Could not create quote');
  const addProduct = (p: PimProduct, f: { quantity: number; unit_price: number; unit: string; description: string }, key: string) =>
    run(() => api.post(`/enquiries/${enquiryId}/quote/lines`, { idempotency_key: key, product_master_id: p.id, quantity: f.quantity, unit_price: f.unit_price, description: f.description || undefined, unit: f.unit || undefined, currency: quoteCurrency }), `${p.product_code} added`, 'Could not add product');
  const addCustom = (f: { description: string; quantity: number; unit: string; unit_price: number }, key: string) =>
    run(() => api.post(`/enquiries/${enquiryId}/quote/manual-lines`, { description: f.description, quantity: f.quantity, unit: f.unit, unit_price: f.unit_price, currency: quoteCurrency, idempotency_key: key }), 'Custom line added', 'Could not add custom line');
  const startEdit = (l: any) => { setEditVersion(quote?.updated_at || null); setEditId(l.id); setEdit({ description: l.description || '', quantity: String(l.quantity ?? 1), unit: l.unit || '', unit_price: l.unit_price == null ? '' : String(l.unit_price) }); };
  const editQty = Number(edit.quantity);
  const editPrice = edit.unit_price.trim() === '' ? NaN : Number(edit.unit_price);
  const editValid = Number.isFinite(editQty) && editQty > 0 && Number.isFinite(editPrice) && editPrice >= 0 && !!edit.description.trim() && !!edit.unit.trim();
  const saveEdit = async () => {
    if (!editValid || !quote) return;
    const ok = await run(() => api.patch(`/enquiries/${enquiryId}/quote/lines/${editId}`, { quantity: editQty, unit_price: editPrice, description: edit.description.trim(), unit: edit.unit.trim(), ...(editVersion ? { expected_quote_version: editVersion } : {}) }), 'Line updated', 'Could not update line', 'edit');
    if (ok) { setEditId(null); setConflict(null); }
  };
  const confirmDelete = async () => {
    if (!quote || !deleteLine) return;
    const ok = await run(() => api.delete(`/enquiries/${enquiryId}/quote/lines/${deleteLine.id}`, { data: deleteLine.quoteVersion ? { expected_quote_version: deleteLine.quoteVersion } : {} }), 'Line removed', 'Could not remove line', 'delete');
    if (ok) { setDeleteLine(null); setConflict(null); }
  };
  const doImport = async () => {
    if (!canImportEquipment) return;
    if (!hasBook) { toast.error('Link a Design Book before importing equipment'); return; }
    const ok = await run(() => api.post(`/enquiries/${enquiryId}/quote/import-equipment-breakdown`), 'Equipment breakdown imported', 'Could not import equipment breakdown');
    if (ok) setImportConfirm(false);
  };
  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const ok = await run(() => api.patch(`/enquiries/${enquiryId}/quote`, !isDraft ? { status: quoteForm.status } : lines.length > 0 ? { status: quoteForm.status, notes: quoteForm.notes } : quoteForm), 'Quote settings updated', 'Could not update quote');
    if (ok) setSettingsOpen(false);
  };

  const btn = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all active:scale-[.98] disabled:opacity-40';
  return <section className="bg-white rounded-xl border border-[#dce7e2] shadow-sm overflow-hidden animate-fade-in-up">
    <div className="p-5 border-b border-[#edf2ef] flex flex-wrap justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 flex-wrap"><h2 className="font-extrabold">Quote workspace</h2>{quote && <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-extrabold ${isDraft ? 'bg-[#e4f2ee] text-[#087f73]' : 'bg-[#20333a] text-white'}`}>{pretty(quote.status)}</span>}{quote && <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#f5f8f6] border border-[#edf2ef]">{quote.currency}</span>}</div>
        <p className="text-xs text-[#6f8082] mt-1">Engineering imports and PIM catalog products priced against this enquiry.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canManage && quote && <button onClick={() => { setQuoteForm({ status: quote.status || 'draft', currency: quote.currency || 'USD', notes: quote.notes || '' }); setSettingsOpen(true); }} className={`${btn} border border-[#dce7e2] bg-white hover:border-[#087f73]`}><Settings2 className="w-4 h-4" /> Quote settings</button>}
        {canImportEquipment && <button onClick={() => setImportConfirm(true)} disabled={busy || !hasBook} className={`${btn} border border-[#087f73] text-[#087f73] bg-white hover:bg-[#e4f2ee]`}><RefreshCw className="w-4 h-4" /> Import equipment breakdown</button>}
        {editable && quote && <button onClick={() => setCustomOpen(true)} disabled={busy} className={`${btn} border border-[#087f73] text-[#087f73] bg-white hover:bg-[#e4f2ee]`}><Plus className="w-4 h-4" /> Add custom line</button>}
        {canAddPim && quote && <button onClick={() => setPickerOpen(true)} disabled={busy} className={`${btn} bg-[#087f73] text-white hover:bg-[#075c56]`}><Package className="w-4 h-4" /> Add PIM product</button>}
      </div>
    </div>
    {quote && !isDraft && <div className="mx-5 mt-5 p-3 rounded-lg bg-[#f5f8f6] border border-[#dce7e2] text-xs text-[#53686b] flex items-center gap-2"><Lock className="w-3.5 h-3.5" />This quote is {pretty(quote.status).toLowerCase()} and read-only. Line prices are frozen.</div>}
    {canImportEquipment && !hasBook && <div className="mx-5 mt-5 p-3 rounded-lg bg-[#fff5ed] border border-[#f1d7c2] text-xs text-[#8c512e]"><strong>Design Book not linked.</strong> Engineering import needs a linked Design Book; PIM products can still be added.</div>}
    {totals.length > 1 && <div role="alert" className="mx-5 mt-5 p-3 rounded-lg bg-[#fff5ed] border border-[#f1d7c2] text-xs text-[#8c512e] flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />Lines carry mixed currencies. Totals are shown per currency and are not combined.</div>}
    <div className="p-5">
      {!quote && lines.length === 0 ? <div className="py-12 text-center max-w-md mx-auto">
        <FilePlus2 className="w-9 h-9 text-[#b8d9d0] mx-auto mb-3" />
        <p className="font-bold">No quote yet</p>
        <p className="text-sm text-[#6f8082] mt-1">{editable ? 'Choose the quote currency, then start an empty draft, add a custom line such as installation or freight, or add a PIM product directly.' : 'No quote has been started for this enquiry.'}</p>
        {editable && <div className="mt-5 flex flex-wrap items-end justify-center gap-2">
          <label className="text-xs font-bold text-left">Currency<input aria-label="Quote currency" value={newCurrency} maxLength={3} onChange={e => setNewCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} className={`${inputCls} w-24 font-mono`} /></label>
          <button onClick={createQuote} disabled={busy || newCurrency.length !== 3} className={`${btn} bg-[#20333a] text-white`}><FilePlus2 className="w-4 h-4" />{busy ? 'Creating…' : 'Create empty quote'}</button>
          <button onClick={() => setCustomOpen(true)} disabled={busy || newCurrency.length !== 3} className={`${btn} border border-[#087f73] text-[#087f73] bg-white hover:bg-[#e4f2ee]`}><Plus className="w-4 h-4" /> Add custom line</button>
          {canUsePim && <button onClick={() => setPickerOpen(true)} disabled={busy || newCurrency.length !== 3} className={`${btn} bg-[#087f73] text-white hover:bg-[#075c56]`}><Package className="w-4 h-4" /> Add PIM product</button>}
        </div>}
      </div> : lines.length === 0 ? <div className="py-14 text-center"><FileText className="w-9 h-9 text-[#b8d9e2] mx-auto mb-3" /><p className="font-bold">No quote lines captured</p><p className="text-sm text-[#6f8082] mt-1">{editable ? 'Add custom lines, PIM products or import the Design Book equipment breakdown.' : 'This quote has no lines.'}</p></div> : <>
        {conflict === 'edit' && <div role="alert" className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center gap-2"><AlertTriangle className="w-4 h-4" />The quote changed since you opened it. Your input is kept; reload to review the latest version before retrying.<button type="button" onClick={reloadLatest} className="underline font-bold">Reload current quote</button></div>}
        <div className="flex gap-3 text-[11px] text-[#6f8082] mb-3"><span>{lines.length} lines</span><span>{engineeringCount} engineering</span><span>{pimCount} PIM</span></div>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="border-b border-[#dce7e2]"><tr>{['Item', 'Description', 'Qty', 'Unit', 'Unit price', 'Total', ''].map((h, i) => <th key={i} className={`py-2.5 pr-3 text-[10px] uppercase tracking-wider text-[#6f8082] ${i >= 4 && i < 6 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>{lines.map((line: any, i: number) => {
              const snap = line.source_snapshot || {};
              const cur = String(line.currency || quote?.currency || 'USD').toUpperCase();
              const isEditing = editId != null && editId === line.id;
              if (isEditing) return <tr key={line.id} className="border-b border-[#edf2ef] bg-[#f5f8f6] align-top">
                <td className="py-2 pr-3"><div className="font-mono text-xs">{snap.product_code || line.code || line.item_code || '—'}</div><div className="mt-1"><SourceBadge line={line} /></div></td>
                <td className="py-2 pr-3"><textarea aria-label="Description" rows={2} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} className={inputCls} /></td>
                <td className="py-2 pr-3 w-24"><input aria-label="Quantity" type="number" min="0" step="any" value={edit.quantity} onChange={e => setEdit({ ...edit, quantity: e.target.value })} className={inputCls} /></td>
                <td className="py-2 pr-3 w-20"><input aria-label="Unit" value={edit.unit} onChange={e => setEdit({ ...edit, unit: e.target.value })} className={inputCls} /></td>
                <td className="py-2 pr-3 w-32"><input aria-label={`Unit price (${cur})`} type="number" min="0" step="any" value={edit.unit_price} onChange={e => setEdit({ ...edit, unit_price: e.target.value })} className={`${inputCls} font-mono text-right`} /></td>
                <td className="py-2 pr-3 text-right font-mono font-bold pt-4">{editValid ? money(editQty * editPrice) : '—'}</td>
                <td className="py-2 pt-3 whitespace-nowrap text-right"><button onClick={saveEdit} disabled={!editValid || busy} aria-label="Save line" className="p-1.5 rounded-lg bg-[#087f73] text-white disabled:opacity-40"><Check className="w-4 h-4" /></button><button onClick={() => { setEditId(null); setConflict(null); }} aria-label="Cancel edit" className="p-1.5 ml-1 rounded-lg text-[#6f8082] hover:bg-white"><X className="w-4 h-4" /></button></td>
              </tr>;
              return <tr key={line.id || i} className="border-b border-[#edf2ef] hover:bg-[#fafcfb] transition-colors group">
                <td className="py-2.5 pr-3"><div className="font-mono text-xs">{snap.product_code || line.code || line.item_code || '—'}</div><div className="mt-1"><SourceBadge line={line} /></div></td>
                <td className="py-2.5 pr-3"><div>{line.description || line.name || snap.product_name || '—'}</div>{lineSource(line) === 'pim' && snap.product_name && <div className="text-[11px] text-[#8a9b9a]">{snap.product_name}{snap.sell_price != null && ` · catalog at add ${snap.currency || ''} ${money(Number(snap.sell_price))}`}</div>}</td>
                <td className="py-2.5 pr-3 font-mono">{line.quantity ?? 1}</td>
                <td className="py-2.5 pr-3 text-[#6f8082]">{line.unit || '—'}</td>
                <td className="py-2.5 pr-3 text-right font-mono">{line.unit_price == null ? '—' : money(Number(line.unit_price))}</td>
                <td className="py-2.5 pr-3 text-right font-mono font-bold">{money(lineTotal(line))} <span className="text-[10px] text-[#8a9b9a]">{cur}</span></td>
                <td className="py-2.5 text-right whitespace-nowrap">{editable && line.id != null && <span className="opacity-60 group-hover:opacity-100 transition-opacity"><button onClick={() => startEdit(line)} disabled={busy} aria-label={`Edit line ${i + 1}`} className="p-1.5 rounded-lg text-[#6f8082] hover:text-[#087f73] hover:bg-[#e4f2ee]"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => setDeleteLine(line)} disabled={busy} aria-label={`Remove line ${i + 1}`} className="p-1.5 rounded-lg text-[#6f8082] hover:text-rose-700 hover:bg-rose-50"><Trash2 className="w-3.5 h-3.5" /></button></span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="flex flex-col items-end gap-1 pt-5">{totals.map(([c, t]) => <div key={c} className="text-lg font-extrabold">Total&nbsp; <span className="font-mono">{c} {money(t)}</span></div>)}</div>
      </>}
    </div>

    {pickerOpen && canAddPim && <ProductPicker enquiryId={enquiryId} quoteCurrency={quoteCurrency} busy={busy} onClose={() => setPickerOpen(false)} onAdd={addProduct} />}
    {customOpen && editable && <CustomLineForm quoteCurrency={quoteCurrency} busy={busy} onClose={() => setCustomOpen(false)} onAdd={addCustom} />}
    {importConfirm && <Modal title="Import equipment breakdown" onClose={() => setImportConfirm(false)}>
      <p className="text-sm text-[#53686b] leading-6">This replaces <strong>imported Engineering lines only</strong> ({engineeringCount} currently) with the latest Design Book breakdown. PIM products ({pimCount}) and other lines are preserved. The import is rejected if breakdown currencies differ from the quote currency ({quoteCurrency}).</p>
      <div className="flex justify-end gap-2 mt-5"><button onClick={() => setImportConfirm(false)} className="px-4 py-2 text-sm">Cancel</button><button onClick={doImport} disabled={busy} className={`${btn} bg-[#087f73] text-white`}><RefreshCw className="w-4 h-4" />{busy ? 'Importing…' : 'Replace engineering lines'}</button></div>
    </Modal>}
    {deleteLine && <Modal title="Remove quote line" onClose={() => { setDeleteLine(null); setConflict(null); }}>
      <p className="text-sm text-[#53686b]">Remove <strong className="font-mono">{deleteLine.source_snapshot?.product_code || deleteLine.code || deleteLine.item_code || 'this line'}</strong> from the draft quote?</p>
      {conflict === 'delete' && <div role="alert" className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center gap-2"><AlertTriangle className="w-4 h-4" />The quote changed since you opened it. Your input is kept; reload to review the latest version before retrying.<button type="button" onClick={reloadLatest} className="underline font-bold">Reload current quote</button></div>}
      <div className="flex justify-end gap-2 mt-5"><button onClick={() => { setDeleteLine(null); setConflict(null); }} className="px-4 py-2 text-sm">Cancel</button><button onClick={confirmDelete} disabled={busy} className={`${btn} bg-rose-700 text-white`}><Trash2 className="w-4 h-4" />{busy ? 'Removing…' : 'Remove line'}</button></div>
    </Modal>}
    {settingsOpen && canManage && <Modal title="Quote settings" onClose={() => setSettingsOpen(false)}>
      <form onSubmit={saveSettings}>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-xs font-bold">Status<select value={quoteForm.status} onChange={e => setQuoteForm({ ...quoteForm, status: e.target.value })} className={inputCls}>{quoteStatuses.map(s => <option key={s} value={s}>{pretty(s)}</option>)}</select></label>
          <label className="text-xs font-bold">Currency<input value={quoteForm.currency} disabled={lines.length > 0 || !isDraft} onChange={e => setQuoteForm({ ...quoteForm, currency: e.target.value.toUpperCase() })} className={`${inputCls} font-mono disabled:bg-[#f3f5f4]`} />{(lines.length > 0 || !isDraft) && <span className="block text-[10px] font-medium text-[#8a9b9a] mt-1">{!isDraft ? 'Frozen once issued.' : 'Locked while lines exist.'}</span>}</label>
          <label className="sm:col-span-2 text-xs font-bold">Notes<textarea value={quoteForm.notes} disabled={!isDraft} onChange={e => setQuoteForm({ ...quoteForm, notes: e.target.value })} rows={4} className={inputCls} /></label>
        </div>
        <div className="flex justify-end gap-2 mt-5"><button type="button" onClick={() => setSettingsOpen(false)} className="px-4 py-2 text-sm">Cancel</button><button disabled={busy} className={`${btn} bg-[#087f73] text-white`}>{busy ? 'Saving…' : 'Save quote settings'}</button></div>
      </form>
    </Modal>}
  </section>;
}
