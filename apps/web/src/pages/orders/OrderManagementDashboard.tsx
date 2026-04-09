import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { ChevronLeft, ArrowUpRight, ShoppingCart, Clock, CheckCircle2, FileCheck, Wrench, Send, FilePen } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';

const STAGES = [
  { key: 'draft', label: 'Draft', icon: FilePen, color: 'bg-stone-100 text-stone-500 border-stone-200', dot: 'bg-stone-400' },
  { key: 'pending_approval', label: 'Pending Approval', icon: Clock, color: 'bg-amber-50 text-amber-600 border-amber-200', dot: 'bg-amber-500' },
  { key: 'purchase_order', label: 'Purchase Order', icon: ShoppingCart, color: 'bg-blue-50 text-blue-600 border-blue-200', dot: 'bg-blue-500' },
  { key: 'po_review', label: 'PO Review', icon: FileCheck, color: 'bg-indigo-50 text-indigo-600 border-indigo-200', dot: 'bg-indigo-500' },
  { key: 'engineering_review', label: 'Eng. Review', icon: Wrench, color: 'bg-purple-50 text-purple-600 border-purple-200', dot: 'bg-purple-500' },
  { key: 'released', label: 'Released', icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600 border-emerald-200', dot: 'bg-emerald-500' },
];

export default function OrderManagementDashboard() {
  const navigate = useNavigate();

  const { data: posData } = useQuery({
    queryKey: ['all-purchase-orders'],
    queryFn: () => api.get('/purchase-orders?page_size=200').then(r => r.data),
  });

  const items: any[] = posData?.items ?? [];

  const countsByStatus: Record<string, number> = {};
  for (const item of items) {
    countsByStatus[item.status] = (countsByStatus[item.status] || 0) + 1;
  }

  const recent = items.slice(0, 8);
  const totalActive = items.filter(i => !['released', 'draft'].includes(i.status)).length;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Home
        </button>
        <span className="text-stone-300">/</span>
        <span className="text-sm text-stone-600 font-medium">Order Management</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800 mb-1">Order Management</h1>
          <p className="text-stone-500 text-sm">Purchase order pipeline and lifecycle overview</p>
        </div>
        <Link
          to="/purchase-orders"
          className="flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700 border border-amber-200 hover:border-amber-400 bg-white px-3 py-1.5 rounded-lg transition-all"
        >
          <Send className="w-3.5 h-3.5" /> All Purchase Orders
        </Link>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-stone-700">PO Lifecycle Pipeline</h2>
          <span className="text-xs text-stone-400">{items.length} total · {totalActive} in progress</span>
        </div>
        <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
          {STAGES.map((stage, idx) => {
            const Icon = stage.icon;
            const count = countsByStatus[stage.key] || 0;
            const isLast = idx === STAGES.length - 1;
            return (
              <div key={stage.key} className="flex items-center shrink-0">
                <div className={`flex flex-col items-center rounded-xl border px-4 py-3 min-w-[120px] ${stage.color} ${count > 0 ? 'shadow-sm' : 'opacity-60'}`}>
                  <Icon className="w-5 h-5 mb-1.5" />
                  <span className="text-2xl font-bold leading-tight">{count}</span>
                  <span className="text-xs font-medium mt-0.5 text-center leading-tight">{stage.label}</span>
                </div>
                {!isLast && (
                  <div className="flex items-center px-1">
                    <div className="w-5 h-px bg-stone-200 relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 border-l-4 border-y-2 border-y-transparent border-l-stone-300 w-0 h-0" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
          <span className="text-sm font-semibold text-stone-700">Recent Purchase Orders</span>
          <Link to="/purchase-orders" className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium">
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-stone-50">
          {recent.length === 0 ? (
            <div className="px-4 py-8 text-sm text-stone-400 text-center">No purchase orders yet</div>
          ) : (
            recent.map((po: any) => (
              <Link key={po.id} to={`/purchase-orders/${po.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors group">
                <div className="flex items-center gap-3 min-w-0">
                  <ShoppingCart className="w-4 h-4 text-stone-300 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-stone-400 mr-2">{po.po_number}</span>
                    <span className="text-sm text-stone-700 group-hover:text-amber-600 truncate">{po.title}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs text-stone-400">{po.supplier_name || '—'}</span>
                  <StatusBadge status={po.status} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
