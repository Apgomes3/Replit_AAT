import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../lib/api';
import StatusBadge from '../../components/ui/StatusBadge';
import {
  ChevronRight, Activity, Pencil, Save, X, Plus, Trash2,
  Waves, Gauge, GitBranch, Settings2, AlertCircle, Check,
  Droplets, ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';

const SYSTEM_TYPES = [
  'Life Support', 'Filtration', 'Circulation', 'UV Sterilization',
  'Ozone', 'Heating', 'Chilling', 'Skimming', 'Carbon Dosing',
  'Denitrification', 'Other',
];
const WATER_TYPES = ['Marine', 'Freshwater', 'Brackish', 'Salt Water', 'Blackwater'];
const STATUSES   = ['Draft', 'Design', 'For Review', 'Approved', 'Active', 'Released', 'Decommissioned'];
const LINK_TYPES = ['Primary', 'Secondary', 'Emergency', 'Backup', 'Observation', 'Redundant'];

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
    Backup:      'bg-amber-50 text-amber-700 border-amber-200',
    Observation: 'bg-violet-50 text-violet-700 border-violet-200',
    Redundant:   'bg-stone-50 text-stone-600 border-stone-200',
  };
  const cls = styles[type] ?? 'bg-stone-50 text-stone-600 border-stone-200';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{type}</span>;
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
    notes:               link.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${systemId}/exhibit-links/${link.id}`, {
        link_type:           form.link_type,
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
  const qc = useQueryClient();

  const { data: system, isLoading: sysLoading } = useQuery({
    queryKey: ['system', systemId],
    queryFn: () => api.get(`/systems/${systemId}`).then(r => r.data),
  });
  const { data: book } = useQuery({
    queryKey: ['design-book', bookId],
    queryFn: () => api.get(`/design-books/${bookId}`).then(r => r.data),
  });
  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ['system-exhibit-links', systemId],
    queryFn: () => api.get(`/systems/${systemId}/exhibit-links`).then(r => r.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['system', systemId] });
    qc.invalidateQueries({ queryKey: ['system-exhibit-links', systemId] });
    qc.invalidateQueries({ queryKey: ['design-book', bookId] });
  };

  // Stable key that only changes when the set of linked exhibit IDs changes
  const linksSignature = useMemo(
    () => (links as any[]).map((l: any) => l.exhibit_id).sort().join(','),
    [links],
  );

  // Ref so the effect can read latest system without being in its deps
  const systemRef = useRef<any>(null);
  if (system) systemRef.current = system;

  // Auto-sync design_flow + turnover_rate whenever linked exhibits change
  useEffect(() => {
    if (!linksSignature || !book) return;
    const currentLinks = links as any[];
    if (currentLinks.length === 0) return;

    let totalFlow = 0;
    let totalVol  = 0;
    for (const l of currentLinks) {
      const hydr    = (book.hydraulics || []).find((h: any) => h.exhibit_id === l.exhibit_id);
      const exTanks = (book.tanks      || []).filter((t: any) => t.exhibit_id === l.exhibit_id);
      const opVol   = exTanks.reduce((s: number, t: any) =>
        s + (parseFloat(t.operating_volume_m3 ?? t.design_volume_m3) || 0), 0);
      const rate    = parseFloat(hydr?.target_turnover_rate) || 0;
      if (opVol > 0 && rate > 0) {
        totalFlow += opVol * rate;
        totalVol  += opVol;
      }
    }
    if (totalFlow <= 0 || totalVol <= 0) return;

    const newTurnoverHr   = totalVol / totalFlow;
    const sys             = systemRef.current;
    if (!sys) return;
    const currentFlow     = parseFloat(sys?.design_flow_m3h)  || 0;
    const currentTurnover = parseFloat(sys?.turnover_rate_hr) || 0;

    if (Math.abs(totalFlow - currentFlow) < 0.005 && Math.abs(newTurnoverHr - currentTurnover) < 0.0005) return;

    api.put(`/systems/${systemId}`, {
      system_code:         sys.system_code,
      system_name:         sys.system_name,
      system_type:         sys.system_type         || null,
      water_type:          sys.water_type          || null,
      status:              sys.status,
      duty_description:    sys.duty_description    || null,
      redundancy_strategy: sys.redundancy_strategy || null,
      design_flow_m3h:  totalFlow,
      turnover_rate_hr: newTurnoverHr,
    }).then(() => {
      qc.invalidateQueries({ queryKey: ['system', systemId] });
      qc.invalidateQueries({ queryKey: ['design-book', bookId] });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linksSignature, book]);

  // System edit state
  const [editMode, setEditMode]   = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm]   = useState<any>(null);

  // Exhibit link modals
  const [showAddExhibit, setShowAddExhibit] = useState(false);
  const [editLink, setEditLink]   = useState<any>(null);
  const [deletingLink, setDeletingLink] = useState<string | null>(null);

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
          if (!turnoverVal) turnoverVal = (1 / targetRate).toFixed(2);
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
      await api.put(`/systems/${systemId}`, {
        system_code:         editForm.system_code,
        system_name:         editForm.system_name,
        system_type:         editForm.system_type   || null,
        water_type:          editForm.water_type    || null,
        design_flow_m3h:     editForm.design_flow_m3h    ? parseFloat(editForm.design_flow_m3h)   : null,
        turnover_rate_hr:    editForm.turnover_rate_hr   ? parseFloat(editForm.turnover_rate_hr)  : null,
        status:              editForm.status,
        duty_description:    editForm.duty_description   || null,
        redundancy_strategy: editForm.redundancy_strategy || null,
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

  const handleDeleteLink = async (linkId: string) => {
    if (!confirm('Remove this exhibit link?')) return;
    setDeletingLink(linkId);
    try {
      await api.delete(`/systems/${systemId}/exhibit-links/${linkId}`);
      toast.success('Link removed');
      refresh();
    } catch {
      toast.error('Failed to remove link');
    } finally {
      setDeletingLink(null);
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

  const systemFlow = parseFloat(system.design_flow_m3h) || 0;

  // Compute design flow for each linked exhibit from hydraulics + tank volumes
  const exhibitFlowMap = new Map<string, number | null>();
  (links as any[]).forEach((l: any) => {
    const hydr    = (book?.hydraulics || []).find((h: any) => h.exhibit_id === l.exhibit_id);
    const exTanks = (book?.tanks      || []).filter((t: any) => t.exhibit_id === l.exhibit_id);
    const opVol   = exTanks.reduce((s: number, t: any) =>
      s + (parseFloat(t.operating_volume_m3 ?? t.design_volume_m3) || 0), 0);
    const rate    = parseFloat(hydr?.target_turnover_rate) || 0;
    exhibitFlowMap.set(l.exhibit_id, opVol > 0 && rate > 0 ? opVol * rate : null);
  });
  const totalCalculatedFlow = [...exhibitFlowMap.values()]
    .reduce((s, f) => s + (f ?? 0), 0);

  const setEF = (k: string, v: string) => setEditForm((f: any) => ({ ...f, [k]: v }));
  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Modals */}
      {showAddExhibit && (
        <AddExhibitModal
          systemId={systemId!}
          availableExhibits={availableExhibits}
          onClose={() => setShowAddExhibit(false)}
          onAdded={() => { setShowAddExhibit(false); refresh(); }}
        />
      )}
      {editLink && (
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
                <label className="block text-xs font-medium text-stone-500 mb-1">Turnover Rate (h)</label>
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
                  value: system.turnover_rate_hr != null ? `${parseFloat(system.turnover_rate_hr).toFixed(1)} h` : '—',
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
              <div className="mt-4 px-4 py-3 bg-amber-50/60 border border-amber-200 rounded-xl text-sm text-stone-600">
                <span className="font-medium text-amber-800">Redundancy: </span>{system.redundancy_strategy}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Exhibit Links panel */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
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
                        return f != null
                          ? <span>{f.toFixed(1)}</span>
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
                          onClick={() => handleDeleteLink(link.id)}
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

      {/* Back link */}
      <div>
        <Link to={`/design-books/${bookId}?tab=lss`}
          className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-blue-600 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Life Support Systems
        </Link>
      </div>
    </div>
  );
}
