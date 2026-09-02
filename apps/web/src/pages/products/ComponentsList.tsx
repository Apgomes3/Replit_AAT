import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import { Component } from '../../types';
import { Plus, X, Copy, Pencil, Download, Boxes, Trash2 } from 'lucide-react';
import { exportCsv } from '../../lib/exportCsv';
import InlineStatusSelect from '../../components/ui/InlineStatusSelect';
import toast from 'react-hot-toast';

const COMPONENT_TYPES = ['Vessel', 'Pump', 'Blower', 'Motor', 'Valve', 'Instrument', 'Pipe', 'Fitting', 'Sensor', 'Controller', 'Frame', 'Filter', 'Heat Exchanger', 'Other'];
const CATEGORIES = ['Mechanical', 'Electrical', 'Instrumentation', 'Civil', 'Piping', 'Structural'];
const UNITS = ['EA', 'SET', 'm', 'kg', 'L', 'kW', 'mm', 'pcs'];
const STATUSES = ['Active', 'Draft', 'Obsolete'];

const TYPE_COLORS: Record<string, string> = {
  Vessel: 'bg-blue-50 text-blue-700',
  Pump: 'bg-green-50 text-green-700',
  Blower: 'bg-teal-50 text-teal-700',
  Motor: 'bg-purple-50 text-purple-700',
  Valve: 'bg-blue-50 text-blue-700',
  Instrument: 'bg-indigo-50 text-indigo-700',
  Pipe: 'bg-slate-50 text-slate-700',
  Fitting: 'bg-slate-50 text-slate-600',
  Sensor: 'bg-cyan-50 text-cyan-700',
  Controller: 'bg-violet-50 text-violet-700',
  Filter: 'bg-emerald-50 text-emerald-700',
};

export default function ComponentsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    component_code: '', component_name: '', component_type: 'Vessel', component_category: 'Mechanical',
    description: '', primary_material_code: '', standard_size: '', weight_kg: '', unit: 'EA', notes: '',
    manufacturer: '', model: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [dupSaving, setDupSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ['components', search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      return api.get(`/components?${p}&page_size=500`).then(r => r.data);
    },
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials-list'],
    queryFn: () => api.get('/materials').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const materials: { material_code: string; material_name: string }[] = useMemo(
    () => materialsData?.items ?? [], [materialsData]
  );

  const allComponents: Component[] = data?.items || [];

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allComponents) {
      const cat = (c as any).component_category || 'Other';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [allComponents]);

  const components: Component[] = useMemo(() => {
    if (!selectedCategory) return allComponents;
    return allComponents.filter((c: any) => c.component_category === selectedCategory);
  }, [allComponents, selectedCategory]);

  const openEdit = (row: any) => {
    setEditRow(row);
    setEditForm({
      component_name: row.component_name || '',
      component_type: row.component_type || 'Vessel',
      component_category: row.component_category || 'Mechanical',
      description: row.description || '',
      primary_material_code: row.primary_material_code || '',
      standard_size: row.standard_size || '',
      weight_kg: row.weight_kg != null ? String(row.weight_kg) : '',
      unit: row.unit || 'EA',
      status: row.status || 'Active',
      notes: row.notes || '',
      manufacturer: row.manufacturer || '',
      model: row.model || '',
    });
  };

  const handleEditSave = async () => {
    if (!editRow) return;
    setEditSaving(true);
    try {
      await api.put(`/components/${editRow.id}`, {
        ...editForm,
        weight_kg: editForm.weight_kg ? parseFloat(editForm.weight_kg) : null,
        synonyms: editRow.synonyms || [],
      });
      toast.success('Component updated');
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ['components'] });
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!form.component_code || !form.component_name) { toast.error('Code and name are required'); return; }
    setSubmitting(true);
    try {
      await api.post('/components', { ...form, weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null });
      toast.success('Component created');
      setShowModal(false);
      setForm({ component_code: '', component_name: '', component_type: 'Vessel', component_category: 'Mechanical', description: '', primary_material_code: '', standard_size: '', weight_kg: '', unit: 'EA', notes: '', manufacturer: '', model: '' });
      qc.invalidateQueries({ queryKey: ['components'] });
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || 'Failed to create component';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const fmtCurrency = (val: any) =>
    val != null ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-slate-300">—</span>;

  const columns: Column<Component>[] = [
    { key: 'component_code', header: 'Code', sortable: true, render: r => <Link to={`/products/components/${r.id}`}><EntityCode code={r.component_code} /></Link> },
    { key: 'component_name', header: 'Name', sortable: true, filterable: true, render: r => <Link to={`/products/components/${r.id}`} className="font-medium text-slate-800 hover:text-blue-600">{r.component_name}</Link> },
    { key: 'component_type', header: 'Type', sortable: true, filterable: true, filterValue: r => r.component_type ?? '', render: r => r.component_type
      ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[r.component_type] || 'bg-slate-100 text-slate-600'}`}>{r.component_type}</span>
      : null },
    { key: 'component_category', header: 'Category', sortable: true, filterable: true, render: r => r.component_category ? <span className="text-xs text-slate-500">{r.component_category}</span> : null },
    {
      key: 'primary_material_code',
      header: 'Material',
      sortable: true,
      filterable: true,
      filterValue: r => [r.primary_material_code, r.material_name].filter(Boolean).join(' '),
      render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span>,
    },
    { key: 'standard_size', header: 'Size', sortable: true },
    { key: 'unit', header: 'Unit', sortable: true },
    { key: 'cost', header: 'Cost', sortable: true, sortValue: r => (r as any).cost ?? 0, render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.cost)}</span> },
    { key: 'sell_price', header: 'Sell Price', sortable: true, sortValue: r => (r as any).sell_price ?? 0, render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.sell_price)}</span> },
    { key: 'status', header: 'Status', sortable: true, filterable: true, filterValue: r => r.status ?? '', render: r => (
      <InlineStatusSelect
        value={r.status ?? 'Active'}
        options={STATUSES}
        onSave={async (status) => {
          await api.patch(`/components/${r.id}/status`, { status });
          toast.success('Status updated');
          qc.invalidateQueries({ queryKey: ['components'] });
        }}
      />
    ) },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title={selectedCategory ? selectedCategory : 'Component Library'}
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Components' }]}
        subtitle={selectedCategory ? `${components.length} components` : `${allComponents.length} components · structural sub-assemblies and parts`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCsv(`components-${new Date().toISOString().slice(0, 10)}.csv`, [
                { header: 'Code',       value: r => r.component_code ?? '' },
                { header: 'Name',       value: r => r.component_name ?? '' },
                { header: 'Type',       value: r => r.component_type ?? '' },
                { header: 'Category',   value: r => r.component_category ?? '' },
                { header: 'Material',   value: r => r.primary_material_code ?? '' },
                { header: 'Size',       value: r => r.standard_size ?? '' },
                { header: 'Unit',       value: r => r.unit ?? '' },
                { header: 'Status',     value: r => r.status ?? '' },
                { header: 'Cost',       value: r => r.cost != null ? String(r.cost) : '' },
                { header: 'Sell Price', value: r => r.sell_price != null ? String(r.sell_price) : '' },
              ], components ?? [])}
              disabled={!components?.length}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <Button size="sm" onClick={() => setShowModal(true)}><Plus className="w-3.5 h-3.5" /> New Component</Button>
          </div>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Category sidebar */}
        <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 overflow-auto">
          <div className="px-3 py-2.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Categories</span>
          </div>
          <div className="py-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                selectedCategory === null
                  ? 'bg-blue-600/10 text-blue-600 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Boxes className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">All Components</span>
              <span className="ml-auto text-xs text-slate-400">{allComponents.length || ''}</span>
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  selectedCategory === cat
                    ? 'bg-blue-600/10 text-blue-600 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Boxes className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                <span className="truncate">{cat}</span>
                {categoryCounts[cat] != null && (
                  <span className="ml-auto text-xs text-slate-400">{categoryCounts[cat]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-200">
            <input
              type="text" placeholder="Search components..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex-1 overflow-auto">
            <DataTable
              columns={columns} data={components} tableId="components-list"
              emptyMessage="No components — create your first component or select a different category"
              onRowClick={r => navigate(`/products/components/${r.id}`)}
              contextMenuItems={row => [
                { label: 'Edit', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => openEdit(row) },
                {
                  label: dupSaving === row.id ? 'Duplicating…' : 'Duplicate', icon: <Copy className="w-3.5 h-3.5" />,
                  onClick: async () => {
                    if (dupSaving) return;
                    setDupSaving(row.id);
                    try {
                      const res = await api.post(`/components/${row.id}/duplicate`, {});
                      toast.success('Component duplicated');
                      qc.invalidateQueries({ queryKey: ['components'] });
                      navigate(`/products/components/${res.data.id}`);
                    } catch (e: any) { toast.error(e?.response?.data?.error?.message || 'Duplicate failed'); }
                    finally { setDupSaving(null); }
                  },
                },
                {
                  label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, divider: true, danger: true,
                  onClick: () => setConfirmDelete({ id: row.id, name: row.component_code }),
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
              <h3 className="text-base font-semibold text-slate-800">Delete component?</h3>
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
                  await api.delete(`/components/${id}`);
                  toast.success('Component deleted');
                  setConfirmDelete(null);
                  qc.invalidateQueries({ queryKey: ['components'] });
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

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <h2 className="font-semibold text-slate-800">New Component</h2>
              <button aria-label="Close new component form" title="Close new component form" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Component Code *</label>
                <input type="text" placeholder="e.g. COMP-VESSEL-001" value={form.component_code}
                  onChange={e => setForm(f => ({ ...f, component_code: e.target.value.toUpperCase() }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Component Name *</label>
                <input type="text" placeholder="e.g. FRP-VE Reaction Column" value={form.component_name}
                  onChange={e => setForm(f => ({ ...f, component_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Manufacturer</label>
                <input type="text" placeholder="e.g. Grundfos" value={form.manufacturer}
                  onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                <input type="text" placeholder="e.g. CR 5-10" value={form.model}
                  onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={form.component_type} onChange={e => setForm(f => ({ ...f, component_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <select value={form.component_category} onChange={e => setForm(f => ({ ...f, component_category: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea rows={2} placeholder="Brief description of the component" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material</label>
                <select value={form.primary_material_code}
                  onChange={e => setForm(f => ({ ...f, primary_material_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">— None —</option>
                  {materials.map(m => (
                    <option key={m.material_code} value={m.material_code}>{m.material_code} — {m.material_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Standard Size</label>
                <input type="text" placeholder="e.g. DN50, PN16, 1500L" value={form.standard_size}
                  onChange={e => setForm(f => ({ ...f, standard_size: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Weight (kg)</label>
                <input type="number" placeholder="0.0" value={form.weight_kg}
                  onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <input type="text" placeholder="Optional notes" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
              <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Component'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editRow && editForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <div>
                <h2 className="font-semibold text-slate-800">Edit Component</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{editRow.component_code}</p>
              </div>
              <button aria-label="Close edit component form" title="Close edit component form" onClick={() => setEditRow(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input value={editForm.component_name} onChange={e => setEditForm((f: any) => ({ ...f, component_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={editForm.component_type} onChange={e => setEditForm((f: any) => ({ ...f, component_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <select value={editForm.component_category} onChange={e => setEditForm((f: any) => ({ ...f, component_category: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editForm.status} onChange={e => setEditForm((f: any) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                <select value={editForm.unit} onChange={e => setEditForm((f: any) => ({ ...f, unit: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea rows={2} value={editForm.description} onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material</label>
                <select value={editForm.primary_material_code}
                  onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">— None —</option>
                  {materials.map(m => (
                    <option key={m.material_code} value={m.material_code}>{m.material_code} — {m.material_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Standard Size</label>
                <input value={editForm.standard_size} onChange={e => setEditForm((f: any) => ({ ...f, standard_size: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Weight (kg)</label>
                <input type="number" value={editForm.weight_kg} onChange={e => setEditForm((f: any) => ({ ...f, weight_kg: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
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
                <input value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
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
