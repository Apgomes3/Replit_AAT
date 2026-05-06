import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import {
  Search, Plus, CheckCircle2, Square, CheckSquare,
  ExternalLink, X, Check, Mail, MailOpen,
  Package, Send, ArrowRight, Eye, MessageSquare,
} from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import CreatePOModal from '../procurement/CreatePOModal';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const TRANSITIONABLE = new Set(['purchase_order', 'po_review', 'engineering_review']);
const CAN_MANAGE_ROLES = new Set(['admin', 'engineer', 'hq_manager']);
const CAN_APPROVE_ROLES = new Set(['admin', 'hq_manager']);

const PIPELINE_STAGES = [
  { key: 'draft',              label: 'Draft',             color: 'bg-slate-100 text-slate-600 border-slate-200' },
  { key: 'pending_approval',   label: 'Pending Approval',  color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'purchase_order',     label: 'Purchase Order',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'po_review',          label: 'PO Review',         color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'engineering_review', label: 'Eng. Review',       color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { key: 'released',           label: 'Released',          color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
];

const ADVANCE_TO: Record<string, string> = {
  purchase_order:     'PO Review',
  po_review:          'Engineering Review',
  engineering_review: 'Released',
};

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
  if (po.status === 'pending_approval') return 'Submitted — awaiting approval';
  if (po.status === 'purchase_order') return 'Purchase Order — ready to advance';
  if (po.status === 'po_review') return 'PO Review — ready to advance';
  if (po.status === 'engineering_review') return 'Engineering Review — ready to advance';
  if (po.status === 'released') return 'Released';
  return po.status.replace(/_/g, ' ');
}

function getActionLabel(po: any, canManage: boolean, canApprove: boolean): string | null {
  if (po.status === 'draft' && canManage) return 'Submit';
  if (po.status === 'pending_approval' && canApprove) return 'Approve';
  if (TRANSITIONABLE.has(po.status) && canManage) return 'Advance';
  return null;
}

function isNeedsAction(po: any, canManage: boolean, canApprove: boolean, userId: string, stageRoles: Record<string, any[]>): boolean {
  if (po.status === 'draft' && canManage) return true;
  if (po.status === 'pending_approval' && canApprove) return true;
  // purchase_order: creator OR hq_manager/admin OR in stage_assignees
  if (po.status === 'purchase_order') {
    if (canApprove) return true;
    if (po.created_by === userId) return true;
    if ((stageRoles['purchase_order'] ?? []).some((a: any) => a.user_id === userId)) return true;
  }
  // po_review / engineering_review: stage_assignees only
  if (po.status === 'po_review' && (stageRoles['po_review'] ?? []).some((a: any) => a.user_id === userId)) return true;
  if (po.status === 'engineering_review' && (stageRoles['engineering_review'] ?? []).some((a: any) => a.user_id === userId)) return true;
  return false;
}

const TABS = [
  {
    key: 'needs-action' as const,
    label: 'Needs Action',
    subtitle: 'Requires your decision',
  },
  {
    key: 'in-progress' as const,
    label: 'In Progress',
    subtitle: 'Moving through the pipeline',
  },
  {
    key: 'released' as const,
    label: 'Released',
    subtitle: 'Fully approved & complete',
  },
];

export default function OrderManagementDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<'needs-action' | 'in-progress' | 'released'>('needs-action');
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [activePOId, setActivePOId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Persist last-seen status per PO in localStorage (per user).
  // A PO is "unread" when its current status differs from what was last seen.
  const seenKey = `po_seen_${user?.id ?? 'anon'}`;
  const [seenStatuses, setSeenStatuses] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(seenKey) ?? '{}'); } catch { return {}; }
  });
  const persistSeen = (updated: Record<string, string>) => {
    setSeenStatuses(updated);
    localStorage.setItem(seenKey, JSON.stringify(updated));
  };

  const canManage = CAN_MANAGE_ROLES.has(user?.role ?? '');
  const canApprove = CAN_APPROVE_ROLES.has(user?.role ?? '');

  const { data: posData, isLoading } = useQuery({
    queryKey: ['all-purchase-orders'],
    queryFn: () => api.get('/purchase-orders?page_size=200').then(r => r.data),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/submit`, {}),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} submitted — awaiting approval`);
      qc.invalidateQueries({ queryKey: ['all-purchase-orders'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Submit failed'),
  });

  const advanceMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/transition`, {}),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      const nextStage = ADVANCE_TO[po?.status ?? ''] ?? 'next stage';
      toast.success(`${po?.po_code ?? 'PO'} advanced to ${nextStage}`);
      qc.invalidateQueries({ queryKey: ['all-purchase-orders'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Advance failed'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/approve`, {}),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} approved — moved to Purchase Order`);
      qc.invalidateQueries({ queryKey: ['all-purchase-orders'] });
      setActivePOId(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Approve failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/reject`, {}),
    onSuccess: (_, id) => {
      const po = items.find((r: any) => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} rejected — returned to Draft`);
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

  const userId = user?.id ?? '';
  const needsAction = items.filter(po => isNeedsAction(po, canManage, canApprove, userId, stageRoles));
  const inProgress = items.filter(po => !isNeedsAction(po, canManage, canApprove, userId, stageRoles) && po.status !== 'released');
  const released = items.filter(po => po.status === 'released');

  const tabItems = activeTab === 'needs-action' ? needsAction
    : activeTab === 'in-progress' ? inProgress
    : released;

  const tabCounts = {
    'needs-action': needsAction.length,
    'in-progress': inProgress.length,
    'released': released.length,
  };

  const filteredItems = search
    ? tabItems.filter(po =>
        po.po_code?.toLowerCase().includes(search.toLowerCase()) ||
        po.project_name?.toLowerCase().includes(search.toLowerCase()) ||
        po.notes?.toLowerCase().includes(search.toLowerCase())
      )
    : tabItems;

  const { data: stageRoles = {} } = useQuery({
    queryKey: ['po-stage-roles'],
    queryFn: () => api.get('/purchase-orders/stage-roles').then(r => r.data),
  });

  const { data: activePODetail } = useQuery({
    queryKey: ['po-detail-pane', activePOId],
    queryFn: () => api.get(`/purchase-orders/${activePOId}`).then(r => r.data),
    enabled: !!activePOId,
  });

  const activePO = items.find((p: any) => p.id === activePOId) ?? null;

  const handleRowClick = (id: string) => {
    setActivePOId(id);
    const po = items.find((p: any) => p.id === id);
    if (po) persistSeen({ ...seenStatuses, [id]: po.status });
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

  const markAllRead = () => {
    const updated = { ...seenStatuses };
    for (const po of filteredItems) updated[po.id] = po.status;
    persistSeen(updated);
  };

  const isUnread = (po: any) => seenStatuses[po.id] !== po.status;

  const handleQuickAction = (e: React.MouseEvent, po: any) => {
    e.stopPropagation();
    if (po.status === 'draft' && canManage) submitMutation.mutate(po.id);
    else if (po.status === 'pending_approval' && canApprove) approveMutation.mutate(po.id);
    else if (TRANSITIONABLE.has(po.status) && canManage) advanceMutation.mutate(po.id);
  };

  const progressPct = items.length > 0 ? Math.round((released.length / items.length) * 100) : 0;
  const progressFilled = Math.round((released.length / Math.max(items.length, 1)) * 14);

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
          Released: <strong className="text-slate-800">{released.length} of {items.length}</strong> POs
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
          <span className="ml-auto text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
            {needsAction.length} need{needsAction.length === 1 ? 's' : ''} your action
          </span>
        )}
      </div>

      {/* Body: inbox list + reading pane */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT PANEL */}
        <div className="w-[42%] flex flex-col bg-white border-r border-slate-200 shadow-[2px_0_16px_-8px_rgba(0,0,0,0.08)]">

          {/* Tabs */}
          <div className="flex px-4 pt-2.5 border-b border-slate-200 gap-5 shrink-0 bg-slate-50/50">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setActivePOId(null); setSelectedPOs(new Set()); }}
                className={`pb-2.5 text-left transition-colors border-b-2 ${
                  activeTab === tab.key
                    ? 'border-blue-600'
                    : 'border-transparent'
                }`}
              >
                <div className={`text-sm font-medium ${activeTab === tab.key ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
                  {tab.label}
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                    activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                  }`}>{tabCounts[tab.key]}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-none">{tab.subtitle}</div>
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="px-4 py-1.5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className="text-slate-400 hover:text-slate-600 p-1 transition-colors"
                title={selectedPOs.size === filteredItems.length && filteredItems.length > 0 ? 'Deselect all' : 'Select all'}
              >
                {selectedPOs.size > 0 && selectedPOs.size === filteredItems.length
                  ? <CheckSquare className="w-4 h-4 text-blue-600" />
                  : <Square className="w-4 h-4" />}
              </button>
              <div className="border-l border-slate-200 pl-3">
                <button
                  onClick={markAllRead}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                  title="Mark all as read"
                >
                  <MailOpen className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedPOs.size > 0 && (
                <span className="text-xs text-blue-600 font-medium">{selectedPOs.size} selected</span>
              )}
              <span className="text-xs text-slate-400">
                {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
              </span>
            </div>
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
                <p className="text-sm font-medium text-slate-500">
                  {activeTab === 'needs-action' ? 'All caught up' :
                   activeTab === 'in-progress' ? 'No POs in progress' :
                   'No released POs yet'}
                </p>
                <p className="text-xs text-center text-slate-400">
                  {activeTab === 'needs-action' ? 'Nothing needs your attention right now.' :
                   activeTab === 'in-progress' ? 'POs that have been submitted and are moving through the pipeline will appear here.' :
                   'POs reach this state when fully approved and released.'}
                </p>
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

                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${av.color}`}>
                        {av.label}
                      </div>

                      <div className="flex flex-col min-w-0 flex-1 ml-0.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-sm truncate ${unread ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                            {po.po_code}
                            {po.project_name && (
                              <span className="text-slate-400 font-normal"> · {po.project_name}</span>
                            )}
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
                      <span className={`text-xs shrink-0 ${unread ? 'font-bold text-blue-600' : 'text-slate-400'}`}>
                        {timeAgo(po.updated_at || po.created_at)}
                      </span>

                      {actionLabel && (
                        <div className={`transition-opacity ${isActive || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
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
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${STATUS_AVATAR[activePO.status]?.color ?? 'bg-slate-100 text-slate-600'}`}>
                  {STATUS_AVATAR[activePO.status]?.label ?? '??'}
                </div>
                <span className="font-medium text-slate-700">{activePO.po_code}</span>
                <StatusBadge status={activePO.status} />
              </div>
              <button
                onClick={() => navigate(`/purchase-orders/${activePO.id}`)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors border border-blue-200"
              >
                <Eye className="w-3.5 h-3.5" />
                Open full detail
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-7 py-7 space-y-6">

                {/* PO header */}
                <div>
                  <h2 className="text-xl font-bold text-slate-900 leading-tight mb-1">
                    {activePO.po_code}
                    {activePO.project_name && (
                      <span className="text-slate-400 font-normal text-base ml-2">· {activePO.project_name}</span>
                    )}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Created by <strong className="text-slate-700">{activePO.created_by_name ?? '—'}</strong></span>
                    <span>·</span>
                    <span>{timeAgo(activePO.created_at)} ago</span>
                    {activePO.approved_by_name && (
                      <>
                        <span>·</span>
                        <span>Approved by <strong className="text-slate-700">{activePO.approved_by_name}</strong></span>
                      </>
                    )}
                  </div>
                </div>

                {/* Details grid */}
                <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm grid grid-cols-2 gap-5">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Project</div>
                    <div className="text-sm font-medium text-slate-800">{activePO.project_name || activePO.project_code || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Cost (USD)</div>
                    <div className="text-xl font-bold text-slate-900">{formatCurrency(activePO.total_cost_usd)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Status</div>
                    <StatusBadge status={activePO.status} />
                  </div>
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

                {/* Activity timeline */}
                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Stage History</div>
                  {!activePODetail ? (
                    <div className="space-y-3">
                      {[1,2].map(i => <div key={i} className="skeleton h-10 rounded-md" />)}
                    </div>
                  ) : (
                    <div className="relative border-l-2 border-slate-200 ml-3 space-y-4 pb-1">
                      {[...(activePODetail.history ?? [])].reverse().map((h: any, i: number, arr: any[]) => {
                        const isLatest = i === arr.length - 1;
                        const label = h.to_status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                        const dotColor = isLatest
                          ? h.to_status === 'released' ? 'bg-emerald-100 border-emerald-500'
                            : 'bg-blue-100 border-blue-600'
                          : 'bg-white border-slate-300';
                        return (
                          <div key={h.id ?? i} className="relative pl-5">
                            <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 ${dotColor}`} />
                            <div className="flex justify-between items-start gap-2">
                              <div className={`text-sm ${isLatest ? 'font-semibold text-slate-900' : 'font-medium text-slate-600'}`}>
                                {label}
                              </div>
                              <div className="text-xs text-slate-400 whitespace-nowrap shrink-0">{timeAgo(h.changed_at)}</div>
                            </div>
                            {h.actor_name && (
                              <div className="text-xs text-slate-500 mt-0.5">by {h.actor_name}</div>
                            )}
                            {h.comment && h.comment !== 'Submitted for approval' && h.comment !== 'Approved' && (
                              <div className="flex items-start gap-1 mt-1 text-xs text-slate-500 italic">
                                <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                                {h.comment}
                              </div>
                            )}
                            {isLatest && h.to_status === 'pending_approval' && (
                              <div className="text-xs text-amber-700 mt-1 bg-amber-50 border border-amber-100 rounded px-2 py-1 inline-block">
                                Waiting for HQ Manager / Admin approval
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Action area */}
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => navigate(`/purchase-orders/${activePO.id}`)}
                      className="text-sm text-slate-500 hover:text-blue-600 font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <ArrowRight className="w-4 h-4" /> View full detail & history
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
                            <Check className="w-4 h-4" /> Approve
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
                          <CheckCircle2 className="w-4 h-4" /> View Released PO
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-3 p-8">
            <Mail className="w-14 h-14 opacity-15" />
            <p className="text-base font-medium text-slate-500">Select a PO to review</p>
            <p className="text-sm text-center max-w-xs">
              {activeTab === 'needs-action'
                ? 'Click any item to see its details and take action.'
                : activeTab === 'in-progress'
                ? 'These POs are moving through the pipeline. Click one to see where it stands.'
                : 'Click a released PO to view its full detail.'}
            </p>
          </div>
        )}
      </div>

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
