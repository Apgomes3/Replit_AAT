import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import { Component } from '../../types';
import { Plus, X, Copy, Pencil } from 'lucide-react';
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
  Valve: 'bg-amber-50 text-amber-700',
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
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    component_code: '', component_name: '', component_type: 'Vessel', component_category: 'Mechanical',
    description: '', primary_material_code: '', standard_size: '', weight_kg: '', unit: 'EA', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ['components', search, typeFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (typeFilter) p.set('component_type', typeFilter);
      return api.get(`/components?${p}`).then(r => r.data);
    },
  });

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
      setForm({ component_code: '', component_name: '', component_type: 'Vessel', component_category: 'Mechanical', description: '', primary_material_code: '', standard_size: '', weight_kg: '', unit: 'EA', notes: '' });
      qc.invalidateQueries({ queryKey: ['components'] });
    } catch {
      toast.error('Failed to create component');
    } finally {
      setSubmitting(false);
    }
  };

  const components: Component[] = data?.items || [];

  const typeCounts = COMPONENT_TYPES.reduce((acc: Record<string, number>, t) => {
    acc[t] = components.filter(c => c.component_type === t).length;
    return acc;
  }, {});

  const fmtCurrency = (val: any) =>
    val != null ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-slate-300">—</span>;

  const columns: Column<Component>[] = [
    { key: 'component_code', header: 'Code', sortable: true, render: r => <Link to={`/products/components/${r.id}`}><EntityCode code={r.component_code} /></Link> },
    { key: 'component_name', header: 'Name', sortable: true, filterable: true, render: r => <Link to={`/products/components/${r.id}`} className="font-medium text-slate-800 hover:text-amber-600">{r.component_name}</Link> },
    { key: 'component_type', header: 'Type', sortable: true, filterable: true, filterValue: r => r.component_type ?? '', render: r => r.component_type
      ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[r.component_type] || 'bg-slate-100 text-slate-600'}`}>{r.component_type}</span>
      : null },
    { key: 'component_category', header: 'Category', sortable: true, filterable: true, render: r => r.component_category ? <span className="text-xs text-slate-500">{r.component_category}</span> : null },
    { key: 'primary_material_code', header: 'Material', sortable: true, render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_size', header: 'Size', sortable: true },
    { key: 'unit', header: 'Unit', sortable: true },
    { key: 'cost', header: 'Cost', sortable: true, sortValue: r => (r as any).cost ?? 0, render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.cost)}</span> },
    { key: 'sell_price', header: 'Sell Price', sortable: true, sortValue: r => (r as any).sell_price ?? 0, render: r => <span className="text-slate-600 text-sm">{fmtCurrency(r.sell_price)}</span> },
    { key: 'status', header: 'Status', sortable: true, filterable: true, filterValue: r => r.status ?? '', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Component Library"
        subtitle={`${components.length} components · structural sub-assemblies and parts`}
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Components' }]}
        actions={<Button size="sm" onClick={() => setShowModal(true)}><Plus className="w-3.5 h-3.5" /> New Component</Button>}
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center gap-6 mb-4">
          <input
            type="text" placeholder="Search components..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-amber-600 w-56"
          />
          <div className="flex items-center gap-4">
            <button onClick={() => setTypeFilter('')}
              className={`text-xs transition-colors ${!typeFilter ? 'text-amber-600 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
              All <span className="text-slate-400 font-normal">({components.length})</span>
            </button>
            {COMPONENT_TYPES.filter(t => typeCounts[t] > 0).map(t => (
              <button key={t} onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                className={`text-xs transition-colors ${typeFilter === t ? 'text-amber-600 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
                {t} <span className="text-slate-400 font-normal">({typeCounts[t]})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg">
          <DataTable
            columns={columns} data={components} tableId="components-list"
            emptyMessage="No components yet — create your first component above"
            onRowClick={r => navigate(`/products/components/${r.id}`)}
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
                    const res = await api.post(`/components/${row.id}/duplicate`, {});
                    toast.success('Component duplicated');
                    qc.invalidateQueries({ queryKey: ['components'] });
                    navigate(`/products/components/${res.data.id}`);
                  } catch { toast.error('Duplicate failed'); }
                },
              },
            ]}
          />
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <h2 className="font-semibold text-slate-800">New Component</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Component Code *</label>
                <input type="text" placeholder="e.g. COMP-VESSEL-001" value={form.component_code}
                  onChange={e => setForm(f => ({ ...f, component_code: e.target.value.toUpperCase() }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Component Name *</label>
                <input type="text" placeholder="e.g. FRP-VE Reaction Column" value={form.component_name}
                  onChange={e => setForm(f => ({ ...f, component_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={form.component_type} onChange={e => setForm(f => ({ ...f, component_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <select value={form.component_category} onChange={e => setForm(f => ({ ...f, component_category: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea rows={2} placeholder="Brief description of the component" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material Code</label>
                <input type="text" placeholder="e.g. FRP-VE" value={form.primary_material_code}
                  onChange={e => setForm(f => ({ ...f, primary_material_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Standard Size</label>
                <input type="text" placeholder="e.g. DN50, PN16, 1500L" value={form.standard_size}
                  onChange={e => setForm(f => ({ ...f, standard_size: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Weight (kg)</label>
                <input type="number" placeholder="0.0" value={form.weight_kg}
                  onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <input type="text" placeholder="Optional notes" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
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

      {editRow && editForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <div>
                <h2 className="font-semibold text-slate-800">Edit Component</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{editRow.component_code}</p>
              </div>
              <button onClick={() => setEditRow(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input value={editForm.component_name} onChange={e => setEditForm((f: any) => ({ ...f, component_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={editForm.component_type} onChange={e => setEditForm((f: any) => ({ ...f, component_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <select value={editForm.component_category} onChange={e => setEditForm((f: any) => ({ ...f, component_category: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editForm.status} onChange={e => setEditForm((f: any) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                <select value={editForm.unit} onChange={e => setEditForm((f: any) => ({ ...f, unit: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea rows={2} value={editForm.description} onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Material Code</label>
                <input value={editForm.primary_material_code} onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Standard Size</label>
                <input value={editForm.standard_size} onChange={e => setEditForm((f: any) => ({ ...f, standard_size: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Weight (kg)</label>
                <input type="number" value={editForm.weight_kg} onChange={e => setEditForm((f: any) => ({ ...f, weight_kg: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <input value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
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
