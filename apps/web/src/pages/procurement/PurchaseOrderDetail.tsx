import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRecordTitle } from '../../hooks/usePageTitle';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import EntityCode from '../../components/ui/EntityCode';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import {
  Package, CheckCircle, XCircle, ArrowRight, ChevronRight, Plus, Trash2, Clock, Search, X, FileText, Pencil, RefreshCw
} from 'lucide-react';

const STAGES = ['draft', 'pending_approval', 'purchase_order', 'po_review', 'engineering_review', 'released'];

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  draft:              { label: 'Draft',              color: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400' },
  pending_approval:   { label: 'Pending Approval',   color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-400' },
  purchase_order:     { label: 'Purchase Order',     color: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  po_review:          { label: 'PO Review',          color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  engineering_review: { label: 'Engineering Review', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  released:           { label: 'Released',           color: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY'];

function POStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full ${meta.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function LifecycleBar({ status }: { status: string }) {
  const idx = STAGES.indexOf(status);
  return (
    <div className="flex items-center gap-0 mt-3 mb-1">
      {STAGES.map((s, i) => {
        const meta = STATUS_META[s];
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s} className="flex items-center flex-1 min-w-0">
            <div className={`flex flex-col items-center flex-1 min-w-0`}>
              <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${active ? 'border-blue-600 bg-blue-600' : done ? 'border-blue-600 bg-blue-600/30' : 'border-slate-200 bg-white'}`} />
              <span className={`text-[10px] mt-1 text-center leading-tight hidden sm:block ${active ? 'text-blue-600 font-semibold' : done ? 'text-slate-400' : 'text-slate-300'}`}>
                {meta?.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-0.5 flex-1 ${i < idx ? 'bg-blue-600/40' : 'bg-slate-100'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const PEGGED_RATES_FROM_USD: Record<string, number> = {
  AED: 3.6725,
  SAR: 3.75,
};

function useExchangeRates() {
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1, ...PEGGED_RATES_FROM_USD });
  const [rateDate, setRateDate] = useState<string | null>(null);
  useEffect(() => {
    api.get('/purchase-orders/exchange-rates')
      .then(r => r.data)
      .then((d: { rates: Record<string, number>; date: string }) => {
        setRates({ ...PEGGED_RATES_FROM_USD, ...d.rates, USD: 1 });
        setRateDate(d.date || null);
      })
      .catch(() => {});
  }, []);
  return { rates, rateDate };
}

function convertAmount(amount: number | null, fromCurrency: string, toCurrency: string, rates: Record<string, number>): number | null {
  if (amount == null) return null;
  if (fromCurrency === toCurrency) return amount;
  const toUSD = fromCurrency === 'USD' ? amount : (amount / (rates[fromCurrency] ?? 1));
  if (toCurrency === 'USD') return toUSD;
  return toUSD * (rates[toCurrency] ?? 1);
}

type Item = {
  id: string; product_master_id: string | null; product_code: string; product_name: string;
  quantity: string; cost_price: string | null; sell_price: string | null; currency: string; notes: string | null;
  system_id: string | null; system_code: string | null; system_name: string | null;
};

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [displayCurrency, setDisplayCurrency] = useState(() => localStorage.getItem('preferred_currency') || 'USD');
  const { rates, rateDate } = useExchangeRates();

  const [commentModal, setCommentModal] = useState<null | 'approve' | 'reject' | 'advance'>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const [showAddItem, setShowAddItem] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const addItemSearchRef = useRef<HTMLInputElement>(null);

  // Inline item editing
  const [inlineEdit, setInlineEdit] = useState<{ itemId: string; field: 'quantity' | 'cost_price' | 'sell_price'; value: string } | null>(null);

  // Inline currency editing (stores itemId being edited)
  const [currencyEdit, setCurrencyEdit] = useState<string | null>(null);

  // Auto-save indicator
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Inline system picker
  const [systemEdit, setSystemEdit] = useState<{ itemId: string; pos: { top: number; left: number } } | null>(null);
  const [itemSysSearch, setItemSysSearch] = useState('');
  const sysEditRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (systemEdit) setTimeout(() => sysEditRef.current?.focus(), 30);
    else setItemSysSearch('');
  }, [systemEdit?.itemId]);

  useEffect(() => {
    if (!systemEdit) return;
    const close = (e: MouseEvent) => {
      const el = document.getElementById('sys-picker-popup');
      if (el && !el.contains(e.target as Node)) setSystemEdit(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSystemEdit(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [systemEdit]);

  const handleSaveSystem = async (itemId: string, systemId: string | null) => {
    const item = (po?.items || []).find((i: Item) => i.id === itemId);
    if (!item) { setSystemEdit(null); return; }
    setSystemEdit(null);
    setItemSysSearch('');
    try {
      await api.put(`/purchase-orders/${id}/items/${itemId}`, {
        quantity: item.quantity,
        cost_price: item.cost_price ?? '',
        sell_price: item.sell_price ?? '',
        currency: item.currency,
        notes: item.notes,
        system_id: systemId,
      });
      setSavedAt(new Date());
      refetch();
    } catch {
      toast.error('Failed to update system');
    }
  };

  const handleSaveInline = async () => {
    if (!inlineEdit) return;
    const item = (po?.items || []).find((i: Item) => i.id === inlineEdit.itemId);
    if (!item) { setInlineEdit(null); return; }
    const snap = { ...inlineEdit };
    setInlineEdit(null);
    try {
      await api.put(`/purchase-orders/${id}/items/${snap.itemId}`, {
        quantity: snap.field === 'quantity' ? snap.value : item.quantity,
        cost_price: snap.field === 'cost_price' ? snap.value : (item.cost_price ?? ''),
        sell_price: snap.field === 'sell_price' ? snap.value : (item.sell_price ?? ''),
        currency: item.currency,
        notes: item.notes,
        system_id: item.system_id,
      });
      setSavedAt(new Date());
      refetch();
    } catch {
      toast.error('Failed to save');
    }
  };

  const handleCurrencyChange = async (itemId: string, newCurrency: string) => {
    setCurrencyEdit(null);
    const item = (po?.items || []).find((i: Item) => i.id === itemId);
    if (!item || item.currency === newCurrency) return;
    try {
      await api.put(`/purchase-orders/${id}/items/${itemId}`, {
        quantity: item.quantity,
        cost_price: item.cost_price ?? '',
        sell_price: item.sell_price ?? '',
        currency: newCurrency,
        notes: item.notes,
        system_id: item.system_id,
      });
      setSavedAt(new Date());
      refetch();
    } catch {
      toast.error('Failed to update currency');
    }
  };

  const { data: po, isLoading, refetch } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/purchase-orders/${id}`).then(r => r.data),
  });
  useRecordTitle(po?.po_code);

  const { data: productSearchResults } = useQuery({
    queryKey: ['po-detail-product-search', productSearch],
    queryFn: () => api.get(`/product-masters?q=${encodeURIComponent(productSearch)}&page_size=20`).then(r => r.data),
    enabled: productSearch.length >= 1,
  });

  const { data: itemSysResults } = useQuery({
    queryKey: ['item-sys-search', itemSysSearch],
    queryFn: () => api.get(`/purchase-orders/systems-search?q=${encodeURIComponent(itemSysSearch)}&page_size=15`).then(r => r.data),
    enabled: itemSysSearch.length >= 1 && systemEdit !== null,
  });

  useEffect(() => {
    localStorage.setItem('preferred_currency', displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    if (showAddItem) {
      setTimeout(() => addItemSearchRef.current?.focus(), 50);
    } else {
      setProductSearch('');
    }
  }, [showAddItem]);

  const refetchAll = () => { refetch(); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); };

  const canManage = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'hq_manager'
    || (po?.designated_users || []).some((u: any) => u.user_id === user?.id);
  const canApprove = user?.role === 'hq_manager' || user?.role === 'admin';
  const isDraft = po?.status === 'draft';
  const isPending = po?.status === 'pending_approval';
  const isReleased = po?.status === 'released';
  const stageIdx = STAGES.indexOf(po?.status || 'draft');
  const hasNextStage = stageIdx >= 2 && stageIdx < STAGES.length - 1;

  const handleAction = async (action: 'submit' | 'approve' | 'reject' | 'advance') => {
    setSaving(true);
    try {
      if (action === 'submit') {
        await api.post(`/purchase-orders/${id}/submit`);
        toast.success('PO submitted');
      } else if (action === 'approve') {
        await api.post(`/purchase-orders/${id}/approve`, { comment });
        toast.success('PO approved');
      } else if (action === 'reject') {
        await api.post(`/purchase-orders/${id}/reject`, { comment });
        toast.success('PO sent back to draft');
      } else if (action === 'advance') {
        await api.post(`/purchase-orders/${id}/transition`, { comment });
        toast.success('Stage advanced');
      }
      setCommentModal(null);
      setComment('');
      refetchAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAdd = useCallback(async (prod: any) => {
    if (addingItem) return;
    const existingIds = (po?.items || []).map((i: Item) => i.product_master_id).filter(Boolean);
    if (existingIds.includes(prod.id)) {
      const ok = window.confirm(`${prod.product_code} is already in this PO. Add it again?`);
      if (!ok) return;
    }
    setAddingItem(true);
    try {
      await api.post(`/purchase-orders/${id}/items`, {
        product_master_id: prod.id,
        quantity: 1,
        cost_price: prod.cost_price != null ? parseFloat(prod.cost_price) : null,
        sell_price: prod.sell_price != null ? parseFloat(prod.sell_price) : null,
        currency: prod.currency || 'USD',
        notes: null,
        system_id: null,
      });
      toast.success(`${prod.product_code} added`);
      setProductSearch('');
      refetch();
      setTimeout(() => addItemSearchRef.current?.focus(), 50);
    } catch {
      toast.error('Failed to add item');
    } finally {
      setAddingItem(false);
    }
  }, [id, addingItem, refetch, po?.items]);

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm('Remove this item?')) return;
    await api.delete(`/purchase-orders/${id}/items/${itemId}`);
    toast.success('Item removed');
    refetch();
  };

  const formatCurrency = (amount: number | null, from: string) => {
    const converted = convertAmount(amount, from, displayCurrency, rates);
    if (converted == null) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency, minimumFractionDigits: 2 }).format(converted);
  };

  const totalCost = (po?.items || []).reduce((sum: number, item: Item) => {
    const c = convertAmount(parseFloat(item.cost_price || '0'), item.currency, displayCurrency, rates);
    return sum + (c || 0) * parseFloat(item.quantity);
  }, 0);

  const totalSell = (po?.items || []).reduce((sum: number, item: Item) => {
    const c = convertAmount(parseFloat(item.sell_price || '0'), item.currency, displayCurrency, rates);
    return sum + (c || 0) * parseFloat(item.quantity);
  }, 0);

  const totalMargin = totalSell - totalCost;
  const marginPct = totalCost > 0 ? (totalMargin / totalCost) * 100 : 0;

  const itemMargin = (item: Item) => {
    const s = convertAmount(parseFloat(item.sell_price || '0'), item.currency, displayCurrency, rates) || 0;
    const c = convertAmount(parseFloat(item.cost_price || '0'), item.currency, displayCurrency, rates) || 0;
    return (s - c) * parseFloat(item.quantity);
  };

  const formatTotal = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency, minimumFractionDigits: 2 }).format(val);

  if (isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!po) return <div className="p-8 text-slate-400">PO not found</div>;

  const statusMeta = STATUS_META[po.status] || { label: po.status, color: '', dot: '' };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={<span className="flex items-center gap-2"><EntityCode code={po.po_code} /><POStatusBadge status={po.status} /></span>}
        subtitle={po.project_name ? `${po.project_code} — ${po.project_name}` : 'No project linked'}
        crumbs={[
          { label: 'Order Management', href: '/order-management' },
          { label: 'Purchase Orders', href: '/purchase-orders' },
          { label: po.po_code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={displayCurrency}
              onChange={e => setDisplayCurrency(e.target.value)}
              className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-600"
              title="Display currency"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {isDraft && (
              <Button variant="primary" onClick={() => handleAction('submit')}>
                <ArrowRight className="w-4 h-4" />Submit
              </Button>
            )}
            {isPending && canApprove && (
              <>
                <Button variant="primary" onClick={() => setCommentModal('approve')}>
                  <CheckCircle className="w-4 h-4" />Approve
                </Button>
                <Button onClick={() => setCommentModal('reject')}>
                  <XCircle className="w-4 h-4" />Reject
                </Button>
              </>
            )}
            {hasNextStage && canManage && (
              <Button variant="primary" onClick={() => setCommentModal('advance')}>
                <ArrowRight className="w-4 h-4" />Advance Stage
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-5 bg-[#F1F4F8]">
        {/* Lifecycle bar */}
        <div className="bg-white border border-slate-200 rounded-lg px-5 pt-4 pb-5">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Lifecycle</div>
          <LifecycleBar status={po.status} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Left: meta + systems + designated */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">Details</div>
              <div className="px-4 py-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <POStatusBadge status={po.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Project</span>
                  <span className="font-medium text-right">{po.project_name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created by</span>
                  <span className="text-right">{po.created_by_name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created</span>
                  <span className="text-slate-500">{new Date(po.created_at).toLocaleDateString()}</span>
                </div>
                {po.approved_by_name && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Approved by</span>
                    <span className="text-right">{po.approved_by_name}</span>
                  </div>
                )}
                {po.approved_at && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Approved</span>
                    <span className="text-slate-500">{new Date(po.approved_at).toLocaleDateString()}</span>
                  </div>
                )}
                {po.notes && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-400 mb-1">Notes</div>
                    <div className="text-slate-700 text-sm">{po.notes}</div>
                  </div>
                )}
                {po.document_url && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" />Attachment</div>
                    <a
                      href={po.document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline truncate"
                    >
                      <FileText className="w-3 h-3 shrink-0" />
                      {po.document_name || 'View Document'}
                    </a>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Right: items + history */}
          <div className="md:col-span-2 space-y-4">
            {/* Line items */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-slate-400" />
                  Line Items ({po.items?.length || 0})
                  {savedAt && (
                    <span className="text-[10px] font-normal text-green-600 flex items-center gap-0.5 ml-1">
                      <CheckCircle className="w-3 h-3" /> Saved
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  {displayCurrency !== 'USD' && rateDate && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600" title={`Exchange rates as of ${rateDate}`}>
                      <RefreshCw className="w-3 h-3" />
                      Rate {rateDate}
                    </span>
                  )}
                  <span className="text-xs text-slate-400">Totals in <span className="font-medium text-slate-600">{displayCurrency}</span></span>
                  {isDraft && (
                    <button onClick={() => setShowAddItem(v => !v)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                      <Plus className="w-3 h-3" />Add Item
                    </button>
                  )}
                </div>
              </div>

              {showAddItem && (
                <div className="border-b border-slate-100 bg-slate-50">
                  <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Quick Add Items</span>
                    <button onClick={() => setShowAddItem(false)} className="text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="px-4 pb-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      <input
                        ref={addItemSearchRef}
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        placeholder="Type product name or code to add…"
                        className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        disabled={addingItem}
                      />
                    </div>
                    {productSearch.length >= 1 && (
                      <div className="mt-1.5 border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden divide-y divide-slate-50 max-h-52 overflow-y-auto">
                        {(productSearchResults?.items || []).length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-400 text-center">No products found</div>
                        ) : (
                          (productSearchResults?.items || []).map((p: any) => (
                            <button
                              key={p.id}
                              onClick={() => handleQuickAdd(p)}
                              disabled={addingItem}
                              className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-blue-50 transition-colors group disabled:opacity-50"
                            >
                              <EntityCode code={p.product_code} />
                              <span className="flex-1 text-sm text-slate-700 truncate group-hover:text-blue-700">{p.product_name}</span>
                              {p.sell_price && (
                                <span className="text-xs text-slate-400 shrink-0">
                                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency || 'USD' }).format(parseFloat(p.sell_price))}
                                </span>
                              )}
                              <Plus className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 shrink-0" />
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    {productSearch.length === 0 && (
                      <p className="text-xs text-slate-400 mt-1.5 px-1">Click any product to add it instantly. Adjust qty &amp; price by clicking the cells in the table.</p>
                    )}
                  </div>
                </div>
              )}

              {po.items?.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400 text-center">No items yet</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Product</th>
                          <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">System</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Qty</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Cost ({displayCurrency})</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Sell ({displayCurrency})</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Total Sell</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Margin</th>
                          {isDraft && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {po.items.map((item: Item) => {
                          const isEditingQty = inlineEdit?.itemId === item.id && inlineEdit.field === 'quantity';
                          const isEditingCost = inlineEdit?.itemId === item.id && inlineEdit.field === 'cost_price';
                          const isEditingSell = inlineEdit?.itemId === item.id && inlineEdit.field === 'sell_price';
                          const margin = itemMargin(item);
                          return (
                            <tr key={item.id} className="hover:bg-slate-50 group">
                              <td className="px-4 py-3">
                                {item.product_code
                                  ? <span className="flex items-center gap-1.5">
                                      <EntityCode code={item.product_code} />
                                      <span className="text-slate-600 text-xs truncate max-w-[160px]">{item.product_name}</span>
                                    </span>
                                  : <span className="text-slate-400 text-xs">Unknown product</span>
                                }
                                {item.notes && <div className="text-xs text-slate-400 mt-0.5">{item.notes}</div>}
                              </td>
                              <td className="px-3 py-3">
                                <div
                                  className={isDraft ? 'cursor-pointer group/sysCell flex items-center gap-1 min-w-[90px]' : 'flex items-center gap-1'}
                                  onClick={isDraft ? e => {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setSystemEdit({ itemId: item.id, pos: { top: rect.bottom + 4, left: rect.left } });
                                  } : undefined}
                                >
                                  {item.system_code
                                    ? <>
                                        <EntityCode code={item.system_code} />
                                        <span className="text-slate-500 text-xs truncate max-w-[100px]">{item.system_name}</span>
                                      </>
                                    : <span className={`text-xs ${isDraft ? 'text-slate-300 group-hover/sysCell:text-blue-400' : 'text-slate-300'}`}>
                                        {isDraft ? 'Add system…' : '—'}
                                      </span>
                                  }
                                  {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/sysCell:opacity-40 ml-auto shrink-0" />}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-xs">
                                {isEditingQty ? (
                                  <input autoFocus type="number" min="0" step="any"
                                    value={inlineEdit!.value}
                                    onChange={e => setInlineEdit(v => v ? { ...v, value: e.target.value } : v)}
                                    onBlur={handleSaveInline}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveInline(); if (e.key === 'Escape') setInlineEdit(null); }}
                                    className="w-20 border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                                  />
                                ) : (
                                  <span
                                    className={isDraft ? 'cursor-pointer hover:text-blue-600 flex items-center justify-end gap-1 group/cell' : ''}
                                    onClick={() => isDraft && setInlineEdit({ itemId: item.id, field: 'quantity', value: item.quantity })}
                                  >
                                    {parseFloat(item.quantity).toFixed(2)}
                                    {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/cell:opacity-40" />}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-xs text-slate-600">
                                <div className="flex items-center justify-end gap-1.5">
                                  {currencyEdit === item.id ? (
                                    <select
                                      autoFocus
                                      value={item.currency}
                                      onChange={e => handleCurrencyChange(item.id, e.target.value)}
                                      onBlur={() => setCurrencyEdit(null)}
                                      className="text-xs border border-blue-400 rounded px-1 py-0.5 bg-white focus:outline-none"
                                    >
                                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  ) : (
                                    <span
                                      onClick={isDraft ? () => setCurrencyEdit(item.id) : undefined}
                                      title={isDraft ? 'Click to change currency' : item.currency}
                                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded select-none ${isDraft ? 'bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-500 cursor-pointer' : 'bg-slate-50 text-slate-400'}`}
                                    >
                                      {item.currency}
                                    </span>
                                  )}
                                  {isEditingCost ? (
                                    <input autoFocus type="number" min="0" step="any"
                                      value={inlineEdit!.value}
                                      onChange={e => setInlineEdit(v => v ? { ...v, value: e.target.value } : v)}
                                      onBlur={handleSaveInline}
                                      onKeyDown={e => { if (e.key === 'Enter') handleSaveInline(); if (e.key === 'Escape') setInlineEdit(null); }}
                                      className="w-24 border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                                    />
                                  ) : (
                                    <span
                                      className={isDraft ? 'cursor-pointer hover:text-blue-600 flex items-center justify-end gap-1 group/cell' : ''}
                                      onClick={() => isDraft && setInlineEdit({ itemId: item.id, field: 'cost_price', value: item.cost_price || '' })}
                                    >
                                      {formatCurrency(parseFloat(item.cost_price || '0'), item.currency)}
                                      {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/cell:opacity-40" />}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right text-xs text-slate-600">
                                {isEditingSell ? (
                                  <input autoFocus type="number" min="0" step="any"
                                    value={inlineEdit!.value}
                                    onChange={e => setInlineEdit(v => v ? { ...v, value: e.target.value } : v)}
                                    onBlur={handleSaveInline}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveInline(); if (e.key === 'Escape') setInlineEdit(null); }}
                                    className="w-24 border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                                  />
                                ) : (
                                  <span
                                    className={isDraft ? 'cursor-pointer hover:text-blue-600 flex items-center justify-end gap-1 group/cell' : ''}
                                    onClick={() => isDraft && setInlineEdit({ itemId: item.id, field: 'sell_price', value: item.sell_price || '' })}
                                  >
                                    {formatCurrency(parseFloat(item.sell_price || '0'), item.currency)}
                                    {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/cell:opacity-40" />}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-xs font-medium text-slate-800">
                                {formatCurrency(parseFloat(item.sell_price || '0') * parseFloat(item.quantity), item.currency)}
                              </td>
                              <td className={`px-3 py-3 text-right text-xs font-medium ${margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {formatTotal(margin)}
                              </td>
                              {isDraft && (
                                <td className="px-2 py-3">
                                  <button onClick={() => handleDeleteItem(item.id)} className="text-red-300 hover:text-red-500">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50">
                          <td colSpan={3} className="px-4 py-2.5 text-xs font-medium text-slate-500 text-right">Totals</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">{formatTotal(totalCost)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700" />
                          <td className="px-3 py-2.5 text-right text-sm font-bold text-blue-600">{formatTotal(totalSell)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold">
                            <span className={totalMargin >= 0 ? 'text-green-600' : 'text-red-500'}>
                              {formatTotal(totalMargin)}
                            </span>
                            <span className="text-slate-400 ml-1">({marginPct.toFixed(1)}%)</span>
                          </td>
                          {isDraft && <td />}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Lifecycle history */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />History
              </div>
              <div className="divide-y divide-slate-50">
                {po.history?.length === 0
                  ? <div className="px-4 py-4 text-sm text-slate-400">No history</div>
                  : po.history.map((h: any) => (
                    <div key={h.id} className="px-4 py-3 flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-600/40 mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {h.from_status
                            ? <><span className="text-xs text-slate-400">{STATUS_META[h.from_status]?.label || h.from_status}</span>
                                <ChevronRight className="w-3 h-3 text-slate-300" />
                                <span className="text-xs font-medium text-slate-700">{STATUS_META[h.to_status]?.label || h.to_status}</span></>
                            : <span className="text-xs font-medium text-slate-700">{STATUS_META[h.to_status]?.label || h.to_status}</span>
                          }
                          <span className="text-xs text-slate-400">· {h.actor_name}</span>
                        </div>
                        {h.comment && <div className="text-xs text-slate-500 mt-0.5">{h.comment}</div>}
                        <div className="text-xs text-slate-300 mt-0.5">{new Date(h.changed_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Inline system picker popup */}
      {systemEdit && (
        <div
          id="sys-picker-popup"
          style={{ position: 'fixed', top: systemEdit.pos.top, left: systemEdit.pos.left, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-xl shadow-2xl w-72 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={sysEditRef}
              value={itemSysSearch}
              onChange={e => setItemSysSearch(e.target.value)}
              placeholder="Search system to link…"
              className="flex-1 text-sm focus:outline-none bg-transparent"
            />
            <button onClick={() => setSystemEdit(null)} className="text-slate-400 hover:text-slate-600 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-50">
            {(() => {
              const currentItem = (po?.items || []).find((i: Item) => i.id === systemEdit.itemId);
              return (
                <>
                  {currentItem?.system_code && (
                    <button
                      onClick={() => handleSaveSystem(systemEdit.itemId, null)}
                      className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-1.5"
                    >
                      <X className="w-3 h-3" />Unlink system
                    </button>
                  )}
                  {itemSysSearch.length >= 1 && (itemSysResults?.items || []).length === 0 && (
                    <div className="px-3 py-3 text-xs text-slate-400 text-center">No systems found</div>
                  )}
                  {(itemSysResults?.items || []).map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => handleSaveSystem(systemEdit.itemId, s.id)}
                      className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-blue-50 transition-colors group"
                    >
                      <EntityCode code={s.system_code} />
                      <span className="flex-1 text-xs text-slate-700 truncate group-hover:text-blue-700">{s.system_name}</span>
                      <span className="text-xs text-slate-300 shrink-0">{s.project_code}</span>
                    </button>
                  ))}
                  {itemSysSearch.length === 0 && (
                    <div className="px-3 py-3 text-xs text-slate-400 text-center">Type to search systems…</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {commentModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-5">
            <h3 className="font-semibold mb-1">
              {commentModal === 'approve' ? 'Approve PO' : commentModal === 'reject' ? 'Reject / Send Back' : 'Advance Stage'}
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              {commentModal === 'approve' ? `Approve ${po.po_code} and move to Purchase Order status.`
                : commentModal === 'reject' ? 'Send this PO back to Draft for corrections.'
                : `Advance ${po.po_code} to the next stage.`}
            </p>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add a comment (optional)…"
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600 resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => { setCommentModal(null); setComment(''); }}>Cancel</Button>
              <Button variant="primary" onClick={() => handleAction(commentModal)} disabled={saving}>
                {saving ? '…' : commentModal === 'approve' ? 'Approve' : commentModal === 'reject' ? 'Send Back' : 'Advance'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
