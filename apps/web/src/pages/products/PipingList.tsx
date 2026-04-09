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
import PipingCsvImport from './PipingCsvImport';
import toast from 'react-hot-toast';
import { Plus, Upload, Copy, Pencil, X } from 'lucide-react';

const FITTING_TYPES = ['Pipe', 'Fitting', 'Valve', 'Flange', 'Coupling', 'Reducer', 'Union', 'Elbow', 'Tee', 'Cap', 'Other'];
const BRACKET_TYPES = ['Bracket', 'Support', 'Clamp', 'Hanger', 'Saddle', 'Shoe', 'Strut'];
const ALL_PIPE_TYPES = [...FITTING_TYPES, ...BRACKET_TYPES];

const fittingTypeSet = new Set(FITTING_TYPES);
const bracketTypeSet = new Set(BRACKET_TYPES);

function isBracketing(item: ProductMaster) {
  return item.application_type ? bracketTypeSet.has(item.application_type) : false;
}

export default function PipingList() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'fittings' | 'bracketing'>('fittings');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters-piping', search],
    queryFn: () => api.get(`/product-masters?category=Piping${search ? `&q=${search}` : ''}&page_size=200`).then(r => r.data),
  });

  const { data: families } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const pipingFamilies = families?.items?.filter((f: any) => f.category_code === 'PIPING') || [];
  const familyOptions = pipingFamilies.map((f: any) => f.product_family_code);

  const allItems: ProductMaster[] = data?.items || [];
  const fittings = allItems.filter(i => !isBracketing(i));
  const bracketing = allItems.filter(i => isBracketing(i));
  const displayed = tab === 'fittings' ? fittings : bracketing;

  const openEdit = (row: any) => {
    setEditRow(row);
    setEditForm({
      product_name: row.product_name || '',
      application_type: row.application_type || '',
      primary_material_code: row.primary_material_code || '',
      standard_status: row.standard_status || 'Concept',
      notes: row.notes || '',
    });
  };

  const handleEditSave = async () => {
    if (!editRow) return;
    setEditSaving(true);
    try {
      await api.put(`/product-masters/${editRow.id}`, {
        product_name: editForm.product_name,
        product_category: editRow.product_category,
        application_type: editForm.application_type || null,
        primary_material_code: editForm.primary_material_code || null,
        standard_status: editForm.standard_status,
        notes: editForm.notes || null,
        synonyms: editRow.synonyms || [],
        image_url: editRow.image_url || null,
        product_family_id: editRow.product_family_id || null,
      });
      toast.success('Item updated');
      setEditRow(null);
      refetch();
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Item Name', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'product_family_name', header: 'Family' },
    { key: 'application_type', header: 'Type', render: r => r.application_type ? <span>{r.application_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'primary_material_code', header: 'Material', render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
  ];

  const newItemTypeOptions = tab === 'fittings' ? FITTING_TYPES : BRACKET_TYPES;
  const total = displayed.length;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Pipes & Fittings"
        subtitle={`${data?.pagination?.total ?? 0} items in piping library`}
        actions={
          <div className="flex gap-2">
            {tab === 'fittings' && (
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <Upload className="w-4 h-4" /> Import CSV
              </Button>
            )}
            <Button variant="primary" onClick={() => setShowNew(true)}>
              <Plus className="w-4 h-4" /> New Item
            </Button>
          </div>
        }
      />

      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6">
        <div className="flex items-center gap-0.5 text-sm">
          <button onClick={() => setTab('fittings')}
            className={`px-3 py-1.5 transition-colors ${tab === 'fittings' ? 'text-amber-600 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
            Piping Fittings
            <span className={`ml-1.5 text-xs font-normal ${tab === 'fittings' ? 'text-amber-600/70' : 'text-slate-300'}`}>{fittings.length}</span>
          </button>
          <button onClick={() => setTab('bracketing')}
            className={`px-3 py-1.5 transition-colors ${tab === 'bracketing' ? 'text-amber-600 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
            Bracketing
            <span className={`ml-1.5 text-xs font-normal ${tab === 'bracketing' ? 'text-amber-600/70' : 'text-slate-300'}`}>{bracketing.length}</span>
          </button>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-56 focus:outline-none focus:border-amber-600" />
        <span className="text-xs text-slate-400 ml-auto">{total} {tab === 'fittings' ? 'fitting' : 'bracket'}{total !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 bg-white overflow-auto">
        <DataTable
          columns={columns} data={displayed} loading={isLoading}
          tableId={tab === 'fittings' ? 'piping-fittings' : 'piping-bracketing'}
          onRowClick={r => navigate(`/products/masters/${r.id}`)}
          emptyMessage={tab === 'fittings'
            ? 'No piping fittings — add one manually or import from CSV'
            : 'No bracketing items — add a bracket, support or clamp'}
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
                  toast.success('Item duplicated');
                  refetch();
                  navigate(`/products/masters/${res.data.id}`);
                } catch { toast.error('Duplicate failed'); }
              },
            },
          ]}
        />
      </div>

      {showNew && (
        <NewEntityModal
          title={tab === 'fittings' ? 'New Pipe / Fitting' : 'New Bracket / Support'}
          onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: tab === 'fittings' ? 'PM-FIT-SS-001' : 'PM-BKT-SS-001' },
            { name: 'product_name', label: 'Item Name', required: true },
            { name: 'product_family_id', label: 'Family', options: familyOptions },
            { name: 'application_type', label: 'Type', options: newItemTypeOptions },
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
            toast.success('Item created');
            refetch();
            setShowNew(false);
          }}
        />
      )}

      {showImport && (
        <PipingCsvImport
          onClose={() => setShowImport(false)}
          onImported={() => { refetch(); setShowImport(false); }}
        />
      )}

      {editRow && editForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <div>
                <h2 className="font-semibold text-slate-800">Edit {tab === 'fittings' ? 'Fitting' : 'Bracket'}</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{editRow.product_code}</p>
              </div>
              <button onClick={() => setEditRow(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Item Name</label>
                <input value={editForm.product_name} onChange={e => setEditForm((f: any) => ({ ...f, product_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={editForm.application_type} onChange={e => setEditForm((f: any) => ({ ...f, application_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  <option value="">— None —</option>
                  {ALL_PIPE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editForm.standard_status} onChange={e => setEditForm((f: any) => ({ ...f, standard_status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
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
