import { useQuery, useQueryClient } from '@tanstack/react-query';
import { canManageAdminPage } from '../../lib/adminRegistry';
import { Navigate } from 'react-router-dom';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, LibraryBig, ShieldCheck, UserCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import { useAuthStore } from '../../store/authStore';

type CorrelationClassForm = {
  class_code: string;
  class_name: string;
  description: string;
  guidance: string;
};

type CorrelationVersionForm = {
  class_id: string;
  version: string;
  coefficient_kg_m2_s_kpa: string;
  lower_agitation_class_code: string;
  lower_agitation_class_name: string;
  lower_class_coefficient_kg_m2_s_kpa: string;
  adjustment_value: string;
  adjustment_basis: string;
  upper_agitation_class_code: string;
  upper_agitation_class_name: string;
  upper_class_coefficient_kg_m2_s_kpa: string;
  source_reference: string;
  notes: string;
};

const emptyClassForm = (): CorrelationClassForm => ({
  class_code: '',
  class_name: '',
  description: '',
  guidance: '',
});

const emptyVersionForm = (): CorrelationVersionForm => ({
  class_id: '',
  version: '',
  coefficient_kg_m2_s_kpa: '',
  lower_agitation_class_code: '',
  lower_agitation_class_name: '',
  lower_class_coefficient_kg_m2_s_kpa: '',
  adjustment_value: '',
  adjustment_basis: '',
  upper_agitation_class_code: '',
  upper_agitation_class_name: '',
  upper_class_coefficient_kg_m2_s_kpa: '',
  source_reference: '',
  notes: '',
});

export function canManageEvaporationCorrelations(
  user: ReturnType<typeof useAuthStore.getState>['user'],
) {
  return canManageAdminPage(user, 'evaporation-correlations');
}

function correlationDate(value: unknown) {
  return value ? new Date(String(value)).toLocaleString() : '—';
}

function numericOrNull(value: unknown) {
  return value === '' || value == null ? null : Number(value);
}

function ThermalCorrelationUsageList({ usages }: { usages: any[] }) {
  if (!usages.length) {
    return <div className="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-500">No captured calculations use this version.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="min-w-[850px] w-full text-left text-xs">
        <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Design Book</th>
            <th className="px-3 py-2">Project</th>
            <th className="px-3 py-2">System</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Captured</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {usages.map((usage, index) => (
            <tr key={`${usage.design_book_id}-${usage.system_id}-${index}`} className="align-top">
              <td className="px-3 py-3">
                <div className="font-semibold text-stone-800">{usage.book_code || usage.design_book_id}</div>
                <div className="mt-1 text-stone-500">{usage.book_title} · Rev {usage.revision || '—'}</div>
              </td>
              <td className="px-3 py-3 text-stone-600">{usage.project_code || '—'} · {usage.project_name || 'Unnamed project'}</td>
              <td className="px-3 py-3 text-stone-600">{usage.system_code || '—'} · {usage.system_name || 'Unnamed system'}</td>
              <td className="px-3 py-3 font-medium text-stone-700">{usage.design_book_status}</td>
              <td className="px-3 py-3 text-stone-500">{correlationDate(usage.captured_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminEvaporationCorrelations() {
  const user = useAuthStore(state => state.user);
  const queryClient = useQueryClient();
  const canManage = canManageEvaporationCorrelations(user);
  const [classForm, setClassForm] = useState<CorrelationClassForm>(emptyClassForm);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [versionForm, setVersionForm] = useState<CorrelationVersionForm>(emptyVersionForm);
  const [saving, setSaving] = useState(false);
  const [pendingSupersede, setPendingSupersede] = useState<any>(null);
  const [approveReplacement, setApproveReplacement] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-thermal-correlation-library'],
    queryFn: () => api.get('/thermal-correlations').then(response => response.data),
    enabled: canManage,
  });
  const classes: any[] = data?.classes || [];
  const items: any[] = data?.items || [];
  const {
    data: usageData,
    isFetching: usageLoading,
    isError: usageError,
    refetch: refetchUsage,
  } = useQuery({
    queryKey: ['admin-thermal-correlation-usages', pendingSupersede?.id],
    queryFn: () => api.get(`/thermal-correlations/versions/${pendingSupersede.id}/usages`).then(response => response.data),
    enabled: canManage && !!pendingSupersede?.id,
  });

  if (!canManage) return <Navigate to="/" replace />;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-thermal-correlation-library'] });
    queryClient.invalidateQueries({ queryKey: ['thermal-correlation-library'] });
  };

  const beginEditClass = (item: any) => {
    setEditingClassId(item.id);
    setClassForm({
      class_code: item.class_code || '',
      class_name: item.class_name || '',
      description: item.description || '',
      guidance: item.guidance || '',
    });
  };

  const saveClass = async () => {
    if (!classForm.class_code.trim() || !classForm.class_name.trim()) return;
    setSaving(true);
    try {
      if (editingClassId) {
        await api.put(`/thermal-correlations/classes/${editingClassId}`, {
          ...classForm,
          sort_order: classes.find(item => item.id === editingClassId)?.sort_order || 0,
          is_active: classes.find(item => item.id === editingClassId)?.is_active !== false,
        });
        toast.success('Agitation class updated');
      } else {
        const response = await api.post('/thermal-correlations/classes', classForm);
        setVersionForm(current => ({ ...current, class_id: response.data.id }));
        toast.success('Agitation class created');
      }
      setClassForm(emptyClassForm());
      setEditingClassId(null);
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save agitation class');
    } finally {
      setSaving(false);
    }
  };

  const saveVersion = async () => {
    if (!versionForm.class_id) return;
    setSaving(true);
    try {
      await api.post(`/thermal-correlations/classes/${versionForm.class_id}/versions`, {
        version: versionForm.version,
        coefficient_kg_m2_s_kpa: numericOrNull(versionForm.coefficient_kg_m2_s_kpa),
        lower_agitation_class_code: versionForm.lower_agitation_class_code,
        lower_agitation_class_name: versionForm.lower_agitation_class_name,
        lower_class_coefficient_kg_m2_s_kpa: numericOrNull(versionForm.lower_class_coefficient_kg_m2_s_kpa),
        adjustment_value: numericOrNull(versionForm.adjustment_value),
        adjustment_basis: versionForm.adjustment_basis,
        upper_agitation_class_code: versionForm.upper_agitation_class_code,
        upper_agitation_class_name: versionForm.upper_agitation_class_name,
        upper_class_coefficient_kg_m2_s_kpa: numericOrNull(versionForm.upper_class_coefficient_kg_m2_s_kpa),
        source_reference: versionForm.source_reference,
        notes: versionForm.notes,
        impact_token: approveReplacement ? usageData?.impact_token : undefined,
      });
      setVersionForm(current => ({ ...emptyVersionForm(), class_id: current.class_id }));
      setPendingSupersede(null);
      setApproveReplacement(false);
      refresh();
      toast.success('Approved correlation version added');
    } catch (error: any) {
      if (error?.response?.data?.error?.code === 'THERMAL_CORRELATION_IMPACT_CHANGED') {
        await refetchUsage();
      }
      toast.error(error?.response?.data?.error?.message || 'Unable to approve correlation version');
    } finally {
      setSaving(false);
    }
  };

  const requestApproveVersion = () => {
    if (!versionForm.class_id || !versionForm.version.trim() ||
        !versionForm.coefficient_kg_m2_s_kpa || !versionForm.source_reference.trim()) return;
    const current = items.find(item => item.class_id === versionForm.class_id && item.status === 'approved');
    if (current) {
      setApproveReplacement(true);
      setPendingSupersede(current);
      return;
    }
    saveVersion();
  };

  const requestSupersede = (correlation: any) => {
    setApproveReplacement(false);
    setPendingSupersede(correlation);
  };

  const supersede = async () => {
    if (!pendingSupersede) return;
    if (approveReplacement) {
      await saveVersion();
      return;
    }
    setSaving(true);
    try {
      await api.post(`/thermal-correlations/versions/${pendingSupersede.id}/supersede`, {
        impact_token: usageData?.impact_token,
      });
      refresh();
      setPendingSupersede(null);
      toast.success(`${pendingSupersede.class_code} ${pendingSupersede.version} superseded`);
    } catch (error: any) {
      if (error?.response?.data?.error?.code === 'THERMAL_CORRELATION_IMPACT_CHANGED') {
        await refetchUsage();
      }
      toast.error(error?.response?.data?.error?.message || 'Unable to supersede correlation');
    } finally {
      setSaving(false);
    }
  };

  const closeUsage = () => {
    setPendingSupersede(null);
    setApproveReplacement(false);
  };

  const fieldClass = 'w-full rounded-lg border border-stone-200 px-3 py-2 text-sm bg-white disabled:bg-stone-50 disabled:text-stone-500';
  const labelClass = 'block text-xs font-medium text-stone-600 mb-1';
  const activeClass = pendingSupersede && classes.find(item => item.id === versionForm.class_id);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Evaporation Correlations"
        subtitle="Governed agitation classes and versioned evaporation evidence used by Design Book Thermal calculations."
      />

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <p>Only admins and engineers with Design Books manage access can change this library. Existing calculations retain frozen correlation snapshots when an approved version is superseded.</p>
      </div>

      {isError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Unable to load evaporation correlation history.
        </div>
      )}
      {isLoading ? (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">Loading evaporation correlations…</div>
      ) : (
        <>
          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
              <LibraryBig className="h-4 w-4 text-[#456b7d]" />
              <div>
                <h2 className="font-semibold text-stone-900">Agitation classes</h2>
                <p className="text-xs text-stone-500">Class descriptions and selection guidance are editable without changing existing version evidence.</p>
              </div>
            </div>
            <div className="grid gap-3 border-b border-stone-100 p-4 lg:grid-cols-[1fr_1.2fr_1.5fr_1.5fr_auto]">
              <label><span className={labelClass}>Class code</span><input value={classForm.class_code} onChange={event => setClassForm(current => ({ ...current, class_code: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Class name</span><input value={classForm.class_name} onChange={event => setClassForm(current => ({ ...current, class_name: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Description</span><input value={classForm.description} onChange={event => setClassForm(current => ({ ...current, description: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Selection guidance</span><input value={classForm.guidance} onChange={event => setClassForm(current => ({ ...current, guidance: event.target.value }))} className={fieldClass} /></label>
              <div className="flex items-end gap-2">
                <Button type="button" onClick={saveClass} variant="thermal" size="sm" disabled={saving || !classForm.class_code.trim() || !classForm.class_name.trim()}>{editingClassId ? 'Update class' : 'Add class'}</Button>
                {editingClassId && <button type="button" onClick={() => { setEditingClassId(null); setClassForm(emptyClassForm()); }} className="rounded-lg px-2 py-2 text-xs text-stone-500 hover:text-stone-800">Cancel</button>}
              </div>
            </div>
            <div className="divide-y divide-stone-100">
              {classes.map(item => (
                <div key={item.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_2fr_auto] sm:items-center">
                  <div>
                    <div className="font-semibold text-stone-800">{item.class_code} · {item.class_name}</div>
                    <div className="text-xs text-stone-500">{item.is_active === false ? 'Inactive' : 'Active'}</div>
                  </div>
                  <div className="text-sm text-stone-600">{item.description || 'No description.'}<span className="block text-xs text-stone-400">{item.guidance || 'No selection guidance.'}</span></div>
                  <button type="button" onClick={() => beginEditClass(item)} className="justify-self-start rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 sm:justify-self-end">Edit class</button>
                </div>
              ))}
              {!classes.length && <div className="px-4 py-6 text-center text-sm text-stone-500">No agitation classes are available.</div>}
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#456b7d]" />
                <div>
                  <h2 className="font-semibold text-stone-900">Approve a replacement version</h2>
                  <p className="text-xs text-stone-500">Approval supersedes the current version for that class after captured usage is confirmed.</p>
                </div>
              </div>
              {activeClass && <span className="text-xs text-stone-500">{activeClass.class_code}</span>}
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1.5fr_auto]">
                <label><span className={labelClass}>Agitation class</span><select value={versionForm.class_id} onChange={event => setVersionForm(current => ({ ...current, class_id: event.target.value }))} className={fieldClass}><option value="">Select class</option>{classes.filter(item => item.is_active).map(item => <option key={item.id} value={item.id}>{item.class_code} · {item.class_name}</option>)}</select></label>
                <label><span className={labelClass}>New version</span><input value={versionForm.version} onChange={event => setVersionForm(current => ({ ...current, version: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Coefficient (kg/m²·s·kPa)</span><input type="number" min="0" step="any" value={versionForm.coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Source / reference</span><input value={versionForm.source_reference} onChange={event => setVersionForm(current => ({ ...current, source_reference: event.target.value }))} className={fieldClass} /></label>
                <Button type="button" onClick={requestApproveVersion} variant="thermal" size="sm" disabled={saving || !versionForm.class_id || !versionForm.version.trim() || !versionForm.coefficient_kg_m2_s_kpa || !versionForm.source_reference.trim()} className="self-end">Approve version</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label><span className={labelClass}>Lower class code</span><input value={versionForm.lower_agitation_class_code} onChange={event => setVersionForm(current => ({ ...current, lower_agitation_class_code: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Lower class name</span><input value={versionForm.lower_agitation_class_name} onChange={event => setVersionForm(current => ({ ...current, lower_agitation_class_name: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Lower coefficient</span><input type="number" min="0" step="any" value={versionForm.lower_class_coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, lower_class_coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Adjustment value</span><input type="number" step="any" value={versionForm.adjustment_value} onChange={event => setVersionForm(current => ({ ...current, adjustment_value: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Adjustment basis</span><input value={versionForm.adjustment_basis} onChange={event => setVersionForm(current => ({ ...current, adjustment_basis: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Upper class code</span><input value={versionForm.upper_agitation_class_code} onChange={event => setVersionForm(current => ({ ...current, upper_agitation_class_code: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Upper class name</span><input value={versionForm.upper_agitation_class_name} onChange={event => setVersionForm(current => ({ ...current, upper_agitation_class_name: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Upper coefficient</span><input type="number" min="0" step="any" value={versionForm.upper_class_coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, upper_class_coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
              </div>
              <label className="block"><span className={labelClass}>Engineering notes</span><textarea rows={2} value={versionForm.notes} onChange={event => setVersionForm(current => ({ ...current, notes: event.target.value }))} className={`${fieldClass} resize-none`} /></label>
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-4 py-3">
              <h2 className="font-semibold text-stone-900">Version history and captured usage</h2>
              <p className="text-xs text-stone-500">Approved and superseded evidence remains visible for review. Usage includes draft, review, approved, and released snapshots.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1100px] w-full text-left text-xs">
                <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Class / version</th><th className="px-3 py-2">Coefficient and basis</th><th className="px-3 py-2">Source evidence</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Approval</th><th className="px-3 py-2">Usage</th><th className="px-3 py-2"></th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {items.map(item => (
                    <tr key={item.id} className="align-top">
                      <td className="px-3 py-3"><div className="font-semibold text-stone-800">{item.class_code} · {item.class_name}</div><div className="mt-1 font-mono text-stone-500">{item.version}</div></td>
                      <td className="px-3 py-3 text-stone-600"><div className="font-mono">{item.coefficient_kg_m2_s_kpa}</div><div className="mt-1">{item.formula_basis || 'Class coefficient'}</div><div className="mt-1 text-stone-400">Activity {item.activity_factor ?? '—'} · Base {item.base_coefficient_kg_m2_s_kpa ?? '—'}</div></td>
                      <td className="max-w-[260px] px-3 py-3 text-stone-600"><div>{item.source_basis || '—'}</div><div className="mt-1">{item.source_document || '—'} {item.source_revision ? `· Rev ${item.source_revision}` : ''}</div><div className="mt-1 text-stone-400">{item.source_reference || '—'}</div></td>
                      <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${item.status === 'approved' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-stone-200 bg-stone-100 text-stone-600'}`}>{item.status}</span></td>
                      <td className="px-3 py-3 text-stone-600"><div>{correlationDate(item.approved_at)}</div><div className="mt-1 text-stone-400">{item.approving_engineer || item.approved_by || 'Recorded approver'}</div>{item.status === 'superseded' && <div className="mt-2 border-t border-stone-100 pt-2"><div>Superseded {correlationDate(item.superseded_at)}</div></div>}</td>
                      <td className="px-3 py-3"><button type="button" onClick={() => requestSupersede(item)} className="font-medium text-[#456b7d] hover:underline">{item.usage_count || 0} · View usage</button></td>
                      <td className="px-3 py-3 text-right">{item.status === 'approved' && <Button type="button" onClick={() => requestSupersede(item)} variant="thermal" size="sm" disabled={saving}>Supersede</Button>}</td>
                    </tr>
                  ))}
                  {!items.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-500">No evaporation correlation versions are available.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {pendingSupersede && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Correlation usage</p><h2 className="mt-1 text-lg font-bold text-stone-900">{pendingSupersede.class_code} · {pendingSupersede.version}</h2><p className="mt-1 text-sm text-stone-500">{usageData?.correlation?.usage_count ?? pendingSupersede.usage_count ?? 0} captured thermal calculation(s)</p></div>
              <button type="button" onClick={closeUsage} aria-label="Close correlation usage" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{approveReplacement ? `Approving ${versionForm.version || 'the replacement version'} will supersede this current version. ` : pendingSupersede.status === 'approved' ? 'Superseding stops new calculations from selecting this version. ' : ''}Saved review and release snapshots remain unchanged.</p></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-stone-50/50 p-5">
              {usageLoading ? <div className="py-12 text-center text-sm text-stone-500">Loading captured usage…</div> : usageError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Unable to load the captured usage. Close this dialog and try again.</div> : <ThermalCorrelationUsageList usages={usageData?.usages || []} />}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-4">
              <div className="flex items-center gap-2 text-xs text-stone-500"><UserCheck className="h-4 w-4 text-[#b86843]" /> Usage is rechecked before any governance change.</div>
              <div className="flex gap-2"><button type="button" onClick={closeUsage} className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">{pendingSupersede.status === 'approved' ? 'Cancel' : 'Close'}</button>{pendingSupersede.status === 'approved' && <Button type="button" onClick={supersede} variant="thermal" disabled={saving || usageLoading || usageError}>{saving ? approveReplacement ? 'Approving…' : 'Superseding…' : approveReplacement ? 'Confirm and approve version' : 'Confirm supersede'}</Button>}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}