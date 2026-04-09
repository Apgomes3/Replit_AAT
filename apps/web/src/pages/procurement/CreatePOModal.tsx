import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import EntityCode from '../../components/ui/EntityCode';
import { X, Trash2, Search, Package } from 'lucide-react';
import Button from '../../components/ui/Button';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY'];

type DraftItem = {
  key: number;
  product_master_id: string;
  product_code: string;
  product_name: string;
  quantity: string;
  cost_price: string;
  sell_price: string;
  currency: string;
  notes: string;
  system_id: string;
  system_code: string;
  system_name: string;
};

export default function CreatePOModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [projectCode, setProjectCode] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Items
  const [items, setItems] = useState<DraftItem[]>([]);
  const [itemKey, setItemKey] = useState(0);
  const [productSearch, setProductSearch] = useState('');
  const [showProductResults, setShowProductResults] = useState(false);

  // Per-item system search
  const [activeSystemItemKey, setActiveSystemItemKey] = useState<number | null>(null);
  const [itemSystemSearch, setItemSystemSearch] = useState<Record<number, string>>({});

  const activeSystemQuery = activeSystemItemKey !== null ? (itemSystemSearch[activeSystemItemKey] || '') : '';

  const { data: projectsData } = useQuery({
    queryKey: ['projects-list-createpo'],
    queryFn: () => api.get('/projects?page_size=200').then(r => r.data),
  });

  const { data: productsData } = useQuery({
    queryKey: ['po-products-search', productSearch],
    queryFn: () => api.get(`/product-masters?q=${encodeURIComponent(productSearch)}&page_size=30`).then(r => r.data),
    enabled: productSearch.length >= 1,
  });

  const { data: itemSystemResults } = useQuery({
    queryKey: ['item-system-search', activeSystemQuery],
    queryFn: () => api.get(`/purchase-orders/systems-search?q=${encodeURIComponent(activeSystemQuery)}&page_size=15`).then(r => r.data),
    enabled: activeSystemQuery.length >= 1,
  });

  const addItem = (prod: any) => {
    setItems(prev => [...prev, {
      key: itemKey,
      product_master_id: prod.id,
      product_code: prod.product_code,
      product_name: prod.product_name,
      quantity: '1',
      cost_price: prod.cost_price != null ? String(prod.cost_price) : '',
      sell_price: prod.sell_price != null ? String(prod.sell_price) : '',
      currency: prod.currency || 'USD',
      notes: '',
      system_id: '',
      system_code: '',
      system_name: '',
    }]);
    setItemKey(k => k + 1);
    setProductSearch('');
    setShowProductResults(false);
  };

  const updateItem = (key: number, fields: Partial<DraftItem>) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, ...fields } : i));
  };

  const removeItem = (key: number) => {
    setItems(prev => prev.filter(i => i.key !== key));
    if (activeSystemItemKey === key) setActiveSystemItemKey(null);
  };

  const selectSystem = (itemKey: number, sys: { id: string; system_code: string; system_name: string }) => {
    updateItem(itemKey, { system_id: sys.id, system_code: sys.system_code, system_name: sys.system_name });
    setActiveSystemItemKey(null);
    setItemSystemSearch(prev => ({ ...prev, [itemKey]: '' }));
  };

  const clearSystem = (itemKey: number) => {
    updateItem(itemKey, { system_id: '', system_code: '', system_name: '' });
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const proj = projectsData?.items?.find((p: any) => p.project_code === projectCode);
      const poRes = await api.post('/purchase-orders', {
        project_id: proj?.id || null,
        notes: notes || null,
      });
      const poId = poRes.data.id;

      for (const item of items) {
        await api.post(`/purchase-orders/${poId}/items`, {
          product_master_id: item.product_master_id,
          quantity: parseFloat(item.quantity) || 1,
          cost_price: item.cost_price !== '' ? parseFloat(item.cost_price) : null,
          sell_price: item.sell_price !== '' ? parseFloat(item.sell_price) : null,
          currency: item.currency || 'USD',
          notes: item.notes || null,
          system_id: item.system_id || null,
        });
      }

      toast.success(`${poRes.data.po_code} created with ${items.length} item${items.length !== 1 ? 's' : ''}`);
      navigate(`/purchase-orders/${poId}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to create PO');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">New Purchase Order</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Basic info */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Basic Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Project</label>
                <select
                  value={projectCode}
                  onChange={e => setProjectCode(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-600"
                >
                  <option value="">— None —</option>
                  {(projectsData?.items || []).map((p: any) => (
                    <option key={p.id} value={p.project_code}>{p.project_code} — {p.project_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes / Description</label>
                <input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional description…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
              <Package className="w-3.5 h-3.5" />Line Items ({items.length})
            </h3>

            {/* Product search to add new item */}
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  value={productSearch}
                  onChange={e => { setProductSearch(e.target.value); setShowProductResults(true); }}
                  onFocus={() => { setShowProductResults(true); setActiveSystemItemKey(null); }}
                  placeholder="Search product by code or name to add…"
                  className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </div>
              {showProductResults && productSearch.length >= 1 && (productsData?.items || []).length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-44 overflow-y-auto divide-y divide-slate-50">
                  {(productsData?.items || []).map((p: any) => (
                    <button key={p.id} onClick={() => addItem(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2">
                      <EntityCode code={p.product_code} />
                      <span className="text-slate-600 truncate">{p.product_name}</span>
                      {p.sell_price && <span className="text-xs text-slate-400 ml-auto shrink-0">{parseFloat(p.sell_price).toFixed(2)} {p.currency || 'USD'}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Items list */}
            {items.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">No items added yet — search for a product above</p>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-visible divide-y divide-slate-100">
                {items.map(item => (
                  <div key={item.key} className="p-3 bg-white">
                    {/* Row 1: product + remove */}
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <EntityCode code={item.product_code} />
                        <span className="text-sm text-slate-700 font-medium truncate">{item.product_name}</span>
                      </div>
                      <button onClick={() => removeItem(item.key)} className="text-red-300 hover:text-red-500 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Row 2: System picker */}
                    <div className="mb-2.5">
                      <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">System</label>
                      {item.system_id ? (
                        <div className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                          <EntityCode code={item.system_code} />
                          <span>{item.system_name}</span>
                          <button onClick={() => clearSystem(item.key)} className="text-blue-400 hover:text-red-500 ml-0.5">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                          <input
                            value={activeSystemItemKey === item.key ? (itemSystemSearch[item.key] || '') : ''}
                            onChange={e => {
                              setActiveSystemItemKey(item.key);
                              setItemSystemSearch(prev => ({ ...prev, [item.key]: e.target.value }));
                            }}
                            onFocus={() => setActiveSystemItemKey(item.key)}
                            placeholder="Search system to link…"
                            className="w-full border border-slate-200 rounded pl-6 pr-3 py-1 text-xs focus:outline-none focus:border-amber-600"
                          />
                          {activeSystemItemKey === item.key && activeSystemQuery.length >= 1 && (itemSystemResults?.items || []).length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-36 overflow-y-auto divide-y divide-slate-50">
                              {(itemSystemResults?.items || []).map((s: any) => (
                                <button key={s.id} onClick={() => selectSystem(item.key, s)}
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

                    {/* Row 3: Qty / Cost / Sell / Currency */}
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Qty</label>
                        <input type="number" min="0" step="any" value={item.quantity}
                          onChange={e => updateItem(item.key, { quantity: e.target.value })}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Cost</label>
                        <input type="number" min="0" step="any" placeholder="0.00" value={item.cost_price}
                          onChange={e => updateItem(item.key, { cost_price: e.target.value })}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Sell</label>
                        <input type="number" min="0" step="any" placeholder="0.00" value={item.sell_price}
                          onChange={e => updateItem(item.key, { sell_price: e.target.value })}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Currency</label>
                        <select value={item.currency} onChange={e => updateItem(item.key, { currency: e.target.value })}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-amber-600">
                          {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <input placeholder="Notes (optional)" value={item.notes}
                      onChange={e => updateItem(item.key, { notes: e.target.value })}
                      className="mt-2 w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-600" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <div className="text-xs text-slate-400">
            {items.length > 0 && <span>{items.length} item{items.length > 1 ? 's' : ''}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleCreate} disabled={saving}>
              {saving ? 'Creating…' : 'Create Purchase Order'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
