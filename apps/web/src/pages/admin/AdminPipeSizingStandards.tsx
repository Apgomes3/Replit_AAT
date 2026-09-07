import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import toast from 'react-hot-toast';

const blank = { dn: '', internal_diameter_mm: '', pressure_velocity_min_m_s: '1.5', pressure_velocity_max_m_s: '3.0', gravity_velocity_min_m_s: '0.1', gravity_velocity_max_m_s: '1.5', is_active: true };
export default function AdminPipeSizingStandards() {
  const client = useQueryClient(); const [form, setForm] = useState<any>(blank); const [editingId, setEditingId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['pipe-sizing-standards'], queryFn: () => api.get('/admin/pipe-sizing-standards').then(r => r.data) });
  const save = async () => {
    try {
      const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, key === 'is_active' ? value : Number(value)]));
      if (editingId) await api.put(`/admin/pipe-sizing-standards/${editingId}`, payload);
      else await api.post('/admin/pipe-sizing-standards', payload);
      setForm(blank); setEditingId(null);
      client.invalidateQueries({ queryKey: ['pipe-sizing-standards'] }); toast.success('Pipe standard added');
    } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not save standard'); }
  };
  return <div className="mx-auto max-w-7xl space-y-6 p-6"><PageHeader title="Pipe Sizing Standards" subtitle="Authoritative nominal DN, internal diameter, and velocity bands for exhibit inlet and weir discharge sizing." />
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">Recommendations select the smallest active DN within its band. Existing exhibit selections remain explicit and are not replaced when these defaults change.</div>
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white"><table className="w-full text-sm"><thead className="bg-stone-50 text-left text-xs text-stone-500"><tr><th className="p-3">DN</th><th className="p-3">Internal diameter (mm)</th><th className="p-3">Pressure band (m/s)</th><th className="p-3">Gravity band (m/s)</th><th className="p-3">Active</th></tr></thead><tbody>
      {(data?.items || []).map((row: any) => <tr className="border-t border-stone-100" key={row.id}><td className="p-3 font-mono">{row.dn}</td><td className="p-3 font-mono">{row.internal_diameter_mm}</td><td className="p-3">{row.pressure_velocity_min_m_s}–{row.pressure_velocity_max_m_s}</td><td className="p-3">{row.gravity_velocity_min_m_s}–{row.gravity_velocity_max_m_s}</td><td className="p-3">{row.is_active ? 'Yes' : 'No'}</td><td className="p-3"><button className="text-xs text-blue-700" onClick={() => { setEditingId(row.id); setForm({ ...row }); }}>Edit</button></td></tr>)}
    </tbody></table>{isLoading && <p className="p-4 text-sm text-stone-500">Loading standards…</p>}</div>
    <div className="rounded-xl border border-stone-200 bg-white p-5"><h2 className="mb-3 font-semibold">{editingId ? 'Edit standard' : 'Add standard'}</h2><div className="grid gap-3 md:grid-cols-4">{Object.entries(form).filter(([key]) => !['is_active', 'id', 'created_at', 'updated_at'].includes(key)).map(([key, value]) => <label className="text-xs text-stone-500" key={key}>{key.replace(/_/g, ' ')}<input className="mt-1 w-full rounded border border-stone-200 px-2 py-1.5 text-sm" type="number" step="any" value={String(value)} onChange={e => setForm((old: any) => ({ ...old, [key]: e.target.value }))} /></label>)}</div><label className="mt-3 block text-sm"><input type="checkbox" checked={form.is_active} onChange={e => setForm((old: any) => ({ ...old, is_active: e.target.checked }))} /> Active for recommendations</label><button onClick={save} className="mt-4 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">{editingId ? 'Save changes' : 'Add pipe standard'}</button></div>
  </div>;
}