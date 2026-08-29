import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, CopyPlus, Plus, ShieldCheck, X } from 'lucide-react';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import toast from 'react-hot-toast';

type ProfileKind = 'media' | 'tan';

const mediaEmpty: any = {
  profile_code: '', profile_name: '', water_types: 'Freshwater', reactor_types: '',
  capacity_model: '', capacity_model_version: '', capacity_basis_unit: '',
  operating_min_temperature_c: '', operating_max_temperature_c: '',
  operating_min_salinity_ppt: '', operating_max_salinity_ppt: '',
  media_min_depth_mm: '', media_max_depth_mm: '', media_void_fraction: '',
  media_bulk_density_kg_m3: '', evidence_reference: '', is_provisional: false,
  provisional_label: '', notes: '',
};
const tanEmpty: any = {
  profile_code: '', profile_name: '', coefficient: '', coefficient_unit: '',
  scope_type: '', scope_unit: '', scope_min: '', scope_max: '',
  evidence_reference: '', notes: '',
};
const inputCls = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40';

function n(value: string) {
  return value === '' ? null : Number(value);
}

function ProfileForm({ kind, form, setForm, onSave, onCancel, saving, revising }: any) {
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  return (
    <section className="rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-stone-800">{revising ? 'Revise' : 'New'} {kind === 'media' ? 'media' : 'TAN generation'} profile revision</h2>
        <button type="button" aria-label="Close profile form" onClick={onCancel} className="text-stone-400 hover:text-stone-700"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-3">
        <label className="text-xs font-medium text-stone-500">Profile code *
          <input className={inputCls} value={form.profile_code} disabled={revising} onChange={e => set('profile_code', e.target.value.toUpperCase())} />
        </label>
        <label className="text-xs font-medium text-stone-500 md:col-span-2">Profile name *
          <input className={inputCls} value={form.profile_name} onChange={e => set('profile_name', e.target.value)} />
        </label>
        {kind === 'media' ? <>
          <label className="text-xs font-medium text-stone-500">Water types * <span className="font-normal">(comma separated)</span>
            <input className={inputCls} value={form.water_types} onChange={e => set('water_types', e.target.value)} placeholder="Freshwater, Marine" />
          </label>
          <label className="text-xs font-medium text-stone-500 md:col-span-2">Compatible reactor types * <span className="font-normal">(comma separated)</span>
            <input className={inputCls} value={form.reactor_types} onChange={e => set('reactor_types', e.target.value)} placeholder="Moving bed biofilter" />
          </label>
          <label className="text-xs font-medium text-stone-500">Capacity model *
            <input className={inputCls} value={form.capacity_model} onChange={e => set('capacity_model', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Model version *
            <input className={inputCls} value={form.capacity_model_version} onChange={e => set('capacity_model_version', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Capacity basis unit *
            <input className={inputCls} value={form.capacity_basis_unit} onChange={e => set('capacity_basis_unit', e.target.value)} placeholder="Engineering-provided unit" />
          </label>
          {[
            ['operating_min_temperature_c', 'Min temperature °C'],
            ['operating_max_temperature_c', 'Max temperature °C'],
            ['operating_min_salinity_ppt', 'Min salinity ppt'],
            ['operating_max_salinity_ppt', 'Max salinity ppt'],
            ['media_min_depth_mm', 'Min media depth mm'],
            ['media_max_depth_mm', 'Max media depth mm'],
            ['media_void_fraction', 'Void fraction (0–1)'],
            ['media_bulk_density_kg_m3', 'Bulk density kg/m³'],
          ].map(([key, label]) => <label key={key} className="text-xs font-medium text-stone-500">{label}
            <input type="number" className={inputCls} value={form[key]} onChange={e => set(key, e.target.value)} />
          </label>)}
          <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-stone-600">
            <input type="checkbox" checked={form.is_provisional} onChange={e => set('is_provisional', e.target.checked)} /> Provisional engineering data
          </label>
          {form.is_provisional && <label className="text-xs font-medium text-stone-500 md:col-span-3">Explicit provisional label *
            <input className={inputCls} value={form.provisional_label} onChange={e => set('provisional_label', e.target.value)} placeholder="State why this data is provisional" />
          </label>}
        </> : <>
          <label className="text-xs font-medium text-stone-500">Coefficient *
            <input type="number" min="0" className={inputCls} value={form.coefficient} onChange={e => set('coefficient', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Coefficient unit *
            <input className={inputCls} value={form.coefficient_unit} onChange={e => set('coefficient_unit', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Scope type *
            <input className={inputCls} value={form.scope_type} onChange={e => set('scope_type', e.target.value)} placeholder="Global feeding" />
          </label>
          <label className="text-xs font-medium text-stone-500">Scope unit
            <input className={inputCls} value={form.scope_unit} onChange={e => set('scope_unit', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Scope minimum
            <input type="number" min="0" className={inputCls} value={form.scope_min} onChange={e => set('scope_min', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Scope maximum
            <input type="number" min="0" className={inputCls} value={form.scope_max} onChange={e => set('scope_max', e.target.value)} />
          </label>
        </>}
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Evidence reference *
          <input className={inputCls} value={form.evidence_reference} onChange={e => set('evidence_reference', e.target.value)} placeholder="Controlled document, study, or engineering reference" />
        </label>
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Revision notes
          <textarea rows={2} className={inputCls} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50/50 px-5 py-3">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={saving}><Check className="h-3.5 w-3.5" />{saving ? 'Saving…' : revising ? 'Save new draft revision' : 'Create draft revision'}</Button>
      </div>
    </section>
  );
}

function ProfilesTable({ title, profiles, kind, onStatus, onRevise }: any) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5"><h2 className="text-sm font-semibold text-stone-700">{title}</h2></div>
      {profiles.length === 0 ? <p className="p-6 text-sm text-stone-400">No controlled revisions have been created.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-400">
            <tr><th className="px-4 py-2">Profile</th><th className="px-4 py-2">Revision</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Evidence</th><th className="px-4 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {profiles.map((profile: any) => <tr key={profile.id}>
              <td className="px-4 py-3"><div className="font-medium text-stone-800">{profile.profile_name}</div><div className="font-mono text-xs text-stone-400">{profile.profile_code}</div></td>
              <td className="px-4 py-3 font-mono">r{profile.revision}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${profile.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : profile.status === 'Retired' ? 'bg-stone-100 text-stone-500' : 'bg-amber-100 text-amber-700'}`}>{profile.status}</span></td>
              <td className="max-w-xs truncate px-4 py-3 text-xs text-stone-500">{profile.evidence_reference}</td>
              <td className="px-4 py-3"><div className="flex justify-end gap-2">
                {profile.status === 'Draft' && <button onClick={() => onStatus(kind, profile, 'In Review')} className="text-xs font-semibold text-blue-600 hover:underline">Send to review</button>}
                {['Draft', 'In Review'].includes(profile.status) && <button onClick={() => onStatus(kind, profile, 'Approved')} className="text-xs font-semibold text-emerald-700 hover:underline">Approve</button>}
                {profile.status === 'Approved' && <button onClick={() => onStatus(kind, profile, 'Retired')} className="text-xs font-semibold text-stone-500 hover:underline">Retire</button>}
                <button onClick={() => onRevise(kind, profile)} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"><CopyPlus className="h-3 w-3" />New revision</button>
              </div></td>
            </tr>)}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

export default function AdminBiologicalMediaProfiles() {
  const qc = useQueryClient();
  const [formKind, setFormKind] = useState<ProfileKind | null>(null);
  const [mediaForm, setMediaForm] = useState(mediaEmpty);
  const [tanForm, setTanForm] = useState(tanEmpty);
  const [revisionSource, setRevisionSource] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: mediaData = { items: [] } } = useQuery({
    queryKey: ['biological-media-profiles', 'admin'],
    queryFn: () => api.get('/biological-media/media-profiles', { params: { include_retired: true } }).then(r => r.data),
  });
  const { data: tanData = { items: [] } } = useQuery({
    queryKey: ['tan-generation-profiles', 'admin'],
    queryFn: () => api.get('/biological-media/tan-profiles', { params: { include_retired: true } }).then(r => r.data),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['biological-media-profiles'] });
    qc.invalidateQueries({ queryKey: ['tan-generation-profiles'] });
  };
  const payloadFor = (kind: ProfileKind) => {
    const form = kind === 'media' ? mediaForm : tanForm;
    if (kind === 'media') return {
      ...form,
      water_types: form.water_types.split(',').map((value: string) => value.trim()).filter(Boolean),
      reactor_types: form.reactor_types.split(',').map((value: string) => value.trim()).filter(Boolean),
      ...Object.fromEntries(['operating_min_temperature_c', 'operating_max_temperature_c', 'operating_min_salinity_ppt',
        'operating_max_salinity_ppt', 'media_min_depth_mm', 'media_max_depth_mm', 'media_void_fraction',
        'media_bulk_density_kg_m3'].map(key => [key, n(form[key])])),
    };
    return { ...form, coefficient: n(form.coefficient), scope_min: n(form.scope_min), scope_max: n(form.scope_max) };
  };
  const create = async () => {
    if (!formKind) return;
    setSaving(true);
    try {
      const path = `/admin/biological-media/${formKind === 'media' ? 'media-profiles' : 'tan-profiles'}`;
      await api.post(revisionSource ? `${path}/${revisionSource.id}/revisions` : path, payloadFor(formKind));
      toast.success('Draft profile revision created');
      setFormKind(null);
      setRevisionSource(null);
      setMediaForm(mediaEmpty);
      setTanForm(tanEmpty);
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Profile revision could not be created');
    } finally {
      setSaving(false);
    }
  };
  const changeStatus = async (kind: ProfileKind, profile: any, status: string) => {
    try {
      await api.patch(`/admin/biological-media/${kind === 'media' ? 'media-profiles' : 'tan-profiles'}/${profile.id}/status`, { status });
      toast.success(`Revision marked ${status}`);
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Status could not be changed');
    }
  };
  const revise = (kind: ProfileKind, profile: any) => {
    setRevisionSource(profile);
    setFormKind(kind);
    if (kind === 'media') {
      setMediaForm({
        ...mediaEmpty,
        ...profile,
        water_types: (profile.water_types || []).join(', '),
        reactor_types: (profile.reactor_types || []).join(', '),
        operating_min_temperature_c: profile.operating_min_temperature_c ?? '',
        operating_max_temperature_c: profile.operating_max_temperature_c ?? '',
        operating_min_salinity_ppt: profile.operating_min_salinity_ppt ?? '',
        operating_max_salinity_ppt: profile.operating_max_salinity_ppt ?? '',
        media_min_depth_mm: profile.media_min_depth_mm ?? '',
        media_max_depth_mm: profile.media_max_depth_mm ?? '',
        media_void_fraction: profile.media_void_fraction ?? '',
        media_bulk_density_kg_m3: profile.media_bulk_density_kg_m3 ?? '',
      });
    } else {
      setTanForm({
        ...tanEmpty,
        ...profile,
        coefficient: profile.coefficient ?? '',
        scope_min: profile.scope_min ?? '',
        scope_max: profile.scope_max ?? '',
      });
    }
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader title="Biological Media Profiles" subtitle="Controlled media and TAN reference revisions. Approval freezes engineering evidence and operating metadata."
        actions={<div className="flex gap-2"><Button onClick={() => setFormKind('tan')}><Plus className="h-3.5 w-3.5" />TAN profile</Button><Button variant="primary" onClick={() => setFormKind('media')}><Plus className="h-3.5 w-3.5" />Media profile</Button></div>} />
      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <ShieldCheck className="h-5 w-5 shrink-0" /><p>Approved revisions cannot be edited. Retire a revision to prevent future selection, or create a new draft revision for later changes.</p>
      </div>
      {formKind && <ProfileForm kind={formKind} form={formKind === 'media' ? mediaForm : tanForm}
        setForm={formKind === 'media' ? setMediaForm : setTanForm} onSave={create}
        onCancel={() => { setFormKind(null); setRevisionSource(null); }} saving={saving} revising={!!revisionSource} />}
      <ProfilesTable title="Controlled media profiles" profiles={mediaData.items || []} kind="media" onStatus={changeStatus} onRevise={revise} />
      <ProfilesTable title="Controlled TAN generation profiles" profiles={tanData.items || []} kind="tan" onStatus={changeStatus} onRevise={revise} />
      <div className="sr-only"><Activity />Biological media administration</div>
    </div>
  );
}