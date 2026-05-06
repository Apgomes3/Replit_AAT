import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import {
  Search, Plus, Archive, Clock, CheckCircle2, Square, CheckSquare,
  ExternalLink, X, Check, Mail, MailOpen, MoreVertical, Reply,
  Forward, Star, ShoppingCart, Package, Send, ArrowRight,
} from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import CreatePOModal from '../procurement/CreatePOModal';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const TRANSITIONABLE = new Set(['purchase_order', 'po_review', 'engineering_review']);
const CAN_MANAGE_ROLES = new Set(['admin', 'engineer', 'hq_manager']);
const CAN_APPROVE_ROLES = new Set(['admin', 'hq_manager']);

const PIPELINE_STAGES = [
  { key: 'draft',              label: 'Draft',     color: 'bg-slate-100 text-slate-600 border-slate-200' },
  { key: 'pending_approval',   label: 'Pending',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'purchase_order',     label: 'PO',        color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'po_review',          label: 'Review',    color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'engineering_review', label: 'Eng',       color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { key: 'released',           label: 'Released',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
];

const STATUS_AVATAR: Record<string, { label: string; color: string }> = {
  draft:              { label: 'DR', color: 'bg-slate-100 text-slate-600' },
  pending_approval:   { label: 'PA', color: 'bg-amber-100 text-amber-700' },
  purchase_order:     { label: 'PO', color: 'bg-blue-100 text-blue-700' },
  po_review:          { label: 'PR', color: 'bg-purple-100 text-purple-700' },
  engineering_review: { label: 'ER', color: 'bg-indigo-100 text-indigo-700' },
  released:           { label: 'RL', color: 'bg-emerald-100 text-emerald-700' },
};

function timeAgo(dateStr: string): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function formatCurrency(val: any): string {
  const num = parseFloat(val ?? '0');
  if (!num) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
}

function getSnippet(po: any, canManage: boolean, canApprove: boolean): string {
  if (po.status === 'draft' && canManage) return 'Draft — ready to submit';
  if (po.status === 'pending_approval' && canApprove) return 'Awaiting your approval';
  if (TRANSITIONABLE.has(po.status) && canManage) return `${po.status.replace(/_/g, ' ')} — advance when ready`;
  if (po.status === 'released') return 'Released';
  return po.status.replace(/_/g, ' ');
}

function getActionLabel(po: any, canManage: boolean, canApprove: boolean): string | null {
  if (po.status === 'draft' && canManage) return 'Submit →';
  if (po.status === 'pending_approval' && canApprove) return 'Approve ✓';
  if (TRANSITIONABLE.has(po.status) && canManage) return 'Advance →';
  return null;
}

function isNeedsAction(po: any, canManage: boolean, canApprove: boolean): boolean {
  if (po.status === 'draft' && canManage) return true;
  if (po.status === 'pending_approval' && canApprove) return true;
  if (TRANSITIONABLE.has(po.status) && canManage) return true;
  return false;
}

export default function OrderManagementDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<'needs-action' | 'waiting' | 'done'>('needs-action');
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [activePOId, setActivePOId] = useState<string | null>(null);
  const [readPOs, setReadPOs] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const canManage = CAN_MANAGE_ROLES.has(user?.role ?? '');
  const canApprove = CAN_APPROVE_ROLES.has(user?.role ?? '');

  const { data: posData, isLoading } = useQuery({
    queryKey: ['all-purchase-orders'],
    queryFn: () => api.get('/purchase-orders?page_size=200').then(r => r.data),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/submit`),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} submitted for approval`);
      qc.invalidateQueries({ queryKey: ['all-purchase-orders'] });
    },
    onError: () => toast.error('Submit failed'),
  });

  const advanceMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/transition`),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} advanced`);
      qc.invalidateQueries({ queryKey: ['all-purchase-orders'] });
    },
    onError: () => toast.error('Advance failed'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/approve`),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} approved`);
      qc.invalidateQueries({ queryKey: ['all-purchase-orders'] });
      setActivePOId(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Approve failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/reject`),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} rejected`);
      qc.invalidateQueries({ queryKey: ['all-purchase-orders'] });
      setActivePOId(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Reject failed'),
  });

  const items: any[] = posData?.items ?? [];

  const countsByStatus: Record<string, number> = {};
  for (const item of items) {
    countsByStatus[item.status] = (countsByStatus[item.status] || 0) + 1;
  }

  const needsAction = items.filter(po => isNeedsAction(po, canManage, canApprove));
  const waiting = items.filter(po => !isNeedsAction(po, canManage, canApprove) && po.status !== 'released');
  const done = items.filter(po => po.status === 'released');

  const tabItems = activeTab === 'needs-action' ? needsAction
    : activeTab === 'waiting' ? waiting
    : done;

  const filteredItems = search
    ? tabItems.filter(po =>
        po.po_code?.toLowerCase().includes(search.toLowerCase()) ||
        po.project_name?.toLowerCase().includes(search.toLowerCase()) ||
        po.notes?.toLowerCase().includes(search.toLowerCase())
      )
    : tabItems;

  const activePO = items.find((p: any) => p.id === activePOId) ?? null;

  const handleRowClick = (id: string) => {
    setActivePOId(id);
    setReadPOs(prev => new Set([...prev, id]));
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedPOs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedPOs(prev =>
      prev.size === filteredItems.length ? new Set() : new Set(filteredItems.map(p => p.id))
    );
  };

  const isUnread = (po: any) => {
    const isNew = po.status === 'pending_approval' || (po.status === 'draft' && canManage);
    return isNew && !readPOs.has(po.id);
  };

  const handleQuickAction = (e: React.MouseEvent, po: any) => {
    e.stopPropagation();
    if (po.status === 'draft' && canManage) submitMutation.mutate(po.id);
    else if (po.status === 'pending_approval' && canApprove) approveMutation.mutate(po.id);
    else if (TRANSITIONABLE.has(po.status) && canManage) advanceMutation.mutate(po.id);
  };

  const totalHandled = needsAction.length === 0 ? 0 : Math.max(0, items.length - needsAction.length - waiting.length);
  const totalQueue = items.length;
  const progressPct = totalQueue > 0 ? Math.round((done.length / totalQueue) * 100) : 0;
  const progressFilled = Math.round((done.length / Math.max(totalQueue, 1)) * 14);

  return (
    <div className="h-full overflow-hidden flex flex-col bg-slate-50 font-sans text-slate-900">

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
              OM
            </div>
            <h1 className="text-base font-semibold text-slate-800">Order Management</h1>
          </div>

          <div className="h-5 w-px bg-slate-200" />

          <div className="flex items-center gap-1.5 flex-wrap">
            {PIPELINE_STAGES.map(s => {
              const count = countsByStatus[s.key] || 0;
              if (!count) return null;
              return (
                <button
                  key={s.key}
                  onClick={() => navigate(`/purchase-orders?status=${s.key}`)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors hover:opacity-80 ${s.color}`}
                >
                  {s.label}
                  <span className="font-bold">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search POs..."
              className="pl-8 pr-3 py-1.5 bg-slate-100 rounded-md text-sm focus:ring-2 focus:ring-blue-500 w-52 outline-none"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New PO
          </button>
        </div>
      </header>

      {/* Progress banner */}
      <div className="bg-blue-50/60 border-b border-blue-100 px-5 py-2 flex items-center gap-3 shrink-0">
        <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
          Queue: <strong className="text-slate-800">{done.length} of {totalQueue}</strong> completed
        </span>
        <div className="flex gap-0.5 flex-1 max-w-xs">
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i < progressFilled ? 'bg-blue-500' : 'bg-slate-200'}`}
            />
          ))}
        </div>
        <span className="text-xs font-bold text-blue-600 whitespace-nowrap">{progressPct}%</span>
        {needsAction.length > 0 && (
          <span className="ml-auto text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {needsAction.length} need your action
          </span>
        )}
      </div>

      {/* Body: inbox list + reading pane */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT PANEL: Inbox list */}
        <div className="w-[42%] flex flex-col bg-white border-r border-slate-200 shadow-[2px_0_16px_-8px_rgba(0,0,0,0.08)]">

          {/* Tabs */}
          <div className="flex px-4 pt-2.5 border-b border-slate-200 gap-5 shrink-0 bg-slate-50/50">
            {([
              { key: 'needs-action', label: 'Needs Action', count: needsAction.length },
              { key: 'waiting',      label: 'Waiting on Others', count: waiting.length },
              { key: 'done',         label: 'Done', count: done.length },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setActivePOId(null); }}
                className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                  activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}>{tab.count}</span>
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="px-4 py-1.5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600 p-1 transition-colors">
                {selectedPOs.size > 0 && selectedPOs.size === filteredItems.length
                  ? <CheckSquare className="w-4 h-4" />
                  : <Square className="w-4 h-4" />}
              </button>
              <div className="flex items-center gap-0.5 border-l border-slate-200 pl-3">
                <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Archive">
                  <Archive className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Snooze">
                  <Clock className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Mark read">
                  <MailOpen className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="More">
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <span className="text-xs text-slate-400">
              {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton h-3 w-40" />
                      <div className="skeleton h-3 w-28" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 p-8">
                <Mail className="w-10 h-10 opacity-20" />
                <p className="text-sm font-medium text-slate-500">All clear</p>
                <p className="text-xs text-center">Nothing in this section right now.</p>
              </div>
            ) : (
              filteredItems.map((po: any) => {
                const unread = isUnread(po);
                const isActive = activePOId === po.id;
                const isSelected = selectedPOs.has(po.id);
                const av = STATUS_AVATAR[po.status] ?? { label: '??', color: 'bg-slate-100 text-slate-600' };
                const actionLabel = getActionLabel(po, canManage, canApprove);
                const snippet = getSnippet(po, canManage, canApprove);

                return (
                  <div
                    key={po.id}
                    onClick={() => handleRowClick(po.id)}
                    className={`group flex items-center px-3 py-2.5 border-b border-slate-100 cursor-pointer transition-colors relative border-l-[3px] ${
                      isActive
                        ? 'bg-blue-50 border-l-blue-600'
                        : 'hover:bg-slate-50 border-l-transparent'
                    } ${unread ? '' : 'opacity-80'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        onClick={(e) => toggleSelect(po.id, e)}
                        className={`shrink-0 p-0.5 transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-300 group-hover:text-slate-400'}`}
                      >
                        {isSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={(e) => { e.stopPropagation(); }}
                        className="shrink-0 text-slate-300 hover:text-amber-400 p-0.5 transition-colors"
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>

                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${av.color}`}>
                        {av.label}
                      </div>

                      <div className="flex flex-col min-w-0 flex-1 ml-0.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-sm truncate ${unread ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                            {po.po_code}
                            {po.project_name && <span className="text-slate-400 font-normal"> · {po.project_name}</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                          <span className={`truncate ${unread ? 'font-medium text-slate-700' : ''}`}>{snippet}</span>
                          {parseFloat(po.total_cost_usd) > 0 && (
                            <>
                              <span className="text-slate-300 shrink-0">·</span>
                              <span className="shrink-0">{formatCurrency(po.total_cost_usd)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className={`text-xs ${unread ? 'font-bold text-blue-600' : 'text-slate-400'}`}>
                        {timeAgo(po.updated_at || po.created_at)}
                      </span>

                      {actionLabel && (
                        <div className={`opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'opacity-100' : ''}`}>
                          <button
                            onClick={(e) => handleQuickAction(e, po)}
                            className="text-[10px] font-semibold text-blue-700 hover:text-blue-800 hover:bg-blue-100 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded transition-colors whitespace-nowrap"
                          >
                            {actionLabel}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Reading pane */}
        {activePO ? (
          <div className="flex-1 flex flex-col bg-white overflow-hidden">

            {/* Reading pane toolbar */}
            <div className="px-5 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Mail className="w-3.5 h-3.5" />
                <span>PO Thread</span>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Reply">
                  <Reply className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Forward">
                  <Forward className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-slate-200 mx-0.5" />
                <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" title="Archive">
                  <Archive className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => navigate(`/purchase-orders/${activePO.id}`)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors border border-slate-200 ml-1"
                >
                  Open full view <ExternalLink className="w-3 h-3 ml-0.5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-7 py-7 space-y-7">

                {/* PO header */}
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-900 leading-tight">
                      {activePO.po_code}
                      {activePO.project_name && (
                        <span className="text-slate-500 font-normal ml-2">· {activePO.project_name}</span>
                      )}
                    </h2>
                    <StatusBadge status={activePO.status} />
                  </div>

                  <div className="flex items-center gap-4 bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${STATUS_AVATAR[activePO.status]?.color ?? 'bg-slate-100 text-slate-600'}`}>
                      {(activePO.created_by_name ?? '??').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-sm text-slate-900 truncate">{activePO.created_by_name ?? '—'}</span>
                        <span className="text-xs text-slate-400 shrink-0">{timeAgo(activePO.created_at)}</span>
                      </div>
                      <div className="text-xs text-slate-500">to Procurement Team</div>
                    </div>
                  </div>
                </div>

                {/* Details grid */}
                <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm grid grid-cols-2 gap-5">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Project</div>
                    <div className="text-sm font-medium text-slate-800">{activePO.project_name || activePO.project_code || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Cost</div>
                    <div className="text-lg font-bold text-slate-900">{formatCurrency(activePO.total_cost_usd)}</div>
                  </div>
                  {activePO.approved_by_name && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Approved By</div>
                      <div className="text-sm font-medium text-slate-800">{activePO.approved_by_name}</div>
                    </div>
                  )}
                  {Number(activePO.item_count) > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Line Items</div>
                      <button
                        onClick={() => navigate(`/purchase-orders/${activePO.id}`)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Package className="w-3.5 h-3.5" />
                        {activePO.item_count} item{Number(activePO.item_count) !== 1 ? 's' : ''}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  {activePO.notes && (
                    <div className="col-span-2 pt-4 border-t border-slate-100">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Notes</div>
                      <p className="text-sm text-slate-700 leading-relaxed">{activePO.notes}</p>
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Activity</div>
                  <div className="relative border-l-2 border-slate-200 ml-3 space-y-5 pb-1">
                    <div className="relative pl-5">
                      <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-white border-slate-300" />
                      <div className="flex justify-between items-start">
                        <div className="text-sm font-medium text-slate-700">Created</div>
                        <div className="text-xs text-slate-400">{timeAgo(activePO.created_at)}</div>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">by {activePO.created_by_name ?? '—'}</div>
                    </div>
                    {activePO.status !== 'draft' && (
                      <div className="relative pl-5">
                        <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-blue-100 border-blue-600" />
                        <div className="flex justify-between items-start">
                          <div className="text-sm font-semibold text-slate-900">{activePO.status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</div>
                          <div className="text-xs text-slate-400">{timeAgo(activePO.updated_at)}</div>
                        </div>
                        {activePO.status === 'pending_approval' && (
                          <div className="text-xs text-slate-500 mt-1 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 inline-block">
                            Waiting for Procurement Manager approval
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action area */}
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 shadow-sm">
                  <textarea
                    className="w-full bg-white border border-slate-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none mb-4"
                    rows={2}
                    placeholder="Add an internal note..."
                  />

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => navigate(`/purchase-orders/${activePO.id}`)}
                      className="text-sm text-slate-500 hover:text-blue-600 font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <ArrowRight className="w-4 h-4" /> View full detail
                    </button>

                    <div className="flex items-center gap-2.5">
                      {activePO.status === 'draft' && canManage && (
                        <button
                          onClick={() => submitMutation.mutate(activePO.id)}
                          disabled={submitMutation.isPending}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" /> Submit for Approval
                        </button>
                      )}
                      {activePO.status === 'pending_approval' && canApprove && (
                        <>
                          <button
                            onClick={() => rejectMutation.mutate(activePO.id)}
                            disabled={rejectMutation.isPending}
                            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <X className="w-4 h-4" /> Reject
                          </button>
                          <button
                            onClick={() => approveMutation.mutate(activePO.id)}
                            disabled={approveMutation.isPending}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" /> Approve this PO
                          </button>
                        </>
                      )}
                      {TRANSITIONABLE.has(activePO.status) && canManage && (
                        <button
                          onClick={() => advanceMutation.mutate(activePO.id)}
                          disabled={advanceMutation.isPending}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Advance Stage
                        </button>
                      )}
                      {activePO.status === 'released' && (
                        <button
                          onClick={() => navigate(`/purchase-orders/${activePO.id}`)}
                          className="px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-semibold hover:bg-emerald-100 transition-colors shadow-sm flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Released — View
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-3">
            <Mail className="w-14 h-14 opacity-15" />
            <p className="text-base font-medium text-slate-500">Select an item to review</p>
            <p className="text-sm">Click any PO in the list to see details here.</p>
          </div>
        )}
      </div>

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
