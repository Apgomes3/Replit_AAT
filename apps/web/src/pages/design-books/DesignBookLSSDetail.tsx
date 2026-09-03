import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../lib/api';
import StatusBadge from '../../components/ui/StatusBadge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import {
  ChevronRight, Activity, Pencil, Save, X, Plus, Trash2,
  Waves, Gauge, GitBranch, Settings2, AlertCircle, Check,
  Droplets, ArrowLeft, Route, FlaskConical, Wind,
  Layers, Package, ExternalLink, Zap, Weight, Maximize2, LockKeyhole,
  MoreHorizontal, FileDown, GitCompare, Archive, GitFork,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import {
  calculateFoamFractionatorSizingRecommendation,
  FOAM_PROCESS_RATE_SLIDER_MAX,
  FOAM_PROCESS_RATE_SLIDER_MIN,
  FOAM_RECOMMENDED_PROCESS_RATE_LS_M2,
  calculateSandFilterSizingRecommendation,
  SAND_FILTER_PROCESS_RATE_SLIDER_MAX,
  SAND_FILTER_PROCESS_RATE_SLIDER_MIN,
  SAND_FILTER_RECOMMENDED_PROCESS_RATE_LS_M2,
} from './foamFractionatorSizing';
import { summarizeFiltration } from './LSSCompactUnitsCatalog';
import LSSPumpSelectionPanel from './LSSPumpSelectionPanel';
import NewRevisionModal from './NewRevisionModal';

const SYSTEM_TYPES = [
  'Life Support', 'Filtration', 'Circulation', 'UV Sterilization',
  'Ozone', 'Heating', 'Chilling', 'Skimming', 'Carbon Dosing',
  'Denitrification', 'Other',
];
const WATER_TYPES = ['Marine', 'Freshwater', 'Brackish', 'Salt Water', 'Blackwater'];
const STATUSES   = ['Draft', 'Design', 'For Review', 'Approved', 'Active', 'Released'];
const isLssType = (value: unknown) => {
  const type = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return type === 'lss'
    || /(^|[^a-z])lss([^a-z]|$)/.test(type)
    || type === 'life support'
    || type.startsWith('life support ');
};
const LINK_TYPES = ['Primary', 'Secondary', 'Emergency', 'Backup', 'Observation', 'Redundant'];
const FLOW_ROUTE_VIEW_STORAGE_KEY = 'lss-flow-route-view';
type FlowViewMode = 'card' | 'list';
type LssTab = 'overview' | 'flow' | 'pump' | 'biological-media' | 'uv' | 'thermal' | 'ozone' | 'other';

const LSS_TABS: Array<{ id: LssTab; label: string }> = [
  { id: 'overview', label: 'System Overview' },
  { id: 'flow', label: 'Flow Route' },
  { id: 'pump', label: 'Pump Selection' },
  { id: 'biological-media', label: 'Biological Media' },
  { id: 'uv', label: 'UV Selection' },
  { id: 'thermal', label: 'Thermal Selection' },
  { id: 'ozone', label: 'Ozone Selection' },
  { id: 'other', label: 'Other Equipment' },
];

type FlowSourceOption = {
  value: string;
  label: string;
  description: string;
};

const FLOW_SOURCE_GROUPS: ReadonlyArray<{
  label: string;
  options: ReadonlyArray<FlowSourceOption>;
}> = [
  {
    label: 'Exhibit intake',
    options: [
      { value: 'Bottom Drain', label: 'Bottom Drain', description: 'Water enters from the exhibit bottom drain.' },
      { value: 'Surface Skim', label: 'Surface Skim', description: 'Water enters through the surface skimmer.' },
      { value: 'Both Integrated', label: 'Both Integrated', description: 'A combined bottom-drain and surface-skimmer return.' },
    ],
  },
  {
    label: 'Dedicated equipment',
    options: [
      { value: 'Vacuum Port', label: 'Vacuum Port', description: 'A dedicated vacuum-service connection.' },
    ],
  },
  {
    label: 'Circulation connections',
    options: [
      { value: 'Break Tank', label: 'Break Tank', description: 'A break-tank circulation connection.' },
      { value: 'Plenum Tank', label: 'Plenum Tank', description: 'A plenum-tank circulation connection.' },
    ],
  },
] as const;
const FLOW_SOURCES = FLOW_SOURCE_GROUPS.flatMap(group => group.options.map(option => option.value));
const CIRCULATION_SOURCES = new Set(['Break Tank', 'Plenum Tank']);

function FlowSourcePicker({
  value,
  onChange,
  disabled = false,
  id,
  compact = false,
  ariaLabel = 'Flow Source',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id: string;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const selected = FLOW_SOURCE_GROUPS
    .flatMap(group => group.options)
    .find(option => option.value === value);
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <label htmlFor={id} className="block text-xs font-medium text-stone-500">
        Flow Source
      </label>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className={`w-full rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/40 ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-2'
        }`}
      >
        <option value="">— Choose a source —</option>
        {FLOW_SOURCE_GROUPS.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </optgroup>
        ))}
        {/* Keep previously saved values visible and editable if they predate the governed list. */}
        {value && !FLOW_SOURCES.includes(value as any) && (
          <option value={value}>{value} (saved value)</option>
        )}
      </select>
      {selected && <p className="text-[10px] leading-snug text-stone-400">{selected.description}</p>}
    </div>
  );
}

function isLssTab(value: string | null): value is LssTab {
  return LSS_TABS.some(tab => tab.id === value);
}

function buildFrozenUvSelectionData(book: any, systemId: string | undefined) {
  const system = (book?.systems || []).find((item: any) => item.id === systemId);
  const selection = (book?.uv_selections || []).find((item: any) => item.system_id === systemId);
  const sideStreams = (system?.side_streams || []).filter((stream: any) => stream.preset === 'UV');
  const inputStreams = selection?.input_snapshot?.streams || [];
  const resultStreams = selection?.result_snapshot?.streams || [];
  const streams = (inputStreams.length ? inputStreams : sideStreams).map((input: any) => {
    const sideStream = sideStreams.find((stream: any) => stream.id === input.side_stream_id);
    const result = resultStreams.find((stream: any) => stream.side_stream_id === input.side_stream_id);
    return {
      id: input.side_stream_id || sideStream?.id,
      parent_loop_number: sideStream?.parent_loop_number ?? null,
      name: sideStream?.name || input.side_stream_name || result?.side_stream_name || 'UV stream',
      preset: sideStream?.preset || 'UV',
      flow_pct: sideStream?.flow_pct ?? null,
      notes: sideStream?.notes ?? null,
      sort_order: sideStream?.sort_order ?? 0,
      uv_revision_id: input.uv_revision_id
        || sideStream?.uv_revision_id
        || result?.uv_revision_id
        || null,
      uv_unit_quantity: input.uv_unit_quantity
        ?? sideStream?.uv_unit_quantity
        ?? result?.unit_quantity
        ?? null,
      uvt_basis: input.uvt_basis
        || result?.selected_uvt_basis
        || sideStream?.uvt_basis
        || '85T',
      uv_revision: input.uv_revision_id || result?.uv_revision_id ? {
        id: input.uv_revision_id || result?.uv_revision_id,
        product_master_id: input.product_master_id || result?.product_master_id || sideStream?.uv_revision?.product_master_id || null,
        revision_number: input.engineering_revision_number ?? sideStream?.uv_revision?.revision_number ?? null,
        product_code: input.product_code || result?.product_code || sideStream?.uv_revision?.product_code || null,
        product_name: input.product_name || result?.product_name || sideStream?.uv_revision?.product_name || null,
        manufacturer: input.manufacturer || result?.manufacturer || sideStream?.uv_revision?.manufacturer || null,
        material_code: input.material_code || result?.material_code || sideStream?.uv_revision?.material_code || null,
        rated_power_kw: input.rated_power_kw ?? result?.rated_power_kw ?? sideStream?.uv_revision?.rated_power_kw ?? null,
        lamp_count: input.lamp_count ?? result?.lamp_count ?? sideStream?.uv_revision?.lamp_count ?? null,
        lamp_power_w: input.lamp_power_w ?? result?.lamp_power_w ?? sideStream?.uv_revision?.lamp_power_w ?? null,
        effective_reactor_volume_l: input.effective_reactor_volume_l
          ?? result?.effective_reactor_volume_l
          ?? sideStream?.uv_revision?.effective_reactor_volume_l
          ?? null,
        irradiance_85t_mw_cm2: input.irradiance_85t_mw_cm2
          ?? result?.irradiance_85t_mw_cm2
          ?? sideStream?.uv_revision?.irradiance_85t_mw_cm2
          ?? null,
        irradiance_95t_mw_cm2: input.irradiance_95t_mw_cm2
          ?? result?.irradiance_95t_mw_cm2
          ?? sideStream?.uv_revision?.irradiance_95t_mw_cm2
          ?? null,
        compatibility: input.compatibility || result?.compatibility || sideStream?.uv_revision?.compatibility || null,
        source_basis: input.source_basis || result?.source_basis || sideStream?.uv_revision?.source_basis || null,
        source_evidence: input.source_evidence || result?.source_evidence || sideStream?.uv_revision?.source_evidence || null,
      } : null,
      frozen_flow_m3h: input.flow_m3h ?? result?.flow_m3h ?? null,
    };
  });

  return {
    streams,
    selectable_revisions: [],
    saved: selection ? {
      id: selection.id,
      target_fluence_mj_cm2: Number(selection.target_fluence_mj_cm2),
      calculation_version: selection.calculation_version,
      freshness: selection.freshness,
      calculated_at: selection.calculated_at,
      result_snapshot: selection.result_snapshot || null,
      input_snapshot: selection.input_snapshot || null,
    } : null,
  };
}

function EquipmentEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-5 py-14 text-center">
      <Settings2 className="mx-auto mb-3 h-8 w-8 text-stone-200" />
      <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-stone-400">{description}</p>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-300">Not configured</p>
    </div>
  );
}

function BiologicalMediaPanel({
  data,
  mediaProfiles,
  tanProfiles,
  readOnly,
  form,
  onChange,
  onSave,
  saving,
  error,
}: {
  data: any;
  mediaProfiles: any[];
  tanProfiles: any[];
  readOnly: boolean;
  form: any;
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
  error?: string | null;
}) {
  const readiness = data?.readiness_status || 'Incomplete';
  const context = data?.context;
  const missing = data?.input_completeness?.missing || [];
  const approvedMedia = mediaProfiles.filter(profile => profile.status === 'Approved');
  const approvedTan = tanProfiles.filter(profile => profile.status === 'Approved');
  const selectedMediaMissing = data?.case?.media_profile_revision_id
    && !approvedMedia.some(profile => profile.id === data.case.media_profile_revision_id);
  const selectedTanMissing = data?.case?.tan_generation_profile_revision_id
    && !approvedTan.some(profile => profile.id === data.case.tan_generation_profile_revision_id);
  const statusStyles: Record<string, string> = {
    Draft: 'border-blue-200 bg-blue-50 text-blue-800',
    Incomplete: 'border-amber-200 bg-amber-50 text-amber-800',
    Blocked: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div id="biological-media" className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Biological Media context could not be loaded: {error}
        </div>
      )}
      <div className={`rounded-xl border px-5 py-4 ${statusStyles[readiness] || statusStyles.Incomplete}`}>
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Biological Media foundation</h2>
              <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs font-semibold">{readiness}</span>
            </div>
            <p className="mt-1 text-sm opacity-80">
              This foundation prepares controlled reference inputs only. No biological-filter sizing result is calculated here.
            </p>
            {missing.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                {missing.map((reason: string) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            {context?.reasons?.map((reason: string) => (
              <p key={reason} className="mt-2 text-xs font-medium">{reason}</p>
            ))}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-stone-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-stone-700">Current linked-exhibit water context</h2>
            <p className="mt-0.5 text-xs text-stone-400">Read-only reference from the current exhibit calculations; it is not copied into this draft.</p>
          </div>
          <Droplets className="h-5 w-5 text-cyan-500" />
        </div>
        <div className="p-5">
          <div className="mb-4 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-stone-800">
              {context?.total_operating_volume_m3 != null ? Number(context.total_operating_volume_m3).toFixed(4) : '—'}
            </span>
            <span className="text-sm text-stone-500">m³ total effective operating volume</span>
          </div>
          {(context?.linked_exhibits || []).length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-stone-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-400">
                  <tr><th className="px-3 py-2">Exhibit</th><th className="px-3 py-2">Water type</th><th className="px-3 py-2 text-right">Effective volume</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {context.linked_exhibits.map((exhibit: any) => (
                    <tr key={exhibit.exhibit_id}>
                      <td className="px-3 py-2 font-medium text-stone-700">{exhibit.exhibit_code} — {exhibit.exhibit_name}</td>
                      <td className="px-3 py-2 text-stone-500">{exhibit.water_type || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-stone-700">
                        {exhibit.operating_volume_m3 != null ? `${Number(exhibit.operating_volume_m3).toFixed(4)} m³` : 'Unavailable'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-stone-400">No linked exhibits are available for this system.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white overflow-hidden">
        <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-stone-700">Biological media draft inputs</h2>
          <p className="mt-0.5 text-xs text-stone-400">Selections are readiness references only and do not alter system hydraulics, Flow Route, or exhibit calculations.</p>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-3">
          <label className="text-xs font-medium text-stone-500">
            Reactor type
            <input value={form.reactor_type} onChange={event => onChange('reactor_type', event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-normal text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              placeholder="e.g. Moving bed biofilter" />
          </label>
          <label className="text-xs font-medium text-stone-500">
            Approved media profile revision
            <select value={form.media_profile_revision_id} onChange={event => onChange('media_profile_revision_id', event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-normal text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40">
              <option value="">— Select approved revision —</option>
              {selectedMediaMissing && <option value={data.case.media_profile_revision_id} disabled>
                {data.case.media_profile_code || 'Selected media profile'} r{data.case.media_profile_revision || '—'} — {data.case.media_profile_status || 'Unavailable'}
              </option>}
              {approvedMedia.map(profile => <option key={profile.id} value={profile.id}>{profile.profile_code} r{profile.revision} — {profile.profile_name}</option>)}
            </select>
            {approvedMedia.length === 0 && <span className="mt-1 block font-normal text-amber-700">No approved media profile revisions are available.</span>}
          </label>
          <label className="text-xs font-medium text-stone-500">
            Approved TAN profile revision
            <select value={form.tan_generation_profile_revision_id} onChange={event => onChange('tan_generation_profile_revision_id', event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-normal text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40">
              <option value="">— Select approved revision —</option>
              {selectedTanMissing && <option value={data.case.tan_generation_profile_revision_id} disabled>
                {data.case.tan_profile_code || 'Selected TAN profile'} r{data.case.tan_profile_revision || '—'} — {data.case.tan_profile_status || 'Unavailable'}
              </option>}
              {approvedTan.map(profile => <option key={profile.id} value={profile.id}>{profile.profile_code} r{profile.revision} — {profile.profile_name}</option>)}
            </select>
            {approvedTan.length === 0 && <span className="mt-1 block font-normal text-amber-700">No approved TAN profile revisions are available.</span>}
          </label>
          <label className="text-xs font-medium text-stone-500 md:col-span-3">
            Design basis notes
            <textarea value={form.notes} onChange={event => onChange('notes', event.target.value)} rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-stone-200 px-3 py-2 text-sm font-normal text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              placeholder="Engineering context or constraints for the later sizing phase…" />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-stone-100 bg-stone-50/40 px-5 py-3">
          <p className="text-xs text-stone-400">{data?.case?.updated_at ? `Last saved ${new Date(data.case.updated_at).toLocaleString()}` : 'No draft saved yet.'}</p>
          {!readOnly && <button type="button" onClick={onSave} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : data?.case ? 'Save draft' : 'Create draft'}
          </button>}
        </div>
      </section>
    </div>
  );
}

const bioInputClass = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-normal text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-400';

function ManagedBiologicalProfileSelect({
  kind, label, value, options, historical, disabled, onChange,
}: {
  kind: 'tan' | 'media';
  label: string;
  value: string;
  options: any[];
  historical?: { id: string; label: string } | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const isAdmin = useAuthStore(state => state.user?.role === 'admin');
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedRevision = value || historical?.id || '';
  const focusId = kind === 'tan' ? 'tan-profiles' : 'media-profiles';
  const manageLabel = kind === 'tan' ? 'Manage TAN profiles' : 'Manage media profiles';
  const destination = `/admin/biological-media-profiles?focus=${kind}${selectedRevision ? `&revision=${encodeURIComponent(selectedRevision)}` : ''}#${focusId}`;
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  return (
    <label className="relative block text-xs font-medium text-stone-500">
      {label}
      <select
        aria-label={label.replace(' *', '')}
        className={bioInputClass}
        disabled={disabled}
        value={value}
        onChange={event => onChange(event.target.value)}
        onContextMenu={event => {
          if (!isAdmin) return;
          event.preventDefault();
          setMenuOpen(true);
        }}
      >
        <option value="">Select approved revision</option>
        {historical && !options.some(option => option.id === historical.id) && (
          <option value={historical.id} disabled>{historical.label}</option>
        )}
        {options.map(profile => (
          <option key={profile.id} value={profile.id}>{profile.profile_code} r{profile.revision} — {profile.profile_name}</option>
        ))}
      </select>
      {options.length === 0 && (
        <span className="mt-1 block font-normal text-amber-700">
          No approved compatible {kind === 'tan' ? 'TAN' : 'overall-VTR media'} revision is available.
        </span>
      )}
      {isAdmin && <Link to={destination} state={{ returnTo }} className="mt-1 inline-flex font-semibold text-blue-600 hover:underline">{manageLabel}</Link>}
      {isAdmin && menuOpen && (
        <button type="button" role="menuitem" onClick={() => navigate(destination, { state: { returnTo } })}
          className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 shadow-lg">
          {manageLabel}
        </button>
      )}
    </label>
  );
}
const bioNumber = (value: any) => value === '' || value == null ? null : Number(value);
const bioFormat = (value: any, decimals = 4) => value == null || !Number.isFinite(Number(value))
  ? '—' : Number(value).toFixed(decimals);

export function BiologicalMediaCalculatorPanel({
  data, mediaProfiles, tanProfiles, maxTanProfiles, speciesCatalog, readOnly, form, onChange,
  onSave, onPreview, onCreateRun, onApproveRun, onRejectRun, onExportRun,
  onCompareRuns, saving, previewing, runBusy, comparison, error,
}: any) {
  const context = data?.context;
  const preview = data?.preview;
  const stale = Boolean(form._stale || preview?.is_stale);
  const normalizedWaterType = String(context?.system_water_type || '').toLowerCase();
  const normalizedReactorType = String(form.reactor_type || '').toLowerCase();
  const approvedMedia = mediaProfiles.filter((profile: any) =>
    profile.status === 'Approved'
    && (!normalizedWaterType || (profile.water_types || []).some((value: string) =>
      ['universal', normalizedWaterType].includes(value.toLowerCase())))
    && (!normalizedReactorType || (profile.reactor_types || []).some((value: string) => value.toLowerCase() === normalizedReactorType)));
  const approvedTan = tanProfiles.filter((profile: any) =>
    profile.status === 'Approved' && profile.coefficient_unit === 'kg TAN-N/kg feed protein');
  const approvedMaxTan = maxTanProfiles.filter((profile: any) => profile.status === 'Approved');
  const status = stale && preview ? 'Draft' : preview?.status_label || data?.readiness_status || 'Draft';
  const statusStyles: Record<string, string> = {
    Draft: 'border-blue-200 bg-blue-50 text-blue-800',
    Incomplete: 'border-amber-200 bg-amber-50 text-amber-800',
    Blocked: 'border-red-200 bg-red-50 text-red-800',
    'Valid with Warnings': 'border-amber-200 bg-amber-50 text-amber-800',
    Valid: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  const set = (key: string, value: any) => onChange(key, value);
  const rows = form.species_rows || [];
  const runs = data?.runs || [];
  const latestRun = data?.latest_run || runs[0] || null;
  const latestRunStale = Boolean(latestRun && (latestRun.is_stale || form._stale));
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  const [warningAcknowledgement, setWarningAcknowledgement] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [compareLeft, setCompareLeft] = useState('');
  const [compareRight, setCompareRight] = useState('');
  const setRows = (next: any[]) => set('species_rows', next);
  const selectedProfile = approvedMedia.find((profile: any) => profile.id === form.media_profile_revision_id);
  const selectedMaxTanProfile = approvedMaxTan.find((profile: any) => profile.id === form.max_tan_profile_revision_id)
    || (data?.case?.max_tan_profile_revision_id === form.max_tan_profile_revision_id ? data.case : null);
  const calculatedBiomass = form.biomass_method === 'VOLUME_DENSITY'
    ? Number(context?.total_operating_volume_m3 || 0) * Number(form.stocking_density_kg_m3 || 0)
    : rows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0) * Number(row.design_weight_kg || 0), 0);

  const updateSpecies = (index: number, key: string, value: any) => {
    const next = rows.map((row: any, rowIndex: number) => rowIndex === index ? { ...row, [key]: value } : row);
    setRows(next);
  };
  const selectCatalogSpecies = (index: number, id: string) => {
    const catalog = speciesCatalog.find((item: any) => item.id === id);
    if (!catalog) return updateSpecies(index, 'species_profile_id', '');
    const next = rows.map((row: any, rowIndex: number) => rowIndex === index ? {
      ...row,
      species_profile_id: catalog.id,
      common_name_snapshot: catalog.common_name || catalog.scientific_name,
      scientific_name_snapshot: catalog.scientific_name,
      design_weight_kg: row.design_weight_kg || catalog.reference_average_mass_kg || '',
      entered_weight_kg: row.entered_weight_kg || catalog.reference_average_mass_kg || '',
    } : row);
    setRows(next);
  };

  return <div id="biological-media" className="space-y-5">
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Biological Media context could not be loaded: {error}</div>}
    <div className={`rounded-xl border px-5 py-4 ${statusStyles[status] || statusStyles.Incomplete}`}>
      <div className="flex items-start gap-3">
        <Activity className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Biological Media foundation</h2>
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs font-semibold">{status}</span>
            {stale && preview && <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">Preview stale</span>}
          </div>
          <p className="mt-1 text-sm opacity-80">
            {preview
              ? 'Deterministic concept-sizing preview only. This is not a certified calculation run or detailed hydraulic design.'
              : 'No biological-filter sizing result is calculated here until the draft is complete and Calculate preview is selected.'}
          </p>
          {stale && preview && <p className="mt-2 text-xs font-medium">RUN_W01 — Inputs changed after the displayed preview. Recalculate before relying on it.</p>}
          {(data?.input_completeness?.missing || []).map((reason: string) => <p key={reason} className="mt-1 text-xs">{reason}</p>)}
        </div>
      </div>
    </div>

    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-stone-700">Current calculation run</h2>
          <p className="mt-0.5 text-xs text-stone-400">Approval authorizes this frozen evidence snapshot; it never recalculates the result.</p>
        </div>
        {!readOnly && preview && !stale && preview.status !== 'BLOCKED' &&
          <button type="button" onClick={onCreateRun} disabled={runBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <LockKeyhole className="h-3.5 w-3.5" />{runBusy === 'create' ? 'Creating run…' : 'Create frozen run'}
          </button>}
      </div>
      <div className="p-5">
        {!latestRun ? <div className="rounded-lg border border-dashed border-stone-200 px-4 py-6 text-center">
          <p className="text-sm font-medium text-stone-600">No calculation run has been created.</p>
          <p className="mt-1 text-xs text-stone-400">Save and calculate a current, unblocked preview before freezing a reviewable run.</p>
        </div> : <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-stone-800">Run {latestRun.run_number}</strong>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  latestRun.status === 'Approved' ? 'bg-emerald-100 text-emerald-800'
                    : latestRun.status === 'Rejected' ? 'bg-red-100 text-red-800'
                      : 'bg-blue-100 text-blue-800'
                }`}>{latestRun.status}</span>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">{latestRun.calculation_status?.replaceAll('_', ' ')}</span>
                {latestRunStale && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Draft changed — run is historical</span>}
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {latestRun.media_profile_snapshot?.profile_code || 'Media profile'} r{latestRun.media_profile_snapshot?.revision ?? '—'}
                {' · '}{latestRun.engine_version}{' · '}
                {latestRun.executed_at ? new Date(latestRun.executed_at).toLocaleString() : 'Execution time unavailable'}
              </p>
            </div>
            <button type="button" onClick={() => onExportRun(latestRun)} disabled={runBusy === latestRun.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50">
              <FileDown className="h-3.5 w-3.5" />Export immutable summary
            </button>
          </div>
          {latestRun.status === 'Pending Review' && !readOnly && <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
            {latestRun.calculation_status === 'VALID_WITH_WARNINGS' && !latestRun.warning_acknowledged && <>
              <label className="flex items-start gap-2 text-xs font-medium text-amber-800">
                <input type="checkbox" checked={warningAcknowledged} onChange={event => setWarningAcknowledged(event.target.checked)} />
                I reviewed the warnings frozen in this run and acknowledge them for engineering approval.
              </label>
              <textarea aria-label="Warning acknowledgement" rows={2} value={warningAcknowledgement}
                onChange={event => setWarningAcknowledgement(event.target.value)}
                className={`${bioInputClass} mt-2`} placeholder="Record the warning review and acceptance basis…" />
            </>}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <button type="button" disabled={Boolean(runBusy)
                || (latestRun.calculation_status === 'VALID_WITH_WARNINGS'
                  && !latestRun.warning_acknowledged && (!warningAcknowledged || !warningAcknowledgement.trim()))}
                onClick={() => onApproveRun(latestRun, warningAcknowledged, warningAcknowledgement)}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                Approve frozen run
              </button>
              <label className="min-w-[16rem] flex-1 text-xs text-stone-500">Rejection reason
                <input value={rejectionReason} onChange={event => setRejectionReason(event.target.value)}
                  className={bioInputClass} placeholder="Required to reject" />
              </label>
              <button type="button" disabled={Boolean(runBusy) || !rejectionReason.trim()}
                onClick={() => onRejectRun(latestRun, rejectionReason)}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">
                Reject run
              </button>
            </div>
          </div>}
        </div>}
      </div>
    </section>

    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-stone-700">Current linked-exhibit water context</h2>
        <p className="mt-0.5 text-xs text-stone-400">Read-only current effective operating volume. Frozen Design Books use their captured package values.</p>
      </div>
      <div className="p-5">
        <div className="mb-4 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold text-stone-800">{bioFormat(context?.total_operating_volume_m3, 4)}</span>
          <span className="text-sm text-stone-500">m³ total effective operating volume</span>
        </div>
        {(context?.linked_exhibits || []).length ? <div className="overflow-x-auto rounded-lg border border-stone-100">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-400"><tr><th className="px-3 py-2">Exhibit</th><th className="px-3 py-2">Water type</th><th className="px-3 py-2 text-right">Effective volume</th></tr></thead>
            <tbody className="divide-y divide-stone-100">{context.linked_exhibits.map((exhibit: any) =>
              <tr key={exhibit.exhibit_id}><td className="px-3 py-2 font-medium text-stone-700">{exhibit.exhibit_code} — {exhibit.exhibit_name}</td><td className="px-3 py-2 text-stone-500">{exhibit.water_type || '—'}</td><td className="px-3 py-2 text-right font-mono">{bioFormat(exhibit.operating_volume_m3, 4)} m³</td></tr>)}</tbody>
          </table>
        </div> : <p className="text-sm text-stone-400">No linked exhibits are available for this system.</p>}
      </div>
    </section>

    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-stone-700">1. Biomass design basis</h2>
        <p className="mt-0.5 text-xs text-stone-400">Choose exactly one method. Linked water volume remains read-only.</p>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid gap-3 md:grid-cols-2">
          {[['VOLUME_DENSITY', 'Volume and stocking density', 'Linked volume × target stocking density'], ['SPECIES_LIST', 'Species list', 'Quantity × editable design weight for each row']].map(([value, label, description]) =>
            <label key={value} className={`cursor-pointer rounded-xl border p-4 ${form.biomass_method === value ? 'border-blue-400 bg-blue-50' : 'border-stone-200'}`}>
              <span className="flex items-start gap-3"><input type="radio" name="biomass-method" value={value} checked={form.biomass_method === value} disabled={readOnly} onChange={() => set('biomass_method', value)} />
                <span><span className="block text-sm font-semibold text-stone-800">{label}</span><span className="mt-1 block text-xs text-stone-500">{description}</span></span>
              </span>
            </label>)}
        </div>
        {form.biomass_method === 'VOLUME_DENSITY' && <div className="grid gap-4 md:grid-cols-3">
          <label className="text-xs font-medium text-stone-500">Linked water volume m³<input className={bioInputClass} disabled value={context?.total_operating_volume_m3 ?? ''} /></label>
          <label className="text-xs font-medium text-stone-500">Stocking density kg/m³ *<input aria-label="Stocking density kg/m³" type="number" min="0" step="any" className={bioInputClass} disabled={readOnly} value={form.stocking_density_kg_m3} onChange={e => set('stocking_density_kg_m3', e.target.value)} /></label>
          <div className="rounded-lg bg-stone-50 p-3"><span className="text-xs text-stone-400">Design biomass</span><strong className="mt-1 block font-mono text-lg text-stone-800">{calculatedBiomass > 0 ? bioFormat(calculatedBiomass, 6) : '—'} kg</strong></div>
        </div>}
        {form.biomass_method === 'SPECIES_LIST' && <div className="space-y-3">
          {rows.map((row: any, index: number) => <div key={row.id || index} className="rounded-xl border border-stone-200 p-4">
            <div className="grid gap-3 md:grid-cols-6">
              <label className="text-xs text-stone-500 md:col-span-2">Catalog species
                <select className={bioInputClass} disabled={readOnly} value={row.species_profile_id || ''} onChange={e => selectCatalogSpecies(index, e.target.value)}>
                  <option value="">Free text / unlisted</option>{speciesCatalog.map((item: any) => <option key={item.id} value={item.id}>{item.common_name || item.scientific_name}</option>)}
                </select>
              </label>
              <label className="text-xs text-stone-500 md:col-span-2">Entered name snapshot *<input className={bioInputClass} disabled={readOnly} value={row.common_name_snapshot || ''} onChange={e => updateSpecies(index, 'common_name_snapshot', e.target.value)} /></label>
              <label className="text-xs text-stone-500">Life stage<input className={bioInputClass} disabled={readOnly} value={row.life_stage || ''} onChange={e => updateSpecies(index, 'life_stage', e.target.value)} /></label>
              {!readOnly && <button type="button" aria-label={`Remove species row ${index + 1}`} onClick={() => setRows(rows.filter((_: any, rowIndex: number) => rowIndex !== index))} className="self-end justify-self-end rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
              <label className="text-xs text-stone-500">Quantity *<input type="number" min="1" step="1" className={bioInputClass} disabled={readOnly} value={row.quantity ?? ''} onChange={e => updateSpecies(index, 'quantity', e.target.value)} /></label>
              <label className="text-xs text-stone-500">Design weight kg *<input type="number" min="0" step="any" className={bioInputClass} disabled={readOnly} value={row.design_weight_kg ?? ''} onChange={e => { updateSpecies(index, 'design_weight_kg', e.target.value); }} /></label>
              <div className="self-end rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">Row biomass <strong className="block font-mono text-stone-800">{bioFormat(Number(row.quantity || 0) * Number(row.design_weight_kg || 0), 4)} kg</strong></div>
              <label className="text-xs text-stone-500 md:col-span-3">Notes / weight source<input className={bioInputClass} disabled={readOnly} value={row.notes || ''} onChange={e => updateSpecies(index, 'notes', e.target.value)} /></label>
            </div>
          </div>)}
          {!readOnly && <button type="button" onClick={() => setRows([...rows, { common_name_snapshot: '', scientific_name_snapshot: '', life_stage: '', quantity: '', design_weight_kg: '', entered_weight_kg: '', notes: '' }])} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50"><Plus className="h-3.5 w-3.5" />Add species row</button>}
          <div className="text-sm text-stone-600">Total design biomass <strong className="font-mono text-stone-900">{calculatedBiomass > 0 ? bioFormat(calculatedBiomass, 6) : '—'} kg</strong>{context?.total_operating_volume_m3 > 0 && calculatedBiomass > 0 ? ` · Equivalent density ${bioFormat(calculatedBiomass / context.total_operating_volume_m3, 4)} kg/m³` : ''}</div>
        </div>}
      </div>
    </section>

    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5"><h2 className="text-sm font-semibold text-stone-700">2. Global feeding and TAN nitrogen</h2><p className="mt-0.5 text-xs text-stone-400">Manual feed is comparison-only and is never added to the calculated load.</p></div>
      <div className="grid gap-4 p-5 md:grid-cols-4">
        <label className="text-xs font-medium text-stone-500">Feed rate % biomass/day *<input type="number" min="0" step="any" className={bioInputClass} disabled={readOnly} value={form.feed_rate_pct_biomass_day} onChange={e => set('feed_rate_pct_biomass_day', e.target.value)} /></label>
        <label className="text-xs font-medium text-stone-500">Protein % *<input type="number" min="0" max="100" step="any" className={bioInputClass} disabled={readOnly} value={form.protein_pct} onChange={e => set('protein_pct', e.target.value)} /></label>
        <ManagedBiologicalProfileSelect
          kind="tan"
          label="Approved TAN reference *"
          disabled={readOnly}
          value={form.tan_generation_profile_revision_id}
          options={approvedTan}
          historical={data?.case?.tan_generation_profile_revision_id ? {
            id: data.case.tan_generation_profile_revision_id,
            label: `${data.case.tan_profile_code || 'Historical TAN profile'} r${data.case.tan_profile_revision || '—'} — ${data.case.tan_profile_status || 'Unavailable'}`,
          } : null}
          onChange={value => set('tan_generation_profile_revision_id', value)}
        />
        <label className="text-xs font-medium text-stone-500">Manual daily feed kg/day<input type="number" min="0" step="any" className={bioInputClass} disabled={readOnly} value={form.manual_daily_feed_kg_d} onChange={e => set('manual_daily_feed_kg_d', e.target.value)} /></label>
      </div>
    </section>

    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5"><h2 className="text-sm font-semibold text-stone-700">3. Water conditions, Maximum TAN, and approved media</h2><p className="mt-0.5 text-xs text-stone-400">The Maximum TAN concentration profile is separate from the TAN-generation profile above. It supplies the concentration used for ammonia and optional hydraulic checks.</p></div>
      <div className="grid gap-4 p-5 md:grid-cols-4">
        {[['temperature_c', 'Temperature °C *'], ['ph', 'pH *'], ['salinity_ppt', 'Salinity ppt *'], ['do_in_mg_l', 'Biofilter inlet DO mg/L'], ['do_out_min_mg_l', 'Minimum outlet DO mg/L'], ['alkalinity_mg_l_caco3', 'Alkalinity mg/L CaCO₃'], ['actual_flow_m3_h', 'Actual flow m³/h']].map(([key, label]) =>
          <label key={key} className="text-xs font-medium text-stone-500">{label}<input type="number" step="any" className={bioInputClass} disabled={readOnly} value={form[key] ?? ''} onChange={e => set(key, e.target.value)} /></label>)}
        <label className="text-xs font-medium text-stone-500 md:col-span-2">Maximum TAN concentration profile *
          <select aria-label="Maximum TAN concentration profile" className={bioInputClass} disabled={readOnly}
            value={form.max_tan_source === 'CUSTOM' ? 'CUSTOM' : form.max_tan_profile_revision_id || ''}
            onChange={e => {
              if (e.target.value === 'CUSTOM') {
                set('max_tan_source', 'CUSTOM');
                set('max_tan_profile_revision_id', '');
                set('max_tan_mg_n_l', '');
                return;
              }
              const profile = approvedMaxTan.find((item: any) => item.id === e.target.value);
              set('max_tan_source', 'CONTROLLED');
              set('max_tan_profile_revision_id', e.target.value);
              if (profile) set('max_tan_mg_n_l', profile.max_tan_mg_n_l);
            }}>
            <option value="">Select controlled profile</option>
            {form.max_tan_source === 'CONTROLLED' && form.max_tan_profile_revision_id
              && !approvedMaxTan.some((item: any) => item.id === form.max_tan_profile_revision_id)
              && <option value={form.max_tan_profile_revision_id}>{data?.case?.max_tan_profile_name || 'Historical Maximum TAN profile'} r{data?.case?.max_tan_profile_revision || '—'} — {data?.case?.max_tan_profile_status || 'Unavailable'}</option>}
            {approvedMaxTan.map((profile: any) => <option key={profile.id} value={profile.id}>
              {profile.profile_name} — {profile.max_tan_mg_n_l} mg N/L{profile.is_default ? ' (default)' : ''}
            </option>)}
            <option value="CUSTOM">Custom project value</option>
          </select>
        </label>
        {form.max_tan_source === 'CUSTOM'
          ? <label className="text-xs font-medium text-stone-500">Custom Maximum TAN mg N/L *
            <input aria-label="Custom Maximum TAN mg N/L" type="number" min="0" step="any" className={bioInputClass}
              disabled={readOnly} value={form.max_tan_mg_n_l ?? ''} onChange={e => set('max_tan_mg_n_l', e.target.value)} />
          </label>
          : <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
            <span className="font-semibold">Controlled value</span>
            <strong className="mt-1 block font-mono text-lg">{selectedMaxTanProfile?.max_tan_mg_n_l ?? form.max_tan_mg_n_l ?? '—'} mg N/L</strong>
            <span>{selectedMaxTanProfile?.engineering_note || selectedMaxTanProfile?.max_tan_profile_engineering_note || 'Saved controlled profile revision.'}</span>
          </div>}
        <p className="self-center text-xs text-amber-700 md:col-span-4">This profile or default is a design starting assumption, not a universal safety guarantee. Confirm suitability for the species, life stage, pH, temperature, salinity, and exposure duration.</p>
        <label className="text-xs font-medium text-stone-500">Reactor type *<input className={bioInputClass} disabled={readOnly} value={form.reactor_type} onChange={e => set('reactor_type', e.target.value)} /></label>
        <div className="md:col-span-2">
          <ManagedBiologicalProfileSelect
            kind="media"
            label="Approved overall-VTR media reference *"
            disabled={readOnly}
            value={form.media_profile_revision_id}
            options={approvedMedia}
            historical={data?.case?.media_profile_revision_id ? {
              id: data.case.media_profile_revision_id,
              label: `${data.case.media_profile_code || 'Historical media profile'} r${data.case.media_profile_revision || '—'} — ${data.case.media_profile_status || 'Unavailable'}`,
            } : null}
            onChange={value => {
              const profile = approvedMedia.find((item: any) => item.id === value);
              set('media_profile_revision_id', value);
              if (profile?.default_safety_factor) set('safety_factor', profile.default_safety_factor);
            }}
          />
        </div>
        <label className="text-xs font-medium text-stone-500">Safety factor<input type="number" min="0" step="any" className={bioInputClass} disabled={readOnly} value={form.safety_factor || selectedProfile?.default_safety_factor || ''} onChange={e => set('safety_factor', e.target.value)} /></label>
        <label className="text-xs font-medium text-stone-500 md:col-span-4">Design basis notes<textarea rows={2} className={bioInputClass} disabled={readOnly} value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 bg-stone-50/40 px-5 py-3">
        <p className="text-xs text-stone-400">{data?.case?.updated_at ? `Last saved ${new Date(data.case.updated_at).toLocaleString()}` : 'No draft saved yet.'}</p>
        {!readOnly && <div className="flex gap-2"><button type="button" onClick={onSave} disabled={saving || previewing} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? 'Saving…' : data?.case ? 'Save draft' : 'Create draft'}</button><button type="button" onClick={onPreview} disabled={saving || previewing} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Activity className="h-3.5 w-3.5" />{previewing ? 'Calculating…' : 'Calculate preview'}</button></div>}
      </div>
    </section>

    {preview && <section className={`overflow-hidden rounded-xl border bg-white ${stale ? 'opacity-60' : ''}`}>
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5"><h2 className="text-sm font-semibold text-stone-700">Sizing preview</h2><p className="mt-0.5 text-xs text-stone-400">{preview.profile ? `${preview.profile.profile_code} r${preview.profile.revision}` : 'No eligible approved profile'} · {preview.engine_version || 'BIOFILTER_1_0'}</p></div>
      {(preview.messages || []).length > 0 && <div className="border-b border-stone-100 p-5"><ul className="space-y-2">{preview.messages.map((message: any, index: number) => <li key={`${message.code}-${index}`} className={`rounded-lg px-3 py-2 text-xs ${message.severity === 'BLOCKING' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}><strong>{message.code}</strong> — {message.message}</li>)}</ul></div>}
      {preview.status !== 'BLOCKED' && <div className="space-y-5 p-5">
        <div><span className="text-xs font-semibold uppercase tracking-wide text-stone-400">Recommended installed media</span><div className="font-mono text-4xl font-semibold text-stone-900">{bioFormat(preview.media?.installed_media_l, 1)} <span className="text-lg text-stone-400">L</span></div><p className="mt-1 text-sm text-stone-500">{bioFormat(preview.media?.required_media_l, 5)} L required before upward module rounding</p></div>
        <div className="grid gap-3 md:grid-cols-4">{[
          ['Design biomass', preview.biomass?.design_biomass_kg, 'kg'],
          ['Daily feed', preview.feeding?.total_feed_kg_d, 'kg/day'],
          ['TAN nitrogen load', preview.feeding?.tan_load_g_n_d, 'g N/day'],
          ['Overall VTR', preview.capacity?.capacity_g_tan_n_m3_d, 'g N/m³/day'],
          ['Nominal capacity', preview.media?.nominal_capacity_g_n_d, 'g N/day'],
          ['Operating utilization', preview.media?.operating_utilization != null ? preview.media.operating_utilization * 100 : null, '%'],
          ['Design utilization', preview.media?.design_utilization != null ? preview.media.design_utilization * 100 : null, '%'],
          ['Operating margin', preview.media?.operating_capacity_margin_g_n_d, 'g N/day'],
        ].map(([label, value, unit]) => <div key={label as string} className="rounded-lg bg-stone-50 p-3"><span className="text-xs text-stone-400">{label}</span><strong className="mt-1 block font-mono text-stone-800">{bioFormat(value, 4)} {unit}</strong></div>)}</div>
        <div className="grid gap-3 md:grid-cols-4">{[
          ['NH₃-N at maximum TAN', preview.ammonia?.nh3_n_mg_l, 'mg N/L'],
          ['NH₃ molecular mass', preview.ammonia?.nh3_mg_l, 'mg NH₃/L'],
          ['Nitrification oxygen', preview.nitrification?.oxygen_g_d, 'g/day'],
          ['Alkalinity demand', preview.nitrification?.alkalinity_g_d, 'g CaCO₃/day'],
          ['Nitrate nitrogen', preview.nitrification?.nitrate_n_g_d, 'g N/day'],
          ['Nitrate molecular mass', preview.nitrification?.nitrate_g_d, 'g NO₃/day'],
        ].map(([label, value, unit]) => <div key={label as string} className="rounded-lg border border-stone-100 p-3"><span className="text-xs text-stone-400">{label}</span><strong className="mt-1 block font-mono text-stone-800">{bioFormat(value, 5)} {unit}</strong></div>)}</div>
        <div><h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Assumptions</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-stone-500">{(preview.assumptions || []).map((assumption: string) => <li key={assumption}>{assumption}</li>)}</ul></div>
      </div>}
    </section>}

    {runs.length > 0 && <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-stone-700">Run history and comparison</h2>
        <p className="mt-0.5 text-xs text-stone-400">Every row is an immutable calculation snapshot, including its original profiles, warnings, overrides, and approval evidence.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-400"><tr><th className="px-4 py-2">Run</th><th className="px-4 py-2">Executed</th><th className="px-4 py-2">Profile</th><th className="px-4 py-2">Result</th><th className="px-4 py-2">Approval</th><th className="px-4 py-2 text-right">Evidence</th></tr></thead>
          <tbody className="divide-y divide-stone-100">{runs.map((run: any) => <tr key={run.id}>
            <td className="px-4 py-3 font-semibold text-stone-700">Run {run.run_number}{run.is_stale ? <span className="ml-2 text-[10px] text-amber-700">Historical</span> : null}</td>
            <td className="px-4 py-3 text-stone-500">{run.executed_at ? new Date(run.executed_at).toLocaleString() : '—'}</td>
            <td className="px-4 py-3 text-stone-500">{run.media_profile_snapshot?.profile_code || '—'} r{run.media_profile_snapshot?.revision ?? '—'}</td>
            <td className="px-4 py-3 font-mono text-stone-700">{bioFormat(run.result_snapshot?.media?.installed_media_l, 1)} L</td>
            <td className="px-4 py-3 text-stone-600">{run.status}{run.approved_by_name ? ` · ${run.approved_by_name}` : ''}</td>
            <td className="px-4 py-3 text-right"><button type="button" onClick={() => onExportRun(run)} className="font-semibold text-blue-600 hover:text-blue-800">Export</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {runs.length > 1 && <div className="space-y-3 border-t border-stone-100 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-stone-500">Earlier run<select className={bioInputClass} value={compareLeft} onChange={event => setCompareLeft(event.target.value)}><option value="">Select run</option>{runs.map((run: any) => <option key={run.id} value={run.id}>Run {run.run_number}</option>)}</select></label>
          <label className="text-xs font-medium text-stone-500">Later run<select className={bioInputClass} value={compareRight} onChange={event => setCompareRight(event.target.value)}><option value="">Select run</option>{runs.map((run: any) => <option key={run.id} value={run.id}>Run {run.run_number}</option>)}</select></label>
          <button type="button" onClick={() => onCompareRuns(compareLeft, compareRight)}
            disabled={!compareLeft || !compareRight || compareLeft === compareRight || runBusy === 'compare'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50">
            <GitCompare className="h-3.5 w-3.5" />Compare runs
          </button>
        </div>
        {comparison && <div className="grid gap-2 md:grid-cols-4">{Object.entries(comparison.changes || {}).map(([section, changes]: any) =>
          <div key={section} className="rounded-lg bg-stone-50 p-3"><span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{section.replaceAll('_', ' ')}</span><strong className="mt-1 block text-sm text-stone-700">{changes.length} changed field{changes.length === 1 ? '' : 's'}</strong></div>)}</div>}
      </div>}
    </section>}
  </div>;
}

function getStoredFlowViewMode(): FlowViewMode {
  try {
    const stored = window.localStorage.getItem(FLOW_ROUTE_VIEW_STORAGE_KEY);
    return stored === 'list' || stored === 'card' ? stored : 'card';
  } catch {
    return 'card';
  }
}

function storeFlowViewMode(viewMode: FlowViewMode) {
  try {
    window.localStorage.setItem(FLOW_ROUTE_VIEW_STORAGE_KEY, viewMode);
  } catch {
    // Browser storage can be unavailable or disabled; the in-memory preference still works.
  }
}

function isEditingField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches('input, select, textarea, [contenteditable="true"]') || target.isContentEditable);
}

function FlowEquipmentProductCard({
  product,
  loopNumber,
  calculation,
  loopFlow,
  currentRate,
  statusLabel,
  notes,
  editable,
  formatFlow,
  onQuantityChange,
  onRemove,
  equipmentLabel = 'Foam Fractionator',
  recommendedRange = '18–22',
}: {
  product: any;
  loopNumber: number;
  calculation: any;
  loopFlow: number | null;
  currentRate: number;
  statusLabel: string;
  notes?: string;
  editable: boolean;
  formatFlow: (value: number | null) => string;
  onQuantityChange: (value: string) => void;
  onRemove: () => void;
  equipmentLabel?: string;
  recommendedRange?: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const productId = String(product.product_master_id);
  const detailsId = `flow-equipment-details-${loopNumber}-${productId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const diameter = Number(product.diameter_mm);
  const quantity = Number(product.quantity);
  const area = diameter > 0 && quantity > 0
    ? Math.PI * Math.pow(diameter / 2000, 2) * quantity
    : null;
  const capacityLs = area != null && calculation.status !== 'incomplete'
    ? area * calculation.rate
    : null;
  const parentFlowLs = loopFlow == null ? null : loopFlow / 3.6;

  return (
    <section
      aria-label={`${equipmentLabel} ${product.product_code}`}
      className="min-w-0 max-w-full rounded-md border border-current/20 bg-white/60 overflow-hidden"
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <strong className="block truncate text-sm">{product.product_code}</strong>
            <span className="block truncate text-[10px] opacity-70">{product.product_name || `${equipmentLabel} model`}</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded border border-current/10 bg-white/50 px-2 py-1.5">
            <span className="block opacity-70">Quantity</span>
            <strong className="text-xs">{product.quantity} unit{String(product.quantity) === '1' ? '' : 's'}</strong>
          </div>
          <div className="rounded border border-current/10 bg-white/50 px-2 py-1.5">
            <span className="block opacity-70">Diameter</span>
            <strong className="text-xs">{diameter > 0 ? `Ø${diameter} mm` : 'Unavailable'}</strong>
          </div>
        </div>
        {editable && (
          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2 border-t border-current/10 pt-3">
            <label className="text-[10px] font-medium">
              Quantity
              <input
                type="number"
                min="1"
                step="1"
                aria-label={`${product.product_code} quantity`}
                value={product.quantity}
                onChange={event => onQuantityChange(event.target.value)}
                className="mt-1 w-full rounded border border-current/20 px-2 py-1 text-xs bg-white"
              />
            </label>
            <button
              type="button"
              aria-label={`Remove ${product.product_code}`}
              onClick={onRemove}
              className="shrink-0 rounded border border-current/20 p-2 hover:bg-white"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <button
          type="button"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen(open => !open)}
          className="mt-3 inline-flex items-center rounded border border-current/20 bg-white/70 px-2 py-1 text-[10px] font-semibold hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
        >
          {detailsOpen ? 'Hide details' : 'Details'}
        </button>
        <div id={detailsId} hidden={!detailsOpen} className="pt-3 text-[10px]">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-current/10 pt-3">
            <div><span className="block opacity-70">Model diameter</span><strong>{diameter > 0 ? `Ø${diameter} mm` : 'Unavailable'}</strong></div>
            <div><span className="block opacity-70">Calculated area</span><strong>{area != null ? `${area.toFixed(4)} m²` : 'Unavailable'}</strong></div>
            <div><span className="block opacity-70">Parent loop flow</span><strong>{formatFlow(loopFlow)}{parentFlowLs != null ? ` (${parentFlowLs.toFixed(3)} L/s)` : ''}</strong></div>
            <div><span className="block opacity-70">Selected process rate</span><strong>{calculation.status !== 'incomplete' ? `${calculation.rate.toFixed(2)} L/s/m²` : currentRate > 0 ? `${currentRate.toFixed(2)} L/s/m²` : '—'}</strong></div>
            <div><span className="block opacity-70">Calculated capacity</span><strong>{capacityLs != null ? `${formatFlow(capacityLs * 3.6)} (${capacityLs.toFixed(3)} L/s)` : 'Unavailable'}</strong></div>
            <div><span className="block opacity-70">Actual loading</span><strong>{calculation.status !== 'incomplete' ? `${calculation.actualLoading.toFixed(3)} L/s/m²` : 'Unavailable'}</strong></div>
            <div><span className="block opacity-70">Capacity status</span><strong>{statusLabel}</strong></div>
          </div>
          {calculation.status === 'incomplete' && (
            <p className="mt-2 font-semibold">{calculation.reason}</p>
          )}
          {calculation.advisory && (
            <p className="mt-2 font-semibold">Advisory: selected rate is outside the recommended {recommendedRange} L/s/m² range.</p>
          )}
          {notes && (
            <p className="mt-2 opacity-80"><span className="font-semibold">Notes:</span> {notes}</p>
          )}
        </div>
      </div>
    </section>
  );
}

const FLOW_LOOP_FIELDS = [
  'name',
  'flow_source',
  'flow_mode',
  'match_loop_number',
  'filtration',
  'flow_pct',
  'bio_degas_pct',
  'bio_degas_m3h',
  'link_bio_degas',
] as const;
const FLOW_UNSAVED_CONFIRMATION = 'You have unsaved Flow Route changes. Leave this page and discard them?';

function createFlowDraft(system: any) {
  const draft: Record<string, any> = {};
  for (const n of [1, 2, 3]) {
    draft[`loop${n}_name`] = system[`loop${n}_name`] || `Loop ${n}`;
    draft[`loop${n}_flow_source`] = system[`loop${n}_flow_source`] || '';
    draft[`loop${n}_flow_mode`] = system[`loop${n}_flow_mode`] === 'matched' ? 'matched' : 'allocated';
    draft[`loop${n}_match_loop_number`] =
      system[`loop${n}_match_loop_number`] != null ? String(system[`loop${n}_match_loop_number`]) : '';
    draft[`loop${n}_filtration`] = system[`loop${n}_filtration`] || '';
    draft[`loop${n}_flow_pct`] =
      system[`loop${n}_flow_pct`] != null ? String(system[`loop${n}_flow_pct`]) : '';
    draft[`loop${n}_bio_degas_pct`] =
      system[`loop${n}_bio_degas_pct`] != null ? String(system[`loop${n}_bio_degas_pct`]) : '';
    draft[`loop${n}_bio_degas_m3h`] =
      system[`loop${n}_bio_degas_m3h`] != null ? String(system[`loop${n}_bio_degas_m3h`]) : '';
    draft[`loop${n}_link_bio_degas`] = !!system[`loop${n}_link_bio_degas`];
  }
  draft.side_streams = (system.side_streams || []).map((stream: any) => ({
    ...stream,
    flow_pct: stream.flow_pct != null ? String(stream.flow_pct) : '',
    has_dedicated_pump: stream.has_dedicated_pump !== false,
  }));
  draft.fractionator_allocations = (system.fractionator_allocations || []).map((allocation: any) => ({
    ...allocation,
    process_rate_ls_m2: allocation.process_rate_ls_m2 != null ? String(allocation.process_rate_ls_m2) : '',
    products: (allocation.products || []).map((product: any) => ({
      ...product,
      quantity: String(product.quantity),
    })),
  }));
  draft.sand_filter_allocations = (system.sand_filter_allocations || []).map((allocation: any) => ({
    ...allocation,
    process_rate_ls_m2: allocation.process_rate_ls_m2 != null ? String(allocation.process_rate_ls_m2) : '',
    products: (allocation.products || []).map((product: any) => ({ ...product, quantity: String(product.quantity) })),
  }));
  return draft;
}

function flowDraftLoopHasData(draft: Record<string, any>, n: number) {
  return !!(
    draft[`loop${n}_flow_source`] ||
    draft[`loop${n}_flow_mode`] === 'matched' ||
    (draft[`loop${n}_match_loop_number`] != null && draft[`loop${n}_match_loop_number`] !== '') ||
    draft[`loop${n}_filtration`] ||
    (draft[`loop${n}_flow_pct`] != null && draft[`loop${n}_flow_pct`] !== '') ||
    (draft[`loop${n}_bio_degas_pct`] != null && draft[`loop${n}_bio_degas_pct`] !== '') ||
    (draft[`loop${n}_bio_degas_m3h`] != null && draft[`loop${n}_bio_degas_m3h`] !== '') ||
    draft[`loop${n}_link_bio_degas`] ||
    (draft.side_streams || []).some((stream: any) => Number(stream.parent_loop_number) === n)
    || (draft.fractionator_allocations || []).some(
      (allocation: any) => Number(allocation.parent_loop_number) === n)
    || (draft.sand_filter_allocations || []).some(
      (allocation: any) => Number(allocation.parent_loop_number) === n)
  );
}

function flowDraftMatchesSystem(draft: Record<string, any>, system: any) {
  const loopsMatch = [1, 2, 3].every(n => (
    (draft[`loop${n}_name`] || `Loop ${n}`) === (system[`loop${n}_name`] || `Loop ${n}`) &&
    (draft[`loop${n}_flow_source`] || '') === (system[`loop${n}_flow_source`] || '') &&
    (draft[`loop${n}_flow_mode`] === 'matched' ? 'matched' : 'allocated') ===
      (system[`loop${n}_flow_mode`] === 'matched' ? 'matched' : 'allocated') &&
    (draft[`loop${n}_match_loop_number`] || '') === (
      system[`loop${n}_match_loop_number`] != null ? String(system[`loop${n}_match_loop_number`]) : ''
    ) &&
    (draft[`loop${n}_filtration`] || '') === (system[`loop${n}_filtration`] || '') &&
    (draft[`loop${n}_flow_pct`] || '') === (
      system[`loop${n}_flow_pct`] != null ? String(system[`loop${n}_flow_pct`]) : ''
    ) &&
    (draft[`loop${n}_bio_degas_pct`] || '') === (
      system[`loop${n}_bio_degas_pct`] != null ? String(system[`loop${n}_bio_degas_pct`]) : ''
    ) &&
    (draft[`loop${n}_bio_degas_m3h`] || '') === (
      system[`loop${n}_bio_degas_m3h`] != null ? String(system[`loop${n}_bio_degas_m3h`]) : ''
    ) &&
    !!draft[`loop${n}_link_bio_degas`] === !!system[`loop${n}_link_bio_degas`]
  ));
  const comparableStreams = (streams: any[]) => streams.map((stream: any) => ({
    id: stream.id || null,
    parent_loop_number: Number(stream.parent_loop_number),
    name: String(stream.name || ''),
    preset: stream.preset || null,
    flow_pct: stream.flow_pct === '' || stream.flow_pct == null ? null : Number(stream.flow_pct),
    has_dedicated_pump: stream.has_dedicated_pump !== false,
    notes: stream.notes || null,
    sort_order: Number(stream.sort_order || 0),
  }));
  return loopsMatch && JSON.stringify(comparableStreams(draft.side_streams || [])) ===
    JSON.stringify(comparableStreams(system.side_streams || []))
    && JSON.stringify(draft.fractionator_allocations || []) ===
      JSON.stringify(createFlowDraft(system).fractionator_allocations || [])
    && JSON.stringify(draft.sand_filter_allocations || []) ===
      JSON.stringify(createFlowDraft(system).sand_filter_allocations || []);
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function allocationStatus(value: number | null, basis: string) {
  if (value == null) return 'allocation not reviewed';
  return value === 0 ? '0% (intentional zero allocation)' : `${value}% of ${basis}`;
}

function buildFlowLoopFields(draft: Record<string, any>, clearedLoop?: number) {
  const fields: Record<string, any> = {};
  for (const n of [1, 2, 3]) {
    const cleared = n === clearedLoop;
    fields[`loop${n}_name`] = cleared ? `Loop ${n}` : (String(draft[`loop${n}_name`] || '').trim() || `Loop ${n}`);
    fields[`loop${n}_flow_source`] = cleared ? null : (draft[`loop${n}_flow_source`] || null);
    fields[`loop${n}_flow_mode`] = cleared ? 'allocated' :
      (draft[`loop${n}_flow_mode`] === 'matched' ? 'matched' : 'allocated');
    fields[`loop${n}_match_loop_number`] = cleared ? null :
      (fields[`loop${n}_flow_mode`] === 'matched' ? nullableNumber(draft[`loop${n}_match_loop_number`]) : null);
    fields[`loop${n}_filtration`] = cleared ? null : (draft[`loop${n}_filtration`] || null);
    fields[`loop${n}_flow_pct`] = cleared ? null : nullableNumber(draft[`loop${n}_flow_pct`]);
    fields[`loop${n}_bio_degas_pct`] = cleared ? null : nullableNumber(draft[`loop${n}_bio_degas_pct`]);
    fields[`loop${n}_bio_degas_m3h`] = cleared ? null : nullableNumber(draft[`loop${n}_bio_degas_m3h`]);
    fields[`loop${n}_link_bio_degas`] = cleared ? false : !!draft[`loop${n}_link_bio_degas`];
  }
  fields.side_streams = (draft.side_streams || [])
    .filter((stream: any) => Number(stream.parent_loop_number) !== clearedLoop)
    .map((stream: any, index: number) => ({
      ...(stream.id && !String(stream.id).startsWith('draft-') ? { id: stream.id } : {}),
      parent_loop_number: Number(stream.parent_loop_number),
      name: String(stream.name || '').trim(),
      preset: stream.preset || 'Custom',
      flow_pct: nullableNumber(stream.flow_pct),
      has_dedicated_pump: stream.has_dedicated_pump === true,
      notes: String(stream.notes || '').trim() || null,
      sort_order: index,
    }));
  fields.fractionator_allocations = (draft.fractionator_allocations || [])
    .filter((allocation: any) =>
      Number(allocation.parent_loop_number) !== clearedLoop
      && draft[`loop${Number(allocation.parent_loop_number)}_filtration`] === 'Foam Fractionation')
    .map((allocation: any) => ({
      parent_loop_number: Number(allocation.parent_loop_number),
      process_rate_ls_m2: nullableNumber(allocation.process_rate_ls_m2),
      notes: String(allocation.notes || '').trim() || null,
      products: (allocation.products || []).map((product: any) => ({
        product_master_id: product.product_master_id,
        quantity: Number(product.quantity),
      })),
    }));
  fields.sand_filter_allocations = (draft.sand_filter_allocations || [])
    .filter((allocation: any) =>
      Number(allocation.parent_loop_number) !== clearedLoop
      && draft[`loop${Number(allocation.parent_loop_number)}_filtration`] === 'Sand Filter')
    .map((allocation: any) => ({
      parent_loop_number: Number(allocation.parent_loop_number),
      process_rate_ls_m2: nullableNumber(allocation.process_rate_ls_m2),
      notes: String(allocation.notes || '').trim() || null,
      products: (allocation.products || []).map((product: any) => ({
        product_master_id: product.product_master_id, quantity: Number(product.quantity),
      })),
    }));
  return fields;
}

function flowAllocationError(
  draft: Record<string, any>,
  totalAllocationPct?: number | null,
): string | null {
  const foamFractionationLoops = [1, 2, 3].filter(
    n => draft[`loop${n}_filtration`] === 'Foam Fractionation',
  );
  if (foamFractionationLoops.length > 1) {
    return 'Only one Flow Route loop may use Foam Fractionation.';
  }
  let rawTotal = 0;
  for (const n of [1, 2, 3]) {
    const isMatched = draft[`loop${n}_flow_mode`] === 'matched';
    for (const [key, label] of [
      [`loop${n}_flow_pct`, `Loop ${n} allocation`],
      [`loop${n}_bio_degas_pct`, `Loop ${n} Bio/Degas allocation`],
    ] as const) {
      const raw = draft[key];
      if (isMatched && key === `loop${n}_flow_pct`) continue;
      if (raw === undefined || raw === null || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return `${label} must be between 0% and 100%.`;
      }
    }
    const flowPct = nullableNumber(draft[`loop${n}_flow_pct`]);
    if (!isMatched && flowPct != null) rawTotal += flowPct;
  }
  for (const loopNumber of [1, 2, 3]) {
    const streams = (draft.side_streams || [])
      .filter((stream: any) => Number(stream.parent_loop_number) === loopNumber);
    for (const stream of streams) {
      const name = String(stream.name || '').trim();
      if (!name) return `Every side stream under Loop ${loopNumber} requires a name.`;
      const percentage = nullableNumber(stream.flow_pct);
      if (percentage == null || percentage < 0 || percentage > 100) {
        return `${name} allocation must be between 0% and 100%.`;
      }
    }
  }
  const total = totalAllocationPct ?? rawTotal;
  return total > 100.000001
    ? `Active loop flows allocate ${total.toFixed(1)}% of total system flow. Reduce them to 100% or less before saving.`
    : null;
}

function WaterTypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-stone-400 text-xs">—</span>;
  const styles: Record<string, string> = {
    Marine: 'bg-blue-100 text-blue-700 border-blue-200',
    'Salt Water': 'bg-blue-100 text-blue-700 border-blue-200',
    Freshwater: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Brackish: 'bg-teal-100 text-teal-700 border-teal-200',
  };
  const cls = styles[type] ?? 'bg-stone-100 text-stone-600 border-stone-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      <Waves className="w-3 h-3" /> {type}
    </span>
  );
}

function LinkTypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-stone-400 text-xs">—</span>;
  const styles: Record<string, string> = {
    Primary:     'bg-blue-50 text-blue-700 border-blue-200',
    Secondary:   'bg-sky-50 text-sky-700 border-sky-200',
    Emergency:   'bg-red-50 text-red-700 border-red-200',
    Backup:      'bg-blue-50 text-blue-700 border-blue-200',
    Observation: 'bg-violet-50 text-violet-700 border-violet-200',
    Redundant:   'bg-stone-50 text-stone-600 border-stone-200',
  };
  const cls = styles[type] ?? 'bg-stone-50 text-stone-600 border-stone-200';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{type}</span>;
}

function EngineeringTrace({ calculation }: { calculation?: any | null }) {
  if (!calculation) return null;
  const status = calculation.status || 'warning';
  const styles = status === 'valid'
    ? 'border-emerald-200 bg-emerald-50/50 text-emerald-700'
    : status === 'override'
      ? 'border-blue-200 bg-blue-50/50 text-blue-700'
      : 'border-amber-200 bg-amber-50/50 text-amber-700';
  return (
    <div className={`rounded-xl border px-4 py-3 ${styles}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {status === 'valid' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
        <span className="text-xs font-semibold uppercase tracking-wide">System Calculation Trace</span>
        <span className="text-xs rounded-full bg-white/70 border border-current/20 px-2 py-0.5">
          {status === 'override' ? 'Manual override' : status}
        </span>
        <span className="text-xs opacity-70 ml-auto">
          {calculation.calculation_version} · {new Date(calculation.calculated_at).toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 text-xs">
        <div><span className="block opacity-70">Calculated flow</span><strong className="font-mono">{calculation.results?.calculated_required_flow_m3h ?? '—'} m³/h</strong></div>
        <div><span className="block opacity-70">Design flow</span><strong className="font-mono">{calculation.results?.design_flow_m3h ?? '—'} m³/h</strong></div>
        <div><span className="block opacity-70">Allocated flow</span><strong className="font-mono">{calculation.results?.allocated_flow_m3h ?? '—'} m³/h</strong></div>
      </div>
      <p className="text-xs opacity-80 mt-2">{calculation.formula}</p>
      {calculation.reasons?.length > 0 && (
        <ul className="text-xs mt-2 list-disc list-inside">
          {calculation.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </div>
  );
}

// ─── Add Exhibit Modal ────────────────────────────────────────────────────────
function AddExhibitModal({ systemId, availableExhibits, onClose, onAdded }: {
  systemId: string;
  availableExhibits: any[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    exhibit_id: availableExhibits[0]?.id || '',
    link_type: 'Primary',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.exhibit_id) return toast.error('Select an exhibit');
    setSaving(true);
    try {
      await api.post(`/systems/${systemId}/exhibit-links`, {
        exhibit_id: form.exhibit_id,
        link_type:  form.link_type,
        notes: form.notes || null,
      });
      toast.success('Exhibit linked');
      onAdded();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to link exhibit');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 bg-white';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-stone-800">Link Exhibit to System</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 rounded-lg p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Exhibit</label>
            <select value={form.exhibit_id} onChange={e => set('exhibit_id', e.target.value)} className={inputCls}>
              <option value="">— Select exhibit —</option>
              {availableExhibits.map((ex: any) => (
                <option key={ex.id} value={ex.id}>
                  {ex.exhibit_code} — {ex.exhibit_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Link Type</label>
            <select value={form.link_type} onChange={e => set('link_type', e.target.value)} className={inputCls}>
              {LINK_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Notes <span className="text-stone-400 font-normal">optional</span></label>
            <textarea rows={2} placeholder="Rule set notes, design conditions, constraints…"
              value={form.notes} onChange={e => set('notes', e.target.value)}
              className={`${inputCls} resize-none`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-100 bg-stone-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 border border-stone-200 bg-white rounded-lg">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !form.exhibit_id}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> {saving ? 'Linking…' : 'Link Exhibit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Link Modal ──────────────────────────────────────────────────────────
function EditLinkModal({ link, systemId, onClose, onSaved }: {
  link: any;
  systemId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    link_type:           link.link_type || 'Primary',
    flow_allocation_m3h: link.flow_allocation_m3h != null ? String(link.flow_allocation_m3h) : '',
    notes:               link.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${systemId}/exhibit-links/${link.id}`, {
        link_type:           form.link_type,
        flow_allocation_m3h: form.flow_allocation_m3h ? parseFloat(form.flow_allocation_m3h) : null,
        notes:               form.notes || null,
      });
      toast.success('Link updated');
      onSaved();
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 bg-white';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-stone-800">Edit Exhibit Link</span>
            <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded ml-1">{link.exhibit_code}</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 rounded-lg p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Flow Allocation Override (m³/h) <span className="text-stone-400 font-normal">optional</span></label>
            <input type="number" min="0" step="0.001" value={form.flow_allocation_m3h}
              onChange={e => set('flow_allocation_m3h', e.target.value)}
              placeholder="Blank uses calculated exhibit flow" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Link Type</label>
            <select value={form.link_type} onChange={e => set('link_type', e.target.value)} className={inputCls}>
              {LINK_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
              className={`${inputCls} resize-none`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-100 bg-stone-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-500 border border-stone-200 bg-white rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DesignBookLSSDetail() {
  const { bookId, systemId } = useParams<{ bookId: string; systemId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useAuthStore(state => state.user);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showNewRevision, setShowNewRevision] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<'archive' | 'supersede' | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [replacementSystemId, setReplacementSystemId] = useState('');
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<LssTab, HTMLButtonElement>>>({});
  const tabParam = searchParams.get('tab');
  const activeTab: LssTab = isLssTab(tabParam) ? tabParam : 'overview';

  const { data: liveSystem, isLoading: sysLoading } = useQuery({
    queryKey: ['system', systemId],
    queryFn: () => api.get(`/systems/${systemId}`).then(r => r.data),
  });
  const { data: book } = useQuery({
    queryKey: ['design-book', bookId],
    queryFn: () => api.get(`/design-books/${bookId}`).then(r => r.data),
  });
  const usesFrozenPackage = !!book && !['Draft', 'In Progress'].includes(book.status);
  const { data: liveLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ['system-exhibit-links', systemId],
    queryFn: () => api.get(`/systems/${systemId}/exhibit-links`).then(r => r.data),
  });
  const { data: compactUnits = [] } = useQuery({
    queryKey: ['lss-compact-units'],
    queryFn: () => api.get('/lss-compact-units').then(r => r.data),
  });
  const { data: fractionatorProducts = [] } = useQuery({
    queryKey: ['foam-fractionator-products', systemId],
    queryFn: () => api.get(`/systems/${systemId}/fractionator-products`).then(r => r.data.items),
    enabled: !!systemId,
  });
  const { data: sandFilterProducts = [] } = useQuery({
    queryKey: ['sand-filter-products', systemId],
    queryFn: () => api.get(`/systems/${systemId}/sand-filter-products`).then(r => r.data.items),
    enabled: !!systemId,
  });
  const {
    data: uvSelectionData,
    refetch: refetchUvSelection,
    isLoading: uvSelectionLoading,
    isError: uvSelectionIsError,
    error: uvSelectionError,
  } = useQuery({
    queryKey: ['uv-selection', bookId, systemId],
    queryFn: () => api.get(`/design-books/${bookId}/uv/${systemId}`).then(r => r.data),
    enabled: !!systemId && !!bookId && !!book && activeTab === 'uv' && !usesFrozenPackage,
  });
  const { data: biologicalMedia = null, isError: biologicalMediaIsError, error: biologicalMediaQueryError } = useQuery({
    queryKey: ['biological-media', systemId, bookId],
    queryFn: () => api.get(`/systems/${systemId}/biological-media`, { params: { design_book_id: bookId } }).then(r => r.data),
    enabled: !!systemId && !!bookId,
  });
  const { data: mediaProfileData = { items: [] } } = useQuery({
    queryKey: ['biological-media-profiles'],
    queryFn: () => api.get('/biological-media/media-profiles').then(r => r.data),
  });
  const { data: tanProfileData = { items: [] } } = useQuery({
    queryKey: ['tan-generation-profiles'],
    queryFn: () => api.get('/biological-media/tan-profiles').then(r => r.data),
  });
  const { data: maxTanProfileData = { items: [] } } = useQuery({
    queryKey: ['maximum-tan-profiles'],
    queryFn: () => api.get('/biological-media/max-tan-profiles', { params: { approved_only: true } }).then(r => r.data),
  });
  const availableCompactUnits = usesFrozenPackage && Array.isArray(book?.compact_units)
    ? book.compact_units
    : compactUnits;
  const system = usesFrozenPackage
    ? (book.systems || []).find((item: any) => item.id === systemId)
    : liveSystem;
  const links = usesFrozenPackage
    ? (book.system_links || []).filter((item: any) => item.system_id === systemId)
    : liveLinks;
  const uvSelectionDataForView = useMemo(
    () => usesFrozenPackage ? buildFrozenUvSelectionData(book, systemId) : uvSelectionData,
    [book, systemId, usesFrozenPackage, uvSelectionData],
  );
  const { data: biologicalSpeciesData = { items: [] } } = useQuery({
    queryKey: ['species-catalog-picker', system?.water_type],
    queryFn: () => api.get('/species-catalog', { params: { limit: 1000, water_type: system?.water_type } }).then(r => r.data),
    enabled: activeTab === 'biological-media' && !!system?.water_type && !usesFrozenPackage,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['system', systemId] });
    qc.invalidateQueries({ queryKey: ['system-exhibit-links', systemId] });
    qc.invalidateQueries({ queryKey: ['design-book', bookId] });
    // Pump circuits are derived from the live Flow Route. Keep an already
    // mounted Pump Selection view synchronized after a successful save.
    qc.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
  };

  // Flow Route saves can change the UV side-stream list while the UV query is
  // inactive. Refresh it explicitly so switching tabs never reveals cached data.
  const refreshUvSelection = async () => {
    if (usesFrozenPackage) return;
    await refetchUvSelection().catch(() => undefined);
  };

  // Ref supports Flow Route draft editing without persisting calculated values.
  const systemRef = useRef<any>(null);
  if (system) systemRef.current = system;

  // System edit state
  const [editMode, setEditMode]   = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm]   = useState<any>(null);

  // Exhibit link modals
  const [showAddExhibit, setShowAddExhibit] = useState(false);
  const [editLink, setEditLink]   = useState<any>(null);
  const [pendingUnlinkLink, setPendingUnlinkLink] = useState<any>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [deletingLink, setDeletingLink] = useState<string | null>(null);

  // System config selector
  const [configSaving, setConfigSaving] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<'compact' | 'bespoke' | null>(null);
  const [pendingUnitId, setPendingUnitId] = useState<string>('');
  const [showConfigReset, setShowConfigReset] = useState(false);
  const [configResetSaving, setConfigResetSaving] = useState(false);
  const [configResetError, setConfigResetError] = useState<string | null>(null);
  const [biologicalMediaForm, setBiologicalMediaForm] = useState({
    reactor_type: '',
    media_profile_revision_id: '',
    tan_generation_profile_revision_id: '',
    max_tan_source: '',
    max_tan_profile_revision_id: '',
    biomass_method: '',
    stocking_density_kg_m3: '',
    feed_rate_pct_biomass_day: '',
    protein_pct: '',
    manual_daily_feed_kg_d: '',
    temperature_c: '',
    ph: '',
    salinity_ppt: '',
    max_tan_mg_n_l: '',
    do_in_mg_l: '',
    do_out_min_mg_l: '',
    alkalinity_mg_l_caco3: '',
    actual_flow_m3_h: '',
    safety_factor: '',
    species_rows: [] as any[],
    notes: '',
    _stale: false,
  });
  const [biologicalMediaSaving, setBiologicalMediaSaving] = useState(false);

  // UV Selection state
  const [uvTargetFluence, setUvTargetFluence] = useState<string>('50');
  const [uvStreamAssignments, setUvStreamAssignments] = useState<Record<string, {
    uv_revision_id: string;
    uv_unit_quantity: string;
    uvt_basis: '85T' | '95T';
  }>>({});
  const [uvCalculating, setUvCalculating] = useState(false);
  const [uvResult, setUvResult] = useState<any>(null);

  // Flow Route edit state
  const [flowEditMode, setFlowEditMode] = useState(false);
  const [flowSaving,   setFlowSaving]   = useState(false);
  const [flowForm,     setFlowForm]     = useState<any>(null);
  const [inlineLoopRename, setInlineLoopRename] = useState<{ loopNumber: number; value: string } | null>(null);
  const setFF = (k: string, v: any) => setFlowForm((f: any) => ({
    ...(f || createFlowDraft(systemRef.current)),
    [k]: v,
  }));
  useEffect(() => {
    const draft = biologicalMedia?.case;
    setBiologicalMediaForm({
      reactor_type: draft?.reactor_type || '',
      media_profile_revision_id: draft?.media_profile_revision_id || '',
      tan_generation_profile_revision_id: draft?.tan_generation_profile_revision_id || '',
      max_tan_source: draft?.max_tan_source || (!draft && biologicalMedia?.maximum_tan_default ? 'CONTROLLED' : ''),
      max_tan_profile_revision_id: draft?.max_tan_profile_revision_id || biologicalMedia?.maximum_tan_default?.id || '',
      biomass_method: draft?.biomass_method || '',
      stocking_density_kg_m3: draft?.stocking_density_kg_m3 ?? '',
      feed_rate_pct_biomass_day: draft?.feed_rate_pct_biomass_day ?? '',
      protein_pct: draft?.protein_pct ?? '',
      manual_daily_feed_kg_d: draft?.manual_daily_feed_kg_d ?? '',
      temperature_c: draft?.temperature_c ?? '',
      ph: draft?.ph ?? '',
      salinity_ppt: draft?.salinity_ppt ?? '',
      max_tan_mg_n_l: draft?.max_tan_mg_n_l ?? biologicalMedia?.maximum_tan_default?.max_tan_mg_n_l ?? '',
      do_in_mg_l: draft?.do_in_mg_l ?? '',
      do_out_min_mg_l: draft?.do_out_min_mg_l ?? '',
      alkalinity_mg_l_caco3: draft?.alkalinity_mg_l_caco3 ?? '',
      actual_flow_m3_h: draft?.actual_flow_m3_h ?? '',
      safety_factor: draft?.safety_factor ?? '',
      species_rows: draft?.species_rows || [],
      notes: draft?.notes || '',
      _stale: false,
    });
  }, [biologicalMedia?.case?.id, biologicalMedia?.case?.updated_at, biologicalMedia?.maximum_tan_default?.id]);

  // Sync UV state when data loads or tab changes
  useEffect(() => {
    if (!uvSelectionDataForView) return;
    if (uvSelectionDataForView.saved?.target_fluence_mj_cm2) {
      setUvTargetFluence(String(uvSelectionDataForView.saved.target_fluence_mj_cm2));
    }
    if (uvSelectionDataForView.saved) {
      setUvResult(uvSelectionDataForView.saved.result_snapshot ?? null);
    }
    // Initialize per-stream assignments from the live stream data or frozen package.
    const assignments: Record<string, {
      uv_revision_id: string;
      uv_unit_quantity: string;
      uvt_basis: '85T' | '95T';
    }> = {};
    for (const stream of (uvSelectionDataForView.streams || [])) {
      assignments[stream.id] = {
        uv_revision_id: stream.uv_revision_id || '',
        uv_unit_quantity: stream.uv_unit_quantity != null ? String(stream.uv_unit_quantity) : '1',
        uvt_basis: stream.uvt_basis === '95T' ? '95T' : '85T',
      };
    }
    setUvStreamAssignments(assignments);
  }, [uvSelectionDataForView]);

  const calculateUVSelection = async () => {
    if (!bookId || !systemId) return;
    setUvCalculating(true);
    try {
      // Save UV revision + quantity to each stream first
      const streams: any[] = uvSelectionDataForView?.streams || [];
      await Promise.all(streams.map(async (stream: any) => {
        const assignment = uvStreamAssignments[stream.id];
        if (!assignment) return;
        const revisionId = assignment.uv_revision_id || null;
        const qty = assignment.uv_unit_quantity ? parseInt(assignment.uv_unit_quantity, 10) : null;
        const uvtBasis = assignment.uvt_basis;
        if (revisionId !== (stream.uv_revision_id || null)
          || qty !== (stream.uv_unit_quantity || null)
          || uvtBasis !== (stream.uvt_basis || '85T')) {
          await api.put(`/systems/${systemId}/side-streams/${stream.id}`, {
            parent_loop_number: stream.parent_loop_number,
            name: stream.name,
            preset: stream.preset,
            flow_pct: stream.flow_pct,
            notes: stream.notes,
            sort_order: stream.sort_order,
            uv_revision_id: revisionId,
            uv_unit_quantity: qty,
            uvt_basis: uvtBasis,
          });
        }
      }));
      // Calculate
      const response = await api.post(`/design-books/${bookId}/uv/${systemId}`, {
        target_fluence_mj_cm2: parseFloat(uvTargetFluence) || 50,
      });
      setUvResult(response.data.result);
      toast.success('UV fluence selection calculated');
      await refetchUvSelection();
      qc.invalidateQueries({ queryKey: ['system', systemId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'UV selection calculation failed');
    } finally {
      setUvCalculating(false);
    }
  };

  const saveBiologicalMedia = async () => {
    setBiologicalMediaSaving(true);
    try {
      const { _stale, ...draft } = biologicalMediaForm;
      await api.put(`/systems/${systemId}/biological-media`, {
        design_book_id: bookId,
        ...draft,
        water_volume_m3: biologicalMedia?.context?.total_operating_volume_m3,
        water_type: biologicalMedia?.context?.system_water_type,
        media_profile_revision_id: biologicalMediaForm.media_profile_revision_id || null,
        tan_generation_profile_revision_id: biologicalMediaForm.tan_generation_profile_revision_id || null,
      });
      toast.success('Biological Media draft saved');
      qc.invalidateQueries({ queryKey: ['biological-media', systemId, bookId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save Biological Media draft');
    } finally {
      setBiologicalMediaSaving(false);
    }
  };
  const [biologicalMediaPreviewing, setBiologicalMediaPreviewing] = useState(false);
  const [biologicalMediaRunBusy, setBiologicalMediaRunBusy] = useState<string | null>(null);
  const [biologicalMediaComparison, setBiologicalMediaComparison] = useState<any>(null);
  const previewBiologicalMedia = async () => {
    setBiologicalMediaPreviewing(true);
    try {
      const { _stale, ...draft } = biologicalMediaForm;
      const payload = {
        design_book_id: bookId,
        ...draft,
        water_volume_m3: biologicalMedia?.context?.total_operating_volume_m3,
        water_type: biologicalMedia?.context?.system_water_type,
        media_profile_revision_id: biologicalMediaForm.media_profile_revision_id || null,
        tan_generation_profile_revision_id: biologicalMediaForm.tan_generation_profile_revision_id || null,
      };
      await api.put(`/systems/${systemId}/biological-media`, payload);
      const response = await api.post(`/systems/${systemId}/biological-media/preview`, payload);
      setBiologicalMediaForm(current => ({ ...current, _stale: false }));
      qc.setQueryData(['biological-media', systemId, bookId], (current: any) => ({
        ...(current || {}),
        preview: response.data,
        readiness_status: response.data.status_label,
      }));
      toast.success(response.data.status === 'BLOCKED' ? 'Preview completed with blocking items' : 'Biological Media preview calculated');
    } catch (err: any) {
      const response = err?.response?.data;
      if (response?.messages) {
        qc.setQueryData(['biological-media', systemId, bookId], (current: any) => ({
          ...(current || {}),
          preview: { ...response, is_preview: true, is_stale: false },
          readiness_status: 'Blocked',
        }));
      }
      toast.error(response?.error?.message || 'Biological Media preview could not be calculated');
    } finally {
      setBiologicalMediaPreviewing(false);
    }
  };
  const refreshBiologicalMedia = () =>
    qc.invalidateQueries({ queryKey: ['biological-media', systemId, bookId] });
  const createBiologicalMediaRun = async () => {
    setBiologicalMediaRunBusy('create');
    try {
      await api.post(`/systems/${systemId}/biological-media/runs`, {
        design_book_id: bookId,
        previewed_at: biologicalMedia?.case?.previewed_at,
      });
      toast.success('Frozen Biological Media run created for review');
      await refreshBiologicalMedia();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Biological Media run could not be created');
    } finally {
      setBiologicalMediaRunBusy(null);
    }
  };
  const approveBiologicalMediaRun = async (run: any, acknowledgeWarnings: boolean, warningAcknowledgement: string) => {
    setBiologicalMediaRunBusy(run.id);
    try {
      await api.post(`/systems/${systemId}/biological-media/runs/${run.id}/approve`, {
        design_book_id: bookId,
        acknowledge_warnings: acknowledgeWarnings,
        warning_acknowledgement: warningAcknowledgement || null,
      });
      toast.success(`Biological Media run ${run.run_number} approved`);
      await refreshBiologicalMedia();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Run approval failed');
    } finally {
      setBiologicalMediaRunBusy(null);
    }
  };
  const rejectBiologicalMediaRun = async (run: any, reason: string) => {
    setBiologicalMediaRunBusy(run.id);
    try {
      await api.post(`/systems/${systemId}/biological-media/runs/${run.id}/reject`, {
        design_book_id: bookId,
        reason,
      });
      toast.success(`Biological Media run ${run.run_number} rejected`);
      await refreshBiologicalMedia();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Run rejection failed');
    } finally {
      setBiologicalMediaRunBusy(null);
    }
  };
  const exportBiologicalMediaRun = async (run: any) => {
    setBiologicalMediaRunBusy(run.id);
    try {
      const response = await api.get(`/systems/${systemId}/biological-media/runs/${run.id}/export`, {
        params: { design_book_id: bookId },
        responseType: 'text',
      });
      const href = URL.createObjectURL(new Blob([response.data], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = href;
      link.download = `biological-media-run-${run.run_number}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Run export failed');
    } finally {
      setBiologicalMediaRunBusy(null);
    }
  };
  const compareBiologicalMediaRunHistory = async (leftId: string, rightId: string) => {
    setBiologicalMediaRunBusy('compare');
    try {
      const response = await api.get(`/systems/${systemId}/biological-media/runs/compare`, {
        params: { design_book_id: bookId, left_id: leftId, right_id: rightId },
      });
      setBiologicalMediaComparison(response.data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Run comparison failed');
    } finally {
      setBiologicalMediaRunBusy(null);
    }
  };
  const setFlowSideStreams = (update: (streams: any[]) => any[]) => {
    setFlowForm((draft: any) => ({
      ...(draft || createFlowDraft(systemRef.current)),
      side_streams: update([...(draft?.side_streams || createFlowDraft(systemRef.current).side_streams)]),
    }));
  };
  const setFractionatorAllocations = (update: (allocations: any[]) => any[]) => {
    setFlowForm((draft: any) => ({
      ...(draft || createFlowDraft(systemRef.current)),
      fractionator_allocations: update([
        ...(draft?.fractionator_allocations || createFlowDraft(systemRef.current).fractionator_allocations),
      ]),
    }));
  };
  const setSandFilterAllocations = (update: (allocations: any[]) => any[]) => {
    setFlowForm((draft: any) => ({
      ...(draft || createFlowDraft(systemRef.current)),
      sand_filter_allocations: update([
        ...(draft?.sand_filter_allocations || createFlowDraft(systemRef.current).sand_filter_allocations),
      ]),
    }));
  };
  const [flowViewMode, setFlowViewMode] = useState<FlowViewMode>(getStoredFlowViewMode);
  const [flowUnit, setFlowUnit] = useState<'M3H' | 'LS' | 'US_GPM' | 'IMP_GPM'>('M3H');
  const [expandedCardLoops, setExpandedCardLoops] = useState<number[]>([1]);
  const [listEditRow, setListEditRow] = useState<number | null>(null);
  const [listRowForm, setListRowForm] = useState<any>(null);
  const [listRowOriginal, setListRowOriginal] = useState<any>(null);
  const setLRF = (k: string, v: any) => {
    setListRowForm((f: any) => ({ ...f, [k]: v }));
    if (listEditRow !== null) {
      const draftKey = `loop${listEditRow}_${k}`;
      setFlowForm((f: any) => ({ ...(f || createFlowDraft(systemRef.current)), [draftKey]: v }));
    }
  };

  const beginInlineLoopRename = (loopNumber: number) => {
    const source = flowForm || systemRef.current;
    setInlineLoopRename({
      loopNumber,
      value: String(source?.[`loop${loopNumber}_name`] || `Loop ${loopNumber}`),
    });
  };

  const commitInlineLoopRename = () => {
    if (!inlineLoopRename) return;
    const value = inlineLoopRename.value.trim();
    if (!value) {
      toast.error(`Loop ${inlineLoopRename.loopNumber} name is required`);
      return;
    }
    if (value.length > 255) {
      toast.error(`Loop ${inlineLoopRename.loopNumber} name must be 255 characters or fewer`);
      return;
    }
    setFF(`loop${inlineLoopRename.loopNumber}_name`, value);
    setInlineLoopRename(null);
  };

  useEffect(() => {
    storeFlowViewMode(flowViewMode);
  }, [flowViewMode]);

  useEffect(() => {
    const closeToolsMenu = () => setShowToolsMenu(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showToolsMenu) {
        closeToolsMenu();
        return;
      }
      if (event.defaultPrevented || isEditingField(event.target)) return;
      if (showAddExhibit) {
        setShowAddExhibit(false);
        return;
      }
      if (editLink) {
        setEditLink(null);
        return;
      }
      if (pendingUnlinkLink) {
        cancelDeleteLink();
        return;
      }
      navigate(-1);
    };

    document.addEventListener('keydown', handleKeyDown);
    if (!showToolsMenu) {
      return () => document.removeEventListener('keydown', handleKeyDown);
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (!toolsMenuRef.current?.contains(event.target as Node)) closeToolsMenu();
    };
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editLink, navigate, pendingUnlinkLink, showAddExhibit, showToolsMenu]);

  const hasUnsavedFlowChanges = Boolean(
    system && flowForm && !flowDraftMatchesSystem(flowForm, system),
  );

  const handleTabChange = (nextTab: LssTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', nextTab);
    navigate({
      pathname: location.pathname,
      search: `?${nextParams.toString()}`,
      hash: location.hash,
    });
    setShowToolsMenu(false);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: LssTab) => {
    const currentIndex = LSS_TABS.findIndex(item => item.id === tab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % LSS_TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + LSS_TABS.length) % LSS_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = LSS_TABS.length - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    const nextTab = LSS_TABS[nextIndex].id;
    handleTabChange(nextTab);
    const nextTabElement = tabRefs.current[nextTab];
    nextTabElement?.focus();
    nextTabElement?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  useEffect(() => {
    if (!hasUnsavedFlowChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedFlowChanges]);

  useEffect(() => {
    if (!hasUnsavedFlowChanges) return;

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const currentHistoryIndex = window.history.state?.idx;
    let restoringHistory = false;

    const shouldAllowNavigation = (url?: string | URL | null) => {
      if (!url) return true;
      const destination = new URL(String(url), window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === location.pathname) return true;
      return window.confirm(FLOW_UNSAVED_CONFIRMATION);
    };

    window.history.pushState = (state, unused, url) => {
      if (shouldAllowNavigation(url)) originalPushState(state, unused, url);
    };
    window.history.replaceState = (state, unused, url) => {
      if (shouldAllowNavigation(url)) originalReplaceState(state, unused, url);
    };

    const handlePopState = (event: PopStateEvent) => {
      if (restoringHistory) {
        restoringHistory = false;
        return;
      }
      const nextHistoryIndex = event.state?.idx;
      const nextUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const currentUrl = `${location.pathname}${location.search}${location.hash}`;
      if (
        nextUrl === currentUrl
        || window.location.pathname === location.pathname
        || window.confirm(FLOW_UNSAVED_CONFIRMATION)
      ) return;

      restoringHistory = true;
      event.stopImmediatePropagation();
      window.history.go(
        typeof currentHistoryIndex === 'number' && typeof nextHistoryIndex === 'number'
          ? currentHistoryIndex - nextHistoryIndex
          : 1,
      );
    };

    window.addEventListener('popstate', handlePopState, true);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', handlePopState, true);
    };
  }, [hasUnsavedFlowChanges, location.pathname, location.search]);

  const clearFlowDraft = () => {
    setInlineLoopRename(null);
    setFlowForm(null);
    setFlowEditMode(false);
    setListEditRow(null);
    setListRowForm(null);
    setListRowOriginal(null);
    setExpandedCardLoops([1]);
  };

  const getFlowDraftRow = (draft: any, n: number) => ({
    name: draft[`loop${n}_name`] || `Loop ${n}`,
    flow_source: draft[`loop${n}_flow_source`] || '',
    flow_mode: draft[`loop${n}_flow_mode`] === 'matched' ? 'matched' : 'allocated',
    match_loop_number: draft[`loop${n}_match_loop_number`] != null ? draft[`loop${n}_match_loop_number`] : '',
    filtration: draft[`loop${n}_filtration`] || '',
    flow_pct: draft[`loop${n}_flow_pct`] != null ? draft[`loop${n}_flow_pct`] : '',
    bio_degas_pct: draft[`loop${n}_bio_degas_pct`] != null ? draft[`loop${n}_bio_degas_pct`] : '',
    bio_degas_m3h: draft[`loop${n}_bio_degas_m3h`] != null ? draft[`loop${n}_bio_degas_m3h`] : '',
    link_bio_degas: !!draft[`loop${n}_link_bio_degas`],
  });

  const handleFlowViewChange = (nextView: FlowViewMode) => {
    if (nextView === flowViewMode) return;

    if (nextView === 'card' && flowForm) {
      const visibleLoops = [1, 2, 3].filter(n =>
        n === 1 ||
        flowDraftLoopHasData(flowForm, n) ||
        expandedCardLoops.includes(n) ||
        n === listEditRow,
      );
      setExpandedCardLoops(visibleLoops);
      setFlowEditMode(true);
    } else {
      setFlowEditMode(false);
      if (nextView === 'list' && listEditRow !== null && flowForm) {
        setListRowForm(getFlowDraftRow(flowForm, listEditRow));
      }
    }
    setFlowViewMode(nextView);
  };

  const startEdit = () => {
    const flowSource = systemCalculation?.inputs?.design_flow_source || 'linked_exhibits';
    const turnoverSource = systemCalculation?.inputs?.turnover_source || 'primary_exhibit';
    const flowVal = systemCalculation?.results?.design_flow_m3h != null
      ? String(systemCalculation.results.design_flow_m3h)
      : '';
    const turnoverVal = systemCalculation?.results?.turnover_rate_cycles_per_hour != null
      ? String(systemCalculation.results.turnover_rate_cycles_per_hour)
      : '';

    setEditForm({
      system_code:         system.system_code,
      system_name:         system.system_name,
      system_type:         system.system_type || '',
      water_type:          system.water_type  || '',
      design_flow_m3h:     flowVal,
      turnover_rate_hr:    turnoverVal,
      design_flow_source:  flowSource,
      turnover_source:     turnoverSource,
      status:              system.status            || 'Draft',
      duty_description:    system.duty_description  || '',
      redundancy_strategy: system.redundancy_strategy || '',
    });
    setEditMode(true);
  };

  const handleSaveSystem = async () => {
    if (!editForm.system_name.trim()) return toast.error('System name is required');
    setEditSaving(true);
    try {
      const flowFields = buildFlowLoopFields(system);
      await api.put(`/systems/${systemId}`, {
        system_code:          editForm.system_code,
        system_name:          editForm.system_name,
        system_type:          editForm.system_type   || null,
        water_type:           editForm.water_type    || null,
        design_flow_m3h:      editForm.design_flow_m3h    ? parseFloat(editForm.design_flow_m3h)   : null,
        turnover_rate_hr:     editForm.turnover_rate_hr   ? parseFloat(editForm.turnover_rate_hr)  : null,
        design_flow_source:   editForm.design_flow_source,
        turnover_source:      editForm.turnover_source,
        status:               editForm.status,
        duty_description:     editForm.duty_description   || null,
        redundancy_strategy:  editForm.redundancy_strategy || null,
        system_config:        system.system_config        || null,
        compact_unit_id:      system.compact_unit_id      || null,
        design_book_id:       bookId,
        ...flowFields,
      });
      toast.success('System updated');
      setEditMode(false);
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  const requestDeleteLink = (link: any) => {
    setUnlinkError(null);
    setPendingUnlinkLink(link);
  };

  const cancelDeleteLink = () => {
    if (deletingLink) return;
    setPendingUnlinkLink(null);
    setUnlinkError(null);
  };

  const handleDeleteLink = async () => {
    if (!pendingUnlinkLink || deletingLink) return;
    const link = pendingUnlinkLink;
    setDeletingLink(link.id);
    setUnlinkError(null);
    try {
      await api.delete(`/systems/${systemId}/exhibit-links/${link.id}`);
      setPendingUnlinkLink(null);
      toast.success('Link removed');
      refresh();
    } catch (err: any) {
      const message = err?.response?.data?.error?.message || 'Failed to remove link. Check your connection and try again.';
      setUnlinkError(message);
      toast.error(message);
    } finally {
      setDeletingLink(null);
    }
  };

  const saveSystemConfig = async (config: 'compact' | 'bespoke', unitId?: string) => {
    if (config === 'compact' && !unitId) {
      setPendingConfig('compact');
      return;
    }
    setConfigSaving(true);
    try {
      const flowFields = buildFlowLoopFields(system);
      await api.put(`/systems/${systemId}`, {
        system_code:         system.system_code,
        system_name:         system.system_name,
        system_type:         system.system_type          || null,
        water_type:          system.water_type           || null,
        status:              system.status,
        design_flow_m3h:     system.design_flow_m3h      || null,
        turnover_rate_hr:    system.turnover_rate_hr     || null,
        duty_description:    system.duty_description     || null,
        redundancy_strategy: system.redundancy_strategy  || null,
        system_config:   config,
        compact_unit_id: config === 'compact' ? (unitId || null) : null,
        design_book_id:  bookId,
        ...flowFields,
      });
      toast.success(config === 'compact' ? 'Set to Compact Unit' : 'Set to Bespoke System');
      setPendingConfig(null);
      setPendingUnitId('');
      refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to update system configuration');
    } finally {
      setConfigSaving(false);
    }
  };

  const requestConfigReset = () => {
    setShowToolsMenu(false);
    setConfigResetError(null);
    setShowConfigReset(true);
  };

  const cancelConfigReset = () => {
    if (configResetSaving) return;
    setShowConfigReset(false);
    setConfigResetError(null);
  };

  const handleConfigReset = async () => {
    if (configResetSaving) return;
    setConfigResetSaving(true);
    setConfigResetError(null);
    try {
      const response = await api.post(`/systems/${systemId}/configuration-reset`, {
        design_book_id: bookId,
      });
      clearFlowDraft();
      setEditMode(false);
      setPendingConfig(null);
      setPendingUnitId('');
      setShowConfigReset(false);
      if (response.data?.system) {
        qc.setQueryData(['system', systemId], (current: any) => ({
          ...current,
          ...response.data.system,
        }));
      }
      qc.setQueryData(['system-exhibit-links', systemId], []);
      qc.setQueryData(['design-book', bookId], (current: any) => current ? ({
        ...current,
        systems: (current.systems || []).map((item: any) =>
          item.id === systemId ? { ...item, ...(response.data?.system || {}) } : item),
        system_links: (current.system_links || []).filter(
          (item: any) => item.system_id !== systemId),
        engineering_calculations: {
          ...(current.engineering_calculations || {}),
          systems: (current.engineering_calculations?.systems || []).filter(
            (calculation: any) => calculation.inputs?.system_id !== systemId),
        },
      }) : current);
      qc.invalidateQueries({ queryKey: ['system', systemId] });
      qc.invalidateQueries({ queryKey: ['system-exhibit-links', systemId] });
      qc.invalidateQueries({ queryKey: ['design-book', bookId] });
      qc.invalidateQueries({ queryKey: ['uv-selection', bookId, systemId] });
      toast.success('System configuration reset');
    } catch (error: any) {
      const message = error?.response?.data?.error?.message
        || 'The system configuration could not be reset. No data was changed.';
      setConfigResetError(message);
      toast.error(message);
    } finally {
      setConfigResetSaving(false);
    }
  };

  const startFlowEdit = (addLoop?: number) => {
    const draft = flowForm || createFlowDraft(system);
    const active = [1, 2, 3].filter(n => flowDraftLoopHasData(draft, n));
    const expanded = addLoop && !active.includes(addLoop)
      ? [...active, addLoop]
      : (active.length > 0 ? active : [1]);
    setExpandedCardLoops(expanded);
    setFlowForm(draft);
    setFlowEditMode(true);
  };

  const saveFlowRoute = async () => {
    const validationMessage = flowAllocationError(
      flowForm || {},
      totalSystemAllocationPctFor(flowForm || {}),
    );
    if (validationMessage) return toast.error(validationMessage);
    setFlowSaving(true);
    try {
      await api.put(`/systems/${systemId}`, {
        system_code:          system.system_code,
        system_name:          system.system_name,
        system_type:          system.system_type          || null,
        water_type:           system.water_type           || null,
        status:               system.status,
        design_flow_m3h:      system.design_flow_m3h      || null,
        turnover_rate_hr:     system.turnover_rate_hr     || null,
        duty_description:     system.duty_description     || null,
        redundancy_strategy:  system.redundancy_strategy  || null,
        system_config:        system.system_config        || null,
        compact_unit_id:      system.compact_unit_id      || null,
        design_book_id:       bookId,
        ...buildFlowLoopFields(flowForm),
      });
      toast.success('Flow route saved');
      clearFlowDraft();
      refresh();
      await qc.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
      await refreshUvSelection();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to save flow route');
    } finally {
      setFlowSaving(false);
    }
  };

  const saveListRow = async (n: number) => {
    if (!listRowForm) return;
    const draft = { ...(flowForm || createFlowDraft(system) as any) };
    for (const key of FLOW_LOOP_FIELDS) {
      draft[`loop${n}_${key}`] = listRowForm[key];
    }
    const validationMessage = flowAllocationError(draft, totalSystemAllocationPctFor(draft));
    if (validationMessage) return toast.error(validationMessage);
    setFlowSaving(true);
    try {
      await api.put(`/systems/${systemId}`, {
        system_code:         system.system_code,
        system_name:         system.system_name,
        system_type:         system.system_type         || null,
        water_type:          system.water_type          || null,
        status:              system.status,
        design_flow_m3h:     system.design_flow_m3h     || null,
        turnover_rate_hr:    system.turnover_rate_hr    || null,
        duty_description:    system.duty_description    || null,
        redundancy_strategy: system.redundancy_strategy || null,
        system_config:       system.system_config       || null,
        compact_unit_id:     system.compact_unit_id     || null,
        design_book_id:      bookId,
        ...buildFlowLoopFields(draft),
      });
      toast.success(`Loop ${n} saved`);
      // Await refetch so the loop stays visible in the list until new data arrives
      await qc.refetchQueries({ queryKey: ['system', systemId] });
      qc.invalidateQueries({ queryKey: ['design-book', bookId] });
      await qc.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
      await refreshUvSelection();
      setListEditRow(null);
      setListRowForm(null);
      setListRowOriginal(null);
      setFlowForm(null);
      setFlowEditMode(false);
      setExpandedCardLoops([1]);
    } catch {
      toast.error('Failed to save loop');
    } finally {
      setFlowSaving(false);
    }
  };

  const deleteLoop = async (n: number) => {
    if (!confirm(`Remove Loop ${n}? This will clear all its configuration.`)) return;
    setFlowSaving(true);
    try {
      const draft = flowForm || createFlowDraft(system);
      await api.put(`/systems/${systemId}`, {
        system_code:         system.system_code,
        system_name:         system.system_name,
        system_type:         system.system_type         || null,
        water_type:          system.water_type          || null,
        status:              system.status,
        design_flow_m3h:     system.design_flow_m3h     || null,
        turnover_rate_hr:    system.turnover_rate_hr    || null,
        duty_description:    system.duty_description    || null,
        redundancy_strategy: system.redundancy_strategy || null,
        system_config:       system.system_config       || null,
        compact_unit_id:     system.compact_unit_id     || null,
        design_book_id:      bookId,
        ...buildFlowLoopFields(draft, n),
      });
      toast.success(`Loop ${n} removed`);
      clearFlowDraft();
      refresh();
      await refreshUvSelection();
    } catch {
      toast.error('Failed to remove loop');
    } finally {
      setFlowSaving(false);
    }
  };

  if (sysLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-stone-100 rounded w-64" />
          <div className="h-32 bg-stone-100 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (!system) {
    return (
      <div className="p-6 max-w-5xl mx-auto text-center py-16">
        <AlertCircle className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500">System not found.</p>
      </div>
    );
  }

  const exhibits: any[] = book?.exhibits || [];
  const linkedExhibitIds = new Set((links as any[]).map((l: any) => l.exhibit_id));
  const availableExhibits = exhibits.filter((ex: any) => !linkedExhibitIds.has(ex.id));
  const linkedExhibitPathFor = (exhibitId: unknown): string | null => {
    const normalizedId = exhibitId == null ? '' : String(exhibitId).trim();
    if (!bookId || !normalizedId || !exhibits.some((exhibit: any) => String(exhibit.id) === normalizedId)) {
      return null;
    }
    return `/design-books/${bookId}/exhibits/${encodeURIComponent(normalizedId)}`;
  };
  const canManageProjects = user?.moduleAccess?.projects !== 'view'
    && user?.moduleAccess?.projects !== 'hidden';
  const canEdit = (user?.role === 'admin' || user?.role === 'engineer') && canManageProjects;
  const canCreateRevision = book?.status === 'Released'
    && (user?.role === 'admin' || user?.role === 'engineer');
  const retired = ['Archived', 'Decommissioned', 'Superseded'].includes(system.status);
  const readOnly = !canEdit
    || (!!book && !['Draft', 'In Progress'].includes(book.status))
    || ['For Review', 'Approved', 'Released'].includes(system.status)
    || retired;
  const isConfigured = system.system_config === 'compact' || system.system_config === 'bespoke';
  const replacementCandidates = (book?.systems || []).filter((candidate: any) =>
    candidate.id !== system.id
    && isLssType(candidate.system_type)
    && !['Archived', 'Decommissioned', 'Superseded'].includes(candidate.status));

  const closeLifecycleDialog = () => {
    if (lifecycleSaving) return;
    setLifecycleAction(null);
    setLifecycleReason('');
    setReplacementSystemId('');
  };

  const saveLifecycle = async () => {
    if (!lifecycleAction || !lifecycleReason.trim()) return;
    if (lifecycleAction === 'supersede' && !replacementSystemId) return;
    setLifecycleSaving(true);
    try {
      await api.post(`/systems/${systemId}/${lifecycleAction}`, {
        reason: lifecycleReason.trim(),
        ...(lifecycleAction === 'supersede' ? { replacement_system_id: replacementSystemId } : {}),
      });
      toast.success(lifecycleAction === 'archive' ? 'LSS archived/decommissioned' : 'LSS superseded');
      setLifecycleAction(null);
      setLifecycleReason('');
      setReplacementSystemId('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['system', systemId] }),
        qc.invalidateQueries({ queryKey: ['design-book', bookId] }),
      ]);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Lifecycle change failed');
    } finally {
      setLifecycleSaving(false);
    }
  };

  const systemCalculation = book?.engineering_calculations?.systems?.find(
    (calculation: any) => calculation.inputs?.system_id === system.id,
  ) ?? null;
  const calculatedSystemFlow = systemCalculation?.results?.design_flow_m3h;
  const systemFlow = calculatedSystemFlow == null ? null : Number(calculatedSystemFlow);
  const totalSystemAllocationPctFor = (draft: Record<string, any>): number | null => {
    if (systemFlow == null || !(systemFlow > 0)) return null;
    const sourceFlows = systemCalculation?.inputs?.source_flows_m3h || {};
    const sourceResultKeys: Record<string, string> = {
      'Surface Skim': 'surface_skim_flow_m3h',
      'Bottom Drain': 'bottom_drain_flow_m3h',
      'Both Integrated': 'total_return_flow_m3h',
    };
    const sourceFlowFor = (source: string): number | null => {
      if (Object.prototype.hasOwnProperty.call(sourceFlows, source)) {
        return nullableNumber(sourceFlows[source]);
      }
      const resultKey = sourceResultKeys[source];
      if (!resultKey) return systemFlow;
      if (!(links as any[]).length) return null;
      const linkedCalculations = (links as any[]).map((link: any) =>
        exhibitCalculations.find((calculation: any) =>
          String(calculation.inputs?.exhibit_id) === String(link.exhibit_id)));
      if (linkedCalculations.some((calculation: any) =>
        !calculation || calculation.status !== 'valid' ||
        calculation.is_stale === true || calculation.freshness === 'stale' ||
        nullableNumber(calculation.results?.[resultKey]) == null)) return null;
      return linkedCalculations.reduce(
        (sum: number, calculation: any) => sum + Number(calculation.results[resultKey]),
        0,
      );
    };
    const allocatedFlow = [1, 2, 3].reduce((sum, loopNumber) => {
      if (draft[`loop${loopNumber}_flow_mode`] === 'matched') return sum;
      const percentage = nullableNumber(draft[`loop${loopNumber}_flow_pct`]);
      if (percentage == null) return sum;
      const source = String(draft[`loop${loopNumber}_flow_source`] || '');
      const basisFlow = sourceFlowFor(source);
      return basisFlow == null ? sum : sum + basisFlow * percentage / 100;
    }, 0);
    return allocatedFlow / systemFlow * 100;
  };
  const exhibitCalculations: any[] = book?.engineering_calculations?.exhibits || [];

  // Values come exclusively from the API calculation contract.
  const exhibitFlowMap = new Map<string, number | null>();
  const exhibitTurnoverMap = new Map<string, number | null>();
  (links as any[]).forEach((l: any) => {
    const calculation = exhibitCalculations.find(
      (candidate: any) => candidate.inputs?.exhibit_id === l.exhibit_id,
    );
    exhibitFlowMap.set(l.exhibit_id, calculation?.results?.total_return_flow_m3h ?? null);
    exhibitTurnoverMap.set(
      l.exhibit_id,
      calculation?.inputs?.target_turnover_rate_cycles_per_hour ??
        calculation?.results?.turnover_rate_cycles_per_hour ??
        null,
    );
  });
  const totalCalculatedFlow = systemCalculation?.results?.calculated_required_flow_m3h ?? 0;

  const setEF = (k: string, v: string) => setEditForm((f: any) => ({ ...f, [k]: v }));
  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Modals */}
      {showAddExhibit && !readOnly && (
        <AddExhibitModal
          systemId={systemId!}
          availableExhibits={availableExhibits}
          onClose={() => setShowAddExhibit(false)}
          onAdded={() => { setShowAddExhibit(false); refresh(); }}
        />
      )}
      {editLink && !readOnly && (
        <EditLinkModal
          link={editLink}
          systemId={systemId!}
          onClose={() => setEditLink(null)}
          onSaved={() => { setEditLink(null); refresh(); }}
        />
      )}
      {showNewRevision && canCreateRevision && (
        <NewRevisionModal
          book={book}
          destination={{ systemId: systemId!, tab: 'uv' }}
          onClose={() => setShowNewRevision(false)}
        />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500">
        <Link to="/design-book-engine" className="hover:text-blue-600 transition-colors">Design Book Engine</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to="/design-books" className="hover:text-blue-600 transition-colors">Design Books</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to={`/design-books/${bookId}`} className="hover:text-blue-600 transition-colors">
          {book?.book_code || '…'}
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to={`/design-books/${bookId}?tab=lss`} className="hover:text-blue-600 transition-colors">
          Life Support Systems
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-stone-800 font-medium">{system.system_code}</span>
      </nav>
      {readOnly && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${
          retired ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}>
          <LockKeyhole className="w-4 h-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {retired
                ? `${system.status} LSS — historical record is read-only.`
                : 'Released revision — LSS configuration and Flow Route data are read-only.'}
            </p>
            {retired && system.lifecycle_changed_at && (
              <p className="mt-1 text-xs">
                {new Date(system.lifecycle_changed_at).toLocaleString()}
                {system.lifecycle_actor_name ? ` by ${system.lifecycle_actor_name}` : ''}
                {system.lifecycle_reason ? ` — ${system.lifecycle_reason}` : ''}
              </p>
            )}
            {system.status === 'Superseded' && system.superseded_by_system_id && (
              <Link
                to={`/design-books/${bookId}/lss/${system.superseded_by_system_id}`}
                className="mt-1 inline-flex text-xs font-semibold underline"
              >
                Replacement: {system.replacement_system_code || system.replacement_system_name || 'View current LSS'}
              </Link>
            )}
          </div>
          {activeTab === 'uv' && canCreateRevision && (
            <button
              type="button"
              onClick={() => setShowNewRevision(true)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700"
            >
              <GitFork className="h-3.5 w-3.5" />
              Create Draft Revision
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Link
          to={`/design-books/${bookId}?tab=lss`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl px-4 py-2.5 shadow-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Life Support Systems
        </Link>
        <div className="relative" ref={toolsMenuRef}>
          <button
            type="button"
            onClick={() => setShowToolsMenu(current => !current)}
            aria-label="Open LSS tools"
            aria-expanded={showToolsMenu}
            className="inline-flex items-center justify-center w-10 h-10 text-stone-600 hover:text-stone-800 border border-stone-200 rounded-xl bg-white hover:bg-stone-50 transition-colors"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
          {showToolsMenu && (
            <div
              className="absolute right-0 top-full mt-2 z-30 w-56 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl"
              role="menu"
              aria-label="LSS tools"
            >
              <Link
                to={`/design-books/${bookId}?tab=lss`}
                onClick={() => setShowToolsMenu(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                role="menuitem"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Life Support Systems
              </Link>
              <div className="my-1 border-t border-stone-100" />
              {isConfigured && !readOnly && (
                <>
                  <button
                    type="button"
                    onClick={requestConfigReset}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
                    role="menuitem"
                  >
                    <Settings2 className="w-4 h-4" />
                    Change System Configuration
                  </button>
                  <div className="my-1 border-t border-stone-100" />
                </>
              )}
              {!retired && canEdit && book && ['Draft', 'In Progress'].includes(book.status) && (
                <>
                  <button
                    type="button"
                    onClick={() => { setShowToolsMenu(false); setLifecycleAction('archive'); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-amber-800 hover:bg-amber-50"
                    role="menuitem"
                  >
                    <Archive className="w-4 h-4" />
                    Archive / Decommission LSS
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowToolsMenu(false); setLifecycleAction('supersede'); }}
                    disabled={replacementCandidates.length === 0}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                    role="menuitem"
                  >
                    <GitCompare className="w-4 h-4" />
                    Supersede LSS
                  </button>
                  <div className="my-1 border-t border-stone-100" />
                </>
              )}
              {[
                ['overview', 'linked-exhibits', 'Linked Exhibits'],
                ['flow', 'flow-route', 'Flow Route'],
                ['pump', 'pump-selection', 'Pump Selection'],
              ].map(([tab, target, label]) => (
                <Link
                  key={target}
                  to={`/design-books/${bookId}/lss/${systemId}?tab=${tab}#${target}`}
                  onClick={() => setShowToolsMenu(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
                  role="menuitem"
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <h1 className="sr-only">{system.system_name}</h1>

      <div
        role="tablist"
        aria-label="Life Support System sections"
        className="flex border-b border-slate-200 overflow-x-auto"
      >
        {LSS_TABS.map(tab => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={element => {
                tabRefs.current[tab.id] = element || undefined;
              }}
              id={`lss-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`lss-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => handleTabChange(tab.id)}
              onKeyDown={event => handleTabKeyDown(event, tab.id)}
              className={`px-2 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 sm:px-4 sm:text-sm ${
                selected
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {tab.id === 'flow' && hasUnsavedFlowChanges && (
                <span className="ml-1.5 text-amber-600" aria-label="unsaved changes">*</span>
              )}
            </button>
          );
        })}
      </div>

      <fieldset disabled={readOnly} className={`contents ${readOnly ? 'opacity-90' : ''}`}>
      <div
        id="lss-panel-overview"
        role="tabpanel"
        aria-labelledby="lss-tab-overview"
        tabIndex={0}
        hidden={activeTab !== 'overview'}
        className="space-y-5"
      >
      {/* System Configuration selector */}
      {!isConfigured && (() => {
        const cfg = pendingConfig;
        const localUnitId = pendingUnitId || system.compact_unit_id || '';
        const selectedUnit = (availableCompactUnits as any[]).find(u => u.id === localUnitId);

        return (
          <div id="system-configuration" className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-stone-100 bg-stone-50/50 flex items-center gap-2">
              <Layers className="w-4 h-4 text-stone-500" />
              <span className="text-sm font-semibold text-stone-700">System Configuration</span>
            </div>
            <div className="p-5 space-y-4">
              {/* Choice cards */}
              <div className="grid grid-cols-2 gap-3">
                {([
                  {
                    key: 'compact' as const,
                    title: 'Compact Unit',
                    desc: 'Select a packaged LSS unit from the catalog — pre-defined flow, volume and filtration',
                    icon: <Layers className="w-5 h-5" />,
                    color: cfg === 'compact' ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-300/50' : 'border-stone-200 hover:border-violet-300 hover:bg-violet-50/30',
                    textColor: cfg === 'compact' ? 'text-violet-800' : 'text-stone-700',
                  },
                  {
                    key: 'bespoke' as const,
                    title: 'Bespoke / Large System',
                    desc: 'Custom-designed system — configure loops, filtration and bio/degas flow manually',
                    icon: <Route className="w-5 h-5" />,
                    color: cfg === 'bespoke' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300/50' : 'border-stone-200 hover:border-blue-300 hover:bg-blue-50/30',
                    textColor: cfg === 'bespoke' ? 'text-blue-800' : 'text-stone-700',
                  },
                ] as const).map(opt => (
                  <button key={opt.key} type="button" disabled={configSaving}
                    onClick={() => {
                      if (opt.key === 'compact') {
                        setPendingConfig('compact');
                        if (localUnitId) saveSystemConfig('compact', localUnitId);
                      } else {
                        setPendingConfig(null);
                        saveSystemConfig('bespoke');
                      }
                    }}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${opt.color} disabled:opacity-60`}>
                    <div className={`flex items-center gap-2 mb-1.5 font-semibold text-sm ${opt.textColor}`}>
                      {opt.icon} {opt.title}
                      {cfg === opt.key && <Check className="w-3.5 h-3.5 ml-auto" />}
                    </div>
                    <p className="text-xs text-stone-500 leading-relaxed">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Compact unit picker */}
              {cfg === 'compact' && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">Select Unit from Catalog</label>
                      <select
                        value={localUnitId}
                        onChange={e => {
                          setPendingUnitId(e.target.value);
                          if (e.target.value) saveSystemConfig('compact', e.target.value);
                        }}
                        className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white"
                      >
                        <option value="">— Choose a compact unit —</option>
                        {(availableCompactUnits as any[]).map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.unit_code} — {u.unit_name}{u.water_type ? ` (${u.water_type})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Link to="/lss-compact-units"
                      className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-2.5 py-2 mt-5 whitespace-nowrap transition-colors">
                      <Layers className="w-3 h-3" /> Manage Catalog
                    </Link>
                  </div>

                  {/* Selected unit spec card */}
                  {selectedUnit && (
                    <div className="bg-violet-50/50 border border-violet-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-mono text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded">{selectedUnit.unit_code}</span>
                          <h3 className="font-semibold text-stone-800 mt-1">{selectedUnit.unit_name}</h3>
                          {selectedUnit.manufacturer && <p className="text-xs text-stone-500">{selectedUnit.manufacturer}</p>}
                        </div>
                        {selectedUnit.product_master_id && (
                          <Link to={`/products/masters/${selectedUnit.product_master_id}`}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 bg-white rounded-lg px-2.5 py-1.5 transition-colors">
                            <Package className="w-3 h-3" /> {selectedUnit.product_code}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </Link>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        {[
                          { label: 'Tank Volume', value: selectedUnit.min_tank_volume_m3 != null ? `${selectedUnit.min_tank_volume_m3}–${selectedUnit.max_tank_volume_m3 ?? '?'} m³` : null },
                          { label: 'Design Flow', value: selectedUnit.design_flow_m3h != null ? `${parseFloat(selectedUnit.design_flow_m3h).toFixed(1)} m³/h` : null },
                          { label: 'Break Tank', value: selectedUnit.break_tank_volume_l != null ? `${parseFloat(selectedUnit.break_tank_volume_l).toFixed(0)} L` : null },
                          { label: 'Power', value: selectedUnit.power_kw != null ? `${parseFloat(selectedUnit.power_kw).toFixed(1)} kW` : null },
                          { label: 'Filtration', value: summarizeFiltration(selectedUnit.equipment || [], selectedUnit.includes_filtration) },
                          { label: 'UV', value: selectedUnit.uv_power_w != null ? `${selectedUnit.uv_power_w} W` : null },
                          { label: 'Footprint', value: selectedUnit.footprint_l_mm != null ? `${selectedUnit.footprint_l_mm}×${selectedUnit.footprint_w_mm} mm` : null },
                          { label: 'Dry Weight', value: selectedUnit.dry_weight_kg != null ? `${selectedUnit.dry_weight_kg} kg` : null },
                        ].filter(s => s.value).map(s => (
                          <div key={s.label} className="bg-white/70 rounded-lg p-2 border border-violet-100">
                            <div className="text-stone-400 mb-0.5">{s.label}</div>
                            <div className="font-mono font-semibold text-stone-700">{s.value}</div>
                          </div>
                        ))}
                      </div>
                      {selectedUnit.notes && (
                        <p className="text-xs text-stone-500 leading-relaxed border-t border-violet-100 pt-2">{selectedUnit.notes}</p>
                      )}
                    </div>
                  )}
                  {selectedUnit && systemCalculation?.suitability && (
                    <div className={`flex items-start gap-2 text-xs rounded-lg border px-4 py-3 ${
                      systemCalculation.suitability.suitable
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                      {systemCalculation.suitability.suitable
                        ? <Check className="w-4 h-4 shrink-0" />
                        : <AlertCircle className="w-4 h-4 shrink-0" />}
                      <div>
                        <p className="font-semibold">
                          {systemCalculation.suitability.suitable ? 'Catalog limits are suitable' : 'Compact unit is not suitable'}
                        </p>
                        {systemCalculation.suitability.reasons?.map((reason: string) => (
                          <p key={reason} className="mt-0.5">{reason}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {!selectedUnit && (availableCompactUnits as any[]).length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-stone-400 bg-stone-50 border border-stone-200 rounded-lg px-4 py-3">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      No units in the catalog yet.{' '}
                      <Link to="/lss-compact-units" className="text-violet-600 hover:underline">Add units to the catalog</Link> first.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* System header card */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        {editMode && editForm ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">System Code</label>
                <input value={editForm.system_code} onChange={e => setEF('system_code', e.target.value.toUpperCase())}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Status</label>
                <select value={editForm.status} onChange={e => setEF('status', e.target.value)} className={`${inputCls} bg-white`}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">System Name</label>
              <input value={editForm.system_name} onChange={e => setEF('system_name', e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Type</label>
                <select value={editForm.system_type} onChange={e => setEF('system_type', e.target.value)} className={`${inputCls} bg-white`}>
                  <option value="">— Select —</option>
                  {SYSTEM_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Water Type</label>
                <select value={editForm.water_type} onChange={e => setEF('water_type', e.target.value)} className={`${inputCls} bg-white`}>
                  <option value="">— Select —</option>
                  {WATER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Design Flow (m³/h)</label>
                <input type="number" step="0.1" min="0" value={editForm.design_flow_m3h}
                  onChange={e => setEditForm((form: any) => ({
                    ...form,
                    design_flow_m3h: e.target.value,
                    design_flow_source: 'manual_override',
                  }))} className={inputCls} />
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                  <span className={editForm.design_flow_source === 'manual_override' ? 'text-amber-700' : 'text-blue-700'}>
                    {editForm.design_flow_source === 'manual_override' ? 'Manual override' : 'Synced from linked exhibits'}
                  </span>
                  {editForm.design_flow_source === 'manual_override' && (
                    <button type="button" className="text-blue-700 hover:underline"
                      onClick={() => setEditForm((form: any) => ({
                        ...form,
                        design_flow_m3h: systemCalculation?.results?.calculated_required_flow_m3h != null
                          ? String(systemCalculation.results.calculated_required_flow_m3h)
                          : '',
                        design_flow_source: 'linked_exhibits',
                      }))}>
                      Use linked exhibits
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Turnover Rate (×/h)</label>
                <input type="number" step="0.1" min="0" value={editForm.turnover_rate_hr}
                  onChange={e => setEditForm((form: any) => ({
                    ...form,
                    turnover_rate_hr: e.target.value,
                    turnover_source: 'manual_override',
                  }))} className={inputCls} />
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                  <span className={editForm.turnover_source === 'manual_override' ? 'text-amber-700' : 'text-blue-700'}>
                    {editForm.turnover_source === 'manual_override' ? 'Manual override' : 'Synced from primary exhibit'}
                  </span>
                  {editForm.turnover_source === 'manual_override' && (
                    <button type="button" className="text-blue-700 hover:underline"
                      onClick={() => setEditForm((form: any) => ({
                        ...form,
                        turnover_rate_hr: systemCalculation?.results?.turnover_rate_cycles_per_hour != null
                          ? String(systemCalculation.results.turnover_rate_cycles_per_hour)
                          : '',
                        turnover_source: 'primary_exhibit',
                      }))}>
                      Use primary exhibit
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Duty Description</label>
              <textarea rows={2} value={editForm.duty_description} onChange={e => setEF('duty_description', e.target.value)}
                className={`${inputCls} resize-none`} placeholder="Describe the system duty and operating conditions…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Redundancy Strategy</label>
              <textarea rows={2} value={editForm.redundancy_strategy} onChange={e => setEF('redundancy_strategy', e.target.value)}
                className={`${inputCls} resize-none`} placeholder="e.g. N+1 duty/standby pumps, auto-changeover…" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={handleSaveSystem} disabled={editSaving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {editSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditMode(false)}
                className="px-4 py-2 text-sm text-stone-500 border border-stone-200 bg-white rounded-lg hover:text-stone-700">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded">
                      {system.system_code}
                    </span>
                    <StatusBadge status={system.status} />
                    {system.system_type && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        {system.system_type}
                      </span>
                    )}
                    <WaterTypeBadge type={system.water_type} />
                  </div>
                  <div className="text-xl font-bold text-stone-900 mt-1">{system.system_name}</div>
                  {system.duty_description && (
                    <p className="text-sm text-stone-500 mt-1 leading-relaxed max-w-2xl">{system.duty_description}</p>
                  )}
                </div>
              </div>
              <button onClick={startEdit}
                className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 border border-blue-200 bg-white rounded-md px-2.5 py-1.5 transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-3 mt-5">
              {[
                {
                  label: 'Design Flow',
                  value: systemFlow > 0 ? `${systemFlow.toFixed(1)} m³/h` : 'Unavailable',
                  detail: systemCalculation?.inputs?.design_flow_source === 'manual_override'
                    ? 'Manual override'
                    : 'Synced from linked exhibits',
                  icon: <Gauge className="w-4 h-4 text-cyan-600" />,
                  bg: 'bg-cyan-50',
                },
                {
                  label: 'Linked Exhibits',
                  value: (links as any[]).length,
                  detail: null,
                  icon: <GitBranch className="w-4 h-4 text-violet-500" />,
                  bg: 'bg-violet-50',
                },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-3 bg-stone-50/60 border border-stone-100 rounded-xl px-4 py-3">
                  <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>{c.icon}</div>
                  <div>
                    <div className="text-xs text-stone-500">{c.label}</div>
                    <div className="font-semibold text-stone-800 text-sm">{c.value}</div>
                    {c.detail && (
                      <div className={`text-[10px] ${c.detail === 'Manual override' ? 'text-amber-700' : 'text-stone-400'}`}>
                        {c.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {system.redundancy_strategy && (
              <div className="mt-4 px-4 py-3 bg-blue-50/60 border border-blue-200 rounded-xl text-sm text-stone-600">
                <span className="font-medium text-blue-800">Redundancy: </span>{system.redundancy_strategy}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Exhibit Links panel */}
      <div id="linked-exhibits" className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-blue-50/30">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-blue-800">Linked Exhibits</span>
            <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{(links as any[]).length}</span>
            {totalCalculatedFlow > 0 && (
              <span className="text-xs text-stone-500 ml-2">
                {totalCalculatedFlow.toFixed(1)} m³/h total
                {systemFlow > 0 && ` · design ${systemFlow.toFixed(1)} m³/h`}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowAddExhibit(true)}
            disabled={availableExhibits.length === 0}
            className="flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md px-2.5 py-1.5 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Link Exhibit
          </button>
        </div>

        {linksLoading ? (
          <div className="py-10 text-center text-stone-400 text-sm">Loading…</div>
        ) : (links as any[]).length === 0 ? (
          <div className="py-14 text-center">
            <GitBranch className="w-8 h-8 text-stone-200 mx-auto mb-2" />
            <p className="text-stone-400 text-sm font-medium">No exhibits linked yet</p>
            <p className="text-stone-400 text-xs mt-0.5">Click "Link Exhibit" to connect an exhibit to this system.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50/80">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Exhibit</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Water Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Link Type</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Design Flow m³/h</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Turnover ×/h</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Notes</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(links as any[]).map((link: any) => (
                  <tr key={link.id} className="border-t border-stone-100 hover:bg-blue-50/20 transition-colors">
                    <td className="px-4 py-3">
                      {(() => {
                        const exhibitPath = linkedExhibitPathFor(link.exhibit_id);
                        const exhibitLabel = [link.exhibit_code, link.exhibit_name].filter(Boolean).join(' — ')
                          || 'linked exhibit';
                        const identity = (
                          <>
                            <span className="font-mono text-xs text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{link.exhibit_code}</span>
                            <span className="font-medium text-stone-800">{link.exhibit_name}</span>
                          </>
                        );
                        return exhibitPath ? (
                          <Link
                            to={exhibitPath}
                            aria-label={`Open exhibit ${exhibitLabel}`}
                            title="Open exhibit detail"
                            className="flex items-center gap-2 rounded-md -mx-1 px-1 py-0.5 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                          >
                            {identity}
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2">
                            {identity}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <WaterTypeBadge type={link.exhibit_water_type} />
                    </td>
                    <td className="px-4 py-3">
                      <LinkTypeBadge type={link.link_type} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-stone-700">
                      {(() => {
                        const f = exhibitFlowMap.get(link.exhibit_id);
                        return link.flow_allocation_m3h != null
                          ? <span className="text-blue-700">{parseFloat(link.flow_allocation_m3h).toFixed(1)} <small className="block font-sans text-[10px]">manual override · calculated {f?.toFixed(1) ?? '—'}</small></span>
                          : f != null
                          ? <span>{f.toFixed(1)} <small className="block font-sans text-[10px] text-stone-400">calculated</small></span>
                          : <span className="text-stone-300 text-xs">no hydraulics</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-stone-700">
                      {(() => {
                        const turnover = exhibitTurnoverMap.get(link.exhibit_id);
                        return turnover != null
                          ? <span>{Number(turnover).toFixed(2)}</span>
                          : <span className="text-stone-300 text-xs">unavailable</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-stone-500 max-w-xs">
                      {link.notes
                        ? <span className="text-xs leading-snug">{link.notes}</span>
                        : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={`Edit link for ${link.exhibit_code || link.exhibit_name || 'linked exhibit'}`}
                          onClick={() => setEditLink(link)}
                          className="text-stone-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove link for ${link.exhibit_code || link.exhibit_name || 'linked exhibit'}`}
                          onClick={() => requestDeleteLink(link)}
                          disabled={deletingLink === link.id}
                          className="text-stone-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalCalculatedFlow > 0 && (
              <div className="border-t-2 border-stone-200 bg-stone-50/60 px-4 py-2 flex items-center justify-end gap-4 text-xs">
                <span className="text-stone-500">Total exhibit flow</span>
                <span className="font-mono font-semibold text-cyan-700">{totalCalculatedFlow.toFixed(1)} m³/h</span>
                {systemFlow != null && systemFlow > 0 && (
                  <>
                    <span className="text-stone-400">·</span>
                    <span className="text-stone-500">system design</span>
                    <span className="font-mono font-semibold text-blue-700">{systemFlow.toFixed(1)} m³/h</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <EngineeringTrace calculation={systemCalculation} />
      </div>

      {/* Flow Route panel */}
      {(() => {
        const isSaltwater = system.water_type === 'Marine' || system.water_type === 'Salt Water';
        const FILTRATION_OPTS = [
          { label: 'Foam Fractionation',     value: 'Foam Fractionation',     saltwaterOnly: true  },
          { label: 'Pressurized Bag Filter', value: 'Pressurized Bag Filter', saltwaterOnly: false },
          { label: 'Sand Filter',            value: 'Sand Filter',            saltwaterOnly: false },
        ];
        const bioLinkLabel = isSaltwater ? 'Link FF to Bio/Degas' : 'Link SF Loop to Bio/Degas';
        // System flow is selected exclusively by the current API calculation
        // contract, including an explicit manual override when configured.
        const systemFlow = calculatedSystemFlow == null
          ? null
          : Number(calculatedSystemFlow);

        // Unit conversion helpers
        const UNIT_FACTORS: Record<string, number> = {
          M3H: 1,
          LS: 1000 / 3600,
          US_GPM: 4.4028675,
          IMP_GPM: 3.6661541,
        };
        const UNIT_LABELS: Record<string, string> = {
          M3H: 'm³/h',
          LS: 'L/s',
          US_GPM: 'US GPM',
          IMP_GPM: 'Imperial GPM',
        };
        const fmtFlow = (m3h: number): string => {
          if (!(m3h > 0)) return '—';
          const val = m3h * UNIT_FACTORS[flowUnit];
          return `${val.toFixed(1)} ${UNIT_LABELS[flowUnit]}`;
        };
        const fmtReferenceFlow = (m3h: number | null): string => {
          if (m3h == null || !Number.isFinite(m3h)) return '—';
          const val = m3h * UNIT_FACTORS[flowUnit];
          return `${val.toFixed(1)} ${UNIT_LABELS[flowUnit]}`;
        };

        type ExhibitSplitComponent = {
          label: string;
          exhibitLabel: string;
          exhibitCode: string;
          exhibitId: string;
          percentage: number | null;
          flowM3h: number | null;
        };

        const finiteValue = (value: unknown): number | null => {
          if (value === undefined || value === null || value === '') return null;
          const number = Number(value);
          return Number.isFinite(number) ? number : null;
        };

        const sourceReferenceFor = (source: unknown): {
          unavailableReason?: string;
          components: ExhibitSplitComponent[];
          combinedFlowM3h: number | null;
          exhibitCode: string;
           exhibitCount: number;
          exhibitId: string | null;
        } | null => {
          const normalized = String(source || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
          const sourceKey = normalized === 'surfaceskim' || normalized === 'surfaceskimmerbox'
            ? 'surface'
            : normalized === 'bottomdrain'
              ? 'bottom'
              : normalized === 'bothintegrated'
                ? 'both'
                : null;
          if (!sourceKey) return null;

          const linkedReferences = (links as any[]).map((link: any) => {
            const exhibit = exhibits.find(
              (candidate: any) => String(candidate.id) === String(link.exhibit_id),
            );
            const calculation = exhibitCalculations.find(
              (candidate: any) =>
                String(candidate.inputs?.exhibit_id) === String(link.exhibit_id),
            );
            return {
              link,
              calculation,
              exhibitCode: link.exhibit_code || exhibit?.exhibit_code || 'Exhibit',
              exhibitId: String(link.exhibit_id),
            };
          });
          const exhibitCount = linkedReferences.length;
          const exhibitCode = exhibitCount === 1
            ? linkedReferences[0].exhibitCode
            : `${exhibitCount} linked exhibits`;
          const unavailable = (reason: string) => ({
            unavailableReason: reason,
            components: [],
            combinedFlowM3h: null,
            exhibitCode,
            exhibitCount,
            exhibitId: null,
          });
          if (exhibitCount === 0) {
            return unavailable('No linked exhibit is configured.');
          }
          const unusableReference = linkedReferences.find(({ calculation }) =>
            !calculation || calculation.status !== 'valid' ||
            calculation.is_stale === true || calculation.freshness === 'stale');
          if (unusableReference) {
            return unavailable(
              `Linked exhibit ${unusableReference.exhibitCode} has no usable hydraulic split calculation.`,
            );
          }

          const selected = linkedReferences.flatMap((reference): ExhibitSplitComponent[] => {
            const surface: ExhibitSplitComponent = {
              label: 'Surface Skim',
              exhibitLabel: 'Surface Skimmer Box',
              exhibitCode: reference.exhibitCode,
              exhibitId: reference.exhibitId,
              percentage: finiteValue(reference.calculation.inputs?.surface_skim_pct),
              flowM3h: finiteValue(reference.calculation.results?.surface_skim_flow_m3h),
            };
            const bottom: ExhibitSplitComponent = {
              label: 'Bottom Drain',
              exhibitLabel: 'Bottom Drain',
              exhibitCode: reference.exhibitCode,
              exhibitId: reference.exhibitId,
              percentage: finiteValue(reference.calculation.inputs?.bottom_drain_pct),
              flowM3h: finiteValue(reference.calculation.results?.bottom_drain_flow_m3h),
            };
            return sourceKey === 'surface'
              ? [surface]
              : sourceKey === 'bottom'
                ? [bottom]
                : [surface, bottom];
          });
          const combinedFlowM3h = selected.reduce(
            (sum, component) => sum + Number(component.flowM3h || 0),
            0,
          );
          if (selected.some(component => component.percentage == null || component.flowM3h == null) ||
              !Number.isFinite(combinedFlowM3h)) {
            return unavailable('A linked exhibit split or calculated flow is incomplete.');
          }
          return {
            components: selected,
            combinedFlowM3h,
            exhibitCode,
            exhibitCount,
            exhibitId: exhibitCount === 1 ? linkedReferences[0].exhibitId : null,
          };
        };

        const SourceSplitReference = ({ source, compact = false }: {
          source: unknown;
          compact?: boolean;
        }) => {
          const reference = sourceReferenceFor(source);
          if (!reference) return null;
          const exhibitPath = linkedExhibitPathFor(reference.exhibitId);
          return (
            <div
              data-testid="flow-route-source-reference"
              className={`${compact ? 'mt-1.5 p-2' : 'mt-2.5 p-3'} rounded-lg border ${
                reference.unavailableReason
                  ? 'border-amber-200 bg-amber-50/70'
                  : 'border-cyan-200 bg-cyan-50/60'
              }`}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <GitBranch className={`w-3 h-3 shrink-0 ${
                  reference.unavailableReason ? 'text-amber-600' : 'text-cyan-600'
                }`} />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                  Exhibit split reference
                </span>
                <span className="text-[10px] text-stone-400">Read-only · from linked exhibit</span>
              </div>
              {reference.unavailableReason ? (
                <p className="text-[11px] text-amber-800 mt-1">
                  Exhibit split unavailable: {reference.unavailableReason}
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-stone-500 mt-1">
                    {reference.exhibitCount === 1 ? 'Linked exhibit: ' : 'Linked exhibits: '}
                    {reference.exhibitCount === 1 && exhibitPath ? (
                      <Link
                        to={exhibitPath}
                        aria-label={`Open exhibit ${reference.exhibitCode}`}
                        title="Open exhibit detail"
                        className="font-mono text-blue-700 hover:text-blue-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 rounded"
                      >
                        {reference.exhibitCode}
                      </Link>
                    ) : (
                      <strong className="font-mono text-stone-700">{reference.exhibitCode}</strong>
                    )}
                    {reference.exhibitCount > 1 && ' aggregated'}
                  </p>
                  <div className={`grid ${reference.components.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'} gap-2 mt-2`}>
                    {reference.components.map(component => (
                      <div key={`${component.exhibitId}-${component.label}`} className="rounded-md bg-white/70 border border-cyan-100 px-2 py-1.5">
                        <div className="text-[10px] text-stone-500">
                          <span className="font-mono text-stone-600">{component.exhibitCode} · {component.label}</span>
                          {' '}<span className="text-stone-400">({component.exhibitLabel})</span>
                        </div>
                        <div className="font-mono text-[11px] font-semibold text-cyan-800">
                          {component.percentage}% · {fmtReferenceFlow(component.flowM3h)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {reference.components.length > 1 && (
                    <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-stone-600">
                      <span>Combined linked-exhibit return flow</span>
                      <strong className="font-mono text-cyan-800">{fmtReferenceFlow(reference.combinedFlowM3h)}</strong>
                    </div>
                  )}
                  <p className="text-[10px] text-stone-400 mt-2">
                    The loop allocation percentage applies directly to this calculated source flow.
                  </p>
                </>
              )}
            </div>
          );
        };

        const SourceSplitSummary = ({ source }: { source: unknown }) => {
          const reference = sourceReferenceFor(source);
          if (!reference) return null;
          return (
            <div
              data-testid="flow-route-source-summary"
              className={`mt-1 space-y-0.5 rounded border px-2 py-1.5 text-[10px] ${
                reference.unavailableReason
                  ? 'border-amber-200 bg-amber-50/70 text-amber-800'
                  : 'border-cyan-200 bg-cyan-50/60 text-cyan-900'
              }`}
            >
              <div className="flex items-center gap-1 font-semibold uppercase tracking-wide">
                <GitBranch className="h-3 w-3 shrink-0" />
                <span>Read-only exhibit split</span>
              </div>
              {reference.unavailableReason ? (
                <div>Exhibit split unavailable: {reference.unavailableReason}</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {reference.components.map(component => (
                      <span key={`${component.exhibitId}-${component.label}`} className="font-mono">
                        {component.exhibitCode} · {component.label}: {component.percentage}% · {fmtReferenceFlow(component.flowM3h)}
                      </span>
                    ))}
                  </div>
                  {reference.components.length > 1 && (
                    <div className="font-mono font-semibold">
                      Combined: {fmtReferenceFlow(reference.combinedFlowM3h)}
                    </div>
                  )}
                  <div className="text-stone-500">
                    From <strong className="font-mono text-stone-700">{reference.exhibitCode}</strong>
                  </div>
                </>
              )}
            </div>
          );
        };

        const LinkedExhibitsSummary = () => (
          <div className="space-y-1">
            {(links as any[]).length === 0 ? (
              <span className="text-xs italic text-stone-400">No linked exhibits</span>
            ) : (
              (links as any[]).map((link: any) => {
                const exhibit = exhibits.find(
                  (candidate: any) => String(candidate.id) === String(link.exhibit_id),
                );
                const code = link.exhibit_code || exhibit?.exhibit_code || 'Exhibit';
                const name = link.exhibit_name || exhibit?.exhibit_name;
                const exhibitPath = linkedExhibitPathFor(link.exhibit_id);
                const identity = name ? `${code} — ${name}` : code;
                return (
                  <div key={link.id || `${link.exhibit_id}-${link.link_type}`} className="text-xs">
                    {exhibitPath ? (
                      <Link
                        to={exhibitPath}
                        aria-label={`Open exhibit ${code}`}
                        title="Open exhibit detail"
                        className="font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 rounded"
                      >
                        {identity}
                      </Link>
                    ) : (
                      <span className="font-medium text-stone-700">{identity}</span>
                    )}
                    <span className="ml-1 inline-flex rounded-full border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-stone-500">
                      {link.link_type || 'Linked'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        );

        const LOOP_COLORS: Record<number, { badge: string; border: string; label: string }> = {
          1: { badge: 'bg-violet-100 text-violet-700', border: 'border-violet-200', label: 'text-violet-800' },
          2: { badge: 'bg-blue-100 text-blue-700',     border: 'border-blue-200',   label: 'text-blue-800'   },
          3: { badge: 'bg-indigo-100 text-indigo-700', border: 'border-indigo-200', label: 'text-indigo-800' },
        };

        const loopHasData = (n: number) =>
          !!((system[`loop${n}_name`] && system[`loop${n}_name`] !== `Loop ${n}`) ||
             system[`loop${n}_flow_source`] || system[`loop${n}_filtration`] ||
              system[`loop${n}_flow_mode`] === 'matched' || system[`loop${n}_match_loop_number`] != null ||
             system[`loop${n}_flow_pct`] != null || system[`loop${n}_bio_degas_pct`] != null ||
             system[`loop${n}_bio_degas_m3h`] != null || system[`loop${n}_link_bio_degas`] ||
             (system.side_streams || []).some((stream: any) => Number(stream.parent_loop_number) === n));

        const activeLoops: number[] = [1, 2, 3].filter(loopHasData);
        const nextLoopToAdd: number | undefined = [1, 2, 3].find(n =>
          !loopHasData(n) && (n === 1 || loopHasData(n - 1)));
        const canAddNext = nextLoopToAdd != null && nextLoopToAdd <= 3;
        const exhibitSourceFlowContext = (source: unknown): {
          flow: number | null;
          basisLabel: string;
          unavailableReason?: string;
        } => {
          const reference = sourceReferenceFor(source);
          return {
            flow: reference?.unavailableReason ? null : (reference?.combinedFlowM3h ?? null),
            basisLabel: `aggregate ${String(source).trim()} flow`,
            unavailableReason: reference?.unavailableReason,
          };
        };
        const loopAllocationFlowContext = (source: unknown): {
          flow: number | null;
          basisLabel: string;
        } => {
          const reference = sourceReferenceFor(source);
          if (!reference) return { flow: systemFlow, basisLabel: 'total system flow' };
          return {
            flow: reference.unavailableReason ? null : reference.combinedFlowM3h,
            basisLabel: `${String(source).trim()} flow`,
          };
        };
        const flowForPercentage = (percentage: unknown, source: unknown): number | null => {
          const pct = nullableNumber(percentage);
          const basisFlow = loopAllocationFlowContext(source).flow;
          return pct != null && basisFlow != null && basisFlow > 0
            ? basisFlow * pct / 100
            : null;
        };
        const loopMode = (source: any, n: number) =>
          source?.[`loop${n}_flow_mode`] === 'matched' ? 'matched' : 'allocated';
        const hasLoopConfiguration = (source: any, n: number) => !!(
          source?.[`loop${n}_flow_source`] || source?.[`loop${n}_filtration`] ||
          nullableNumber(source?.[`loop${n}_flow_pct`]) != null ||
          loopMode(source, n) === 'matched'
        );
        const resolveLoopFlow = (source: any, n: number, path: number[] = []): {
          flow: number | null; reason?: string; target?: number; chain?: number[];
        } => {
          if (path.includes(n)) return { flow: null, reason: 'Match cycle detected', chain: [...path, n] };
          if (loopMode(source, n) !== 'matched') {
            return {
              flow: flowForPercentage(
                source?.[`loop${n}_flow_pct`],
                source?.[`loop${n}_flow_source`],
              ),
              chain: [...path, n],
            };
          }
          const target = nullableNumber(source?.[`loop${n}_match_loop_number`]);
          if (!Number.isInteger(target) || target! < 1 || target! > 3 || !hasLoopConfiguration(source, target!)) {
            return { flow: null, reason: 'Matched loop is unavailable', target: target ?? undefined, chain: [...path, n] };
          }
          if (target === n) return { flow: null, reason: 'A loop cannot match itself', target, chain: [...path, n] };
          const resolved = resolveLoopFlow(source, target!, [...path, n]);
          return { ...resolved, target, chain: resolved.chain };
        };
        const matchDescription = (source: any, n: number) => {
          const resolved = resolveLoopFlow(source, n);
          const target = nullableNumber(source?.[`loop${n}_match_loop_number`]);
          if (resolved.reason) return `Unavailable — ${resolved.reason}`;
          return target != null
            ? `Matches Loop ${target} — ${loopName(source, target)} · ${fmtFlow(resolved.flow ?? 0)}`
            : 'Unavailable — choose another loop';
        };
        const allocationSource = flowForm || system;
        const allocationLoops = [1, 2, 3].filter(n =>
          loopMode(allocationSource, n) !== 'matched' &&
          !!(allocationSource[`loop${n}_flow_source`] ||
            allocationSource[`loop${n}_filtration`] ||
            allocationSource[`loop${n}_flow_mode`] === 'matched' ||
            allocationSource[`loop${n}_match_loop_number`] != null ||
            allocationSource[`loop${n}_flow_pct`] != null ||
            allocationSource[`loop${n}_bio_degas_pct`] != null ||
            allocationSource[`loop${n}_bio_degas_m3h`] != null ||
            allocationSource[`loop${n}_link_bio_degas`]));
        const allocationTotal = totalSystemAllocationPctFor(allocationSource) ?? 0;
        const allocationPending = allocationLoops.filter(
          n => nullableNumber(allocationSource[`loop${n}_flow_pct`]) == null,
        ).length;
        const branchAllocationPending = allocationLoops.filter(
          n => !!allocationSource[`loop${n}_link_bio_degas`] &&
            nullableNumber(allocationSource[`loop${n}_bio_degas_pct`]) == null,
        ).length;
        const unallocatedPct = Math.max(0, 100 - allocationTotal);
        const allocationValidation = flowAllocationError(allocationSource, allocationTotal);
        const loopName = (source: any, n: number) =>
          String(source?.[`loop${n}_name`] || `Loop ${n}`);
        const sideStreamsFor = (source: any, n: number) =>
          (source?.side_streams || [])
            .filter((stream: any) => Number(stream.parent_loop_number) === n)
            .sort((left: any, right: any) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
        const fractionatorFor = (source: any, n: number) =>
          (source?.[`loop${n}_filtration`] === 'Sand Filter'
            ? source?.sand_filter_allocations || []
            : source?.fractionator_allocations || []).find(
            (allocation: any) => Number(allocation.parent_loop_number) === n);
        const selectedFractionatorProducts = (source: any, n: number) => {
          const allocation = fractionatorFor(source, n);
          return (allocation?.products || []).map((selected: any) => {
            const catalogProducts = source?.[`loop${n}_filtration`] === 'Sand Filter'
              ? sandFilterProducts : fractionatorProducts;
            const catalog = catalogProducts.find(
              (product: any) => product.id === selected.product_master_id);
            return { ...(catalog || {}), ...selected };
          });
        };
        const flowEquipmentCalculation = (source: any, n: number, loopFlow: number | null) => {
          const allocation = fractionatorFor(source, n);
          const products = selectedFractionatorProducts(source, n);
          const isSandFilter = source?.[`loop${n}_filtration`] === 'Sand Filter';
          const equipmentLabel = isSandFilter ? 'Sand Filter' : 'Foam Fractionator';
          if (!Number.isFinite(loopFlow) || !(Number(loopFlow) > 0)) {
            return {
              status: 'incomplete',
              reason: isSandFilter
                ? 'Enter a positive parent-loop allocation to calculate Sand Filter capacity.'
                : 'A current aggregate Surface Skim flow is required to calculate Foam Fractionator capacity.',
            };
          }
          if (!products.length) return { status: 'incomplete', reason: `Select at least one ${isSandFilter ? 'AAT Sand Filter' : 'Foam Fractionator'}.` };
          if (products.some((product: any) => !(Number(product.diameter_mm) > 0))) {
            return { status: 'incomplete', reason: `A selected ${equipmentLabel} has no valid saved diameter.` };
          }
          if (products.some((product: any) => {
            const quantity = Number(product.quantity);
            return !Number.isInteger(quantity) || quantity <= 0;
          })) {
            return {
              status: 'incomplete',
              reason: `Enter a positive whole-number quantity for each selected ${equipmentLabel}.`,
            };
          }
          const rate = Number(allocation?.process_rate_ls_m2);
          if (!Number.isFinite(rate) || !(rate > 0)) {
            return { status: 'incomplete', reason: 'Enter an AAT process rate greater than zero.' };
          }
          const area = products.reduce((sum: number, product: any) =>
            sum + Math.PI * Math.pow(Number(product.diameter_mm) / 2000, 2) * Number(product.quantity), 0);
          const flowLs = loopFlow / 3.6;
          const capacityLs = area * rate;
          const tolerance = Math.max(flowLs, capacityLs) * 0.05;
          return {
            status: Math.abs(flowLs - capacityLs) <= tolerance ? 'matched'
              : flowLs > capacityLs ? 'required_above_capacity' : 'capacity_above_required',
            products, area, flowLs, rate, capacityLs, actualLoading: flowLs / area,
            advisory: isSandFilter ? rate < 5 || rate > 7 : rate < 18 || rate > 22,
          };
        };
        const FlowEquipmentSummary = ({ source, n, loopFlow, editable = false }: {
          source: any; n: number; loopFlow: number | null; editable?: boolean;
        }) => {
          const allocation = fractionatorFor(source, n) || {
            parent_loop_number: n, process_rate_ls_m2: '', notes: '', products: [],
          };
          const isSandFilter = source?.[`loop${n}_filtration`] === 'Sand Filter';
          const equipmentLabel = isSandFilter ? 'Sand Filter' : 'Foam Fractionator';
          const catalogProducts = isSandFilter ? sandFilterProducts : fractionatorProducts;
          const equipmentFlow = isSandFilter
            ? loopFlow
            : exhibitSourceFlowContext('Surface Skim').flow;
          const equipmentShareOfSystemFlow = equipmentFlow != null &&
            systemFlow != null && systemFlow > 0
            ? equipmentFlow / systemFlow * 100
            : null;
          const calculation: any = flowEquipmentCalculation(source, n, equipmentFlow);
          const statusStyle = calculation.status === 'matched'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : calculation.status === 'required_above_capacity'
              ? 'border-red-200 bg-red-50 text-red-800'
              : calculation.status === 'capacity_above_required'
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-amber-200 bg-amber-50 text-amber-800';
          const statusLabel = calculation.status === 'matched' ? 'Matched / within 5%'
            : calculation.status === 'required_above_capacity' ? 'Required flow above capacity'
            : calculation.status === 'capacity_above_required' ? 'Capacity above required flow'
            : 'Calculation incomplete';
          const allocationSetter = isSandFilter ? setSandFilterAllocations : setFractionatorAllocations;
          const updateAllocation = (changes: any) => allocationSetter(allocations => {
            const existing = allocations.find((item: any) => Number(item.parent_loop_number) === n);
            return existing
              ? allocations.map((item: any) => Number(item.parent_loop_number) === n ? { ...item, ...changes } : item)
              : [...allocations, { ...allocation, ...changes }];
          });
          const selectedProducts = selectedFractionatorProducts(source, n);
          const recommendation: any = (isSandFilter
            ? calculateSandFilterSizingRecommendation
            : calculateFoamFractionatorSizingRecommendation)(
             equipmentFlow,
            selectedProducts,
            allocation.process_rate_ls_m2,
          );
          const currentRate = Number(allocation.process_rate_ls_m2);
          const sliderMin = isSandFilter ? SAND_FILTER_PROCESS_RATE_SLIDER_MIN : FOAM_PROCESS_RATE_SLIDER_MIN;
          const sliderMax = isSandFilter ? SAND_FILTER_PROCESS_RATE_SLIDER_MAX : FOAM_PROCESS_RATE_SLIDER_MAX;
          const recommendedRate = isSandFilter ? SAND_FILTER_RECOMMENDED_PROCESS_RATE_LS_M2 : FOAM_RECOMMENDED_PROCESS_RATE_LS_M2;
          const recommendedRange = isSandFilter ? '5–7' : '18–22';
          const sliderValue = Number.isFinite(currentRate) && currentRate > 0
            ? Math.min(sliderMax, Math.max(sliderMin, currentRate))
            : recommendedRate;
          const applyRecommendedRate = () => {
            if (recommendation.status !== 'ready') return;
            updateAllocation({ process_rate_ls_m2: String(recommendation.recommendedRateLsM2) });
          };
          const applyRecommendedSizing = (productId?: string) => {
            if (recommendation.status !== 'ready') return;
            const target = productId
              ? recommendation.products.find((product: any) => product.product_master_id === productId)
              : recommendation.products.length === 1 ? recommendation.products[0] : null;
            updateAllocation({
              process_rate_ls_m2: String(recommendation.recommendedRateLsM2),
              ...(target ? {
                products: allocation.products.map((product: any) =>
                  product.product_master_id === target.product_master_id
                    ? { ...product, quantity: String(target.suggestedQuantity) }
                    : product),
              } : {}),
            });
          };
          const recommendationStatus = recommendation.status === 'ready'
            ? recommendation.coverageStatus === 'below'
              ? 'Below suggested capacity'
              : recommendation.coverageStatus === 'above'
                ? 'Above suggested capacity'
                : 'Near suggested capacity'
            : null;
          return (
            <div className={`rounded-lg border p-3 ${statusStyle}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold">{equipmentLabel} capacity</span>
                <span className="text-[10px] font-semibold">{statusLabel}</span>
              </div>
              <div className="mb-3 rounded-md border border-current/15 bg-white/55 px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-medium">
                    {isSandFilter ? 'SF' : 'FF'} share of total system flow
                  </span>
                  <strong className="font-mono text-sm">
                    {equipmentShareOfSystemFlow != null
                      ? `${equipmentShareOfSystemFlow.toFixed(1)}%`
                      : 'Unavailable'}
                  </strong>
                </div>
                <p className="mt-0.5 text-[9px] opacity-75">
                  {equipmentFlow != null && systemFlow != null && systemFlow > 0
                    ? `${fmtReferenceFlow(equipmentFlow)} ÷ ${fmtReferenceFlow(systemFlow)} total system flow`
                    : 'Requires current equipment flow and total system flow.'}
                </p>
              </div>
              {editable && selectedProducts.length === 0 && (
                <div className="space-y-3 mb-3">
                  <div>
                    <label className="block text-[10px] font-medium mb-1">Add {equipmentLabel} model</label>
                    <select value="" onChange={event => {
                      if (!event.target.value) return;
                      const selected = catalogProducts.find((product: any) => product.id === event.target.value);
                      if (!selected || allocation.products.some((product: any) => product.product_master_id === selected.id)) return;
                      updateAllocation({ products: [...allocation.products, {
                        product_master_id: selected.id, product_code: selected.product_code,
                        product_name: selected.product_name, diameter_mm: selected.diameter_mm, quantity: '1',
                      }] });
                    }} className={`${inputCls} bg-white`}>
                      <option value="">— Select {equipmentLabel} —</option>
                      {catalogProducts.map((product: any) => (
                        <option key={product.id} value={product.id}>
                          {product.product_code} — {product.product_name} — {product.diameter_mm ? `Ø${product.diameter_mm} mm` : 'diameter unavailable'}
                        </option>
                      ))}
                    </select>
                    {catalogProducts.length === 0 && (
                      <p className="mt-1.5 text-[10px] font-medium text-amber-800">
                        {isSandFilter
                          ? 'No active approved AAT Sand Filter Product Masters are available. Add or activate one in PIM with a saved diameter.'
                          : 'No active Foam Fractionator Product Masters are available.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className={`grid gap-2 ${selectedProducts.length === 1 ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
                    {selectedProducts.map((product: any) => {
                      const productId = String(product.product_master_id);
                      return (
                        <FlowEquipmentProductCard
                          key={productId}
                          product={product}
                          loopNumber={n}
                          calculation={calculation}
                           loopFlow={equipmentFlow}
                          currentRate={currentRate}
                          statusLabel={statusLabel}
                          notes={allocation.notes}
                          editable={editable}
                          formatFlow={fmtReferenceFlow}
                          onQuantityChange={value => updateAllocation({
                            products: allocation.products.map((item: any) =>
                              item.product_master_id === product.product_master_id
                                ? { ...item, quantity: value }
                                : item),
                          })}
                          onRemove={() => updateAllocation({
                            products: allocation.products.filter(
                              (item: any) => item.product_master_id !== product.product_master_id),
                          })}
                          equipmentLabel={equipmentLabel}
                          recommendedRange={recommendedRange}
                        />
                      );
                    })}
              </div>
              {editable && (
                <div className="space-y-3 mb-3 mt-3">
                  <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.9fr)] gap-3 items-start">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label htmlFor={`fractionator-rate-${n}`} className="text-[10px] font-medium">
                          AAT process rate (L/s/m²)
                        </label>
                        <span className="font-mono text-xs font-semibold text-violet-700">
                          {allocation.process_rate_ls_m2 || '—'}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={sliderMin}
                        max={sliderMax}
                        step="0.1"
                        value={sliderValue}
                        onChange={event => updateAllocation({ process_rate_ls_m2: event.target.value })}
                        aria-label={`AAT process rate slider for Loop ${n}`}
                        className="w-full accent-violet-600"
                      />
                      <div className="flex justify-between text-[9px] text-stone-400">
                        <span>{sliderMin}</span>
                        <span>Recommended: {recommendedRange}</span>
                        <span>{sliderMax}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          id={`fractionator-rate-${n}`}
                          type="number"
                          min="0.001"
                          step="0.1"
                          value={allocation.process_rate_ls_m2}
                          onChange={event => updateAllocation({ process_rate_ls_m2: event.target.value })}
                          aria-label={`AAT process rate for Loop ${n}`}
                          className={`${inputCls} bg-white max-w-32`}
                        />
                        <span className="text-[10px] text-stone-500">L/s/m²</span>
                        {(currentRate > 0 && (currentRate < sliderMin || currentRate > sliderMax)) && (
                          <span className="text-[9px] text-stone-500">Type any positive value; slider is {sliderMin}–{sliderMax}.</span>
                        )}
                      </div>
                      <p className="text-[10px] mt-1">Recommended operating range: {recommendedRange} L/s/m². Values outside it are allowed with an advisory.</p>
                    </div>
                    <div className="rounded-md border border-cyan-200 bg-cyan-50/70 p-2.5 text-[10px] text-cyan-950">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold">Sizing guidance</span>
                        <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-cyan-700">Informational</span>
                      </div>
                      {recommendation.status === 'ready' ? (
                        <>
                          <p className="text-cyan-900/80">
                            Based on <strong>{recommendation.parentFlowLs.toFixed(2)} L/s</strong> parent flow at the suggested
                            <strong> {recommendation.recommendedRateLsM2} L/s/m²</strong> rate, the required area is
                            <strong> {recommendation.requiredAreaM2.toFixed(4)} m²</strong>.
                          </p>
                          {isSandFilter && (
                            <p className="mt-1.5 text-cyan-900/80">
                              Bank guidance uses <strong>1 unit</strong> for a single-filter duty, then prefers
                              <strong> banks of 3 or 4</strong>. Above 4 units it recommends the next multiple of 3 or 4.
                              Edit Quantity to apply a manual override when needed.
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2">
                            <span>Selected area</span>
                            <strong>{recommendation.selectedAreaM2.toFixed(4)} m²</strong>
                            <span>Capacity at suggested rate</span>
                            <strong>{recommendation.recommendedCapacityLs.toFixed(2)} L/s</strong>
                            <span>Current status</span>
                            <strong>{recommendationStatus}</strong>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {recommendation.products.map((product: any) => (
                              <div key={product.product_master_id} className="rounded bg-white/70 px-2 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">{product.product_code}</span>
                                  <span>Ø{product.diameter_mm} mm</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-0.5">
                                  <span>{isSandFilter ? 'Suggested bank quantity' : 'Suggested standalone quantity'}</span>
                                  <strong>{product.suggestedQuantity} unit{product.suggestedQuantity === 1 ? '' : 's'}</strong>
                                </div>
                                {recommendation.products.length > 1 && (
                                  <button type="button" onClick={() => applyRecommendedSizing(product.product_master_id)}
                                    className="mt-1 text-[9px] font-semibold text-cyan-700 hover:text-cyan-900 underline">
                                    Use {product.suggestedQuantity} for this model
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <button type="button" onClick={applyRecommendedRate}
                              className="rounded border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-700 hover:bg-cyan-100">
                              Use {recommendation.recommendedRateLsM2} L/s/m²
                            </button>
                            {recommendation.products.length === 1 && (
                              <button type="button" onClick={() => applyRecommendedSizing()}
                                className="rounded border border-cyan-300 bg-cyan-700 px-2 py-1 font-semibold text-white hover:bg-cyan-800">
                                {isSandFilter ? 'Apply rate + bank quantity' : 'Apply rate + quantity'}
                              </button>
                            )}
                          </div>
                          <p className="mt-1.5 text-[9px] text-cyan-900/70">
                            Suggestions do not save or replace your values until you explicitly apply them.
                          </p>
                        </>
                      ) : (
                        <p className="text-cyan-900/80">{recommendation.reason}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium mb-1">Notes</label>
                    <textarea rows={2} value={allocation.notes || ''}
                      onChange={event => updateAllocation({ notes: event.target.value })}
                      className={`${inputCls} bg-white resize-none`} />
                  </div>
                </div>
              )}
              {selectedProducts.length === 0 && calculation.status === 'incomplete' && (
                <p className="text-[10px]">{calculation.reason}</p>
              )}
            </div>
          );
        };
        const fmtSideStreamFlow = (value: number | null) => {
          if (value == null) return 'Unavailable';
          const converted = value * UNIT_FACTORS[flowUnit];
          return `${converted.toFixed(1)} ${UNIT_LABELS[flowUnit]}`;
        };

        // ── Read-only loop card ────────────────────────────────────────────
        const LoopView = ({ n }: { n: number }) => {
          const src    = system[`loop${n}_flow_source`];
          const filt   = system[`loop${n}_filtration`];
          const bio    = system[`loop${n}_bio_degas_m3h`];
          const loopPct = nullableNumber(system[`loop${n}_flow_pct`]);
          const bioPct = nullableNumber(system[`loop${n}_bio_degas_pct`]);
          const linked = !!system[`loop${n}_link_bio_degas`];
          const matched = loopMode(system, n) === 'matched';
          const flowContext = loopAllocationFlowContext(src);
          const foamFlowContext = exhibitSourceFlowContext('Surface Skim');
          const resolvedFlow = resolveLoopFlow(system, n);
          const loopFlow = resolvedFlow.flow;
          const bioFlow = loopFlow != null && bioPct != null
            ? loopFlow * bioPct / 100
            : nullableNumber(bio);
          const sideStreams = sideStreamsFor(system, n);
          if (!src && !filt && !matched && loopPct == null && bio == null && bioPct == null && !linked && sideStreams.length === 0)
            return <div className="text-xs text-stone-300 italic py-2">Not configured</div>;
          return (
            <div className="space-y-2">
              {src ? (
                <div className="flex items-center gap-2 text-sm">
                  <Droplets className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                  <span className="text-stone-500 text-xs">Source:</span>
                  <span className="font-medium text-stone-800">{src}</span>
                </div>
              ) : <div className="text-xs text-stone-300 italic">No source set</div>}
               {src && <SourceSplitReference source={src} />}
               {matched && (
                 <div className={`rounded-md border px-2.5 py-2 text-xs ${resolvedFlow.reason ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
                   <span className="font-semibold">Non-allocating circulation flow</span>
                   <span className="block mt-0.5">{matchDescription(system, n)}</span>
                 </div>
               )}
              {filt && (
                <div className="flex items-center gap-2 text-sm">
                  <FlaskConical className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <span className="text-stone-500 text-xs">Filtration:</span>
                  <span className="font-medium text-stone-800">{filt}</span>
                </div>
              )}
              {filt === 'Foam Fractionation' && (
                <div
                  aria-label={`Foam Fractionator flow context for Loop ${n}`}
                  className="rounded-md border border-cyan-200 bg-cyan-50/50 p-3 text-[10px]"
                >
                  <div className="mb-2 flex items-center gap-2 font-semibold uppercase tracking-wide text-cyan-800">
                    <Gauge className="h-3.5 w-3.5" /> Flow context
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div>
                       <span className="block text-cyan-900/60">Required FF flow</span>
                       <strong className="block font-mono text-cyan-950">
                         {foamFlowContext.flow != null ? fmtFlow(foamFlowContext.flow) : 'Unavailable'}
                       </strong>
                       <span className="text-cyan-900/70">{foamFlowContext.basisLabel}</span>
                     </div>
                     <div>
                      <span className="block text-cyan-900/60">Loop allocation</span>
                       <span className="block text-cyan-900/70">{flowContext.basisLabel}</span>
                       <strong className="text-cyan-950">{allocationStatus(loopPct, flowContext.basisLabel)}</strong>
                    </div>
                    <div>
                      <span className="block text-cyan-900/60">Derived loop flow</span>
                      <strong className="font-mono text-cyan-950">{fmtFlow(loopFlow)}</strong>
                    </div>
                    <div>
                      <span className="block text-cyan-900/60">Bio/Degas:</span>
                      {linked ? (
                        <>
                          <strong className="block text-emerald-800">{allocationStatus(bioPct, 'loop')}</strong>
                          <span className="font-mono text-emerald-700">
                            {bioFlow != null ? fmtFlow(bioFlow) : 'Unavailable'} derived branch flow
                          </span>
                        </>
                      ) : (
                        <strong className="block text-stone-500">Not connected</strong>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {filt === 'Sand Filter' && (
                <FlowEquipmentSummary source={system} n={n} loopFlow={loopFlow} />
              )}
              {filt === 'Foam Fractionation' && (
                <FlowEquipmentSummary source={system} n={n} loopFlow={loopFlow} />
              )}
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <Gauge className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                <span className="text-stone-500 text-xs">Loop flow:</span>
                <span className="font-mono font-semibold text-xs text-stone-800">
                  {fmtFlow(loopFlow ?? 0)}
                </span>
                <span className="text-stone-400 text-xs">
                    · {matched ? 'matched flow (not allocated)' : allocationStatus(loopPct, flowContext.basisLabel)}
                </span>
              </div>
              {linked && (
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <Wind className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="text-stone-500 text-xs">Bio/Degas:</span>
                  <span className="font-mono font-semibold text-xs text-emerald-700">
                    {fmtFlow(bioFlow ?? 0)}
                  </span>
                  <span className="text-stone-400 text-xs">
                    · {allocationStatus(bioPct, 'loop')}
                  </span>
                  <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                    linked
                  </span>
                </div>
              )}
              {sideStreams.length > 0 && (
                <div className="mt-3 border-l-2 border-cyan-200 pl-3 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700">
                    Side streams
                  </div>
                  {sideStreams.map((stream: any) => {
                    const percentage = nullableNumber(stream.flow_pct);
                    const derivedFlow = loopFlow != null && percentage != null
                      ? loopFlow * percentage / 100
                      : null;
                    const isUV = stream.preset === 'UV';
                    const uvRev = stream.uv_revision;
                    return (
                      <div key={stream.id || `${stream.name}-${stream.sort_order}`} className={`rounded-md border px-2.5 py-2 ${isUV ? 'border-cyan-200 bg-cyan-50/60' : 'border-cyan-100 bg-cyan-50/40'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {isUV && <Zap className="w-3 h-3 text-cyan-500 shrink-0" />}
                            <span className="text-xs font-semibold text-stone-700">{stream.name}</span>
                          </div>
                          <span className="text-[10px] text-stone-500">{percentage ?? '—'}% of parent</span>
                        </div>
                        <div className={`font-mono text-xs mt-0.5 ${derivedFlow == null ? 'text-amber-700' : 'text-cyan-800'}`}>
                          {fmtSideStreamFlow(derivedFlow)}
                        </div>
                        <div className="mt-1 text-[10px] font-medium text-stone-600">
                          Dedicated pump: {stream.has_dedicated_pump === false ? 'No' : 'Yes'}
                        </div>
                        {derivedFlow == null && (
                          <p className="text-[10px] text-amber-700 mt-0.5">Set the parent loop allocation to calculate branch flow.</p>
                        )}
                        {isUV && uvRev && (
                          <div className="mt-1 text-[10px] text-cyan-700">
                            <span className="font-medium">{uvRev.product_code}</span>
                            {uvRev.product_name ? ` — ${uvRev.product_name}` : ''}
                            {stream.uv_unit_quantity ? ` · ${stream.uv_unit_quantity} unit${stream.uv_unit_quantity === 1 ? '' : 's'}` : ''}
                            {' · '}Rev {uvRev.revision_number}
                          </div>
                        )}
                        {isUV && !uvRev && (
                          <p className="text-[10px] text-amber-600 mt-0.5">No UV product assigned — open UV Selection tab.</p>
                        )}
                        {stream.notes && <p className="text-[10px] text-stone-500 mt-1">{stream.notes}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        };

        // ── Loop editor panel (card edit mode) ────────────────────────────
        const LoopEditor = ({ n }: { n: number }) => {
          if (!flowForm) return null;
          const srcKey  = `loop${n}_flow_source`;
          const filtKey = `loop${n}_filtration`;
          const pctKey  = `loop${n}_flow_pct`;
          const modeKey = `loop${n}_flow_mode`;
          const matchKey = `loop${n}_match_loop_number`;
          const bioPctKey = `loop${n}_bio_degas_pct`;
          const lnkKey  = `loop${n}_link_bio_degas`;
          const linked: boolean = !!flowForm[lnkKey];
          const curSrc  = flowForm[srcKey]  as string;
          const curFilt = flowForm[filtKey] as string;
          const isCirculation = CIRCULATION_SOURCES.has(curSrc);
          const matched = loopMode(flowForm, n) === 'matched';
          const loopPct = nullableNumber(flowForm[pctKey]);
          const bioPct = nullableNumber(flowForm[bioPctKey]);
          const flowContext = loopAllocationFlowContext(curSrc);
          const resolvedFlow = resolveLoopFlow(flowForm, n);
          const loopFlow = resolvedFlow.flow;
          const bioFlow = loopFlow != null && bioPct != null ? loopFlow * bioPct / 100 : null;
          const eligibleMatchTargets = [1, 2, 3].filter(target =>
            target !== n && hasLoopConfiguration(flowForm, target) &&
            !resolveLoopFlow(flowForm, target, [n]).reason);
          const sideStreams = sideStreamsFor(flowForm, n);
          const updateSideStream = (id: string, field: string, value: any) => {
            setFlowSideStreams(streams => streams.map(stream =>
              stream.id === id ? { ...stream, [field]: value } : stream));
          };
          const addSideStream = (preset: 'Thermal' | 'UV' | 'Custom') => {
            const id = `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            setFlowSideStreams(streams => [
              ...streams,
              {
                id,
                parent_loop_number: n,
                name: preset === 'Custom' ? '' : preset,
                preset,
                flow_pct: '',
                has_dedicated_pump: false,
                notes: '',
                sort_order: sideStreams.length,
              },
            ]);
          };
          return (
            <div className="space-y-4">
              <div>
                <FlowSourcePicker
                  id={`loop-${n}-flow-source`}
                  ariaLabel={`Loop ${n} Flow Source`}
                  value={curSrc || ''}
                  onChange={nextSource => {
                    setFF(srcKey, nextSource);
                    if (CIRCULATION_SOURCES.has(nextSource)) {
                      setFF(modeKey, 'matched');
                    } else {
                      setFF(modeKey, 'allocated');
                      setFF(matchKey, '');
                    }
                  }}
                />
              </div>
              {curSrc && <SourceSplitReference source={curSrc} />}
              {isCirculation && (
                <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
                  <div className="text-xs font-semibold text-blue-800">
                    {matched ? 'Circulation source — non-allocating' : 'Circulation source — allocated (legacy mode)'}
                  </div>
                  <p className="mt-0.5 text-[10px] text-blue-700">
                    {matched
                      ? 'This loop is excluded from system allocation totals and warnings. Match its flow to another loop.'
                      : 'This persisted loop remains percentage-allocated. Enable matching to make it non-allocating.'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-blue-800">
                      <input type="radio" checked={matched} onChange={() => setFF(modeKey, 'matched')} />
                      Match another loop
                    </label>
                    <select value={flowForm[matchKey] || ''} disabled={!matched}
                      aria-label={`Loop ${n} matched loop`}
                      onChange={event => setFF(matchKey, event.target.value)}
                      className={`${inputCls} mt-0 max-w-56 bg-white`}>
                      <option value="">— Select eligible loop —</option>
                      {eligibleMatchTargets.map(target => <option key={target} value={target}>Loop {target} — {loopName(flowForm, target)}</option>)}
                      {flowForm[matchKey] && !eligibleMatchTargets.includes(Number(flowForm[matchKey])) && (
                        <option value={flowForm[matchKey]}>Loop {flowForm[matchKey]} — unavailable</option>
                      )}
                    </select>
                  </div>
                  <p className={`mt-2 text-[10px] ${resolvedFlow.reason ? 'text-amber-700' : 'text-blue-800'}`}>{matchDescription(flowForm, n)}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Filtration Type</label>
                <div className="flex rounded-lg border border-stone-200 overflow-hidden text-xs font-medium">
                  {FILTRATION_OPTS.map(o => {
                    const disabled = o.saltwaterOnly && !isSaltwater;
                    return (
                      <button key={o.value} type="button" disabled={disabled}
                        onClick={() => !disabled && setFF(filtKey, curFilt === o.value ? '' : o.value)}
                        className={`flex-1 px-2 py-1.5 transition-colors text-center leading-tight border-r border-stone-200 last:border-r-0
                          ${disabled ? 'bg-stone-50 text-stone-300 cursor-not-allowed' : curFilt === o.value ? 'bg-violet-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}>
                        {o.label}
                        {disabled && <span className="block text-[9px] font-normal opacity-70">saltwater only</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-md border border-cyan-200 bg-cyan-50/50 p-3">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-800">
                  <Gauge className="h-3.5 w-3.5" /> Flow context
                </div>
                {!matched && (
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">
                       Loop Flow Allocation (% of {flowContext.basisLabel})
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.1" min="0" max="100" placeholder="e.g. 60"
                        aria-label={`Loop ${n} flow allocation percentage`}
                        value={flowForm[pctKey]} onChange={e => setFF(pctKey, e.target.value)}
                        className={`${inputCls} max-w-32`} />
                      <span className="text-xs text-stone-400">%</span>
                      <span className="text-xs text-stone-500">
                        = <strong className="font-mono text-stone-700">{fmtFlow(loopFlow ?? 0)}</strong>
                      </span>
                    </div>
                  </div>
                )}
                {matched && <p className="text-xs text-blue-800">Flow is resolved live from the matched loop and is not an allocation.</p>}
                {!matched && loopPct == null && (
                  <p className="text-[10px] text-stone-400 mt-1">Leave blank until this loop allocation is reviewed.</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-stone-500">Bio / Degas Branch</label>
                  <label className="flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer select-none">
                    <input type="checkbox" checked={linked} onChange={e => setFF(lnkKey, e.target.checked)}
                      className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-400/40" />
                    {bioLinkLabel}
                  </label>
                </div>
                {linked ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.1" min="0" max="100" placeholder="e.g. 25"
                        aria-label={`Loop ${n} Bio/Degas allocation percentage`}
                        value={flowForm[bioPctKey]} onChange={e => setFF(bioPctKey, e.target.value)}
                        className={`${inputCls} max-w-32`} />
                      <span className="text-xs text-stone-400">% of loop</span>
                      <span className="text-xs text-emerald-700">
                        = <strong className="font-mono">{fmtFlow(bioFlow ?? 0)}</strong>
                      </span>
                    </div>
                    {bioPct == null && (
                      <p className="text-[10px] text-stone-400">Leave blank until this branch allocation is reviewed.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">Not connected. Enable the link to define the Bio/Degas branch percentage.</p>
                )}
              </div>
              {curFilt === 'Foam Fractionation' && (
                <FlowEquipmentSummary source={flowForm} n={n} loopFlow={loopFlow} editable />
              )}
              {curFilt === 'Sand Filter' && (
                <FlowEquipmentSummary source={flowForm} n={n} loopFlow={loopFlow} editable />
              )}
              <div className="border-t border-stone-100 pt-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs font-semibold text-stone-700">Side streams</div>
                    <p className="text-[10px] text-stone-400">Branches use a percentage of this parent loop and do not change system allocation.</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {(['Thermal', 'UV', 'Custom'] as const).map(preset => (
                      <button key={preset} type="button" onClick={() => addSideStream(preset)}
                        className="text-[10px] border border-cyan-200 text-cyan-700 bg-white hover:bg-cyan-50 rounded px-2 py-1">
                        <Plus className="w-3 h-3 inline mr-0.5" /> {preset}
                      </button>
                    ))}
                  </div>
                </div>
                {sideStreams.length === 0 ? (
                  <p className="text-xs text-stone-400 italic">No side streams configured.</p>
                ) : (
                  <div className="space-y-3">
                    {sideStreams.map((stream: any) => {
                      const percentage = nullableNumber(stream.flow_pct);
                      const derivedFlow = loopFlow != null && percentage != null
                        ? loopFlow * percentage / 100
                        : null;
                      return (
                        <div key={stream.id} className="rounded-lg border border-cyan-100 bg-cyan-50/30 p-3">
                          <div className="grid sm:grid-cols-[120px_1fr_110px_auto] gap-2 items-start">
                            <select value={stream.preset || 'Custom'}
                              onChange={event => {
                                const preset = event.target.value;
                                updateSideStream(stream.id, 'preset', preset);
                                if (preset !== 'Custom') updateSideStream(stream.id, 'name', preset);
                              }}
                              aria-label={`${stream.name || 'New'} side stream preset`}
                              className={`${inputCls} bg-white`}>
                              <option>Thermal</option>
                              <option>UV</option>
                              <option>Custom</option>
                            </select>
                            <input value={stream.name}
                              onChange={event => updateSideStream(stream.id, 'name', event.target.value)}
                              aria-label={`Loop ${n} side stream name`}
                              placeholder="Required side stream name"
                              className={inputCls} />
                            <div>
                              <input type="number" min="0" max="100" step="0.1"
                                value={stream.flow_pct}
                                onChange={event => updateSideStream(stream.id, 'flow_pct', event.target.value)}
                                aria-label={`${stream.name || 'New'} side stream percentage`}
                                placeholder="% of parent"
                                className={inputCls} />
                              <div className={`font-mono text-[10px] mt-1 ${derivedFlow == null ? 'text-amber-700' : 'text-cyan-800'}`}>
                                {fmtSideStreamFlow(derivedFlow)}
                              </div>
                            </div>
                            <button type="button" aria-label={`Remove ${stream.name || 'side stream'}`}
                              onClick={() => setFlowSideStreams(streams => streams.filter(item => item.id !== stream.id))}
                              className="text-stone-400 hover:text-red-600 p-2">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <textarea rows={2} value={stream.notes || ''}
                            onChange={event => updateSideStream(stream.id, 'notes', event.target.value)}
                            aria-label={`${stream.name || 'New'} side stream notes`}
                            placeholder="Notes (optional)"
                            className={`${inputCls} mt-2 resize-none`} />
                          <label className="mt-2 flex items-center gap-2 text-xs font-medium text-stone-700">
                            <input
                              type="checkbox"
                              checked={stream.has_dedicated_pump === true}
                              onChange={event => updateSideStream(stream.id, 'has_dedicated_pump', event.target.checked)}
                              aria-label={`${stream.name || 'New'} has a dedicated pump`}
                              className="h-4 w-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                            />
                            This side stream has a dedicated pump
                          </label>
                          {derivedFlow == null && (
                            <p className="text-[10px] text-amber-700 mt-1">Parent loop flow unavailable; the percentage will still be saved.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        };

        return (
          <div
            id="lss-panel-flow"
            role="tabpanel"
            aria-labelledby="lss-tab-flow"
            tabIndex={0}
            hidden={activeTab !== 'flow'}
            className="space-y-5"
          >
          <div id="flow-route" className="bg-white rounded-xl border border-stone-200 overflow-hidden">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-violet-50/30">
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4 text-violet-600" />
                <span className="text-sm font-semibold text-violet-800">Flow Route</span>
                {!isSaltwater && system.water_type && (
                  <span className="text-xs text-stone-400 ml-1">· Foam Fractionation disabled (freshwater)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Unit toggle */}
                <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
                  {(['M3H', 'LS', 'US_GPM', 'IMP_GPM'] as const).map((u, i) => (
                    <button key={u} onClick={() => setFlowUnit(u)}
                      className={`px-2 py-1 transition-colors ${i > 0 ? 'border-l border-stone-200' : ''} ${flowUnit === u ? 'bg-cyan-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}>
                      {UNIT_LABELS[u]}
                    </button>
                  ))}
                </div>
                {/* Card / List toggle */}
                <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
                  <button onClick={() => handleFlowViewChange('card')}
                    className={`px-2.5 py-1 transition-colors ${flowViewMode === 'card' ? 'bg-stone-700 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}>
                    Card
                  </button>
                  <button onClick={() => handleFlowViewChange('list')}
                    className={`px-2.5 py-1 border-l border-stone-200 transition-colors ${flowViewMode === 'list' ? 'bg-stone-700 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}>
                    List
                  </button>
                </div>
                {/* Edit button — card view only */}
                {flowViewMode === 'card' && !flowEditMode && !readOnly && (
                  <button onClick={() => startFlowEdit()}
                    className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 border border-violet-200 bg-white rounded-md px-2.5 py-1.5 transition-colors">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
            </div>

            <div data-testid="flow-route-linked-exhibits" className="flex flex-wrap items-start gap-3 border-b border-stone-100 bg-stone-50/40 px-5 py-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                <GitBranch className="h-3.5 w-3.5 text-blue-500" />
                <span>Linked Exhibits</span>
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{(links as any[]).length}</span>
              </div>
              <LinkedExhibitsSummary />
            </div>

            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-3 border-b ${
              allocationValidation ? 'bg-red-50 border-red-200' : 'bg-stone-50/50 border-stone-100'
            }`}>
              <div>
                <span className="block text-[10px] uppercase tracking-wide text-stone-400">Allocated</span>
                <strong className="text-sm text-stone-800">{allocationTotal.toFixed(1)}%</strong>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wide text-stone-400">Allocated flow</span>
                <strong className="font-mono text-sm text-stone-800">
                  {fmtFlow(systemFlow * allocationTotal / 100)}
                </strong>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wide text-stone-400">Unallocated</span>
                <strong className="text-sm text-stone-800">{unallocatedPct.toFixed(1)}%</strong>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wide text-stone-400">Unallocated flow</span>
                <strong className="font-mono text-sm text-stone-800">
                  {fmtFlow(systemFlow * unallocatedPct / 100)}
                </strong>
              </div>
              {(allocationPending > 0 || branchAllocationPending > 0 || allocationValidation) && (
                <div className={`col-span-2 sm:col-span-4 text-xs ${
                  allocationValidation ? 'text-red-700' : 'text-amber-700'
                }`}>
                  {allocationValidation ? (
                    <p>{allocationValidation}</p>
                  ) : (
                    <div className="space-y-1">
                      {allocationPending > 0 && (
                        <p>
                          {allocationPending} configured loop{allocationPending === 1 ? '' : 's'} has{allocationPending === 1 ? '' : 've'} an unreviewed total-flow percentage. Blank means unreviewed; 0% is an intentional allocation.
                        </p>
                      )}
                      {branchAllocationPending > 0 && (
                        <p>
                          {branchAllocationPending} linked Bio/Degas branch{branchAllocationPending === 1 ? '' : 'es'} has{branchAllocationPending === 1 ? '' : 've'} an unreviewed branch percentage. Blank means unreviewed; 0% is an intentional allocation.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Card View ───────────────────────────────────────────────── */}
            {flowViewMode === 'card' && (
              <div className="p-5">
                {flowEditMode && flowForm ? (
                  <div className="space-y-6">
                    {expandedCardLoops.map((n, idx) => {
                      const colors = LOOP_COLORS[n] ?? LOOP_COLORS[1];
                      return (
                        <div key={n}>
                          {idx > 0 && <div className="border-t border-stone-100 mb-6" />}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${colors.badge}`}>{n}</span>
                              {inlineLoopRename?.loopNumber === n ? (
                                <div className="flex items-center gap-1.5" onKeyDown={event => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitInlineLoopRename();
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setInlineLoopRename(null);
                                  }
                                }}>
                                  <input
                                    autoFocus
                                    value={inlineLoopRename.value}
                                    onChange={event => setInlineLoopRename({
                                      loopNumber: n,
                                      value: event.target.value,
                                    })}
                                    aria-label={`Loop ${n} name`}
                                    maxLength={255}
                                    className="w-44 border border-violet-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                                  />
                                  <button type="button" onClick={commitInlineLoopRename}
                                    aria-label={`Save Loop ${n} name`}
                                    className="text-xs text-emerald-700 hover:text-emerald-900 border border-emerald-200 rounded px-1.5 py-1">
                                    Save
                                  </button>
                                  <button type="button" onClick={() => setInlineLoopRename(null)}
                                    aria-label={`Cancel Loop ${n} name`}
                                    className="text-xs text-stone-500 hover:text-stone-700 border border-stone-200 rounded px-1.5 py-1">
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => beginInlineLoopRename(n)}
                                  aria-label={`Edit ${loopName(flowForm, n)} name`}
                                  className="text-sm font-semibold text-stone-700 hover:text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-400/40 rounded px-1 -mx-1">
                                  {loopName(flowForm, n)}
                                </button>
                              )}
                            </div>
                            {n > 1 && (
                              <button type="button" onClick={() => {
                                setFF(`loop${n}_flow_source`, '');
                                 setFF(`loop${n}_flow_mode`, 'allocated');
                                 setFF(`loop${n}_match_loop_number`, '');
                                setFF(`loop${n}_filtration`, '');
                                setFF(`loop${n}_flow_pct`, '');
                                setFF(`loop${n}_bio_degas_pct`, '');
                                setFF(`loop${n}_bio_degas_m3h`, '');
                                setFF(`loop${n}_link_bio_degas`, false);
                                setFF(`loop${n}_name`, `Loop ${n}`);
                                setFlowSideStreams(streams =>
                                  streams.filter(stream => Number(stream.parent_loop_number) !== n));
                                setExpandedCardLoops(prev => prev.filter(x => x !== n));
                              }} className="text-xs text-stone-400 hover:text-red-500 flex items-center gap-0.5 transition-colors">
                                <X className="w-3 h-3" /> Remove
                              </button>
                            )}
                          </div>
                          {LoopEditor({ n })}
                        </div>
                      );
                    })}

                    {/* Add next loop (inside edit mode) */}
                    {(() => {
                      const next = [2, 3].find(n => !expandedCardLoops.includes(n));
                      if (!next || next > 3) return null;
                      return (
                        <button type="button" onClick={() => setExpandedCardLoops(prev => [...prev, next])}
                          className="w-full py-2.5 text-xs text-stone-400 border border-dashed border-stone-200 rounded-lg hover:border-blue-300 hover:text-blue-600 transition-colors flex items-center justify-center gap-1.5">
                          <Plus className="w-3.5 h-3.5" /> Add Loop {next}
                        </button>
                      );
                    })()}

                    <div className="flex items-center gap-2 pt-1 border-t border-stone-100">
                      <button onClick={saveFlowRoute} disabled={flowSaving}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" /> {flowSaving ? 'Saving…' : 'Save Flow Route'}
                      </button>
                      <button onClick={clearFlowDraft}
                        className="px-4 py-2 text-sm text-stone-500 border border-stone-200 bg-white rounded-lg hover:text-stone-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (() => {
                  const pendingLoop = listEditRow !== null && !activeLoops.includes(listEditRow) ? listEditRow : null;
                  const cardLoops = pendingLoop != null ? [...activeLoops, pendingLoop] : activeLoops;
                  const gridCls = cardLoops.length === 3 ? 'grid-cols-3' : cardLoops.length >= 2 ? 'grid-cols-2' : 'grid-cols-1 max-w-sm';
                  return (
                    <div>
                      <div className={`grid gap-4 ${gridCls}`}>
                        {cardLoops.map(n => {
                          const colors  = LOOP_COLORS[n] ?? LOOP_COLORS[1];
                          const pending = n === pendingLoop;
                          return (
                            <div key={n} className={`rounded-lg border p-4 ${colors.border} ${pending ? 'opacity-60 border-dashed' : ''}`}>
                              <div className="flex items-center gap-2 mb-3">
                                <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${colors.badge}`}>{n}</span>
                                {!readOnly ? (
                                  <button type="button" onClick={() => {
                                    startFlowEdit();
                                    beginInlineLoopRename(n);
                                  }}
                                    aria-label={`Edit ${loopName(system, n)} name`}
                                    className={`text-sm font-semibold ${colors.label} hover:underline focus:outline-none focus:ring-2 focus:ring-violet-400/40 rounded px-1 -mx-1`}>
                                    {loopName(system, n)}
                                  </button>
                                ) : (
                                  <span className={`text-sm font-semibold ${colors.label}`}>{loopName(system, n)}</span>
                                )}
                                {pending && <span className="text-[10px] text-stone-400 italic">unsaved</span>}
                              </div>
                              <LoopView n={n} />
                            </div>
                          );
                        })}
                      </div>
                      {canAddNext && pendingLoop == null && !readOnly && (
                        <button onClick={() => startFlowEdit(nextLoopToAdd)}
                          className="mt-4 w-full py-2.5 text-xs text-stone-400 border border-dashed border-stone-200 rounded-lg hover:border-blue-300 hover:text-blue-600 transition-colors flex items-center justify-center gap-1.5">
                          <Plus className="w-3.5 h-3.5" /> Add Loop {nextLoopToAdd}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── List View ───────────────────────────────────────────────── */}
            {flowViewMode === 'list' && (
              <div>
                {flowForm && listEditRow === null && (
                  <div className={`flex items-center justify-between gap-3 px-4 py-3 border-b ${hasUnsavedFlowChanges ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-100'}`}>
                    <span className={`text-xs ${hasUnsavedFlowChanges ? 'text-amber-800' : 'text-stone-500'}`}>
                      {hasUnsavedFlowChanges ? 'You have unsaved Flow Route changes.' : 'Flow Route editing is active.'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={saveFlowRoute} disabled={flowSaving || !hasUnsavedFlowChanges}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-violet-600 hover:bg-violet-700 rounded-md disabled:opacity-50">
                        <Save className="w-3 h-3" /> {flowSaving ? 'Saving…' : 'Save Flow Route'}
                      </button>
                      <button onClick={clearFlowDraft}
                        className="px-3 py-1.5 text-xs text-stone-500 border border-stone-200 bg-white rounded-md hover:text-stone-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto" tabIndex={0} aria-label="Flow Route list">
                  <table data-testid="flow-route-list-table" className="min-w-[1000px] w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 bg-stone-50/60">
                        <th className="min-w-32 px-4 py-2.5 text-left text-xs font-medium text-stone-500">Loop</th>
                        <th className="min-w-56 px-3 py-2.5 text-left text-xs font-medium text-stone-500">Flow Source</th>
                        <th aria-label="Loop Flow" className="min-w-36 px-3 py-2.5 text-left text-xs font-medium text-stone-500">
                          Loop Flow <span className="font-normal text-stone-400">({UNIT_LABELS[flowUnit]})</span>
                        </th>
                        <th className="min-w-48 px-3 py-2.5 text-left text-xs font-medium text-stone-500">Filtration</th>
                        <th className="min-w-44 px-3 py-2.5 text-left text-xs font-medium text-stone-500">
                          Equipment share <span className="font-normal text-stone-400">(of total system flow)</span>
                        </th>
                        <th aria-label="Bio / Degas" className="min-w-44 px-3 py-2.5 text-left text-xs font-medium text-stone-500">
                          Bio / Degas <span className="font-normal text-stone-400">({UNIT_LABELS[flowUnit]})</span>
                        </th>
                        <th className="min-w-56 px-3 py-2.5 text-left text-xs font-medium text-stone-500">Side Streams</th>
                        <th aria-label="Actions" className="w-44 px-3 py-2.5 text-right text-xs font-medium text-stone-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {[...new Set([
                        ...activeLoops,
                        ...(flowForm
                          ? [1, 2, 3].filter(loop =>
                              flowDraftLoopHasData(flowForm, loop) ||
                              expandedCardLoops.includes(loop)
                            )
                          : []),
                        ...(listEditRow !== null ? [listEditRow] : []),
                      ])].map(n => {
                        const colors = LOOP_COLORS[n] ?? LOOP_COLORS[1];
                        const isEditing = listEditRow === n;

                        if (isEditing && listRowForm) {
                          const linked: boolean = !!listRowForm.link_bio_degas;
                          const rowSource = { ...(flowForm || system), ...Object.fromEntries(
                            FLOW_LOOP_FIELDS.map(key => [`loop${n}_${key}`, listRowForm[key]]),
                          ) };
                          const rowMatched = loopMode(rowSource, n) === 'matched';
                          const rowResolvedFlow = resolveLoopFlow(rowSource, n);
                          const rowLoopFlow = rowResolvedFlow.flow;
                          const rowBioPct = nullableNumber(listRowForm.bio_degas_pct);
                          const rowBioFlow = rowLoopFlow != null && rowBioPct != null
                            ? rowLoopFlow * rowBioPct / 100
                            : null;
                           const rowEquipmentFlow = listRowForm.filtration === 'Sand Filter'
                             ? rowLoopFlow
                             : listRowForm.filtration === 'Foam Fractionation'
                               ? exhibitSourceFlowContext('Surface Skim').flow
                               : null;
                           const rowEquipmentShare = rowEquipmentFlow != null &&
                             systemFlow != null && systemFlow > 0
                             ? rowEquipmentFlow / systemFlow * 100
                             : null;
                          const rowSideStreams = sideStreamsFor(flowForm || system, n);
                          return (
                            <tr key={n} className="bg-blue-50/20">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className={`w-5 h-5 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${colors.badge}`}>{n}</span>
                                  <input value={listRowForm.name}
                                    onChange={event => setLRF('name', event.target.value)}
                                    aria-label={`Loop ${n} name`}
                                    className="w-28 border border-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40" />
                                </div>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <FlowSourcePicker
                                  id={`loop-${n}-list-flow-source`}
                                  ariaLabel={`Loop ${n} Flow Source`}
                                  compact
                                  value={listRowForm.flow_source || ''}
                                  onChange={nextSource => {
                                    setLRF('flow_source', nextSource);
                                    if (CIRCULATION_SOURCES.has(nextSource)) {
                                      setLRF('flow_mode', 'matched');
                                    } else {
                                      setLRF('flow_mode', 'allocated');
                                      setLRF('match_loop_number', '');
                                    }
                                  }}
                                />
                                {listRowForm.flow_source && <SourceSplitSummary source={listRowForm.flow_source} />}
                                {CIRCULATION_SOURCES.has(listRowForm.flow_source) && (
                                  <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2">
                                    <div className="text-[10px] font-semibold text-blue-800">
                                      {rowMatched ? 'Non-allocating circulation flow' : 'Allocated circulation flow (legacy mode)'}
                                    </div>
                                    <label className="mt-1 flex items-center gap-1 text-[10px] text-blue-800">
                                      <input type="checkbox" checked={listRowForm.flow_mode === 'matched'}
                                        onChange={event => setLRF('flow_mode', event.target.checked ? 'matched' : 'allocated')} />
                                      Match another loop
                                    </label>
                                    <select value={listRowForm.match_loop_number || ''} disabled={listRowForm.flow_mode !== 'matched'}
                                      aria-label={`Loop ${n} matched loop`}
                                      onChange={event => setLRF('match_loop_number', event.target.value)}
                                      className="mt-1 w-full rounded border border-stone-200 bg-white px-1 py-1 text-[10px]">
                                      <option value="">— Select eligible loop —</option>
                                      {[1, 2, 3].filter(target => target !== n && hasLoopConfiguration(rowSource, target) &&
                                        !resolveLoopFlow(rowSource, target, [n]).reason).map(target =>
                                        <option key={target} value={target}>Loop {target} — {loopName(rowSource, target)}</option>)}
                                    </select>
                                    <div className={`mt-1 text-[10px] ${rowResolvedFlow.reason ? 'text-amber-700' : 'text-blue-800'}`}>{matchDescription(rowSource, n)}</div>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top font-mono text-xs">
                                {!rowMatched && <input type="number" step="0.1" min="0" max="100" placeholder="%"
                                  aria-label={`Loop ${n} flow allocation percentage`}
                                  value={listRowForm.flow_pct}
                                  onChange={e => setLRF('flow_pct', e.target.value)}
                                  className="w-20 border border-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40" />}
                                <div className="mt-1 text-stone-800">{fmtFlow(rowLoopFlow ?? 0)}</div>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <select value={listRowForm.filtration} onChange={e => setLRF('filtration', e.target.value)}
                                  className="w-full border border-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40 bg-white">
                                  <option value="">— None —</option>
                                  {FILTRATION_OPTS.map(o => (
                                    <option key={o.value} value={o.value} disabled={o.saltwaterOnly && !isSaltwater}>
                                      {o.label}{o.saltwaterOnly && !isSaltwater ? ' (saltwater only)' : ''}
                                    </option>
                                  ))}
                                </select>
                              </td>
                               <td className="px-3 py-2 align-top font-mono text-xs">
                                 {rowEquipmentShare != null ? (
                                   <>
                                     <span className="font-semibold text-cyan-800">{rowEquipmentShare.toFixed(1)}%</span>
                                     <span className="mt-1 block font-sans text-[10px] text-stone-400">
                                       {listRowForm.filtration === 'Foam Fractionation' ? 'FF flow' : 'SF flow'} ÷ total system flow
                                     </span>
                                   </>
                                 ) : <span className="text-xs text-stone-300">—</span>}
                               </td>
                              <td className="px-3 py-2 align-top font-mono text-xs">
                                <label className="mb-1 flex items-center gap-1 font-sans text-[10px] text-stone-500">
                                  <input type="checkbox" checked={linked} onChange={e => setLRF('link_bio_degas', e.target.checked)}
                                    className="rounded border-stone-300 text-emerald-600" />
                                  Linked
                                </label>
                                {linked && (
                                  <>
                                    <input type="number" step="0.1" min="0" max="100" placeholder="% of loop"
                                      aria-label={`Loop ${n} Bio/Degas allocation percentage`}
                                      value={listRowForm.bio_degas_pct}
                                      onChange={e => setLRF('bio_degas_pct', e.target.value)}
                                      className="w-24 border border-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40" />
                                    <div className="mt-1 text-emerald-700">{fmtFlow(rowBioFlow ?? 0)}</div>
                                    <div className="font-sans text-[10px] text-stone-400">{allocationStatus(rowBioPct, 'loop')}</div>
                                  </>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top">
                                {rowSideStreams.length === 0 ? (
                                  <span className="text-xs italic text-stone-400">None</span>
                                ) : (
                                  <div className="space-y-1.5">
                                    {rowSideStreams.map((stream: any) => {
                                      const percentage = nullableNumber(stream.flow_pct);
                                      const streamFlow = rowLoopFlow != null && percentage != null
                                        ? rowLoopFlow * percentage / 100
                                        : null;
                                      return (
                                        <div key={stream.id || `${stream.name}-${stream.sort_order}`} className="text-[10px]">
                                          <div className="font-semibold text-cyan-800">{stream.name || 'Unnamed side stream'} <span className="font-normal text-stone-500">· {stream.preset || 'Custom'}</span></div>
                                          <div className={streamFlow == null ? 'font-mono text-amber-700' : 'font-mono text-stone-500'}>
                                            {percentage == null ? 'Allocation not reviewed' : `${percentage}% of parent`} · {fmtSideStreamFlow(streamFlow)}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => saveListRow(n)} disabled={flowSaving}
                                    className="flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-50">
                                    <Save className="h-3 w-3" /> {flowSaving ? '…' : 'Save'}
                                  </button>
                                  <button onClick={() => {
                                    const row = listEditRow;
                                    if (row !== null && listRowOriginal) {
                                      setFlowForm((draft: any) => {
                                        const restored = { ...(draft || createFlowDraft(system)) };
                                        for (const key of FLOW_LOOP_FIELDS) {
                                          restored[`loop${row}_${key}`] = listRowOriginal[key];
                                        }
                                        return flowDraftMatchesSystem(restored, system) ? null : restored;
                                      });
                                    }
                                    setListEditRow(null);
                                    setListRowForm(null);
                                    setListRowOriginal(null);
                                  }}
                                    aria-label={`Cancel editing Loop ${n}`}
                                    className="rounded border border-stone-200 p-1 text-xs text-stone-400 hover:text-stone-600">
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        const src = flowForm ? flowForm[`loop${n}_flow_source`] : system[`loop${n}_flow_source`];
                        const filt = flowForm ? flowForm[`loop${n}_filtration`] : system[`loop${n}_filtration`];
                        const bio = flowForm ? flowForm[`loop${n}_bio_degas_m3h`] : system[`loop${n}_bio_degas_m3h`];
                        const loopPct = nullableNumber(flowForm ? flowForm[`loop${n}_flow_pct`] : system[`loop${n}_flow_pct`]);
                        const bioPct = nullableNumber(flowForm ? flowForm[`loop${n}_bio_degas_pct`] : system[`loop${n}_bio_degas_pct`]);
                        const linked = flowForm ? !!flowForm[`loop${n}_link_bio_degas`] : !!system[`loop${n}_link_bio_degas`];
                        const displayedSource = flowForm || system;
                        const displayedSideStreams = sideStreamsFor(displayedSource, n);
                        const matched = loopMode(displayedSource, n) === 'matched';
                        const resolvedFlow = resolveLoopFlow(displayedSource, n);
                        const loopFlow = resolvedFlow.flow;
                         const equipmentFlow = filt === 'Sand Filter'
                           ? loopFlow
                           : filt === 'Foam Fractionation'
                             ? exhibitSourceFlowContext('Surface Skim').flow
                             : null;
                         const equipmentShare = equipmentFlow != null &&
                           systemFlow != null && systemFlow > 0
                           ? equipmentFlow / systemFlow * 100
                           : null;
                        const bioFlow = loopFlow != null && bioPct != null
                          ? loopFlow * bioPct / 100
                          : nullableNumber(bio);
                        return (
                          <tr key={n} className="group hover:bg-stone-50/60">
                            <td className="px-4 py-3 align-top">
                              <div className="flex items-center gap-2">
                                <span className={`w-5 h-5 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${colors.badge}`}>{n}</span>
                                <span className="text-xs font-semibold text-stone-700">{loopName(displayedSource, n)}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              {src ? (
                                <>
                                  <span className="flex items-center gap-1.5 text-stone-700">
                                    <Droplets className="h-3 w-3 shrink-0 text-cyan-500" /> {src}
                                  </span>
                                  {matched && <span className={`mt-1 block text-[10px] ${resolvedFlow.reason ? 'text-amber-700' : 'text-blue-700'}`}>
                                    Non-allocating · {matchDescription(displayedSource, n)}
                                  </span>}
                                </>
                              ) : <span className="text-xs italic text-stone-400">No source set</span>}
                            </td>
                            <td className="px-3 py-3 align-top font-mono text-xs">
                              <span className="text-stone-800">{fmtFlow(loopFlow ?? 0)}</span>
                            </td>
                            <td className="px-3 py-3 align-top">
                              {filt ? (
                                <span className="flex items-center gap-1.5 text-stone-700">
                                  <FlaskConical className="h-3 w-3 shrink-0 text-violet-500" /> {filt}
                                </span>
                              ) : <span className="text-xs italic text-stone-400">—</span>}
                            </td>
                             <td className="px-3 py-3 align-top font-mono text-xs">
                               {equipmentShare != null ? (
                                 <>
                                   <span className="font-semibold text-cyan-800">{equipmentShare.toFixed(1)}%</span>
                                   <span className="mt-1 block font-sans text-[10px] text-stone-400">
                                     {filt === 'Foam Fractionation' ? 'FF flow' : 'SF flow'} ÷ total system flow
                                   </span>
                                 </>
                               ) : <span className="text-xs text-stone-300">—</span>}
                             </td>
                            <td className="px-3 py-3 align-top font-mono text-xs">
                              {linked ? (
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-semibold text-emerald-700">{fmtFlow(bioFlow ?? 0)}</span>
                                  <span className="font-sans text-[10px] text-stone-400">
                                    {allocationStatus(bioPct, 'loop')}
                                  </span>
                                  <span className="rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 font-sans text-[10px] text-emerald-600">
                                    linked
                                  </span>
                                </span>
                              ) : <span className="text-xs text-stone-300">—</span>}
                            </td>
                            <td className="px-3 py-3 align-top">
                              {displayedSideStreams.length === 0 ? (
                                <span className="text-xs italic text-stone-400">None</span>
                              ) : (
                                <div className="space-y-1.5">
                                  {displayedSideStreams.map((stream: any) => {
                                    const percentage = nullableNumber(stream.flow_pct);
                                    const streamFlow = loopFlow != null && percentage != null
                                      ? loopFlow * percentage / 100
                                      : null;
                                    return (
                                      <div key={stream.id || `${stream.name}-${stream.sort_order}`} className="text-[10px]">
                                        <div className="font-semibold text-cyan-800">{stream.name || 'Unnamed side stream'} <span className="font-normal text-stone-500">· {stream.preset || 'Custom'}</span></div>
                                        <div className={streamFlow == null ? 'font-mono text-amber-700' : 'font-mono text-stone-500'}>
                                          {percentage == null ? 'Allocation not reviewed' : `${percentage}% of parent`} · {fmtSideStreamFlow(streamFlow)}
                                        </div>
                                        {stream.notes && <div className="text-stone-400">{stream.notes}</div>}
                                      </div>
                                    );
                                  })}
                                  {displayedSideStreams.length > 1 && (
                                    <div className="text-[9px] italic text-stone-400">Each branch is independent; no shared total.</div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top">
                              {!readOnly && (
                                <div className="flex flex-wrap items-center justify-end gap-1">
                                  <button onClick={() => {
                                    const draft = flowForm || createFlowDraft(system);
                                    setListEditRow(n);
                                    setFlowForm(draft);
                                    setListRowOriginal(getFlowDraftRow(draft, n));
                                    setListRowForm(getFlowDraftRow(draft, n));
                                  }} className="flex items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-500 hover:text-blue-600">
                                    <Pencil className="h-3 w-3" /> Edit
                                  </button>
                                  <button onClick={() => {
                                    const draft = flowForm || createFlowDraft(system);
                                    setFlowForm(draft);
                                    setExpandedCardLoops(prev => prev.includes(n) ? prev : [...prev, n]);
                                    setFlowEditMode(true);
                                    setFlowViewMode('card');
                                  }} className="whitespace-nowrap rounded border border-cyan-200 bg-white px-2 py-1 text-xs text-cyan-700 hover:text-cyan-900">
                                    Side streams
                                  </button>
                                  {n > 1 && (
                                    <button onClick={() => deleteLoop(n)}
                                      aria-label={`Remove Loop ${n}`}
                                      className="rounded border border-stone-200 bg-white p-1 text-xs text-stone-300 hover:text-red-500">
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Add next loop footer */}
                {canAddNext && listEditRow !== nextLoopToAdd && !readOnly && (
                  <div className="px-4 py-3 border-t border-stone-100 bg-stone-50/30">
                    <button onClick={() => {
                      const draft = flowForm || createFlowDraft(system);
                      setListEditRow(nextLoopToAdd!);
                      setFlowForm(draft);
                      setListRowOriginal(getFlowDraftRow(draft, nextLoopToAdd!));
                      setListRowForm(getFlowDraftRow(draft, nextLoopToAdd!));
                    }} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-blue-600 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Add Loop {nextLoopToAdd}
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
          </div>
        );
      })()}

      <div
        id="lss-panel-pump"
        role="tabpanel"
        aria-labelledby="lss-tab-pump"
        tabIndex={0}
        hidden={activeTab !== 'pump'}
      >
        <div id="pump-selection">
          {activeTab === 'pump' && (
            <LSSPumpSelectionPanel
              systemId={systemId!}
              bookId={bookId!}
              readOnly={readOnly}
              sourcePackage={(book?.pump_selections || []).find(
                (item: any) => String(item.system_id) === String(systemId),
              )}
            />
          )}
        </div>
      </div>

      <div
        id="lss-panel-biological-media"
        role="tabpanel"
        aria-labelledby="lss-tab-biological-media"
        tabIndex={0}
        hidden={activeTab !== 'biological-media'}
      >
        <BiologicalMediaCalculatorPanel
          data={biologicalMedia}
          mediaProfiles={mediaProfileData?.items || []}
          tanProfiles={tanProfileData?.items || []}
          maxTanProfiles={maxTanProfileData?.items || []}
          speciesCatalog={biologicalSpeciesData?.items || []}
          readOnly={readOnly}
          form={biologicalMediaForm}
          onChange={(key: string, value: any) => setBiologicalMediaForm(current => ({ ...current, [key]: value, _stale: true }))}
          onSave={saveBiologicalMedia}
          onPreview={previewBiologicalMedia}
          onCreateRun={createBiologicalMediaRun}
          onApproveRun={approveBiologicalMediaRun}
          onRejectRun={rejectBiologicalMediaRun}
          onExportRun={exportBiologicalMediaRun}
          onCompareRuns={compareBiologicalMediaRunHistory}
          saving={biologicalMediaSaving}
          previewing={biologicalMediaPreviewing}
          runBusy={biologicalMediaRunBusy}
          comparison={biologicalMediaComparison}
          error={biologicalMediaIsError
            ? ((biologicalMediaQueryError as any)?.response?.data?.error?.message || 'Check the selected Design Book and system.')
            : null}
        />
      </div>

      <div
        id="lss-panel-uv"
        role="tabpanel"
        aria-labelledby="lss-tab-uv"
        tabIndex={0}
        hidden={activeTab !== 'uv'}
      >
        {/* UV Selection Panel */}
        {(() => {
          const uvStreams: any[] = uvSelectionDataForView?.streams || [];
          const selectableRevisions: any[] = uvSelectionDataForView?.selectable_revisions || [];
          const savedResult = uvResult;

          const hasUvStreams = uvStreams.length > 0;
          const hasFrozenUvSelection = usesFrozenPackage && !!uvSelectionDataForView?.saved;
          const showUvLoading = !usesFrozenPackage && uvSelectionLoading;
          const showUvError = !usesFrozenPackage && uvSelectionIsError;
          const uvErrorMessage = (uvSelectionError as any)?.response?.data?.error?.message
            || 'UV Selection data could not be loaded. Try again.';
          const systemFlowM3h = systemFlow ?? null;

          const uvSourceFlowM3h = (source: unknown): number | null => {
            const normalized = String(source || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
            const resultKeys = normalized === 'surfaceskim' || normalized === 'surfaceskimmerbox'
              ? ['surface_skim_flow_m3h']
              : normalized === 'bottomdrain'
                ? ['bottom_drain_flow_m3h']
                : normalized === 'bothintegrated'
                  ? ['surface_skim_flow_m3h', 'bottom_drain_flow_m3h']
                  : null;
            if (!resultKeys) return systemFlowM3h;
            if ((links as any[]).length === 0) return null;
            const calculations = (links as any[]).map(link => exhibitCalculations.find(
              (candidate: any) => String(candidate.inputs?.exhibit_id) === String(link.exhibit_id),
            ));
            if (calculations.some((calculation: any) =>
              !calculation || calculation.status !== 'valid' ||
              calculation.is_stale === true || calculation.freshness === 'stale' ||
              resultKeys.some(key => nullableNumber(calculation.results?.[key]) == null),
            )) return null;
            return calculations.reduce((total: number, calculation: any) =>
              total + resultKeys.reduce((subtotal, key) =>
                subtotal + Number(calculation.results[key]), 0), 0);
          };

          const loopFlowM3h = (loopNumber: number, path: number[] = []): number | null => {
            if (path.includes(loopNumber)) return null;
            if (system[`loop${loopNumber}_flow_mode`] === 'matched') {
              const target = nullableNumber(system[`loop${loopNumber}_match_loop_number`]);
              return Number.isInteger(target) && target! >= 1 && target! <= 3
                ? loopFlowM3h(target!, [...path, loopNumber])
                : null;
            }
            const pct = nullableNumber(system[`loop${loopNumber}_flow_pct`]);
            const source = system[`loop${loopNumber}_flow_source`];
            const basisFlow = uvSourceFlowM3h(source);
            return pct != null && basisFlow != null ? basisFlow * pct / 100 : null;
          };

          const streamFlowM3h = (stream: any): number | null => {
            const loopFlow = loopFlowM3h(Number(stream.parent_loop_number));
            const pct = nullableNumber(stream.flow_pct);
            return loopFlow != null && pct != null ? loopFlow * pct / 100 : null;
          };

          const fmtUvFlow = (m3h: number | null): string => {
            if (m3h == null) return '—';
            const ls = m3h / 3.6;
            return `${m3h.toFixed(2)} m³/h · ${ls.toFixed(3)} L/s`;
          };

          const getAssignment = (streamId: string) =>
            uvStreamAssignments[streamId] ?? {
              uv_revision_id: '',
              uv_unit_quantity: '1',
              uvt_basis: '85T' as const,
            };

          const setAssignment = (streamId: string, key: string, value: string) => {
            setUvStreamAssignments(prev => ({
              ...prev,
              [streamId]: { ...getAssignment(streamId), [key]: value },
            }));
          };

          const getStreamResult = (streamId: string) =>
            savedResult?.streams?.find((s: any) => s.side_stream_id === streamId) ?? null;

          const overallColor = savedResult?.overall_status === 'pass'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
            : savedResult?.overall_status === 'fail'
              ? 'border-red-300 bg-red-50 text-red-700'
              : savedResult?.overall_status === 'partial'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-stone-200 bg-stone-50 text-stone-600';

          const loopNames: Record<number, string> = {
            1: system.loop1_name || 'Loop 1',
            2: system.loop2_name || 'Loop 2',
            3: system.loop3_name || 'Loop 3',
          };

          return (
            <div className="space-y-5">
              {usesFrozenPackage && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <div className="flex items-start gap-2">
                    <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Frozen UV selection — read-only</p>
                      <p className="mt-1 text-xs text-emerald-800">
                        UV products, UVT basis, unit count, and target fluence cannot be changed in this revision.
                        Historical values below come only from the captured Design Book package.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Header card */}
              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-cyan-50/30">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-600" />
                    <span className="text-sm font-semibold text-cyan-800">UV Fluence Selection</span>
                  </div>
                  {savedResult && (
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${overallColor}`}>
                      {savedResult.overall_status === 'pass' ? '✓ All streams pass'
                        : savedResult.overall_status === 'fail' ? 'Fluence target not met'
                        : savedResult.overall_status === 'partial' ? 'Partial — some streams pass'
                        : 'Incomplete'}
                    </span>
                  )}
                </div>

                {/* Target fluence + calculate */}
                {(!usesFrozenPackage || hasFrozenUvSelection) && (
                <div className="px-5 py-4 border-b border-stone-100 bg-stone-50/40">
                  <div className="flex flex-wrap items-end gap-4">
                    {!usesFrozenPackage ? <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Target fluence (mJ/cm²)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="10000"
                          step="1"
                          value={uvTargetFluence}
                          onChange={e => setUvTargetFluence(e.target.value)}
                          disabled={readOnly}
                          aria-label="Target UV fluence in mJ/cm²"
                          className={`${inputCls} max-w-32 bg-white`}
                        />
                        <span className="text-xs text-stone-400">mJ/cm²</span>
                      </div>
                      <p className="text-[10px] text-stone-400 mt-1">Typical: 30–80 mJ/cm² depending on organism target. Default: 50 mJ/cm².</p>
                    </div> : (
                      <div>
                        <p className="text-xs font-medium text-stone-500">Captured target fluence</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-stone-800">
                          {uvSelectionDataForView?.saved?.target_fluence_mj_cm2} mJ/cm²
                        </p>
                      </div>
                    )}
                    {!readOnly && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={calculateUVSelection}
                          disabled={uvCalculating || !hasUvStreams}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          {uvCalculating ? 'Calculating…' : 'Save & Calculate'}
                        </button>
                        {!hasUvStreams && (
                          <p className="text-xs text-amber-700">
                            Add a UV side stream in the Flow Route tab first.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                )}

                {/* Fluence formula reference */}
                {(!usesFrozenPackage || hasFrozenUvSelection) && (
                <div className="px-5 py-3 bg-cyan-50/20 border-b border-stone-100">
                  <p className="text-[10px] text-stone-500">
                    <strong>Formula:</strong> F = I × V × n / Q &nbsp;·&nbsp;
                    I = irradiance (mW/cm²) · V = reactor volume (L/unit) · n = unit count · Q = stream flow (L/s)
                    &nbsp;·&nbsp; <strong>Hydraulic limit:</strong> Q / (lamps × n) ≤ 6.25 L/s per lamp
                  </p>
                </div>
                )}

                {usesFrozenPackage && !hasFrozenUvSelection && (
                  <div className="px-5 py-10 text-center">
                    <Zap className="mx-auto mb-3 h-8 w-8 text-stone-200" />
                    <p className="text-sm font-medium text-stone-700">No UV calculation was captured in this revision</p>
                    <p className="mx-auto mt-1 max-w-xl text-xs text-stone-500">
                      This released package contains no frozen UV product selection or calculated result.
                      Create a Draft revision to use the latest approved UV engineering values.
                    </p>
                  </div>
                )}

                {/* UV data loading state */}
                {showUvLoading && (
                  <div className="px-5 py-10 text-center" role="status">
                    <Activity className="mx-auto mb-3 w-8 h-8 text-cyan-200 animate-pulse" />
                    <p className="text-sm font-medium text-stone-500">Loading UV side streams…</p>
                  </div>
                )}

                {/* UV data error state */}
                {showUvError && (
                  <div className="px-5 py-10 text-center">
                    <AlertCircle className="mx-auto mb-3 w-8 h-8 text-red-300" />
                    <p className="text-sm font-medium text-red-700">Unable to load UV side streams</p>
                    <p className="text-xs text-red-600 mt-1">{uvErrorMessage}</p>
                    <button
                      type="button"
                      onClick={() => { void refetchUvSelection(); }}
                      className="mt-3 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Retry UV Selection
                    </button>
                  </div>
                )}

                {/* No UV streams empty state */}
                {!usesFrozenPackage && !showUvLoading && !showUvError && !hasUvStreams && (
                  <div className="px-5 py-10 text-center">
                    <Zap className="mx-auto mb-3 w-8 h-8 text-stone-200" />
                    <p className="text-sm font-medium text-stone-500">No UV side streams configured</p>
                    <p className="text-xs text-stone-400 mt-1">
                      Open the Flow Route tab and add a UV side stream to a loop to begin UV selection.
                    </p>
                  </div>
                )}

                {/* UV stream cards */}
                {!showUvLoading && !showUvError && hasUvStreams && (!usesFrozenPackage || hasFrozenUvSelection) && (
                  <div className="divide-y divide-stone-100">
                    {uvStreams.map((stream: any) => {
                      const assignment = getAssignment(stream.id);
                      const derivedFlow = streamFlowM3h(stream);
                      const streamResult = getStreamResult(stream.id);
                      const selectedRevision = selectableRevisions.find(
                        (r: any) => r.revision_id === assignment.uv_revision_id);
                      const assignedRevision = stream.uv_revision || selectedRevision;
                      const resultStatus = streamResult?.status;
                      const targetMet = streamResult?.target_met_selected === true && streamResult?.hydraulic_pass !== false;

                      return (
                        <div key={stream.id} className="px-5 py-4">
                          {/* Stream header */}
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full">
                                  {loopNames[Number(stream.parent_loop_number)]}
                                </span>
                                <span className="text-sm font-semibold text-stone-800">{stream.name}</span>
                              </div>
                              <div className="text-[10px] text-stone-500 mt-0.5">
                                {stream.flow_pct != null ? `${Number(stream.flow_pct).toFixed(1)}% of loop · ` : ''}
                                Flow: <span className="font-mono">{fmtUvFlow(derivedFlow)}</span>
                              </div>
                            </div>
                            {streamResult && (
                              <span className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded border ${
                                resultStatus === 'ready' && targetMet
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : resultStatus === 'ready' && !targetMet
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                              }`}>
                                {resultStatus === 'ready' && targetMet ? '✓ Pass'
                                  : resultStatus === 'ready' ? '✗ Fail'
                                  : 'Incomplete'}
                              </span>
                            )}
                          </div>

                          {/* Product + quantity selectors */}
                          {!readOnly && (
                            <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 mb-3">
                              <div>
                                <label className="block text-[10px] font-medium text-stone-500 mb-1">
                                  UV Product Revision
                                </label>
                                <select
                                  value={assignment.uv_revision_id}
                                  onChange={e => setAssignment(stream.id, 'uv_revision_id', e.target.value)}
                                  aria-label={`UV product revision for ${stream.name}`}
                                  className={`${inputCls} bg-white text-sm`}
                                >
                                  <option value="">— Select approved UV product —</option>
                                  {selectableRevisions.map((rev: any) => (
                                    <option key={rev.revision_id} value={rev.revision_id}>
                                      {rev.product_name}
                                    </option>
                                  ))}
                                </select>
                                {selectableRevisions.length === 0 && (
                                  <p className="text-[10px] text-amber-700 mt-1">
                                    No approved UV products are available. An admin must approve engineering data in the PIM UV Engineering catalog first.
                                  </p>
                                )}
                              </div>
                              <div className="min-w-[100px]">
                                <label className="block text-[10px] font-medium text-stone-500 mb-1">
                                  Units
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={assignment.uv_unit_quantity}
                                  onChange={e => setAssignment(stream.id, 'uv_unit_quantity', e.target.value)}
                                  aria-label={`Unit quantity for ${stream.name}`}
                                  className={`${inputCls} bg-white`}
                                />
                              </div>
                              <div className="min-w-[130px]">
                                <label className="block text-[10px] font-medium text-stone-500 mb-1">
                                  Governing UVT basis
                                </label>
                                <select
                                  value={assignment.uvt_basis}
                                  onChange={e => setAssignment(stream.id, 'uvt_basis', e.target.value)}
                                  aria-label={`UVT basis for ${stream.name}`}
                                  className={`${inputCls} bg-white`}
                                >
                                  <option value="85T">85%T</option>
                                  <option value="95T">95%T</option>
                                </select>
                              </div>
                            </div>
                          )}

                          {/* Read-only: current assignment if no selectors */}
                          {readOnly && assignedRevision && (
                            <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 px-3 py-2 text-xs mb-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-stone-700">
                                  {assignedRevision.product_code} — {assignedRevision.product_name}
                                </span>
                                <span className="text-stone-500">
                                  {stream.uv_unit_quantity ?? 1} unit{(stream.uv_unit_quantity ?? 1) === 1 ? '' : 's'}
                                </span>
                              </div>
                              <div className="text-stone-500 mt-0.5">
                                Rev {assignedRevision.revision_number}
                                {assignedRevision.manufacturer ? ` · ${assignedRevision.manufacturer}` : ''}
                              </div>
                              <div className="text-stone-500 mt-0.5">
                                Governing UVT basis: {stream.uvt_basis === '95T' ? '95%T' : '85%T'}
                              </div>
                            </div>
                          )}

                          {/* Selected product spec summary */}
                          {(() => {
                            const rev = selectedRevision || (stream.uv_revision_id ? stream.uv_revision : null);
                            if (!rev) return null;
                            return (
                              <div className="rounded-md bg-stone-50 border border-stone-200 px-3 py-2 text-[10px] text-stone-600 mb-3 grid sm:grid-cols-3 gap-x-4 gap-y-1">
                                <div><span className="text-stone-400">Lamps/unit:</span> <strong>{rev.lamp_count ?? rev.lamp_count}</strong></div>
                                <div><span className="text-stone-400">Lamp power:</span> <strong>{Number(rev.lamp_power_w ?? 0).toFixed(0)} W</strong></div>
                                <div><span className="text-stone-400">Reactor vol/unit:</span> <strong>{Number(rev.effective_reactor_volume_l ?? 0).toFixed(2)} L</strong></div>
                                <div><span className="text-stone-400">Irradiance 85th pct:</span> <strong className="font-mono">{Number(rev.irradiance_85t_mw_cm2 ?? 0).toFixed(4)} mW/cm²</strong></div>
                                <div><span className="text-stone-400">Irradiance 95th pct:</span> <strong className="font-mono">{Number(rev.irradiance_95t_mw_cm2 ?? 0).toFixed(4)} mW/cm²</strong></div>
                                <div><span className="text-stone-400">Compatibility:</span> <strong>{rev.compatibility}</strong></div>
                                {rev.approved_per_lamp_flow_exception_m3h && (
                                  <div className="sm:col-span-3">
                                    <span className="text-amber-700">Approved hydraulic exception: </span>
                                    <strong className="text-amber-800">{Number(rev.approved_per_lamp_flow_exception_m3h).toFixed(2)} m³/h per lamp</strong>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* Calculation result */}
                          {streamResult && (
                            <div className={`rounded-lg border px-3 py-2.5 text-xs ${
                              resultStatus === 'ready' && targetMet
                                ? 'border-emerald-200 bg-emerald-50'
                                : resultStatus === 'ready'
                                  ? 'border-red-100 bg-red-50'
                                  : 'border-amber-100 bg-amber-50'
                            }`}>
                              {streamResult.status === 'ready' ? (
                                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                                  <div>
                                    <span className="text-stone-500">Flow (L/s):</span>
                                    <strong className="ml-1 font-mono">{Number(streamResult.flow_ls ?? 0).toFixed(3)}</strong>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Flow/unit (L/s):</span>
                                    <strong className="ml-1 font-mono">{Number(streamResult.flow_per_unit_ls ?? 0).toFixed(3)}</strong>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Flow/lamp (L/s):</span>
                                    <strong className={`ml-1 font-mono ${streamResult.hydraulic_pass ? 'text-emerald-700' : 'text-red-700'}`}>
                                      {Number(streamResult.flow_per_lamp_ls ?? 0).toFixed(3)}
                                      {streamResult.hydraulic_pass ? ' ✓' : ' ✗'}{streamResult.hydraulic_exception ? ' (exception)' : ''}
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Contact time (s):</span>
                                    <strong className="ml-1 font-mono">{Number(streamResult.contact_time_s ?? 0).toFixed(3)}</strong>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Fluence @ 85th pct UVT:</span>
                                    <strong className={`ml-1 font-mono ${streamResult.selected_uvt_basis === '85T' ? (streamResult.target_met_85t ? 'text-emerald-700' : 'text-red-700') : 'text-stone-700'}`}>
                                      {Number(streamResult.fluence_85t_mj_cm2 ?? 0).toFixed(4)} mJ/cm²
                                      {streamResult.selected_uvt_basis === '85T'
                                        ? (streamResult.target_met_85t ? ' ✓ governing' : ` ✗ governing (need ${uvTargetFluence})`)
                                        : ' reference'}
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Fluence @ 95th pct UVT:</span>
                                    <strong className={`ml-1 font-mono ${streamResult.selected_uvt_basis === '95T' ? (streamResult.target_met_95t ? 'text-emerald-700' : 'text-red-700') : 'text-stone-700'}`}>
                                      {Number(streamResult.fluence_95t_mj_cm2 ?? 0).toFixed(4)} mJ/cm²
                                      {streamResult.selected_uvt_basis === '95T'
                                        ? (streamResult.target_met_95t ? ' ✓ governing' : ` ✗ governing (need ${uvTargetFluence})`)
                                        : ' reference'}
                                    </strong>
                                  </div>
                                </div>
                              ) : (
                                <ul className="space-y-0.5">
                                  {(streamResult.reasons || []).map((reason: string, i: number) => (
                                    <li key={i} className="text-amber-800">· {reason}</li>
                                  ))}
                                </ul>
                              )}
                              {streamResult.compatibility_warning && (
                                <p className="mt-2 text-amber-700 border-t border-amber-100 pt-2">
                                  ⚠ {streamResult.compatibility_warning}
                                </p>
                              )}
                            </div>
                          )}

                          {/* If no result yet and no selection */}
                          {!readOnly && !streamResult && !assignment.uv_revision_id && !stream.uv_revision_id && (
                            <p className="text-[10px] text-stone-400 italic">Select a UV product revision above and click Save & Calculate.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Overall saved result summary */}
                {savedResult && hasUvStreams && (
                  <div className={`mx-5 mb-5 rounded-lg border px-4 py-3 text-xs ${overallColor}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold">Overall result</span>
                      <span className="font-mono text-[10px]">Target: {savedResult.target_fluence_mj_cm2} mJ/cm²</span>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-2">
                      <div>
                        <span className="opacity-70">Streams calculated:</span>
                        <strong className="ml-1">{savedResult.streams?.length ?? 0}</strong>
                      </div>
                      <div>
                        <span className="opacity-70">Passing selected UVT basis:</span>
                        <strong className="ml-1">
                          {savedResult.streams?.filter((s: any) => s.target_met_selected && s.hydraulic_pass !== false).length ?? 0}
                          {' / '}{savedResult.streams?.length ?? 0}
                        </strong>
                      </div>
                      <div>
                        <span className="opacity-70">Hydraulic OK:</span>
                        <strong className="ml-1">
                          {savedResult.streams?.filter((s: any) => s.hydraulic_pass === true).length ?? 0}
                          {' / '}{savedResult.streams?.length ?? 0}
                        </strong>
                      </div>
                    </div>
                    {savedResult.overall_status === 'pass' && (
                      <p className="mt-2 font-semibold">All UV streams meet the target fluence and hydraulic limit.</p>
                    )}
                    {savedResult.overall_status === 'fail' && (
                      <p className="mt-2">One or more streams do not meet the target fluence or hydraulic limit. Increase unit count or select a larger model.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      <div
        id="lss-panel-thermal"
        role="tabpanel"
        aria-labelledby="lss-tab-thermal"
        tabIndex={0}
        hidden={activeTab !== 'thermal'}
      >
        <EquipmentEmptyState
          title="Thermal Selection"
          description="Heating and chilling equipment selection is not configured for this system yet."
        />
      </div>
      <div
        id="lss-panel-ozone"
        role="tabpanel"
        aria-labelledby="lss-tab-ozone"
        tabIndex={0}
        hidden={activeTab !== 'ozone'}
      >
        <EquipmentEmptyState
          title="Ozone Selection"
          description="Ozone equipment selection is not configured for this system yet."
        />
      </div>
      <div
        id="lss-panel-other"
        role="tabpanel"
        aria-labelledby="lss-tab-other"
        tabIndex={0}
        hidden={activeTab !== 'other'}
      >
        <EquipmentEmptyState
          title="Other Equipment"
          description="Additional equipment selections will appear here when they are configured for this system."
        />
      </div>

      </fieldset>

      {pendingUnlinkLink && !readOnly && (
        <ConfirmDialog
          title={`Remove exhibit link from ${system.system_name}?`}
          message={`This will unlink ${pendingUnlinkLink.exhibit_code} — ${pendingUnlinkLink.exhibit_name} from ${system.system_name}. Linked flow calculations and turnover values may change after the link is removed.`}
          confirmLabel={unlinkError ? 'Retry Remove' : 'Remove Link'}
          cancelLabel="Keep Link"
          danger
          busy={deletingLink === pendingUnlinkLink.id}
          busyLabel="Removing…"
          error={unlinkError || undefined}
          onConfirm={handleDeleteLink}
          onCancel={cancelDeleteLink}
        />
      )}
      {showConfigReset && !readOnly && isConfigured && (
        <ConfirmDialog
          title={`Change configuration for ${system.system_name}?`}
          message="Confirming will erase this system’s existing LSS input and configuration data, including flow and turnover inputs, linked exhibits, Flow Route data, compact-unit selection, and equipment selections. Project tanks, exhibits, tank hydraulics, and reusable PIM source data will not be changed."
          confirmLabel={configResetError ? 'Retry Reset' : 'Erase and Reconfigure'}
          cancelLabel="Keep Current Configuration"
          danger
          busy={configResetSaving}
          busyLabel="Resetting…"
          error={configResetError || undefined}
          onConfirm={handleConfigReset}
          onCancel={cancelConfigReset}
        />
      )}
      {lifecycleAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-stone-900">
                  {lifecycleAction === 'archive' ? 'Archive / Decommission LSS' : 'Supersede LSS'}
                </h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  The historical system and all governed evidence remain readable.
                </p>
              </div>
              <button type="button" onClick={closeLifecycleDialog} aria-label="Close lifecycle dialog">
                <X className="h-5 w-5 text-stone-400" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {lifecycleAction === 'supersede' && (
                <label className="block text-xs font-medium text-stone-600">
                  Replacement LSS *
                  <select
                    value={replacementSystemId}
                    onChange={event => setReplacementSystemId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select the current replacement</option>
                    {replacementCandidates.map((candidate: any) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.system_code} — {candidate.system_name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-xs font-medium text-stone-600">
                Reason *
                <textarea
                  rows={4}
                  value={lifecycleReason}
                  onChange={event => setLifecycleReason(event.target.value)}
                  placeholder="Record why this system is no longer current…"
                  className="mt-1 w-full resize-none rounded-lg border border-stone-200 px-3 py-2 text-sm"
                />
              </label>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                This action makes the LSS read-only and excludes it from current selections. It does not migrate configuration to a replacement.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-4">
              <button type="button" onClick={closeLifecycleDialog} className="px-4 py-2 text-sm text-stone-600">Cancel</button>
              <button
                type="button"
                onClick={saveLifecycle}
                disabled={lifecycleSaving || !lifecycleReason.trim() || (lifecycleAction === 'supersede' && !replacementSystemId)}
                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"
              >
                {lifecycleSaving ? 'Saving…' : lifecycleAction === 'archive' ? 'Confirm archive' : 'Confirm supersession'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
