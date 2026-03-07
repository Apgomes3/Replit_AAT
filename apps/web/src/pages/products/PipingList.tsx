import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import { ProductMaster } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';

const PIPE_SUBTYPES = ['Pipe', 'Fitting', 'Valve', 'Flange', 'Coupling', 'Reducer', 'Union', 'Other'];

export default function PipingList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters-piping', search],
    queryFn: () => api.get(`/product-masters?category=Piping${search ? `&q=${search}` : ''}`).then(r => r.data),
  });

  const { data: families } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const pipingFamilies = families?.items?.filter((f: any) => f.category_code === 'PIPING') || [];
  const familyOptions = pipingFamilies.map((f: any) => f.product_family_code);

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Item Name', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'product_family_name', header: 'Family' },
    { key: 'application_type', header: 'Type', render: r => r.application_type ? <span>{r.application_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'primary_material_code', header: 'Material', render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Pipes & Fittings"
        subtitle={`${data?.pagination?.total ?? 0} items in piping library`}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Item</Button>}
      />
      <div className="p-4 border-b border-slate-200 bg-white">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-[#3E5C76]" />
      </div>
      <div className="flex-1 bg-white overflow-auto">
        <DataTable columns={columns} data={data?.items || []} loading={isLoading} onRowClick={r => navigate(`/products/masters/${r.id}`)} />
      </div>
      {showNew && (
        <NewEntityModal title="New Pipe / Fitting" onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: 'PM-PIPE-XXX-00' },
            { name: 'product_name', label: 'Item Name', required: true },
            { name: 'product_family_id', label: 'Family', options: familyOptions },
            { name: 'application_type', label: 'Type', options: PIPE_SUBTYPES },
            { name: 'primary_material_code', label: 'Primary Material Code' },
            { name: 'standard_status', label: 'Status', options: ['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'] },
          ]}
          onSubmit={async (formData) => {
            const familyObj = pipingFamilies.find((f: any) => f.product_family_code === formData.product_family_id);
            await api.post('/product-masters', {
              ...formData,
              product_category: 'Piping',
              product_family_id: familyObj?.id ?? undefined,
            });
            toast.success('Piping item created');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
