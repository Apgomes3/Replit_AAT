import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { ProductFamily } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import FamilyClassifiersModal from '../../components/ui/FamilyClassifiersModal';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { Plus, Pencil, SlidersHorizontal } from 'lucide-react';

export default function ProductFamiliesList() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editRow, setEditRow] = useState<ProductFamily | null>(null);
  const [classifiersFamily, setClassifiersFamily] = useState<ProductFamily | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => api.get('/admin/categories').then(r => r.data),
  });

  const categoryCodeOptions: string[] = categoriesData?.items?.map((c: any) => c.code) || ['FILTRATION', 'PUMPING', 'DISINFECTION', 'THERMAL', 'PIPING', 'CONTROL', 'STRUCTURAL', 'TANK', 'ELECTRICAL', 'OTHER'];
  const statusOptions = ['Active', 'Inactive', 'Draft'];

  const columns: Column<ProductFamily>[] = [
    { key: 'product_family_code', header: 'Code', render: r => <EntityCode code={r.product_family_code} /> },
    { key: 'product_family_name', header: 'Family Name', render: r => <span className="font-medium">{r.product_family_name}</span> },
    { key: 'category_code', header: 'Category' },
    { key: 'product_count', header: 'Products', render: r => <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">{r.product_count}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Products" subtitle="Reusable product group definitions"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Family</Button>}
      />
      <div className="flex-1 bg-white overflow-auto">
        <DataTable
          columns={columns} data={data?.items || []} loading={isLoading} tableId="families-list"
          contextMenuItems={row => [
            {
              label: 'Edit',
              icon: <Pencil className="w-3.5 h-3.5" />,
              onClick: () => setEditRow(row),
            },
            {
              label: 'Manage Classifiers',
              icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
              onClick: () => setClassifiersFamily(row),
            },
          ]}
        />
      </div>
      <div className="p-4 bg-white border-t border-slate-200">
        <Link to="/products/masters" className="text-sm text-[#3E5C76] hover:underline">→ View all Product Masters</Link>
      </div>

      {showNew && (
        <NewEntityModal title="New Product Family" onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_family_code', label: 'Family Code', required: true, placeholder: 'PFM-XX' },
            { name: 'product_family_name', label: 'Family Name', required: true },
            { name: 'category_code', label: 'Category', options: categoryCodeOptions },
            { name: 'description', label: 'Description' },
          ]}
          onSubmit={async (data) => {
            await api.post('/product-families', data);
            toast.success('Product family created');
            refetch();
            setShowNew(false);
          }}
        />
      )}

      {classifiersFamily && (
        <FamilyClassifiersModal family={classifiersFamily} onClose={() => setClassifiersFamily(null)} />
      )}

      {editRow && (
        <NewEntityModal
          title={`Edit ${editRow.product_family_code}`}
          submitLabel="Save Changes"
          onClose={() => setEditRow(null)}
          initialValues={{
            product_family_name: editRow.product_family_name,
            category_code: editRow.category_code,
            description: (editRow as any).description || '',
            status: (editRow as any).status || '',
          }}
          fields={[
            { name: 'product_family_name', label: 'Family Name', required: true },
            { name: 'category_code', label: 'Category', options: categoryCodeOptions },
            { name: 'description', label: 'Description' },
            { name: 'status', label: 'Status', options: statusOptions },
          ]}
          onSubmit={async (data) => {
            await api.put(`/product-families/${editRow.id}`, data);
            toast.success('Family updated');
            qc.invalidateQueries({ queryKey: ['product-families'] });
            setEditRow(null);
          }}
        />
      )}
    </div>
  );
}
