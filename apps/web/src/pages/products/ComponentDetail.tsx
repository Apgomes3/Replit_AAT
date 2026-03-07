import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Pencil, X, Check } from 'lucide-react';

const COMPONENT_TYPES = ['Vessel', 'Pump', 'Blower', 'Motor', 'Valve', 'Instrument', 'Pipe', 'Fitting', 'Sensor', 'Controller', 'Frame', 'Filter', 'Heat Exchanger', 'Other'];
const CATEGORIES = ['Mechanical', 'Electrical', 'Instrumentation', 'Civil', 'Piping', 'Structural'];
const UNITS = ['EA', 'SET', 'm', 'kg', 'L', 'kW', 'mm', 'pcs'];
const STATUSES = ['Active', 'Draft', 'Obsolete'];

const TYPE_COLORS: Record<string, string> = {
  Vessel: 'bg-blue-50 text-blue-700 border-blue-100',
  Pump: 'bg-green-50 text-green-700 border-green-100',
  Blower: 'bg-teal-50 text-teal-700 border-teal-100',
  Motor: 'bg-purple-50 text-purple-700 border-purple-100',
  Valve: 'bg-amber-50 text-amber-700 border-amber-100',
  Instrument: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  Pipe: 'bg-slate-50 text-slate-700 border-slate-200',
  Filter: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

export default function ComponentDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const { data: component, isLoading } = useQuery({
    queryKey: ['component', id],
    queryFn: () => api.get(`/components/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!component) return <div className="p-8 text-slate-400">Component not found</div>;

  const startEdit = () => {
    setForm({
      component_name: component.component_name,
      component_type: component.component_type || 'Vessel',
      component_category: component.component_category || 'Mechanical',
      description: component.description || '',
      primary_material_code: component.primary_material_code || '',
      standard_size: component.standard_size || '',
      weight_kg: component.weight_kg?.toString() || '',
      unit: component.unit || 'EA',
      status: component.status,
      notes: component.notes || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/components/${component.id}`, { ...form, weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null });
      toast.success('Component updated');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['component', id] });
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const usedIn = component.used_in || [];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={component.component_code}
        title={editing ? form.component_name : component.component_name}
        status={editing ? form.status : component.status}
        subtitle={component.component_type ? (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TYPE_COLORS[component.component_type] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {component.component_type}
          </span>
        ) : undefined}
        breadcrumb={<><Link to="/products" className="hover:underline">Families</Link> / <Link to="/products/components" className="hover:underline">Components</Link></>}
        actions={
          editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="w-3.5 h-3.5" /> Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}><Check className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save'}</Button>
            </div>
          ) : (
            <Button size="sm" onClick={startEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
          )
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            {!editing ? (
              <MetadataPanel title="Component Specifications" fields={[
                { label: 'Type', value: component.component_type },
                { label: 'Category', value: component.component_category },
                { label: 'Description', value: component.description },
                { label: 'Primary Material', value: component.primary_material_code
                  ? <><EntityCode code={component.primary_material_code} />{component.material_name && <span className="text-slate-500 text-xs ml-1">{component.material_name}</span>}</>
                  : null },
                { label: 'Standard Size', value: component.standard_size },
                { label: 'Weight', value: component.weight_kg ? `${component.weight_kg} kg` : null },
                { label: 'Unit', value: component.unit },
                { label: 'Notes', value: component.notes },
              ]} />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Edit Specifications</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                    <input value={form.component_name} onChange={e => setForm((f: any) => ({ ...f, component_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                    <select value={form.component_type} onChange={e => setForm((f: any) => ({ ...f, component_type: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                      {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                    <select value={form.component_category} onChange={e => setForm((f: any) => ({ ...f, component_category: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                    <textarea rows={2} value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Material Code</label>
                    <input value={form.primary_material_code} onChange={e => setForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Standard Size</label>
                    <input value={form.standard_size} onChange={e => setForm((f: any) => ({ ...f, standard_size: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Weight (kg)</label>
                    <input type="number" value={form.weight_kg} onChange={e => setForm((f: any) => ({ ...f, weight_kg: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                    <select value={form.unit} onChange={e => setForm((f: any) => ({ ...f, unit: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                    <select value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                    <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Used in Products</div>
              {usedIn.length === 0
                ? <div className="text-sm text-slate-400">Not referenced in any product BOM</div>
                : usedIn.map((p: any) => (
                  <div key={p.product_code} className="flex items-center gap-2 mb-2">
                    <Link to={`/products/masters/${p.product_code}`}><EntityCode code={p.product_code} /></Link>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-600 truncate">{p.product_name}</div>
                      <div className="text-xs text-slate-400">Qty: {p.quantity} {p.unit}</div>
                    </div>
                    <StatusBadge status={p.standard_status} />
                  </div>
                ))
              }
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Details</div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Code</span>
                  <EntityCode code={component.component_code} />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <StatusBadge status={component.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Created</span>
                  <span className="text-xs text-slate-600">{new Date(component.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
