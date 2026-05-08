import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, DollarSign, Info } from 'lucide-react';

interface CostRate {
  id: string;
  material_code: string | null;
  label: string;
  cost_per_sqm_usd: number;
  currency: string;
  notes: string | null;
  updated_at: string;
}

const KNOWN_MATERIALS = [
  { code: 'MAT-FRP-VE', label: 'FRP (Vinyl Ester)' },
  { code: 'MAT-FRP', label: 'FRP (General)' },
  { code: 'MAT-GRP', label: 'GRP' },
  { code: 'MAT-SS316', label: 'Stainless Steel 316' },
  { code: 'MAT-SS304', label: 'Stainless Steel 304' },
  { code: 'MAT-HDPE', label: 'HDPE' },
  { code: 'MAT-PP', label: 'Polypropylene (PP)' },
  { code: 'MAT-PVC', label: 'PVC' },
  { code: 'MAT-CPVC', label: 'CPVC' },
  { code: 'MAT-ACRY', label: 'Acrylic' },
  { code: 'MAT-GLASS', label: 'Glass' },
  { code: 'MAT-CS', label: 'Carbon Steel' },
  { code: 'MAT-ALU', label: 'Aluminium' },
  { code: 'MAT-CONC', label: 'Concrete' },
];

const CURRENCIES = ['USD', 'EUR', 'TWD', 'GBP', 'JPY', 'SGD', 'AUD'];

const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 w-full';

const emptyForm = { material_code: '', label: '', cost_per_sqm_usd: '', currency: 'USD', notes: '' };

export default function AdminTankCostRates() {
  const qc = useQueryClient();

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<CostRate | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSaving, setEditSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CostRate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tank-cost-rates'],
    queryFn: () => api.get('/admin/tank-cost-rates').then(r => r.data),
  });

  const rates: CostRate[] = data?.items || [];

  const openEdit = (r: CostRate) => {
    setEditTarget(r);
    setEditForm({
      material_code: r.material_code || '',
      label: r.label,
      cost_per_sqm_usd: String(r.cost_per_sqm_usd),
      currency: r.currency || 'USD',
      notes: r.notes || '',
    });
  };

  const handleCreate = async () => {
    if (!newForm.label.trim()) { toast.error('Label is required'); return; }
    setSaving(true);
    try {
      await api.post('/admin/tank-cost-rates', {
        material_code: newForm.material_code.trim() || null,
        label: newForm.label.trim(),
        cost_per_sqm_usd: parseFloat(newForm.cost_per_sqm_usd) || 0,
        currency: newForm.currency,
        notes: newForm.notes.trim() || null,
      });
      toast.success('Cost rate added');
      setShowNew(false);
      setNewForm(emptyForm);
      qc.invalidateQueries({ queryKey: ['tank-cost-rates'] });
    } catch {
      toast.error('Failed to create rate');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editForm.label.trim() || !editTarget) return;
    setEditSaving(true);
    try {
      await api.put(`/admin/tank-cost-rates/${editTarget.id}`, {
        material_code: editForm.material_code.trim() || null,
        label: editForm.label.trim(),
        cost_per_sqm_usd: parseFloat(editForm.cost_per_sqm_usd) || 0,
        currency: editForm.currency,
        notes: editForm.notes.trim() || null,
      });
      toast.success('Rate updated');
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ['tank-cost-rates'] });
    } catch {
      toast.error('Failed to update rate');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/tank-cost-rates/${deleteTarget.id}`);
      toast.success('Rate deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['tank-cost-rates'] });
    } catch {
      toast.error('Failed to delete rate');
    } finally {
      setDeleting(false);
    }
  };

  const RateForm = ({ form, onChange }: { form: typeof emptyForm; onChange: (f: typeof emptyForm) => void }) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Label <span className="text-red-400">*</span></label>
          <input className={inputCls} value={form.label} onChange={e => onChange({ ...form, label: e.target.value })} placeholder="e.g. FRP (Vinyl Ester)" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Material Code</label>
          <select className={inputCls} value={form.material_code} onChange={e => onChange({ ...form, material_code: e.target.value })}>
            <option value="">— All / Default —</option>
            {KNOWN_MATERIALS.map(m => <option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Cost per m²</label>
          <input type="number" className={inputCls} value={form.cost_per_sqm_usd} onChange={e => onChange({ ...form, cost_per_sqm_usd: e.target.value })} placeholder="e.g. 350" min="0" step="0.01" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Currency</label>
          <select className={inputCls} value={form.currency} onChange={e => onChange({ ...form, currency: e.target.value })}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Notes</label>
        <input className={inputCls} value={form.notes} onChange={e => onChange({ ...form, notes: e.target.value })} placeholder="Optional description or conditions" />
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Tank Cost Rates"
        subtitle="Define material cost rates (per m² of shell surface area) used to estimate tank fabrication costs."
        actions={<Button onClick={() => setShowNew(true)} icon={Plus}>Add Rate</Button>}
      />

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex gap-3 text-sm text-blue-700">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
        <span>
          These rates are applied to the <strong>shell surface area</strong> of each tank (calculated from its shape and dimensions) to produce an estimated material cost.
          The matching rate is selected by <strong>material code</strong>; a rate with no material code acts as a catch-all default.
        </span>
      </div>

      {showNew && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">New Cost Rate</h3>
            <button onClick={() => { setShowNew(false); setNewForm(emptyForm); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <RateForm form={newForm} onChange={setNewForm} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setShowNew(false); setNewForm(emptyForm); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Saving…' : 'Create Rate'}</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-slate-400 text-sm p-4">Loading…</div>
      ) : rates.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
          No cost rates defined yet. Add one to enable cost estimates on tank products.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Label</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Material Code</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rate</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rates.map(rate => (
                editTarget?.id === rate.id ? (
                  <tr key={rate.id} className="bg-blue-50/40">
                    <td colSpan={5} className="px-4 py-3 space-y-3">
                      <RateForm form={editForm} onChange={setEditForm} />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditTarget(null)} className="text-xs text-slate-400 hover:underline">Cancel</button>
                        <button onClick={handleEdit} disabled={editSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{editSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={rate.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{rate.label}</td>
                    <td className="px-4 py-3">
                      {rate.material_code
                        ? <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">{rate.material_code}</span>
                        : <span className="text-slate-300 text-xs italic">default (all)</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono font-semibold text-green-700">{Number(rate.cost_per_sqm_usd).toLocaleString()}</span>
                      <span className="text-slate-400 ml-1 text-xs">{rate.currency}/m²</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{rate.notes || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(rate)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDeleteTarget(rate)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm space-y-4 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0"><Trash2 className="w-4 h-4 text-red-500" /></div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Delete rate?</p>
                <p className="text-xs text-slate-500 mt-0.5">"{deleteTarget.label}" will be removed. Cost estimates on tank products using this material code will no longer be available.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
