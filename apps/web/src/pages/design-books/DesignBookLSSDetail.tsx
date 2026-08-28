import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import StatusBadge from '../../components/ui/StatusBadge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import {
  ChevronRight, Activity, Pencil, Save, X, Plus, Trash2,
  Waves, Gauge, GitBranch, Settings2, AlertCircle, Check,
  Droplets, ArrowLeft, Route, FlaskConical, Wind,
  Layers, Package, ExternalLink, Zap, Weight, Maximize2, LockKeyhole,
  MoreHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';

const SYSTEM_TYPES = [
  'Life Support', 'Filtration', 'Circulation', 'UV Sterilization',
  'Ozone', 'Heating', 'Chilling', 'Skimming', 'Carbon Dosing',
  'Denitrification', 'Other',
];
const WATER_TYPES = ['Marine', 'Freshwater', 'Brackish', 'Salt Water', 'Blackwater'];
const STATUSES   = ['Draft', 'Design', 'For Review', 'Approved', 'Active', 'Released', 'Decommissioned'];
const LINK_TYPES = ['Primary', 'Secondary', 'Emergency', 'Backup', 'Observation', 'Redundant'];
const FLOW_ROUTE_VIEW_STORAGE_KEY = 'lss-flow-route-view';
type FlowViewMode = 'card' | 'list';

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

const FLOW_LOOP_FIELDS = [
  'flow_source',
  'filtration',
  'flow_pct',
  'bio_degas_pct',
  'bio_degas_m3h',
  'link_bio_degas',
] as const;
const FLOW_UNSAVED_CONFIRMATION = 'You have unsaved Flow Route changes. Leave this page and discard them?';

function createFlowDraft(system: any) {
  const draft: Record<string, string | boolean> = {};
  for (const n of [1, 2, 3]) {
    draft[`loop${n}_flow_source`] = system[`loop${n}_flow_source`] || '';
    draft[`loop${n}_filtration`] = system[`loop${n}_filtration`] || '';
    draft[`loop${n}_flow_pct`] =
      system[`loop${n}_flow_pct`] != null ? String(system[`loop${n}_flow_pct`]) : '';
    draft[`loop${n}_bio_degas_pct`] =
      system[`loop${n}_bio_degas_pct`] != null ? String(system[`loop${n}_bio_degas_pct`]) : '';
    draft[`loop${n}_bio_degas_m3h`] =
      system[`loop${n}_bio_degas_m3h`] != null ? String(system[`loop${n}_bio_degas_m3h`]) : '';
    draft[`loop${n}_link_bio_degas`] = !!system[`loop${n}_link_bio_degas`];
  }
  return draft;
}

function flowDraftLoopHasData(draft: Record<string, any>, n: number) {
  return !!(
    draft[`loop${n}_flow_source`] ||
    draft[`loop${n}_filtration`] ||
    (draft[`loop${n}_flow_pct`] != null && draft[`loop${n}_flow_pct`] !== '') ||
    (draft[`loop${n}_bio_degas_pct`] != null && draft[`loop${n}_bio_degas_pct`] !== '') ||
    (draft[`loop${n}_bio_degas_m3h`] != null && draft[`loop${n}_bio_degas_m3h`] !== '') ||
    draft[`loop${n}_link_bio_degas`]
  );
}

function flowDraftMatchesSystem(draft: Record<string, any>, system: any) {
  return [1, 2, 3].every(n => (
    (draft[`loop${n}_flow_source`] || '') === (system[`loop${n}_flow_source`] || '') &&
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
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function allocationStatus(value: number | null, basis: 'system' | 'loop') {
  if (value == null) return 'allocation not reviewed';
  return value === 0 ? '0% (intentional zero allocation)' : `${value}% of ${basis}`;
}

function buildFlowLoopFields(draft: Record<string, any>, clearedLoop?: number) {
  const fields: Record<string, any> = {};
  for (const n of [1, 2, 3]) {
    const cleared = n === clearedLoop;
    fields[`loop${n}_flow_source`] = cleared ? null : (draft[`loop${n}_flow_source`] || null);
    fields[`loop${n}_filtration`] = cleared ? null : (draft[`loop${n}_filtration`] || null);
    fields[`loop${n}_flow_pct`] = cleared ? null : nullableNumber(draft[`loop${n}_flow_pct`]);
    fields[`loop${n}_bio_degas_pct`] = cleared ? null : nullableNumber(draft[`loop${n}_bio_degas_pct`]);
    fields[`loop${n}_bio_degas_m3h`] = cleared ? null : nullableNumber(draft[`loop${n}_bio_degas_m3h`]);
    fields[`loop${n}_link_bio_degas`] = cleared ? false : !!draft[`loop${n}_link_bio_degas`];
  }
  return fields;
}

function flowAllocationError(draft: Record<string, any>): string | null {
  let total = 0;
  for (const n of [1, 2, 3]) {
    for (const [key, label] of [
      [`loop${n}_flow_pct`, `Loop ${n} allocation`],
      [`loop${n}_bio_degas_pct`, `Loop ${n} Bio/Degas allocation`],
    ] as const) {
      const raw = draft[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return `${label} must be between 0% and 100%.`;
      }
    }
    const flowPct = nullableNumber(draft[`loop${n}_flow_pct`]);
    if (flowPct != null) total += flowPct;
  }
  return total > 100.000001
    ? `Active loop allocations total ${total.toFixed(1)}%. Reduce them to 100% or less before saving.`
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
        <div><span className="block opacity-70">Calculated flow</span><strong className="font-mono">{calculation.results?.calculated_required_flow_m3h ?? '—'} m³/h</strong></div>
        <div><span className="block opacity-70">Design flow</span><strong className="font-mono">{calculation.results?.design_flow_m3h ?? '—'} m³/h</strong></div>
        <div><span className="block opacity-70">Allocated flow</span><strong className="font-mono">{calculation.results?.allocated_flow_m3h ?? '—'} m³/h</strong></div>
        <div><span className="block opacity-70">Turnover</span><strong className="font-mono">{calculation.results?.turnover_rate_cycles_per_hour ?? '—'} ×/h</strong></div>
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
  const qc = useQueryClient();
  const user = useAuthStore(state => state.user);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const { data: liveSystem, isLoading: sysLoading } = useQuery({
    queryKey: ['system', systemId],
    queryFn: () => api.get(`/systems/${systemId}`).then(r => r.data),
  });
  const { data: book } = useQuery({
    queryKey: ['design-book', bookId],
    queryFn: () => api.get(`/design-books/${bookId}`).then(r => r.data),
  });
  const { data: liveLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ['system-exhibit-links', systemId],
    queryFn: () => api.get(`/systems/${systemId}/exhibit-links`).then(r => r.data),
  });
  const { data: compactUnits = [] } = useQuery({
    queryKey: ['lss-compact-units'],
    queryFn: () => api.get('/lss-compact-units').then(r => r.data),
  });
  const usesFrozenPackage = !!book && !['Draft', 'In Progress'].includes(book.status);
  const system = usesFrozenPackage
    ? (book.systems || []).find((item: any) => item.id === systemId)
    : liveSystem;
  const links = usesFrozenPackage
    ? (book.system_links || []).filter((item: any) => item.system_id === systemId)
    : liveLinks;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['system', systemId] });
    qc.invalidateQueries({ queryKey: ['system-exhibit-links', systemId] });
    qc.invalidateQueries({ queryKey: ['design-book', bookId] });
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
  const [pendingUnitId, setPendingUnitId] = useState<string>('');

  // Flow Route edit state
  const [flowEditMode, setFlowEditMode] = useState(false);
  const [flowSaving,   setFlowSaving]   = useState(false);
  const [flowForm,     setFlowForm]     = useState<any>(null);
  const setFF = (k: string, v: any) => setFlowForm((f: any) => ({ ...f, [k]: v }));
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
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === location.pathname && destination.search === location.search)
      ) return true;
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
      if (nextUrl === currentUrl || window.confirm(FLOW_UNSAVED_CONFIRMATION)) return;

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
    setFlowForm(null);
    setFlowEditMode(false);
    setListEditRow(null);
    setListRowForm(null);
    setListRowOriginal(null);
    setExpandedCardLoops([1]);
  };

  const getFlowDraftRow = (draft: any, n: number) => ({
    flow_source: draft[`loop${n}_flow_source`] || '',
    filtration: draft[`loop${n}_filtration`] || '',
    flow_pct: draft[`loop${n}_flow_pct`] || '',
    bio_degas_pct: draft[`loop${n}_bio_degas_pct`] || '',
    bio_degas_m3h: draft[`loop${n}_bio_degas_m3h`] || '',
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
    let flowVal     = system.design_flow_m3h  != null ? String(system.design_flow_m3h)  : '';
    let turnoverVal = system.turnover_rate_hr != null ? String(system.turnover_rate_hr) : '';

    // Auto-compute from primary exhibit when values are missing
    if ((!flowVal || !turnoverVal) && (links as any[]).length > 0 && book) {
      const primaryLink = (links as any[]).find((l: any) => l.link_type === 'Primary') ?? (links as any[])[0];
      if (primaryLink) {
        const hydr    = (book.hydraulics || []).find((h: any) => h.exhibit_id === primaryLink.exhibit_id);
        const exTanks = (book.tanks      || []).filter((t: any) => t.exhibit_id === primaryLink.exhibit_id);
        const opVol   = exTanks.reduce((s: number, t: any) =>
          s + (parseFloat(t.operating_volume_m3 ?? t.design_volume_m3) || 0), 0);
        const targetRate = parseFloat(hydr?.target_turnover_rate) || 0;
        if (opVol > 0 && targetRate > 0) {
          if (!flowVal)     flowVal     = (opVol * targetRate).toFixed(2);
          if (!turnoverVal) turnoverVal = targetRate.toFixed(2);
        }
      }
    }

    setEditForm({
      system_code:         system.system_code,
      system_name:         system.system_name,
      system_type:         system.system_type || '',
      water_type:          system.water_type  || '',
      design_flow_m3h:     flowVal,
      turnover_rate_hr:    turnoverVal,
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
        status:               editForm.status,
        duty_description:     editForm.duty_description   || null,
        redundancy_strategy:  editForm.redundancy_strategy || null,
        system_config:        system.system_config        || 'bespoke',
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
      refresh();
    } catch {
      toast.error('Failed to update system configuration');
    } finally {
      setConfigSaving(false);
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
    const validationMessage = flowAllocationError(flowForm || {});
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
        system_config:        system.system_config        || 'bespoke',
        compact_unit_id:      system.compact_unit_id      || null,
        design_book_id:       bookId,
        ...buildFlowLoopFields(flowForm),
      });
      toast.success('Flow route saved');
      clearFlowDraft();
      refresh();
    } catch {
      toast.error('Failed to save flow route');
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
    const validationMessage = flowAllocationError(draft);
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
        system_config:       system.system_config       || 'bespoke',
        compact_unit_id:     system.compact_unit_id     || null,
        design_book_id:      bookId,
        ...buildFlowLoopFields(draft),
      });
      toast.success(`Loop ${n} saved`);
      // Await refetch so the loop stays visible in the list until new data arrives
      await qc.refetchQueries({ queryKey: ['system', systemId] });
      qc.invalidateQueries({ queryKey: ['design-book', bookId] });
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
        system_config:       system.system_config       || 'bespoke',
        compact_unit_id:     system.compact_unit_id     || null,
        design_book_id:      bookId,
        ...buildFlowLoopFields(draft, n),
      });
      toast.success(`Loop ${n} removed`);
      clearFlowDraft();
      refresh();
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
  const canEdit = user?.role === 'admin' || user?.role === 'engineer';
  const readOnly = !canEdit || (!!book && !['Draft', 'In Progress'].includes(book.status));

  const systemFlow = parseFloat(system.design_flow_m3h) || 0;
  const systemCalculation = book?.engineering_calculations?.systems?.find(
    (calculation: any) => calculation.inputs?.system_id === system.id,
  ) ?? null;
  const exhibitCalculations: any[] = book?.engineering_calculations?.exhibits || [];

  // Values come exclusively from the API calculation contract.
  const exhibitFlowMap = new Map<string, number | null>();
  (links as any[]).forEach((l: any) => {
    const calculation = exhibitCalculations.find(
      (candidate: any) => candidate.inputs?.exhibit_id === l.exhibit_id,
    );
    exhibitFlowMap.set(l.exhibit_id, calculation?.results?.total_return_flow_m3h ?? null);
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
          <LockKeyhole className="w-4 h-4 shrink-0" />
          Released revision — LSS configuration and Flow Route data are read-only.
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
              {[
                ['system-configuration', 'System Configuration'],
                ['linked-exhibits', 'Linked Exhibits'],
                ['flow-route', 'Flow Route'],
              ].map(([target, label]) => (
                <a
                  key={target}
                  href={`#${target}`}
                  onClick={() => setShowToolsMenu(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
                  role="menuitem"
                >
                  {label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <fieldset disabled={readOnly} className={`contents ${readOnly ? 'opacity-90' : ''}`}>
      {/* System Configuration selector */}
      {(() => {
        const cfg = system.system_config || 'bespoke';
        const selectedUnit = (compactUnits as any[]).find(u => u.id === system.compact_unit_id);
        const localUnitId = pendingUnitId || system.compact_unit_id || '';

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
                      if (opt.key !== cfg) saveSystemConfig(opt.key, opt.key === 'compact' ? localUnitId : undefined);
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
                        {(compactUnits as any[]).map((u: any) => (
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
                          { label: 'Filtration', value: selectedUnit.includes_filtration },
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

                  {!selectedUnit && (compactUnits as any[]).length === 0 && (
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
                  onChange={e => setEF('design_flow_m3h', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Turnover Rate (×/h)</label>
                <input type="number" step="0.1" min="0" value={editForm.turnover_rate_hr}
                  onChange={e => setEF('turnover_rate_hr', e.target.value)} className={inputCls} />
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
                  <h1 className="text-xl font-bold text-stone-900 mt-1">{system.system_name}</h1>
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
            <div className="grid grid-cols-3 gap-3 mt-5">
              {[
                {
                  label: 'Design Flow',
                  value: system.design_flow_m3h != null ? `${parseFloat(system.design_flow_m3h).toFixed(1)} m³/h` : '—',
                  icon: <Gauge className="w-4 h-4 text-cyan-600" />,
                  bg: 'bg-cyan-50',
                },
                {
                  label: 'Turnover Rate',
                  value: system.turnover_rate_hr != null ? `${parseFloat(system.turnover_rate_hr).toFixed(1)} ×/h` : '—',
                  icon: <Droplets className="w-4 h-4 text-blue-500" />,
                  bg: 'bg-blue-50',
                },
                {
                  label: 'Linked Exhibits',
                  value: (links as any[]).length,
                  icon: <GitBranch className="w-4 h-4 text-violet-500" />,
                  bg: 'bg-violet-50',
                },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-3 bg-stone-50/60 border border-stone-100 rounded-xl px-4 py-3">
                  <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>{c.icon}</div>
                  <div>
                    <div className="text-xs text-stone-500">{c.label}</div>
                    <div className="font-semibold text-stone-800 text-sm">{c.value}</div>
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
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Notes</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(links as any[]).map((link: any) => (
                  <tr key={link.id} className="border-t border-stone-100 hover:bg-blue-50/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{link.exhibit_code}</span>
                        <span className="font-medium text-stone-800">{link.exhibit_name}</span>
                      </div>
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
                    <td className="px-4 py-3 text-stone-500 max-w-xs">
                      {link.notes
                        ? <span className="text-xs leading-snug">{link.notes}</span>
                        : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditLink(link)}
                          className="text-stone-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
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
                {systemFlow > 0 && (
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

      {/* Flow Route panel */}
      {(() => {
        const isSaltwater = system.water_type === 'Marine' || system.water_type === 'Salt Water';
        const FLOW_SOURCES = ['Bottom Drain', 'Surface Skim', 'Both Integrated'] as const;
        const FILTRATION_OPTS = [
          { label: 'Foam Fractionation',     value: 'Foam Fractionation',     saltwaterOnly: true  },
          { label: 'Pressurized Bag Filter', value: 'Pressurized Bag Filter', saltwaterOnly: false },
          { label: 'Sand Filter',            value: 'Sand Filter',            saltwaterOnly: false },
        ];
        const bioLinkLabel = isSaltwater ? 'Link FF to Bio/Degas' : 'Link SF Loop to Bio/Degas';
        // Hydraulics split % from the primary linked exhibit
        const primaryExLink = (links as any[]).find((l: any) => l.link_type === 'Primary') ?? (links as any[])[0];
        const primaryCalculation = primaryExLink
          ? exhibitCalculations.find((calculation: any) =>
              calculation.inputs?.exhibit_id === primaryExLink.exhibit_id)
          : null;
        // System flow is selected by the API contract, including any override.
        const systemFlow = (() => {
          const saved = systemCalculation?.results?.design_flow_m3h ?? 0;
          if (saved > 0) return saved;
          const configured = Number(system.design_flow_m3h);
          if (Number.isFinite(configured) && configured > 0) return configured;
          if (primaryCalculation?.results?.total_return_flow_m3h > 0) {
            return primaryCalculation.results.total_return_flow_m3h;
          }
          return totalCalculatedFlow;
        })();

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

        const LOOP_COLORS: Record<number, { badge: string; border: string; label: string }> = {
          1: { badge: 'bg-violet-100 text-violet-700', border: 'border-violet-200', label: 'text-violet-800' },
          2: { badge: 'bg-blue-100 text-blue-700',     border: 'border-blue-200',   label: 'text-blue-800'   },
          3: { badge: 'bg-indigo-100 text-indigo-700', border: 'border-indigo-200', label: 'text-indigo-800' },
        };

        const loopHasData = (n: number) =>
          !!(system[`loop${n}_flow_source`] || system[`loop${n}_filtration`] ||
             system[`loop${n}_flow_pct`] != null || system[`loop${n}_bio_degas_pct`] != null ||
             system[`loop${n}_bio_degas_m3h`] != null || system[`loop${n}_link_bio_degas`]);

        const activeLoops: number[] = [1, 2, 3].filter(loopHasData);
        const nextLoopToAdd: number | undefined = [1, 2, 3].find(n =>
          !loopHasData(n) && (n === 1 || loopHasData(n - 1)));
        const canAddNext = nextLoopToAdd != null && nextLoopToAdd <= 3;
        const flowForPercentage = (percentage: unknown): number | null => {
          const pct = nullableNumber(percentage);
          return pct != null && systemFlow > 0 ? systemFlow * pct / 100 : null;
        };
        const allocationSource = flowForm || system;
        const allocationLoops = [1, 2, 3].filter(n =>
          !!(allocationSource[`loop${n}_flow_source`] ||
            allocationSource[`loop${n}_filtration`] ||
            allocationSource[`loop${n}_flow_pct`] != null ||
            allocationSource[`loop${n}_bio_degas_pct`] != null ||
            allocationSource[`loop${n}_bio_degas_m3h`] != null ||
            allocationSource[`loop${n}_link_bio_degas`]));
        const allocationTotal = [1, 2, 3].reduce(
          (sum, n) => sum + (nullableNumber(allocationSource[`loop${n}_flow_pct`]) ?? 0),
          0,
        );
        const allocationPending = allocationLoops.filter(
          n => nullableNumber(allocationSource[`loop${n}_flow_pct`]) == null,
        ).length;
        const branchAllocationPending = allocationLoops.filter(
          n => !!allocationSource[`loop${n}_link_bio_degas`] &&
            nullableNumber(allocationSource[`loop${n}_bio_degas_pct`]) == null,
        ).length;
        const unallocatedPct = Math.max(0, 100 - allocationTotal);
        const allocationValidation = flowAllocationError(allocationSource);

        // ── Read-only loop card ────────────────────────────────────────────
        const LoopView = ({ n }: { n: number }) => {
          const src    = system[`loop${n}_flow_source`];
          const filt   = system[`loop${n}_filtration`];
          const bio    = system[`loop${n}_bio_degas_m3h`];
          const loopPct = nullableNumber(system[`loop${n}_flow_pct`]);
          const bioPct = nullableNumber(system[`loop${n}_bio_degas_pct`]);
          const linked = !!system[`loop${n}_link_bio_degas`];
          const loopFlow = flowForPercentage(loopPct);
          const bioFlow = loopFlow != null && bioPct != null
            ? loopFlow * bioPct / 100
            : nullableNumber(bio);
          if (!src && !filt && loopPct == null && bio == null && bioPct == null && !linked)
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
              {filt && (
                <div className="flex items-center gap-2 text-sm">
                  <FlaskConical className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <span className="text-stone-500 text-xs">Filtration:</span>
                  <span className="font-medium text-stone-800">{filt}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <Gauge className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                <span className="text-stone-500 text-xs">Loop flow:</span>
                <span className="font-mono font-semibold text-xs text-stone-800">
                  {fmtFlow(loopFlow ?? 0)}
                </span>
                <span className="text-stone-400 text-xs">
                  · {allocationStatus(loopPct, 'system')}
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
            </div>
          );
        };

        // ── Loop editor panel (card edit mode) ────────────────────────────
        const LoopEditor = ({ n }: { n: number }) => {
          if (!flowForm) return null;
          const srcKey  = `loop${n}_flow_source`;
          const filtKey = `loop${n}_filtration`;
          const pctKey  = `loop${n}_flow_pct`;
          const bioPctKey = `loop${n}_bio_degas_pct`;
          const lnkKey  = `loop${n}_link_bio_degas`;
          const linked: boolean = !!flowForm[lnkKey];
          const curSrc  = flowForm[srcKey]  as string;
          const curFilt = flowForm[filtKey] as string;
          const loopPct = nullableNumber(flowForm[pctKey]);
          const bioPct = nullableNumber(flowForm[bioPctKey]);
          const loopFlow = flowForPercentage(loopPct);
          const bioFlow = loopFlow != null && bioPct != null ? loopFlow * bioPct / 100 : null;
          return (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Flow Source</label>
                <div className="flex rounded-lg border border-stone-200 overflow-hidden text-xs font-medium">
                  {FLOW_SOURCES.map(s => (
                    <button key={s} type="button" onClick={() => setFF(srcKey, curSrc === s ? '' : s)}
                      className={`flex-1 px-2 py-1.5 transition-colors text-center leading-tight ${curSrc === s ? 'bg-cyan-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
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
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">
                  Loop Flow Allocation (% of total system flow)
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
                {loopPct == null && (
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
            </div>
          );
        };

        return (
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
                              <span className="text-sm font-semibold text-stone-700">Loop {n}</span>
                            </div>
                            {n > 1 && (
                              <button type="button" onClick={() => {
                                setFF(`loop${n}_flow_source`, '');
                                setFF(`loop${n}_filtration`, '');
                                setFF(`loop${n}_flow_pct`, '');
                                setFF(`loop${n}_bio_degas_pct`, '');
                                setFF(`loop${n}_bio_degas_m3h`, '');
                                setFF(`loop${n}_link_bio_degas`, false);
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
                                <span className={`text-sm font-semibold ${colors.label}`}>Loop {n}</span>
                                {pending && <span className="text-[10px] text-stone-400 italic">unsaved</span>}
                              </div>
                              {LoopView({ n })}
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
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50/60">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500 w-12">#</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-stone-500">Flow Source</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-stone-500">Filtration</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-stone-500">Loop Flow ({UNIT_LABELS[flowUnit]})</th>
                      <th className="text-left px-3 py-2.5 text-xs font-medium text-stone-500">Bio / Degas ({UNIT_LABELS[flowUnit]})</th>
                      <th className="px-3 py-2.5 w-24" />
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
                      const colors    = LOOP_COLORS[n] ?? LOOP_COLORS[1];
                      const isEditing = listEditRow === n;

                      if (isEditing && listRowForm) {
                        const linked: boolean = !!listRowForm.link_bio_degas;
                        const rowLoopFlow = flowForPercentage(listRowForm.flow_pct);
                        const rowBioPct = nullableNumber(listRowForm.bio_degas_pct);
                        const rowBioFlow = rowLoopFlow != null && rowBioPct != null
                          ? rowLoopFlow * rowBioPct / 100
                          : null;
                        return (
                          <tr key={n} className="bg-blue-50/20">
                            <td className="px-4 py-2.5">
                              <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${colors.badge}`}>{n}</span>
                            </td>
                            <td className="px-3 py-2">
                              <select value={listRowForm.flow_source} onChange={e => setLRF('flow_source', e.target.value)}
                                className="w-full border border-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40 bg-white">
                                <option value="">— None —</option>
                                {FLOW_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2">
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
                            <td className="px-3 py-2">
                              <input type="number" step="0.1" min="0" max="100" placeholder="%"
                                aria-label={`Loop ${n} flow allocation percentage`}
                                value={listRowForm.flow_pct}
                                onChange={e => setLRF('flow_pct', e.target.value)}
                                className="w-20 border border-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40" />
                              <div className="text-[10px] text-stone-500 mt-1 font-mono">{fmtFlow(rowLoopFlow ?? 0)}</div>
                            </td>
                            <td className="px-3 py-2">
                              <label className="flex items-center gap-1 text-[10px] text-stone-500 mb-1">
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
                                  <div className="text-[10px] text-emerald-700 mt-1 font-mono">{fmtFlow(rowBioFlow ?? 0)}</div>
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1 justify-end">
                                <button onClick={() => saveListRow(n)} disabled={flowSaving}
                                  className="flex items-center gap-1 text-xs text-white bg-violet-600 hover:bg-violet-700 rounded px-2 py-1 disabled:opacity-50">
                                  <Save className="w-3 h-3" /> {flowSaving ? '…' : 'Save'}
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
                                  className="text-xs text-stone-400 hover:text-stone-600 border border-stone-200 rounded p-1">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      const src    = flowForm ? flowForm[`loop${n}_flow_source`] : system[`loop${n}_flow_source`];
                      const filt   = flowForm ? flowForm[`loop${n}_filtration`] : system[`loop${n}_filtration`];
                      const bio    = flowForm ? flowForm[`loop${n}_bio_degas_m3h`] : system[`loop${n}_bio_degas_m3h`];
                      const loopPct = nullableNumber(flowForm ? flowForm[`loop${n}_flow_pct`] : system[`loop${n}_flow_pct`]);
                      const bioPct = nullableNumber(flowForm ? flowForm[`loop${n}_bio_degas_pct`] : system[`loop${n}_bio_degas_pct`]);
                      const linked = flowForm ? !!flowForm[`loop${n}_link_bio_degas`] : !!system[`loop${n}_link_bio_degas`];
                      const loopFlow = flowForPercentage(loopPct);
                      const bioFlow = loopFlow != null && bioPct != null
                        ? loopFlow * bioPct / 100
                        : nullableNumber(bio);
                      return (
                        <tr key={n} className="hover:bg-stone-50/60 group">
                          <td className="px-4 py-3">
                            <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${colors.badge}`}>{n}</span>
                          </td>
                          <td className="px-3 py-3">
                            {src ? (
                              <span className="flex items-center gap-1.5 text-stone-700">
                                <Droplets className="w-3 h-3 text-cyan-500 shrink-0" /> {src}
                              </span>
                            ) : <span className="text-stone-300 text-xs italic">—</span>}
                          </td>
                          <td className="px-3 py-3">
                            {filt ? (
                              <span className="flex items-center gap-1.5 text-stone-700">
                                <FlaskConical className="w-3 h-3 text-violet-500 shrink-0" /> {filt}
                              </span>
                            ) : <span className="text-stone-300 text-xs italic">—</span>}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">
                            <span className="text-stone-800">{fmtFlow(loopFlow ?? 0)}</span>
                            <span className="block text-stone-400 font-sans text-[10px]">
                              {allocationStatus(loopPct, 'system')}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">
                            {linked ? (
                              <span className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-emerald-700 font-semibold">{fmtFlow(bioFlow ?? 0)}</span>
                                <span className="text-stone-400 font-sans text-[10px]">
                                  {allocationStatus(bioPct, 'loop')}
                                </span>
                                <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded font-sans">
                                  linked
                                </span>
                              </span>
                            ) : <span className="text-stone-200 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-3">
                            {!readOnly && (
                            <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => {
                                const draft = flowForm || createFlowDraft(system);
                                setListEditRow(n);
                                setFlowForm(draft);
                                setListRowOriginal(getFlowDraftRow(draft, n));
                                setListRowForm(getFlowDraftRow(draft, n));
                              }} className="text-xs text-stone-400 hover:text-blue-600 border border-stone-200 rounded px-2 py-1 flex items-center gap-1 bg-white">
                                <Pencil className="w-3 h-3" /> Edit
                              </button>
                              {n > 1 && (
                                <button onClick={() => deleteLoop(n)}
                                  className="text-xs text-stone-300 hover:text-red-500 border border-stone-200 rounded p-1 bg-white">
                                  <Trash2 className="w-3 h-3" />
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
        );
      })()}

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
      </fieldset>

    </div>
  );
}
