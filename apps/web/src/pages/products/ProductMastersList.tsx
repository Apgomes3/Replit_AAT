import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useState, useMemo, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { ProductMaster } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import InlineStatusSelect from '../../components/ui/InlineStatusSelect';
import toast from 'react-hot-toast';
import { Plus, Copy, Pencil, X, Download, Package, Trash2 } from 'lucide-react';
import { exportCsv } from '../../lib/exportCsv';
import QueryError from '../../components/ui/QueryError';
import EmptyState from '../../components/ui/EmptyState';

const STATUSES = ['Draft', 'Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'];

function deriveCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export default function ProductMastersList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const selectedFamilyId = searchParams.get('family');
  const [showObsolete, setShowObsolete] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    product_code: '',
    product_name: '',
    product_family_id: selectedFamilyId || '',
    product_category: '',
    standard_status: 'Concept',
  });
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const quickAddInFlight = useRef(false);
  const [showNew, setShowNew] = useState(false);
  const [newProductInitialValues, setNewProductInitialValues] = useState<Record<string, any> | undefined>();
  const [editRow, setEditRow] = useState<ProductMaster | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [dupSaving, setDupSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creatingEditCategory, setCreatingEditCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryLoading, setNewCategoryLoading] = useState(false);
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    const resume = (location.state as any)?.resumeProductCreate;
    if (!resume?.draft) return;
    void qc.invalidateQueries({ queryKey: ['materials-list'] });
    const material = resume.material;
    setNewProductInitialValues({
      ...resume.draft,
      ...(material?.material_code
        ? { primary_material_code: `${material.material_code} — ${material.material_name}` }
        : {}),
    });
    setShowNew(true);
    navigate(currentPath, { replace: true, state: null });
  }, [location.state, currentPath, navigate, qc]);

  const selectFamily = (familyId: string | null) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (familyId) {
        next.set('family', familyId);
      } else {
        next.delete('family');
      }
      return next;
    }, { replace: true });
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['product-masters', search, showObsolete],
    queryFn: () => {
      const p = new URLSearchParams({ page_size: '500' });
      if (search) p.set('q', search);
      if (showObsolete) p.set('include_obsolete', 'true');
      return api.get(`/product-masters?${p}`).then(r => r.data);
    },
  });

  const { data: familiesData } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => api.get('/admin/categories').then(r => r.data),
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials-list'],
    queryFn: () => api.get('/materials').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const materials: { material_code: string; material_name: string }[] = useMemo(
    () => materialsData?.items ?? [], [materialsData]
  );
  const materialOptions = useMemo(() => materials.map(m => `${m.material_code} — ${m.material_name}`), [materials]);
  const familyNewOptions = useMemo(() => (familiesData?.items || []).filter((f: any) => f.category_code !== 'PIPING' && f.category_code !== 'TANK').map((f: any) => `${f.id} — ${f.product_family_name}`), [familiesData]);

  const families: any[] = familiesData?.items?.filter((f: any) => f.category_code !== 'PIPING' && f.category_code !== 'TANK') || [];
  const categoryOptions: string[] = categoriesData?.items?.map((c: any) => c.name) || ['Filtration', 'Pumping', 'Disinfection', 'Thermal', 'Pneumatic', 'Piping', 'Control', 'Structural', 'Instrumentation', 'Tank', 'Electrical', 'Other'];
  const familyOptions = familiesData?.items?.map((f: any) => f.product_family_code) || [];

  const catalogItems: ProductMaster[] = useMemo(
    () => (data?.items ?? []).filter((p: any) => {
      const status = String(p.standard_status ?? p.status ?? '').trim().toLowerCase();
      return p.product_category !== 'Tank'
        && p.product_category !== 'Piping'
        && (showObsolete || status !== 'obsolete');
    }),
    [data?.items, showObsolete],
  );
  const allItems: ProductMaster[] = useMemo(
    () => selectedFamilyId
      ? catalogItems.filter((p: any) => p.product_family_id === selectedFamilyId)
      : catalogItems,
    [catalogItems, selectedFamilyId],
  );

  const selectedFamily = families.find((f: any) => f.id === selectedFamilyId);

  async function createCategory(name: string): Promise<string> {
    const code = deriveCode(name);
    await api.post('/admin/categories', { name, code });
    await qc.invalidateQueries({ queryKey: ['product-categories'] });
    toast.success(`Category "${name}" created`);
    return name;
  }

  async function openMaterialManagement(name: string, currentValues?: Record<string, any>): Promise<string> {
    navigate('/knowledge/materials', {
      state: {
        returnTo: currentPath,
        returnContext: {
          type: 'product-create',
          draft: currentValues || {},
          materialName: name,
        },
      },
    });
    return name;
  }

  const enterEditMode = () => {
    setQuickAddForm({
      product_code: '',
      product_name: '',
      product_family_id: selectedFamilyId || '',
      product_category: '',
      standard_status: 'Concept',
    });
    setEditMode(true);
  };

  const handleQuickAdd = async (fromBlur = false) => {
    const productCode = quickAddForm.product_code.trim().toUpperCase();
    const productName = quickAddForm.product_name.trim();
    if (fromBlur && !productCode && !productName) return;
    if (!productCode || !productName) {
      toast.error('Product code and product name are required');
      return;
    }
    if (quickAddInFlight.current) return;
    quickAddInFlight.current = true;
    setQuickAddSaving(true);
    try {
      await api.post('/product-masters', {
        product_code: productCode,
        product_name: productName,
        product_family_id: quickAddForm.product_family_id || null,
        product_category: quickAddForm.product_category || null,
        standard_status: quickAddForm.standard_status || 'Concept',
      });
      toast.success(`Product ${productCode} added`);
      setQuickAddForm({
        product_code: '',
        product_name: '',
        product_family_id: selectedFamilyId || '',
        product_category: '',
        standard_status: 'Concept',
      });
      await refetch();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Product could not be added');
    } finally {
      setQuickAddSaving(false);
      quickAddInFlight.current = false;
    }
  };

  const handleQuickAddBlur = (event: React.FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget as Node)) return;
    void handleQuickAdd(true);
  };

  async function handleCreateEditCategory() {
    if (!newCategoryName.trim()) return;
    setNewCategoryLoading(true);
    try {
      const name = await createCategory(newCategoryName.trim());
      setEditForm((f: any) => ({ ...f, product_category: name }));
      setCreatingEditCategory(false);
      setNewCategoryName('');
    } finally {
      setNewCategoryLoading(false);
    }
  }

  const openEdit = (row: ProductMaster) => {
    setEditRow(row);
    setEditForm({
      product_code: row.product_code || '',
      product_name: row.product_name || '',
      product_category: row.product_category || '',
      application_type: (row as any).application_type || '',
      design_flow_m3h: (row as any).design_flow_m3h != null ? String((row as any).design_flow_m3h) : '',
      design_head_m: (row as any).design_head_m != null ? String((row as any).design_head_m) : '',
      primary_material_code: row.primary_material_code || '',
      standard_status: row.standard_status || 'Concept',
      notes: (row as any).notes || '',
      manufacturer: (row as any).manufacturer || '',
      model: (row as any).model || '',
    });
  };

  const handleEditSave = async () => {
    if (!editRow) return;
    if (!editForm.product_code?.trim()) { toast.error('Product code is required'); return; }
    setEditSaving(true);
    try {
      await api.put(`/product-masters/${editRow.id}`, {
        product_code: editForm.product_code.trim().toUpperCase(),
        product_name: editForm.product_name,
        product_category: editForm.product_category || null,
        application_type: editForm.application_type || null,
        design_flow_m3h: editForm.design_flow_m3h ? parseFloat(editForm.design_flow_m3h) : null,
        design_head_m: editForm.design_head_m ? parseFloat(editForm.design_head_m) : null,
        primary_material_code: editForm.primary_material_code || null,
        standard_status: editForm.standard_status,
        notes: editForm.notes || null,
        synonyms: (editRow as any).synonyms || [],
        image_url: (editRow as any).image_url || null,
        product_family_id: (editRow as any).product_family_id || null,
        manufacturer: editForm.manufacturer || null,
        model: editForm.model || null,
      });
      toast.success('Product updated');
      setEditRow(null);
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ['pump-selections'] }),
      ]);
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const fmtCurrency = (val: any) =>
    val != null ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-slate-300">—</span>;

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', sortable: true, render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Product Name', sortable: true, filterable: true, render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'product_family_name', header: 'Family', sortable: true, filterable: true },
    { key: 'product_category', header: 'Category', sortable: true, filterable: true },
    { key: 'cost', header: 'Cost', sortable: true, sortValue: r => (r as any).cost ?? 0, render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.cost)}</span> },
    { key: 'sell_price', header: 'Sell Price', sortable: true, sortValue: r => (r as any).sell_price ?? 0, render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.sell_price)}</span> },
    { key: 'standard_status', header: 'Status', sortable: true, filterable: true, filterValue: r => r.standard_status ?? '', render: r => (
      <InlineStatusSelect
        value={r.standard_status ?? 'Concept'}
        options={STATUSES}
        onSave={async (status) => {
          await api.patch(`/product-masters/${r.id}/status`, { standard_status: status });
          toast.success('Status updated');
          refetch();
        }}
      />
    ) },
    ...(editMode ? [{
      key: 'edit',
      header: 'Edit',
      className: 'w-20',
      render: (r: ProductMaster) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Edit ${r.product_code}`}
            onClick={event => { event.stopPropagation(); openEdit(r); }}
            className="inline-flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button
            type="button"
            aria-label={`Delete ${r.product_code}`}
            onClick={event => { event.stopPropagation(); setConfirmDelete({ id: r.id, name: r.product_code }); }}
            className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title={selectedFamily ? selectedFamily.product_family_name : 'Products'}
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Products' }]}
        subtitle={selectedFamily
          ? `${selectedFamily.description ? `${selectedFamily.description} · ` : ''}${allItems.length} products`
          : `${allItems.length} products in catalog`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={showObsolete}
              onClick={() => setShowObsolete(value => !value)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                showObsolete
                  ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                  : 'bg-white border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {showObsolete ? 'Hide obsoleted' : 'Show obsoleted'}
            </button>
            <button
              onClick={() => exportCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, [
                { header: 'Code',       value: r => r.product_code ?? '' },
                { header: 'Name',       value: r => r.product_name ?? '' },
                { header: 'Family',     value: r => (r as any).product_family_name ?? '' },
                { header: 'Category',   value: r => r.product_category ?? '' },
                { header: 'Status',     value: r => r.standard_status ?? '' },
                { header: 'Material',   value: r => r.primary_material_code ?? '' },
                { header: 'Cost',       value: r => r.cost != null ? String(r.cost) : '' },
                { header: 'Sell Price', value: r => r.sell_price != null ? String(r.sell_price) : '' },
              ], allItems as ProductMaster[])}
              disabled={!allItems.length}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <Button
              variant={editMode ? 'primary' : 'secondary'}
              onClick={() => editMode ? setEditMode(false) : enterEditMode()}
            >
              <Pencil className="w-4 h-4" />{editMode ? 'Done Editing' : 'Edit Mode'}
            </Button>
            {!editMode && (
              <Button variant="primary" onClick={() => { setNewProductInitialValues(undefined); setShowNew(true); }}>
                <Plus className="w-4 h-4" />New Product
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Family sidebar */}
        <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 overflow-auto">
          <div className="px-3 py-2.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Families</span>
          </div>
          <div className="py-1">
            <button
              onClick={() => selectFamily(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                selectedFamilyId === null
                  ? 'bg-blue-600/10 text-blue-600 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Package className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">All Products</span>
              <span className="ml-auto text-xs text-slate-400">{catalogItems.length}</span>
            </button>
            {families.map((fam: any) => (
              <button
                key={fam.id}
                onClick={() => selectFamily(fam.id === selectedFamilyId ? null : fam.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  selectedFamilyId === fam.id
                    ? 'bg-blue-600/10 text-blue-600 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Package className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                <span className="truncate">{fam.product_family_name}</span>
                <span className="ml-auto text-xs text-slate-400">
                  {catalogItems.filter((p: any) => p.product_family_id === fam.id).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-200">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or code..."
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-600"
            />
          </div>
           <div className="flex-1 overflow-auto">
             {isError ? (
               <QueryError message="Could not load products" onRetry={() => refetch()} />
             ) : !isLoading && allItems.length === 0 && !search && !selectedFamilyId ? (
               <EmptyState
                 icon={Package}
                  title={showObsolete ? 'No products found' : 'No non-obsolete products found'}
                  description={showObsolete
                    ? 'Add a product to your catalog, or adjust your filters to find an existing product.'
                    : 'Show obsoleted products, add a product to your catalog, or adjust your filters to find an existing product.'}
                 actionLabel="Add a product"
                 onAction={() => setShowNew(true)}
               />
             ) : (
               <DataTable
                 columns={columns} data={allItems} loading={isLoading} tableId="products-list"
                 onRowClick={r => navigate(`/products/masters/${r.id}`)}
                  emptyMessage={showObsolete
                    ? 'No products — adjust filters or add a product'
                    : 'No non-obsolete products — show obsoleted products or adjust filters'}
                 contextMenuItems={row => [
                   { label: 'Edit', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => openEdit(row) },
                   {
                     label: dupSaving === row.id ? 'Duplicating…' : 'Duplicate', icon: <Copy className="w-3.5 h-3.5" />,
                     onClick: async () => {
                       if (dupSaving) return;
                       setDupSaving(row.id);
                       try {
                         const res = await api.post(`/product-masters/${row.id}/duplicate`, {});
                         toast.success('Product duplicated');
                         refetch();
                         navigate(`/products/masters/${res.data.id}`);
                       } catch (e: any) { toast.error(e?.response?.data?.error?.message || 'Duplicate failed'); }
                       finally { setDupSaving(null); }
                     },
                   },
                   {
                     label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, divider: true, danger: true,
                     onClick: () => setConfirmDelete({ id: row.id, name: row.product_code }),
                   },
                 ]}
               />
             )}
           </div>
            {editMode && (
              <section
                className="border-t border-blue-100 bg-blue-50/60 px-6 py-4"
                onBlur={handleQuickAddBlur}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-800">Quick add product</h2>
                    <p className="text-xs text-slate-500">Enter the code and name. Click outside this area to save, or use Add Product.</p>
                  </div>
                  <span className="text-xs font-medium text-blue-700">Edit mode</span>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_1.25fr_1fr_auto]">
                  <input
                    aria-label="Quick product code"
                    value={quickAddForm.product_code}
                    onChange={event => setQuickAddForm(form => ({ ...form, product_code: event.target.value.toUpperCase() }))}
                    placeholder="Product code *"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    aria-label="Quick product name"
                    value={quickAddForm.product_name}
                    onChange={event => setQuickAddForm(form => ({ ...form, product_name: event.target.value }))}
                    placeholder="Product name *"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <select
                    aria-label="Quick product family"
                    value={quickAddForm.product_family_id}
                    onChange={event => setQuickAddForm(form => ({ ...form, product_family_id: event.target.value }))}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Family (optional)</option>
                    {families.map((family: any) => (
                      <option key={family.id} value={family.id}>{family.product_family_code} — {family.product_family_name}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Quick product category"
                    value={quickAddForm.product_category}
                    onChange={event => setQuickAddForm(form => ({ ...form, product_category: event.target.value }))}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Category (optional)</option>
                    {categoryOptions.map(category => <option key={category}>{category}</option>)}
                  </select>
                  <Button variant="primary" onClick={handleQuickAdd} disabled={quickAddSaving}>
                    <Plus className="h-4 w-4" />{quickAddSaving ? 'Adding…' : 'Add Product'}
                  </Button>
                </div>
              </section>
            )}
        </div>
      </div>


      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold text-slate-800">Delete product?</h3>
              <p className="text-sm text-slate-500">
                <span className="font-medium text-slate-700">{confirmDelete.name}</span> will be permanently removed. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button disabled={deleting} onClick={async () => {
                const id = confirmDelete.id;
                setDeleting(true);
                try {
                  await api.delete(`/product-masters/${id}`);
                  toast.success('Product deleted');
                  setConfirmDelete(null);
                  refetch();
                } catch (err: any) {
                  toast.error(err?.response?.data?.error?.message || 'Delete failed');
                } finally { setDeleting(false); }
              }} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 font-medium">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <NewEntityModal
          title="New Product Master"
          initialValues={newProductInitialValues}
          onClose={() => { setShowNew(false); setNewProductInitialValues(undefined); }}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: 'PM-XX-000' },
            { name: 'product_name', label: 'Product Name', required: true },
            { name: 'product_family_id', label: 'Product Family', options: familyNewOptions },
            { name: 'product_category', label: 'Category', options: categoryOptions, onCreateOption: createCategory },
            { name: 'application_type', label: 'Application Type' },
            { name: 'manufacturer', label: 'Manufacturer', placeholder: 'e.g. Grundfos' },
            { name: 'model', label: 'Model', placeholder: 'e.g. CR 5-10' },
            { name: 'design_flow_m3h', label: 'Design Flow (m³/h)', type: 'number' },
            { name: 'primary_material_code', label: 'Primary Material', options: materialOptions, onCreateOption: openMaterialManagement },
            { name: 'standard_status', label: 'Status', options: STATUSES },
          ]}
          onSubmit={async (formData) => {
            await api.post('/product-masters', {
              ...formData,
              product_family_id: formData.product_family_id ? formData.product_family_id.split(' — ')[0] : null,
              primary_material_code: formData.primary_material_code?.split(' — ')[0] || null,
            });
            toast.success('Product master created');
            refetch();
            setShowNew(false);
            setNewProductInitialValues(undefined);
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
              <button aria-label="Close edit product form" title="Close edit product form" onClick={() => setEditRow(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Product Code *</label>
                <input value={editForm.product_code} onChange={e => setEditForm((f: any) => ({ ...f, product_code: e.target.value.toUpperCase() }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Product Name *</label>
                <input value={editForm.product_name} onChange={e => setEditForm((f: any) => ({ ...f, product_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                {creatingEditCategory ? (
                  <div className="space-y-1.5">
                    <input autoFocus type="text" value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateEditCategory(); } if (e.key === 'Escape') setCreatingEditCategory(false); }}
                      placeholder="New category name…"
                      className="w-full border border-blue-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                    />
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={newCategoryLoading || !newCategoryName.trim()} onClick={handleCreateEditCategory}
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 font-medium">
                        {newCategoryLoading ? 'Creating…' : '+ Create'}
                      </button>
                      <button type="button" onClick={() => setCreatingEditCategory(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <select value={editForm.product_category}
                    onChange={e => { if (e.target.value === '__CREATE_NEW__') { setCreatingEditCategory(true); setNewCategoryName(''); } else { setEditForm((f: any) => ({ ...f, product_category: e.target.value })); } }}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                    <option value="">— None —</option>
                    {categoryOptions.map(c => <option key={c}>{c}</option>)}
                    <option value="__CREATE_NEW__">＋ Add new Category…</option>
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editForm.standard_status} onChange={e => setEditForm((f: any) => ({ ...f, standard_status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Application Type</label>
                <input value={editForm.application_type} onChange={e => setEditForm((f: any) => ({ ...f, application_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                <input type="number" value={editForm.design_flow_m3h} onChange={e => setEditForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Design Head (m)</label>
                <input type="number" value={editForm.design_head_m} onChange={e => setEditForm((f: any) => ({ ...f, design_head_m: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material</label>
                <select value={editForm.primary_material_code} onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">— None —</option>
                  {materials.map(m => <option key={m.material_code} value={m.material_code}>{m.material_code} — {m.material_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Manufacturer</label>
                <input value={editForm.manufacturer} onChange={e => setEditForm((f: any) => ({ ...f, manufacturer: e.target.value }))}
                  placeholder="e.g. Grundfos"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                <input value={editForm.model} onChange={e => setEditForm((f: any) => ({ ...f, model: e.target.value }))}
                  placeholder="e.g. CR 5-10"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
              <Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
              <Button onClick={handleEditSave} disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
