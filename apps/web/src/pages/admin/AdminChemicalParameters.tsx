import { useQuery, useQueryClient } from '@tanstack/react-query';
import { canManageAdminPage } from '../../lib/adminRegistry';
import { Navigate } from 'react-router-dom';
import { useState } from 'react';
import { Beaker, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import { useAuthStore } from '../../store/authStore';

type DensityForm = {
  water_type: string;
  density_kg_m3: string;
  conditions: string;
  unit: string;
  source: string;
  is_active: boolean;
};

const waterTypes = ['Freshwater', 'Brackish', 'Seawater'];
const emptyForm = (): DensityForm => ({
  water_type: 'Freshwater', density_kg_m3: '', conditions: '', unit: 'kg/m3', source: '', is_active: true,
});

export function canManageChemicalParameters(user: ReturnType<typeof useAuthStore.getState>['user']) {
  return canManageAdminPage(user, 'chemical-parameters');
}

export default function AdminChemicalParameters() {
  const user = useAuthStore(state => state.user);
  const queryClient = useQueryClient();
  const canManage = canManageChemicalParameters(user);
  const [form, setForm] = useState<DensityForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-water-density-parameters'],
    queryFn: () => api.get('/admin/chemical-parameters/water-density').then(response => response.data),
    enabled: canManage,
  });
  const items: any[] = data?.items || [];

  if (!canManage) return <Navigate to="/" replace />;

  const reset = () => { setForm(emptyForm()); setEditingId(null); };
  const save = async () => {
    const density = Number(form.density_kg_m3);
    if (!Number.isFinite(density) || density <= 0 || !form.conditions.trim() || !form.source.trim()) {
      toast.error('Enter a positive density, conditions, and a source.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, density_kg_m3: density };
      if (editingId) await api.put(`/admin/chemical-parameters/water-density/${editingId}`, payload);
      else await api.post('/admin/chemical-parameters/water-density', payload);
      toast.success(editingId ? 'Water density parameter updated' : 'Water density parameter created');
      reset();
      queryClient.invalidateQueries({ queryKey: ['admin-water-density-parameters'] });
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save water density parameter');
    } finally {
      setSaving(false);
    }
  };
  const edit = (item: any) => {
    setEditingId(item.id);
    setForm({
      water_type: item.water_type,
      density_kg_m3: String(item.density_kg_m3),
      conditions: item.conditions || '',
      unit: item.unit || 'kg/m3',
      source: item.source || '',
      is_active: item.is_active !== false,
    });
  };
  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/admin/chemical-parameters/water-density/${id}`);
      toast.success('Water density parameter deleted');
      if (editingId === id) reset();
      queryClient.invalidateQueries({ queryKey: ['admin-water-density-parameters'] });
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to delete water density parameter');
    } finally {
      setDeletingId(null);
    }
  };

  const inputClass = 'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:border-[#456b7d] focus:outline-none';
  const labelClass = 'mb-1 block text-xs font-medium text-stone-600';
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader title="Chemical Parameters" subtitle="Governed nominal water-density values for engineering calculations." />
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#456b7d]" />
        <p>Only admins and engineers with Design Books manage access can maintain these controlled values. Each change is captured in the audit log with its source and operating conditions.</p>
      </div>
      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
          <Beaker className="h-4 w-4 text-[#456b7d]" />
          <div><h2 className="font-semibold text-stone-900">{editingId ? 'Edit water density parameter' : 'Add water density parameter'}</h2><p className="text-xs text-stone-500">Density is stored exclusively in kg/m3.</p></div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          <label><span className={labelClass}>Water type</span><select value={form.water_type} onChange={e => setForm(v => ({ ...v, water_type: e.target.value }))} className={inputClass}>{waterTypes.map(type => <option key={type}>{type}</option>)}</select></label>
          <label><span className={labelClass}>Density (kg/m3)</span><input type="number" min="0" max="2000" step="0.001" value={form.density_kg_m3} onChange={e => setForm(v => ({ ...v, density_kg_m3: e.target.value }))} className={inputClass} /></label>
          <label><span className={labelClass}>Unit</span><input value={form.unit} readOnly className={`${inputClass} bg-stone-50 text-stone-500`} /></label>
          <label className="flex items-end pb-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm(v => ({ ...v, is_active: e.target.checked }))} className="mr-2 h-4 w-4" /> <span className="text-sm text-stone-700">Active for selection</span></label>
          <label className="md:col-span-2"><span className={labelClass}>Conditions</span><input value={form.conditions} onChange={e => setForm(v => ({ ...v, conditions: e.target.value }))} placeholder="e.g. 20 °C; practical salinity 35 PSU" className={inputClass} /></label>
          <label className="md:col-span-2"><span className={labelClass}>Source / reference</span><input value={form.source} onChange={e => setForm(v => ({ ...v, source: e.target.value }))} className={inputClass} /></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-100 px-4 py-3">
          {editingId && <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"><X className="h-4 w-4" /> Cancel</button>}
          <Button type="button" onClick={save} variant="thermal" disabled={saving} className="inline-flex items-center gap-1"><Plus className="h-4 w-4" />{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add parameter'}</Button>
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-3"><h2 className="font-semibold text-stone-900">Water density library</h2></div>
        {isError ? <div className="p-6 text-sm text-red-700">Unable to load water density parameters.</div> : isLoading ? <div className="p-8 text-center text-sm text-stone-500">Loading chemical parameters…</div> : (
          <div className="overflow-x-auto"><table className="min-w-[950px] w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-3">Water type</th><th className="px-4 py-3">Density</th><th className="px-4 py-3">Conditions</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-stone-100">{items.map(item => <tr key={item.id} className="align-top"><td className="px-4 py-3 font-semibold text-stone-800">{item.water_type}</td><td className="px-4 py-3 font-mono text-stone-700">{item.density_kg_m3} <span className="font-sans text-xs text-stone-500">{item.unit}</span></td><td className="max-w-xs px-4 py-3 text-stone-600">{item.conditions}</td><td className="max-w-sm px-4 py-3 text-stone-600">{item.source}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td><td className="whitespace-nowrap px-4 py-3 text-right"><button type="button" onClick={() => edit(item)} className="mr-2 rounded-lg p-2 text-[#456b7d] hover:bg-stone-100" aria-label={`Edit ${item.water_type}`}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => { if (window.confirm(`Delete the ${item.water_type} parameter?`)) remove(item.id); }} disabled={deletingId === item.id} className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label={`Delete ${item.water_type}`}><Trash2 className="h-4 w-4" /></button></td></tr>)}{!items.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">No water density parameters are available.</td></tr>}</tbody></table></div>
        )}
      </section>
    </div>
  );
}