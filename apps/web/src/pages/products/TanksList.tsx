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
import toast from 'react-hot-toast';
import { Plus, Copy, Pencil, Container, Trash2, Calculator } from 'lucide-react';

const TANK_TYPES = ['Display Tank', 'Sump', 'Refugium', 'Quarantine', 'Acclimation', 'Holding', 'Treatment', 'Header Tank', 'Buffer Tank', 'Other'];
const TANK_SHAPES = ['Rectangular', 'Cylindrical', 'Oval', 'Hexagonal', 'Custom'];
const TANK_MATERIALS = ['Acrylic', 'Glass', 'FRP', 'HDPE', 'GRP', 'Stainless Steel', 'Concrete', 'Other'];

const BLANK_FORM = { product_code: '', product_name: '', tank_family_id: '', application_type: '', shape_type: '', length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '', primary_material_code: '', standard_status: 'Active' };

export default function TanksList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const calcGross = useMemo(() => {
    const l = parseFloat(newForm.length_mm), w = parseFloat(newForm.width_mm), h = parseFloat(newForm.height_mm);
    return (l > 0 && w > 0 && h > 0) ? +(l * w * h / 1e9).toFixed(6) : null;
  }, [newForm.length_mm, newForm.width_mm, newForm.height_mm]);

  const calcOp = useMemo(() => {
    const l = parseFloat(newForm.length_mm), w = parseFloat(newForm.width_mm), wl = parseFloat(newForm.design_water_level_mm);
    return (l > 0 && w > 0 && wl > 0) ? +(l * w * wl / 1e9).toFixed(6) : null;
  }, [newForm.length_mm, newForm.width_mm, newForm.design_water_level_mm]);

  const { data: materialsData } = useQuery({
    queryKey: ['materials-list'],
    queryFn: () => api.get('/materials').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const materials: { material_code: string; material_name: string }[] = useMemo(
    () => materialsData?.items ?? [],
    [materialsData]
  );

  const { data: familiesData } = useQuery({
    queryKey: ['tank-families'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
  });

  const tankFamilies: any[] = familiesData?.items || [];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters-tanks', search, selectedFamilyId],
    queryFn: () => {
      let url = `/product-masters?category=Tank&page_size=200`;
      if (search) url += `&q=${search}`;
      if (selectedFamilyId) url += `&tank_family_id=${selectedFamilyId}`;
      return api.get(url).then(r => r.data);
    },
  });

  const fmtMm = (v: any) => v != null ? <span>{v} mm</span> : <span className="text-slate-300">—</span>;
  const fmtM3 = (v: any) => v != null ? <span>{v} m³</span> : <span className="text-slate-300">—</span>;

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Tank Name / Model', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'application_type', header: 'Type', render: r => r.application_type ? <span>{r.application_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'shape_type' as any, header: 'Shape', render: (r: any) => r.shape_type ? <span>{r.shape_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'length_mm' as any, header: 'L (mm)', render: (r: any) => fmtMm(r.length_mm) },
    { key: 'width_mm' as any, header: 'W (mm)', render: (r: any) => fmtMm(r.width_mm) },
    { key: 'height_mm' as any, header: 'H (mm)', render: (r: any) => fmtMm(r.height_mm) },
    { key: 'gross_volume_m3' as any, header: 'Gross Vol (m³)', render: (r: any) => fmtM3(r.gross_volume_m3) },
    { key: 'operating_volume_m3' as any, header: 'Op. Vol (m³)', render: (r: any) => fmtM3(r.operating_volume_m3) },
    { key: 'primary_material_code', header: 'Material', render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
    {
      key: '_delete' as any, header: '', className: 'w-10 text-right',
      render: (r: any) => (
        <button
          onClick={e => { e.stopPropagation(); setConfirmDelete({ id: r.id, name: r.product_name }); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-red-300 hover:text-red-500"
          title="Delete tank type"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  const selectedFamily = tankFamilies.find(f => f.id === selectedFamilyId);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title={selectedFamily ? selectedFamily.name : 'Tanks'}
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Tanks' }]}
        subtitle={selectedFamily ? selectedFamily.description || `${data?.pagination?.total ?? 0} tank types` : `${data?.pagination?.total ?? 0} tank types in library`}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Tank Type</Button>}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Family sidebar */}
        <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 overflow-auto">
          <div className="px-3 py-2.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Families</span>
          </div>
          <div className="py-1">
            <button
              onClick={() => setSelectedFamilyId(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-none transition-colors ${
                selectedFamilyId === null
                  ? 'bg-blue-600/10 text-blue-600 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Container className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">All Tanks</span>
              <span className="ml-auto text-xs text-slate-400">{data?.pagination?.total ?? ''}</span>
            </button>
            {tankFamilies.map((fam: any) => (
              <button
                key={fam.id}
                onClick={() => setSelectedFamilyId(fam.id === selectedFamilyId ? null : fam.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  selectedFamilyId === fam.id
                    ? 'bg-blue-600/10 text-blue-600 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Container className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                <span className="truncate">{fam.name}</span>
                <span className="ml-auto text-xs text-slate-400">{fam.product_count}</span>
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
            <DataTable
              columns={columns} data={data?.items || []} loading={isLoading} tableId="tanks-list"
              onRowClick={r => navigate(`/products/masters/${r.id}`)}
              emptyMessage="No tank types — add a tank model above or select a different family"
              contextMenuItems={row => [
                {
                  label: 'Edit',
                  icon: <Pencil className="w-3.5 h-3.5" />,
                  onClick: () => navigate(`/products/masters/${row.id}`),
                },
                {
                  label: 'Duplicate',
                  icon: <Copy className="w-3.5 h-3.5" />,
                  divider: true,
                  onClick: async () => {
                    try {
                      const res = await api.post(`/product-masters/${row.id}/duplicate`, {});
                      toast.success('Tank duplicated');
                      refetch();
                      navigate(`/products/masters/${res.data.id}`);
                    } catch { toast.error('Duplicate failed'); }
                  },
                },
              ]}
            />
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold text-slate-800">Delete tank type?</h3>
              <p className="text-sm text-slate-500">
                <span className="font-medium text-slate-700">{confirmDelete.name}</span> will be permanently removed. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await api.delete(`/product-masters/${confirmDelete.id}`);
                    toast.success('Tank type deleted');
                    setConfirmDelete(null);
                    refetch();
                  } catch (err: any) {
                    toast.error(err?.response?.data?.error?.message || 'Delete failed');
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl w-[540px] max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">New Tank Type</h2>
              <button onClick={() => { setShowNew(false); setNewForm({ ...BLANK_FORM }); }} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto px-6 py-4 flex flex-col gap-3">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Product Code <span className="text-red-500">*</span></label>
                  <input value={newForm.product_code} onChange={e => setNewForm(f => ({ ...f, product_code: e.target.value }))} placeholder="PM-TNK-ACR-001" className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Tank Name / Model <span className="text-red-500">*</span></label>
                  <input value={newForm.product_name} onChange={e => setNewForm(f => ({ ...f, product_name: e.target.value }))} placeholder="e.g. Acrylic Display Tank" className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Tank Family</label>
                  <select value={newForm.tank_family_id} onChange={e => setNewForm(f => ({ ...f, tank_family_id: e.target.value }))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                    <option value="">— none —</option>
                    {tankFamilies.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Tank Type</label>
                  <select value={newForm.application_type} onChange={e => setNewForm(f => ({ ...f, application_type: e.target.value }))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                    <option value="">— select —</option>
                    {TANK_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Shape</label>
                  <select value={newForm.shape_type} onChange={e => setNewForm(f => ({ ...f, shape_type: e.target.value }))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                    <option value="">— select —</option>
                    {TANK_SHAPES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Primary Material</label>
                  <select value={newForm.primary_material_code} onChange={e => setNewForm(f => ({ ...f, primary_material_code: e.target.value }))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                    <option value="">— None —</option>
                    {materials.map(m => (
                      <option key={m.material_code} value={m.material_code}>{m.material_code} — {m.material_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dimensions */}
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Dimensions</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { key: 'length_mm', label: 'Length (mm)' },
                    { key: 'width_mm', label: 'Width (mm)' },
                    { key: 'height_mm', label: 'Height (mm)' },
                    { key: 'design_water_level_mm', label: 'Water Level (mm)' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-600">{label}</label>
                      <input
                        type="number" min="0"
                        value={(newForm as any)[key]}
                        onChange={e => setNewForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder="mm"
                        className="border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Calculated volumes */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                    <Calculator className="w-3 h-3" /> Gross Volume (m³)
                    <span className="text-slate-400 font-normal normal-case tracking-normal">= L × W × H</span>
                  </label>
                  <div className={`border rounded-lg px-3 py-2 text-sm font-mono ${calcGross != null ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                    {calcGross != null ? `${calcGross} m³` : 'enter L, W, H'}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                    <Calculator className="w-3 h-3" /> Operating Volume (m³)
                    <span className="text-slate-400 font-normal normal-case tracking-normal">= L × W × WL</span>
                  </label>
                  <div className={`border rounded-lg px-3 py-2 text-sm font-mono ${calcOp != null ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                    {calcOp != null ? `${calcOp} m³` : 'enter L, W, WL'}
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Status</label>
                  <select value={newForm.standard_status} onChange={e => setNewForm(f => ({ ...f, standard_status: e.target.value }))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                    {['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => { setShowNew(false); setNewForm({ ...BLANK_FORM }); }} disabled={saving} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button
                disabled={saving || !newForm.product_code.trim() || !newForm.product_name.trim()}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const familyObj = tankFamilies.find((f: any) => f.id === newForm.tank_family_id);
                    await api.post('/product-masters', {
                      product_code: newForm.product_code.trim(),
                      product_name: newForm.product_name.trim(),
                      product_category: 'Tank',
                      tank_family_id: familyObj?.id ?? null,
                      application_type: newForm.application_type || null,
                      shape_type: newForm.shape_type || null,
                      primary_material_code: newForm.primary_material_code || null,
                      standard_status: newForm.standard_status,
                      length_mm: newForm.length_mm ? Number(newForm.length_mm) : null,
                      width_mm: newForm.width_mm ? Number(newForm.width_mm) : null,
                      height_mm: newForm.height_mm ? Number(newForm.height_mm) : null,
                      design_water_level_mm: newForm.design_water_level_mm ? Number(newForm.design_water_level_mm) : null,
                      gross_volume_m3: calcGross,
                      operating_volume_m3: calcOp,
                    });
                    toast.success('Tank type created');
                    refetch();
                    setShowNew(false);
                    setNewForm({ ...BLANK_FORM });
                  } catch (err: any) {
                    toast.error(err?.response?.data?.error?.message || 'Failed to create tank type');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {saving ? 'Creating…' : 'Create Tank Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
