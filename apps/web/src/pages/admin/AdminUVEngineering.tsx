import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CopyPlus, LayoutGrid, List, RefreshCw, ShieldCheck, Sun, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';

const inputClass = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-500';
const WATER_COMPATIBILITY_TYPES = ['Saltwater', 'Seawater', 'Freshwater', 'Brackish water'];

const emptyForm = {
  effective_reactor_volume_l: '',
  irradiance_85t_mw_cm2: '',
  irradiance_95t_mw_cm2: '',
  source_evidence: '',
  source_basis: 'AAT Foundations',
  approved_per_lamp_flow_exception_m3h: '',
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
  const [compatibilityModes, setCompatibilityModes] = useState<Record<string, 'default' | 'allowed' | 'not_allowed'>>({});
  const [saving, setSaving] = useState(false);
  const revising = revision?.status === 'Approved' || revision?.status === 'Retired' || revision?.status === 'Disabled';

  useEffect(() => {
    setForm({
      ...emptyForm,
      ...(revision || {}),
      effective_reactor_volume_l: revision?.effective_reactor_volume_l ?? '',
      irradiance_85t_mw_cm2: revision?.irradiance_85t_mw_cm2 ?? '',
      irradiance_95t_mw_cm2: revision?.irradiance_95t_mw_cm2 ?? '',
      approved_per_lamp_flow_exception_m3h: revision?.approved_per_lamp_flow_exception_m3h ?? '',
    });
    setCompatibilityModes(Object.fromEntries(WATER_COMPATIBILITY_TYPES.map(waterType => {
      const option = (product.compatibility_options || []).find((item: any) => item.water_type === waterType);
      return [waterType, option?.is_override ? (option.allowed ? 'allowed' : 'not_allowed') : 'default'];
    })));
  }, [revision?.id, product.id]);

  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...(revising ? { source_revision_id: revision.id } : {}),
        effective_reactor_volume_l: numeric(form.effective_reactor_volume_l),
        irradiance_85t_mw_cm2: numeric(form.irradiance_85t_mw_cm2),
        irradiance_95t_mw_cm2: numeric(form.irradiance_95t_mw_cm2),
        compatibility: form.compatibility ?? null,
        arrangement: form.arrangement ?? null,
        source_evidence: form.source_evidence,
        source_basis: form.source_basis,
        approved_per_lamp_flow_exception_m3h: numeric(form.approved_per_lamp_flow_exception_m3h),
        notes: form.notes,
        compatibility_overrides: WATER_COMPATIBILITY_TYPES.flatMap(waterType => {
          const mode = compatibilityModes[waterType] || 'default';
          return mode === 'default' ? [] : [{ water_type: waterType, allowed: mode === 'allowed' }];
        }),
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
          ['Signal type', product.signal_type || 'Not set'],
          ['Optional', product.control_type_optional ? 'Yes' : 'No'],
          ['Rated power', product.rated_power_kw != null ? `${product.rated_power_kw} kW` : 'Not set'],
          ['Lamp count', product.pim_lamp_count ?? product.lamp_count ?? 'Not set'],
          ['PIM status', product.pim_status || 'Not set'],
        ].map(([label, value]) => (
          <div key={label}><div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</div><div className="mt-1 text-sm font-medium text-stone-700">{value}</div></div>
        ))}
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-3">
        {[
          ['effective_reactor_volume_l', 'Effective reactor volume (L) *', '0.001'],
          ['irradiance_85t_mw_cm2', 'Irradiance at 85%T (mW/cm²) *', '0.001'],
          ['irradiance_95t_mw_cm2', 'Irradiance at 95%T (mW/cm²) *', '0.001'],
          ['approved_per_lamp_flow_exception_m3h', 'Approved flow per lamp exception (m³/h)', '0.001'],
        ].map(([key, label, step]) => (
          <label key={key} className="text-xs font-medium text-stone-500">{label}
            <input type="number" min="0" step={step} className={inputClass} value={form[key]} onChange={event => set(key, event.target.value)} />
          </label>
        ))}
        <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 md:col-span-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-800">Water compatibility</h3>
            <p className="mt-1 text-xs text-stone-500">
              Defaults come from material <strong>{product.primary_material_code || 'not set'}</strong> in the governed material library.
              An override is saved with this UV engineering revision.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {WATER_COMPATIBILITY_TYPES.map(waterType => {
              const option = (product.compatibility_options || []).find((item: any) => item.water_type === waterType) || {};
              const mode = compatibilityModes[waterType] || 'default';
              const effectiveAllowed = mode === 'default' ? option.default_allowed === true : mode === 'allowed';
              const defaultLabel = option.default_allowed == null ? 'Not defined' : option.default_allowed ? 'Allowed' : 'Not allowed';
              return (
                <div key={waterType} className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-stone-700">{waterType}</div>
                      <div className="mt-0.5 text-[11px] text-stone-400">Material default: {defaultLabel}</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${effectiveAllowed ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                      {effectiveAllowed ? 'Allowed' : 'Not allowed'}
                    </span>
                  </div>
                  <label className="mt-2 block text-[11px] font-medium text-stone-500">Revision setting
                    <select
                      aria-label={`${waterType} compatibility`}
                      className={inputClass}
                      value={mode}
                      onChange={event => setCompatibilityModes(current => ({
                        ...current,
                        [waterType]: event.target.value as 'default' | 'allowed' | 'not_allowed',
                      }))}
                    >
                      <option value="default">Use material default</option>
                      <option value="allowed">Override: Allowed</option>
                      <option value="not_allowed">Override: Not allowed</option>
                    </select>
                  </label>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-stone-400">Governed source: <strong>AAT Foundations</strong>.</p>
        </div>
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Controlled source evidence *
          <input className={inputClass} value={form.source_evidence} onChange={event => set('source_evidence', event.target.value)} placeholder="Manufacturer datasheet, test report or controlled engineering document" />
        </label>
        <p className="text-xs text-stone-400 md:col-span-3">Leave the per-lamp flow exception blank unless it has an approved engineering basis.</p>
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
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<any | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reviewingRevision, setReviewingRevision] = useState<any | null>(null);
  const [reviewerId, setReviewerId] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const { data = { items: [] }, isLoading } = useQuery({
    queryKey: ['uv-engineering', 'admin'],
    queryFn: () => api.get('/admin/uv-engineering', { params: { include_history: true } }).then(response => response.data),
  });
  const revisionId = searchParams.get('revision');
  const linkedRevisionQuery = useQuery({
    queryKey: ['uv-engineering', 'revision', revisionId],
    queryFn: () => api.get(`/admin/uv-engineering/revisions/${encodeURIComponent(revisionId!)}`).then(response => response.data),
    enabled: Boolean(revisionId),
    retry: false,
  });
  const reviewersQuery = useQuery({
    queryKey: ['uv-engineering', 'reviewers'],
    queryFn: () => api.get('/admin/uv-engineering/reviewers').then(response => response.data),
  });
  const products = data.items || [];
  const selected = useMemo(() => products.find((product: any) => product.id === selectedId) || null, [products, selectedId]);
  const currentRevision = selected?.latest_revision || selected?.current_revision || selected?.revisions?.[0] || null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['uv-engineering'] });

  const reconcile = async () => {
    setReconciling(true);
    try {
      const response = await api.post('/admin/uv-engineering/reconcile');
      toast.success(`${response.data?.catalogs_created ?? 0} UV record(s) created; ${response.data?.drafts_created ?? 0} draft(s) created`);
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'UV catalog reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  const changeStatus = async (revision: any, status: string, details: Record<string, unknown> = {}) => {
    try {
      await api.patch(`/admin/uv-engineering/revisions/${revision.id}/status`, { status, ...details });
      toast.success(`UV revision marked ${status}`);
      refresh();
      return true;
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Revision status could not be changed');
      return false;
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="UV Engineering Products" subtitle="Controlled, versioned UV performance records linked one-to-one with PIM products in PFM-UV."
        actions={<Button variant="primary" onClick={reconcile} disabled={reconciling}><RefreshCw className={`h-3.5 w-3.5 ${reconciling ? 'animate-spin' : ''}`} />{reconciling ? 'Reconciling…' : 'Reconcile PIM UV products'}</Button>} />
      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <p>PIM controls identity and active status. Only complete, approved engineering revisions linked to an active PFM-UV product are available to calculations. Approved revisions cannot be edited.</p>
      </div>

      {revisionId && (
        <section aria-label="Linked UV engineering revision" className="rounded-xl border border-violet-200 bg-white shadow-sm">
          {linkedRevisionQuery.isLoading ? (
            <p className="p-5 text-sm text-stone-500">Loading linked UV engineering revision…</p>
          ) : linkedRevisionQuery.isError ? (
            <p role="alert" className="p-5 text-sm text-red-700">The linked UV engineering revision could not be loaded. It may no longer exist or you may not have access.</p>
          ) : linkedRevisionQuery.data ? (() => {
            const { product, revision } = linkedRevisionQuery.data;
            return (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 bg-violet-50/70 px-5 py-4">
                  <div>
                    <h2 className="text-sm font-semibold text-stone-800">Linked UV engineering revision</h2>
                    <p className="mt-1 text-xs text-stone-500">{product.product_name} · {product.product_code}</p>
                    <p className="mt-1 font-mono text-[11px] text-stone-400">Revision ID: {revision.id}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(revision.status)}`}>
                    r{revision.revision_number} · {revision.status}
                  </span>
                </div>
                <dl className="grid gap-4 p-5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-stone-400">Effective reactor volume</dt><dd className="mt-1 font-medium text-stone-700">{revision.effective_reactor_volume_l ?? 'Missing'} L</dd></div>
                  <div><dt className="text-stone-400">85%T irradiance</dt><dd className="mt-1 font-medium text-stone-700">{revision.irradiance_85t_mw_cm2 ?? 'Missing'} mW/cm²</dd></div>
                  <div><dt className="text-stone-400">95%T irradiance</dt><dd className="mt-1 font-medium text-stone-700">{revision.irradiance_95t_mw_cm2 ?? 'Missing'} mW/cm²</dd></div>
                  <div><dt className="text-stone-400">Flow exception per lamp</dt><dd className="mt-1 font-medium text-stone-700">{revision.approved_per_lamp_flow_exception_m3h ?? 'Not set'} m³/h</dd></div>
                  <div><dt className="text-stone-400">Source basis</dt><dd className="mt-1 font-medium text-stone-700">{revision.source_basis || 'Not set'}</dd></div>
                  <div><dt className="text-stone-400">Source evidence</dt><dd className="mt-1 font-medium text-stone-700">{revision.source_evidence || 'Not set'}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-stone-400">Revision notes</dt><dd className="mt-1 whitespace-pre-wrap font-medium text-stone-700">{revision.notes || 'None'}</dd></div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <dt className="text-stone-400">Compatibility for this revision (material defaults are current)</dt>
                    <dd className="mt-2 flex flex-wrap gap-2">
                      {(product.compatibility_options || []).map((option: any) => (
                        <span key={option.water_type} className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-600">
                          {option.water_type}: {option.allowed ? 'Allowed' : 'Not allowed'}{option.is_override ? ' (revision override)' : ' (current material default)'}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
                <p className="border-t border-stone-100 px-5 py-3 text-[11px] text-stone-400">Read-only notification context. This view is pinned to the linked revision, not the product’s latest revision.</p>
              </>
            );
          })() : null}
        </section>
      )}

      {editingRevision && selected && <EngineeringForm product={selected} revision={editingRevision === true ? currentRevision : editingRevision}
        onClose={() => setEditingRevision(null)} onSaved={refresh} />}

      {!revisionId && <>
      <div className="flex justify-end gap-1">
        <button type="button" aria-label="List view" onClick={() => setViewMode('list')} className={`rounded-lg border p-2 ${viewMode === 'list' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-500'}`}><List className="h-4 w-4" /></button>
        <button type="button" aria-label="Card view" onClick={() => setViewMode('cards')} className={`rounded-lg border p-2 ${viewMode === 'cards' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-500'}`}><LayoutGrid className="h-4 w-4" /></button>
      </div>
      {viewMode === 'cards' && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product: any) => {
            const revision = product.current_revision || product.latest_revision || product.revisions?.[0];
            return (
              <article key={product.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="font-semibold text-stone-800">{product.product_name}</h2><p className="font-mono text-xs text-stone-400">{product.product_code}</p></div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(revision?.status || 'Draft')}`}>{revision?.status || 'No revision'}</span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-stone-400">Material</dt><dd>{product.primary_material_code || 'Missing'}</dd></div>
                  <div><dt className="text-stone-400">Power</dt><dd>{product.rated_power_kw != null ? `${product.rated_power_kw} kW` : 'Missing'}</dd></div>
                  <div><dt className="text-stone-400">Lamps</dt><dd>{product.pim_lamp_count ?? product.lamp_count ?? 'Missing'}</dd></div>
                  <div><dt className="text-stone-400">Unit volume</dt><dd>{revision?.effective_reactor_volume_l ?? 'Missing'} L</dd></div>
                  <div><dt className="text-stone-400">85%T irradiance</dt><dd>{revision?.irradiance_85t_mw_cm2 ?? 'Missing'}</dd></div>
                  <div><dt className="text-stone-400">95%T irradiance</dt><dd>{revision?.irradiance_95t_mw_cm2 ?? 'Missing'}</dd></div>
                  <div><dt className="text-stone-400">Source</dt><dd>{revision?.source_basis || 'AAT Foundations'}</dd></div>
                  <div><dt className="text-stone-400">Sync</dt><dd>{product.sync_status || 'Current'}</dd></div>
                </dl>
                <p className={`mt-3 text-xs font-semibold ${product.calculation_enabled ? 'text-emerald-700' : 'text-amber-700'}`}>{product.calculation_enabled ? 'Calculation ready' : product.completeness_message || 'Incomplete'}</p>
                <button onClick={() => { setSelectedId(product.id); setEditingRevision(revision || {}); }} className="mt-3 text-xs font-semibold text-blue-600 hover:underline">{revision?.status === 'Approved' ? 'Revise' : 'Edit engineering data'}</button>
              </article>
            );
          })}
        </section>
      )}
      <section className={`${viewMode === 'cards' ? 'hidden' : ''} overflow-hidden rounded-xl border border-stone-200 bg-white`}>
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
                     <td className="px-4 py-3 text-xs text-stone-500"><div>{product.manufacturer || 'Manufacturer not set'}</div><div>{product.primary_material_code || 'Material not set'} · {product.rated_power_kw != null ? `${product.rated_power_kw} kW` : 'Power not set'}</div></td>
                     <td className="px-4 py-3">{revision ? <><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(revision.status)}`}>{revision.status}</span><div className="mt-1 font-mono text-xs text-stone-400">r{revision.revision_number}</div></> : <span className="text-xs text-amber-700">No revision</span>}</td>
                    <td className="px-4 py-3 text-xs"><span className={product.needs_review || product.sync_status === 'Needs Review' ? 'font-semibold text-amber-700' : 'text-emerald-700'}>{product.sync_status || (product.needs_review ? 'Needs Review' : 'Current')}</span></td>
                    <td className="px-4 py-3 text-xs">{product.calculation_enabled || product.selectable ? <span className="font-semibold text-emerald-700">Calculation enabled</span> : <span className="font-semibold text-amber-700">{product.completeness_message || 'Incomplete or unavailable'}</span>}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      {(!revision || ['Draft', 'In Review'].includes(revision.status)) && <button onClick={() => { setSelectedId(product.id); setEditingRevision(revision || {}); }} className="text-xs font-semibold text-blue-600 hover:underline">{revision ? 'Edit' : 'Complete'}</button>}
                       {revision?.status === 'Draft' && (reviewingRevision?.id === revision.id ? (
                         <div className="flex items-center gap-1">
                           <label className="sr-only" htmlFor={`uv-reviewer-${revision.id}`}>Reviewer for UV revision {revision.revision_number}</label>
                           <select
                             id={`uv-reviewer-${revision.id}`}
                             aria-label={`Reviewer for UV revision ${revision.revision_number}`}
                             className="max-w-40 rounded border border-stone-200 bg-white px-2 py-1 text-xs"
                             value={reviewerId}
                             onChange={event => setReviewerId(event.target.value)}
                             disabled={reviewersQuery.isLoading}
                           >
                             <option value="">Select reviewer…</option>
                             {(reviewersQuery.data?.items || []).map((user: any) => (
                               <option key={user.id} value={user.id}>
                                 {[user.first_name, user.last_name].filter(Boolean).join(' ') || user.email} ({user.role})
                               </option>
                             ))}
                           </select>
                           <button
                             onClick={async () => {
                               const saved = await changeStatus(revision, 'In Review', { reviewer_id: reviewerId });
                               if (saved) setReviewingRevision(null);
                             }}
                             disabled={!reviewerId || reviewersQuery.isLoading}
                             className="text-xs font-semibold text-blue-600 hover:underline disabled:text-stone-300"
                           >Submit</button>
                           <button onClick={() => setReviewingRevision(null)} className="text-xs text-stone-400 hover:underline">Cancel</button>
                         </div>
                       ) : (
                         <button onClick={() => {
                           setReviewingRevision(revision);
                           setReviewerId(revision.reviewer_id || '');
                         }} className="text-xs font-semibold text-blue-600 hover:underline">Review</button>
                       ))}
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
      </>}
      <div className="sr-only"><Sun />UV engineering administration</div>
    </div>
  );
}