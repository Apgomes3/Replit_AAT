import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import EntityCode from '../../components/ui/EntityCode';
import { X, ShoppingCart, Lock } from 'lucide-react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY'];

type Item = {
  id: string;
  tag_code: string;
  description: string;
  product_master_id: string;
  product_code: string;
  product_name: string;
  cost: string | null;
  sell_price: string | null;
  quantity: number;
  unit: string;
  system_id: string | null;
  system_code: string | null;
  system_name: string | null;
  released_po_id: string | null;
  released_po_code: string | null;
  item_type: 'equipment' | 'tank';
};

export default function ProjectReleasePOModal({ projectId, projectCode, projectName, returnTo, onClose }: {
  projectId: string;
  projectCode: string;
  projectName?: string;
  returnTo: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['project-items-for-po', projectId],
    queryFn: () => api.get(`/projects/${projectId}/items-for-po`).then(r => r.data),
  });

  const equipment: Item[] = (data?.equipment || []).map((i: any) => ({ ...i, item_type: 'equipment' }));
  const tanks: Item[] = (data?.tanks || []).map((i: any) => ({ ...i, item_type: 'tank' }));
  const allItems = [...equipment, ...tanks];

  if (!initialized && allItems.length > 0) {
    const defaults: Record<string, boolean> = {};
    allItems.forEach(i => {
      defaults[i.id] = !i.released_po_id;
    });
    setSelected(defaults);
    setInitialized(true);
  }

  const availableItems = allItems.filter(i => !i.released_po_id);
  const lockedItems = allItems.filter(i => !!i.released_po_id);

  const toggleSection = (items: Item[], val: boolean) =>
    setSelected(prev => {
      const next = { ...prev };
      items.filter(i => !i.released_po_id).forEach(i => { next[i.id] = val; });
      return next;
    });

  const selectedCount = availableItems.filter(i => selected[i.id]).length;

  const handleCreate = async () => {
    const picked = availableItems.filter(i => selected[i.id]);
    if (picked.length === 0) { toast.error('Select at least one item'); return; }
    setSaving(true);
    try {
      const poRes = await api.post('/purchase-orders', {
        project_id: projectId,
        notes: notes || null,
      });
      const poId = poRes.data.id;
      await Promise.all(picked.map((item, idx) =>
        api.post(`/purchase-orders/${poId}/items`, {
          product_master_id: item.product_master_id,
          quantity: item.quantity,
          cost_price: item.cost != null ? parseFloat(item.cost) : null,
          sell_price: item.sell_price != null ? parseFloat(item.sell_price) : null,
          currency,
          notes: item.tag_code || null,
          system_id: item.system_id || null,
          sort_order: idx,
          project_equipment_item_id: item.item_type === 'equipment' ? item.id : null,
          tank_id: item.item_type === 'tank' ? item.id : null,
        })
      ));
      toast.success(`${poRes.data.po_code} created`);
      navigate(`/purchase-orders/${poId}`, { state: { returnTo, returnLabel: projectCode, projectId, projectCode, projectName } });
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to create PO');
      setSaving(false);
    }
  };

  const SectionHeader = ({ label, count, items }: { label: string; count: number; items: Item[] }) => {
    const free = items.filter(i => !i.released_po_id);
    const allOn = free.length > 0 && free.every(i => selected[i.id]);
    const someOn = free.some(i => selected[i.id]);
    return (
      <div className="flex items-center justify-between px-6 py-2 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          {free.length > 0 && (
            <input
              type="checkbox"
              checked={allOn}
              ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
              onChange={e => toggleSection(items, e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
          )}
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label} ({count})</span>
        </div>
        {free.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => toggleSection(items, true)} className="text-xs text-blue-600 hover:underline">All</button>
            <button onClick={() => toggleSection(items, false)} className="text-xs text-slate-400 hover:underline">None</button>
          </div>
        )}
      </div>
    );
  };

  const ItemRow = ({ item }: { item: Item }) => {
    const locked = !!item.released_po_id;
    return (
      <label className={`flex items-center gap-3 px-6 py-3 border-b border-slate-50 transition-colors ${
        locked ? 'bg-slate-50/60 cursor-default' : `cursor-pointer hover:bg-slate-50 ${selected[item.id] ? '' : 'opacity-50'}`
      }`}>
        {locked ? (
          <Lock className="w-4 h-4 text-slate-300 shrink-0" />
        ) : (
          <input
            type="checkbox"
            checked={!!selected[item.id]}
            onChange={e => setSelected(prev => ({ ...prev, [item.id]: e.target.checked }))}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <EntityCode code={item.tag_code} />
            {item.product_code && <EntityCode code={item.product_code} />}
            <span className="text-sm text-slate-700 truncate">{item.description || item.product_name}</span>
          </div>
          {item.system_code && (
            <div className="text-xs text-slate-400 mt-0.5">System: {item.system_code} — {item.system_name}</div>
          )}
          {locked && item.released_po_code && (
            <div className="flex items-center gap-1.5 mt-1">
              <Lock className="w-3 h-3 text-slate-400" />
              <span className="text-xs text-slate-500">Released in</span>
              <button
                type="button"
                onClick={e => {
                  e.preventDefault();
                  navigate(`/purchase-orders/${item.released_po_id}`, { state: { returnTo, returnLabel: projectCode, projectId, projectCode, projectName } });
                }}
                className="text-xs font-mono text-blue-600 hover:underline"
              >
                {item.released_po_code}
              </button>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-mono text-slate-600">{item.quantity} {item.unit}</div>
          {item.sell_price && !locked && (
            <div className="text-xs text-slate-400">{parseFloat(item.sell_price).toLocaleString()} {currency}</div>
          )}
          {locked && (
            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">In PO</span>
          )}
        </div>
      </label>
    );
  };

  const totalItems = allItems.length;
  const availableCount = availableItems.length;
  const lockedCount = lockedItems.length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Release Purchase Order</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select items from {projectCode} to include
              {lockedCount > 0 && (
                <span className="ml-1.5 text-blue-600 font-medium">· {lockedCount} already in a PO</span>
              )}
            </p>
          </div>
          <button aria-label="Close release purchase order dialog" title="Close dialog" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex items-end gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Phase 1 procurement…"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && <div className="p-8 text-center text-sm text-slate-400">Loading project items…</div>}

          {!isLoading && totalItems === 0 && (
            <div className="p-10 text-center text-sm text-slate-400">
              No products or tanks with catalogue references are assigned to this project yet.
            </div>
          )}

          {!isLoading && availableCount === 0 && lockedCount > 0 && (
            <div className="px-6 py-4 text-sm text-slate-500 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-500 shrink-0" />
              All items in this project have already been released into a PO.
            </div>
          )}

          {!isLoading && equipment.length > 0 && (
            <div>
              <SectionHeader label="Equipment / Products" count={equipment.length} items={equipment} />
              {equipment.map(item => <ItemRow key={item.id} item={item} />)}
            </div>
          )}

          {!isLoading && tanks.length > 0 && (
            <div>
              <SectionHeader label="Tanks" count={tanks.length} items={tanks} />
              {tanks.map(item => <ItemRow key={item.id} item={item} />)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
          <span className="text-xs text-slate-400">
            {selectedCount} of {availableCount} available item{availableCount !== 1 ? 's' : ''} selected
            {lockedCount > 0 && <span className="text-slate-300 ml-1">· {lockedCount} locked</span>}
            {selectedCount > 0 && <span className="ml-1">· {currency}</span>}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving || selectedCount === 0}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2">
              <ShoppingCart className="w-3.5 h-3.5" />
              {saving ? 'Creating…' : 'Create PO'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
