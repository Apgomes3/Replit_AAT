import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import DataTable, { Column } from '../../components/ui/DataTable';
import EntityCode from '../../components/ui/EntityCode';
import CreatePOModal from './CreatePOModal';
import { Plus, Download, Copy, User, ExternalLink, X, CheckSquare2, UserPlus, Bookmark, BookmarkCheck, ArrowRight } from 'lucide-react';
import { exportCsv } from '../../lib/exportCsv';
import toast from 'react-hot-toast';
import AssignUserModal from './AssignUserModal';

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

type PO = {
  id: string; po_code: string; status: string; notes: string;
  project_code: string; project_name: string;
  created_by_name: string; approved_by_name: string;
  item_count: string; created_at: string;
  total_cost_usd: string; stage_due_date: string | null;
};

const CAN_BULK_ASSIGN = new Set(['admin', 'engineer', 'hq_manager']);

export default function PurchaseOrdersList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [showCreate, setShowCreate] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets(user?.id ?? ''));
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const selectAllRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', search, statusFilter, mineOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (statusFilter) params.set('status', statusFilter);
      if (mineOnly) params.set('mine', 'true');
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
      navigate(`/purchase-orders/${newPo.id}`);
    },
    onError: () => toast.error('Clone failed'),
  });

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
      { header: 'PO Code',      value: r => r.po_code ?? '' },
      { header: 'Project Code', value: r => r.project_code ?? '' },
      { header: 'Project',      value: r => r.project_name ?? '' },
      { header: 'Status',       value: r => STATUS_META[r.status]?.label ?? r.status },
      { header: 'Items',        value: r => String(r.item_count ?? '') },
      { header: 'Created By',   value: r => r.created_by_name ?? '' },
      { header: 'Date',         value: r => new Date(r.created_at).toLocaleDateString() },
    ],
    items
  );

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
        ? <span><span className="font-mono text-xs text-slate-400 mr-1">{r.project_code}</span>{r.project_name}</span>
        : <span className="text-slate-300 text-xs">—</span>,
    },
    { key: 'status', header: 'Status', sortable: true, filterable: true, filterValue: r => r.status, render: r => <POStatusBadge status={r.status} /> },
    { key: 'item_count' as any, header: 'Items', sortable: true, sortValue: r => Number(r.item_count) || 0, render: r => <span className="text-sm text-slate-600">{r.item_count}</span> },
    { key: 'created_by_name' as any, header: 'Created By', sortable: true, filterable: true, render: r => <span className="text-sm text-slate-600">{r.created_by_name}</span> },
    { key: 'created_at', header: 'Date', sortable: true, sortValue: r => new Date(r.created_at).getTime(), render: r => <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()}</span> },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Purchase Orders"
        crumbs={[{ label: 'Order Management', href: '/order-management' }, { label: 'Purchase Orders' }]}
        subtitle={`${data?.pagination?.total ?? 0} orders`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport(allItems)}
              disabled={!allItems.length}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" />New PO
            </Button>
          </div>
        }
      />

      <div className="p-4 border-b border-slate-200 bg-white flex gap-3 items-center flex-wrap">
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
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by PO code or project…"
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-600"
        />
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
            <div className="relative group">
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-300 hover:text-blue-600 bg-white transition-all">
                <BookmarkCheck className="w-3.5 h-3.5" />
                Presets <span className="bg-blue-100 text-blue-600 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none">{presets.length}</span>
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 min-w-[180px] py-1 hidden group-hover:block">
                {presets.map(p => (
                  <button
                    key={p.name}
                    onClick={() => handleLoadPreset(p)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 text-left"
                  >
                    <span className="truncate flex-1">{p.name}</span>
                    <span
                      className="ml-2 text-slate-300 hover:text-red-500 transition-colors"
                      onClick={e => handleDeletePreset(p.name, e)}
                    >
                      <X className="w-3 h-3" />
                    </span>
                  </button>
                ))}
              </div>
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
        <DataTable
          columns={columns}
          data={allItems}
          loading={isLoading}
          onRowClick={r => navigate(`/purchase-orders/${r.id}`)}
          contextMenuItems={r => [
            {
              label: 'Open',
              icon: <ExternalLink className="w-3.5 h-3.5" />,
              onClick: () => navigate(`/purchase-orders/${r.id}`),
            },
            {
              label: 'Clone PO',
              icon: <Copy className="w-3.5 h-3.5" />,
              divider: true,
              onClick: () => cloneMutation.mutate(r.id),
            },
          ]}
        />
      </div>

      {!isLoading && allItems.length > 0 && (() => {
        const totalSpend = allItems.reduce((sum, r) => sum + parseFloat(r.total_cost_usd || '0'), 0);
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

      {selectedIds.size > 0 && (
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
          poIds={[...selectedIds]}
          onClose={() => setShowAssign(false)}
          onAssign={(userId) => bulkAssignMutation.mutate({ ids: [...selectedIds], userId })}
          isPending={bulkAssignMutation.isPending}
        />
      )}
      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
