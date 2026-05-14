import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
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
import { Plus, Upload, Copy, Pencil, X, Pipette } from 'lucide-react';

const FITTING_TYPES = ['Pipe', 'Fitting', 'Valve', 'Flange', 'Coupling', 'Reducer', 'Union', 'Elbow', 'Tee', 'Cap', 'Other'];
const BRACKET_TYPES = ['Bracket', 'Support', 'Clamp', 'Hanger', 'Saddle', 'Shoe', 'Strut'];
const ALL_PIPE_TYPES = [...FITTING_TYPES, ...BRACKET_TYPES];

const bracketTypeSet = new Set(BRACKET_TYPES);

function isBracketing(item: ProductMaster) {
  return item.application_type ? bracketTypeSet.has(item.application_type) : false;
}

const SIDEBAR_GROUPS = [
  { key: 'all-fittings', label: 'Piping Fittings', filter: (items: ProductMaster[]) => items.filter(i => !isBracketing(i)) },
  { key: 'all-bracketing', label: 'Bracketing', filter: (items: ProductMaster[]) => items.filter(i => isBracketing(i)) },
];

const TYPE_GROUPS = FITTING_TYPES.map(t => ({ key: t, label: t, type: 'fitting' as const }));
const BRACKET_GROUPS = BRACKET_TYPES.map(t => ({ key: t, label: t, type: 'bracket' as const }));

export default function PipingList() {
  const navigate = useNavigate();
  const [selectedKey, setSelectedKey] = useState<string>('all-fittings');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [dupModal, setDupModal] = useState<{ sourceId: string; product_code: string; product_name: string; application_type: string; standard_status: string } | null>(null);
  const [dupSaving, setDupSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters-piping', search],
    queryFn: () => api.get(`/product-masters?category=Piping${search ? `&q=${search}` : ''}&page_size=200`).then(r => r.data),
  });

  const { data: families } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
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

  const pipingFamilies = families?.items?.filter((f: any) => f.category_code === 'PIPING') || [];
  const familyOptions = pipingFamilies.map((f: any) => f.product_family_code);

  const allItems: ProductMaster[] = data?.items || [];
  const fittings = allItems.filter(i => !isBracketing(i));
  const bracketing = allItems.filter(i => isBracketing(i));

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of allItems) {
      const t = item.application_type || 'Other';
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [allItems]);

  const displayed: ProductMaster[] = useMemo(() => {
    if (selectedKey === 'all-fittings') return fittings;
    if (selectedKey === 'all-bracketing') return bracketing;
    return allItems.filter(i => i.application_type === selectedKey);
  }, [allItems, fittings, bracketing, selectedKey]);

  const isInBracketingMode = selectedKey === 'all-bracketing' || BRACKET_TYPES.includes(selectedKey);
  const newItemTypeOptions = isInBracketingMode ? BRACKET_TYPES : FITTING_TYPES;

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

  const selectedLabel =
    selectedKey === 'all-fittings' ? 'Piping Fittings' :
    selectedKey === 'all-bracketing' ? 'Bracketing' :
    selectedKey;

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
        title={selectedLabel}
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Pipes & Fittings' }]}
        subtitle={`${displayed.length} items`}
        actions={
          <div className="flex gap-2">
            {!isInBracketingMode && (
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

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 overflow-auto">
          {/* Fittings group */}
          <div className="px-3 py-2.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pipes & Fittings</span>
          </div>
          <div className="py-1">
            <button
              onClick={() => setSelectedKey('all-fittings')}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                selectedKey === 'all-fittings' ? 'bg-blue-600/10 text-blue-600 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Pipette className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">All Fittings</span>
              <span className="ml-auto text-xs text-slate-400">{fittings.length || ''}</span>
            </button>
            {TYPE_GROUPS.filter(g => (typeCounts[g.key] ?? 0) > 0).map(g => (
              <button
                key={g.key}
                onClick={() => setSelectedKey(selectedKey === g.key ? 'all-fittings' : g.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  selectedKey === g.key ? 'bg-blue-600/10 text-blue-600 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Pipette className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                <span className="truncate">{g.label}</span>
                <span className="ml-auto text-xs text-slate-400">{typeCounts[g.key] || ''}</span>
              </button>
            ))}
          </div>

          {/* Bracketing group */}
          <div className="px-3 py-2.5 border-b border-t border-slate-100 mt-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bracketing</span>
          </div>
          <div className="py-1">
            <button
              onClick={() => setSelectedKey('all-bracketing')}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                selectedKey === 'all-bracketing' ? 'bg-blue-600/10 text-blue-600 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Pipette className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">All Bracketing</span>
              <span className="ml-auto text-xs text-slate-400">{bracketing.length || ''}</span>
            </button>
            {BRACKET_GROUPS.filter(g => (typeCounts[g.key] ?? 0) > 0).map(g => (
              <button
                key={g.key}
                onClick={() => setSelectedKey(selectedKey === g.key ? 'all-bracketing' : g.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  selectedKey === g.key ? 'bg-blue-600/10 text-blue-600 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Pipette className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                <span className="truncate">{g.label}</span>
                <span className="ml-auto text-xs text-slate-400">{typeCounts[g.key] || ''}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-200 flex items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or code..."
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-600"
            />
            <span className="text-xs text-slate-400 ml-auto">{displayed.length} item{displayed.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex-1 overflow-auto">
            <DataTable
              columns={columns} data={displayed} loading={isLoading}
              tableId={`piping-${selectedKey}`}
              onRowClick={r => navigate(`/products/masters/${r.id}`)}
              emptyMessage="No items in this category — add one or select a different type"
              contextMenuItems={row => [
                { label: 'Edit', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => openEdit(row) },
                {
                  label: 'Duplicate', icon: <Copy className="w-3.5 h-3.5" />, divider: true,
                  onClick: () => setDupModal({ sourceId: row.id, product_code: row.product_code + '-COPY', product_name: 'Copy of ' + row.product_name, application_type: row.application_type || '', standard_status: row.standard_status || 'Concept' }),
                },
              ]}
            />
          </div>
        </div>
      </div>

      {dupModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="font-semibold text-slate-800">Duplicate Item</h2>
                <p className="text-xs text-slate-400 mt-0.5">Review and edit before creating the copy</p>
              </div>
              <button onClick={() => setDupModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Product Code *</label>
                <input autoFocus value={dupModal.product_code}
                  onChange={e => setDupModal(f => f && ({ ...f, product_code: e.target.value.toUpperCase() }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={dupModal.standard_status} onChange={e => setDupModal(f => f && ({ ...f, standard_status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Item Name *</label>
                <input value={dupModal.product_name}
                  onChange={e => setDupModal(f => f && ({ ...f, product_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={dupModal.application_type} onChange={e => setDupModal(f => f && ({ ...f, application_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">— None —</option>
                  {ALL_PIPE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setDupModal(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={async () => {
                if (!dupModal.product_code.trim() || !dupModal.product_name.trim()) { toast.error('Code and name are required'); return; }
                setDupSaving(true);
                try {
                  const res = await api.post(`/product-masters/${dupModal.sourceId}/duplicate`, { product_code: dupModal.product_code.trim(), product_name: dupModal.product_name.trim(), standard_status: dupModal.standard_status });
                  toast.success('Item duplicated');
                  setDupModal(null);
                  refetch();
                  navigate(`/products/masters/${res.data.id}`);
                } catch (e: any) { toast.error(e?.response?.data?.error?.message || 'Duplicate failed'); }
                finally { setDupSaving(false); }
              }} disabled={dupSaving} className="px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium">{dupSaving ? 'Creating…' : 'Duplicate'}</button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <NewEntityModal
          title={isInBracketingMode ? 'New Bracket / Support' : 'New Pipe / Fitting'}
          onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: isInBracketingMode ? 'PM-BKT-SS-001' : 'PM-FIT-SS-001' },
            { name: 'product_name', label: 'Item Name', required: true },
            { name: 'product_family_id', label: 'Family', options: familyOptions },
            { name: 'application_type', label: 'Type', options: newItemTypeOptions },
            { name: 'primary_material_code', label: 'Primary Material', options: materialOptions },
            { name: 'standard_status', label: 'Status', options: ['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'] },
          ]}
          onSubmit={async (formData) => {
            const familyObj = pipingFamilies.find((f: any) => f.product_family_code === formData.product_family_id);
            await api.post('/product-masters', {
              ...formData,
              product_category: 'Piping',
              product_family_id: familyObj?.id ?? undefined,
              primary_material_code: formData.primary_material_code?.split(' — ')[0] || null,
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
                <h2 className="font-semibold text-slate-800">Edit {isInBracketingMode ? 'Bracket' : 'Fitting'}</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{editRow.product_code}</p>
              </div>
              <button onClick={() => setEditRow(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Item Name</label>
                <input value={editForm.product_name} onChange={e => setEditForm((f: any) => ({ ...f, product_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={editForm.application_type} onChange={e => setEditForm((f: any) => ({ ...f, application_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">— None —</option>
                  {ALL_PIPE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editForm.standard_status} onChange={e => setEditForm((f: any) => ({ ...f, standard_status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material</label>
                <select value={editForm.primary_material_code}
                  onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">— None —</option>
                  {materials.map((m: any) => (
                    <option key={m.material_code} value={m.material_code}>{m.material_code} — {m.material_name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
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
