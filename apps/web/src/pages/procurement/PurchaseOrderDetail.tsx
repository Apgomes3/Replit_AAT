import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import EntityCode from '../../components/ui/EntityCode';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import {
  Package, CheckCircle, XCircle, ArrowRight, Plus, Trash2, Users, Clock, ChevronRight, Search, Link2, X
} from 'lucide-react';

const STAGES = ['draft', 'pending_approval', 'purchase_order', 'po_review', 'engineering_review', 'released'];

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  draft:              { label: 'Draft',              color: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400' },
  pending_approval:   { label: 'Pending Approval',   color: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-400' },
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
              <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${active ? 'border-amber-600 bg-amber-600' : done ? 'border-amber-600 bg-amber-600/30' : 'border-slate-200 bg-white'}`} />
              <span className={`text-[10px] mt-1 text-center leading-tight hidden sm:block ${active ? 'text-amber-600 font-semibold' : done ? 'text-slate-400' : 'text-slate-300'}`}>
                {meta?.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-0.5 flex-1 ${i < idx ? 'bg-amber-600/40' : 'bg-slate-100'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function useExchangeRates(base: string) {
  const [rates, setRates] = useState<Record<string, number>>({ [base]: 1 });
  useEffect(() => {
    if (!base) return;
    fetch(`https://api.frankfurter.app/latest?from=${base}`)
      .then(r => r.json())
      .then(d => setRates({ ...d.rates, [base]: 1 }))
      .catch(() => {});
  }, [base]);
  return rates;
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
  const rates = useExchangeRates('USD');

  const [commentModal, setCommentModal] = useState<null | 'approve' | 'reject' | 'advance'>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const [showAddItem, setShowAddItem] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [itemCostPrice, setItemCostPrice] = useState('');
  const [itemSellPrice, setItemSellPrice] = useState('');
  const [itemCurrency, setItemCurrency] = useState('USD');
  const [itemNotes, setItemNotes] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [itemSystemId, setItemSystemId] = useState('');
  const [itemSystemCode, setItemSystemCode] = useState('');
  const [itemSystemName, setItemSystemName] = useState('');
  const [addItemSystemSearch, setAddItemSystemSearch] = useState('');
  const [showAddItemSystemResults, setShowAddItemSystemResults] = useState(false);

  const [showDesignated, setShowDesignated] = useState(false);
  const [designatedUserId, setDesignatedUserId] = useState('');

  // Systems management
  const [systemSearch, setSystemSearch] = useState('');
  const [showSystemResults, setShowSystemResults] = useState(false);
  const [savingSystems, setSavingSystems] = useState(false);

  const { data: po, isLoading, refetch } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/purchase-orders/${id}`).then(r => r.data),
  });

  const { data: allProducts } = useQuery({
    queryKey: ['products-list-po'],
    queryFn: () => api.get('/product-masters?page_size=500').then(r => r.data),
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users-list-po'],
    queryFn: () => api.get('/purchase-orders/users').then(r => r.data),
  });

  const { data: systemSearchResults } = useQuery({
    queryKey: ['po-systems-search-detail', systemSearch],
    queryFn: () => api.get(`/purchase-orders/systems-search?q=${encodeURIComponent(systemSearch)}&page_size=20`).then(r => r.data),
    enabled: systemSearch.length >= 1,
  });

  const { data: addItemSystemResults } = useQuery({
    queryKey: ['add-item-system-search', addItemSystemSearch],
    queryFn: () => api.get(`/purchase-orders/systems-search?q=${encodeURIComponent(addItemSystemSearch)}&page_size=15`).then(r => r.data),
    enabled: addItemSystemSearch.length >= 1,
  });

  useEffect(() => {
    localStorage.setItem('preferred_currency', displayCurrency);
  }, [displayCurrency]);

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

  const handleAddItem = async () => {
    if (!selectedProductId || addingItem) return;
    setAddingItem(true);
    try {
      const prod = (allProducts?.items || []).find((p: any) => p.id === selectedProductId);
      await api.post(`/purchase-orders/${id}/items`, {
        product_master_id: selectedProductId,
        quantity: parseFloat(itemQty) || 1,
        cost_price: itemCostPrice ? parseFloat(itemCostPrice) : (prod?.cost_price || null),
        sell_price: itemSellPrice ? parseFloat(itemSellPrice) : (prod?.sell_price || null),
        currency: itemCurrency,
        notes: itemNotes || null,
        system_id: itemSystemId || null,
      });
      toast.success('Item added');
      setShowAddItem(false);
      setSelectedProductId(''); setProductSearch(''); setItemQty('1');
      setItemCostPrice(''); setItemSellPrice(''); setItemNotes('');
      setItemSystemId(''); setItemSystemCode(''); setItemSystemName('');
      setAddItemSystemSearch(''); setShowAddItemSystemResults(false);
      refetch();
    } finally {
      setAddingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm('Remove this item?')) return;
    await api.delete(`/purchase-orders/${id}/items/${itemId}`);
    toast.success('Item removed');
    refetch();
  };

  const handleAddDesignated = async () => {
    if (!designatedUserId) return;
    await api.post(`/purchase-orders/${id}/designated-users`, { user_id: designatedUserId });
    toast.success('User added');
    setDesignatedUserId('');
    refetch();
  };

  const handleRemoveDesignated = async (userId: string) => {
    await api.delete(`/purchase-orders/${id}/designated-users/${userId}`);
    toast.success('User removed');
    refetch();
  };

  const handleAddSystem = async (system: { id: string; system_code: string; system_name: string }) => {
    setSavingSystems(true);
    setSystemSearch('');
    setShowSystemResults(false);
    try {
      const currentIds = (po?.systems || []).map((s: any) => s.id);
      if (currentIds.includes(system.id)) return;
      await api.put(`/purchase-orders/${id}`, {
        project_id: po?.project_id || null,
        notes: po?.notes || null,
        system_ids: [...currentIds, system.id],
      });
      toast.success(`${system.system_code} linked`);
      refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to link system');
    } finally {
      setSavingSystems(false);
    }
  };

  const handleRemoveSystem = async (systemId: string) => {
    setSavingSystems(true);
    try {
      const currentIds = (po?.systems || []).map((s: any) => s.id).filter((sid: string) => sid !== systemId);
      await api.put(`/purchase-orders/${id}`, {
        project_id: po?.project_id || null,
        notes: po?.notes || null,
        system_ids: currentIds,
      });
      toast.success('System unlinked');
      refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to unlink system');
    } finally {
      setSavingSystems(false);
    }
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
        back="/purchase-orders"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={displayCurrency}
              onChange={e => setDisplayCurrency(e.target.value)}
              className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-600"
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
              </div>
            </div>

            {/* Systems */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-slate-400" />Systems ({po.systems?.length || 0})
                </span>
                {savingSystems && <span className="text-xs text-slate-400">Saving…</span>}
              </div>
              <div className="px-4 py-3 space-y-2">
                {po.systems?.length === 0 && !isDraft
                  ? <p className="text-sm text-slate-400">No systems linked</p>
                  : po.systems?.map((s: any) => (
                    <div key={s.id} className="flex items-center gap-1.5 text-sm">
                      <EntityCode code={s.system_code} />
                      <span className="text-slate-600 flex-1 truncate">{s.system_name}</span>
                      {isDraft && (
                        <button onClick={() => handleRemoveSystem(s.id)} className="text-red-300 hover:text-red-500 shrink-0" title="Unlink">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                }
                {isDraft && (
                  <div className="relative pt-1">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                      <input
                        value={systemSearch}
                        onChange={e => { setSystemSearch(e.target.value); setShowSystemResults(true); }}
                        onFocus={() => setShowSystemResults(true)}
                        placeholder="Add system…"
                        className="w-full border border-slate-200 rounded pl-6 pr-3 py-1.5 text-xs focus:outline-none focus:border-amber-600"
                      />
                    </div>
                    {showSystemResults && systemSearch.length >= 1 && (systemSearchResults?.items || []).length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-36 overflow-y-auto divide-y divide-slate-50">
                        {(systemSearchResults?.items || [])
                          .filter((s: any) => !po.systems?.find((x: any) => x.id === s.id))
                          .map((s: any) => (
                            <button key={s.id} onClick={() => handleAddSystem(s)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2">
                              <EntityCode code={s.system_code} />
                              <span className="text-slate-600 truncate">{s.system_name}</span>
                              <span className="text-slate-300 ml-auto shrink-0">{s.project_code}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Designated users */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-400" />Designated Users
                </span>
                {canManage && (
                  <button onClick={() => setShowDesignated(v => !v)} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" />Add
                  </button>
                )}
              </div>
              <div className="px-4 py-3 space-y-2">
                {po.designated_users?.length === 0
                  ? <p className="text-sm text-slate-400">None added</p>
                  : po.designated_users.map((u: any) => (
                    <div key={u.user_id} className="flex items-center justify-between text-sm">
                      <span>{u.full_name} <span className="text-slate-400 text-xs">({u.role})</span></span>
                      {canManage && (
                        <button onClick={() => handleRemoveDesignated(u.user_id)} className="text-red-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                }
                {showDesignated && (
                  <div className="flex gap-2 pt-1">
                    <select
                      value={designatedUserId}
                      onChange={e => setDesignatedUserId(e.target.value)}
                      className="flex-1 border rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-600"
                    >
                      <option value="">— Select user —</option>
                      {(allUsers?.items || [])
                        .filter((u: any) => !po.designated_users?.find((d: any) => d.user_id === u.id))
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.role})</option>
                        ))}
                    </select>
                    <Button size="sm" variant="primary" onClick={handleAddDesignated} disabled={!designatedUserId}>Add</Button>
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
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">Totals in <span className="font-medium text-slate-600">{displayCurrency}</span></span>
                  {isDraft && (
                    <button onClick={() => setShowAddItem(v => !v)} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                      <Plus className="w-3 h-3" />Add Item
                    </button>
                  )}
                </div>
              </div>

              {showAddItem && (
                <div className="px-4 py-4 border-b border-slate-100 bg-slate-50 space-y-3">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Add Line Item</div>
                  <input
                    value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setSelectedProductId(''); }}
                    placeholder="Search product by code or name…"
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-600"
                  />
                  {productSearch.length >= 1 && (
                    <div className="border rounded max-h-32 overflow-y-auto divide-y bg-white">
                      {(allProducts?.items || [])
                        .filter((p: any) => p.product_code?.toLowerCase().includes(productSearch.toLowerCase()) || p.product_name?.toLowerCase().includes(productSearch.toLowerCase()))
                        .slice(0, 15)
                        .map((p: any) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setSelectedProductId(p.id);
                              setProductSearch(p.product_code + ' – ' + p.product_name);
                              setItemCostPrice(p.cost_price ?? '');
                              setItemSellPrice(p.sell_price ?? '');
                              setItemCurrency(p.currency || 'USD');
                            }}
                            className={`w-full text-left px-3 py-2 text-sm flex gap-2 hover:bg-slate-50 ${selectedProductId === p.id ? 'bg-blue-50' : ''}`}
                          >
                            <EntityCode code={p.product_code} />
                            <span className="text-slate-600 truncate">{p.product_name}</span>
                          </button>
                        ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label className="text-xs text-slate-500">Qty</label>
                      <input value={itemQty} onChange={e => setItemQty(e.target.value)} type="number" min="0" step="any"
                        className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 focus:outline-none focus:border-amber-600" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Cost Price</label>
                      <input value={itemCostPrice} onChange={e => setItemCostPrice(e.target.value)} type="number" min="0" step="any" placeholder="0.00"
                        className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 focus:outline-none focus:border-amber-600" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Sell Price</label>
                      <input value={itemSellPrice} onChange={e => setItemSellPrice(e.target.value)} type="number" min="0" step="any" placeholder="0.00"
                        className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 focus:outline-none focus:border-amber-600" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Currency</label>
                      <select value={itemCurrency} onChange={e => setItemCurrency(e.target.value)}
                        className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 bg-white focus:outline-none focus:border-amber-600">
                        {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  {/* System picker */}
                  <div>
                    <label className="text-xs text-slate-500">System</label>
                    {itemSystemId ? (
                      <div className="mt-0.5 inline-flex items-center gap-1.5 bg-blue-50 border border-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                        <EntityCode code={itemSystemCode} />
                        <span>{itemSystemName}</span>
                        <button onClick={() => { setItemSystemId(''); setItemSystemCode(''); setItemSystemName(''); }} className="text-blue-400 hover:text-red-500 ml-0.5">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative mt-0.5">
                        <input
                          value={addItemSystemSearch}
                          onChange={e => { setAddItemSystemSearch(e.target.value); setShowAddItemSystemResults(true); }}
                          onFocus={() => setShowAddItemSystemResults(true)}
                          placeholder="Search system to link (optional)…"
                          className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-600"
                        />
                        {showAddItemSystemResults && addItemSystemSearch.length >= 1 && (addItemSystemResults?.items || []).length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded shadow-lg z-10 max-h-36 overflow-y-auto divide-y">
                            {(addItemSystemResults?.items || []).map((s: any) => (
                              <button key={s.id} onClick={() => {
                                setItemSystemId(s.id); setItemSystemCode(s.system_code); setItemSystemName(s.system_name);
                                setAddItemSystemSearch(''); setShowAddItemSystemResults(false);
                              }} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50">
                                <EntityCode code={s.system_code} />
                                <span className="text-slate-600 truncate">{s.system_name}</span>
                                <span className="text-slate-300 ml-auto text-xs">{s.project_code}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <input value={itemNotes} onChange={e => setItemNotes(e.target.value)} placeholder="Notes (optional)"
                    className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-600" />
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={handleAddItem} disabled={!selectedProductId || addingItem}>
                      {addingItem ? '…' : 'Add Item'}
                    </Button>
                    <Button size="sm" onClick={() => {
                      setShowAddItem(false); setSelectedProductId(''); setProductSearch('');
                      setItemSystemId(''); setItemSystemCode(''); setItemSystemName('');
                      setAddItemSystemSearch(''); setShowAddItemSystemResults(false);
                    }}>Cancel</Button>
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
                          {isDraft && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {po.items.map((item: Item) => (
                          <tr key={item.id} className="hover:bg-slate-50">
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
                              {item.system_code
                                ? <span className="flex items-center gap-1">
                                    <EntityCode code={item.system_code} />
                                    <span className="text-slate-500 text-xs truncate max-w-[120px]">{item.system_name}</span>
                                  </span>
                                : <span className="text-slate-300 text-xs">—</span>
                              }
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs">{parseFloat(item.quantity).toFixed(2)}</td>
                            <td className="px-3 py-3 text-right text-xs text-slate-600">{formatCurrency(parseFloat(item.cost_price || '0'), item.currency)}</td>
                            <td className="px-3 py-3 text-right text-xs text-slate-600">{formatCurrency(parseFloat(item.sell_price || '0'), item.currency)}</td>
                            <td className="px-3 py-3 text-right text-xs font-medium text-slate-800">
                              {formatCurrency(parseFloat(item.sell_price || '0') * parseFloat(item.quantity), item.currency)}
                            </td>
                            {isDraft && (
                              <td className="px-2 py-3">
                                <button onClick={() => handleDeleteItem(item.id)} className="text-red-300 hover:text-red-500">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50">
                          <td colSpan={3} className="px-4 py-2.5 text-xs font-medium text-slate-500 text-right">Totals</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">{formatTotal(totalCost)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700" />
                          <td className="px-3 py-2.5 text-right text-sm font-bold text-amber-600">{formatTotal(totalSell)}</td>
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
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-600/40 mt-1.5 shrink-0" />
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

      {/* Comment modal for approve/reject/advance */}
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
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-600 resize-none"
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
