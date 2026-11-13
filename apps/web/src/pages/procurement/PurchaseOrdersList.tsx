import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import DataTable, { Column } from '../../components/ui/DataTable';
import EntityCode from '../../components/ui/EntityCode';
import CreatePOModal from './CreatePOModal';
import { Plus, Download, Copy, User, ExternalLink, X, CheckSquare2, UserPlus, Bookmark, BookmarkCheck, ArrowRight, CheckCircle2, XCircle, Send, ChevronRight, PackageCheck, List, ShoppingCart } from 'lucide-react';
import { exportCsv } from '../../lib/exportCsv';
import toast from 'react-hot-toast';
import AssignUserModal from './AssignUserModal';
import QueryError from '../../components/ui/QueryError';
import EmptyState from '../../components/ui/EmptyState';
import { currentReturnContext } from '../../lib/navigation';
import { EDITOR_ROLES } from '../../lib/roles';

type Preset = { name: string; search: string; statusFilter: string; mineOnly: boolean };

function loadPresets(userId: string): Preset[] {
  try { return JSON.parse(localStorage.getItem(`po-presets-${userId}`) || '[]'); } catch { return []; }
}
function savePresetsToStorage(userId: string, presets: Preset[]) {
  localStorage.setItem(`po-presets-${userId}`, JSON.stringify(presets));
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:              { label: 'Draft',              color: 'bg-slate-100 text-slate-600' },
  pending_approval:   { label: 'Pending Approval',   color: 'bg-blue-100 text-blue-700' },
  purchase_order:     { label: 'Purchase Order',     color: 'bg-blue-100 text-blue-700' },
  po_review:          { label: 'PO Review',          color: 'bg-indigo-100 text-indigo-700' },
  engineering_review: { label: 'Engineering Review', color: 'bg-purple-100 text-purple-700' },
  released:           { label: 'Released',           color: 'bg-green-100 text-green-700' },
};

const TRANSITIONABLE = new Set(['purchase_order', 'po_review', 'engineering_review']);

function POStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, color: 'bg-slate-100 text-slate-600' };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>;
}

const PRIORITY_BADGES: Record<string, { label: string; color: string }> = {
  low:    { label: 'Low',    color: 'bg-slate-100 text-slate-500' },
  normal: { label: 'Normal', color: 'bg-blue-50 text-blue-600' },
  high:   { label: 'High',   color: 'bg-amber-50 text-amber-700' },
  urgent: { label: 'Urgent', color: 'bg-red-50 text-red-700 font-semibold' },
};

type PO = {
  id: string; po_code: string; status: string; notes: string;
  project_code: string; project_name: string;
  created_by_name: string; approved_by_name: string | null;
  item_count: string; created_at: string; updated_at: string;
  total_cost_usd: string; stage_due_date: string | null;
  fo_number: string | null;
  vendor_name: string | null;
  required_by_date: string | null;
  payment_terms: string | null;
  priority: string | null;
};

type InlineAction = {
  poId: string; poCode: string; action: 'approve' | 'reject';
  rect: { top: number; right: number };
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function updatedColor(updatedAt: string, status: string): string {
  if (status === 'draft' || status === 'released') return 'text-slate-400';
  const days = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  if (days < 1) return 'text-green-600';
  if (days < 3) return 'text-slate-500';
  if (days < 7) return 'text-amber-500';
  return 'text-red-500 font-medium';
}

type RequiredByUrgency = 'overdue' | 'upcoming' | null;

function parseDateOnly(dateStr: string): Date | null {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatRequiredByDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = parseDateOnly(dateStr);
  return date
    ? date.toLocaleDateString(undefined, options ?? { month: 'short', day: 'numeric' })
    : dateStr;
}

function requiredByUrgency(dateStr: string | null, status: string): RequiredByUrgency {
  if (!dateStr || status === 'released') return null;

  const requiredBy = parseDateOnly(dateStr);
  if (!requiredBy) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (requiredBy < today) return 'overdue';

  const sevenDaysFromToday = new Date(today);
  sevenDaysFromToday.setDate(today.getDate() + 7);
  return requiredBy <= sevenDaysFromToday ? 'upcoming' : null;
}

const CAN_BULK_ASSIGN = new Set<string>([...EDITOR_ROLES, 'hq_manager']);
const CAN_MANAGE = new Set<string>([...EDITOR_ROLES, 'hq_manager']);
const CAN_APPROVE = new Set(['admin', 'hq_manager']);

export default function PurchaseOrdersList() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewTab, setViewTab] = useState<'all' | 'released'>(searchParams.get('tab') === 'released' ? 'released' : 'all');
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [showCreate, setShowCreate] = useState(false);
  const [mineOnly, setMineOnly] = useState(searchParams.get('mine') === '1');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets(user?.id ?? ''));
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [showPresetsDropdown, setShowPresetsDropdown] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [inlineAction, setInlineAction] = useState<InlineAction | null>(null);
  const [inlineComment, setInlineComment] = useState('');
  const [inlineActioning, setInlineActioning] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const presetsDropdownRef = useRef<HTMLDivElement>(null);
  const inlinePanelRef = useRef<HTMLDivElement>(null);

  const canManageAny = CAN_MANAGE.has(user?.role ?? '');
  const canApproveAny = CAN_APPROVE.has(user?.role ?? '');
  const openPurchaseOrder = (id: string) => navigate(`/purchase-orders/${id}`, {
    state: currentReturnContext(location.pathname, location.search, 'Purchase Orders'),
  });

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (viewTab === 'released') next.set('tab', 'released'); else next.delete('tab');
    if (statusFilter) next.set('status', statusFilter); else next.delete('status');
    if (search) next.set('q', search); else next.delete('q');
    if (mineOnly) next.set('mine', '1'); else next.delete('mine');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [mineOnly, search, searchParams, setSearchParams, statusFilter, viewTab]);

  useEffect(() => {
    if (!showPresetsDropdown) return;
    const handler = (e: MouseEvent) => {
      if (presetsDropdownRef.current && !presetsDropdownRef.current.contains(e.target as Node)) {
        setShowPresetsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPresetsDropdown]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !inInput) { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === 'n' && !inInput && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setShowCreate(true); }
      if (e.key === 'Escape') { setInlineAction(null); setInlineComment(''); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!inlineAction) return;
    const handler = (e: MouseEvent) => {
      if (inlinePanelRef.current && !inlinePanelRef.current.contains(e.target as Node)) {
        setInlineAction(null); setInlineComment('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [inlineAction]);

  const effectiveStatus = viewTab === 'released' ? 'released' : statusFilter;
  const hasActiveFilters = Boolean(search || effectiveStatus || mineOnly);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['purchase-orders', search, effectiveStatus, mineOnly, viewTab],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (effectiveStatus) params.set('status', effectiveStatus);
      if (mineOnly) params.set('mine', 'true');
      params.set('page_size', '200');
      return api.get(`/purchase-orders?${params}`).then(r => r.data);
    },
  });

  const allItems: PO[] = data?.items ?? [];
  const allSelected = allItems.length > 0 && allItems.every(r => selectedIds.has(r.id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  const selectedItems = allItems.filter(r => selectedIds.has(r.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  });
  const transitionableCount = selectedItems.filter(r => TRANSITIONABLE.has(r.status)).length;

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allItems.map(r => r.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleSavePreset = () => {
    const name = presetNameInput.trim();
    if (!name) return;
    const updated = [...presets.filter(p => p.name !== name), { name, search, statusFilter, mineOnly }];
    setPresets(updated);
    savePresetsToStorage(user?.id ?? '', updated);
    setPresetNameInput('');
    setShowPresetSave(false);
    toast.success(`Preset "${name}" saved`);
  };

  const handleLoadPreset = (preset: Preset) => {
    setSearch(preset.search);
    setStatusFilter(preset.statusFilter);
    setMineOnly(preset.mineOnly);
  };

  const handleDeletePreset = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    savePresetsToStorage(user?.id ?? '', updated);
  };

  const cloneMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/clone`).then(r => r.data),
    onSuccess: (newPo) => {
      toast.success(`Cloned as ${newPo.po_code}`);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      openPurchaseOrder(newPo.id);
    },
    onError: () => toast.error('Clone failed'),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/submit`),
    onSuccess: (_, id) => {
      const po = allItems.find(r => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} submitted for approval`);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: () => toast.error('Submit failed'),
  });

  const advanceMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-orders/${id}/transition`),
    onSuccess: (_, id) => {
      const po = allItems.find(r => r.id === id);
      toast.success(`${po?.po_code ?? 'PO'} advanced to next stage`);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: () => toast.error('Stage advance failed'),
  });

  const handleInlineAction = async () => {
    if (!inlineAction) return;
    setInlineActioning(true);
    try {
      if (inlineAction.action === 'approve') {
        await api.post(`/purchase-orders/${inlineAction.poId}/approve`, { comment: inlineComment });
        toast.success(`${inlineAction.poCode} approved`);
      } else {
        await api.post(`/purchase-orders/${inlineAction.poId}/reject`, { comment: inlineComment });
        toast.success(`${inlineAction.poCode} sent back to draft`);
      }
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setInlineAction(null);
      setInlineComment('');
    } catch { toast.error('Action failed'); }
    finally { setInlineActioning(false); }
  };

  const bulkAssignMutation = useMutation({
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) =>
      api.post('/purchase-orders/bulk-assign', { ids, userId }).then(r => r.data),
    onSuccess: (res, { ids }) => {
      const succeeded = res.results.filter((r: any) => r.ok).length;
      const failed = res.results.filter((r: any) => r.error).length;
      if (succeeded > 0) toast.success(`User assigned to ${succeeded} PO${succeeded > 1 ? 's' : ''}`);
      if (failed > 0) toast.error(`${failed} PO${failed > 1 ? 's' : ''} could not be assigned`);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setShowAssign(false);
    },
    onError: () => toast.error('Bulk assign failed'),
  });

  const bulkTransitionMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/purchase-orders/bulk-transition', { ids }).then(r => r.data),
    onSuccess: (res) => {
      const succeeded = res.results.filter((r: any) => r.status).length;
      const failed = res.results.filter((r: any) => r.error).length;
      if (succeeded > 0) toast.success(`${succeeded} PO${succeeded > 1 ? 's' : ''} advanced to next stage`);
      if (failed > 0) toast.error(`${failed} PO${failed > 1 ? 's' : ''} could not be advanced`);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      clearSelection();
    },
    onError: () => toast.error('Bulk transition failed'),
  });

  const handleExport = (items: PO[]) => exportCsv(
    `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`,
    [
      { header: 'PO Code',        value: r => r.po_code ?? '' },
      { header: 'Project Code',   value: r => r.project_code ?? '' },
      { header: 'Project',        value: r => r.project_name ?? '' },
      { header: 'Status',         value: r => STATUS_META[r.status]?.label ?? r.status },
      { header: 'Priority',       value: r => r.priority ? r.priority.charAt(0).toUpperCase() + r.priority.slice(1) : 'Normal' },
      { header: 'Vendor',         value: r => r.vendor_name ?? '' },
      { header: 'Required By',    value: r => r.required_by_date ? new Date(r.required_by_date).toLocaleDateString() : '' },
      { header: 'Payment Terms',  value: r => r.payment_terms ?? '' },
      { header: 'Items',          value: r => String(r.item_count ?? '') },
      { header: 'Created By',     value: r => r.created_by_name ?? '' },
      { header: 'Date',           value: r => new Date(r.created_at).toLocaleDateString() },
    ],
    items
  );

  const requiredByColumn: Column<PO> = {
    key: 'required_by_date',
    header: 'Required By',
    sortable: true,
    filterable: true,
    className: 'whitespace-nowrap',
    sortValue: r => parseDateOnly(r.required_by_date ?? '')?.getTime() ?? Number.MAX_SAFE_INTEGER,
    filterValue: r => r.required_by_date ? formatRequiredByDate(r.required_by_date) : '',
    render: r => {
      if (!r.required_by_date) return null;
      const urgency = requiredByUrgency(r.required_by_date, r.status);
      const urgencyLabel = urgency === 'overdue' ? 'Overdue' : urgency === 'upcoming' ? 'Due within 7 days' : 'Required by';
      const color = urgency === 'overdue'
        ? 'text-red-600 font-semibold'
        : urgency === 'upcoming'
          ? 'text-amber-600 font-medium'
          : 'text-slate-500';
      return (
        <span
          className={`text-xs ${color}`}
          title={`${urgencyLabel} ${formatRequiredByDate(r.required_by_date, { month: 'short', day: 'numeric', year: 'numeric' })}`}
        >
          {formatRequiredByDate(r.required_by_date)}
        </span>
      );
    },
  };

  const columns: Column<PO>[] = [
    {
      key: '__select',
      header: '',
      render: r => (
        <input
          type="checkbox"
          checked={selectedIds.has(r.id)}
          onChange={() => {}}
          onClick={e => toggleSelect(r.id, e)}
          className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
        />
      ),
    },
    { key: 'po_code', header: 'PO Code', sortable: true, render: r => <EntityCode code={r.po_code} /> },
    {
      key: 'project_name' as any, header: 'Project', sortable: true, filterable: true,
      filterValue: r => `${r.project_code ?? ''} ${r.project_name ?? ''}`,
      render: r => r.project_code
        ? <span className="inline-flex items-center gap-1"><EntityCode code={r.project_code} />{r.project_name}</span>
        : <span className="text-slate-300 text-xs">—</span>,
    },
    {
      key: 'vendor_name' as any, header: 'Vendor', sortable: true,
      render: r => r.vendor_name
        ? <span className="text-xs text-slate-600 truncate max-w-[120px] block">{r.vendor_name}</span>
        : <span className="text-slate-300 text-xs">—</span>,
    },
    requiredByColumn,
    {
      key: 'status', header: 'Status', sortable: true, filterable: true, filterValue: r => r.status,
      render: r => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <POStatusBadge status={r.status} />
          {r.priority && r.priority !== 'normal' && (() => {
            const badge = PRIORITY_BADGES[r.priority];
            return badge ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span> : null;
          })()}
        </div>
      ),
    },
    { key: 'item_count' as any, header: 'Items', sortable: true, sortValue: r => Number(r.item_count) || 0, render: r => <span className="text-sm text-slate-600">{r.item_count}</span> },
    { key: 'created_by_name' as any, header: 'Created By', sortable: true, filterable: true, render: r => <span className="text-sm text-slate-600">{r.created_by_name}</span> },
    {
      key: 'updated_at' as any, header: 'Updated', sortable: true, sortValue: r => new Date(r.updated_at || r.created_at).getTime(),
      render: r => (
        <span className={`text-xs ${updatedColor(r.updated_at || r.created_at, r.status)}`}>
          {timeAgo(r.updated_at || r.created_at)}
        </span>
      ),
    },
    {
      key: '__action' as any, header: '',
      render: r => {
        const isSubmittable = r.status === 'draft' && canManageAny;
        const isApprovable = r.status === 'pending_approval' && canApproveAny;
        const isAdvanceable = TRANSITIONABLE.has(r.status) && canManageAny;
        if (!isSubmittable && !isApprovable && !isAdvanceable) return null;
        return (
          <div
            className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={e => e.stopPropagation()}
          >
            {isSubmittable && (
              <button
                onClick={() => submitMutation.mutate(r.id)}
                disabled={submitMutation.isPending}
                title="Submit for approval"
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 hover:border-blue-600 transition-all font-medium disabled:opacity-40"
              >
                <Send className="w-3 h-3" />Submit
              </button>
            )}
            {isApprovable && (
              <>
                <button
                  onClick={e => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setInlineAction({ poId: r.id, poCode: r.po_code, action: 'approve', rect: { top: rect.bottom + 4, right: window.innerWidth - rect.right } }); setInlineComment(''); }}
                  title="Approve"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-green-50 text-green-700 hover:bg-green-600 hover:text-white border border-green-200 hover:border-green-600 transition-all font-medium"
                >
                  <CheckCircle2 className="w-3 h-3" />Approve
                </button>
                <button
                  onClick={e => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setInlineAction({ poId: r.id, poCode: r.po_code, action: 'reject', rect: { top: rect.bottom + 4, right: window.innerWidth - rect.right } }); setInlineComment(''); }}
                  title="Reject / send back"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-200 hover:border-red-600 transition-all font-medium"
                >
                  <XCircle className="w-3 h-3" />Reject
                </button>
              </>
            )}
            {isAdvanceable && (
              <button
                onClick={() => advanceMutation.mutate(r.id)}
                disabled={advanceMutation.isPending}
                title="Advance to next stage"
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 hover:border-blue-600 transition-all font-medium disabled:opacity-40"
              >
                <ChevronRight className="w-3 h-3" />Advance
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const releasedColumns: Column<PO>[] = [
    { key: 'po_code', header: 'PO Code', sortable: true, render: r => <EntityCode code={r.po_code} /> },
    {
      key: 'project_name' as any, header: 'Project', sortable: true,
      render: r => r.project_code
        ? <span className="inline-flex items-center gap-1"><EntityCode code={r.project_code} />{r.project_name}</span>
        : <span className="text-slate-300 text-xs">—</span>,
    },
    {
      key: 'fo_number' as any, header: 'FO Number', sortable: true,
      render: r => r.fo_number
        ? <span className="font-mono text-xs bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded">{r.fo_number}</span>
        : <span className="text-slate-300 text-xs">—</span>,
    },
    requiredByColumn,
    { key: 'item_count' as any, header: 'Items', sortable: true, sortValue: r => Number(r.item_count) || 0, render: r => <span className="text-sm text-slate-600">{r.item_count}</span> },
    {
      key: 'total_cost_usd' as any, header: 'Total Cost (USD)', sortable: true, sortValue: r => parseFloat(r.total_cost_usd || '0'),
      render: r => parseFloat(r.total_cost_usd || '0') > 0
        ? <span className="text-sm font-mono text-slate-700">{parseFloat(r.total_cost_usd).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
        : <span className="text-slate-300 text-xs">—</span>,
    },
    { key: 'approved_by_name' as any, header: 'Approved By', render: r => <span className="text-sm text-slate-600">{r.approved_by_name ?? '—'}</span> },
    {
      key: 'created_at' as any, header: 'Released Date', sortable: true, sortValue: r => new Date(r.updated_at || r.created_at).getTime(),
      render: r => <span className="text-xs text-slate-500">{new Date(r.updated_at || r.created_at).toLocaleDateString()}</span>,
    },
    { key: 'created_by_name' as any, header: 'Created By', render: r => <span className="text-sm text-slate-600">{r.created_by_name}</span> },
    {
      key: '__open' as any, header: '',
      render: _r => <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 transition-colors" />,
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Purchase Orders"
        crumbs={[{ label: 'Order Management', href: '/order-management' }, { label: 'Purchase Orders' }]}
        subtitle={viewTab === 'released' ? `${data?.pagination?.total ?? 0} released` : `${data?.pagination?.total ?? 0} orders`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport(allItems)}
              disabled={!allItems.length}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            {viewTab === 'all' && (
              <Button variant="primary" onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4" />New PO
              </Button>
            )}
          </div>
        }
      />

      {/* Tab strip */}
      <div className="bg-white border-b border-slate-200 px-4 flex items-center gap-1">
        <button
          onClick={() => setViewTab('all')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            viewTab === 'all' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <List className="w-4 h-4" />
          All POs
        </button>
        <button
          onClick={() => { setViewTab('released'); setSelectedIds(new Set()); }}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            viewTab === 'released' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <PackageCheck className="w-4 h-4" />
          Released
        </button>
      </div>

      <div className="p-4 border-b border-slate-200 bg-white flex gap-3 items-center flex-wrap">
        {viewTab === 'all' && (
          <label className="flex items-center gap-2 cursor-pointer select-none shrink-0" title={allSelected ? 'Deselect all' : 'Select all'}>
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
              style={{ accentColor: someSelected ? '#2563eb' : undefined }}
            />
            <span className="text-xs text-slate-400">All</span>
          </label>
        )}
        <input
          ref={searchInputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search… (press / to focus)"
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-600"
        />
        {viewTab === 'all' && (
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-600"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setMineOnly(v => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
            mineOnly
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-slate-600 border-slate-300 hover:border-blue-300 hover:text-blue-600'
          }`}
        >
          <User className="w-3.5 h-3.5" />My POs
        </button>

        <div className="flex items-center gap-1.5 ml-auto">
          {presets.length > 0 && (
            <div className="relative" ref={presetsDropdownRef}>
              <button
                onClick={() => setShowPresetsDropdown(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${showPresetsDropdown ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-300 hover:text-blue-600'}`}
              >
                <BookmarkCheck className="w-3.5 h-3.5" />
                Presets <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${showPresetsDropdown ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-600'}`}>{presets.length}</span>
              </button>
              {showPresetsDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 min-w-[200px] py-1">
                  {presets.map(p => (
                    <button
                      key={p.name}
                      onClick={() => { handleLoadPreset(p); setShowPresetsDropdown(false); }}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 text-left"
                    >
                      <span className="truncate flex-1">{p.name}</span>
                      <span
                        className="ml-2 p-0.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        onClick={e => handleDeletePreset(p.name, e)}
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {showPresetSave ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={presetNameInput}
                onChange={e => setPresetNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setShowPresetSave(false); }}
                placeholder="Preset name…"
                className="border border-blue-400 rounded px-2.5 py-1.5 text-xs w-36 focus:outline-none bg-white"
              />
              <button onClick={handleSavePreset} className="text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all">Save</button>
              <button onClick={() => setShowPresetSave(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={() => setShowPresetSave(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-300 hover:text-blue-600 bg-white transition-all"
            >
              <Bookmark className="w-3.5 h-3.5" /> Save filter
            </button>
          )}
        </div>
      </div>

       <div className="flex-1 bg-white overflow-auto">
         {isError ? (
           <QueryError message="Could not load purchase orders" onRetry={() => refetch()} />
         ) : viewTab === 'released' ? (
          <DataTable
            columns={releasedColumns}
            data={allItems}
            loading={isLoading}
            tableId="purchase-orders-released"
            onRowClick={r => openPurchaseOrder(r.id)}
            emptyMessage="No released purchase orders yet"
            contextMenuItems={r => [
              { label: 'Open', icon: <ExternalLink className="w-3.5 h-3.5" />, onClick: () => openPurchaseOrder(r.id) },
              { label: 'Clone PO', icon: <Copy className="w-3.5 h-3.5" />, divider: true, onClick: () => cloneMutation.mutate(r.id) },
            ]}
          />
         ) : !isLoading && allItems.length === 0 && !hasActiveFilters ? (
           <EmptyState
             icon={ShoppingCart}
             title="No purchase orders yet"
             description="Create a purchase order to start tracking approvals, engineering review, and release."
             actionLabel="Create your first PO"
             onAction={() => setShowCreate(true)}
           />
         ) : (
          <DataTable
            columns={columns}
            data={allItems}
            loading={isLoading}
            onRowClick={r => openPurchaseOrder(r.id)}
            contextMenuItems={r => [
              {
                label: 'Open',
                icon: <ExternalLink className="w-3.5 h-3.5" />,
                onClick: () => openPurchaseOrder(r.id),
              },
              {
                label: 'Clone PO',
                icon: <Copy className="w-3.5 h-3.5" />,
                divider: true,
                onClick: () => cloneMutation.mutate(r.id),
              },
            ]}
          />
        )}
      </div>

      {!isLoading && allItems.length > 0 && (() => {
        const totalSpend = allItems.reduce((sum, r) => sum + parseFloat(r.total_cost_usd || '0'), 0);
        if (viewTab === 'released') {
          const withFO = allItems.filter(r => r.fo_number).length;
          return (
            <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-2 flex items-center gap-6 text-xs text-slate-500">
              <span><span className="font-semibold text-slate-700">{allItems.length}</span> released PO{allItems.length !== 1 ? 's' : ''}</span>
              <span>
                Total value <span className="font-semibold text-slate-700">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(totalSpend)}
                </span> <span className="text-slate-400">USD</span>
              </span>
              {withFO > 0 && <span className="text-green-600 font-medium">{withFO} with FO number</span>}
            </div>
          );
        }
        const overdue = allItems.filter(r => r.stage_due_date && new Date(r.stage_due_date) < new Date() && r.status !== 'released').length;
        return (
          <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-2 flex items-center gap-6 text-xs text-slate-500">
            <span><span className="font-semibold text-slate-700">{allItems.length}</span> POs</span>
            <span>
              Total spend <span className="font-semibold text-slate-700">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(totalSpend)}
              </span> <span className="text-slate-400">USD</span>
            </span>
            {overdue > 0 && (
              <span className="text-amber-600 font-medium">{overdue} overdue stage{overdue > 1 ? 's' : ''}</span>
            )}
          </div>
        );
      })()}

      {viewTab === 'all' && selectedIds.size > 0 && (
        <div className="border-t border-slate-200 bg-white px-5 py-3 flex items-center gap-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 shrink-0">
            <CheckSquare2 className="w-4 h-4 text-blue-600" />
            {selectedIds.size} selected
          </div>
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <button
              onClick={() => handleExport(selectedItems)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600 bg-white transition-all"
            >
              <Download className="w-3.5 h-3.5" /> Export selected
            </button>
            {transitionableCount > 0 && (
              <button
                onClick={() => {
                  const ids = selectedItems
                    .filter(r => TRANSITIONABLE.has(r.status))
                    .map(r => r.id);
                  bulkTransitionMutation.mutate(ids);
                }}
                disabled={bulkTransitionMutation.isPending}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                Advance {transitionableCount} PO{transitionableCount > 1 ? 's' : ''} to next stage
              </button>
            )}
            {CAN_BULK_ASSIGN.has(user?.role ?? '') && (
              <button
                onClick={() => setShowAssign(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600 bg-white transition-all"
              >
                <UserPlus className="w-3.5 h-3.5" /> Assign User
              </button>
            )}
          </div>
          <button onClick={clearSelection} className="text-slate-400 hover:text-slate-600 shrink-0" title="Clear selection">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showAssign && (
        <AssignUserModal
          selectedCount={selectedIds.size}
          onClose={() => setShowAssign(false)}
          onAssign={(userId) => bulkAssignMutation.mutate({ ids: [...selectedIds], userId })}
        />
      )}
      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}

      {inlineAction && (
        <div
          ref={inlinePanelRef}
          style={{ position: 'fixed', top: inlineAction.rect.top, right: inlineAction.rect.right, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-xl shadow-2xl w-72 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              {inlineAction.action === 'approve' ? '✓ Approve' : '✗ Reject'} {inlineAction.poCode}
            </span>
            <button onClick={() => { setInlineAction(null); setInlineComment(''); }} className="text-slate-300 hover:text-slate-500">
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            autoFocus
            value={inlineComment}
            onChange={e => setInlineComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleInlineAction(); }}
            placeholder="Optional comment… (⌘Enter to confirm)"
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:border-blue-400"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setInlineAction(null); setInlineComment(''); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleInlineAction}
              disabled={inlineActioning}
              className={`text-xs px-3 py-1.5 rounded-lg text-white font-medium disabled:opacity-40 ${inlineAction.action === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {inlineActioning ? '…' : inlineAction.action === 'approve' ? 'Approve' : 'Send Back'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
