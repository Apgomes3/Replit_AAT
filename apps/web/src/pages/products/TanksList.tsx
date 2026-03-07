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

const TANK_TYPES = ['Display Tank', 'Sump', 'Refugium', 'Quarantine', 'Acclimation', 'Holding', 'Treatment', 'Header Tank', 'Buffer Tank', 'Other'];
const TANK_SHAPES = ['Rectangular', 'Cylindrical', 'Oval', 'Hexagonal', 'Custom'];
const TANK_MATERIALS = ['Acrylic', 'Glass', 'FRP', 'HDPE', 'GRP', 'Stainless Steel', 'Concrete', 'Other'];

export default function TanksList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters-tanks', search],
    queryFn: () => api.get(`/product-masters?category=Tank${search ? `&q=${search}` : ''}&page_size=200`).then(r => r.data),
  });

  const { data: families } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const tankFamilies = families?.items?.filter((f: any) => f.category_code === 'TANK') || [];
  const allFamilies = families?.items || [];
  const familyOptions = allFamilies.map((f: any) => f.product_family_code);

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Tank Name / Model', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'product_family_name', header: 'Family' },
    { key: 'application_type', header: 'Type', render: r => r.application_type ? <span>{r.application_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'primary_material_code', header: 'Material', render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Tanks"
        subtitle={`${data?.pagination?.total ?? 0} tank types in library`}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Tank Type</Button>}
      />
      <div className="p-4 border-b border-slate-200 bg-white">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-[#3E5C76]" />
      </div>
      <div className="flex-1 bg-white overflow-auto">
        <DataTable columns={columns} data={data?.items || []} loading={isLoading}
          onRowClick={r => navigate(`/products/masters/${r.id}`)}
          emptyMessage="No tank types in library — add a tank model above" />
      </div>

      {showNew && (
        <NewEntityModal title="New Tank Type" onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: 'PM-TNK-ACR-001' },
            { name: 'product_name', label: 'Tank Name / Model', required: true },
            { name: 'product_family_id', label: 'Family', options: familyOptions },
            { name: 'application_type', label: 'Tank Type', options: TANK_TYPES },
            { name: 'primary_material_code', label: 'Primary Material', options: TANK_MATERIALS },
            { name: 'standard_status', label: 'Status', options: ['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'] },
          ]}
          onSubmit={async (formData) => {
            const familyObj = allFamilies.find((f: any) => f.product_family_code === formData.product_family_id);
            await api.post('/product-masters', {
              ...formData,
              product_category: 'Tank',
              product_family_id: familyObj?.id ?? undefined,
            });
            toast.success('Tank type created');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
