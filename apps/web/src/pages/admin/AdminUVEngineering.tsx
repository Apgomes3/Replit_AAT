import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CopyPlus, RefreshCw, ShieldCheck, Sun, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';

const inputClass = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-500';

const emptyForm = {
  lamp_count: '',
  lamp_power_w: '',
  effective_reactor_volume_m3: '',
  irradiance_85_mw_cm2: '',
  irradiance_95_mw_cm2: '',
  compatibility: '',
  arrangement: '',
  source_evidence: '',
  per_lamp_flow_m3h: '',
  per_lamp_flow_exception_approved: false,
  per_lamp_flow_exception_reason: '',
  notes: '',
};

function numeric(value: string) {
  return value === '' ? null : Number(value);
}

function statusClass(status: string) {
  if (status === 'Approved') return 'bg-emerald-100 text-emerald-700';
  if (status === 'In Review') return 'bg-blue-100 text-blue-700';
  if (status === 'Retired' || status === 'Disabled') return 'bg-stone-100 text-stone-500';
  return 'bg-amber-100 text-amber-700';
}

function EngineeringForm({ product, revision, onClose, onSaved }: any) {
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const revising = revision?.status === 'Approved' || revision?.status === 'Retired' || revision?.status === 'Disabled';

  useEffect(() => {
    setForm({
      ...emptyForm,
      ...(revision || {}),
      lamp_count: revision?.lamp_count ?? '',
      lamp_power_w: revision?.lamp_power_w ?? '',
      effective_reactor_volume_m3: revision?.effective_reactor_volume_m3 ?? '',
      irradiance_85_mw_cm2: revision?.irradiance_85_mw_cm2 ?? '',
      irradiance_95_mw_cm2: revision?.irradiance_95_mw_cm2 ?? '',
      per_lamp_flow_m3h: revision?.per_lamp_flow_m3h ?? '',
      per_lamp_flow_exception_approved: Boolean(revision?.per_lamp_flow_exception_approved),
    });
  }, [revision?.id]);

  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        lamp_count: numeric(form.lamp_count),
        lamp_power_w: numeric(form.lamp_power_w),
        effective_reactor_volume_m3: numeric(form.effective_reactor_volume_m3),
        irradiance_85_mw_cm2: numeric(form.irradiance_85_mw_cm2),
        irradiance_95_mw_cm2: numeric(form.irradiance_95_mw_cm2),
        per_lamp_flow_m3h: numeric(form.per_lamp_flow_m3h),
      };
      if (!revision?.id || revising) {
        await api.post(`/admin/uv-engineering/${product.id}/revisions`, payload);
        toast.success(revising ? 'New draft revision created' : 'Draft engineering revision created');
      } else {
        await api.put(`/admin/uv-engineering/revisions/${revision.id}`, payload);
        toast.success('Draft engineering revision saved');
      }
      onSaved();
      onClose();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'UV engineering revision could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-800">{revising ? 'Create revision from' : revision?.id ? 'Edit' : 'Complete'} {product.product_code}</h2>
          <p className="mt-0.5 text-xs text-stone-400">PIM identity is read-only. Engineering-only values are revision controlled.</p>
        </div>
        <button type="button" aria-label="Close UV engineering form" onClick={onClose} className="text-stone-400 hover:text-stone-700"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-4 border-b border-stone-100 bg-stone-50/60 p-5 md:grid-cols-4">
        {[
          ['Code', product.product_code],
          ['Product', product.product_name],
          ['Manufacturer', product.manufacturer || 'Not set'],
          ['Family', product.product_family_code || 'Not linked'],
          ['Category', product.product_category || 'Not set'],
          ['Material', product.primary_material_code || 'Not set'],
          ['Configuration', product.configuration || product.application_type || 'Not set'],
          ['Control type', product.control_type || 'Not set'],
          ['Rated power', product.power_kw != null ? `${product.power_kw} kW` : 'Not set'],
          ['PIM status', product.standard_status || product.status || 'Not set'],
        ].map(([label, value]) => (
          <div key={label}><div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</div><div className="mt-1 text-sm font-medium text-stone-700">{value}</div></div>
        ))}
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-3">
        {[
          ['lamp_count', 'Lamp count *', '1'],
          ['lamp_power_w', 'Lamp power per lamp (W) *', '0.1'],
          ['effective_reactor_volume_m3', 'Effective reactor volume (m³) *', '0.001'],
          ['irradiance_85_mw_cm2', 'Irradiance at 85%T (mW/cm²) *', '0.001'],
          ['irradiance_95_mw_cm2', 'Irradiance at 95%T (mW/cm²) *', '0.001'],
          ['per_lamp_flow_m3h', 'Approved flow per lamp (m³/h)', '0.001'],
        ].map(([key, label, step]) => (
          <label key={key} className="text-xs font-medium text-stone-500">{label}
            <input type="number" min="0" step={step} className={inputClass} value={form[key]} onChange={event => set(key, event.target.value)} />
          </label>
        ))}
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Compatibility *
          <textarea rows={2} className={inputClass} value={form.compatibility} onChange={event => set('compatibility', event.target.value)} placeholder="Water types, materials, temperature or salinity limits" />
        </label>
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Lamp / reactor arrangement *
          <textarea rows={2} className={inputClass} value={form.arrangement} onChange={event => set('arrangement', event.target.value)} placeholder="Describe lamp placement, banks and reactor arrangement" />
        </label>
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Controlled source evidence *
          <input className={inputClass} value={form.source_evidence} onChange={event => set('source_evidence', event.target.value)} placeholder="Manufacturer datasheet, test report or controlled engineering document" />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-stone-600 md:col-span-3">
          <input type="checkbox" checked={form.per_lamp_flow_exception_approved} onChange={event => set('per_lamp_flow_exception_approved', event.target.checked)} />
          Approved per-lamp flow exception
        </label>
        {(form.per_lamp_flow_m3h !== '' || form.per_lamp_flow_exception_approved) && (
          <label className="text-xs font-medium text-stone-500 md:col-span-3">Flow exception basis
            <textarea rows={2} className={inputClass} value={form.per_lamp_flow_exception_reason} onChange={event => set('per_lamp_flow_exception_reason', event.target.value)} />
          </label>
        )}
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Revision notes
          <textarea rows={2} className={inputClass} value={form.notes} onChange={event => set('notes', event.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50/50 px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving}><Check className="h-3.5 w-3.5" />{saving ? 'Saving…' : revising ? 'Create draft revision' : 'Save draft'}</Button>
      </div>
    </section>
  );
}

export default function AdminUVEngineering() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<any | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const { data = { items: [] }, isLoading } = useQuery({
    queryKey: ['uv-engineering', 'admin'],
    queryFn: () => api.get('/admin/uv-engineering', { params: { include_history: true } }).then(response => response.data),
  });
  const products = data.items || [];
  const selected = useMemo(() => products.find((product: any) => product.id === selectedId) || null, [products, selectedId]);
  const currentRevision = selected?.current_revision || selected?.latest_revision || selected?.revisions?.[0] || null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['uv-engineering'] });

  const reconcile = async () => {
    setReconciling(true);
    try {
      const response = await api.post('/admin/uv-engineering/reconcile');
      toast.success(`${response.data?.created ?? 0} UV record(s) created; ${response.data?.refreshed ?? 0} refreshed`);
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'UV catalog reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  const changeStatus = async (revision: any, status: string) => {
    try {
      await api.patch(`/admin/uv-engineering/revisions/${revision.id}/status`, { status });
      toast.success(`UV revision marked ${status}`);
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Revision status could not be changed');
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader title="UV Engineering Products" subtitle="Controlled, versioned UV performance records linked one-to-one with PIM products in PFM-UV."
        actions={<Button variant="primary" onClick={reconcile} disabled={reconciling}><RefreshCw className={`h-3.5 w-3.5 ${reconciling ? 'animate-spin' : ''}`} />{reconciling ? 'Reconciling…' : 'Reconcile PIM UV products'}</Button>} />
      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <p>PIM controls identity and active status. Only complete, approved engineering revisions linked to an active PFM-UV product are available to calculations. Approved revisions cannot be edited.</p>
      </div>

      {editingRevision && selected && <EngineeringForm product={selected} revision={editingRevision === true ? currentRevision : editingRevision}
        onClose={() => setEditingRevision(null)} onSaved={refresh} />}

      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-400">
              <tr><th className="px-4 py-2">PIM product</th><th className="px-4 py-2">Identity</th><th className="px-4 py-2">Engineering</th><th className="px-4 py-2">Sync</th><th className="px-4 py-2">Readiness</th><th className="px-4 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading && <tr><td colSpan={6} className="p-8 text-center text-stone-400">Loading UV engineering records…</td></tr>}
              {!isLoading && products.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-stone-400">No UV products have been reconciled.</td></tr>}
              {products.map((product: any) => {
                const revision = product.current_revision || product.latest_revision || product.revisions?.[0];
                return (
                  <tr key={product.id} className={selectedId === product.id ? 'bg-blue-50/40' : ''}>
                    <td className="px-4 py-3"><button className="text-left" onClick={() => setSelectedId(product.id)}>
                      <div className="font-medium text-stone-800">{product.product_name}</div><div className="font-mono text-xs text-stone-400">{product.product_code}</div>
                    </button></td>
                    <td className="px-4 py-3 text-xs text-stone-500"><div>{product.manufacturer || 'Manufacturer not set'}</div><div>{product.primary_material_code || 'Material not set'} · {product.power_kw != null ? `${product.power_kw} kW` : 'Power not set'}</div></td>
                    <td className="px-4 py-3">{revision ? <><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(revision.status)}`}>{revision.status}</span><div className="mt-1 font-mono text-xs text-stone-400">r{revision.revision}</div></> : <span className="text-xs text-amber-700">No revision</span>}</td>
                    <td className="px-4 py-3 text-xs"><span className={product.needs_review || product.sync_status === 'Needs Review' ? 'font-semibold text-amber-700' : 'text-emerald-700'}>{product.sync_status || (product.needs_review ? 'Needs Review' : 'Current')}</span></td>
                    <td className="px-4 py-3 text-xs">{product.calculation_enabled || product.selectable ? <span className="font-semibold text-emerald-700">Calculation enabled</span> : <span className="font-semibold text-amber-700">{product.completeness_message || 'Incomplete or unavailable'}</span>}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      {(!revision || ['Draft', 'In Review'].includes(revision.status)) && <button onClick={() => { setSelectedId(product.id); setEditingRevision(revision || {}); }} className="text-xs font-semibold text-blue-600 hover:underline">{revision ? 'Edit' : 'Complete'}</button>}
                      {revision?.status === 'Draft' && <button onClick={() => changeStatus(revision, 'In Review')} className="text-xs font-semibold text-blue-600 hover:underline">Review</button>}
                      {['Draft', 'In Review'].includes(revision?.status) && <button onClick={() => changeStatus(revision, 'Approved')} className="text-xs font-semibold text-emerald-700 hover:underline">Approve</button>}
                      {revision?.status === 'Approved' && <>
                        <button onClick={() => { setSelectedId(product.id); setEditingRevision(revision); }} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"><CopyPlus className="h-3 w-3" />Revise</button>
                        <button onClick={() => changeStatus(revision, 'Retired')} className="text-xs font-semibold text-stone-500 hover:underline">Retire</button>
                      </>}
                      {revision && !['Disabled', 'Retired'].includes(revision.status) && <button onClick={() => changeStatus(revision, 'Disabled')} className="text-xs font-semibold text-red-600 hover:underline">Disable</button>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="sr-only"><Sun />UV engineering administration</div>
    </div>
  );
}