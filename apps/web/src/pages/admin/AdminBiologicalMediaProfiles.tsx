import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, CopyPlus, Plus, ShieldCheck, X } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import toast from 'react-hot-toast';
import {
  BIOLOGICAL_MEDIA_REACTOR_TYPES,
  BIOLOGICAL_MEDIA_WATER_TYPES,
} from '../../lib/biologicalMediaOptions';

type ProfileKind = 'media' | 'tan' | 'max-tan';
type AdminFocus = ProfileKind | 'evidence';

const mediaEmpty: any = {
  profile_code: '', profile_name: '', water_types: ['Freshwater'], reactor_types: [],
  capacity_model: 'OVERALL_VTR', capacity_model_version: '', capacity_basis_unit: '',
  operating_min_temperature_c: '', operating_max_temperature_c: '',
  operating_min_salinity_ppt: '', operating_max_salinity_ppt: '',
  media_min_depth_mm: '', media_max_depth_mm: '', media_void_fraction: '',
  media_bulk_density_kg_m3: '', overall_vtr_g_tan_n_m3_d: '', default_safety_factor: '',
  minimum_media_m3: '', module_increment_m3: '', media_fill_fraction: '',
  operating_min_ph: '', operating_max_ph: '', operating_min_tan_mg_n_l: '',
  operating_max_tan_mg_n_l: '', operating_min_do_mg_l: '', operating_max_do_mg_l: '',
  operating_min_flow_m3_h: '', operating_max_flow_m3_h: '',
  evidence_reference: '', is_provisional: false,
  provisional_label: '', notes: '',
};
const tanEmpty: any = {
  profile_code: '', profile_name: '', coefficient: '', coefficient_unit: 'kg TAN-N/kg feed protein',
  recommended_application: '',
  scope_type: '', scope_unit: '', scope_min: '', scope_max: '',
  evidence_reference: '', notes: '',
};
const maxTanEmpty: any = {
  profile_code: '', profile_name: '', max_tan_mg_n_l: '', engineering_note: '',
};
const inputCls = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40';

function compatibilityValues(value: unknown): string[] {
  return Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
}

function CompatibilityMultiSelect({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = compatibilityValues(values);
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  };
  const savedValues = selected.filter(value => !options.includes(value));

  return (
    <div className="relative">
      <span className="text-xs font-medium text-stone-500">{label} *</span>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(current => !current)}
        className={`${inputCls} flex min-h-[42px] items-center justify-between text-left`}
      >
        <span className={selected.length ? 'text-stone-700' : 'text-stone-400'}>
          {selected.length ? selected.join(', ') : 'Select one or more'}
        </span>
        <span className="ml-2 text-stone-400">▾</span>
      </button>
      {open && (
        <div role="listbox" aria-label={label} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
          {options.map(option => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-stone-700 hover:bg-stone-50">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              {option}
            </label>
          ))}
          {savedValues.map(option => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-stone-700 hover:bg-stone-50">
              <input type="checkbox" checked onChange={() => toggle(option)} />
              {option} <span className="text-xs text-stone-400">(saved value)</span>
            </label>
          ))}
          <button type="button" className="mt-1 w-full border-t border-stone-100 px-2 pt-2 text-left text-xs font-semibold text-blue-700 hover:underline" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function n(value: string) {
  return value === '' ? null : Number(value);
}

function ProfileForm({ kind, form, setForm, onSave, onCancel, saving, revising, editing, saveError }: any) {
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const controlledValueProfile = kind === 'tan' && form.profile_code === 'SPECIES_AND_FEED_VALIDATED';
  return (
    <section className="rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-stone-800">{editing ? 'Edit' : revising ? 'Revise' : 'New'} {kind === 'media' ? 'media' : kind === 'tan' ? 'TAN generation' : 'Maximum TAN'} profile revision</h2>
        <button type="button" aria-label="Close profile form" onClick={onCancel} className="text-stone-400 hover:text-stone-700"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-3">
        {saveError?.length > 0 && <div role="alert" className="md:col-span-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-semibold">Save could not be completed</p>
          <ul className="mt-1 list-disc pl-5">{saveError.map((error: string) => <li key={error}>{error}</li>)}</ul>
        </div>}
        <label className="text-xs font-medium text-stone-500">Profile code *
          <input className={inputCls} value={form.profile_code} disabled={revising || editing} onChange={e => set('profile_code', e.target.value.toUpperCase())} />
        </label>
        <label className="text-xs font-medium text-stone-500 md:col-span-2">Profile name *
          <input className={inputCls} value={form.profile_name} onChange={e => set('profile_name', e.target.value)} />
        </label>
        {kind === 'media' ? <>
          <CompatibilityMultiSelect
            label="Water types"
            values={form.water_types}
            options={BIOLOGICAL_MEDIA_WATER_TYPES}
            onChange={values => set('water_types', values)}
          />
          <div className="md:col-span-2">
            <CompatibilityMultiSelect
              label="Compatible reactor types"
              values={form.reactor_types}
              options={BIOLOGICAL_MEDIA_REACTOR_TYPES}
              onChange={values => set('reactor_types', values)}
            />
          </div>
          <label className="text-xs font-medium text-stone-500">Capacity model *
            <select className={inputCls} value={form.capacity_model} onChange={e => set('capacity_model', e.target.value)}>
              <option value="OVERALL_VTR">Overall approved VTR</option>
            </select>
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
          <div className="md:col-span-3 border-t border-stone-100 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Overall VTR sizing</h3>
            <p className="mt-1 text-xs text-stone-400">These approved values are required for a deterministic sizing preview.</p>
          </div>
          {[
            ['overall_vtr_g_tan_n_m3_d', 'Overall VTR g TAN-N/m³ media/day'],
            ['default_safety_factor', 'Default safety factor'],
            ['minimum_media_m3', 'Minimum media volume m³'],
            ['module_increment_m3', 'Module increment m³'],
            ['media_fill_fraction', 'Media fill fraction (0–1)'],
            ['operating_min_ph', 'Min pH'],
            ['operating_max_ph', 'Max pH'],
            ['operating_min_tan_mg_n_l', 'Min TAN mg N/L'],
            ['operating_max_tan_mg_n_l', 'Max TAN mg N/L'],
            ['operating_min_do_mg_l', 'Min dissolved oxygen mg/L'],
            ['operating_max_do_mg_l', 'Max dissolved oxygen mg/L'],
            ['operating_min_flow_m3_h', 'Min actual flow m³/h'],
            ['operating_max_flow_m3_h', 'Max actual flow m³/h'],
          ].map(([key, label]) => <label key={key} className="text-xs font-medium text-stone-500">{label}
            <input type="number" step="any" min="0" className={inputCls} value={form[key]} onChange={e => set(key, e.target.value)} />
          </label>)}
          <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-stone-600">
            <input type="checkbox" checked={form.is_provisional} onChange={e => set('is_provisional', e.target.checked)} /> Provisional engineering data
          </label>
          {form.is_provisional && <label className="text-xs font-medium text-stone-500 md:col-span-3">Explicit provisional label *
            <input className={inputCls} value={form.provisional_label} onChange={e => set('provisional_label', e.target.value)} placeholder="State why this data is provisional" />
          </label>}
        </> : kind === 'tan' ? <>
          <label className="text-xs font-medium text-stone-500">Coefficient <span className="font-normal">{controlledValueProfile ? '(required before approval)' : '*'}</span>
            <input type="number" min="0" step="any" className={inputCls} value={form.coefficient} onChange={e => set('coefficient', e.target.value)}
              placeholder={controlledValueProfile ? 'Enter the evidence-based value' : undefined} />
          </label>
          <label className="text-xs font-medium text-stone-500">Coefficient unit *
            <input className={inputCls} value={form.coefficient_unit} readOnly aria-readonly="true" />
          </label>
          <label className="text-xs font-medium text-stone-500">Scope type *
            <span className="block font-normal text-stone-400">Where this coefficient is valid, such as a general feeding basis or a validated species/feed combination.</span>
            <input className={inputCls} value={form.scope_type} onChange={e => set('scope_type', e.target.value)} placeholder="General feeding reference" />
          </label>
          <div className="md:col-span-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
            <strong className="font-semibold text-stone-700">Optional numeric applicability envelope</strong>
            <p className="mt-1">Scope unit, minimum, and maximum are optional. Use them only when supporting evidence defines a numeric range; leave them blank for general reference profiles.</p>
          </div>
          <label className="text-xs font-medium text-stone-500">Scope unit <span className="font-normal">(optional)</span>
            <input className={inputCls} value={form.scope_unit} onChange={e => set('scope_unit', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Scope minimum <span className="font-normal">(optional)</span>
            <input type="number" min="0" className={inputCls} value={form.scope_min} onChange={e => set('scope_min', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500">Scope maximum <span className="font-normal">(optional)</span>
            <input type="number" min="0" className={inputCls} value={form.scope_max} onChange={e => set('scope_max', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500 md:col-span-3">Recommended application
            <textarea rows={2} className={inputCls} value={form.recommended_application} onChange={e => set('recommended_application', e.target.value)}
              placeholder="Describe when designers should choose this controlled reference" />
          </label>
        </> : <>
          <label className="text-xs font-medium text-stone-500">Maximum TAN mg N/L *
            <input type="number" min="0" step="any" className={inputCls} value={form.max_tan_mg_n_l} onChange={e => set('max_tan_mg_n_l', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-stone-500 md:col-span-3">Description / engineering note
            <textarea rows={3} className={inputCls} value={form.engineering_note} onChange={e => set('engineering_note', e.target.value)}
              placeholder="State the intended design basis, scope, and limitations." />
          </label>
        </>}
        {kind !== 'max-tan' && <label className="text-xs font-medium text-stone-500 md:col-span-3">Evidence reference <span className="font-normal">(required for approval)</span>
          <input className={inputCls} value={form.evidence_reference} onChange={e => set('evidence_reference', e.target.value)} placeholder="Controlled document, study, or engineering reference" />
        </label>}
        <label className="text-xs font-medium text-stone-500 md:col-span-3">Revision notes
          <textarea rows={2} className={inputCls} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50/50 px-5 py-3">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={saving}><Check className="h-3.5 w-3.5" />{saving ? 'Saving…' : editing ? 'Save changes' : revising ? 'Save new draft revision' : 'Create draft revision'}</Button>
      </div>
    </section>
  );
}

function ProfilesTable({ id, title, profiles, kind, onStatus, onEdit, onRevise, onDefault, onDelete, focused }: any) {
  return (
    <section id={id} tabIndex={-1} className={`scroll-mt-6 rounded-xl border bg-white overflow-hidden outline-none ${
      focused ? 'border-blue-400 ring-2 ring-blue-100' : 'border-stone-200'
    }`}>
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5"><h2 className="text-sm font-semibold text-stone-700">{title}</h2></div>
      {profiles.length === 0 ? <p className="p-6 text-sm text-stone-400">No controlled revisions have been created.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-400">
            <tr><th className="px-4 py-2">Profile</th><th className="px-4 py-2">Revision</th><th className="px-4 py-2">Status</th>{kind === 'tan' && <><th className="px-4 py-2">Coefficient</th><th className="px-4 py-2">Unit</th><th className="px-4 py-2">Recommended application</th></>}{kind === 'media' && <th className="px-4 py-2">Overall VTR</th>}{kind === 'max-tan' && <th className="px-4 py-2">Maximum TAN</th>}<th className="px-4 py-2">Engineering basis</th><th className="px-4 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {profiles.map((profile: any) => <tr key={profile.id}>
              <td className="px-4 py-3"><div className="font-medium text-stone-800">{profile.profile_name}</div><div className="font-mono text-xs text-stone-400">{profile.profile_code}</div></td>
              <td className="px-4 py-3 font-mono">r{profile.revision}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${profile.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : profile.status === 'Retired' ? 'bg-stone-100 text-stone-500' : 'bg-amber-100 text-amber-700'}`}>{profile.status}</span></td>
              {kind === 'tan' && <>
                <td className="px-4 py-3 font-mono text-xs">{profile.coefficient == null ? <span className="font-sans font-semibold text-amber-700">Controlled value required</span> : profile.coefficient}</td>
                <td className="max-w-xs px-4 py-3 text-xs text-stone-500">{profile.coefficient_unit || 'Not specified'}</td>
                <td className="max-w-sm px-4 py-3 text-xs text-stone-500">{profile.recommended_application || 'Not specified'}</td>
              </>}
              {kind === 'media' && <>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                  {profile.overall_vtr_g_tan_n_m3_d == null
                    ? 'Not specified'
                    : <>{profile.overall_vtr_g_tan_n_m3_d} <span className="font-sans text-stone-500">{profile.capacity_basis_unit}</span></>}
                </td>
              </>}
              {kind === 'max-tan' && <td className="px-4 py-3 font-mono text-xs">{profile.max_tan_mg_n_l} mg N/L{profile.is_default && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 font-sans font-semibold text-blue-700">Default</span>}</td>}
              <td className="max-w-xs px-4 py-3 text-xs text-stone-500">
                {kind === 'max-tan'
                  ? (profile.engineering_note || 'No note recorded')
                  : profile.evidence_reference
                    ? profile.evidence_reference
                    : <span className="font-medium text-amber-700">Review required before approval</span>}
              </td>
              <td className="px-4 py-3"><div className="flex justify-end gap-2">
                {profile.status === 'Draft' && <button onClick={() => onStatus(kind, profile, 'In Review')} className="text-xs font-semibold text-blue-600 hover:underline">Send to review</button>}
                {['Draft', 'In Review'].includes(profile.status) && <button onClick={() => onStatus(kind, profile, 'Approved')} className="text-xs font-semibold text-emerald-700 hover:underline">Approve</button>}
                 {['Draft', 'In Review'].includes(profile.status) && <button onClick={() => onEdit(kind, profile)} className="text-xs font-semibold text-blue-700 hover:underline">Edit</button>}
                 {profile.status !== 'Retired' && <button onClick={() => onStatus(kind, profile, 'Retired')} className="text-xs font-semibold text-stone-500 hover:underline">Retire</button>}
                {kind === 'max-tan' && profile.status === 'Approved' && !profile.is_default && <button onClick={() => onDefault(profile)} className="text-xs font-semibold text-blue-700 hover:underline">Make default</button>}
                 {profile.status === 'Draft' && <button onClick={() => onDelete(kind, profile)} className="text-xs font-semibold text-red-700 hover:underline">Delete</button>}
                <button onClick={() => onRevise(kind, profile)} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"><CopyPlus className="h-3 w-3" />New revision</button>
              </div></td>
            </tr>)}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

function badgeClass(tone: 'amber' | 'blue' | 'violet' | 'stone' | 'red') {
  return {
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-800',
    violet: 'bg-violet-100 text-violet-800',
    stone: 'bg-stone-100 text-stone-600',
    red: 'bg-red-100 text-red-800',
  }[tone];
}

function EvidenceBadge({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'blue' | 'violet' | 'stone' | 'red' }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeClass(tone)}`}>{children}</span>;
}

function EvidenceField({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-xs leading-5 text-stone-700">{value || 'Unknown / not supplied'}</dd>
    </div>
  );
}

const PROFILE_ADMIN_FALLBACK = '/admin/users';

function safeReturnPath(value: unknown, currentPath: string): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const destination = new URL(value, window.location.origin);
    if (destination.origin !== window.location.origin || `${destination.pathname}${destination.search}${destination.hash}` === currentPath) {
      return null;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

function EvidenceTable({ items, focused }: { items: any[]; focused: boolean }) {
  return (
    <section id="evidence-library" tabIndex={-1} className={`scroll-mt-6 overflow-hidden rounded-xl border bg-white outline-none ${
      focused ? 'border-blue-400 ring-2 ring-blue-100' : 'border-stone-200'
    }`}>
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-stone-700">Review-only VTR evidence library</h2>
        <p className="mt-1 text-xs text-stone-500">Published observations and candidate recommendations are traceable review material. They are not approved profiles and never appear in designer selectors.</p>
      </div>
      {items.length === 0 ? <p className="p-6 text-sm text-stone-400">No evidence records have been seeded.</p> : (
        <div className="divide-y divide-stone-100">
          {items.map(item => {
            const classification = String(item.evidence_classification || '');
            const candidate = item.record_type === 'Candidate Recommendation';
            const benchmark = classification.toLowerCase().includes('benchmark');
            const provisional = classification.toLowerCase().includes('provisional');
            return (
              <details key={item.id || `${item.evidence_code}-${item.revision}`} className="group">
                <summary className="cursor-pointer list-none px-5 py-4 hover:bg-stone-50">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-stone-800">{item.title}</div>
                      <div className="mt-0.5 font-mono text-xs text-stone-400">{item.evidence_code} · r{item.revision}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <EvidenceBadge tone="amber">{item.review_status || 'Review Needed'}</EvidenceBadge>
                        {candidate && <EvidenceBadge tone="blue">Candidate recommendation</EvidenceBadge>}
                        {benchmark && <EvidenceBadge tone="violet">Loading benchmark</EvidenceBadge>}
                        {provisional && <EvidenceBadge tone="violet">Provisional concept design</EvidenceBadge>}
                        {!item.promotable && <EvidenceBadge tone="red">Excluded from promotion</EvidenceBadge>}
                      </div>
                    </div>
                    <div className="max-w-sm text-right text-xs text-stone-500">
                      <div className="font-semibold text-stone-700">{item.published_benchmark_text || item.qualification}</div>
                      {item.recommended_value_text && <div className="mt-1 text-blue-700">Candidate value: {item.recommended_value_text} {item.recommended_value_unit || ''}</div>}
                      <div className="mt-2 font-medium text-blue-600 group-open:hidden">Show full evidence</div>
                      <div className="mt-2 hidden font-medium text-blue-600 group-open:block">Hide details</div>
                    </div>
                  </div>
                </summary>
                <div className="border-t border-stone-100 bg-stone-50/40 px-5 py-5">
                  <dl className="grid gap-x-6 gap-y-4 md:grid-cols-3">
                    <EvidenceField label="Classification" value={item.evidence_classification} />
                    <EvidenceField label="Candidate profile code" value={item.candidate_profile_code} />
                    <EvidenceField label="Source attribution" value={item.source_reference || item.source_citation} />
                    <EvidenceField label="Reactor identity" value={item.reactor_identity} />
                    <EvidenceField label="Reactor type" value={item.reactor_type} />
                    <EvidenceField label="Media identity" value={item.media_identity} />
                    <EvidenceField label="Water type" value={item.water_type} />
                    <EvidenceField label="Temperature condition" value={item.temperature_condition} />
                    <EvidenceField label="Salinity condition" value={item.salinity_condition} />
                    <EvidenceField label="TAN condition" value={item.tan_condition} />
                    <EvidenceField label="Media surface-area basis" value={item.media_ssa_m2_m3 ? `${item.media_ssa_m2_m3} m²/m³ — ${item.media_ssa_basis || ''}` : item.media_ssa_basis} />
                    <EvidenceField label="Observed metric and unit" value={`${item.observed_metric || 'Unknown'}${item.observed_unit ? ` — ${item.observed_unit}` : ''}`} />
                    <EvidenceField label="Required operating envelope" value={item.required_operating_envelope} />
                    <EvidenceField label="Intended use" value={item.intended_use} />
                    <EvidenceField label="Qualification" value={item.qualification} />
                    <EvidenceField label="Limitations" value={item.limitations} />
                    <EvidenceField label="Promotion boundary" value={item.promotion_exclusion_reason || (item.promotable ? 'Requires a separate controlled promotion workflow.' : 'Excluded from promotion.')} />
                    <EvidenceField label="Original source wording" value={item.source_text} />
                  </dl>
                  {!!item.observations?.length && <div className="mt-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Recorded observations</h3>
                    <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200 bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-400">
                          <tr><th className="px-3 py-2">Qualifier / condition</th><th className="px-3 py-2">Metric</th><th className="px-3 py-2">Supplied value</th><th className="px-3 py-2">Unit</th></tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {item.observations.map((observation: any) => (
                            <tr key={observation.id || observation.observation_code}>
                              <td className="px-3 py-2 text-stone-600">{observation.qualifier}{observation.condition_label ? ` · ${observation.condition_label}` : ''}</td>
                              <td className="px-3 py-2 text-stone-700">{observation.metric}</td>
                              <td className="px-3 py-2 font-mono text-stone-800">{observation.value_text || observation.value || 'Unknown'}</td>
                              <td className="px-3 py-2 text-stone-500">{observation.unit || 'Unknown'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>}
                  {!!item.linked_evidence?.length && <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    <strong>Linked source evidence:</strong> {item.linked_evidence.map((link: any) => `${link.linked_evidence_title} (${link.relationship})`).join('; ')}
                  </div>}
                  {item.curve_guidance && Object.keys(item.curve_guidance).length > 0 && <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50 px-3 py-3 text-xs text-violet-900">
                    <strong>Review-only curve guidance</strong>
                    <dl className="mt-2 grid gap-2 md:grid-cols-2">
                      {Object.entries(item.curve_guidance).map(([key, value]) => (
                        <div key={key}><dt className="font-semibold">{key.replace(/_/g, ' ')}</dt><dd>{String(value)}</dd></div>
                      ))}
                    </dl>
                  </div>}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function AdminBiologicalMediaProfiles() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const returnToRef = useRef<string | null>(
    safeReturnPath((location.state as { returnTo?: unknown } | null)?.returnTo, currentPath),
  );
  const requestedFocus = searchParams.get('focus');
  const focusedKind: AdminFocus | null = requestedFocus === 'tan' || requestedFocus === 'media' || requestedFocus === 'max-tan' || requestedFocus === 'evidence'
    ? requestedFocus : null;
  const [formKind, setFormKind] = useState<ProfileKind | null>(null);
  const [mediaForm, setMediaForm] = useState(mediaEmpty);
  const [tanForm, setTanForm] = useState(tanEmpty);
  const [maxTanForm, setMaxTanForm] = useState(maxTanEmpty);
  const [revisionSource, setRevisionSource] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!focusedKind) return;
    const element = document.getElementById(`${focusedKind}-profiles`);
    element?.scrollIntoView?.({ block: 'start' });
    element?.focus({ preventScroll: true });
  }, [focusedKind]);
  const { data: mediaData = { items: [] } } = useQuery({
    queryKey: ['biological-media-profiles', 'admin'],
    queryFn: () => api.get('/biological-media/media-profiles', { params: { include_retired: true } }).then(r => r.data),
  });
  const { data: tanData = { items: [] } } = useQuery({
    queryKey: ['tan-generation-profiles', 'admin'],
    queryFn: () => api.get('/biological-media/tan-profiles', { params: { include_retired: true } }).then(r => r.data),
  });
  const { data: maxTanData = { items: [] } } = useQuery({
    queryKey: ['maximum-tan-profiles', 'admin'],
    queryFn: () => api.get('/biological-media/max-tan-profiles', { params: { include_retired: true } }).then(r => r.data),
  });
  const { data: evidenceData = { items: [] } } = useQuery({
    queryKey: ['biological-media-evidence', 'admin'],
    queryFn: () => api.get('/biological-media/evidence').then(r => r.data),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['biological-media-profiles'] });
    qc.invalidateQueries({ queryKey: ['tan-generation-profiles'] });
    qc.invalidateQueries({ queryKey: ['maximum-tan-profiles'] });
    qc.invalidateQueries({ queryKey: ['biological-media-evidence'] });
  };
  const payloadFor = (kind: ProfileKind) => {
    const form = kind === 'media' ? mediaForm : kind === 'tan' ? tanForm : maxTanForm;
    if (kind === 'media') return {
      ...form,
      water_types: compatibilityValues(form.water_types),
      reactor_types: compatibilityValues(form.reactor_types),
      ...Object.fromEntries(['operating_min_temperature_c', 'operating_max_temperature_c', 'operating_min_salinity_ppt',
        'operating_max_salinity_ppt', 'media_min_depth_mm', 'media_max_depth_mm', 'media_void_fraction',
        'media_bulk_density_kg_m3', 'overall_vtr_g_tan_n_m3_d', 'default_safety_factor', 'minimum_media_m3',
        'module_increment_m3', 'media_fill_fraction', 'operating_min_ph', 'operating_max_ph',
        'operating_min_tan_mg_n_l', 'operating_max_tan_mg_n_l', 'operating_min_do_mg_l',
        'operating_max_do_mg_l', 'operating_min_flow_m3_h', 'operating_max_flow_m3_h'].map(key => [key, n(form[key])])),
    };
    if (kind === 'tan') return { ...form, coefficient: n(form.coefficient), scope_min: n(form.scope_min), scope_max: n(form.scope_max) };
    return { ...form, max_tan_mg_n_l: n(form.max_tan_mg_n_l) };
  };
  const create = async () => {
    if (!formKind) return;
    setSaving(true);
    setSaveError([]);
    try {
      const path = `/admin/biological-media/${formKind === 'media' ? 'media-profiles' : formKind === 'tan' ? 'tan-profiles' : 'max-tan-profiles'}`;
      if (editing && revisionSource) {
        const response = await api.patch(`${path}/${revisionSource.id}`, payloadFor(formKind));
        toast.success(revisionSource.status === 'In Review' && response.data?.status === 'Draft'
          ? 'Changes saved; revision returned to Draft for re-review'
          : 'Profile changes saved');
      } else {
        await api.post(revisionSource ? `${path}/${revisionSource.id}/revisions` : path, payloadFor(formKind));
        toast.success('Draft profile revision created');
      }
      setFormKind(null);
      setRevisionSource(null);
      setEditing(false);
      setMediaForm(mediaEmpty);
      setTanForm(tanEmpty);
      setMaxTanForm(maxTanEmpty);
      refresh();
    } catch (error: any) {
      const responseError = error?.response?.data?.error;
      const fields = Array.isArray(responseError?.fields) ? responseError.fields : [];
      setSaveError(fields.length ? fields : [responseError?.message || 'Profile revision could not be saved']);
      toast.error(responseError?.message || 'Profile revision could not be saved');
    } finally {
      setSaving(false);
    }
  };
  const changeStatus = async (kind: ProfileKind, profile: any, status: string) => {
    try {
      await api.patch(`/admin/biological-media/${kind === 'media' ? 'media-profiles' : kind === 'tan' ? 'tan-profiles' : 'max-tan-profiles'}/${profile.id}/status`, { status });
      toast.success(`Revision marked ${status}`);
      refresh();
    } catch (error: any) {
      const responseError = error?.response?.data?.error;
      if (status === 'Approved' && Array.isArray(responseError?.fields)) {
        openProfile(kind, profile, true);
        setSaveError(responseError.fields);
      }
      toast.error(responseError?.message || 'Status could not be changed');
    }
  };
  const openProfile = (kind: ProfileKind, profile: any, editExisting: boolean) => {
    setRevisionSource(profile);
    setEditing(editExisting);
    setSaveError([]);
    setFormKind(kind);
    if (kind === 'media') {
      setMediaForm({
        ...mediaEmpty,
        ...profile,
         water_types: compatibilityValues(profile.water_types),
         reactor_types: compatibilityValues(profile.reactor_types),
        capacity_model: profile.capacity_model ?? '',
        capacity_model_version: profile.capacity_model_version ?? '',
        capacity_basis_unit: profile.capacity_basis_unit ?? '',
        operating_min_temperature_c: profile.operating_min_temperature_c ?? '',
        operating_max_temperature_c: profile.operating_max_temperature_c ?? '',
        operating_min_salinity_ppt: profile.operating_min_salinity_ppt ?? '',
        operating_max_salinity_ppt: profile.operating_max_salinity_ppt ?? '',
        media_min_depth_mm: profile.media_min_depth_mm ?? '',
        media_max_depth_mm: profile.media_max_depth_mm ?? '',
        media_void_fraction: profile.media_void_fraction ?? '',
        media_bulk_density_kg_m3: profile.media_bulk_density_kg_m3 ?? '',
        overall_vtr_g_tan_n_m3_d: profile.overall_vtr_g_tan_n_m3_d ?? '',
        default_safety_factor: profile.default_safety_factor ?? '',
        minimum_media_m3: profile.minimum_media_m3 ?? '',
        module_increment_m3: profile.module_increment_m3 ?? '',
        media_fill_fraction: profile.media_fill_fraction ?? '',
        operating_min_ph: profile.operating_min_ph ?? '',
        operating_max_ph: profile.operating_max_ph ?? '',
        operating_min_tan_mg_n_l: profile.operating_min_tan_mg_n_l ?? '',
        operating_max_tan_mg_n_l: profile.operating_max_tan_mg_n_l ?? '',
        operating_min_do_mg_l: profile.operating_min_do_mg_l ?? '',
        operating_max_do_mg_l: profile.operating_max_do_mg_l ?? '',
        operating_min_flow_m3_h: profile.operating_min_flow_m3_h ?? '',
        operating_max_flow_m3_h: profile.operating_max_flow_m3_h ?? '',
        evidence_reference: profile.evidence_reference ?? '',
        provisional_label: profile.provisional_label ?? '',
        notes: profile.notes ?? '',
      });
    } else if (kind === 'tan') {
      setTanForm({
        ...tanEmpty,
        ...profile,
        coefficient: profile.coefficient ?? '',
        scope_min: profile.scope_min ?? '',
        scope_max: profile.scope_max ?? '',
        recommended_application: profile.recommended_application ?? '',
        scope_unit: profile.scope_unit ?? '',
        evidence_reference: profile.evidence_reference ?? '',
        notes: profile.notes ?? '',
      });
    } else {
      setMaxTanForm({
        ...maxTanEmpty,
        ...profile,
        max_tan_mg_n_l: profile.max_tan_mg_n_l ?? '',
        engineering_note: profile.engineering_note ?? '',
      });
    }
  };
  const revise = (kind: ProfileKind, profile: any) => openProfile(kind, profile, false);
  const editProfile = (kind: ProfileKind, profile: any) => openProfile(kind, profile, true);
  const startNew = (kind: ProfileKind) => {
    setFormKind(kind);
    setRevisionSource(null);
    setEditing(false);
    setSaveError([]);
    if (kind === 'media') setMediaForm(mediaEmpty);
    else if (kind === 'tan') setTanForm(tanEmpty);
    else setMaxTanForm(maxTanEmpty);
  };
  const makeDefault = async (profile: any) => {
    try {
      await api.patch(`/admin/biological-media/max-tan-profiles/${profile.id}/default`);
      toast.success('Default changed for future or incomplete cases only');
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Default profile could not be changed');
    }
  };
  const deleteProfile = async (kind: ProfileKind, profile: any) => {
    if (!window.confirm(`Delete draft revision "${profile.profile_name}"? This cannot be undone.`)) return;
    try {
      const path = kind === 'media' ? 'media-profiles' : kind === 'tan' ? 'tan-profiles' : 'max-tan-profiles';
      await api.delete(`/admin/biological-media/${path}/${profile.id}`);
      toast.success('Draft profile revision deleted');
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Profile revision could not be deleted');
    }
  };
  const goBack = () => navigate(returnToRef.current || PROFILE_ADMIN_FALLBACK, { replace: true });
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader title="Biological Media Profiles" subtitle="Controlled profiles plus a separate review-only VTR evidence library. Approval freezes engineering evidence and operating metadata."
        onBack={goBack}
        actions={<div className="flex flex-wrap gap-2"><Button onClick={() => startNew('max-tan')}><Plus className="h-3.5 w-3.5" />Maximum TAN profile</Button><Button onClick={() => startNew('tan')}><Plus className="h-3.5 w-3.5" />TAN-generation profile</Button><Button variant="primary" onClick={() => startNew('media')}><Plus className="h-3.5 w-3.5" />Media profile</Button></div>} />
      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <ShieldCheck className="h-5 w-5 shrink-0" /><p>Approved engineering values cannot be edited. Evidence records are unapproved review material and cannot be selected for sizing. Maximum TAN defaults are starting assumptions for future or incomplete cases only; changing the default never rewrites saved cases or immutable runs.</p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Profile type focus">
        {([['evidence', 'VTR evidence'], ['max-tan', 'Maximum TAN profiles'], ['tan', 'TAN-generation profiles'], ['media', 'Media profiles']] as const).map(([kind, label]) => (
          <button key={kind} type="button" onClick={() => setSearchParams({ focus: kind })}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${focusedKind === kind ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-stone-200 bg-white text-stone-600'}`}>
            {label}
          </button>
        ))}
        {focusedKind && <button type="button" onClick={() => setSearchParams({})} className="px-3 py-2 text-xs font-semibold text-stone-500">Show both</button>}
      </div>
      {formKind && <ProfileForm kind={formKind} form={formKind === 'media' ? mediaForm : formKind === 'tan' ? tanForm : maxTanForm}
        setForm={formKind === 'media' ? setMediaForm : formKind === 'tan' ? setTanForm : setMaxTanForm} onSave={create}
        onCancel={() => { setFormKind(null); setRevisionSource(null); setEditing(false); setSaveError([]); }} saving={saving}
        revising={!!revisionSource && !editing} editing={editing} saveError={saveError} />}
       {(!focusedKind || focusedKind === 'evidence') && <EvidenceTable items={evidenceData.items || []} focused={focusedKind === 'evidence'} />}
       {(!focusedKind || focusedKind === 'max-tan') && <ProfilesTable id="max-tan-profiles" title="Controlled Maximum TAN concentration profiles" profiles={maxTanData.items || []} kind="max-tan" focused={focusedKind === 'max-tan'} onStatus={changeStatus} onEdit={editProfile} onRevise={revise} onDefault={makeDefault} onDelete={deleteProfile} />}
       {(!focusedKind || focusedKind === 'tan') && <ProfilesTable id="tan-profiles" title="Controlled TAN generation profiles" profiles={tanData.items || []} kind="tan" focused={focusedKind === 'tan'} onStatus={changeStatus} onEdit={editProfile} onRevise={revise} onDelete={deleteProfile} />}
       {(!focusedKind || focusedKind === 'media') && <ProfilesTable id="media-profiles" title="Controlled media profiles" profiles={mediaData.items || []} kind="media" focused={focusedKind === 'media'} onStatus={changeStatus} onEdit={editProfile} onRevise={revise} onDelete={deleteProfile} />}
      <div className="sr-only"><Activity />Biological media administration</div>
    </div>
  );
}