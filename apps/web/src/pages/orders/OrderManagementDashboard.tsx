import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { ChevronLeft, ArrowUpRight, ShoppingCart, Clock, CheckCircle2, FileCheck, Wrench, Send, FilePen, Plus, AlertTriangle, Package } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import CreatePOModal from '../procurement/CreatePOModal';

const STAGES = [
  { key: 'draft',               label: 'Draft',            icon: FilePen,      colorClass: 'bg-stone-50  text-stone-500  border-stone-200',  dot: 'bg-stone-400',   border: 'border-l-stone-300'   },
  { key: 'pending_approval',    label: 'Pending Approval', icon: Clock,        colorClass: 'bg-blue-50   text-blue-600   border-blue-200',   dot: 'bg-blue-500',    border: 'border-l-blue-400'    },
  { key: 'purchase_order',      label: 'Purchase Order',   icon: ShoppingCart, colorClass: 'bg-blue-50   text-blue-600   border-blue-200',   dot: 'bg-blue-500',    border: 'border-l-blue-500'    },
  { key: 'po_review',           label: 'PO Review',        icon: FileCheck,    colorClass: 'bg-indigo-50 text-indigo-600 border-indigo-200', dot: 'bg-indigo-500',  border: 'border-l-indigo-400'  },
  { key: 'engineering_review',  label: 'Eng. Review',      icon: Wrench,       colorClass: 'bg-purple-50 text-purple-600 border-purple-200', dot: 'bg-purple-500',  border: 'border-l-purple-400'  },
  { key: 'released',            label: 'Released',         icon: CheckCircle2, colorClass: 'bg-emerald-50 text-emerald-600 border-emerald-200', dot: 'bg-emerald-500', border: 'border-l-emerald-400' },
];

const STAGE_BORDER: Record<string, string> = Object.fromEntries(STAGES.map(s => [s.key, s.border]));
const STALE_DAYS = 7;
const FINAL_STATUSES = new Set(['draft', 'released']);

function isStale(po: any): boolean {
  if (FINAL_STATUSES.has(po.status)) return false;
  const updated = new Date(po.updated_at || po.created_at);
  const diffDays = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > STALE_DAYS;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="skeleton h-3 w-3 rounded-full shrink-0" />
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="skeleton h-3 w-20 shrink-0" />
              <div className="skeleton h-3 w-40" />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-12" />
            <div className="skeleton h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </>
  );
}

const TABS = [
  { key: 'all',         label: 'All' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'released',    label: 'Released' },
];

export default function OrderManagementDashboard() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  const { data: posData, isLoading } = useQuery({
    queryKey: ['all-purchase-orders'],
    queryFn: () => api.get('/purchase-orders?page_size=200').then(r => r.data),
  });

  const items: any[] = posData?.items ?? [];
  const countsByStatus: Record<string, number> = {};
  for (const item of items) {
    countsByStatus[item.status] = (countsByStatus[item.status] || 0) + 1;
  }

  const totalActive = items.filter(i => !FINAL_STATUSES.has(i.status)).length;

  const filteredItems = items.filter(i => {
    if (activeTab === 'in_progress') return !FINAL_STATUSES.has(i.status);
    if (activeTab === 'released') return i.status === 'released';
    return true;
  });
  const recent = filteredItems.slice(0, 8);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-blue-600 transition-colors duration-150 group"
        >
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" />
          Home
        </button>
        <span className="text-stone-300">/</span>
        <span className="text-sm text-stone-600 font-medium">Order Management</span>
      </div>

      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 mb-1">Order Management</h1>
          <p className="text-stone-400 text-sm">Purchase order pipeline and lifecycle overview</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-all duration-150 shadow-sm hover:shadow active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" /> New PO
          </button>
          <Link
            to="/purchase-orders"
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 bg-white px-3 py-1.5 rounded-lg transition-all duration-150 shadow-sm hover:shadow active:scale-95"
          >
            <Send className="w-3.5 h-3.5" /> All POs
          </Link>
        </div>
      </div>

      <div className="bg-white border border-stone-200/80 rounded-xl p-5 mb-5 shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-stone-700">PO Lifecycle Pipeline</h2>
          <span className="text-xs text-stone-400 bg-stone-50 border border-stone-200 rounded-full px-2.5 py-0.5">
            {items.length} total · <span className="text-blue-600 font-medium">{totalActive} in progress</span>
          </span>
        </div>
        <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
          {STAGES.map((stage, idx) => {
            const Icon = stage.icon;
            const count = countsByStatus[stage.key] || 0;
            const isLast = idx === STAGES.length - 1;
            return (
              <div key={stage.key} className="flex items-center shrink-0">
                <button
                  onClick={() => navigate(`/purchase-orders?status=${stage.key}`)}
                  className={`flex flex-col items-center rounded-xl border px-4 py-3 min-w-[120px] transition-all duration-150 ${stage.colorClass} ${count > 0 ? 'shadow-sm hover:shadow-md cursor-pointer hover:scale-105' : 'opacity-50 cursor-default'}`}
                >
                  <div className="relative mb-1.5">
                    <Icon className="w-5 h-5" />
                    {count > 0 && <span className={`absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full ${stage.dot}`} />}
                  </div>
                  <span className="text-2xl font-bold leading-tight">{count}</span>
                  <span className="text-xs font-medium mt-0.5 text-center leading-tight">{stage.label}</span>
                </button>
                {!isLast && (
                  <div className="flex items-center px-1.5">
                    <svg width="16" height="8" viewBox="0 0 16 8" fill="none" className="text-stone-300">
                      <path d="M0 4h12M9 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-stone-200/80 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-1 bg-stone-100/70 rounded-lg p-0.5">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all duration-150 ${activeTab === tab.key ? 'bg-white text-blue-600 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
              >
                {tab.label}
                {tab.key === 'in_progress' && totalActive > 0 && (
                  <span className="ml-1.5 bg-blue-100 text-blue-600 text-xs font-bold px-1.5 py-0.5 rounded-full">{totalActive}</span>
                )}
              </button>
            ))}
          </div>
          <Link to="/purchase-orders" className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors">
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-stone-50/80">
          {isLoading ? (
            <SkeletonRows />
          ) : recent.length === 0 ? (
            <div className="px-4 py-10 flex flex-col items-center gap-2">
              <ShoppingCart className="w-8 h-8 text-stone-200" />
              <span className="text-sm text-stone-400">No purchase orders yet</span>
            </div>
          ) : (
            recent.map((po: any) => {
              const stale = isStale(po);
              const borderColor = STAGE_BORDER[po.status] || 'border-l-stone-200';
              return (
                <Link key={po.id} to={`/purchase-orders/${po.id}`}
                  className={`flex items-center justify-between px-4 py-3 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 ${borderColor}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <ShoppingCart className="w-4 h-4 text-stone-300 shrink-0 group-hover:text-blue-400 transition-colors" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-stone-400 shrink-0">{po.po_code}</span>
                        <span className="text-sm text-stone-600 group-hover:text-blue-700 truncate transition-colors">{po.project_name || po.notes || '—'}</span>
                        {stale && (
                          <span className="flex items-center gap-0.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">
                            <AlertTriangle className="w-3 h-3" /> stale
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-stone-400">{po.created_by_name || '—'}</span>
                        {po.item_count > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-stone-400">
                            <Package className="w-3 h-3" />{po.item_count} {Number(po.item_count) === 1 ? 'item' : 'items'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-stone-400 shrink-0">{timeAgo(po.created_at)}</span>
                    <StatusBadge status={po.status} />
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
