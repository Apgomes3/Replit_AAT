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
import { Plus, Copy } from 'lucide-react';

export default function ProductMastersList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters', search],
    queryFn: () => api.get(`/product-masters${search ? `?q=${search}` : ''}`).then(r => r.data),
  });

  const { data: families } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => api.get('/admin/categories').then(r => r.data),
  });

  const categoryOptions: string[] = categoriesData?.items?.map((c: any) => c.name) || ['Filtration', 'Pumping', 'Disinfection', 'Thermal', 'Piping', 'Control', 'Structural', 'Instrumentation', 'Tank', 'Electrical', 'Other'];

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Product Name', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'product_family_name', header: 'Family' },
    { key: 'product_category', header: 'Category' },
    { key: 'design_flow_m3h', header: 'Flow (m³/h)' },
    { key: 'power_kw', header: 'Power (kW)' },
    { key: 'primary_material_code', header: 'Material', render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
  ];

  const familyOptions = families?.items?.map((f: any) => f.product_family_code) || [];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Product Masters" subtitle={`${data?.pagination?.total ?? 0} products in ASW Library`}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Product</Button>}
      />
      <div className="p-4 border-b border-slate-200 bg-white">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-[#3E5C76]" />
      </div>
      <div className="flex-1 bg-white overflow-auto">
        <DataTable
          columns={columns} data={data?.items || []} loading={isLoading} tableId="products-list"
          onRowClick={r => navigate(`/products/masters/${r.id}`)}
          contextMenuItems={row => [
            {
              label: 'Duplicate',
              icon: <Copy className="w-3.5 h-3.5" />,
              onClick: async () => {
                try {
                  const res = await api.post(`/product-masters/${row.id}/duplicate`, {});
                  toast.success('Product duplicated');
                  refetch();
                  navigate(`/products/masters/${res.data.id}`);
                } catch { toast.error('Duplicate failed'); }
              },
            },
          ]}
        />
      </div>
      {showNew && (
        <NewEntityModal title="New Product Master" onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: 'PM-XX-000' },
            { name: 'product_name', label: 'Product Name', required: true },
            { name: 'product_category', label: 'Category', options: categoryOptions },
            { name: 'application_type', label: 'Application Type' },
            { name: 'design_flow_m3h', label: 'Design Flow (m³/h)', type: 'number' },
            { name: 'power_kw', label: 'Power (kW)', type: 'number' },
            { name: 'primary_material_code', label: 'Primary Material Code' },
            { name: 'standard_status', label: 'Status', options: ['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'] },
          ]}
          onSubmit={async (data) => {
            await api.post('/product-masters', data);
            toast.success('Product master created');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
