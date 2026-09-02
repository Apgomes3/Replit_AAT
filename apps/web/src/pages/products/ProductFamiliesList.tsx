import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Plus, Pencil, SlidersHorizontal, Package, Trash2 } from 'lucide-react';
import QueryError from '../../components/ui/QueryError';
import EmptyState from '../../components/ui/EmptyState';

function deriveCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export default function ProductFamiliesList() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editRow, setEditRow] = useState<ProductFamily | null>(null);
  const [classifiersFamily, setClassifiersFamily] = useState<ProductFamily | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => api.get('/admin/categories').then(r => r.data),
  });

  const categoryCodeOptions: string[] = categoriesData?.items?.map((c: any) => c.code) || ['FILTRATION', 'PUMPING', 'DISINFECTION', 'THERMAL', 'PIPING', 'CONTROL', 'STRUCTURAL', 'TANK', 'ELECTRICAL', 'OTHER'];
  const statusOptions = ['Active', 'Inactive', 'Draft'];

  async function createCategory(name: string): Promise<string> {
    const code = deriveCode(name);
    await api.post('/admin/categories', { name, code });
    await qc.invalidateQueries({ queryKey: ['product-categories'] });
    toast.success(`Category "${name}" created`);
    return code;
  }

  const handleDelete = async (family: ProductFamily) => {
    if ((family.product_count || 0) > 0) {
      toast.error(`Reassign the ${family.product_count} linked product${family.product_count === 1 ? '' : 's'} before deleting this family.`);
      return;
    }
    if (!confirm(`Delete product family "${family.product_family_code}"? This cannot be undone.`)) return;
    setDeletingId(family.id);
    try {
      await api.delete(`/product-families/${family.id}`);
      toast.success('Product family deleted');
      qc.invalidateQueries({ queryKey: ['product-families'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete product family');
    } finally {
      setDeletingId(null);
    }
  };

  const columns: Column<ProductFamily>[] = [
    { key: 'product_family_code', header: 'Code', render: r => <EntityCode code={r.product_family_code} /> },
    { key: 'product_family_name', header: 'Family Name', render: r => <span className="font-medium">{r.product_family_name}</span> },
    { key: 'category_code', header: 'Category' },
    { key: 'product_count', header: 'Products', render: r => <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">{r.product_count}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      className: 'w-32',
      render: r => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Edit ${r.product_family_code}`}
            title={`Edit ${r.product_family_code}`}
            onClick={() => setEditRow(r)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${r.product_family_code}`}
            title={r.product_count ? 'Reassign linked products before deleting' : `Delete ${r.product_family_code}`}
            onClick={() => void handleDelete(r)}
            disabled={deletingId === r.id || (r.product_count || 0) > 0}
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Products" subtitle="Reusable product group definitions"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Family</Button>}
      />
      <div className="flex-1 bg-white overflow-auto">
        {isError ? (
          <QueryError message="Could not load product families" onRetry={() => refetch()} />
        ) : !isLoading && data?.items?.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No product families yet"
            description="Create a family to organize reusable product definitions in your catalog."
            actionLabel="Create a family"
            onAction={() => setShowNew(true)}
          />
        ) : (
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
              {
                label: 'Delete',
                icon: <Trash2 className="w-3.5 h-3.5" />,
                onClick: () => void handleDelete(row),
                danger: true,
              },
            ]}
          />
        )}
      </div>
      {showNew && (
        <NewEntityModal title="New Product Family" onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_family_code', label: 'Family Code', required: true, placeholder: 'PFM-XX' },
            { name: 'product_family_name', label: 'Family Name', required: true },
            { name: 'category_code', label: 'Category', options: categoryCodeOptions, onCreateOption: createCategory },
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
            product_family_code: editRow.product_family_code,
            product_family_name: editRow.product_family_name,
            category_code: editRow.category_code,
            description: (editRow as any).description || '',
            status: (editRow as any).status || '',
          }}
          fields={[
            { name: 'product_family_code', label: 'Family Code', required: true },
            { name: 'product_family_name', label: 'Family Name', required: true },
            { name: 'category_code', label: 'Category', options: categoryCodeOptions, onCreateOption: createCategory },
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
