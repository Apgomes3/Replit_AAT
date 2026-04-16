import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import DataTable, { Column } from '../../components/ui/DataTable';
import EntityCode from '../../components/ui/EntityCode';
import CreatePOModal from './CreatePOModal';
import { Plus } from 'lucide-react';

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:              { label: 'Draft',              color: 'bg-slate-100 text-slate-600' },
  pending_approval:   { label: 'Pending Approval',   color: 'bg-amber-100 text-amber-700' },
  purchase_order:     { label: 'Purchase Order',     color: 'bg-blue-100 text-blue-700' },
  po_review:          { label: 'PO Review',          color: 'bg-indigo-100 text-indigo-700' },
  engineering_review: { label: 'Engineering Review', color: 'bg-purple-100 text-purple-700' },
  released:           { label: 'Released',           color: 'bg-green-100 text-green-700' },
};

function POStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, color: 'bg-slate-100 text-slate-600' };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>;
}

type PO = {
  id: string; po_code: string; status: string; notes: string;
  project_code: string; project_name: string;
  created_by_name: string; approved_by_name: string;
  item_count: string; created_at: string;
};

export default function PurchaseOrdersList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', search, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/purchase-orders?${params}`).then(r => r.data);
    },
  });

  const columns: Column<PO>[] = [
    { key: 'po_code', header: 'PO Code', render: r => <EntityCode code={r.po_code} /> },
    { key: 'project_name' as any, header: 'Project', render: r => r.project_code
      ? <span><span className="font-mono text-xs text-slate-400 mr-1">{r.project_code}</span>{r.project_name}</span>
      : <span className="text-slate-300 text-xs">—</span>
    },
    { key: 'status', header: 'Status', render: r => <POStatusBadge status={r.status} /> },
    { key: 'item_count' as any, header: 'Items', render: r => <span className="text-sm text-slate-600">{r.item_count}</span> },
    { key: 'created_by_name' as any, header: 'Created By', render: r => <span className="text-sm text-slate-600">{r.created_by_name}</span> },
    { key: 'created_at', header: 'Date', render: r => <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()}</span> },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Purchase Orders"
        crumbs={[{ label: 'Order Management', href: '/order-management' }, { label: 'Purchase Orders' }]}
        subtitle={`${data?.pagination?.total ?? 0} orders`}
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" />New PO
          </Button>
        }
      />
      <div className="p-4 border-b border-slate-200 bg-white flex gap-3 items-center flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by PO code or project…"
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-amber-600"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border border-slate-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-600"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 bg-white overflow-auto">
        <DataTable
          columns={columns}
          data={data?.items || []}
          loading={isLoading}
          onRowClick={r => navigate(`/purchase-orders/${r.id}`)}
        />
      </div>

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
