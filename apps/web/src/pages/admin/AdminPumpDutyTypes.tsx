import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';

type PumpDutyType = {
  id: string;
  tag: string;
  pump_name: string;
  sort_order: number;
  is_active: boolean;
};

const emptyForm = { tag: '', pump_name: '', sort_order: '0', is_active: true };
const inputClass = 'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40';

export default function AdminPumpDutyTypes() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-pump-duty-types'],
    queryFn: () => api.get('/admin/pump-duty-types').then(response => response.data),
  });
  const items: PumpDutyType[] = data?.items || [];

  const startEdit = (item: PumpDutyType) => {
    setCreating(false);
    setEditing(item.id);
    setForm({ tag: item.tag, pump_name: item.pump_name, sort_order: String(item.sort_order), is_active: item.is_active });
  };
  const cancel = () => { setCreating(false); setEditing(null); setForm(emptyForm); };
  const save = async () => {
    if (!form.tag.trim() || !form.pump_name.trim()) return toast.error('Tag and pump name are required');
    setSaving(true);
    try {
      const payload = {
        tag: form.tag.trim().toUpperCase(),
        pump_name: form.pump_name.trim(),
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      };
      if (editing) await api.put(`/admin/pump-duty-types/${editing}`, payload);
      else await api.post('/admin/pump-duty-types', payload);
      toast.success(editing ? 'Pump duty updated' : 'Pump duty created');
      cancel();
      await qc.invalidateQueries({ queryKey: ['admin-pump-duty-types'] });
      await qc.invalidateQueries({ queryKey: ['pump-selections'] });
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save pump duty');
    } finally { setSaving(false); }
  };
  const remove = async (item: PumpDutyType) => {
    if (!window.confirm(`Delete ${item.tag} — ${item.pump_name}?`)) return;
    try {
      await api.delete(`/admin/pump-duty-types/${item.id}`);
      toast.success('Pump duty deleted');
      await qc.invalidateQueries({ queryKey: ['admin-pump-duty-types'] });
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to delete pump duty');
    }
  };
  const editor = (
    <div className="grid gap-3 rounded-xl border border-blue-200 bg-white p-4 shadow-sm md:grid-cols-[140px_1fr_100px_120px_auto]">
      <label><span className="mb-1 block text-xs font-medium text-stone-500">Pump tag</span><input aria-label="Pump tag" value={form.tag} maxLength={10} onChange={e => setForm(f => ({ ...f, tag: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} className={inputClass} placeholder="CIRCP" /></label>
      <label><span className="mb-1 block text-xs font-medium text-stone-500">Pump name</span><input aria-label="Pump name" value={form.pump_name} onChange={e => setForm(f => ({ ...f, pump_name: e.target.value }))} className={inputClass} placeholder="Circulation Pump" /></label>
      <label><span className="mb-1 block text-xs font-medium text-stone-500">Order</span><input aria-label="Sort order" type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} className={inputClass} /></label>
      <label className="flex items-center gap-2 pt-6 text-sm text-stone-700"><input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />Active</label>
      <div className="flex items-end gap-1"><button aria-label="Save pump duty" onClick={() => void save()} disabled={saving} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"><Check className="h-4 w-4" /></button><button aria-label="Cancel pump duty" onClick={cancel} className="rounded-lg p-2 text-stone-400 hover:bg-stone-100"><X className="h-4 w-4" /></button></div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-stone-50/50">
      <PageHeader title="Pump Duty Types" subtitle="Manage the relationship between pump duty tags and names used by Design Book Pump Selection." />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => { setCreating(true); setEditing(null); setForm(emptyForm); }}><Plus className="mr-1 h-3.5 w-3.5" />New Pump Duty</Button></div>
          {creating && editor}
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            {isLoading ? <div className="p-8 text-center text-sm text-stone-400">Loading…</div> : (
              <table className="w-full text-sm">
                <thead className="border-b border-stone-100 bg-stone-50"><tr><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Tag</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Pump name</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Order</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-stone-500">Status</th><th className="w-24 px-4 py-3" /></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {items.map(item => editing === item.id ? <tr key={item.id}><td colSpan={5} className="p-3">{editor}</td></tr> : (
                    <tr key={item.id} className="group hover:bg-stone-50/60"><td className="px-4 py-3 font-mono font-bold text-blue-700">{item.tag}</td><td className="px-4 py-3 font-medium text-stone-800">{item.pump_name}</td><td className="px-4 py-3 text-stone-500">{item.sort_order}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button aria-label={`Edit ${item.tag}`} onClick={() => startEdit(item)} className="rounded p-1.5 text-stone-400 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button><button aria-label={`Delete ${item.tag}`} onClick={() => void remove(item)} className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></div></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-stone-500">Inactive duties remain available in saved Design Book evidence but are not used for new pump lines.</p>
        </div>
      </div>
    </div>
  );
}