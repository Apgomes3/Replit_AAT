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
import { Plus, Copy, Pencil, X } from 'lucide-react';

const STATUSES = ['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'];

export default function ProductMastersList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editRow, setEditRow] = useState<ProductMaster | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);

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
  const familyOptions = families?.items?.map((f: any) => f.product_family_code) || [];

  const openEdit = (row: ProductMaster) => {
    setEditRow(row);
    setEditForm({
      product_name: row.product_name || '',
      product_category: row.product_category || '',
      application_type: (row as any).application_type || '',
      design_flow_m3h: (row as any).design_flow_m3h != null ? String((row as any).design_flow_m3h) : '',
      design_head_m: (row as any).design_head_m != null ? String((row as any).design_head_m) : '',
      power_kw: (row as any).power_kw != null ? String((row as any).power_kw) : '',
      primary_material_code: row.primary_material_code || '',
      standard_status: row.standard_status || 'Concept',
      notes: (row as any).notes || '',
    });
  };

  const handleEditSave = async () => {
    if (!editRow) return;
    setEditSaving(true);
    try {
      await api.put(`/product-masters/${editRow.id}`, {
        product_name: editForm.product_name,
        product_category: editForm.product_category || null,
        application_type: editForm.application_type || null,
        design_flow_m3h: editForm.design_flow_m3h ? parseFloat(editForm.design_flow_m3h) : null,
        design_head_m: editForm.design_head_m ? parseFloat(editForm.design_head_m) : null,
        power_kw: editForm.power_kw ? parseFloat(editForm.power_kw) : null,
        primary_material_code: editForm.primary_material_code || null,
        standard_status: editForm.standard_status,
        notes: editForm.notes || null,
        synonyms: (editRow as any).synonyms || [],
        image_url: (editRow as any).image_url || null,
        product_family_id: (editRow as any).product_family_id || null,
      });
      toast.success('Product updated');
      setEditRow(null);
      refetch();
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const fmtCurrency = (val: any) =>
    val != null ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-slate-300">—</span>;

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Product Name', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'product_family_name', header: 'Family' },
    { key: 'product_category', header: 'Category' },
    { key: 'cost', header: 'Cost', render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.cost)}</span> },
    { key: 'sell_price', header: 'Sell Price', render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.sell_price)}</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Product Masters" subtitle={`${data?.pagination?.total ?? 0} products in Shark OS`}
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Products' }]}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Product</Button>}
      />
      <div className="p-4 border-b border-slate-200 bg-white">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-amber-600" />
      </div>
      <div className="flex-1 bg-white overflow-auto">
        <DataTable
          columns={columns} data={data?.items || []} loading={isLoading} tableId="products-list"
          onRowClick={r => navigate(`/products/masters/${r.id}`)}
          contextMenuItems={row => [
            {
              label: 'Edit',
              icon: <Pencil className="w-3.5 h-3.5" />,
              onClick: () => openEdit(row),
            },
            {
              label: 'Duplicate',
              icon: <Copy className="w-3.5 h-3.5" />,
              divider: true,
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
            { name: 'standard_status', label: 'Status', options: STATUSES },
          ]}
          onSubmit={async (data) => {
            await api.post('/product-masters', data);
            toast.success('Product master created');
            refetch();
            setShowNew(false);
          }}
        />
      )}

      {editRow && editForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <div>
                <h2 className="font-semibold text-slate-800">Edit Product</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{editRow.product_code}</p>
              </div>
              <button onClick={() => setEditRow(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Product Name</label>
                <input value={editForm.product_name} onChange={e => setEditForm((f: any) => ({ ...f, product_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <select value={editForm.product_category} onChange={e => setEditForm((f: any) => ({ ...f, product_category: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  <option value="">— None —</option>
                  {categoryOptions.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editForm.standard_status} onChange={e => setEditForm((f: any) => ({ ...f, standard_status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Application Type</label>
                <input value={editForm.application_type} onChange={e => setEditForm((f: any) => ({ ...f, application_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                <input type="number" value={editForm.design_flow_m3h} onChange={e => setEditForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Design Head (m)</label>
                <input type="number" value={editForm.design_head_m} onChange={e => setEditForm((f: any) => ({ ...f, design_head_m: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Power (kW)</label>
                <input type="number" value={editForm.power_kw} onChange={e => setEditForm((f: any) => ({ ...f, power_kw: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material Code</label>
                <input value={editForm.primary_material_code} onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
              <Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
