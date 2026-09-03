import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState, type ChangeEvent } from 'react';
import api from '../../lib/api';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import Button from '../../components/ui/Button';
import {
  BookMarked, FolderOpen, ChevronRight, Pencil, Save, X,
  Droplets, ThermometerSun, FlaskConical, Layers,
  ChevronDown, ChevronUp, Waves, AlertCircle,
  Fish, Plus, Trash2, Activity, Gauge, GitBranch,
  LinkIcon, SquarePlus, Check, CheckCircle2, RotateCcw, Calculator,
  ShieldCheck, AlertTriangle, LockKeyhole, GitFork, ExternalLink,
  Send, UserCheck, ClipboardList, CalendarDays, Users, LibraryBig
} from 'lucide-react';
import toast from 'react-hot-toast';
import SpeciesSection from './SpeciesAllocationSection';
import VersionsTab from './VersionsTab';
import { useAuthStore } from '../../store/authStore';
import ActivityLog from '../../components/ui/ActivityLog';
import ModalDialog from '../../components/ui/ModalDialog';
import FrictionLossTab from './FrictionLossTab';
import NewRevisionModal from './NewRevisionModal';

type Tab = 'exhibits' | 'lss' | 'thermal' | 'piping' | 'review' | 'versions';

export const DESIGN_BOOK_TAB_ORDER: Tab[] = ['exhibits', 'lss', 'thermal', 'piping', 'review', 'versions'];

export function isDesignBookTab(value: string | null): value is Tab {
  return value === 'exhibits' || value === 'lss' || value === 'thermal' || value === 'piping' || value === 'review' || value === 'versions';
}

function WaterTypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-stone-400 text-xs italic">—</span>;
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

function ShapeBadge({ shape }: { shape?: string }) {
  if (!shape) return <span className="text-stone-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    Rectangular: 'bg-slate-100 text-slate-600',
    Cylindrical: 'bg-violet-100 text-violet-700',
    Custom: 'bg-blue-100 text-blue-700',
  };
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[shape] ?? 'bg-stone-100 text-stone-600'}`}>{shape}</span>;
}

export function SystemConfigBadge({ config }: { config?: string }) {
  if (!config || config === 'bespoke') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-600 border border-stone-200">
        Bespoke
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
      LSS Compact Unit
    </span>
  );
}

function SystemTypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-stone-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    Filtration: 'bg-blue-50 text-blue-700 border-blue-200',
    Circulation: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    UV: 'bg-violet-50 text-violet-700 border-violet-200',
    Ozone: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    Heating: 'bg-red-50 text-red-700 border-red-200',
    Chilling: 'bg-sky-50 text-sky-700 border-sky-200',
    Skimming: 'bg-teal-50 text-teal-700 border-teal-200',
  };
  const cls = Object.entries(colors).find(([k]) => type.toLowerCase().includes(k.toLowerCase()))?.[1]
    ?? 'bg-stone-50 text-stone-600 border-stone-200';
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>{type}</span>;
}

function fmtDim(v?: number | null) {
  return v != null ? `${Number(v).toLocaleString()}` : '—';
}
function fmtVol(v?: number | null) {
  if (v == null) return <span className="text-stone-400">—</span>;
  return <span className="font-mono text-xs">{parseFloat(String(v)).toFixed(3)}</span>;
}
function fmtNum(v?: number | null, decimals = 1) {
  if (v == null || v === undefined) return <span className="text-stone-400">—</span>;
  return <span className="font-mono text-xs">{parseFloat(String(v)).toFixed(decimals)}</span>;
}

function ReleaseModal({ book, onClose, onReleased }: {
  book: any;
  onClose: () => void;
  onReleased: () => void;
}) {
  const [form, setForm] = useState({
    revision: book.revision || '',
    included_scope: Array.isArray(book.project_scopes) ? book.project_scopes : [],
    release_notes: '',
  });
  const [releasing, setReleasing] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['design-book-release-preflight', book.id],
    queryFn: () => api.get(`/design-books/${book.id}/release-preflight`).then(r => r.data),
  });
  const checklist: any[] = data?.checklist || [];
  const blockers: any[] = data?.blockers || [];
  const canRelease = form.revision.trim() === String(book.revision || '').trim() &&
    form.included_scope.length > 0 &&
    form.release_notes.trim().length > 0 &&
    blockers.length === 0;

  const toggleScope = (scope: string) => {
    setForm(current => ({
      ...current,
      included_scope: current.included_scope.includes(scope)
        ? current.included_scope.filter(item => item !== scope)
        : [...current.included_scope, scope],
    }));
  };

  const handleRelease = async () => {
    if (!canRelease) return;
    setReleasing(true);
    try {
      await api.post(`/design-books/${book.id}/release`, form);
      toast.success(`Design Book Rev ${book.revision} released`);
      onReleased();
    } catch (err: any) {
      const message = err?.response?.data?.error?.message || 'Release failed';
      toast.error(message);
      if (err?.response?.status === 422) refetch();
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h2 className="font-semibold text-stone-900">Release Design Book</h2>
              <p className="text-xs text-stone-500">Run engineering checks and freeze this revision as an accountable record.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Pre-release checklist</h3>
              {!isLoading && (
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  blockers.length ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {blockers.length ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}` : 'Ready to release'}
                </span>
              )}
            </div>
            <div className="border border-stone-200 rounded-xl divide-y divide-stone-100 overflow-hidden">
              {isLoading ? (
                <div className="p-6 text-sm text-stone-400 text-center">Running engineering checks…</div>
              ) : checklist.map(check => {
                const passed = check.status === 'pass';
                const blocked = check.status === 'blocked';
                return (
                  <div key={check.key} className="px-4 py-3 flex items-start gap-3">
                    {passed
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${blocked ? 'text-red-600' : 'text-amber-500'}`} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-800">{check.label}</span>
                        {!passed && (
                          <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                            blocked ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}>{check.severity}</span>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 mt-0.5">{check.message}</p>
                    </div>
                    {!passed && check.href && (
                      <Link to={check.href} onClick={onClose} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 shrink-0">
                        Fix <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Confirm revision</label>
              <input
                value={form.revision}
                onChange={e => setForm(current => ({ ...current, revision: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              {form.revision.trim() !== String(book.revision || '').trim() && (
                <p className="text-xs text-red-600 mt-1">Enter the current revision: {book.revision}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Included scope</label>
              <div className="flex flex-wrap gap-1.5 min-h-10 border border-stone-200 rounded-lg p-2">
                {(book.project_scopes || []).map((scope: string) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => toggleScope(scope)}
                    className={`text-xs px-2 py-1 rounded-md border ${
                      form.included_scope.includes(scope)
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-stone-200 text-stone-500'
                    }`}
                  >
                    {form.included_scope.includes(scope) && <Check className="w-3 h-3 inline mr-1" />}
                    {scope}
                  </button>
                ))}
                {(book.project_scopes || []).length === 0 && <span className="text-xs text-red-600">No project scope defined</span>}
              </div>
            </div>
          </section>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Release notes</label>
            <textarea
              rows={3}
              value={form.release_notes}
              onChange={e => setForm(current => ({ ...current, release_notes: e.target.value }))}
              placeholder="Record what is included, key decisions, and the purpose of this release…"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
            />
          </div>

        </div>

        <div className="px-6 py-4 border-t border-stone-200 bg-stone-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">Cancel</button>
          <button
            onClick={handleRelease}
            disabled={!canRelease || releasing || isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40"
          >
            <LockKeyhole className="w-4 h-4" />
            {releasing ? 'Releasing…' : `Release Rev ${book.revision}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function HandoverReportModal({ bookId, onClose, onSaved }: {
  bookId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    meeting_date: new Date().toISOString().slice(0, 10),
    title: 'Design–Engineering Review Handover',
    attendees: '',
    purpose: '',
    discussion_summary: '',
    decisions: '',
    action_items: '',
    open_items: '',
    acceptance_notes: '',
  });
  const set = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  const save = async () => {
    if (!form.meeting_date || !form.title.trim()) return toast.error('Meeting date and title are required');
    setSaving(true);
    try {
      await api.post(`/design-books/${bookId}/review-handovers`, form);
      toast.success('Handover report saved');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save handover report');
    } finally {
      setSaving(false);
    }
  };
  const textarea = (key: keyof typeof form, label: string, placeholder: string) => (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-1">{label}</label>
      <textarea
        rows={2}
        value={form[key]}
        onChange={event => set(key, event.target.value)}
        placeholder={placeholder}
        className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-violet-500/30"
      />
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-5 h-5 text-violet-600" />
            <div>
              <h2 className="font-semibold text-stone-900">Review Handover Report</h2>
              <p className="text-xs text-stone-500">Optional meeting record between design and engineering.</p>
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-stone-400" /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Meeting date *</label>
              <input type="date" value={form.meeting_date} onChange={event => set('meeting_date', event.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Report title *</label>
              <input value={form.title} onChange={event => set('title', event.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Attendees</label>
            <input value={form.attendees} onChange={event => set('attendees', event.target.value)}
              placeholder="Names separated by commas"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          {textarea('purpose', 'Meeting purpose', 'What was this handover intended to confirm?')}
          {textarea('discussion_summary', 'Discussion summary', 'Key design and engineering topics reviewed…')}
          {textarea('decisions', 'Decisions', 'Agreed decisions and approvals…')}
          {textarea('action_items', 'Action items', 'Owner, action, and due date for each follow-up…')}
          {textarea('open_items', 'Open items / risks', 'Anything unresolved at the end of the meeting…')}
          {textarea('acceptance_notes', 'Handover acceptance notes', 'Scope accepted and any conditions…')}
        </div>
        <div className="px-6 py-4 border-t border-stone-200 bg-stone-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Report'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewWorkflowTab({ book, canRecordHandover, onRefresh }: {
  book: any;
  canRecordHandover: boolean;
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const [showReport, setShowReport] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['design-book-review-handovers', book.id],
    queryFn: () => api.get(`/design-books/${book.id}/review-handovers`).then(response => response.data),
  });
  const handovers: any[] = data?.items || [];
  const steps = ['Draft', 'For Review', 'Approved', 'Released'];
  const currentIndex = book.status === 'In Progress' ? 0 : Math.max(0, steps.indexOf(book.status));
  return (
    <div className="space-y-5">
      {showReport && (
        <HandoverReportModal
          bookId={book.id}
          onClose={() => setShowReport(false)}
          onSaved={() => {
            setShowReport(false);
            qc.invalidateQueries({ queryKey: ['design-book-review-handovers', book.id] });
            qc.invalidateQueries({ queryKey: ['audit', 'design_book', book.id] });
            onRefresh();
          }}
        />
      )}
      <div className="bg-white rounded-xl border border-stone-200 p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-stone-800">Review and release workflow</h2>
            <p className="text-xs text-stone-500 mt-0.5">Design submits; management approves and releases.</p>
          </div>
          {canRecordHandover && book.status !== 'Released' && (
            <button onClick={() => setShowReport(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-violet-200 text-violet-700 rounded-lg hover:bg-violet-50 font-medium">
              <ClipboardList className="w-4 h-4" /> New Handover Report
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {steps.map((step, index) => (
            <div key={step} className="relative">
              <div className={`h-1 rounded-full mb-3 ${index <= currentIndex ? 'bg-violet-500' : 'bg-stone-200'}`} />
              <div className={`text-xs font-semibold ${index <= currentIndex ? 'text-violet-700' : 'text-stone-400'}`}>{step}</div>
            </div>
          ))}
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-5 text-xs">
          <div className="rounded-lg bg-stone-50 p-3">
            <span className="text-stone-400">Submitted</span>
            <p className="font-medium text-stone-700 mt-1">{book.review_submitted_at ? new Date(book.review_submitted_at).toLocaleString() : 'Not yet'}</p>
            {book.review_submitted_by_name && <p className="text-stone-500">{book.review_submitted_by_name}</p>}
          </div>
          <div className="rounded-lg bg-stone-50 p-3">
            <span className="text-stone-400">Approved</span>
            <p className="font-medium text-stone-700 mt-1">{book.approved_at ? new Date(book.approved_at).toLocaleString() : 'Not yet'}</p>
            {book.approved_by_name && <p className="text-stone-500">{book.approved_by_name}</p>}
          </div>
          <div className="rounded-lg bg-stone-50 p-3">
            <span className="text-stone-400">Released</span>
            <p className="font-medium text-stone-700 mt-1">{book.released_at ? new Date(book.released_at).toLocaleString() : 'Not yet'}</p>
            {book.released_by_name && <p className="text-stone-500">{book.released_by_name}</p>}
          </div>
        </div>
        {book.approval_notes && <div className="mt-4 text-sm text-stone-600 border-l-2 border-violet-300 pl-3">{book.approval_notes}</div>}
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-stone-700">Handover reports</h3>
          <span className="ml-auto text-xs text-stone-400">{handovers.length}</span>
        </div>
        {isLoading ? <div className="p-6 text-center text-sm text-stone-400">Loading reports…</div> :
          handovers.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-400">No handover meeting report was required for this review.</div>
          ) : (
            <div className="divide-y divide-stone-100">
              {handovers.map(report => (
                <details key={report.id} className="group px-5 py-4">
                  <summary className="cursor-pointer list-none flex items-center gap-3">
                    <CalendarDays className="w-4 h-4 text-violet-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-stone-800">{report.title}</p>
                      <p className="text-xs text-stone-400">{new Date(report.meeting_date).toLocaleDateString()} · {report.created_by_name || 'Unknown'}</p>
                    </div>
                    <Users className="w-4 h-4 text-stone-300" />
                    <span className="text-xs text-stone-500">{report.attendees?.length || 0}</span>
                  </summary>
                  <div className="mt-4 ml-7 grid sm:grid-cols-2 gap-4 text-sm">
                    {[
                      ['Attendees', report.attendees?.join(', ')],
                      ['Purpose', report.purpose],
                      ['Discussion', report.discussion_summary],
                      ['Decisions', report.decisions],
                      ['Action items', report.action_items],
                      ['Open items / risks', report.open_items],
                      ['Acceptance notes', report.acceptance_notes],
                    ].filter(([, value]) => value).map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{label}</p>
                        <p className="text-stone-700 whitespace-pre-wrap mt-1">{value}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
      </div>
      <ActivityLog entityType="design_book" entityId={book.id} />
    </div>
  );
}

// ─── Species Section inside each Exhibit ────────────────────────────────────
const BLANK_SPECIES = { species_name: '', common_name: '', quantity: '', avg_size_cm: '', biomass_kg: '' };

function LegacySpeciesSection({ bookId, exhibitId, allSpecies, onRefresh }: {
  bookId: string;
  exhibitId: string;
  allSpecies: any[];
  onRefresh: () => void;
}) {
  const mySpecies = allSpecies.filter(s => s.exhibit_id === exhibitId);
  const [showRow, setShowRow] = useState(false);
  const [row, setRow] = useState({ ...BLANK_SPECIES });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const setR = (k: string, v: string) => setRow(r => ({ ...r, [k]: v }));

  const handleAdd = async () => {
    if (!row.species_name.trim()) return toast.error('Scientific name required');
    setSaving(true);
    try {
      await api.post(`/design-books/${bookId}/species`, {
        exhibit_id: exhibitId,
        species_name: row.species_name.trim(),
        common_name: row.common_name || null,
        quantity: row.quantity ? parseInt(row.quantity) : null,
        avg_size_cm: row.avg_size_cm ? parseFloat(row.avg_size_cm) : null,
        biomass_kg: row.biomass_kg ? parseFloat(row.biomass_kg) : null,
      });
      toast.success('Species added');
      setRow({ ...BLANK_SPECIES });
      onRefresh();
    } catch {
      toast.error('Failed to add species');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
    if (e.key === 'Escape') { setShowRow(false); setRow({ ...BLANK_SPECIES }); }
  };

  const handleDelete = async (speciesId: string) => {
    if (!confirm('Remove this species entry?')) return;
    setDeletingId(speciesId);
    try {
      await api.delete(`/design-books/${bookId}/species/${speciesId}`);
      onRefresh();
    } catch {
      toast.error('Failed to remove');
    } finally {
      setDeletingId(null);
    }
  };

  const inCell = (k: string, type = 'text', placeholder = '') => (
    <input
      type={type}
      step={type === 'number' ? '0.1' : undefined}
      placeholder={placeholder}
      value={(row as any)[k]}
      onChange={e => setR(k, e.target.value)}
      onKeyDown={handleKeyDown}
      className="w-full bg-transparent border-b border-emerald-400 focus:outline-none text-xs py-0.5 placeholder-stone-300 text-stone-800"
    />
  );

  return (
    <div className="border-t border-stone-100 bg-emerald-50/20">
      {/* Section header */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2">
          <Fish className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Species Allocation</span>
          {mySpecies.length > 0 && (
            <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">{mySpecies.length}</span>
          )}
        </div>
        {!showRow && (
          <button
            onClick={() => setShowRow(true)}
            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 border border-emerald-200 bg-white rounded-md px-2 py-1 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Species
          </button>
        )}
      </div>

      {/* Species table — always shown when there are rows OR when add-row is open */}
      {(mySpecies.length > 0 || showRow) ? (
        <div className="overflow-x-auto pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-t border-stone-100">
                <th className="text-left px-5 py-1.5 text-stone-400 font-medium">Scientific Name</th>
                <th className="text-left px-4 py-1.5 text-stone-400 font-medium">Common Name</th>
                <th className="text-right px-4 py-1.5 text-stone-400 font-medium">Qty</th>
                <th className="text-right px-4 py-1.5 text-stone-400 font-medium">Avg Size (cm)</th>
                <th className="text-right px-4 py-1.5 text-stone-400 font-medium">Biomass (kg)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {mySpecies.map(sp => (
                <tr key={sp.id} className="border-t border-emerald-100/60 hover:bg-emerald-50/40 transition-colors group">
                  <td className="px-5 py-2 italic text-stone-700">{sp.species_name}</td>
                  <td className="px-4 py-2 text-stone-600">{sp.common_name || <span className="text-stone-300">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-stone-700">{sp.quantity ?? <span className="text-stone-300">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-stone-600">{sp.avg_size_cm != null ? parseFloat(sp.avg_size_cm).toFixed(1) : <span className="text-stone-300">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-stone-600">{sp.biomass_kg != null ? parseFloat(sp.biomass_kg).toFixed(2) : <span className="text-stone-300">—</span>}</td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => handleDelete(sp.id)}
                      disabled={deletingId === sp.id}
                      className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 transition-all p-0.5 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Inline add row */}
              {showRow && (
                <tr className="border-t-2 border-emerald-300 bg-emerald-50/60">
                  <td className="px-5 py-2 italic">{inCell('species_name', 'text', 'e.g. Acanthurus leucosternon')}</td>
                  <td className="px-4 py-2">{inCell('common_name', 'text', 'Common name')}</td>
                  <td className="px-4 py-2 text-right">{inCell('quantity', 'number', '0')}</td>
                  <td className="px-4 py-2 text-right">{inCell('avg_size_cm', 'number', '0.0')}</td>
                  <td className="px-4 py-2 text-right">{inCell('biomass_kg', 'number', '0.00')}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={handleAdd}
                        disabled={saving}
                        title="Save (Enter)"
                        className="text-emerald-600 hover:text-emerald-800 p-0.5 rounded disabled:opacity-40"
                      >
                        {saving ? <span className="text-xs">…</span> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => { setShowRow(false); setRow({ ...BLANK_SPECIES }); }}
                        title="Cancel (Esc)"
                        className="text-stone-300 hover:text-stone-500 p-0.5 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Biomass total */}
              {mySpecies.some(s => s.biomass_kg != null) && (
                <tr className="border-t border-emerald-200 bg-emerald-50/40">
                  <td colSpan={4} className="px-5 py-1.5 text-xs font-semibold text-emerald-700">Total Biomass</td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold text-emerald-800">
                    {mySpecies.reduce((s, sp) => s + (parseFloat(sp.biomass_kg) || 0), 0).toFixed(2)} kg
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {showRow && (
            <p className="px-5 pt-1 text-xs text-stone-400">Press <kbd className="font-mono bg-stone-100 px-1 rounded">Enter</kbd> to save · <kbd className="font-mono bg-stone-100 px-1 rounded">Esc</kbd> to cancel</p>
          )}
        </div>
      ) : (
        <div className="px-5 pb-4 text-xs text-stone-400 italic">No species allocated — click Add Species to begin.</div>
      )}
    </div>
  );
}

// ─── LSS Tab + New LSS Modal ─────────────────────────────────────────────────
const SYSTEM_TYPES_LIST = [
  'Life Support', 'Filtration', 'Circulation', 'UV Sterilization',
  'Ozone', 'Heating', 'Chilling', 'Skimming', 'Carbon Dosing', 'Denitrification', 'Other',
];

const LSS_STATUSES = ['Draft', 'Design', 'For Review', 'Approved', 'Active', 'Released'];

function NewLSSModal({ projectId, bookId, exhibits, hydraulics, tanks, calculations, onClose, onCreated }: {
  projectId: string;
  bookId: string;
  exhibits: any[];
  hydraulics: any[];
  tanks: any[];
  calculations: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    system_code: '', system_name: '', system_type: 'Life Support',
    water_type: 'Marine', status: 'Draft', exhibit_id: '',
    design_flow_m3h: '', turnover_rate_hr: '',
    duty_description: '', redundancy_strategy: '',
  });
  const [saving, setSaving] = useState(false);
  const [computedFlow, setComputedFlow] = useState<number | null>(null);
  const [computedTurnover, setComputedTurnover] = useState<number | null>(null);
  const [sourceRate, setSourceRate] = useState<number | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleExhibitChange = (exhibitId: string) => {
    set('exhibit_id', exhibitId);
    if (!exhibitId) {
      setComputedFlow(null);
      setComputedTurnover(null);
      setSourceRate(null);
      return;
    }
    const calculation = calculations.find((item: any) => item.inputs?.exhibit_id === exhibitId);
    const calculatedFlow = parseFloat(calculation?.results?.total_return_flow_m3h) || 0;
    const calculatedTurnover = parseFloat(calculation?.inputs?.target_turnover_rate_cycles_per_hour) || 0;
    if (calculatedFlow > 0 && calculatedTurnover > 0) {
      const flow = calculatedFlow;
      const turnoverHr = calculatedTurnover;
      setComputedFlow(flow);
      setComputedTurnover(turnoverHr);
      setSourceRate(calculatedTurnover);
      setForm(f => ({
        ...f,
        exhibit_id: exhibitId,
        design_flow_m3h: flow.toFixed(2),
        turnover_rate_hr: turnoverHr.toFixed(2),
      }));
    } else {
      setComputedFlow(null);
      setComputedTurnover(null);
      setSourceRate(null);
    }
  };

  const flowVal = parseFloat(form.design_flow_m3h);
  const turnoverVal = parseFloat(form.turnover_rate_hr);
  const isFlowOverridden = form.design_flow_m3h !== '' &&
    (computedFlow === null || Math.abs(flowVal - computedFlow) > 0.005);
  const isTurnoverOverridden = form.turnover_rate_hr !== '' &&
    (computedTurnover === null || Math.abs(turnoverVal - computedTurnover) > 0.005);

  const handleSave = async () => {
    if (!form.system_code.trim() || !form.system_name.trim()) {
      return toast.error('System code and name are required');
    }
    setSaving(true);
    try {
      const res = await api.post('/systems', {
        system_code:         form.system_code.trim().toUpperCase(),
        system_name:         form.system_name.trim(),
        system_type:         form.system_type         || null,
        water_type:          form.water_type          || null,
        status:              form.status              || 'Draft',
        project_id:          projectId,
        exhibit_id:          form.exhibit_id          || null,
        design_flow_m3h:     isFlowOverridden && form.design_flow_m3h ? parseFloat(form.design_flow_m3h) : null,
        turnover_rate_hr:    isTurnoverOverridden && form.turnover_rate_hr ? parseFloat(form.turnover_rate_hr) : null,
        design_flow_source:  isFlowOverridden ? 'manual_override' : 'linked_exhibits',
        turnover_source:     isTurnoverOverridden ? 'manual_override' : 'primary_exhibit',
        duty_description:    form.duty_description    || null,
        redundancy_strategy: form.redundancy_strategy || null,
      });
      toast.success('Life support system created');
      onCreated();
      navigate(`/design-books/${bookId}/lss/${res.data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 bg-white';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-stone-800">New Life Support System</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* System Code + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">System Code <span className="text-red-400">*</span></label>
              <input placeholder="e.g. SYS-LSS-01"
                value={form.system_code} onChange={e => set('system_code', e.target.value.toUpperCase())}
                className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Type</label>
              <select value={form.system_type} onChange={e => set('system_type', e.target.value)} className={inputCls}>
                {SYSTEM_TYPES_LIST.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* System Name */}
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">System Name <span className="text-red-400">*</span></label>
            <input placeholder="e.g. Shark Tank Primary Filtration System"
              value={form.system_name} onChange={e => set('system_name', e.target.value)}
              className={inputCls} />
          </div>

          {/* Water Type + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Water Type</label>
              <select value={form.water_type} onChange={e => set('water_type', e.target.value)} className={inputCls}>
                {['Marine', 'Freshwater', 'Brackish', 'Salt Water', 'Blackwater'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                {LSS_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Primary Exhibit */}
          {exhibits.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">
                Primary Exhibit <span className="text-stone-400 font-normal">optional — hydraulics auto-filled when set</span>
              </label>
              <select value={form.exhibit_id} onChange={e => handleExhibitChange(e.target.value)} className={inputCls}>
                <option value="">— Not linked —</option>
                {exhibits.map((ex: any) => (
                  <option key={ex.id} value={ex.id}>{ex.exhibit_code} — {ex.exhibit_name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Design Flow + Turnover Rate */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Hydraulics</p>
              {computedFlow !== null && !isFlowOverridden && !isTurnoverOverridden && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <Calculator className="w-3 h-3" /> Calculated from exhibit
                </span>
              )}
              {(isFlowOverridden || isTurnoverOverridden) && (
                <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                  Manually overridden
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Design Flow (m³/h)</label>
                <input type="number" step="0.01" min="0" placeholder="e.g. 500"
                  value={form.design_flow_m3h} onChange={e => set('design_flow_m3h', e.target.value)}
                  className={`${inputCls} ${isFlowOverridden ? 'border-blue-300 bg-blue-50/40' : ''}`} />
                {isFlowOverridden && computedFlow !== null && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-stone-400">Calculated: {computedFlow.toFixed(2)}</span>
                    <button type="button" onClick={() => set('design_flow_m3h', computedFlow.toFixed(2))}
                      className="flex items-center gap-0.5 text-xs text-blue-500 hover:text-blue-700">
                      <RotateCcw className="w-3 h-3" /> Reset
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">
                  Turnover Rate (×/h)
                  {sourceRate !== null && !isTurnoverOverridden && (
                    <span className="ml-1 text-stone-400 font-normal">← {sourceRate}×/h</span>
                  )}
                </label>
                <input type="number" step="0.01" min="0" placeholder="e.g. 0.5"
                  value={form.turnover_rate_hr} onChange={e => set('turnover_rate_hr', e.target.value)}
                  className={`${inputCls} ${isTurnoverOverridden ? 'border-blue-300 bg-blue-50/40' : ''}`} />
                {isTurnoverOverridden && computedTurnover !== null && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-stone-400">Calculated: {computedTurnover.toFixed(2)}</span>
                    <button type="button" onClick={() => set('turnover_rate_hr', computedTurnover.toFixed(2))}
                      className="flex items-center gap-0.5 text-xs text-blue-500 hover:text-blue-700">
                      <RotateCcw className="w-3 h-3" /> Reset
                    </button>
                  </div>
                )}
              </div>
            </div>
            {computedFlow === null && form.exhibit_id && (
              <p className="text-xs text-stone-400 mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> No hydraulics set on this exhibit yet — enter values manually.
              </p>
            )}
          </div>

          {/* Duty Description */}
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">
              Duty Description <span className="text-stone-400 font-normal">optional</span>
            </label>
            <textarea rows={3}
              placeholder="Describe the system's operating duty, design intent, load conditions, treatment objectives…"
              value={form.duty_description} onChange={e => set('duty_description', e.target.value)}
              className={`${inputCls} resize-none`} />
          </div>

          {/* Redundancy Strategy */}
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">
              Redundancy Strategy <span className="text-stone-400 font-normal">optional</span>
            </label>
            <input placeholder="e.g. N+1 standby pump, 100% duty/standby configuration"
              value={form.redundancy_strategy} onChange={e => set('redundancy_strategy', e.target.value)}
              className={inputCls} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-100 bg-stone-50/50 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-500 border border-stone-200 bg-white rounded-lg hover:bg-stone-50 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 font-medium transition-colors">
            <Check className="w-3.5 h-3.5" /> {saving ? 'Creating…' : 'Create & Open'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LSSTab({ book, onNewLSS, readOnly = false }: { book: any; onNewLSS: () => void; readOnly?: boolean }) {
  const navigate = useNavigate();
  const systems: any[] = book.systems || [];
  const [showHistorical, setShowHistorical] = useState(readOnly);
  const isHistorical = (system: any) =>
    ['Archived', 'Decommissioned', 'Superseded'].includes(system.status);
  const displayedSystems = showHistorical ? systems : systems.filter(system => !isHistorical(system));
  const calculations: any[] = book.engineering_calculations?.systems || [];
  const calculationFor = (systemId: string) =>
    calculations.find((item: any) => item.inputs?.system_id === systemId) ?? null;

  if (!book.project_id) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <FolderOpen className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No project linked</p>
        <p className="text-stone-400 text-sm mt-1">Link this design book to a project to import its Life Support Systems.</p>
      </div>
    );
  }

  if (displayedSystems.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <Activity className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">{systems.length ? 'No current systems' : 'No systems yet'}</p>
        <p className="text-stone-400 text-sm mt-1 mb-5">
          {systems.length ? 'Historical systems are hidden. Use Show historical to review them.' : 'Create a new Life Support System directly in this design book.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          {systems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistorical(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-stone-200 text-stone-700 text-sm font-medium rounded-lg hover:bg-stone-50"
            >
              Show historical
            </button>
          )}
          {!readOnly && (
            <button
              onClick={onNewLSS}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> New Life Support System
            </button>
          )}
          <Link
            to={`/projects/${book.project_id}`}
            className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-blue-600 border border-stone-200 bg-white px-3 py-2 rounded-lg transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" /> View Project
          </Link>
        </div>
      </div>
    );
  }

  // Aggregate stats
  const totalFlow = displayedSystems.reduce((sum, system) => {
    const calculation = calculationFor(system.id);
    return sum + (Number(calculation?.results?.design_flow_m3h) || 0);
  }, 0);
  const activeSystems = systems.filter(s => s.status === 'Active' || s.status === 'Released').length;

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: showHistorical ? 'Systems shown' : 'Current systems', value: displayedSystems.length, icon: <GitBranch className="w-4 h-4 text-blue-500" /> },
          { label: 'Total Design Flow', value: `${totalFlow.toFixed(1)} m³/h`, icon: <Gauge className="w-4 h-4 text-cyan-600" /> },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-stone-200 px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-stone-50 flex items-center justify-center">{c.icon}</div>
            <div>
              <div className="text-xs text-stone-500">{c.label}</div>
              <div className="font-semibold text-stone-800 text-sm">{c.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Systems table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-stone-700">Life Support Systems</span>
            <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-1.5 py-0.5">{displayedSystems.length}</span>
          </div>
          <div className="flex items-center gap-2">
            {systems.some(isHistorical) && (
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500">
                <input
                  type="checkbox"
                  checked={showHistorical}
                  onChange={event => setShowHistorical(event.target.checked)}
                />
                Show historical
              </label>
            )}
            {!readOnly && (
              <button
                onClick={onNewLSS}
                className="flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md px-2.5 py-1.5 transition-colors"
              >
                <Plus className="w-3 h-3" /> New LSS
              </button>
            )}
            <Link
              to={`/projects/${book.project_id}`}
              className="text-xs text-stone-500 hover:text-blue-600 font-medium transition-colors flex items-center gap-1 border border-stone-200 bg-white rounded-md px-2.5 py-1.5"
            >
              <FolderOpen className="w-3 h-3" /> View in Project
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50/80">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">System Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Config</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Water Type</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Flow m³/h</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Turnover ×/h</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {displayedSystems.map((sys: any) => {
                const calculation = calculationFor(sys.id);
                const flow = calculation?.results?.design_flow_m3h ?? null;
                const turnover = calculation?.results?.turnover_rate_cycles_per_hour ?? null;
                const overridden = calculation?.inputs?.design_flow_source === 'manual_override';
                return <tr
                  key={sys.id}
                  onClick={() => navigate(`/design-books/${book.id}/lss/${sys.id}`)}
                  className="border-t border-stone-100 hover:bg-blue-50/40 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded">{sys.system_code}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-stone-800 group-hover:text-blue-700">{sys.system_name}</td>
                  <td className="px-4 py-2.5"><SystemTypeBadge type={sys.system_type} /></td>
                  <td className="px-4 py-2.5"><SystemConfigBadge config={sys.system_config} /></td>
                  <td className="px-4 py-2.5"><WaterTypeBadge type={sys.water_type} /></td>
                  <td className="px-4 py-2.5 text-right">
                    {fmtNum(flow)}
                    <span className={`block text-[10px] ${overridden ? 'text-amber-700' : 'text-stone-400'}`}>
                      {overridden ? 'manual override' : flow != null ? 'linked exhibits' : 'unavailable'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{fmtNum(turnover)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={sys.status} />
                    {sys.status === 'Superseded' && sys.superseded_by_system_id && (
                      <span className="mt-1 block text-[10px] font-medium text-amber-700">Replacement recorded</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ChevronRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-blue-400 inline-block" />
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {/* Total row */}
        {totalFlow > 0 && (
          <div className="border-t-2 border-stone-200 bg-stone-50/60 px-4 py-2 flex items-center gap-4 text-xs">
            <span className="font-semibold text-stone-500 uppercase tracking-wide">Total</span>
            <span className="ml-auto font-mono font-semibold text-stone-700">{totalFlow.toFixed(1)} m³/h design flow</span>
          </div>
        )}
      </div>

      {/* Duty descriptions */}
      {displayedSystems.some(s => s.duty_description) && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 bg-stone-50/50">
            <span className="text-sm font-semibold text-stone-700">Duty Descriptions</span>
          </div>
          <div className="divide-y divide-stone-50">
            {displayedSystems.filter(s => s.duty_description).map((sys: any) => (
              <div key={sys.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{sys.system_code}</span>
                  <span className="text-sm font-medium text-stone-700">{sys.system_name}</span>
                </div>
                <p className="text-sm text-stone-500 leading-relaxed">{sys.duty_description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Exhibit Modal ───────────────────────────────────────────────────────
const WATER_TYPES = ['Marine', 'Freshwater', 'Brackish', 'Salt Water', 'Blackwater'];
const TANK_SHAPES = ['Rectangular', 'Cylindrical', 'Custom'];

function NewExhibitModal({ projectId, exhibits, onClose, onCreated }: {
  projectId: string;
  exhibits: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    exhibit_code: '', exhibit_name: '', water_type: '',
    design_temperature_min: '', design_temperature_max: '', design_salinity: '', notes: '',
    inherit_from_exhibit_id: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const selectPreviousExhibit = (exhibitId: string) => {
    const previous = exhibits.find(exhibit => exhibit.id === exhibitId);
    setForm(form => ({
      ...form,
      inherit_from_exhibit_id: exhibitId,
      water_type: previous?.water_type ?? '',
      design_temperature_min: previous?.design_temperature_min == null ? '' : String(previous.design_temperature_min),
      design_temperature_max: previous?.design_temperature_max == null ? '' : String(previous.design_temperature_max),
    }));
  };

  const handleSave = async () => {
    if (!form.exhibit_code.trim() || !form.exhibit_name.trim()) {
      return toast.error('Exhibit code and name are required');
    }
    setSaving(true);
    try {
      await api.post('/exhibits', {
        exhibit_code: form.exhibit_code.trim().toUpperCase(),
        exhibit_name: form.exhibit_name.trim(),
        project_id: projectId,
        water_type: form.water_type || null,
        design_temperature_min: form.design_temperature_min ? parseFloat(form.design_temperature_min) : null,
        design_temperature_max: form.design_temperature_max ? parseFloat(form.design_temperature_max) : null,
        design_salinity: form.design_salinity ? parseFloat(form.design_salinity) : null,
        notes: form.notes || null,
        inherit_from_exhibit_id: form.inherit_from_exhibit_id || null,
      });
      toast.success('Exhibit created');
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create exhibit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-semibold text-stone-800">New Exhibit</h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Exhibit Code *</label>
              <input type="text" placeholder="e.g. EX-01"
                value={form.exhibit_code} onChange={e => set('exhibit_code', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Water Type</label>
              <select value={form.water_type} onChange={e => set('water_type', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                <option value="">— Select —</option>
                {WATER_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Exhibit Name *</label>
            <input type="text" placeholder="e.g. Coral Reef Display"
              value={form.exhibit_name} onChange={e => set('exhibit_name', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Link to previous exhibit</label>
            <select
              value={form.inherit_from_exhibit_id}
              onChange={e => selectPreviousExhibit(e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="">— None —</option>
              {exhibits.map(exhibit => (
                <option key={exhibit.id} value={exhibit.id}>
                  {exhibit.exhibit_code ? `${exhibit.exhibit_code} — ` : ''}{exhibit.exhibit_name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-400">Copies water type and design temperatures; you can edit them below.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Temp Min (°C)</label>
              <input type="number" step="0.1" placeholder="24"
                value={form.design_temperature_min} onChange={e => set('design_temperature_min', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Temp Max (°C)</label>
              <input type="number" step="0.1" placeholder="26"
                value={form.design_temperature_max} onChange={e => set('design_temperature_max', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Salinity (ppt)</label>
              <input type="number" step="0.1" placeholder="34"
                value={form.design_salinity} onChange={e => set('design_salinity', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Notes</label>
            <textarea value={form.notes} rows={2} onChange={e => set('notes', e.target.value)} placeholder="Optional notes…"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-stone-100 bg-stone-50/40 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800 rounded-lg hover:bg-stone-100">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors">
            {saving ? 'Creating…' : 'Create Exhibit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Tank Panel (inside each exhibit) ───────────────────────────────────
function AddTankPanel({ exhibit, projectId, unassignedTanks, onRefresh, onClose }: {
  exhibit: any;
  projectId: string;
  unassignedTanks: any[];
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'assign' | 'new'>('assign');
  const [selected, setSelected] = useState<any | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newForm, setNewForm] = useState({
    tank_code: '', tank_name: exhibit.exhibit_name || '', shape_type: 'Rectangular',
    length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '',
    primary_material: '',
  });
  const [saving, setSaving] = useState(false);

  const setF = (k: string, v: string) => setNewForm(f => ({ ...f, [k]: v }));

  const handleConfirmAssign = async () => {
    if (!selected) return;
    setConfirming(true);
    try {
      await api.patch(`/tanks/${selected.id}/exhibit`, { exhibit_id: exhibit.id });
      toast.success(`${selected.tank_name} assigned to ${exhibit.exhibit_name}`);
      onRefresh();
      onClose();
    } catch {
      toast.error('Failed to assign tank');
    } finally {
      setConfirming(false);
    }
  };

  const handleCreate = async () => {
    if (!newForm.tank_code.trim() || !newForm.tank_name.trim()) {
      return toast.error('Tank code and name are required');
    }
    setSaving(true);
    try {
      await api.post('/tanks', {
        tank_code: newForm.tank_code.trim().toUpperCase(),
        tank_name: newForm.tank_name.trim(),
        project_id: projectId,
        exhibit_id: exhibit.id,
        shape_type: newForm.shape_type || null,
        length_mm: newForm.length_mm || null,
        width_mm: newForm.width_mm || null,
        height_mm: newForm.height_mm || null,
        design_water_level_mm: newForm.design_water_level_mm || null,
        primary_material: newForm.primary_material || null,
        status: 'Active',
      });
      toast.success('Tank created and added to exhibit');
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create tank');
    } finally {
      setSaving(false);
    }
  };

  const isCyl = newForm.shape_type === 'Cylindrical';

  return (
    <div className="border-t border-blue-100 bg-blue-50/20 px-5 py-4">
      {/* Mode tabs + close */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 rounded-lg border border-blue-200 bg-white p-0.5">
          <button
            onClick={() => { setMode('assign'); setSelected(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'assign' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:text-stone-800'
            }`}
          >
            <LinkIcon className="w-3 h-3" /> Assign Existing
          </button>
          <button
            onClick={() => { setMode('new'); setSelected(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'new' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:text-stone-800'
            }`}
          >
            <SquarePlus className="w-3 h-3" /> Create New Tank
          </button>
        </div>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Assign existing */}
      {mode === 'assign' && (
        unassignedTanks.length === 0 ? (
          <div className="text-center py-6 text-stone-400 text-sm">
            <Layers className="w-6 h-6 mx-auto mb-2 opacity-40" />
            No unassigned tanks in this project.<br />
            <button onClick={() => setMode('new')} className="mt-2 text-blue-600 hover:underline text-xs">Create a new tank instead →</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-stone-500">{unassignedTanks.length} unassigned tank{unassignedTanks.length !== 1 ? 's' : ''} — select one to assign:</p>

            {/* Tank list */}
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {unassignedTanks.map(tank => {
                const isSelected = selected?.id === tank.id;
                return (
                  <button
                    key={tank.id}
                    onClick={() => setSelected(isSelected ? null : tank)}
                    className={`w-full text-left flex items-center gap-2.5 rounded-lg px-3 py-2 border transition-all ${
                      isSelected
                        ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300'
                        : 'bg-white border-stone-200 hover:border-blue-300'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'border-blue-500 bg-blue-500' : 'border-stone-300'
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded shrink-0">{tank.tank_code}</span>
                    <span className="text-sm text-stone-700 truncate flex-1">{tank.tank_name}</span>
                    {tank.eff_shape && <ShapeBadge shape={tank.eff_shape} />}
                    {tank.gross_volume_m3 && (
                      <span className="text-xs text-stone-400 font-mono shrink-0">{parseFloat(tank.gross_volume_m3).toFixed(2)} m³</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected preview + confirm */}
            {selected && (
              <div className="mt-2 rounded-lg bg-blue-600 text-white px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-200" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{selected.tank_name}</p>
                    <p className="text-xs text-blue-200">
                      {selected.eff_shape || 'Tank'}{selected.gross_volume_m3 ? ` · ${parseFloat(selected.gross_volume_m3).toFixed(2)} m³` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleConfirmAssign}
                  disabled={confirming}
                  className="shrink-0 flex items-center gap-1.5 bg-white text-blue-700 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  {confirming ? 'Assigning…' : 'Confirm Assignment'}
                </button>
              </div>
            )}
          </div>
        )
      )}

      {/* Create new */}
      {mode === 'new' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Tank Code *</label>
              <input type="text" placeholder="e.g. TK-01"
                value={newForm.tank_code} onChange={e => setF('tank_code', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Shape</label>
              <select value={newForm.shape_type} onChange={e => setF('shape_type', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                {TANK_SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Tank Name *</label>
            <input type="text" placeholder="e.g. Main Display Tank"
              value={newForm.tank_name} onChange={e => setF('tank_name', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div className={`grid gap-3 ${isCyl ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {!isCyl && (
              <div>
                <label className="block text-xs text-stone-500 mb-1">Length (mm)</label>
                <input type="number" placeholder="0" value={newForm.length_mm} onChange={e => setF('length_mm', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            )}
            <div>
              <label className="block text-xs text-stone-500 mb-1">{isCyl ? 'Diameter (mm)' : 'Width (mm)'}</label>
              <input type="number" placeholder="0" value={newForm.width_mm} onChange={e => setF('width_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Height (mm)</label>
              <input type="number" placeholder="0" value={newForm.height_mm} onChange={e => setF('height_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Water Level (mm)</label>
              <input type="number" placeholder="0" value={newForm.design_water_level_mm} onChange={e => setF('design_water_level_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Material</label>
            <input type="text" placeholder="e.g. Acrylic, FRP, Concrete"
              value={newForm.primary_material} onChange={e => setF('primary_material', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors">
              {saving ? 'Creating…' : 'Create & Assign Tank'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PromoteTankModal({ tank, designBookId, onClose, onCompleted }: {
  tank: any;
  designBookId: string;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const qc = useQueryClient();
  const [familyMode, setFamilyMode] = useState<'existing' | 'new'>('existing');
  const [form, setForm] = useState({
    product_code: `PIM-${String(tank.tank_code || '').toUpperCase()}`,
    product_name: tank.tank_name || '',
    tank_family_id: '',
    new_family_code: '',
    new_family_name: '',
    application_type: tank.tank_type || '',
    manufacturer: '',
    model: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const { data: familiesData, isLoading: familiesLoading } = useQuery({
    queryKey: ['tank-families'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
  });
  const families: any[] = familiesData?.items || [];

  const setField = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  const canSave = form.product_code.trim() && form.product_name.trim() &&
    (familyMode === 'existing' ? form.tank_family_id : form.new_family_code.trim() && form.new_family_name.trim());

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.post(`/tanks/${tank.id}/promote-to-pim`, {
        design_book_id: designBookId,
        product_code: form.product_code.trim(),
        product_name: form.product_name.trim(),
        tank_family_id: familyMode === 'existing' ? form.tank_family_id : undefined,
        new_family: familyMode === 'new'
          ? { code: form.new_family_code.trim(), name: form.new_family_name.trim() }
          : undefined,
        application_type: form.application_type.trim() || undefined,
        manufacturer: form.manufacturer.trim() || undefined,
        model: form.model.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success('Tank added to the PIM Tank Library');
      qc.invalidateQueries({ queryKey: ['tank-families'] });
      onCompleted();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to add tank to the PIM library');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4">
      <ModalDialog
        onClose={onClose}
        labelledBy="promote-tank-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <LibraryBig className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 id="promote-tank-title" className="font-semibold text-stone-900">Add to PIM Tank Library</h2>
              <p className="text-xs text-stone-500">Create a reusable library item from this project tank.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600" aria-label="Close promotion form"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
            <p className="font-semibold">Project tank ≠ PIM library item</p>
            <p className="text-xs text-blue-800 mt-1">
              The tank will remain in its project. This intentional action creates a separate reusable PIM record and keeps a traceable link back to {tank.tank_code}.
            </p>
          </div>

          <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div>
              <span className="text-stone-500">Source project tank</span>
              <p className="font-medium text-stone-800">{tank.tank_code} · {tank.tank_name}</p>
            </div>
            <div className="text-right text-stone-500">
              {tank.eff_shape || tank.shape_type || 'Tank'}
              {(tank.gross_volume_m3 != null) && ` · ${parseFloat(String(tank.gross_volume_m3)).toFixed(2)} m³`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Reusable product code *</label>
              <input value={form.product_code} onChange={e => setField('product_code', e.target.value.toUpperCase())}
                placeholder="PM-TNK-001" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Reusable product name *</label>
              <input value={form.product_name} onChange={e => setField('product_name', e.target.value)}
                placeholder="Standard Acrylic Display Tank" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-stone-600">PIM tank family *</label>
              <div className="flex rounded-md border border-stone-200 bg-white p-0.5">
                <button type="button" onClick={() => setFamilyMode('existing')}
                  className={`px-2 py-1 text-[11px] rounded ${familyMode === 'existing' ? 'bg-blue-600 text-white' : 'text-stone-500'}`}>
                  Choose existing
                </button>
                <button type="button" onClick={() => setFamilyMode('new')}
                  className={`px-2 py-1 text-[11px] rounded ${familyMode === 'new' ? 'bg-blue-600 text-white' : 'text-stone-500'}`}>
                  Create new
                </button>
              </div>
            </div>
            {familyMode === 'existing' ? (
              <select value={form.tank_family_id} onChange={e => setField('tank_family_id', e.target.value)} disabled={familiesLoading}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                <option value="">{familiesLoading ? 'Loading families…' : '— select a tank family —'}</option>
                {families.map(family => <option key={family.id} value={family.id}>{family.name} ({family.code})</option>)}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input value={form.new_family_code} onChange={e => setField('new_family_code', e.target.value.toUpperCase())}
                  placeholder="Family code, e.g. DISPLAY" className="border border-stone-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                <input value={form.new_family_name} onChange={e => setField('new_family_name', e.target.value)}
                  placeholder="Family name" className="border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Tank type</label>
              <input value={form.application_type} onChange={e => setField('application_type', e.target.value)}
                placeholder="Display Tank" className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Manufacturer (optional)</label>
              <input value={form.manufacturer} onChange={e => setField('manufacturer', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Model / reusable notes (optional)</label>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.model} onChange={e => setField('model', e.target.value)}
                placeholder="Model reference" className="border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              <input value={form.notes} onChange={e => setField('notes', e.target.value)}
                placeholder="Library notes" className="border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-stone-200 bg-stone-50/40 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800 rounded-lg hover:bg-stone-100 disabled:opacity-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || !canSave}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? 'Adding to library…' : 'Create PIM Library Item'}
          </button>
        </div>
      </ModalDialog>
    </div>
  );
}
function ExhibitsTab({
  book, exhibits, tanks, exhibitMap, onRefresh, onNewExhibit, canPromote = false, readOnly = false,
}: {
  book: any; exhibits: any[]; tanks: any[];
  exhibitMap: Map<string | null, any[]>;
  onRefresh: () => void; onNewExhibit: () => void; canPromote?: boolean; readOnly?: boolean;
}) {
  const navigate = useNavigate();
  const [deletingExhibit, setDeletingExhibit] = useState<string | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<any | null>(null);
  const allSpecies: any[] = book.species || [];

  const handleDeleteExhibit = async (exhibitId: string) => {
    try {
      await api.delete(`/exhibits/${exhibitId}`);
      toast.success('Exhibit deleted');
      setDeletingExhibit(null);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete exhibit');
    }
  };
  const unassigned: any[] = exhibitMap.get(null) || [];
  const totalGross = tanks.reduce((s, t) => s + (parseFloat(t.gross_volume_m3) || 0), 0);

  if (!book.project_id) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <FolderOpen className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No project linked</p>
        <p className="text-stone-400 text-sm mt-1">Link this design book to a project to see its exhibits and tanks.</p>
      </div>
    );
  }

  if (exhibits.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-20 text-center">
        <Layers className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No exhibits yet</p>
        <p className="text-stone-400 text-sm mt-1 mb-4">Create your first exhibit to start organising tanks and species.</p>
        {!readOnly && (
          <button
            onClick={onNewExhibit}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Exhibit
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          {exhibits.length} exhibit{exhibits.length !== 1 ? 's' : ''} · {tanks.length} tank{tanks.length !== 1 ? 's' : ''}
          {totalGross > 0 && <span className="ml-2 font-mono text-stone-400">· {totalGross.toFixed(2)} m³ total</span>}
        </p>
        {!readOnly && (
          <button
            onClick={onNewExhibit}
            className="flex items-center gap-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> New Exhibit
          </button>
        )}
      </div>

      {/* Exhibit list table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Exhibit Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Water Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Temperature</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Tank</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Volume m³</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Species</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {exhibits.map((exhibit: any) => {
              const exhibitTank = (exhibitMap.get(exhibit.id) || [])[0];
              const speciesCount = allSpecies.filter(s => s.exhibit_id === exhibit.id).length;
              const gross = exhibitTank ? parseFloat(exhibitTank.gross_volume_m3) || 0 : 0;

              return (
                <tr
                  key={exhibit.id}
                  onClick={() => navigate(`/design-books/${book.id}/exhibits/${exhibit.id}`)}
                  className="border-t border-stone-100 hover:bg-blue-50/30 cursor-pointer transition-colors group"
                >
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{exhibit.exhibit_code}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-semibold text-stone-800 group-hover:text-blue-700 transition-colors">{exhibit.exhibit_name}</span>
                    {exhibit.area_name && (
                      <span className="ml-2 text-xs text-stone-400">{exhibit.area_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <WaterTypeBadge type={exhibit.water_type} />
                  </td>
                  <td className="px-4 py-3.5">
                    {(exhibit.design_temperature_min != null || exhibit.design_temperature_max != null) ? (
                      <span className="flex items-center gap-1 text-xs text-stone-600">
                        <ThermometerSun className="w-3 h-3 text-stone-400" />
                        {exhibit.design_temperature_min ?? '?'}–{exhibit.design_temperature_max ?? '?'} °C
                      </span>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {exhibitTank ? (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                        <span className="font-medium text-stone-700 text-xs">{exhibitTank.tank_name}</span>
                        <span className="ml-1.5 font-mono text-xs text-stone-400">{exhibitTank.tank_code}</span>
                        </div>
                        {canPromote && (
                          (exhibitTank.product_master_id || exhibitTank.promoted_product_master_id) ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full whitespace-nowrap" title="This project tank is linked to a PIM library item">
                              <Check className="w-2.5 h-2.5" /> In PIM
                            </span>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); setPromoteTarget(exhibitTank); }}
                              className="inline-flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full hover:bg-blue-100 whitespace-nowrap"
                              title="Create a reusable PIM library item from this project tank"
                            >
                              <LibraryBig className="w-2.5 h-2.5" /> Add to PIM Tank Library
                            </button>
                          )
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">No tank</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {gross > 0 ? (
                      <span className="font-mono text-sm font-semibold text-stone-700">{gross.toFixed(2)}</span>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {speciesCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <Fish className="w-3 h-3" /> {speciesCount}
                      </span>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                    {!readOnly && deletingExhibit === exhibit.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-xs text-red-600 font-medium mr-1">Delete?</span>
                        <button
                          onClick={() => handleDeleteExhibit(exhibit.id)}
                          className="px-2 py-0.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded font-medium"
                        >Yes</button>
                        <button
                          onClick={() => setDeletingExhibit(null)}
                          className="px-2 py-0.5 text-xs text-stone-500 bg-stone-100 hover:bg-stone-200 rounded font-medium"
                        >No</button>
                      </div>
                    ) : !readOnly ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDeletingExhibit(exhibit.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                          title="Delete exhibit"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-blue-500 transition-colors" />
                      </div>
                    ) : <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-blue-500 transition-colors" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Summary footer */}
        {tanks.length > 0 && (
          <div className="border-t-2 border-stone-200 bg-stone-50/80 px-5 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {tanks.length} tank{tanks.length !== 1 ? 's' : ''} across {exhibits.length} exhibits
            </span>
            <span className="font-mono text-sm font-bold text-stone-700">{totalGross.toFixed(3)} m³</span>
          </div>
        )}
      </div>

      {/* Unassigned tanks notice */}
      {unassigned.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-sm text-amber-800">
            <span className="font-semibold">{unassigned.length} unassigned tank{unassigned.length !== 1 ? 's' : ''}</span>
            {' '}— open an exhibit and use "Assign Tank" to link {unassigned.length === 1 ? 'it' : 'them'}.
          </span>
        </div>
      )}
      {promoteTarget && (
        <PromoteTankModal
          tank={promoteTarget}
          designBookId={book.id}
          onClose={() => setPromoteTarget(null)}
          onCompleted={() => { setPromoteTarget(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function thermalNumber(value: any, decimals = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(decimals) : '—';
}

function thermalActiveDuty(calculation: any) {
  const result = calculation?.results;
  const netLoad = Number(result?.net_total_load_kw);
  if (!result || !Number.isFinite(netLoad)) return null;
  if (netLoad >= 0) {
    return { label: 'Cooling', value: result.margin_adjusted_cooling_kw };
  }
  const marginPct = Number(
    calculation?.formula_inputs?.capacity_margin_pct ??
    calculation?.inputs?.capacity_margin_pct ??
    0,
  );
  return {
    label: 'Heating',
    value: result.margin_adjusted_steady_state_heating_kw ??
      Number(result.steady_state_heating_kw || 0) * (1 + marginPct / 100),
  };
}

export function thermalLinkedFreeSurfaceArea(source: any) {
  const tanks = Array.isArray(source?.linked_tanks) ? source.linked_tanks : [];
  if (!tanks.length) return null;
  const areas = tanks.map((tank: any) => {
    const storedArea = Number(
      tank?.free_surface_area_m2 ??
      tank?.water_surface_area_m2 ??
      tank?.surface_area_m2,
    );
    if (Number.isFinite(storedArea) && storedArea > 0) return storedArea;
    const length = Number(tank?.dimensions?.inner_length_mm ?? tank?.inner_length_mm);
    const width = Number(tank?.dimensions?.inner_width_mm ?? tank?.inner_width_mm);
    const quantity = Math.max(1, Number(tank?.quantity) || 1);
    return Number.isFinite(length) && length > 0 && Number.isFinite(width) && width > 0
      ? length * width / 1e6 * quantity
      : Number.NaN;
  });
  if (areas.some((area: number) => !Number.isFinite(area) || area <= 0)) return null;
  return areas.reduce((sum: number, area: number) => sum + area, 0);
}

function customTankWallAreaDefault(tank: any) {
  const dimensions = tank?.dimensions || tank;
  const length = Number(dimensions?.inner_length_mm);
  const width = Number(dimensions?.inner_width_mm);
  const waterHeight = Number(dimensions?.water_height_mm);
  const quantity = Math.max(1, Number(tank?.quantity) || 1);
  if (![length, width, waterHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  return 2 * (length + width) * waterHeight / 1e6 * quantity;
}

export function thermalEvidenceBasis(detail: any) {
  const calculation = detail?.calculation ||
    detail?.result_snapshot ||
    detail?.saved?.result_snapshot ||
    detail?.current_preview ||
    detail ||
    {};
  const inputSnapshot = detail?.saved?.input_snapshot ||
    detail?.input_snapshot ||
    calculation?.inputs ||
    {};
  const formulaInputs = detail?.saved?.formula_inputs ||
    detail?.formula_inputs ||
    calculation?.formula_inputs ||
    {};
  const wall = calculation?.wall_construction_basis ||
    formulaInputs?.wall_construction_basis ||
    inputSnapshot?.wall_construction_basis ||
    null;
  return {
    temperature: calculation?.water_temperature_basis ||
      formulaInputs?.water_temperature_basis ||
      inputSnapshot?.water_temperature_basis ||
      null,
    wall: wall ? normalizeThermalWallConstruction(wall) : null,
  };
}

export function thermalWallBasisChange(detail: any) {
  return detail?.wall_basis_change ||
    detail?.calculation?.wall_basis_change ||
    null;
}
export function thermalCorrelationVersionsForClass(
  items: any[],
  classCode: string,
  selectedCorrelationId = '',
) {
  return items.filter(item =>
    item.class_code === classCode &&
    (item.status === 'approved' || item.id === selectedCorrelationId));
}

export function thermalCorrelationDefaults(correlation: any) {
  return {
    evaporation_coefficient_kg_m2_s_kpa: correlation?.coefficient_kg_m2_s_kpa ?? '',
    adjacent_lower_class: correlation?.lower_agitation_class_code ?? '',
    adjacent_lower_coefficient: correlation?.lower_class_coefficient_kg_m2_s_kpa ?? '',
    correlation_adjustment_value: correlation?.adjustment_value ?? '',
    adjacent_upper_class: correlation?.upper_agitation_class_code ?? '',
    adjacent_upper_coefficient: correlation?.upper_class_coefficient_kg_m2_s_kpa ?? '',
  };
}

function thermalWallThicknessMm(source: any) {
  if (source?.thickness_mm != null && source.thickness_mm !== '') {
    const thickness = Number(source.thickness_mm);
    return Number.isFinite(thickness) ? thickness : '';
  }
  if (source?.thickness_m != null && source.thickness_m !== '') {
    const thickness = Number(source.thickness_m);
    return Number.isFinite(thickness) ? thickness * 1000 : '';
  }
  return '';
}

function firstThermalWallText(...values: any[]) {
  return values.find(value => String(value ?? '').trim()) ?? '';
}

export function normalizeThermalWallConstruction(construction: any) {
  if (!construction) return null;
  const effectiveLayer = construction.effective_layers?.[0] ||
    construction.layers?.[0] ||
    construction.default_layers?.[0] ||
    null;
  const material = firstThermalWallText(construction.material, effectiveLayer?.material);
  const code = firstThermalWallText(
    construction.code,
    construction.construction_code,
    construction.construction_type,
  );
  const label = firstThermalWallText(
    construction.label,
    construction.construction_label,
    material,
    code,
  );
  const thicknessMm = thermalWallThicknessMm(
    construction.thickness_mm != null || construction.thickness_m != null
      ? construction
      : effectiveLayer,
  );
  const conductivity = construction.conductivity_w_m_k ??
    effectiveLayer?.conductivity_w_m_k ??
    '';
  const normalizeLayer = (layer: any) => layer ? {
    ...layer,
    thickness_mm: thermalWallThicknessMm(layer),
    thickness_units: 'mm',
    conductivity_units: layer.conductivity_units || 'W/m·K',
  } : layer;
  return {
    ...construction,
    code,
    construction_code: code,
    construction_type: code,
    label,
    construction_label: label,
    material,
    thickness_mm: thicknessMm,
    conductivity_w_m_k: conductivity,
    units: construction.units || 'W/m²·K',
    thickness_units: 'mm',
    conductivity_units: construction.conductivity_units || 'W/m·K',
    assumption_label: construction.assumption_label ||
      (label ? `Saved Thermal wall assumption — ${label}` : 'Saved Thermal wall assumption'),
    basis_version: construction.basis_version || construction.version || '',
    default_layers: Array.isArray(construction.default_layers)
      ? construction.default_layers.map(normalizeLayer)
      : construction.default_layers,
    effective_layers: Array.isArray(construction.effective_layers)
      ? construction.effective_layers.map(normalizeLayer)
      : construction.effective_layers,
    layers: Array.isArray(construction.layers)
      ? construction.layers.map(normalizeLayer)
      : construction.layers,
    tank_bases: Array.isArray(construction.tank_bases)
      ? construction.tank_bases.map((basis: any) => normalizeThermalWallConstruction(basis))
      : construction.tank_bases,
  };
}

export function thermalWallFormValues(construction: any) {
  const normalized = normalizeThermalWallConstruction(construction);
  return {
    wall_material: normalized?.material ?? '',
    wall_thickness_mm: normalized?.thickness_mm ?? '',
    wall_conductivity_w_m_k: normalized?.conductivity_w_m_k ?? '',
  };
}

export function thermalWallConstructionForMaterial(constructions: any[], materialValue: any) {
  const material = String(materialValue ?? '').trim().toLowerCase();
  if (!material) return null;
  const code = material.includes('acrylic') || material.includes('pmma')
    ? 'acrylic'
    : material.includes('concrete')
      ? 'concrete'
      : material.includes('frp') || material.includes('grp') || material.includes('fiberglass')
        ? 'frp'
        : material.includes('steel')
          ? 'steel'
          : '';
  return constructions.find(item => item.code === code) || null;
}

export function thermalExhibitTankConstruction(source: any, constructions: any[]) {
  const tankConstructions = (source?.linked_tanks || [])
    .map((tank: any) => thermalWallConstructionForMaterial(constructions, tank.wall_material))
    .filter(Boolean);
  const constructionCodes = [...new Set(
    tankConstructions.map((construction: any) => construction.code),
  )];
  if (constructionCodes.length !== 1) return null;
  return tankConstructions.find((construction: any) => construction.code === constructionCodes[0]) || null;
}

export function thermalExhibitTankWallBases(source: any, constructions: any[]) {
  return (source?.linked_tanks || []).map((tank: any) => {
    const construction = thermalWallConstructionForMaterial(constructions, tank.wall_material);
    const conductivity = Number(construction?.conductivity_w_m_k);
    const thicknessMm = Number(tank.wall_thickness_mm);
    if (!construction || !(conductivity > 0) || !(thicknessMm > 0)) return null;
    const materialResistance = thicknessMm / 1000 / conductivity;
    const overallResistance = 1 / 150 + materialResistance + 1 / 5;
    return normalizeThermalWallConstruction({
      ...construction,
      tank_id: tank.tank_id || null,
      tank_code: tank.tank_code || null,
      exhibit_id: tank.exhibit_id || null,
      exhibit_code: tank.exhibit_code || null,
      quantity: tank.quantity ?? 1,
      exposed_wall_area_m2: tank.exposed_wall_area_m2 ?? null,
      material: tank.wall_material,
      thickness_mm: thicknessMm,
      u_value_w_m2_k: conductivity / (thicknessMm / 1000),
      material_resistance_m2_k_w: materialResistance,
      material_u_value_w_m2_k: 1 / materialResistance,
      overall_resistance_m2_k_w: overallResistance,
      overall_u_value_w_m2_k: 1 / overallResistance,
      assumption_label: `Exhibit tank wall — ${tank.wall_material}, ${thicknessMm} mm`,
      source: 'exhibit tank wall with governed material conductivity',
      source_basis: 'Linked exhibit tank with governed material conductivity',
      source_reference: tank.tank_code || tank.tank_id || construction.source_reference,
    });
  }).filter(Boolean);
}
export function thermalExhibitTankWallBasis(source: any, constructions: any[]) {
  const basis = thermalExhibitTankWallBases(source, constructions)[0];
  return basis ? {
    ...basis,
    // This legacy single-wall helper remains an overall-U presentation value;
    // mixed-tank calculations consume the per-tank governed material U above.
    u_value_w_m2_k: basis.overall_u_value_w_m2_k ?? basis.u_value_w_m2_k,
  } : null;
}

export function thermalWallOverrideFlags(form: any, construction: any) {
  const normalized = normalizeThermalWallConstruction(construction);
  if (!normalized) return {};
  return {
    material: String(form.wall_material || '').trim() !== String(normalized.material || '').trim(),
    thickness_mm: Number(form.wall_thickness_mm) !== Number(normalized.thickness_mm),
    conductivity_w_m_k:
      Number(form.wall_conductivity_w_m_k) !== Number(normalized.conductivity_w_m_k),
  };
}

function ThermalCorrelationUsageList({ usages }: { usages: any[] }) {
  const statusOrder = ['Draft', 'In Progress', 'For Review', 'Approved', 'Released'];
  const byStatus = usages.reduce((groups: Map<string, Map<string, any[]>>, usage) => {
    const status = usage.design_book_status || 'Unknown status';
    const project = usage.project_id
      ? `${usage.project_code || 'Project'} · ${usage.project_name || 'Unnamed project'}`
      : 'No project linked';
    if (!groups.has(status)) groups.set(status, new Map());
    const byProject = groups.get(status)!;
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project)!.push(usage);
    return groups;
  }, new Map());
  const statuses = [...byStatus.keys()].sort((a, b) => {
    const aIndex = statusOrder.indexOf(a);
    const bIndex = statusOrder.indexOf(b);
    return (aIndex < 0 ? statusOrder.length : aIndex) - (bIndex < 0 ? statusOrder.length : bIndex);
  });

  if (!usages.length) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
        No saved thermal calculations have captured this correlation version.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {statuses.map(status => (
        <section key={status}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">{status}</span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
              {[...byStatus.get(status)!.values()].reduce((total, rows) => total + rows.length, 0)}
            </span>
          </div>
          <div className="space-y-2">
            {[...byStatus.get(status)!.entries()].map(([project, rows]) => (
              <div key={project} className="rounded-xl border border-stone-200 bg-white">
                <div className="border-b border-stone-100 bg-stone-50/70 px-3 py-2 text-sm font-medium text-stone-700">
                  {project}
                </div>
                <div className="divide-y divide-stone-100">
                  {rows.map((usage: any, index: number) => (
                    <div key={`${usage.design_book_id}-${usage.system_id || index}`} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-stone-800">
                          {usage.book_code || 'Unnamed Design Book'}
                          {usage.revision ? ` · Rev ${usage.revision}` : ''}
                        </div>
                        <div className="truncate text-xs text-stone-500">
                          {usage.book_title || 'Untitled Design Book'}
                          {usage.system_code || usage.system_name
                            ? ` · ${usage.system_code || usage.system_name}`
                            : ''}
                        </div>
                      </div>
                      {usage.captured_at && (
                        <time className="shrink-0 text-xs text-stone-400" dateTime={usage.captured_at}>
                          {new Date(usage.captured_at).toLocaleDateString()}
                        </time>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function thermalWallBasisValue(basis: any, key: string) {
  const value = basis?.[key];
  if (value !== null && value !== undefined && value !== '') return value;
  const tankValues = (basis?.tank_bases || [])
    .map((tank: any) => tank?.[key])
    .filter((item: any) => item !== null && item !== undefined && item !== '');
  if (!tankValues.length) return null;
  const distinct = [...new Set(tankValues.map(String))];
  return distinct.length === 1 ? tankValues[0] : 'Mixed by tank';
}

function thermalWallBasisLayers(basis: any) {
  const basisLayers = Array.isArray(basis?.effective_layers) && basis.effective_layers.length
    ? basis.effective_layers
    : Array.isArray(basis?.layers) && basis.layers.length
      ? basis.layers
      : Array.isArray(basis?.default_layers) ? basis.default_layers : [];
  if (basisLayers.length) {
    return basisLayers.map((layer: any, index: number) => ({
      ...layer,
      key: `basis-${index}`,
      scope: null,
    }));
  }
  return (basis?.tank_bases || []).flatMap((tank: any, tankIndex: number) =>
    (tank?.layers || []).map((layer: any, layerIndex: number) => ({
      ...layer,
      key: `${tank.tank_id || tank.tank_code || tankIndex}-${layerIndex}`,
      scope: tank.tank_code || tank.tank_id || 'Linked tank',
    })));
}
type ThermalWallForm = {
  construction_code: string;
  construction_label: string;
  material: string;
  conductivity_w_m_k: string | number;
  source_basis: string;
  source_reference: string;
  version: string;
  notes: string;
};

export function thermalWallReplacementIsValid(form: Partial<ThermalWallForm>) {
  return Boolean(
    String(form.construction_code || '').trim() &&
    String(form.construction_label || '').trim() &&
    String(form.material || '').trim() &&
    Number.isFinite(Number(form.conductivity_w_m_k)) &&
    Number(form.conductivity_w_m_k) > 0 &&
    String(form.source_basis || '').trim() &&
    String(form.source_reference || '').trim() &&
    String(form.version || '').trim(),
  );
}

function thermalWallFormFrom(construction: any, preserveVersion = false): ThermalWallForm {
  const normalized = normalizeThermalWallConstruction(construction);
  return {
    construction_code: normalized?.code || '',
    construction_label: normalized?.label || '',
    material: normalized?.material || '',
    conductivity_w_m_k: normalized?.conductivity_w_m_k ?? '',
    source_basis: normalized?.source_basis || 'AAT Foundations',
    source_reference: normalized?.source_reference || '',
    version: preserveVersion ? normalized?.version || normalized?.basis_version || '' : '',
    notes: preserveVersion ? normalized?.notes || '' : '',
  };
}

const thermalFieldClass = 'w-full rounded-lg border border-[#c7d1d4] bg-[#fbfaf7] px-3 py-2 text-sm text-[#263746] outline-none transition focus:border-[#b86843] focus:ring-2 focus:ring-[#b86843]/25 disabled:bg-[#f3efe8] disabled:text-[#71808a]';
const thermalLabelClass = 'mb-1 block text-xs font-semibold text-[#456b7d]';

export function ThermalNumericField({
  name,
  label,
  unit,
  step = 'any',
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  label: string;
  unit?: string;
  step?: string;
  value: any;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      <span className={thermalLabelClass}>{label}{unit ? ` (${unit})` : ''}</span>
      <input
        aria-label={label}
        name={name}
        type="number"
        step={step}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
        className={thermalFieldClass}
      />
    </label>
  );
}

export function thermalHasEquipmentHeatSources(source: any) {
  return !!source && Object.prototype.hasOwnProperty.call(source, 'equipment_heat_sources');
}

export function EquipmentHeatGainBreakdown({ source }: { source: any }) {
  const rows: any[] = Array.isArray(source?.equipment_heat_sources)
    ? source.equipment_heat_sources
    : [];
  const suppliedTotal = Number(source?.equipment_heat_gain_kw);
  const calculatedTotal = Number.isFinite(suppliedTotal)
    ? suppliedTotal
    : rows.reduce((total, row) => total + (Number(row.heat_gain_kw) || 0), 0);
  const installationLabel = (location: any) => {
    const normalized = String(location || '').toLowerCase();
    if (normalized === 'external') return 'External';
    if (normalized === 'submerged') return 'Submerged';
    return location || '—';
  };

  return (
    <div className="space-y-3 rounded-xl border border-[#d8d4cb] bg-[#faf9f5] p-4">
      <div>
        <h4 className="text-sm font-semibold text-[#263746]">Equipment heat-gain breakdown</h4>
        <p className="mt-1 text-xs text-[#71808a]">
          Uses the saved pump-selection and UV equipment results captured for this LSS system; Thermal does not re-size pumps.
          External pumps contribute saved shaft power to the water; submerged pumps contribute saved motor input power.
          UV heat follows its saved equipment heat basis.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Equipment / type</th>
              <th className="px-3 py-2 text-right">Quantity</th>
              <th className="px-3 py-2">Installation / basis</th>
              <th className="px-3 py-2 text-right">Power per unit</th>
              <th className="px-3 py-2 text-right">Heat to water</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((equipment, index) => (
              <tr key={[
                source?.system_id || 'system',
                equipment.equipment_type || 'equipment',
                equipment.equipment_id || 'unassigned',
                equipment.circuit_key || equipment.side_stream_id || 'circuit',
                equipment.pump_role || 'role',
                equipment.equipment_code || index,
              ].join(':')}>
                <td className="px-3 py-3">
                  <div className="font-semibold text-stone-800">
                    {equipment.equipment_name || equipment.equipment_code || equipment.equipment_type || 'Equipment'}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-stone-500">
                    {[equipment.equipment_code, equipment.equipment_type].filter(Boolean).join(' · ') || '—'}
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-mono">{thermalNumber(equipment.quantity, 0)}</td>
                <td className="px-3 py-3 text-stone-700">
                  <div>{installationLabel(equipment.installation_location)}</div>
                  {equipment.heat_basis && <div className="mt-0.5 text-[11px] text-stone-500">{equipment.heat_basis}</div>}
                  {equipment.status && equipment.status !== 'ready' && (
                    <div className="mt-0.5 text-[11px] text-amber-700">{equipment.status}</div>
                  )}
                  {Array.isArray(equipment.reasons) && equipment.reasons.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-amber-700">{equipment.reasons.join(' ')}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-mono">{thermalNumber(equipment.input_power_kw_per_unit)} kW</td>
                <td className="px-3 py-3 text-right font-mono">{thermalNumber(equipment.heat_gain_kw)} kW</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-stone-500">No linked pump or UV heat sources are available.</td></tr>
            )}
          </tbody>
          <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold text-stone-800">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right">Calculated equipment total</td>
              <td className="px-3 py-2 text-right font-mono">{thermalNumber(calculatedTotal)} kW</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function MassTransferCoefficientControl({
  value,
  overridden,
  canOverride,
  onChange,
  onOverride,
  onReset,
}: {
  value?: number | string | null;
  overridden: boolean;
  canOverride: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOverride: () => void;
  onReset: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className={thermalLabelClass}>
          Mass-transfer coefficient (kg/m²·s·kPa){overridden && ' · Override'}
        </span>
        {canOverride && (
          <button
            type="button"
            aria-label={overridden ? 'Reset mass-transfer coefficient override' : 'Override mass-transfer coefficient'}
            className="text-xs font-medium text-[#9d5637] underline underline-offset-2 hover:text-[#7d442f]"
            onClick={overridden ? onReset : onOverride}
          >
            {overridden ? 'Reset' : 'Override'}
          </button>
        )}
      </div>
      <input
        aria-label="Mass-transfer coefficient"
        type="number"
        min="0"
        step="any"
        value={value ?? ''}
        onChange={onChange}
        disabled={!canOverride || !overridden}
        className={thermalFieldClass}
      />
    </div>
  );
}

export function WallUValueControl({
  governedValue,
  overrideValue,
  canOverride,
  onChange,
  onOverride,
  onReset,
  info,
}: {
  governedValue?: number | string | null;
  overrideValue?: number | string | null;
  canOverride: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOverride: () => void;
  onReset: () => void;
  info?: string;
}) {
  const hasStoredOverride = overrideValue !== '' && overrideValue != null;
  const [overrideActive, setOverrideActive] = useState(hasStoredOverride);
  const effectiveValue = overrideActive ? overrideValue ?? '' : governedValue;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className={thermalLabelClass}>Wall U-value (W/m²·K)</span>
        {overrideActive && canOverride && (
          <span className="text-xs font-medium text-[#9d5637]">Override</span>
        )}
      </div>
      <input
        aria-label="Wall U-value"
        type="number"
        min="0"
        step="any"
        value={effectiveValue ?? ''}
        onChange={onChange}
        disabled={!canOverride || !overrideActive}
        className={thermalFieldClass}
      />
      {info && <span className="mt-1 block text-[11px] text-stone-500">{info}</span>}
      {canOverride && (
        <button
          type="button"
          aria-label={overrideActive ? 'Reset wall U-value override' : 'Override wall U-value'}
          className="mt-1 text-xs font-medium text-[#9d5637] underline underline-offset-2 hover:text-[#7d442f]"
          onClick={() => {
            if (overrideActive) {
              setOverrideActive(false);
              onReset();
            } else {
              setOverrideActive(true);
              onOverride();
            }
          }}
        >
          {overrideActive ? 'Reset to governed default' : 'Override'}
        </button>
      )}
    </div>
  );
}

export function WaterTemperatureOverrideControl({
  average,
  overrideValue,
  onOverrideChange,
  disabled = false,
}: {
  average?: number | string | null;
  overrideValue?: number | string | null;
  onOverrideChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const hasOverride = overrideValue !== '' && overrideValue != null;
  const effectiveValue = hasOverride ? overrideValue : average;

  return (
    <div className="mt-2 border-t border-stone-100 pt-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-medium">
        <span>{hasOverride ? 'Reviewed calculation temperature' : 'Arithmetic average'}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono">{thermalNumber(effectiveValue, 1)} °C</span>
          {!disabled && !editing && (
            <button
              type="button"
              className="text-xs font-medium text-[#9d5637] underline underline-offset-2 hover:text-[#7d442f]"
              onClick={() => {
                setEditing(true);
                if (!hasOverride && average != null && average !== '') {
                  onOverrideChange({
                    target: { value: String(average) },
                    currentTarget: { value: String(average) },
                  } as ChangeEvent<HTMLInputElement>);
                }
              }}
            >
              {hasOverride ? 'Edit override' : 'Override'}
            </button>
          )}
        </span>
      </div>
      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <input
            aria-label="Reviewed water temperature override"
            type="number"
            min="-100"
            step="any"
            value={overrideValue ?? ''}
            onChange={onOverrideChange}
            className="w-full rounded border border-stone-200 bg-white px-2 py-1 font-mono text-sm font-semibold text-[#263746] outline-none transition focus:border-[#b86843] focus:ring-2 focus:ring-[#b86843]/25"
          />
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-[#9d5637] underline underline-offset-2 hover:text-[#7d442f]"
            onClick={() => {
              setEditing(false);
              onOverrideChange({
                target: { value: '' },
                currentTarget: { value: '' },
              } as ChangeEvent<HTMLInputElement>);
            }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

export function EffectiveRadiantSurroundingsTemperature({
  ambientValue,
  overrideValue,
  onOverrideChange,
  disabled = false,
}: {
  ambientValue?: number | string | null;
  overrideValue?: number | string | null;
  onOverrideChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const hasOverride = overrideValue !== '' && overrideValue != null;
  const effectiveValue = hasOverride ? overrideValue : ambientValue;

  return (
    <div className="mt-2 text-xs text-[#718894]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>Effective Radiant Surroundings Temperature:</span>
        <span className="font-mono font-medium text-[#456b7d]">
          {thermalNumber(effectiveValue, 1)} °C
        </span>
        {!disabled && !editing && (
          <button
            type="button"
            className="font-medium text-[#9d5637] underline underline-offset-2 hover:text-[#7d442f]"
            onClick={() => {
              setEditing(true);
              if (!hasOverride && ambientValue != null && ambientValue !== '') {
                onOverrideChange({
                  target: { value: String(ambientValue) },
                  currentTarget: { value: String(ambientValue) },
                } as ChangeEvent<HTMLInputElement>);
              }
            }}
          >
            {hasOverride ? 'Edit override' : 'Override'}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-1 flex max-w-sm items-center gap-2">
          <input
            aria-label="Effective Radiant Surroundings Temperature override"
            type="number"
            min="-100"
            step="any"
            value={overrideValue ?? ''}
            onChange={onOverrideChange}
            className="w-full rounded border border-[#c7d1d4] bg-[#fbfaf7] px-2 py-1 font-mono text-sm font-semibold text-[#263746] outline-none transition focus:border-[#b86843] focus:ring-2 focus:ring-[#b86843]/25"
          />
          <button
            type="button"
            className="shrink-0 font-medium text-[#9d5637] underline underline-offset-2 hover:text-[#7d442f]"
            onClick={() => {
              setEditing(false);
              onOverrideChange({
                target: { value: '' },
                currentTarget: { value: '' },
              } as ChangeEvent<HTMLInputElement>);
            }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function thermalWallDate(value: unknown) {
  return value ? new Date(String(value)).toLocaleString() : '—';
}

export function ThermalWallConstructionLibrary({
  approvedDefaults,
  canManageLibrary,
  onRefresh,
}: {
  approvedDefaults: any[];
  canManageLibrary: boolean;
  onRefresh: () => void;
}) {
  const [showWallLibrary, setShowWallLibrary] = useState(false);
  const [wallLibrarySaving, setWallLibrarySaving] = useState(false);
  const [pendingWallApproval, setPendingWallApproval] = useState<{
    current: any;
    replacement: ThermalWallForm;
  } | null>(null);
  const [wallForm, setWallForm] = useState<ThermalWallForm>(() =>
    thermalWallFormFrom(approvedDefaults[0]),
  );
  const {
    data: wallLibrary,
    isFetching: wallLibraryLoading,
    isError: wallLibraryError,
    refetch: refetchWallLibrary,
  } = useQuery({
    queryKey: ['thermal-wall-construction-history'],
    queryFn: () => api.get('/thermal-wall-constructions/history').then(response => response.data),
    enabled: showWallLibrary && canManageLibrary,
  });
  const wallItems: any[] = wallLibrary?.items || [];
  const currentWallItems = wallItems.filter(item => item.approval?.status === 'approved');
  const visibleCurrentWallItems = currentWallItems.length
    ? currentWallItems
    : approvedDefaults;
  const wallFormValid = thermalWallReplacementIsValid(wallForm);
  const fieldClass = 'w-full rounded-lg border border-stone-200 px-3 py-2 text-sm bg-white disabled:bg-stone-50 disabled:text-stone-500';
  const labelClass = 'block text-xs font-medium text-stone-600 mb-1';

  const selectWallConstruction = (code: string) => {
    const construction = wallItems.find(item =>
      (item.code || item.construction_code) === code &&
      (item.approval?.status || item.status) === 'approved',
    ) || approvedDefaults.find(item => item.code === code);
    setWallForm(thermalWallFormFrom(construction));
  };

  const requestWallApproval = () => {
    if (!wallFormValid) return;
    const current = wallItems.find(item =>
      (item.code || item.construction_code) === wallForm.construction_code &&
      item.approval?.status === 'approved',
    ) || approvedDefaults.find(item => item.code === wallForm.construction_code);
    if (!current) {
      toast.error('Select a current approved wall construction before approving a replacement.');
      return;
    }
    setPendingWallApproval({ current, replacement: { ...wallForm } });
  };

  const approveWallReplacement = async () => {
    if (!pendingWallApproval) return;
    const { current, replacement } = pendingWallApproval;
    setWallLibrarySaving(true);
    try {
      await api.post(`/thermal-wall-constructions/${replacement.construction_code}/versions`, {
        expected_current_id: current.id,
        construction_label: replacement.construction_label,
        material: replacement.material,
        conductivity_w_m_k: Number(replacement.conductivity_w_m_k),
        source_basis: replacement.source_basis,
        source_reference: replacement.source_reference,
        version: replacement.version,
        notes: replacement.notes,
      });
      await refetchWallLibrary();
      onRefresh();
      setPendingWallApproval(null);
      setWallForm(currentForm => ({ ...currentForm, version: '', notes: '' }));
      toast.success(`${replacement.construction_code} ${replacement.version} approved`);
    } catch (error: any) {
      if (error?.response?.data?.error?.code === 'THERMAL_WALL_CONSTRUCTION_CHANGED') {
        await refetchWallLibrary();
        setPendingWallApproval(null);
      }
      toast.error(error?.response?.data?.error?.message || 'Unable to approve wall construction version');
    } finally {
      setWallLibrarySaving(false);
    }
  };

  return (
    <>
      {pendingWallApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-stone-200 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#456b7d]">Approve Thermal wall replacement</p>
              <h2 className="mt-1 text-lg font-bold text-stone-900">Review the successor before it is published</h2>
              <p className="mt-1 text-sm text-stone-500">
                This approval will make the replacement the current default. Existing Design Book calculation, review, and release snapshots are not rewritten.
              </p>
            </div>
            <div className="space-y-4 bg-stone-50/60 p-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Version being superseded</p>
                    <p className="mt-1 font-semibold text-amber-950">
                      {pendingWallApproval.current.label} · {pendingWallApproval.current.basis_version || pendingWallApproval.current.version}
                    </p>
                    <p className="mt-1 text-sm text-amber-900">
                       {pendingWallApproval.current.material} · {pendingWallApproval.current.conductivity_w_m_k} {pendingWallApproval.current.conductivity_units || 'W/m·K'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-[#c7d8df] bg-[#edf3f4] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#456b7d]">Replacement to approve</p>
                <p className="mt-1 font-semibold text-[#263746]">
                  {pendingWallApproval.replacement.construction_label} · {pendingWallApproval.replacement.version}
                </p>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm text-[#263746] sm:grid-cols-2">
                  <div><dt className="inline text-[#456b7d]">Material: </dt><dd className="inline">{pendingWallApproval.replacement.material}</dd></div>
                  <div><dt className="inline text-[#456b7d]">Conductivity: </dt><dd className="inline">{pendingWallApproval.replacement.conductivity_w_m_k} W/m·K</dd></div>
                  <div><dt className="inline text-[#456b7d]">Source: </dt><dd className="inline">{pendingWallApproval.replacement.source_basis} · {pendingWallApproval.replacement.source_reference}</dd></div>
                </dl>
                {pendingWallApproval.replacement.notes && (
                  <p className="mt-2 border-t border-[#c7d8df] pt-2 text-sm text-[#456b7d]">
                    <span className="font-medium">Notes:</span> {pendingWallApproval.replacement.notes}
                  </p>
                )}
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-[#c7d8df] bg-[#e8f0f2] px-3 py-2 text-xs text-[#456b7d]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Approval actor and timestamp are recorded automatically from the signed-in engineering administrator.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-stone-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setPendingWallApproval(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
                Cancel
              </button>
              <Button type="button" onClick={approveWallReplacement} variant="thermal" disabled={wallLibrarySaving}>
                {wallLibrarySaving ? 'Approving…' : 'Confirm approval'}
              </Button>
            </div>
          </div>
        </div>
      )}
      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-stone-900">
              <Layers className="h-4 w-4 text-[#456b7d]" />
              Thermal wall material conductivity
            </div>
            <div className="text-xs text-stone-500">
               {visibleCurrentWallItems.length} current approved material{visibleCurrentWallItems.length === 1 ? '' : 's'}.
               Conductivity is versioned; tank thickness comes from each exhibit tank.
            </div>
          </div>
          {canManageLibrary && (
            <button
              type="button"
              onClick={() => setShowWallLibrary(value => !value)}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
               {showWallLibrary ? 'Close material library' : 'Manage conductivity'}
            </button>
          )}
        </div>
        <div className="grid gap-3 border-t border-stone-100 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          {visibleCurrentWallItems.map(item => (
            <div key={item.id || item.code} className="rounded-lg bg-stone-50 px-3 py-2">
              <div className="text-xs font-semibold text-stone-700">{item.label || item.construction_label}</div>
               <div className="mt-1 text-xs text-stone-500">{item.material} · k {item.conductivity_w_m_k} W/m·K</div>
              <div className="mt-1 text-[11px] text-stone-400">{item.basis_version || item.version}</div>
            </div>
          ))}
          {!visibleCurrentWallItems.length && <p className="text-sm text-stone-500">No approved wall construction defaults are available.</p>}
        </div>
        {showWallLibrary && canManageLibrary && (
          <div className="space-y-5 border-t border-stone-200 p-4">
            <div>
              <div className="flex items-center gap-2 font-semibold text-stone-900">
                <LibraryBig className="h-4 w-4 text-[#456b7d]" />
                 Approved and superseded conductivity history
              </div>
              <p className="mt-1 text-xs text-stone-500">Review source evidence and approval metadata before adding a successor version.</p>
            </div>
            {wallLibraryLoading ? (
              <div className="py-6 text-center text-sm text-stone-500">Loading wall construction history…</div>
            ) : wallLibraryError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Unable to load wall construction history.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-stone-200">
                <table className="min-w-[900px] w-full text-left text-xs">
                  <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Material / version</th>
                      <th className="px-3 py-2">Conductivity</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Approval metadata</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {wallItems.map(item => (
                      <tr key={item.id} className="align-top">
                        <td className="px-3 py-3">
                          <div className="font-semibold text-stone-800">{item.label} · {item.basis_version}</div>
                          <div className="mt-1 font-mono text-stone-400">{item.code}</div>
                        </td>
                        <td className="px-3 py-3 text-stone-600">
                          <div>{item.material}</div>
                           <div className="mt-1">k {item.conductivity_w_m_k} {item.conductivity_units}</div>
                        </td>
                        <td className="max-w-[220px] px-3 py-3 text-stone-600">
                          <div>{item.source_basis}</div>
                          <div className="mt-1 text-stone-400">{item.source_reference}</div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${
                            item.approval?.status === 'approved'
                             ? 'border-[#c7d8df] bg-[#dfeaf0] text-[#456b7d]'
                              : 'border-stone-200 bg-stone-100 text-stone-600'
                          }`}>
                            {item.approval?.status === 'approved' ? 'Approved' : 'Superseded'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-stone-600">
                          <div>Approved {thermalWallDate(item.approval?.approved_at)}</div>
                          <div className="mt-1 text-stone-400">{item.approval?.approved_by_name || item.approval?.approved_by_email || item.approval?.approved_by || 'Recorded approver'}</div>
                          {item.approval?.status === 'superseded' && (
                            <div className="mt-2 border-t border-stone-100 pt-2">
                              <div>Superseded {thermalWallDate(item.approval?.superseded_at)}</div>
                              <div className="mt-1 text-stone-400">{item.approval?.superseded_by_name || item.approval?.superseded_by_email || item.approval?.superseded_by || 'Recorded actor'}</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!wallItems.length && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-stone-500">No wall construction history is available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="rounded-xl border border-[#e6c8b8] bg-[#f7eee8] p-4">
              <div className="flex items-start gap-2">
                <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#b86843]" />
                <div>
                  <p className="text-sm font-semibold text-[#263746]">Approve a replacement version</p>
                  <p className="mt-1 text-xs text-[#9d6337]">The new version is additive. The currently approved version will be shown for confirmation and marked superseded atomically.</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label><span className={labelClass}>Construction</span>
                  <select aria-label="Wall construction" value={wallForm.construction_code} onChange={event => selectWallConstruction(event.target.value)} className={fieldClass}>
                    <option value="">Select construction</option>
                    {(currentWallItems.length ? currentWallItems : approvedDefaults).map(item => (
                      <option key={item.id || item.code} value={item.code}>{item.code} · {item.label}</option>
                    ))}
                  </select>
                </label>
                <label><span className={labelClass}>Construction label</span><input value={wallForm.construction_label} onChange={event => setWallForm(current => ({ ...current, construction_label: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>New version</span><input value={wallForm.version} onChange={event => setWallForm(current => ({ ...current, version: event.target.value }))} className={fieldClass} placeholder="AAT_FOUNDATIONS_WALL_V2.0" /></label>
                <label><span className={labelClass}>Material</span><input value={wallForm.material} onChange={event => setWallForm(current => ({ ...current, material: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Conductivity (W/m·K)</span><input type="number" min="0" step="any" value={wallForm.conductivity_w_m_k} onChange={event => setWallForm(current => ({ ...current, conductivity_w_m_k: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Source / standard</span><input value={wallForm.source_basis} onChange={event => setWallForm(current => ({ ...current, source_basis: event.target.value }))} className={fieldClass} /></label>
                <label><span className={labelClass}>Source version / reference</span><input value={wallForm.source_reference} onChange={event => setWallForm(current => ({ ...current, source_reference: event.target.value }))} className={fieldClass} /></label>
              </div>
              <label className="mt-3 block"><span className={labelClass}>Engineering notes</span><textarea rows={2} value={wallForm.notes} onChange={event => setWallForm(current => ({ ...current, notes: event.target.value }))} className={`${fieldClass} resize-none`} placeholder="Record the basis for this successor version…" /></label>
              {!wallFormValid && (
                 <p className="mt-2 text-xs text-red-700">Complete the construction, version, material, source fields and enter a positive conductivity value.</p>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-[#9d6337]">Approval actor and time are captured from the signed-in account.</p>
                <Button type="button" onClick={requestWallApproval} variant="thermal" disabled={wallLibrarySaving || !wallFormValid}>
                  Preview and approve
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export function SurfaceActivityGuidance({
  selectedAgitationClass,
}: {
  selectedAgitationClass?: {
    description?: string;
    guidance?: string;
  } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!selectedAgitationClass) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-xs font-medium text-[#9d5637] underline underline-offset-2 hover:text-[#7d442f]"
        aria-expanded={expanded}
        onClick={() => setExpanded(current => !current)}
      >
        {expanded ? 'Hide details' : 'See more details'}
      </button>
      {expanded && (
        <div className="mt-2 rounded-md border border-[#c7d8df] bg-[#f7faf9] px-3 py-2">
          <p className="text-sm font-medium text-[#263746]">
            {selectedAgitationClass.description ||
              'Select the category that best describes movement at the water surface.'}
          </p>
          <p className="mt-1 text-xs text-[#718894]">
            {selectedAgitationClass.guidance ||
              'These categories describe surface activity and air/water movement—not biological species or tank construction.'}
          </p>
        </div>
      )}
    </div>
  );
}

function LegacyThermalTab({
  book,
  readOnly,
  canManageLibrary,
  onRefresh,
}: {
  book: any;
  readOnly: boolean;
  canManageLibrary: boolean;
  onRefresh: () => void;
}) {
  const items: any[] = book.thermal_calculations || [];
  const constructionDefaults: any[] = (book.thermal_construction_defaults || [])
    .map(normalizeThermalWallConstruction)
    .filter(Boolean);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [pendingSupersede, setPendingSupersede] = useState<any>(null);
  const [approveReplacementAfterConfirmation, setApproveReplacementAfterConfirmation] = useState(false);
  const [classForm, setClassForm] = useState({
    class_code: '', class_name: '', description: '', guidance: '',
  });
  const [versionForm, setVersionForm] = useState({
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
  const { data: correlationLibrary, refetch: refetchCorrelationLibrary } = useQuery({
    queryKey: ['thermal-correlation-library'],
    queryFn: () => api.get('/thermal-correlations').then(response => response.data),
  });
  const correlationItems: any[] = correlationLibrary?.items || [];
  const agitationClasses: any[] = correlationLibrary?.classes || [];
  const {
    data: correlationUsage,
    isFetching: usageLoading,
    isError: usageError,
    refetch: refetchCorrelationUsage,
  } = useQuery({
    queryKey: ['thermal-correlation-usages', pendingSupersede?.id],
    queryFn: () => api.get(`/thermal-correlations/versions/${pendingSupersede.id}/usages`).then(response => response.data),
    enabled: !!pendingSupersede?.id,
  });

  const open = (item: any) => {
    const calculation = item.calculation ||
      item.result_snapshot ||
      item.saved?.result_snapshot ||
      item.current_preview ||
      {};
    const existing = item.saved?.input_snapshot ||
      item.input_snapshot ||
      calculation?.inputs ||
      {};
    const wallEvidence = thermalEvidenceBasis(item).wall || {};
    const sourceTankConstruction = thermalExhibitTankConstruction(item.source, constructionDefaults);
    const sourceTankWallBasis = thermalExhibitTankWallBasis(item.source, constructionDefaults);
    const savedWallHasOverride = existing.reviewed_u_value_w_m2_k != null ||
      Object.values(wallEvidence.layer_override_flags || {}).some(Boolean);
    const savedCustomConstruction = existing.tank_construction_type === '' ||
      existing.tank_construction === '';
    const constructionType = savedCustomConstruction
      ? ''
      : existing.tank_construction_type ||
        existing.tank_construction ||
        sourceTankConstruction?.code ||
        sourceTankWallBasis?.code ||
        wallEvidence.construction_type ||
        '';
    const currentConstructionDefault = constructionDefaults.find(
      (candidate: any) => candidate.code === constructionType,
    );
    const constructionDefault = normalizeThermalWallConstruction(
      (savedWallHasOverride ? existing.tank_wall_default_basis : sourceTankWallBasis) ||
      existing.tank_wall_default_basis ||
      wallEvidence.default_basis ||
      currentConstructionDefault,
    );
    const effectiveWallLayer = (savedWallHasOverride ? existing.tank_wall_layers?.[0] : sourceTankWallBasis) ||
      existing.tank_wall_layers?.[0] ||
      wallEvidence.effective_layers?.[0] ||
      wallEvidence.layers?.[0];
    const effectiveWallValues = thermalWallFormValues(
      effectiveWallLayer || wallEvidence || constructionDefault,
    );
    const correlationSnapshot = existing.agitation_correlation_snapshot ||
      item.calculation?.correlation_snapshot || item.saved?.correlation_snapshot || {};
    const savedAgitationClass = existing.agitation_class ?? existing.agitation_correlation_class ?? '';
    const resolvedCorrelation = correlationItems.find(correlation =>
      correlation.class_code === savedAgitationClass && correlation.status === 'approved',
    );
    const databaseDefaults = correlationSnapshot.database_defaults || {};
    const effectiveValues = correlationSnapshot.effective_values || {};
    const overrides = correlationSnapshot.overrides ||
      existing.agitation_correlation_overrides || {};
    setSelected(item);
    setForm({
      ambient_air_temperature_c: existing.ambient_air_temperature_c ?? '',
      relative_humidity_pct: existing.relative_humidity_pct ?? 60,
       surrounding_surface_temperature_c: existing.surrounding_surface_temperature_c ?? '',
      atmospheric_pressure_kpa: existing.atmospheric_pressure_kpa ?? 101.325,
      reviewed_water_temperature_c:
        existing.reviewed_water_temperature_c ?? existing.water_temperature_c ?? '',
      agitation_class: savedAgitationClass,
      agitation_correlation_class: existing.agitation_correlation_class ?? savedAgitationClass,
      agitation_correlation_id: existing.agitation_correlation_id ?? correlationSnapshot.correlation_id ?? resolvedCorrelation?.id ?? '',
      agitation_correlation_version: existing.agitation_correlation_version ?? resolvedCorrelation?.version ?? '',
      agitation_correlation_approved: existing.agitation_correlation_approved ?? !!resolvedCorrelation,
      agitation_correlation_deviation: existing.agitation_correlation_deviation ?? false,
      evaporation_coefficient_kg_m2_s_kpa:
        effectiveValues.coefficient_kg_m2_s_kpa ??
        existing.evaporation_coefficient_kg_m2_s_kpa ?? '',
      adjacent_lower_class:
        databaseDefaults.lower_agitation_class_code ??
        existing.lower_agitation_class ??
        existing.adjacent_agitation_classes?.[0] ?? '',
      adjacent_lower_coefficient:
        effectiveValues.lower_class_coefficient_kg_m2_s_kpa ??
        existing.lower_class_coefficient_kg_m2_s_kpa ??
        existing.agitation_correlations?.[existing.adjacent_agitation_classes?.[0]]?.coefficient_kg_m2_s_kpa ?? '',
      correlation_adjustment_value:
        effectiveValues.adjustment_value ?? existing.adjustment_value ?? '',
      adjacent_upper_class:
        databaseDefaults.upper_agitation_class_code ??
        existing.upper_agitation_class ??
        existing.adjacent_agitation_classes?.[1] ?? '',
      adjacent_upper_coefficient:
        effectiveValues.upper_class_coefficient_kg_m2_s_kpa ??
        existing.upper_class_coefficient_kg_m2_s_kpa ??
        existing.agitation_correlations?.[existing.adjacent_agitation_classes?.[1]]?.coefficient_kg_m2_s_kpa ?? '',
      agitation_correlation_overrides: overrides,
      reviewed_u_value_w_m2_k: existing.reviewed_u_value_w_m2_k ?? '',
      tank_construction_type: constructionType,
      tank_wall_default_basis: constructionDefault,
      ...effectiveWallValues,
      tank_wall_override_justification:
        existing.tank_wall_override_justification ??
        wallEvidence.layer_override_justification ??
        '',
      equipment_heat_gain_kw: existing.equipment_heat_gain_kw ?? 0,
      lighting_power_kw: existing.lighting_power_kw ?? 0,
      lighting_coupling_pct: existing.lighting_coupling_pct ?? 85,
      water_exchange_enabled: existing.water_exchange_enabled ?? false,
      water_exchange_flow_m3h: existing.water_exchange_flow_m3h ?? '',
      water_exchange_inlet_temperature_c: existing.water_exchange_inlet_temperature_c ?? '',
      capacity_margin_pct: existing.capacity_margin_pct ?? 10,
      deviation_justification: existing.deviation_justification ?? '',
      custom_tank_wall_areas_m2: existing.custom_tank_wall_areas_m2 ?? {},
    });
  };

  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const updateCorrelationOverride = (key: string, formKey: string, value: any) =>
    setForm((current: any) => ({
      ...current,
      [formKey]: value,
      agitation_correlation_overrides: {
        ...(current.agitation_correlation_overrides || {}),
        [key]: true,
      },
    }));
  const numericOrNull = (value: any) => value === '' || value == null ? null : Number(value);
  useEffect(() => {
    if (!selected || !form.agitation_class || form.agitation_correlation_id || !correlationItems.length) return;
    const approvedCorrelation = correlationItems.find(
      item => item.class_code === form.agitation_class && item.status === 'approved',
    );
    if (!approvedCorrelation) return;
    setForm((current: any) => {
      if (current.agitation_correlation_id || current.agitation_class !== form.agitation_class) return current;
      return {
        ...current,
        agitation_correlation_id: approvedCorrelation.id,
        agitation_correlation_version: approvedCorrelation.version,
        agitation_correlation_approved: true,
        ...thermalCorrelationDefaults(approvedCorrelation),
      };
    });
  }, [
    correlationItems,
    form.agitation_class,
    form.agitation_correlation_id,
    selected,
  ]);
  const selectAgitationClass = (classCode: string) => {
    // Correlation versions are platform-governed. Selecting the designer-facing
    // activity class resolves its current approved version without exposing a
    // version picker or relaxing the API's correlation-id requirement.
    const approvedCorrelation = correlationItems.find(
      item => item.class_code === classCode && item.status === 'approved',
    );
    setForm((current: any) => ({
      ...current,
      agitation_class: classCode,
      agitation_correlation_class: classCode,
      agitation_correlation_id: approvedCorrelation?.id || '',
      agitation_correlation_version: approvedCorrelation?.version || '',
      agitation_correlation_approved: !!approvedCorrelation,
      agitation_correlation_deviation: false,
      deviation_justification: '',
      agitation_correlation_overrides: {},
      ...thermalCorrelationDefaults(approvedCorrelation || null),
    }));
  };
  const selectCorrelation = (correlationId: string) => {
    const correlation = correlationItems.find(item => item.id === correlationId);
    if (!correlation) {
      setForm((current: any) => ({ ...current, agitation_correlation_id: '' }));
      return;
    }
    setForm((current: any) => ({
      ...current,
      agitation_correlation_id: correlation.id,
      agitation_class: correlation.class_code,
      agitation_correlation_class: correlation.class_code,
      agitation_correlation_version: correlation.version,
      agitation_correlation_approved: correlation.status === 'approved',
      ...thermalCorrelationDefaults(correlation),
      agitation_correlation_overrides: {},
      agitation_correlation_deviation: false,
      deviation_justification: '',
    }));
  };

  const createAgitationClass = async () => {
    setLibrarySaving(true);
    try {
      const response = await api.post('/thermal-correlations/classes', classForm);
      setVersionForm(current => ({ ...current, class_id: response.data.id }));
      setClassForm({ class_code: '', class_name: '', description: '', guidance: '' });
      await refetchCorrelationLibrary();
      toast.success('Agitation class created');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to create agitation class');
    } finally {
      setLibrarySaving(false);
    }
  };

  const saveCorrelationVersion = async () => {
    setLibrarySaving(true);
    try {
      await api.post(`/thermal-correlations/classes/${versionForm.class_id}/versions`, {
        version: versionForm.version,
        coefficient_kg_m2_s_kpa: numericOrNull(versionForm.coefficient_kg_m2_s_kpa),
        lower_agitation_class_code: versionForm.lower_agitation_class_code,
        lower_agitation_class_name: versionForm.lower_agitation_class_name,
        lower_class_coefficient_kg_m2_s_kpa:
          numericOrNull(versionForm.lower_class_coefficient_kg_m2_s_kpa),
        adjustment_value: numericOrNull(versionForm.adjustment_value),
        adjustment_basis: versionForm.adjustment_basis,
        upper_agitation_class_code: versionForm.upper_agitation_class_code,
        upper_agitation_class_name: versionForm.upper_agitation_class_name,
        upper_class_coefficient_kg_m2_s_kpa:
          numericOrNull(versionForm.upper_class_coefficient_kg_m2_s_kpa),
        source_reference: versionForm.source_reference,
        notes: versionForm.notes,
        impact_token: approveReplacementAfterConfirmation ? correlationUsage?.impact_token : undefined,
      });
      setVersionForm(current => ({
        ...current,
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
      }));
      await refetchCorrelationLibrary();
      toast.success('Approved correlation version added');
      setPendingSupersede(null);
      setApproveReplacementAfterConfirmation(false);
    } catch (error: any) {
      if (error?.response?.data?.error?.code === 'THERMAL_CORRELATION_IMPACT_CHANGED') {
        const refreshedLibrary = await refetchCorrelationLibrary();
        const refreshedCurrent = (refreshedLibrary.data?.items || []).find(
          (item: any) => item.class_id === versionForm.class_id && item.status === 'approved',
        );
        if (!refreshedCurrent) {
          closeCorrelationUsage();
        } else if (refreshedCurrent.id !== pendingSupersede?.id) {
          setPendingSupersede(refreshedCurrent);
        } else {
          await refetchCorrelationUsage();
        }
      }
      toast.error(error?.response?.data?.error?.message || 'Unable to add correlation version');
    } finally {
      setLibrarySaving(false);
    }
  };

  const createCorrelationVersion = async () => {
    if (!versionForm.class_id) return;
    const currentVersion = correlationItems.find(
      item => item.class_id === versionForm.class_id && item.status === 'approved',
    );
    if (currentVersion) {
      setApproveReplacementAfterConfirmation(true);
      setPendingSupersede(currentVersion);
      return;
    }
    await saveCorrelationVersion();
  };

  const requestSupersedeCorrelation = (correlation: any) => {
    setApproveReplacementAfterConfirmation(false);
    setPendingSupersede(correlation);
  };

  const supersedeCorrelation = async () => {
    if (!pendingSupersede) return;
    if (approveReplacementAfterConfirmation) {
      await saveCorrelationVersion();
      return;
    }
    setLibrarySaving(true);
    try {
      await api.post(`/thermal-correlations/versions/${pendingSupersede.id}/supersede`, {
        impact_token: correlationUsage?.impact_token,
      });
      await refetchCorrelationLibrary();
      toast.success(`${pendingSupersede.class_code} ${pendingSupersede.version} superseded`);
      setPendingSupersede(null);
      setApproveReplacementAfterConfirmation(false);
    } catch (error: any) {
      if (error?.response?.data?.error?.code === 'THERMAL_CORRELATION_IMPACT_CHANGED') {
        await refetchCorrelationUsage();
      }
      toast.error(error?.response?.data?.error?.message || 'Unable to supersede correlation');
    } finally {
      setLibrarySaving(false);
    }
  };
  const closeCorrelationUsage = () => {
    setPendingSupersede(null);
    setApproveReplacementAfterConfirmation(false);
  };
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const wallLayers = form.reviewed_u_value_w_m2_k || !form.wall_material ? [] : [{
        material: form.wall_material,
        thickness_mm: numericOrNull(form.wall_thickness_mm),
        conductivity_w_m_k: numericOrNull(form.wall_conductivity_w_m_k),
      }];
      const inputs = {
        ambient_air_temperature_c: numericOrNull(form.ambient_air_temperature_c),
        relative_humidity_pct: numericOrNull(form.relative_humidity_pct),
        surrounding_surface_temperature_c: numericOrNull(form.surrounding_surface_temperature_c),
        atmospheric_pressure_kpa: numericOrNull(form.atmospheric_pressure_kpa),
        ...(form.reviewed_water_temperature_c !== ''
          ? { reviewed_water_temperature_c: numericOrNull(form.reviewed_water_temperature_c) }
          : {}),
        agitation_correlation_id: form.agitation_correlation_id || undefined,
        agitation_class: form.agitation_class,
        agitation_correlation_class: form.agitation_class,
        agitation_correlation_version: form.agitation_correlation_version,
        agitation_correlation_approved: !!form.agitation_correlation_approved,
        agitation_correlation_deviation: !!form.agitation_correlation_deviation,
        evaporation_coefficient_kg_m2_s_kpa: numericOrNull(form.evaporation_coefficient_kg_m2_s_kpa),
        lower_agitation_class: form.adjacent_lower_class || null,
        lower_class_coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_lower_coefficient),
        adjustment_value: numericOrNull(form.correlation_adjustment_value),
        upper_agitation_class: form.adjacent_upper_class || null,
        upper_class_coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_upper_coefficient),
        agitation_correlation_overrides: form.agitation_correlation_overrides || {},
        adjacent_agitation_classes: [form.adjacent_lower_class, form.adjacent_upper_class].filter(Boolean),
        agitation_correlations: {
          [form.agitation_class]: {
            class: form.agitation_class,
            coefficient_kg_m2_s_kpa: numericOrNull(form.evaporation_coefficient_kg_m2_s_kpa),
            version: form.agitation_correlation_version,
            approved: !!form.agitation_correlation_approved,
            deviation: !!form.agitation_correlation_deviation,
          },
          ...(form.adjacent_lower_class ? {
            [form.adjacent_lower_class]: {
              class: form.adjacent_lower_class,
              coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_lower_coefficient),
              version: form.agitation_correlation_version,
              approved: !!form.agitation_correlation_approved,
            },
          } : {}),
          ...(form.adjacent_upper_class ? {
            [form.adjacent_upper_class]: {
              class: form.adjacent_upper_class,
              coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_upper_coefficient),
              version: form.agitation_correlation_version,
              approved: !!form.agitation_correlation_approved,
            },
          } : {}),
        },
        reviewed_u_value_w_m2_k: numericOrNull(form.reviewed_u_value_w_m2_k),
        tank_construction_type: form.tank_construction_type === ''
          ? ''
          : form.tank_construction_type || null,
        tank_wall_layers: wallLayers,
        tank_wall_override_justification: form.tank_wall_override_justification || '',
        equipment_heat_gain_kw: numericOrNull(
          thermalHasEquipmentHeatSources(selected?.source)
            ? selected?.source?.equipment_heat_gain_kw
            : form.equipment_heat_gain_kw,
        ),
        lighting_power_kw: numericOrNull(form.lighting_power_kw),
        lighting_coupling_pct: numericOrNull(form.lighting_coupling_pct),
        water_exchange_enabled: !!form.water_exchange_enabled,
        water_exchange_flow_m3h: numericOrNull(form.water_exchange_flow_m3h),
        water_exchange_inlet_temperature_c: numericOrNull(form.water_exchange_inlet_temperature_c),
        capacity_margin_pct: numericOrNull(form.capacity_margin_pct),
        deviation_justification: form.deviation_justification,
        custom_tank_wall_areas_m2: form.custom_tank_wall_areas_m2,
      };
      const response = await api.put(`/design-books/${book.id}/thermal/${selected.system_id}`, { inputs });
      toast.success(response.data.calculation?.status === 'Ready'
        ? 'Thermal calculation saved and Ready'
        : 'Thermal inputs saved with blockers');
      setSelected(response.data);
      await onRefresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save thermal calculation');
    } finally {
      setSaving(false);
    }
  };

  if (!items.length) {
    return (
      <div className="space-y-4 rounded-2xl bg-[#f3eee6] p-3 sm:p-5">
        <div className="rounded-2xl border border-[#d8d4cb] bg-[#fbfaf7] py-16 text-center">
          <ThermometerSun className="mx-auto mb-3 h-10 w-10 text-[#9aa8af]" />
          <p className="font-semibold text-[#263746]">No LSS systems to calculate</p>
          <p className="mt-1 text-sm text-[#71808a]">Create and link an LSS system first.</p>
        </div>
      </div>
    );
  }

  const detail = selected?.calculation || selected?.current_preview;
  const thermalNetLoad = Number(detail?.results?.net_total_load_kw);
  const thermalActionIsCooling = Number.isFinite(thermalNetLoad) ? thermalNetLoad >= 0 : true;
  const thermalActionLabel = thermalActionIsCooling ? 'Cooling with margin' : 'Heating with margin';
  const thermalActionValue = thermalActionIsCooling
    ? detail?.results?.margin_adjusted_cooling_kw
    : detail?.results?.margin_adjusted_steady_state_heating_kw ??
      (Number(detail?.results?.steady_state_heating_kw || 0) * (1 + Number(form.capacity_margin_pct || 0) / 100));
  const hasEquipmentHeatSources = thermalHasEquipmentHeatSources(selected?.source);
  const evidenceBasis = thermalEvidenceBasis(selected || detail);
  const wallBasisChange = thermalWallBasisChange(selected || detail);
  const selectedConstructionDefault = normalizeThermalWallConstruction(
    form.tank_wall_default_basis ||
    constructionDefaults.find(item => item.code === form.tank_construction_type) ||
    (evidenceBasis.wall?.material ? evidenceBasis.wall : null),
  );
  const wallOverrideFlags = thermalWallOverrideFlags(form, selectedConstructionDefault);
  const hasWallLayerOverride = Object.values(wallOverrideFlags).some(Boolean);
  const selectedAgitationClass = agitationClasses.find(
    item => item.class_code === form.agitation_class,
  );
  const selectedCorrelation = correlationItems.find(
    item => item.id === form.agitation_correlation_id,
  );
  const hasCorrelationSensitivityInputs = [
    form.adjacent_lower_class,
    form.adjacent_lower_coefficient,
    form.correlation_adjustment_value,
    form.adjacent_upper_class,
    form.adjacent_upper_coefficient,
  ].some(value => value !== '' && value != null);
  const draftOverridesAllowed = !readOnly && book.status === 'Draft';
  const hasWallUValueOverride = form.reviewed_u_value_w_m2_k !== '' &&
    form.reviewed_u_value_w_m2_k != null;
  const wallThicknessMm = Number(form.wall_thickness_mm);
  const wallConductivity = Number(form.wall_conductivity_w_m_k);
  const governedWallUValue = wallThicknessMm > 0 && wallConductivity > 0
    ? 1 / (1 / 150 + wallThicknessMm / 1000 / wallConductivity + 1 / 5)
    : selectedConstructionDefault?.u_value_w_m2_k ??
      evidenceBasis.wall?.u_value_w_m2_k ?? '';
  const wallUValueOverrideAllowed = draftOverridesAllowed &&
    (governedWallUValue !== '' || hasWallUValueOverride);
  const wallThicknessInfo = wallThicknessMm > 0
    ? `${form.wall_material || selectedConstructionDefault?.material || 'Wall'} thickness: ${thermalNumber(wallThicknessMm, 2)} mm · k ${thermalNumber(wallConductivity, 3)} W/m·K`
    : undefined;
  const mainCorrelationOverrideAllowed = draftOverridesAllowed && !!form.agitation_correlation_id;
  const fieldClass = thermalFieldClass;
  const labelClass = thermalLabelClass;

  return (
    <div className="space-y-5 rounded-2xl bg-[#f3eee6] p-3 text-[#263746] sm:p-5">
      {pendingSupersede && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Correlation usage
                </p>
                <h2 className="mt-1 text-lg font-bold text-stone-900">
                  {pendingSupersede.class_code} · {pendingSupersede.version}
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  {correlationUsage?.correlation?.usage_count ?? pendingSupersede.usage_count ?? 0} captured thermal calculation(s)
                </p>
              </div>
              <button
                type="button"
                onClick={closeCorrelationUsage}
                aria-label="Close correlation usage"
                className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {pendingSupersede.status === 'approved' && (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {approveReplacementAfterConfirmation
                      ? `Approving ${versionForm.version || 'the replacement version'} will supersede this current version. `
                      : 'Superseding stops new calculations from selecting this version. '}
                    The saved review and release snapshots listed below remain unchanged and may be reviewed voluntarily.
                  </p>
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto bg-stone-50/50 p-5">
              {usageLoading ? (
                <div className="py-12 text-center text-sm text-stone-500">Loading captured usage…</div>
              ) : usageError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Unable to load the captured usage. Close this dialog and try again.
                </div>
              ) : (
                <ThermalCorrelationUsageList usages={correlationUsage?.usages || []} />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-stone-200 bg-white px-5 py-4">
              <button
                type="button"
                onClick={closeCorrelationUsage}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                {pendingSupersede.status === 'approved' ? 'Cancel' : 'Close'}
              </button>
              {pendingSupersede.status === 'approved' && (
                <Button
                  type="button"
                  onClick={supersedeCorrelation}
                  variant="thermal"
                  disabled={librarySaving || usageLoading || usageError}
                >
                  {librarySaving
                    ? approveReplacementAfterConfirmation ? 'Approving…' : 'Superseding…'
                    : approveReplacementAfterConfirmation ? 'Confirm and approve version' : 'Confirm supersede'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-[#c7d8df] bg-[#e8f0f2] px-4 py-3 text-sm text-[#456b7d]">
        Positive contribution values add heat to water; negative values remove heat. LSS circulation is shown only as reference and is never counted as water exchange.
      </div>
      {canManageLibrary && <div className="rounded-xl border border-[#d8d4cb] bg-[#fbfaf7]">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="font-semibold text-[#263746]">Platform Admin · evaporation correlation library</div>
            <div className="text-xs text-stone-500">
              {correlationItems.filter(item => item.status === 'approved').length} current approved version(s).
              Saved calculations retain an exact snapshot when a version is superseded.
            </div>
          </div>
          {canManageLibrary && (
            <button
              type="button"
              onClick={() => setShowLibrary(value => !value)}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              {showLibrary ? 'Close library' : 'Manage library'}
            </button>
          )}
        </div>
        {showLibrary && canManageLibrary && (
          <div className="border-t border-stone-200 p-4 space-y-5">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.5fr_1.5fr_auto]">
              <label><span className={labelClass}>Class code</span><input value={classForm.class_code} onChange={event => setClassForm(current => ({ ...current, class_code: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Class name</span><input value={classForm.class_name} onChange={event => setClassForm(current => ({ ...current, class_name: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Description</span><input value={classForm.description} onChange={event => setClassForm(current => ({ ...current, description: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Selection guidance</span><input value={classForm.guidance} onChange={event => setClassForm(current => ({ ...current, guidance: event.target.value }))} className={fieldClass} /></label>
              <Button type="button" onClick={createAgitationClass} variant="thermal" size="sm" disabled={librarySaving || !classForm.class_code.trim() || !classForm.class_name.trim()} className="self-end">Add class</Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1.5fr_auto]">
              <label>
                <span className={labelClass}>Agitation class</span>
                <select value={versionForm.class_id} onChange={event => setVersionForm(current => ({ ...current, class_id: event.target.value }))} className={fieldClass}>
                  <option value="">Select class</option>
                  {agitationClasses.filter(item => item.is_active).map(item => <option key={item.id} value={item.id}>{item.class_code} · {item.class_name}</option>)}
                </select>
              </label>
              <label><span className={labelClass}>New version</span><input value={versionForm.version} onChange={event => setVersionForm(current => ({ ...current, version: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Coefficient (kg/m²·s·kPa)</span><input type="number" min="0" step="any" value={versionForm.coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Approval source / reference</span><input value={versionForm.source_reference} onChange={event => setVersionForm(current => ({ ...current, source_reference: event.target.value }))} className={fieldClass} /></label>
              <Button type="button" onClick={createCorrelationVersion} variant="thermal" size="sm" disabled={librarySaving || !versionForm.class_id || !versionForm.version.trim() || !versionForm.coefficient_kg_m2_s_kpa || !versionForm.source_reference.trim()} className="self-end">Approve version</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label><span className={labelClass}>Lower class code</span><input value={versionForm.lower_agitation_class_code} onChange={event => setVersionForm(current => ({ ...current, lower_agitation_class_code: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Lower class name</span><input value={versionForm.lower_agitation_class_name} onChange={event => setVersionForm(current => ({ ...current, lower_agitation_class_name: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Lower-class coefficient</span><input type="number" min="0" step="any" value={versionForm.lower_class_coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, lower_class_coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Adjustment value</span><input type="number" step="any" value={versionForm.adjustment_value} onChange={event => setVersionForm(current => ({ ...current, adjustment_value: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Adjustment basis</span><input value={versionForm.adjustment_basis} onChange={event => setVersionForm(current => ({ ...current, adjustment_basis: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Upper adjacent class code</span><input value={versionForm.upper_agitation_class_code} onChange={event => setVersionForm(current => ({ ...current, upper_agitation_class_code: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Upper adjacent class name</span><input value={versionForm.upper_agitation_class_name} onChange={event => setVersionForm(current => ({ ...current, upper_agitation_class_name: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Upper-class coefficient</span><input type="number" min="0" step="any" value={versionForm.upper_class_coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, upper_class_coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
            </div>
            {!!correlationItems.length && (
              <div className="overflow-x-auto rounded-xl border border-stone-200">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Class</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Coefficient</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Captured uses</th><th className="px-3 py-2"></th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {correlationItems.map(correlation => (
                      <tr key={correlation.id}>
                        <td className="px-3 py-2 font-medium">{correlation.class_code}</td>
                        <td className="px-3 py-2 font-mono">{correlation.version}</td>
                        <td className="px-3 py-2 font-mono">{correlation.coefficient_kg_m2_s_kpa}</td>
                        <td className="px-3 py-2 text-stone-600">{correlation.source_reference}</td>
                        <td className="px-3 py-2 capitalize">{correlation.status}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => {
                              setApproveReplacementAfterConfirmation(false);
                              setPendingSupersede(correlation);
                            }}
                            className="font-medium text-[#456b7d] hover:text-[#263746] hover:underline"
                          >
                            {correlation.usage_count || 0} · View usage
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {correlation.status === 'approved' && <Button type="button" onClick={() => requestSupersedeCorrelation(correlation)} variant="thermal" size="sm" disabled={librarySaving}>Supersede</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>}
      <section className="overflow-hidden rounded-2xl border border-[#d8d4cb] bg-[#fbfaf7] shadow-[0_14px_36px_rgba(50,52,51,0.06)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#d8d4cb] px-4 py-4 sm:px-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#456b7d]">Thermal systems</p><h2 className="mt-1 text-lg font-bold text-[#263746]">Choose a system to calculate</h2><p className="mt-1 text-sm text-[#71808a]">Start with linked scope and readiness. Details remain focused below.</p></div>
          <span className="shrink-0 rounded-full bg-[#dfeaf0] px-3 py-1 text-xs font-semibold text-[#456b7d]">{items.length} system{items.length === 1 ? '' : 's'}</span>
        </div>
        <div className="divide-y divide-[#e6e1d8]">
              {items.map(item => {
                const calculation = item.calculation;
                const activeDuty = thermalActiveDuty(calculation);
                return (
                  <div key={item.system_id} className={`grid w-full gap-3 px-4 py-4 text-left transition hover:bg-[#edf2f3] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-5 ${selected?.system_id === item.system_id ? 'bg-[#edf2f3]' : ''}`}>
                    <div>
                      <div className="font-semibold text-[#263746]">{item.system?.system_name || 'Unnamed system'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2"><EntityCode code={item.system?.system_code} /><span className="text-xs text-[#71808a]">{item.source?.linked_exhibits?.length || 0} exhibit(s) · {item.source?.linked_tanks?.length || 0} tank(s)</span></div>
                    </div>
                    <div>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        item.status === 'Ready' ? 'border-[#c7d8df] bg-[#dfeaf0] text-[#456b7d]'
                          : item.status === 'Stale' ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                      }`}>{item.status}</span>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      {activeDuty && <div><span className="block text-[11px] uppercase tracking-wide text-[#71808a]">{activeDuty.label}</span><b className="font-mono text-sm text-[#263746]">{thermalNumber(activeDuty.value)} kW</b></div>}
                      <button
                        type="button"
                        onClick={() => open(item)}
                        aria-expanded={selected?.system_id === item.system_id}
                        aria-controls={selected?.system_id === item.system_id ? 'thermal-focused-calculation' : undefined}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#b9c9d0] px-2.5 py-1.5 text-sm font-semibold text-[#456b7d] hover:bg-[#e2ecef]"
                      >
                        {selected?.system_id === item.system_id ? 'Opened' : 'Open'}
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
        </div>
        <div className="border-t border-[#d8d4cb] bg-[#eee9e0] px-4 py-2 text-xs text-[#71808a]"><ShieldCheck className="mr-1 inline h-4 w-4 text-[#456b7d]" />Wall defaults and correlation versions are versioned, governed platform evidence.</div>
      </section>

      {selected && (
        <div id="thermal-focused-calculation" className="space-y-6 rounded-2xl border border-[#d8d4cb] bg-[#fbfaf7] p-5 shadow-[0_14px_36px_rgba(50,52,51,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#456b7d]">Focused calculation</p>
              <h2 className="text-lg font-bold text-[#263746]">{selected.system?.system_code} · {selected.system?.system_name}</h2>
              <p className="mt-1 text-xs text-[#71808a]">Calculation {detail?.calculation_version || 'not saved'} · source fingerprint {String(selected.source_fingerprint || '').slice(0, 12)}…</p>
            </div>
            <button onClick={() => setSelected(null)} aria-label="Close thermal calculation" className="inline-flex items-center gap-1.5 rounded-lg border border-[#b9c9d0] px-3 py-2 text-sm font-semibold text-[#456b7d] hover:bg-[#edf2f3]"><X className="h-4 w-4" /> Close calculation</button>
          </div>
          <div className="grid gap-3 rounded-xl border border-[#c7d8df] bg-[#e8f0f2] p-3 text-sm sm:grid-cols-3">
            <div className="flex gap-2 text-[#456b7d]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="block">Status: {selected.status}</b><small className="text-[#718894]">Readiness from linked sources</small></span></div>
            <div className="flex gap-2 text-[#456b7d]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="block">Evidence preserved</b><small className="text-[#718894]">Snapshots remain immutable</small></span></div>
            <div className="flex gap-2 text-[#456b7d]"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="block">{readOnly ? 'Frozen evidence' : 'Draft controls'}</b><small className="text-[#718894]">{readOnly ? 'Editing is disabled' : 'Save to recalculate'}</small></span></div>
          </div>
          <ThermalWallBasisChangeNotice change={wallBasisChange} />

          <section>
            <h3 className="mb-3 font-semibold text-[#263746]"><span className="mr-2 text-[#9aa8af]">01</span>Linked source and geometry</h3>
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ['Effective volume', `${thermalNumber(detail?.results?.effective_water_volume_m3, 3)} m³`],
                ['Free surface', `${thermalNumber(detail?.results?.free_surface_area_m2)} m²`],
                ['Exposed wall', `${thermalNumber(detail?.results?.exposed_wall_area_m2)} m²`],
                ['LSS circulation (reference)', `${thermalNumber(selected.source?.lss_circulation_flow_m3h)} m³/h`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[#f3efe8] p-3">
                  <div className="text-xs text-[#71808a]">{label}</div><div className="mt-1 font-mono text-sm font-semibold text-[#263746]">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-stone-200 p-3">
                <p className="text-xs font-semibold text-stone-700 mb-2">Exhibits and water-temperature sources</p>
                {(selected.source?.water_temperature_sources || []).map((source: any) => (
                  <div key={source.exhibit_id} className="flex justify-between gap-3 text-sm py-1">
                    <span>{source.exhibit_code || source.exhibit_id}</span>
                    <span className="text-right">
                      <span className="font-mono">{thermalNumber(source.water_temperature_min_c, 1)}–{thermalNumber(source.water_temperature_max_c, 1)} °C</span>
                      {source.water_temperature_range_status &&
                        <span className={`ml-2 text-xs ${source.water_temperature_range_status === 'valid' ? 'text-[#456b7d]' : 'text-red-700'}`}>
                          {source.water_temperature_range_status}
                        </span>}
                    </span>
                  </div>
                ))}
                {evidenceBasis.temperature && (
                  <WaterTemperatureOverrideControl
                    average={evidenceBasis.temperature.average_c}
                    overrideValue={form.reviewed_water_temperature_c}
                    onOverrideChange={event => update('reviewed_water_temperature_c', event.target.value)}
                    disabled={readOnly}
                  />
                )}
              </div>
              <div className="rounded-xl border border-stone-200 p-3">
                <p className="text-xs font-semibold text-stone-700 mb-2">Tank geometry provenance</p>
                {(selected.source?.linked_tanks || []).map((tank: any) => (
                  <div key={tank.tank_id} className="border-b border-stone-100 last:border-0 py-1.5 text-xs">
                    {(() => {
                      const override = Number(form.custom_tank_wall_areas_m2?.[tank.tank_id]);
                      const hasOverride = Number.isFinite(override) && override > 0;
                      const defaultWallArea = customTankWallAreaDefault(tank);
                      const wallSource = hasOverride
                        ? 'manual override (custom tank)'
                        : tank.exposed_wall_source;
                      return (
                        <>
                          <b>{tank.tank_code || tank.tank_id}</b> · volume: {tank.volume_source}; surface: {tank.free_surface_source}; wall: {wallSource}
                          {tank.shape === 'custom' && (
                            <div className="mt-2 space-y-1.5 text-stone-700">
                              <label className="flex flex-wrap items-center gap-2">
                                <span>Reviewed exposed wall area override (m²)</span>
                                <input type="number" min="0" step="any"
                                  value={form.custom_tank_wall_areas_m2?.[tank.tank_id] ?? ''}
                                  placeholder={defaultWallArea == null ? 'No calculated default' : defaultWallArea.toFixed(2)}
                                  onChange={event => update('custom_tank_wall_areas_m2', {
                                    ...(form.custom_tank_wall_areas_m2 || {}),
                                    [tank.tank_id]: event.target.value === '' ? null : Number(event.target.value),
                                  })}
                                  disabled={readOnly}
                                  className="w-28 rounded border border-stone-200 px-2 py-1 disabled:bg-stone-50" />
                              </label>
                              {defaultWallArea != null && (
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                                  <span>Calculated default: <b className="font-mono text-stone-700">{defaultWallArea.toFixed(2)} m²</b></span>
                                  {hasOverride && !readOnly && (
                                    <button
                                      type="button"
                                      onClick={() => update('custom_tank_wall_areas_m2', {
                                        ...(form.custom_tank_wall_areas_m2 || {}),
                                        [tank.tank_id]: null,
                                      })}
                                      className="font-semibold text-[#456b7d] underline underline-offset-2"
                                    >
                                      Use calculated default
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold text-[#263746]"><span className="mr-2 text-[#9aa8af]">02</span>Environment and effective values</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ThermalNumericField name="ambient_air_temperature_c" label="Ambient air temperature" unit="°C"
                value={form.ambient_air_temperature_c} onChange={event => update('ambient_air_temperature_c', event.target.value)} disabled={readOnly} />
              <ThermalNumericField name="relative_humidity_pct" label="Relative humidity" unit="%"
                value={form.relative_humidity_pct} onChange={event => update('relative_humidity_pct', event.target.value)} disabled={readOnly} />
              <ThermalNumericField name="atmospheric_pressure_kpa" label="Atmospheric pressure" unit="kPa"
                value={form.atmospheric_pressure_kpa} onChange={event => update('atmospheric_pressure_kpa', event.target.value)} disabled={readOnly} />
              <div className="sm:col-span-2">
                 <label htmlFor="surface-activity-class" className={labelClass}>Surface-activity class (required)</label>
                 <select id="surface-activity-class" aria-label="Surface-activity class" value={form.agitation_class || ''}
                  onChange={event => selectAgitationClass(event.target.value)}
                  disabled={readOnly} required className={fieldClass}>
                  <option value="">Select surface activity</option>
                  {agitationClasses.filter(item => item.is_active ||
                    item.class_code === form.agitation_class).map(item => (
                    <option key={item.id} value={item.class_code}>{item.class_name}</option>
                  ))}
                </select>
                 <EffectiveRadiantSurroundingsTemperature
                   ambientValue={form.ambient_air_temperature_c}
                   overrideValue={form.surrounding_surface_temperature_c}
                   onOverrideChange={event => update('surrounding_surface_temperature_c', event.target.value)}
                   disabled={readOnly}
                 />
                <SurfaceActivityGuidance
                  key={form.agitation_class || 'no-surface-activity'}
                  selectedAgitationClass={selectedAgitationClass}
                />
               </div>
              <MassTransferCoefficientControl
                value={form.evaporation_coefficient_kg_m2_s_kpa}
                overridden={!!form.agitation_correlation_deviation}
                canOverride={mainCorrelationOverrideAllowed}
                onChange={event => update('evaporation_coefficient_kg_m2_s_kpa', event.target.value)}
                onOverride={() => update('agitation_correlation_deviation', true)}
                onReset={() => setForm((current: any) => ({
                  ...current,
                  agitation_correlation_deviation: false,
                  evaporation_coefficient_kg_m2_s_kpa:
                    selectedCorrelation?.coefficient_kg_m2_s_kpa ?? '',
                  deviation_justification: '',
                }))}
              />
            </div>
            {!form.agitation_correlation_id && form.agitation_class && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                No approved correlation is available for this surface-activity class. Ask an engineering administrator to approve a version before this calculation can be saved.
              </div>
            )}
            {hasCorrelationSensitivityInputs && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label><span className={labelClass}>Lower surface-activity class</span><input value={form.adjacent_lower_class || ''} disabled className={fieldClass} /></label>
                <label>
                  <span className={labelClass}>Lower-class coefficient (kg/m²·s·kPa){form.agitation_correlation_overrides?.lower_class_coefficient_kg_m2_s_kpa && ' · Override'}</span>
                  <input aria-label="Lower-class coefficient" type="number" min="0" step="any"
                    value={form.adjacent_lower_coefficient ?? ''}
                    onChange={event => updateCorrelationOverride('lower_class_coefficient_kg_m2_s_kpa', 'adjacent_lower_coefficient', event.target.value)}
                    disabled={!draftOverridesAllowed || !form.agitation_correlation_id} className={fieldClass} />
                </label>
                <label>
                  <span className={labelClass}>Correlation adjustment{form.agitation_correlation_overrides?.adjustment_value && ' · Override'}</span>
                  <input aria-label="Correlation adjustment" type="number" step="any"
                    value={form.correlation_adjustment_value ?? ''}
                    onChange={event => updateCorrelationOverride('adjustment_value', 'correlation_adjustment_value', event.target.value)}
                    disabled={!draftOverridesAllowed || !form.agitation_correlation_id} className={fieldClass} />
                </label>
                <label><span className={labelClass}>Upper adjacent class</span><input value={form.adjacent_upper_class || ''} disabled className={fieldClass} /></label>
                <label>
                  <span className={labelClass}>Upper-class coefficient (kg/m²·s·kPa){form.agitation_correlation_overrides?.upper_class_coefficient_kg_m2_s_kpa && ' · Override'}</span>
                  <input aria-label="Upper-class coefficient" type="number" min="0" step="any"
                    value={form.adjacent_upper_coefficient ?? ''}
                    onChange={event => updateCorrelationOverride('upper_class_coefficient_kg_m2_s_kpa', 'adjacent_upper_coefficient', event.target.value)}
                    disabled={!draftOverridesAllowed || !form.agitation_correlation_id} className={fieldClass} />
                </label>
              </div>
            )}
            <div className="space-y-3 rounded-xl border border-[#d8d4cb] bg-[#faf9f5] p-4">
              <div>
                <h4 className="text-sm font-semibold text-[#263746]">Wall calculations by exhibit tank</h4>
                <p className="mt-1 text-xs text-[#71808a]">
                  Each tank is calculated separately. Material and thickness come from the exhibit tank; conductivity comes from the governed material library. No average U-value is used.
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Exhibit / tank</th>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2 text-right">Thickness</th>
                      <th className="px-3 py-2 text-right">k</th>
                      <th className="px-3 py-2 text-right">R material</th>
                      <th className="px-3 py-2 text-right">U material</th>
                      <th className="px-3 py-2 text-right">U overall</th>
                      <th className="px-3 py-2 text-right">Wall load</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {(detail?.results?.tank_wall_calculations || []).map((wall: any) => (
                      <tr key={wall.tank_id || `${wall.exhibit_id}-${wall.tank_code}`}>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-stone-800">{wall.exhibit_code || wall.exhibit_id || 'Unassigned exhibit'}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-stone-500">{wall.tank_code || wall.tank_id}</div>
                        </td>
                        <td className="px-3 py-3 text-stone-700">{wall.material || 'Missing'}</td>
                        <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.thickness_mm, 2)} mm</td>
                        <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.conductivity_w_m_k, 3)} W/m·K</td>
                        <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.material_resistance_m2_k_w, 4)} m²K/W</td>
                        <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.material_u_value_w_m2_k, 2)} W/m²K</td>
                        <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.overall_u_value_w_m2_k, 2)} W/m²K</td>
                        <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.wall_conduction_kw, 2)} kW</td>
                      </tr>
                    ))}
                    {!(detail?.results?.tank_wall_calculations || []).length && (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-stone-500">Save the calculation to resolve each linked tank wall.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[#71808a]">
                Update material or thickness on the exhibit tank. Update governed conductivity in Platform Admin → Thermal Wall Materials.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold text-stone-900">Operational gains and capacity</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ThermalNumericField name="equipment_heat_gain_kw"
                label={hasEquipmentHeatSources ? 'Calculated equipment total' : 'Equipment heat gain'} unit="kW"
                value={hasEquipmentHeatSources ? selected?.source?.equipment_heat_gain_kw ?? form.equipment_heat_gain_kw : form.equipment_heat_gain_kw}
                onChange={event => update('equipment_heat_gain_kw', event.target.value)}
                disabled={readOnly || hasEquipmentHeatSources} />
              <ThermalNumericField name="lighting_power_kw" label="Lighting power" unit="kW"
                value={form.lighting_power_kw} onChange={event => update('lighting_power_kw', event.target.value)} disabled={readOnly} />
              <ThermalNumericField name="lighting_coupling_pct" label="Lighting-to-water coupling" unit="%"
                value={form.lighting_coupling_pct} onChange={event => update('lighting_coupling_pct', event.target.value)} disabled={readOnly} />
              <ThermalNumericField name="capacity_margin_pct" label="Capacity margin" unit="%"
                value={form.capacity_margin_pct} onChange={event => update('capacity_margin_pct', event.target.value)} disabled={readOnly} />
            </div>
            {hasEquipmentHeatSources && <EquipmentHeatGainBreakdown source={selected?.source} />}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.water_exchange_enabled} onChange={e => update('water_exchange_enabled', e.target.checked)} disabled={readOnly} />
              Count an explicit operational water exchange (not LSS circulation)
            </label>
            {form.water_exchange_enabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ThermalNumericField name="water_exchange_flow_m3h" label="Water-exchange flow" unit="m³/h"
                  value={form.water_exchange_flow_m3h} onChange={event => update('water_exchange_flow_m3h', event.target.value)} disabled={readOnly} />
                <ThermalNumericField name="water_exchange_inlet_temperature_c" label="Exchange inlet temperature" unit="°C"
                  value={form.water_exchange_inlet_temperature_c} onChange={event => update('water_exchange_inlet_temperature_c', event.target.value)} disabled={readOnly} />
              </div>
            )}
            <label><span className={labelClass}>Deviation or override justification</span>
              <textarea rows={2} value={form.deviation_justification || ''} onChange={e => update('deviation_justification', e.target.value)}
                disabled={readOnly} className={`${fieldClass} resize-none`} />
            </label>
          </section>

          {detail?.reasons?.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-800"><AlertTriangle className="w-4 h-4" /> Action required</div>
              <ul className="list-disc pl-5 mt-2 text-sm text-red-700 space-y-1">
                {detail.reasons.map((reason: string, index: number) => (
                  <li key={`${selected?.system_id || 'system'}:${index}:${reason}`}>{reason}</li>
                ))}
              </ul>
               <ThermalFreshnessDiagnostics item={selected} />
            </div>
          )}

          {detail?.results && (
            <>
              <section>
                <h3 className="font-semibold text-stone-900 mb-3">Signed contributions</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(detail.contributions || {}).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-stone-200 px-3 py-2">
                      <div className="text-xs text-stone-500">{key.replace(/_/g, ' ').replace(' kw', '')}</div>
                      <div className={`font-mono font-semibold ${Number(value) > 0 ? 'text-red-700' : Number(value) < 0 ? 'text-[#456b7d]' : 'text-stone-700'}`}>{thermalNumber(value)} kW</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-3 mt-3">
                  {[
                    ['Net envelope', detail.results.net_envelope_kw],
                    ['Total load', detail.results.net_total_load_kw],
                    [thermalActionLabel, thermalActionValue],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-stone-900 text-white px-4 py-3">
                      <div className="text-xs text-stone-300">{label}</div><div className="font-mono text-lg font-bold">{thermalNumber(value)} kW</div>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="font-semibold text-stone-900 mb-2">Sensitivity comparison</h3>
                <div className="overflow-x-auto rounded-xl border border-stone-200">
                  <table className="w-full text-sm"><thead className="bg-stone-50"><tr><th className="text-left px-3 py-2">Case</th><th className="text-right px-3 py-2">Cooling</th><th className="text-right px-3 py-2">Heating</th></tr></thead>
                    <tbody className="divide-y divide-stone-100">{(detail.sensitivity_summary?.cases || []).map((item: any) => (
                      <tr key={item.case_key} className={detail.sensitivity_summary?.recommended_case === item.case_key ? 'bg-amber-50' : ''}>
                        <td className="px-3 py-2">{item.description}{detail.sensitivity_summary?.recommended_case === item.case_key && <span className="ml-2 text-xs font-semibold text-amber-700">Conservative sizing case</span>}</td>
                        <td className="px-3 py-2 text-right font-mono">{thermalNumber(item.margin_adjusted_cooling_kw)} kW</td>
                        <td className="px-3 py-2 text-right font-mono">{thermalNumber(item.margin_adjusted_steady_state_heating_kw)} kW</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-[#d8d4cb] pt-4">
            <button onClick={() => setSelected(null)} className="px-3 py-2 text-sm font-medium text-[#456b7d]">Close calculation</button>
            {!readOnly && <Button onClick={save} variant="thermal" disabled={saving || !form.agitation_correlation_id}><Calculator className="mr-1.5 h-4 w-4" />{saving ? 'Calculating…' : 'Save & recalculate'}</Button>}
          </div>
          {readOnly && <p className="text-xs text-stone-500 text-right">This calculation is part of the frozen Design Book package and is read-only.</p>}
        </div>
      )}
    </div>
  );
}
function ThermalTab({
  book,
  readOnly,
  canManageLibrary,
  onRefresh,
}: {
  book: any;
  readOnly: boolean;
  canManageLibrary: boolean;
  onRefresh: () => void;
}) {
  const items: any[] = book.thermal_calculations || [];
  const constructionDefaults: any[] = (book.thermal_construction_defaults || [])
    .map(normalizeThermalWallConstruction)
    .filter(Boolean);
  const [selected, setSelected] = useState<any>(null);
  const [selectedWallTankId, setSelectedWallTankId] = useState<string | null>(null);
  const [selectedExhibitKey, setSelectedExhibitKey] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState({
    environment: false,
    linkedSource: false,
    operational: false,
  });
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [pendingSupersede, setPendingSupersede] = useState<any>(null);
  const [approveReplacementAfterConfirmation, setApproveReplacementAfterConfirmation] = useState(false);
  const [classForm, setClassForm] = useState({
    class_code: '', class_name: '', description: '', guidance: '',
  });
  const [versionForm, setVersionForm] = useState({
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
  useEffect(() => {
    if (!selected?.system_id) return;
    const current = items.find(item => item.system_id === selected.system_id);
    if (!current || current === selected) return;
    setSelected(current);
  }, [items, selected?.system_id]);
  const { data: correlationLibrary, refetch: refetchCorrelationLibrary } = useQuery({
    queryKey: ['thermal-correlation-library'],
    queryFn: () => api.get('/thermal-correlations').then(response => response.data),
  });
  const correlationItems: any[] = correlationLibrary?.items || [];
  const agitationClasses: any[] = correlationLibrary?.classes || [];
  const {
    data: correlationUsage,
    isFetching: usageLoading,
    isError: usageError,
    refetch: refetchCorrelationUsage,
  } = useQuery({
    queryKey: ['thermal-correlation-usages', pendingSupersede?.id],
    queryFn: () => api.get(`/thermal-correlations/versions/${pendingSupersede.id}/usages`).then(response => response.data),
    enabled: !!pendingSupersede?.id,
  });

  const open = (item: any) => {
    const calculation = item.calculation ||
      item.result_snapshot ||
      item.saved?.result_snapshot ||
      item.current_preview ||
      {};
    const existing = item.saved?.input_snapshot ||
      item.input_snapshot ||
      calculation?.inputs ||
      {};
    const wallEvidence = thermalEvidenceBasis(item).wall || {};
    const sourceTankConstruction = thermalExhibitTankConstruction(item.source, constructionDefaults);
    const sourceTankWallBases = thermalExhibitTankWallBases(item.source, constructionDefaults);
    const sourceHasMixedWalls = thermalWallBasesAreMixed(sourceTankWallBases);
    const sourceTankWallBasis = sourceHasMixedWalls ? null : sourceTankWallBases[0];
    setSelectedWallTankId(sourceTankWallBases[0]?.tank_id || null);
    const firstLinkedExhibit = item.source?.linked_exhibits?.[0] ||
      item.source?.water_temperature_sources?.[0] ||
      item.source?.linked_tanks?.[0];
    setSelectedExhibitKey(firstLinkedExhibit
      ? String(firstLinkedExhibit.id || firstLinkedExhibit.exhibit_id || firstLinkedExhibit.exhibit_code || 'unassigned')
      : null);
    const savedWallHasOverride = existing.reviewed_u_value_w_m2_k != null ||
      Object.values(wallEvidence.layer_override_flags || {}).some(Boolean);
    const savedCustomConstruction = existing.tank_construction_type === '' ||
      existing.tank_construction === '';
    const constructionType = sourceHasMixedWalls
      ? ''
      : savedCustomConstruction
        ? ''
        : existing.tank_construction_type ||
          existing.tank_construction ||
          sourceTankConstruction?.code ||
          sourceTankWallBasis?.code ||
          wallEvidence.construction_type ||
          '';
    const currentConstructionDefault = constructionDefaults.find(
      (candidate: any) => candidate.code === constructionType,
    );
    const constructionDefault = sourceHasMixedWalls ? null : normalizeThermalWallConstruction(
      (savedWallHasOverride ? existing.tank_wall_default_basis : sourceTankWallBasis) ||
      existing.tank_wall_default_basis ||
      wallEvidence.default_basis ||
      currentConstructionDefault,
    );
    const effectiveWallLayer = sourceHasMixedWalls ? null :
      (savedWallHasOverride ? existing.tank_wall_layers?.[0] : sourceTankWallBasis) ||
        existing.tank_wall_layers?.[0] ||
        wallEvidence.effective_layers?.[0] ||
        wallEvidence.layers?.[0];
    const effectiveWallValues = thermalWallFormValues(
      effectiveWallLayer || wallEvidence || constructionDefault,
    );
    const correlationSnapshot = existing.agitation_correlation_snapshot ||
      item.calculation?.correlation_snapshot || item.saved?.correlation_snapshot || {};
    const savedAgitationClass = existing.agitation_class ?? existing.agitation_correlation_class ?? '';
    const resolvedCorrelation = correlationItems.find(correlation =>
      correlation.class_code === savedAgitationClass && correlation.status === 'approved',
    );
    const databaseDefaults = correlationSnapshot.database_defaults || {};
    const effectiveValues = correlationSnapshot.effective_values || {};
    const overrides = correlationSnapshot.overrides ||
      existing.agitation_correlation_overrides || {};
    setSelected(item);
    setForm({
      ambient_air_temperature_c: existing.ambient_air_temperature_c ?? '',
      relative_humidity_pct: existing.relative_humidity_pct ?? 60,
       surrounding_surface_temperature_c: existing.surrounding_surface_temperature_c ?? '',
      atmospheric_pressure_kpa: existing.atmospheric_pressure_kpa ?? 101.325,
      reviewed_water_temperature_c:
        existing.reviewed_water_temperature_c ?? existing.water_temperature_c ?? '',
      agitation_class: savedAgitationClass,
      agitation_correlation_class: existing.agitation_correlation_class ?? savedAgitationClass,
      agitation_correlation_id: existing.agitation_correlation_id ?? correlationSnapshot.correlation_id ?? resolvedCorrelation?.id ?? '',
      agitation_correlation_version: existing.agitation_correlation_version ?? resolvedCorrelation?.version ?? '',
      agitation_correlation_approved: existing.agitation_correlation_approved ?? !!resolvedCorrelation,
      agitation_correlation_deviation: existing.agitation_correlation_deviation ?? false,
      evaporation_coefficient_kg_m2_s_kpa:
        effectiveValues.coefficient_kg_m2_s_kpa ??
        existing.evaporation_coefficient_kg_m2_s_kpa ?? '',
      adjacent_lower_class:
        databaseDefaults.lower_agitation_class_code ??
        existing.lower_agitation_class ??
        existing.adjacent_agitation_classes?.[0] ?? '',
      adjacent_lower_coefficient:
        effectiveValues.lower_class_coefficient_kg_m2_s_kpa ??
        existing.lower_class_coefficient_kg_m2_s_kpa ??
        existing.agitation_correlations?.[existing.adjacent_agitation_classes?.[0]]?.coefficient_kg_m2_s_kpa ?? '',
      correlation_adjustment_value:
        effectiveValues.adjustment_value ?? existing.adjustment_value ?? '',
      adjacent_upper_class:
        databaseDefaults.upper_agitation_class_code ??
        existing.upper_agitation_class ??
        existing.adjacent_agitation_classes?.[1] ?? '',
      adjacent_upper_coefficient:
        effectiveValues.upper_class_coefficient_kg_m2_s_kpa ??
        existing.upper_class_coefficient_kg_m2_s_kpa ??
        existing.agitation_correlations?.[existing.adjacent_agitation_classes?.[1]]?.coefficient_kg_m2_s_kpa ?? '',
      agitation_correlation_overrides: overrides,
      reviewed_u_value_w_m2_k: existing.reviewed_u_value_w_m2_k ?? '',
      tank_construction_type: constructionType,
      tank_wall_default_basis: constructionDefault,
      ...effectiveWallValues,
      tank_wall_override_justification:
        existing.tank_wall_override_justification ??
        wallEvidence.layer_override_justification ??
        '',
      equipment_heat_gain_kw: existing.equipment_heat_gain_kw ?? 0,
      lighting_power_kw: existing.lighting_power_kw ?? 0,
      lighting_coupling_pct: existing.lighting_coupling_pct ?? 85,
      water_exchange_enabled: existing.water_exchange_enabled ?? false,
      water_exchange_flow_m3h: existing.water_exchange_flow_m3h ?? '',
      water_exchange_inlet_temperature_c: existing.water_exchange_inlet_temperature_c ?? '',
      capacity_margin_pct: existing.capacity_margin_pct ?? 10,
      deviation_justification: existing.deviation_justification ?? '',
      custom_tank_wall_areas_m2: existing.custom_tank_wall_areas_m2 ?? {},
    });
  };

  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const selectConstruction = (constructionCode: string) => {
    const construction = constructionDefaults.find(
      (candidate: any) => candidate.code === constructionCode,
    );
    setForm((current: any) => ({
      ...current,
      tank_construction_type: constructionCode,
      tank_wall_default_basis: construction,
      reviewed_u_value_w_m2_k: '',
      tank_wall_override_justification: '',
      ...thermalWallFormValues(construction),
    }));
  };
  const resetWallLayer = () => {
    const construction = constructionDefaults.find(
      (candidate: any) => candidate.code === form.tank_construction_type,
    );
    setForm((current: any) => ({
      ...current,
      tank_wall_default_basis: construction,
      tank_wall_override_justification: '',
      ...thermalWallFormValues(construction),
    }));
  };
  const updateCorrelationOverride = (key: string, formKey: string, value: any) =>
    setForm((current: any) => ({
      ...current,
      [formKey]: value,
      agitation_correlation_overrides: {
        ...(current.agitation_correlation_overrides || {}),
        [key]: true,
      },
    }));
  const numericOrNull = (value: any) => value === '' || value == null ? null : Number(value);
  useEffect(() => {
    if (!selected || !form.agitation_class || form.agitation_correlation_id || !correlationItems.length) return;
    const approvedCorrelation = correlationItems.find(
      item => item.class_code === form.agitation_class && item.status === 'approved',
    );
    if (!approvedCorrelation) return;
    setForm((current: any) => {
      if (current.agitation_correlation_id || current.agitation_class !== form.agitation_class) return current;
      return {
        ...current,
        agitation_correlation_id: approvedCorrelation.id,
        agitation_correlation_version: approvedCorrelation.version,
        agitation_correlation_approved: true,
        ...thermalCorrelationDefaults(approvedCorrelation),
      };
    });
  }, [
    correlationItems,
    form.agitation_class,
    form.agitation_correlation_id,
    selected,
  ]);
  const selectAgitationClass = (classCode: string) => {
    // Correlation versions are platform-governed. Selecting the designer-facing
    // activity class resolves its current approved version without exposing a
    // version picker or relaxing the API's correlation-id requirement.
    const approvedCorrelation = correlationItems.find(
      item => item.class_code === classCode && item.status === 'approved',
    );
    setForm((current: any) => ({
      ...current,
      agitation_class: classCode,
      agitation_correlation_class: classCode,
      agitation_correlation_id: approvedCorrelation?.id || '',
      agitation_correlation_version: approvedCorrelation?.version || '',
      agitation_correlation_approved: !!approvedCorrelation,
      agitation_correlation_deviation: false,
      deviation_justification: '',
      agitation_correlation_overrides: {},
      ...thermalCorrelationDefaults(approvedCorrelation || null),
    }));
  };
  const selectCorrelation = (correlationId: string) => {
    const correlation = correlationItems.find(item => item.id === correlationId);
    if (!correlation) {
      setForm((current: any) => ({ ...current, agitation_correlation_id: '' }));
      return;
    }
    setForm((current: any) => ({
      ...current,
      agitation_correlation_id: correlation.id,
      agitation_class: correlation.class_code,
      agitation_correlation_class: correlation.class_code,
      agitation_correlation_version: correlation.version,
      agitation_correlation_approved: correlation.status === 'approved',
      ...thermalCorrelationDefaults(correlation),
      agitation_correlation_overrides: {},
      agitation_correlation_deviation: false,
      deviation_justification: '',
    }));
  };

  const createAgitationClass = async () => {
    setLibrarySaving(true);
    try {
      const response = await api.post('/thermal-correlations/classes', classForm);
      setVersionForm(current => ({ ...current, class_id: response.data.id }));
      setClassForm({ class_code: '', class_name: '', description: '', guidance: '' });
      await refetchCorrelationLibrary();
      toast.success('Agitation class created');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to create agitation class');
    } finally {
      setLibrarySaving(false);
    }
  };

  const saveCorrelationVersion = async () => {
    setLibrarySaving(true);
    try {
      await api.post(`/thermal-correlations/classes/${versionForm.class_id}/versions`, {
        version: versionForm.version,
        coefficient_kg_m2_s_kpa: numericOrNull(versionForm.coefficient_kg_m2_s_kpa),
        lower_agitation_class_code: versionForm.lower_agitation_class_code,
        lower_agitation_class_name: versionForm.lower_agitation_class_name,
        lower_class_coefficient_kg_m2_s_kpa:
          numericOrNull(versionForm.lower_class_coefficient_kg_m2_s_kpa),
        adjustment_value: numericOrNull(versionForm.adjustment_value),
        adjustment_basis: versionForm.adjustment_basis,
        upper_agitation_class_code: versionForm.upper_agitation_class_code,
        upper_agitation_class_name: versionForm.upper_agitation_class_name,
        upper_class_coefficient_kg_m2_s_kpa:
          numericOrNull(versionForm.upper_class_coefficient_kg_m2_s_kpa),
        source_reference: versionForm.source_reference,
        notes: versionForm.notes,
        impact_token: approveReplacementAfterConfirmation ? correlationUsage?.impact_token : undefined,
      });
      setVersionForm(current => ({
        ...current,
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
      }));
      await refetchCorrelationLibrary();
      toast.success('Approved correlation version added');
      setPendingSupersede(null);
      setApproveReplacementAfterConfirmation(false);
    } catch (error: any) {
      if (error?.response?.data?.error?.code === 'THERMAL_CORRELATION_IMPACT_CHANGED') {
        const refreshedLibrary = await refetchCorrelationLibrary();
        const refreshedCurrent = (refreshedLibrary.data?.items || []).find(
          (item: any) => item.class_id === versionForm.class_id && item.status === 'approved',
        );
        if (!refreshedCurrent) {
          closeCorrelationUsage();
        } else if (refreshedCurrent.id !== pendingSupersede?.id) {
          setPendingSupersede(refreshedCurrent);
        } else {
          await refetchCorrelationUsage();
        }
      }
      toast.error(error?.response?.data?.error?.message || 'Unable to add correlation version');
    } finally {
      setLibrarySaving(false);
    }
  };

  const createCorrelationVersion = async () => {
    if (!versionForm.class_id) return;
    const currentVersion = correlationItems.find(
      item => item.class_id === versionForm.class_id && item.status === 'approved',
    );
    if (currentVersion) {
      setApproveReplacementAfterConfirmation(true);
      setPendingSupersede(currentVersion);
      return;
    }
    await saveCorrelationVersion();
  };

  const requestSupersedeCorrelation = (correlation: any) => {
    setApproveReplacementAfterConfirmation(false);
    setPendingSupersede(correlation);
  };

  const supersedeCorrelation = async () => {
    if (!pendingSupersede) return;
    if (approveReplacementAfterConfirmation) {
      await saveCorrelationVersion();
      return;
    }
    setLibrarySaving(true);
    try {
      await api.post(`/thermal-correlations/versions/${pendingSupersede.id}/supersede`, {
        impact_token: correlationUsage?.impact_token,
      });
      await refetchCorrelationLibrary();
      toast.success(`${pendingSupersede.class_code} ${pendingSupersede.version} superseded`);
      setPendingSupersede(null);
      setApproveReplacementAfterConfirmation(false);
    } catch (error: any) {
      if (error?.response?.data?.error?.code === 'THERMAL_CORRELATION_IMPACT_CHANGED') {
        await refetchCorrelationUsage();
      }
      toast.error(error?.response?.data?.error?.message || 'Unable to supersede correlation');
    } finally {
      setLibrarySaving(false);
    }
  };
  const closeCorrelationUsage = () => {
    setPendingSupersede(null);
    setApproveReplacementAfterConfirmation(false);
  };
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const wallLayers = form.reviewed_u_value_w_m2_k || !form.wall_material ? [] : [{
        material: form.wall_material,
        thickness_mm: numericOrNull(form.wall_thickness_mm),
        conductivity_w_m_k: numericOrNull(form.wall_conductivity_w_m_k),
      }];
      const inputs = {
        ambient_air_temperature_c: numericOrNull(form.ambient_air_temperature_c),
        relative_humidity_pct: numericOrNull(form.relative_humidity_pct),
        surrounding_surface_temperature_c: numericOrNull(form.surrounding_surface_temperature_c),
        atmospheric_pressure_kpa: numericOrNull(form.atmospheric_pressure_kpa),
        ...(form.reviewed_water_temperature_c !== ''
          ? { reviewed_water_temperature_c: numericOrNull(form.reviewed_water_temperature_c) }
          : {}),
        agitation_correlation_id: form.agitation_correlation_id || undefined,
        agitation_class: form.agitation_class,
        agitation_correlation_class: form.agitation_class,
        agitation_correlation_version: form.agitation_correlation_version,
        agitation_correlation_approved: !!form.agitation_correlation_approved,
        agitation_correlation_deviation: !!form.agitation_correlation_deviation,
        evaporation_coefficient_kg_m2_s_kpa: numericOrNull(form.evaporation_coefficient_kg_m2_s_kpa),
        lower_agitation_class: form.adjacent_lower_class || null,
        lower_class_coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_lower_coefficient),
        adjustment_value: numericOrNull(form.correlation_adjustment_value),
        upper_agitation_class: form.adjacent_upper_class || null,
        upper_class_coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_upper_coefficient),
        agitation_correlation_overrides: form.agitation_correlation_overrides || {},
        adjacent_agitation_classes: [form.adjacent_lower_class, form.adjacent_upper_class].filter(Boolean),
        agitation_correlations: {
          [form.agitation_class]: {
            class: form.agitation_class,
            coefficient_kg_m2_s_kpa: numericOrNull(form.evaporation_coefficient_kg_m2_s_kpa),
            version: form.agitation_correlation_version,
            approved: !!form.agitation_correlation_approved,
            deviation: !!form.agitation_correlation_deviation,
          },
          ...(form.adjacent_lower_class ? {
            [form.adjacent_lower_class]: {
              class: form.adjacent_lower_class,
              coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_lower_coefficient),
              version: form.agitation_correlation_version,
              approved: !!form.agitation_correlation_approved,
            },
          } : {}),
          ...(form.adjacent_upper_class ? {
            [form.adjacent_upper_class]: {
              class: form.adjacent_upper_class,
              coefficient_kg_m2_s_kpa: numericOrNull(form.adjacent_upper_coefficient),
              version: form.agitation_correlation_version,
              approved: !!form.agitation_correlation_approved,
            },
          } : {}),
        },
        reviewed_u_value_w_m2_k: numericOrNull(form.reviewed_u_value_w_m2_k),
        tank_construction_type: form.tank_construction_type === ''
          ? ''
          : form.tank_construction_type || null,
        tank_wall_layers: wallLayers,
        tank_wall_override_justification: form.tank_wall_override_justification || '',
        equipment_heat_gain_kw: numericOrNull(
          thermalHasEquipmentHeatSources(selected?.source)
            ? selected?.source?.equipment_heat_gain_kw
            : form.equipment_heat_gain_kw,
        ),
        lighting_power_kw: numericOrNull(form.lighting_power_kw),
        lighting_coupling_pct: numericOrNull(form.lighting_coupling_pct),
        water_exchange_enabled: !!form.water_exchange_enabled,
        water_exchange_flow_m3h: numericOrNull(form.water_exchange_flow_m3h),
        water_exchange_inlet_temperature_c: numericOrNull(form.water_exchange_inlet_temperature_c),
        capacity_margin_pct: numericOrNull(form.capacity_margin_pct),
        deviation_justification: form.deviation_justification,
        custom_tank_wall_areas_m2: form.custom_tank_wall_areas_m2,
      };
      const response = await api.put(`/design-books/${book.id}/thermal/${selected.system_id}`, { inputs });
      toast.success(response.data.calculation?.status === 'Ready'
        ? 'Thermal calculation saved and Ready'
        : 'Thermal inputs saved with blockers');
      setSelected(response.data);
      await onRefresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save thermal calculation');
    } finally {
      setSaving(false);
    }
  };

  if (!items.length) {
    return (
      <div className="space-y-4 rounded-2xl bg-[#f3eee6] p-3 sm:p-5">
        <div className="rounded-2xl border border-[#d8d4cb] bg-[#fbfaf7] py-16 text-center">
          <ThermometerSun className="mx-auto mb-3 h-10 w-10 text-[#9aa8af]" />
          <p className="font-semibold text-[#263746]">No LSS systems to calculate</p>
          <p className="mt-1 text-sm text-[#71808a]">Create and link an LSS system first.</p>
        </div>
      </div>
    );
  }

  const detail = selected?.calculation || selected?.current_preview;
  const thermalNetLoad = Number(detail?.results?.net_total_load_kw);
  const thermalActionIsCooling = Number.isFinite(thermalNetLoad) ? thermalNetLoad >= 0 : true;
  const thermalActionLabel = thermalActionIsCooling ? 'Cooling with margin' : 'Heating with margin';
  const thermalActionValue = thermalActionIsCooling
    ? detail?.results?.margin_adjusted_cooling_kw
    : detail?.results?.margin_adjusted_steady_state_heating_kw ??
      (Number(detail?.results?.steady_state_heating_kw || 0) * (1 + Number(form.capacity_margin_pct || 0) / 100));
  const evidenceBasis = thermalEvidenceBasis(selected || detail);
  const wallBasisChange = thermalWallBasisChange(selected || detail);
  const hasEquipmentHeatSources = thermalHasEquipmentHeatSources(selected?.source);
  const sourceTankWallBases = thermalExhibitTankWallBases(
    selected?.source,
    constructionDefaults,
  );
  const displayedTankWallBases = evidenceBasis.wall?.tank_bases?.length
    ? evidenceBasis.wall.tank_bases
    : sourceTankWallBases;
  const linkedExhibitTabs = [
    ...(selected?.source?.linked_exhibits || []).map((exhibit: any) => ({
      key: String(exhibit.id || exhibit.exhibit_id || exhibit.exhibit_code || 'unassigned'),
      code: exhibit.exhibit_code || exhibit.id || 'Unassigned exhibit',
    })),
    ...(selected?.source?.water_temperature_sources || []).map((source: any) => ({
      key: String(source.exhibit_id || source.exhibit_code || 'unassigned'),
      code: source.exhibit_code || source.exhibit_id || 'Unassigned exhibit',
    })),
    ...(selected?.source?.linked_tanks || []).map((tank: any) => ({
      key: String(tank.exhibit_id || tank.exhibit_code || 'unassigned'),
      code: tank.exhibit_code || tank.exhibit_id || 'Unassigned exhibit',
    })),
  ].reduce((tabs: any[], tab: any) => (
    tabs.some(candidate => candidate.key === tab.key) ? tabs : [...tabs, tab]
  ), []);
  const selectedWallTankById = displayedTankWallBases.find(
    (basis: any) => basis.tank_id === selectedWallTankId,
  ) || null;
  const selectedWallExhibitKey = String(
    selectedWallTankById?.exhibit_id ||
    selectedWallTankById?.exhibit_code ||
    selectedExhibitKey ||
    linkedExhibitTabs[0]?.key ||
    'unassigned',
  );
  const selectedWallTankBasis = selectedWallTankById ||
    displayedTankWallBases.find((basis: any) =>
      String(basis.exhibit_id || basis.exhibit_code || 'unassigned') === selectedWallExhibitKey,
    ) ||
    displayedTankWallBases[0] ||
    null;
  const selectedExhibitTemperatureSources = (selected?.source?.water_temperature_sources || [])
    .filter((source: any) =>
      (source.exhibit_id || source.exhibit_code || 'unassigned') === selectedWallExhibitKey);
  const selectedExhibitTanks = (selected?.source?.linked_tanks || [])
    .filter((tank: any) =>
      (tank.exhibit_id || tank.exhibit_code || 'unassigned') === selectedWallExhibitKey);
  const lightingSchedulePower = selected?.source?.lighting_power_kw;
  const lightingScheduleIsAvailable = selected?.source &&
    Object.prototype.hasOwnProperty.call(selected.source, 'lighting_power_kw');
  const selectedAgitationClass = agitationClasses.find(
    item => item.class_code === form.agitation_class,
  );
  const selectedCorrelation = correlationItems.find(
    item => item.id === form.agitation_correlation_id,
  );
  const hasCorrelationSensitivityInputs = [
    form.adjacent_lower_class,
    form.adjacent_lower_coefficient,
    form.correlation_adjustment_value,
    form.adjacent_upper_class,
    form.adjacent_upper_coefficient,
  ].some(value => value !== '' && value != null);
  const draftOverridesAllowed = !readOnly && book.status === 'Draft';
  const mainCorrelationOverrideAllowed = draftOverridesAllowed && !!form.agitation_correlation_id;
  const fieldClass = thermalFieldClass;
  const labelClass = thermalLabelClass;

  return (
    <div className="space-y-5 rounded-2xl bg-[#f3eee6] p-3 text-[#263746] sm:p-5">
      {pendingSupersede && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Correlation usage
                </p>
                <h2 className="mt-1 text-lg font-bold text-stone-900">
                  {pendingSupersede.class_code} · {pendingSupersede.version}
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  {correlationUsage?.correlation?.usage_count ?? pendingSupersede.usage_count ?? 0} captured thermal calculation(s)
                </p>
              </div>
              <button
                type="button"
                onClick={closeCorrelationUsage}
                aria-label="Close correlation usage"
                className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {pendingSupersede.status === 'approved' && (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {approveReplacementAfterConfirmation
                      ? `Approving ${versionForm.version || 'the replacement version'} will supersede this current version. `
                      : 'Superseding stops new calculations from selecting this version. '}
                    The saved review and release snapshots listed below remain unchanged and may be reviewed voluntarily.
                  </p>
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto bg-stone-50/50 p-5">
              {usageLoading ? (
                <div className="py-12 text-center text-sm text-stone-500">Loading captured usage…</div>
              ) : usageError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Unable to load the captured usage. Close this dialog and try again.
                </div>
              ) : (
                <ThermalCorrelationUsageList usages={correlationUsage?.usages || []} />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-stone-200 bg-white px-5 py-4">
              <button
                type="button"
                onClick={closeCorrelationUsage}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                {pendingSupersede.status === 'approved' ? 'Cancel' : 'Close'}
              </button>
              {pendingSupersede.status === 'approved' && (
                <Button
                  type="button"
                  onClick={supersedeCorrelation}
                  variant="thermal"
                  disabled={librarySaving || usageLoading || usageError}
                >
                  {librarySaving
                    ? approveReplacementAfterConfirmation ? 'Approving…' : 'Superseding…'
                    : approveReplacementAfterConfirmation ? 'Confirm and approve version' : 'Confirm supersede'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-[#c7d8df] bg-[#e8f0f2] px-4 py-3 text-sm text-[#456b7d]">
        Positive contribution values add heat to water; negative values remove heat. LSS circulation is shown only as reference and is never counted as water exchange.
      </div>
      {canManageLibrary && <div className="rounded-xl border border-[#d8d4cb] bg-[#fbfaf7]">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="font-semibold text-[#263746]">Platform Admin · evaporation correlation library</div>
            <div className="text-xs text-stone-500">
              {correlationItems.filter(item => item.status === 'approved').length} current approved version(s).
              Saved calculations retain an exact snapshot when a version is superseded.
            </div>
          </div>
          {canManageLibrary && (
            <button
              type="button"
              onClick={() => setShowLibrary(value => !value)}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              {showLibrary ? 'Close library' : 'Manage library'}
            </button>
          )}
        </div>
        {showLibrary && canManageLibrary && (
          <div className="border-t border-stone-200 p-4 space-y-5">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.5fr_1.5fr_auto]">
              <label><span className={labelClass}>Class code</span><input value={classForm.class_code} onChange={event => setClassForm(current => ({ ...current, class_code: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Class name</span><input value={classForm.class_name} onChange={event => setClassForm(current => ({ ...current, class_name: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Description</span><input value={classForm.description} onChange={event => setClassForm(current => ({ ...current, description: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Selection guidance</span><input value={classForm.guidance} onChange={event => setClassForm(current => ({ ...current, guidance: event.target.value }))} className={fieldClass} /></label>
              <Button type="button" onClick={createAgitationClass} variant="thermal" size="sm" disabled={librarySaving || !classForm.class_code.trim() || !classForm.class_name.trim()} className="self-end">Add class</Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1.5fr_auto]">
              <label>
                <span className={labelClass}>Agitation class</span>
                <select value={versionForm.class_id} onChange={event => setVersionForm(current => ({ ...current, class_id: event.target.value }))} className={fieldClass}>
                  <option value="">Select class</option>
                  {agitationClasses.filter(item => item.is_active).map(item => <option key={item.id} value={item.id}>{item.class_code} · {item.class_name}</option>)}
                </select>
              </label>
              <label><span className={labelClass}>New version</span><input value={versionForm.version} onChange={event => setVersionForm(current => ({ ...current, version: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Coefficient (kg/m²·s·kPa)</span><input type="number" min="0" step="any" value={versionForm.coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Approval source / reference</span><input value={versionForm.source_reference} onChange={event => setVersionForm(current => ({ ...current, source_reference: event.target.value }))} className={fieldClass} /></label>
              <Button type="button" onClick={createCorrelationVersion} variant="thermal" size="sm" disabled={librarySaving || !versionForm.class_id || !versionForm.version.trim() || !versionForm.coefficient_kg_m2_s_kpa || !versionForm.source_reference.trim()} className="self-end">Approve version</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label><span className={labelClass}>Lower class code</span><input value={versionForm.lower_agitation_class_code} onChange={event => setVersionForm(current => ({ ...current, lower_agitation_class_code: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Lower class name</span><input value={versionForm.lower_agitation_class_name} onChange={event => setVersionForm(current => ({ ...current, lower_agitation_class_name: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Lower-class coefficient</span><input type="number" min="0" step="any" value={versionForm.lower_class_coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, lower_class_coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Adjustment value</span><input type="number" step="any" value={versionForm.adjustment_value} onChange={event => setVersionForm(current => ({ ...current, adjustment_value: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Adjustment basis</span><input value={versionForm.adjustment_basis} onChange={event => setVersionForm(current => ({ ...current, adjustment_basis: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Upper adjacent class code</span><input value={versionForm.upper_agitation_class_code} onChange={event => setVersionForm(current => ({ ...current, upper_agitation_class_code: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Upper adjacent class name</span><input value={versionForm.upper_agitation_class_name} onChange={event => setVersionForm(current => ({ ...current, upper_agitation_class_name: event.target.value }))} className={fieldClass} /></label>
              <label><span className={labelClass}>Upper-class coefficient</span><input type="number" min="0" step="any" value={versionForm.upper_class_coefficient_kg_m2_s_kpa} onChange={event => setVersionForm(current => ({ ...current, upper_class_coefficient_kg_m2_s_kpa: event.target.value }))} className={fieldClass} /></label>
            </div>
            {!!correlationItems.length && (
              <div className="overflow-x-auto rounded-xl border border-stone-200">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Class</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Coefficient</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Captured uses</th><th className="px-3 py-2"></th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {correlationItems.map(correlation => (
                      <tr key={correlation.id}>
                        <td className="px-3 py-2 font-medium">{correlation.class_code}</td>
                        <td className="px-3 py-2 font-mono">{correlation.version}</td>
                        <td className="px-3 py-2 font-mono">{correlation.coefficient_kg_m2_s_kpa}</td>
                        <td className="px-3 py-2 text-stone-600">{correlation.source_reference}</td>
                        <td className="px-3 py-2 capitalize">{correlation.status}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => {
                              setApproveReplacementAfterConfirmation(false);
                              setPendingSupersede(correlation);
                            }}
                            className="font-medium text-[#456b7d] hover:text-[#263746] hover:underline"
                          >
                            {correlation.usage_count || 0} · View usage
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {correlation.status === 'approved' && <Button type="button" onClick={() => requestSupersedeCorrelation(correlation)} variant="thermal" size="sm" disabled={librarySaving}>Supersede</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>}
      <section className="overflow-hidden rounded-2xl border border-[#d8d4cb] bg-[#fbfaf7] shadow-[0_14px_36px_rgba(50,52,51,0.06)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#d8d4cb] px-4 py-4 sm:px-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#456b7d]">Thermal systems</p><h2 className="mt-1 text-lg font-bold text-[#263746]">Choose a system to calculate</h2><p className="mt-1 text-sm text-[#71808a]">Start with linked scope and readiness. Details remain focused below.</p></div>
          <span className="shrink-0 rounded-full bg-[#dfeaf0] px-3 py-1 text-xs font-semibold text-[#456b7d]">{items.length} system{items.length === 1 ? '' : 's'}</span>
        </div>
        <div className="divide-y divide-[#e6e1d8]">
              {items.map(item => {
                const calculation = item.calculation;
                const activeDuty = thermalActiveDuty(calculation);
                return (
                  <div key={item.system_id} className={`grid w-full gap-3 px-4 py-4 text-left transition hover:bg-[#edf2f3] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-5 ${selected?.system_id === item.system_id ? 'bg-[#edf2f3]' : ''}`}>
                    <div>
                      <div className="font-semibold text-[#263746]">{item.system?.system_name || 'Unnamed system'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2"><EntityCode code={item.system?.system_code} /><span className="text-xs text-[#71808a]">{item.source?.linked_exhibits?.length || 0} exhibit(s) · {item.source?.linked_tanks?.length || 0} tank(s)</span></div>
                    </div>
                    <div>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        item.status === 'Ready' ? 'border-[#c7d8df] bg-[#dfeaf0] text-[#456b7d]'
                          : item.status === 'Stale' ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                      }`}>{item.status}</span>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      {activeDuty && <div><span className="block text-[11px] uppercase tracking-wide text-[#71808a]">{activeDuty.label}</span><b className="font-mono text-sm text-[#263746]">{thermalNumber(activeDuty.value)} kW</b></div>}
                      <button
                        type="button"
                        onClick={() => open(item)}
                        aria-expanded={selected?.system_id === item.system_id}
                        aria-controls={selected?.system_id === item.system_id ? 'thermal-focused-calculation' : undefined}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#b9c9d0] px-2.5 py-1.5 text-sm font-semibold text-[#456b7d] hover:bg-[#e2ecef]"
                      >
                        {selected?.system_id === item.system_id ? 'Opened' : 'Open'}
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
        </div>
        <div className="border-t border-[#d8d4cb] bg-[#eee9e0] px-4 py-2 text-xs text-[#71808a]"><ShieldCheck className="mr-1 inline h-4 w-4 text-[#456b7d]" />Wall defaults and correlation versions are versioned, governed platform evidence.</div>
      </section>

      {selected && (
        <div id="thermal-focused-calculation" className="space-y-6 rounded-2xl border border-[#d8d4cb] bg-[#fbfaf7] p-5 shadow-[0_14px_36px_rgba(50,52,51,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#456b7d]">Focused calculation</p>
              <h2 className="text-lg font-bold text-[#263746]">{selected.system?.system_code} · {selected.system?.system_name}</h2>
              <p className="mt-1 text-xs text-[#71808a]">Calculation {detail?.calculation_version || 'not saved'} · source fingerprint {String(selected.source_fingerprint || '').slice(0, 12)}…</p>
            </div>
            <button onClick={() => setSelected(null)} aria-label="Close thermal calculation" className="inline-flex items-center gap-1.5 rounded-lg border border-[#b9c9d0] px-3 py-2 text-sm font-semibold text-[#456b7d] hover:bg-[#edf2f3]"><X className="h-4 w-4" /> Close calculation</button>
          </div>
          <div className="grid gap-3 rounded-xl border border-[#c7d8df] bg-[#e8f0f2] p-3 text-sm sm:grid-cols-3">
            <div className="flex gap-2 text-[#456b7d]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="block">Status: {selected.status}</b><small className="text-[#718894]">Readiness from linked sources</small></span></div>
            <div className="flex gap-2 text-[#456b7d]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="block">Evidence preserved</b><small className="text-[#718894]">Snapshots remain immutable</small></span></div>
            <div className="flex gap-2 text-[#456b7d]"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="block">{readOnly ? 'Frozen evidence' : 'Draft controls'}</b><small className="text-[#718894]">{readOnly ? 'Editing is disabled' : 'Save to recalculate'}</small></span></div>
          </div>
          <ThermalWallBasisChangeNotice change={wallBasisChange} />

          <div className="flex flex-col gap-6">
          <section className="order-2">
             <h3 className="mb-3 font-semibold text-[#263746]">
               <button
                 type="button"
                 className="flex w-full items-center justify-between gap-3 text-left"
                 aria-expanded={!collapsedSections.linkedSource}
                  aria-controls="thermal-linked-source-panel thermal-wall-calculations-panel thermal-action-required-panel"
                 onClick={() => setCollapsedSections(current => ({ ...current, linkedSource: !current.linkedSource }))}
               >
                 <span><span className="mr-2 text-[#9aa8af]">02</span>Linked source and geometry</span>
                 <ChevronDown className={`h-4 w-4 shrink-0 text-[#71808a] transition-transform ${collapsedSections.linkedSource ? '' : 'rotate-180'}`} />
               </button>
             </h3>
             {!collapsedSections.linkedSource && <div id="thermal-linked-source-panel" className="space-y-3">
             {linkedExhibitTabs.length > 0 && (
              <div
                role="tablist"
                aria-label="Linked exhibits"
                className="mb-3 flex gap-2 overflow-x-auto border-b border-[#d8e3e7] pb-1"
              >
                 {linkedExhibitTabs.map((exhibit: any) => {
                   const exhibitBasis = displayedTankWallBases.find((basis: any) =>
                     String(basis.exhibit_id || basis.exhibit_code || 'unassigned') === exhibit.key,
                   );
                   const isActive = selectedWallExhibitKey === exhibit.key;
                  return (
                    <button
                       key={exhibit.key}
                       id={`thermal-exhibit-tab-${exhibit.key}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                       aria-controls={exhibitBasis?.tank_id
                         ? `thermal-wall-panel-${exhibitBasis.tank_id}`
                         : undefined}
                       onClick={() => {
                         setSelectedExhibitKey(exhibit.key);
                         setSelectedWallTankId(exhibitBasis?.tank_id || null);
                       }}
                      className={`shrink-0 rounded-t-lg border-b-2 px-3 py-2 text-left text-xs font-semibold transition ${
                        isActive
                          ? 'border-[#456b7d] bg-[#e8f0f2] text-[#263746]'
                          : 'border-transparent text-[#71808a] hover:border-[#b9c9d0] hover:bg-[#f3f7f8]'
                      }`}
                    >
                       <span className="block">{exhibit.code}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ['Effective volume', `${thermalNumber(detail?.results?.effective_water_volume_m3, 3)} m³`],
                ['Free surface', `${thermalNumber(
                  thermalLinkedFreeSurfaceArea(selected.source) ??
                  detail?.results?.free_surface_area_m2,
                )} m²`],
                ['Exposed wall', `${thermalNumber(detail?.results?.exposed_wall_area_m2)} m²`],
                ['LSS circulation (reference)', `${thermalNumber(selected.source?.lss_circulation_flow_m3h)} m³/h`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[#f3efe8] p-3">
                  <div className="text-xs text-[#71808a]">{label}</div><div className="mt-1 font-mono text-sm font-semibold text-[#263746]">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-stone-200 p-3">
                <p className="text-xs font-semibold text-stone-700 mb-2">Exhibits and water-temperature sources</p>
                {selectedExhibitTemperatureSources.map((source: any) => (
                  <div key={source.exhibit_id} className="flex justify-between gap-3 text-sm py-1">
                    <span>{source.exhibit_code || source.exhibit_id}</span>
                    <span className="text-right">
                      <span className="font-mono">{thermalNumber(source.water_temperature_min_c, 1)}–{thermalNumber(source.water_temperature_max_c, 1)} °C</span>
                      {source.water_temperature_range_status &&
                        <span className={`ml-2 text-xs ${source.water_temperature_range_status === 'valid' ? 'text-[#456b7d]' : 'text-red-700'}`}>
                          {source.water_temperature_range_status}
                        </span>}
                    </span>
                  </div>
                ))}
                 {!selectedExhibitTemperatureSources.length && (
                   <div className="flex justify-between gap-3 py-1 text-sm">
                     <span>
                       {linkedExhibitTabs.find((exhibit: any) => exhibit.key === selectedWallExhibitKey)?.code ||
                         'Unassigned exhibit'}
                     </span>
                     <span className="text-xs text-[#71808a]">linked exhibit</span>
                   </div>
                 )}
                {evidenceBasis.temperature && (
                  <WaterTemperatureOverrideControl
                    average={evidenceBasis.temperature.average_c}
                    overrideValue={form.reviewed_water_temperature_c}
                    onOverrideChange={event => update('reviewed_water_temperature_c', event.target.value)}
                    disabled={readOnly}
                  />
                )}
              </div>
              <div className="rounded-xl border border-stone-200 p-3">
                <p className="text-xs font-semibold text-stone-700 mb-2">Tank geometry provenance</p>
                {selectedExhibitTanks.map((tank: any) => (
                  <div key={tank.tank_id} className="border-b border-stone-100 last:border-0 py-1.5 text-xs">
                    {(() => {
                      const override = Number(form.custom_tank_wall_areas_m2?.[tank.tank_id]);
                      const hasOverride = Number.isFinite(override) && override > 0;
                      const defaultWallArea = customTankWallAreaDefault(tank);
                      const wallSource = hasOverride
                        ? 'manual override (custom tank)'
                        : tank.exposed_wall_source;
                      return (
                        <>
                          <b>{tank.tank_code || tank.tank_id}</b> · volume: {tank.volume_source}; surface: {tank.free_surface_source}; wall: {wallSource}
                          {tank.shape === 'custom' && (
                            <div className="mt-2 space-y-1.5 text-stone-700">
                              <label className="flex flex-wrap items-center gap-2">
                                <span>Reviewed exposed wall area override (m²)</span>
                                <input type="number" min="0" step="any"
                                  value={form.custom_tank_wall_areas_m2?.[tank.tank_id] ?? ''}
                                  placeholder={defaultWallArea == null ? 'No calculated default' : defaultWallArea.toFixed(2)}
                                  onChange={event => update('custom_tank_wall_areas_m2', {
                                    ...(form.custom_tank_wall_areas_m2 || {}),
                                    [tank.tank_id]: event.target.value === '' ? null : Number(event.target.value),
                                  })}
                                  disabled={readOnly}
                                  className="w-28 rounded border border-stone-200 px-2 py-1 disabled:bg-stone-50" />
                              </label>
                              {defaultWallArea != null && (
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                                  <span>Calculated default: <b className="font-mono text-stone-700">{defaultWallArea.toFixed(2)} m²</b></span>
                                  {hasOverride && !readOnly && (
                                    <button
                                      type="button"
                                      onClick={() => update('custom_tank_wall_areas_m2', {
                                        ...(form.custom_tank_wall_areas_m2 || {}),
                                        [tank.tank_id]: null,
                                      })}
                                      className="font-semibold text-[#456b7d] underline underline-offset-2"
                                    >
                                      Use calculated default
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
             </div>}
          </section>

          <section className="contents">
            <div className="order-1 space-y-3">
             <h3 className="font-semibold text-[#263746]">
               <button
                 type="button"
                 className="flex w-full items-center justify-between gap-3 text-left"
                 aria-expanded={!collapsedSections.environment}
                 aria-controls="thermal-environment-panel"
                 onClick={() => setCollapsedSections(current => ({ ...current, environment: !current.environment }))}
               >
                 <span><span className="mr-2 text-[#9aa8af]">01</span>Environment and effective values</span>
                 <ChevronDown className={`h-4 w-4 shrink-0 text-[#71808a] transition-transform ${collapsedSections.environment ? '' : 'rotate-180'}`} />
               </button>
             </h3>
             {!collapsedSections.environment && <div id="thermal-environment-panel" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ThermalNumericField name="ambient_air_temperature_c" label="Ambient air temperature" unit="°C"
                value={form.ambient_air_temperature_c} onChange={event => update('ambient_air_temperature_c', event.target.value)} disabled={readOnly} />
              <ThermalNumericField name="relative_humidity_pct" label="Relative humidity" unit="%"
                value={form.relative_humidity_pct} onChange={event => update('relative_humidity_pct', event.target.value)} disabled={readOnly} />
              <ThermalNumericField name="atmospheric_pressure_kpa" label="Atmospheric pressure" unit="kPa"
                value={form.atmospheric_pressure_kpa} onChange={event => update('atmospheric_pressure_kpa', event.target.value)} disabled={readOnly} />
              <div className="sm:col-span-2">
                 <label htmlFor="surface-activity-class" className={labelClass}>Surface-activity class (required)</label>
                 <select id="surface-activity-class" aria-label="Surface-activity class" value={form.agitation_class || ''}
                  onChange={event => selectAgitationClass(event.target.value)}
                  disabled={readOnly} required className={fieldClass}>
                  <option value="">Select surface activity</option>
                  {agitationClasses.filter(item => item.is_active ||
                    item.class_code === form.agitation_class).map(item => (
                    <option key={item.id} value={item.class_code}>{item.class_name}</option>
                  ))}
                </select>
                 <EffectiveRadiantSurroundingsTemperature
                   ambientValue={form.ambient_air_temperature_c}
                   overrideValue={form.surrounding_surface_temperature_c}
                   onOverrideChange={event => update('surrounding_surface_temperature_c', event.target.value)}
                   disabled={readOnly}
                 />
                <SurfaceActivityGuidance
                  key={form.agitation_class || 'no-surface-activity'}
                  selectedAgitationClass={selectedAgitationClass}
                />
               </div>
              <MassTransferCoefficientControl
                value={form.evaporation_coefficient_kg_m2_s_kpa}
                overridden={!!form.agitation_correlation_deviation}
                canOverride={mainCorrelationOverrideAllowed}
                onChange={event => update('evaporation_coefficient_kg_m2_s_kpa', event.target.value)}
                onOverride={() => update('agitation_correlation_deviation', true)}
                onReset={() => setForm((current: any) => ({
                  ...current,
                  agitation_correlation_deviation: false,
                  evaporation_coefficient_kg_m2_s_kpa:
                    selectedCorrelation?.coefficient_kg_m2_s_kpa ?? '',
                  deviation_justification: '',
                }))}
              />
            </div>
            {!form.agitation_correlation_id && form.agitation_class && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                No approved correlation is available for this surface-activity class. Ask an engineering administrator to approve a version before this calculation can be saved.
              </div>
            )}
            {hasCorrelationSensitivityInputs && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label><span className={labelClass}>Lower surface-activity class</span><input value={form.adjacent_lower_class || ''} disabled className={fieldClass} /></label>
                <label>
                  <span className={labelClass}>Lower-class coefficient (kg/m²·s·kPa){form.agitation_correlation_overrides?.lower_class_coefficient_kg_m2_s_kpa && ' · Override'}</span>
                  <input aria-label="Lower-class coefficient" type="number" min="0" step="any"
                    value={form.adjacent_lower_coefficient ?? ''}
                    onChange={event => updateCorrelationOverride('lower_class_coefficient_kg_m2_s_kpa', 'adjacent_lower_coefficient', event.target.value)}
                    disabled={!draftOverridesAllowed || !form.agitation_correlation_id} className={fieldClass} />
                </label>
                <label>
                  <span className={labelClass}>Correlation adjustment{form.agitation_correlation_overrides?.adjustment_value && ' · Override'}</span>
                  <input aria-label="Correlation adjustment" type="number" step="any"
                    value={form.correlation_adjustment_value ?? ''}
                    onChange={event => updateCorrelationOverride('adjustment_value', 'correlation_adjustment_value', event.target.value)}
                    disabled={!draftOverridesAllowed || !form.agitation_correlation_id} className={fieldClass} />
                </label>
                <label><span className={labelClass}>Upper adjacent class</span><input value={form.adjacent_upper_class || ''} disabled className={fieldClass} /></label>
                <label>
                  <span className={labelClass}>Upper-class coefficient (kg/m²·s·kPa){form.agitation_correlation_overrides?.upper_class_coefficient_kg_m2_s_kpa && ' · Override'}</span>
                  <input aria-label="Upper-class coefficient" type="number" min="0" step="any"
                    value={form.adjacent_upper_coefficient ?? ''}
                    onChange={event => updateCorrelationOverride('upper_class_coefficient_kg_m2_s_kpa', 'adjacent_upper_coefficient', event.target.value)}
                    disabled={!draftOverridesAllowed || !form.agitation_correlation_id} className={fieldClass} />
                </label>
              </div>
            )}
             </div>}
            </div>
             {!collapsedSections.linkedSource && (<>
           <section id="thermal-wall-calculations-panel" className="order-4 space-y-3">
            <div>
              <h3 className="font-semibold text-[#263746]">Wall calculations by exhibit tank</h3>
              <p className="mt-1 text-xs text-[#71808a]">
                Each linked tank is calculated separately from its exhibit material, thickness, governed conductivity, exposed area, and quantity.
              </p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2">Exhibit / tank</th>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2 text-right">Thickness</th>
                    <th className="px-3 py-2 text-right">k</th>
                    <th className="px-3 py-2 text-right">R material</th>
                    <th className="px-3 py-2 text-right">U material</th>
                    <th className="px-3 py-2 text-right">U overall</th>
                    <th className="px-3 py-2 text-right">Wall load</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {(detail?.results?.tank_wall_calculations || []).map((wall: any) => (
                    <tr key={wall.tank_id || `${wall.exhibit_id}-${wall.tank_code}`}>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-stone-800">{wall.exhibit_code || wall.exhibit_id || 'Unassigned exhibit'}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-stone-500">{wall.tank_code || wall.tank_id}</div>
                      </td>
                      <td className="px-3 py-3 text-stone-700">{wall.material || 'Missing'}</td>
                      <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.thickness_mm, 2)} mm</td>
                      <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.conductivity_w_m_k, 3)} W/m·K</td>
                      <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.material_resistance_m2_k_w, 4)} m²K/W</td>
                      <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.material_u_value_w_m2_k, 2)} W/m²K</td>
                      <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.overall_u_value_w_m2_k, 2)} W/m²K</td>
                      <td className="px-3 py-3 text-right font-mono">{thermalNumber(wall.wall_conduction_kw, 2)} kW</td>
                    </tr>
                  ))}
                  {!(detail?.results?.tank_wall_calculations || []).length && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-stone-500">Save the calculation to resolve each linked tank wall.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
           </section>
           {detail?.reasons?.length > 0 && (
             <div id="thermal-action-required-panel" className="order-6 rounded-xl border border-red-200 bg-red-50 p-4">
               <div className="flex items-center gap-2 text-sm font-semibold text-red-800"><AlertTriangle className="w-4 h-4" /> Action required</div>
               <ul className="list-disc pl-5 mt-2 text-sm text-red-700 space-y-1">
                 {detail.reasons.map((reason: string, index: number) => (
                   <li key={`${selected?.system_id || 'system'}:${index}:${reason}`}>{reason}</li>
                 ))}
               </ul>
               <ThermalFreshnessDiagnostics item={selected} />
             </div>
           )}
           </>)}
           </section>

          <section className="order-5 space-y-3">
             <h3 className="font-semibold text-stone-900">
               <button
                 type="button"
                 className="flex w-full items-center justify-between gap-3 text-left"
                 aria-expanded={!collapsedSections.operational}
                 aria-controls="thermal-operational-panel"
                 onClick={() => setCollapsedSections(current => ({ ...current, operational: !current.operational }))}
               >
                 <span><span className="mr-2 text-stone-400">03</span>Operational gains and capacity</span>
                 <ChevronDown className={`h-4 w-4 shrink-0 text-stone-500 transition-transform ${collapsedSections.operational ? '' : 'rotate-180'}`} />
               </button>
             </h3>
             {!collapsedSections.operational && <div id="thermal-operational-panel" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ThermalNumericField name="equipment_heat_gain_kw"
                label={hasEquipmentHeatSources ? 'Calculated equipment total' : 'Equipment heat gain'} unit="kW"
                value={hasEquipmentHeatSources ? selected?.source?.equipment_heat_gain_kw ?? form.equipment_heat_gain_kw : form.equipment_heat_gain_kw}
                onChange={event => update('equipment_heat_gain_kw', event.target.value)}
                disabled={readOnly || hasEquipmentHeatSources} />
              <ThermalNumericField name="lighting_power_kw" label="Lighting power" unit="kW"
                value={lightingScheduleIsAvailable ? lightingSchedulePower : form.lighting_power_kw}
                onChange={event => update('lighting_power_kw', event.target.value)}
                disabled={readOnly || lightingScheduleIsAvailable} />
              {lightingScheduleIsAvailable && (
                <p className="sm:col-span-2 lg:col-span-4 -mt-2 text-xs text-[#71808a]">
                  Total of the captured lighting schedule across all linked exhibits; edit the lighting schedule on each exhibit.
                </p>
              )}
              <ThermalNumericField name="lighting_coupling_pct" label="Lighting-to-water coupling" unit="%"
                value={form.lighting_coupling_pct} onChange={event => update('lighting_coupling_pct', event.target.value)} disabled={readOnly} />
              <ThermalNumericField name="capacity_margin_pct" label="Capacity margin" unit="%"
                value={form.capacity_margin_pct} onChange={event => update('capacity_margin_pct', event.target.value)} disabled={readOnly} />
            </div>
            {hasEquipmentHeatSources && <EquipmentHeatGainBreakdown source={selected?.source} />}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.water_exchange_enabled} onChange={e => update('water_exchange_enabled', e.target.checked)} disabled={readOnly} />
              Count an explicit operational water exchange (not LSS circulation)
            </label>
            {form.water_exchange_enabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ThermalNumericField name="water_exchange_flow_m3h" label="Water-exchange flow" unit="m³/h"
                  value={form.water_exchange_flow_m3h} onChange={event => update('water_exchange_flow_m3h', event.target.value)} disabled={readOnly} />
                <ThermalNumericField name="water_exchange_inlet_temperature_c" label="Exchange inlet temperature" unit="°C"
                  value={form.water_exchange_inlet_temperature_c} onChange={event => update('water_exchange_inlet_temperature_c', event.target.value)} disabled={readOnly} />
              </div>
            )}
            <label><span className={labelClass}>Deviation or override justification</span>
              <textarea rows={2} value={form.deviation_justification || ''} onChange={e => update('deviation_justification', e.target.value)}
                disabled={readOnly} className={`${fieldClass} resize-none`} />
            </label>
             </div>}
          </section>

          {detail?.results && (
            <>
              <section className="order-7">
                <h3 className="font-semibold text-stone-900 mb-3">Signed contributions</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(detail.contributions || {}).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-stone-200 px-3 py-2">
                      <div className="text-xs text-stone-500">{key.replace(/_/g, ' ').replace(' kw', '')}</div>
                      <div className={`font-mono font-semibold ${Number(value) > 0 ? 'text-red-700' : Number(value) < 0 ? 'text-[#456b7d]' : 'text-stone-700'}`}>{thermalNumber(value)} kW</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-3 mt-3">
                  {[
                    ['Net envelope', detail.results.net_envelope_kw],
                    ['Total load', detail.results.net_total_load_kw],
                    [thermalActionLabel, thermalActionValue],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-stone-900 text-white px-4 py-3">
                      <div className="text-xs text-stone-300">{label}</div><div className="font-mono text-lg font-bold">{thermalNumber(value)} kW</div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="order-8">
                <h3 className="font-semibold text-stone-900 mb-2">Sensitivity comparison</h3>
                <div className="overflow-x-auto rounded-xl border border-stone-200">
                  <table className="w-full text-sm"><thead className="bg-stone-50"><tr><th className="text-left px-3 py-2">Case</th><th className="text-right px-3 py-2">Cooling</th><th className="text-right px-3 py-2">Heating</th></tr></thead>
                    <tbody className="divide-y divide-stone-100">{(detail.sensitivity_summary?.cases || []).map((item: any) => (
                      <tr key={item.case_key} className={detail.sensitivity_summary?.recommended_case === item.case_key ? 'bg-amber-50' : ''}>
                        <td className="px-3 py-2">{item.description}{detail.sensitivity_summary?.recommended_case === item.case_key && <span className="ml-2 text-xs font-semibold text-amber-700">Conservative sizing case</span>}</td>
                        <td className="px-3 py-2 text-right font-mono">{thermalNumber(item.margin_adjusted_cooling_kw)} kW</td>
                        <td className="px-3 py-2 text-right font-mono">{thermalNumber(item.margin_adjusted_steady_state_heating_kw)} kW</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <div className="order-9 flex justify-end gap-2 border-t border-[#d8d4cb] pt-4">
            <button onClick={() => setSelected(null)} className="px-3 py-2 text-sm font-medium text-[#456b7d]">Close calculation</button>
            {!readOnly && <Button onClick={save} variant="thermal" disabled={saving || !form.agitation_correlation_id}><Calculator className="mr-1.5 h-4 w-4" />{saving ? 'Calculating…' : 'Save & recalculate'}</Button>}
          </div>
          </div>
          {readOnly && <p className="text-xs text-stone-500 text-right">This calculation is part of the frozen Design Book package and is read-only.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function DesignBookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(state => state.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: Tab = isDesignBookTab(tabParam) ? tabParam : 'exhibits';
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [showNewExhibit, setShowNewExhibit] = useState(false);
  const [showNewLSS, setShowNewLSS] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [showNewRevision, setShowNewRevision] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const { data: book, isLoading } = useQuery({
    queryKey: ['design-book', id],
    queryFn: () => api.get(`/design-books/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-select'],
    queryFn: () => api.get('/projects').then(r => r.data),
    enabled: editMode,
    staleTime: 60_000,
  });
  const projects: any[] = projectsData?.items || [];

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['design-book', id] }),
      qc.invalidateQueries({ queryKey: ['design-book-release-preflight', id] }),
    ]);
  };

  const handleTabChange = (nextTab: Tab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', nextTab);
    setSearchParams(nextParams);
  };

  if (isLoading) return <div className="p-8 text-center text-stone-400">Loading…</div>;
  if (!book) return <div className="p-8 text-center text-stone-500">Design book not found.</div>;

  const exhibits: any[] = book.exhibits || [];
  const tanks: any[] = book.tanks || [];
  const systems: any[] = book.systems || [];
  const isReleased = book.status === 'Released';
  const isDesignReadOnly = !['Draft', 'In Progress'].includes(book.status);
  const isDesigner = user?.role === 'admin' || user?.role === 'engineer';
  const isManager = user?.role === 'admin' || user?.role === 'hq_manager' || user?.role === 'pmo';
  const canSubmitReview = isDesigner && (book.status === 'Draft' || book.status === 'In Progress');
  const canApprove = isManager && book.status === 'For Review';
  const canRelease = isManager && book.status === 'Approved';

  const exhibitMap = new Map<string | null, any[]>();
  for (const t of tanks) {
    const key = t.exhibit_id || null;
    if (!exhibitMap.has(key)) exhibitMap.set(key, []);
    exhibitMap.get(key)!.push(t);
  }

  const totalTanks = tanks.length;
  const totalGross = tanks.reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);
  const marineVol = tanks
    .filter((t: any) => { const wt = (t.exhibit_water_type || t.water_type || '').toLowerCase(); return wt.includes('marine') || wt.includes('salt'); })
    .reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);
  const freshVol = tanks
    .filter((t: any) => { const wt = (t.exhibit_water_type || t.water_type || '').toLowerCase(); return wt.includes('fresh'); })
    .reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/design-books/${id}`, editForm);
      toast.success('Design book updated');
      qc.invalidateQueries({ queryKey: ['design-book', id] });
      qc.invalidateQueries({ queryKey: ['design-books'] });
      setEditMode(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitReview = async () => {
    const response = window.prompt('Optional note for the reviewer:', '');
    if (response === null) return;
    const comment = response;
    setTransitioning(true);
    try {
      await api.post(`/design-books/${id}/submit-review`, { comment });
      toast.success('Design Book submitted for review');
      refresh();
      qc.invalidateQueries({ queryKey: ['design-books'] });
      qc.invalidateQueries({ queryKey: ['audit', 'design_book', id] });
      qc.invalidateQueries({ queryKey: ['lifecycle', 'design_book', id] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to submit for review');
    } finally {
      setTransitioning(false);
    }
  };

  const handleApprove = async () => {
    const response = window.prompt('Optional approval notes or conditions:', '');
    if (response === null) return;
    const approvalNotes = response;
    setTransitioning(true);
    try {
      await api.post(`/design-books/${id}/approve`, { approval_notes: approvalNotes });
      toast.success('Design Book approved');
      refresh();
      qc.invalidateQueries({ queryKey: ['design-books'] });
      qc.invalidateQueries({ queryKey: ['audit', 'design_book', id] });
      qc.invalidateQueries({ queryKey: ['lifecycle', 'design_book', id] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to approve Design Book');
    } finally {
      setTransitioning(false);
    }
  };

  const startEdit = () => {
    if (isDesignReadOnly) return;
    setEditForm({
      book_title: book.book_title,
      project_id: book.project_id || '',
      description: book.description || '',
      revision: book.revision || 'A',
      notes: book.notes || '',
    });
    setEditMode(true);
  };

  const tabLabels: Record<Tab, string> = {
    exhibits: 'Exhibits',
    lss: 'Life Support Systems',
    thermal: 'Thermal',
    piping: 'Friction Loss',
    review: 'Review & Handover',
    versions: 'Versions',
  };
  const TABS: { key: Tab; label: string; count?: number }[] = DESIGN_BOOK_TAB_ORDER.map(key => ({
    key,
    label: tabLabels[key],
    ...(['exhibits', 'lss', 'thermal', 'piping'].includes(key)
      ? { count: key === 'exhibits' ? exhibits.length : key === 'thermal' ? (book.thermal_calculations || []).length : key === 'piping' ? (book.friction_loss_calculations || []).length : systems.length }
      : {}),
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* New Exhibit Modal */}
      {showRelease && (
        <ReleaseModal
          book={book}
          onClose={() => setShowRelease(false)}
          onReleased={() => {
            setShowRelease(false);
            refresh();
            qc.invalidateQueries({ queryKey: ['design-books'] });
          }}
        />
      )}
      {showNewRevision && (
        <NewRevisionModal book={book} onClose={() => setShowNewRevision(false)} />
      )}
      {showNewExhibit && book.project_id && !isDesignReadOnly && (
        <NewExhibitModal
          projectId={book.project_id}
          exhibits={exhibits}
          onClose={() => setShowNewExhibit(false)}
          onCreated={() => { setShowNewExhibit(false); refresh(); }}
        />
      )}
      {/* New LSS Modal */}
      {showNewLSS && book.project_id && !isDesignReadOnly && (
        <NewLSSModal
          projectId={book.project_id}
          bookId={book.id}
          exhibits={exhibits}
          hydraulics={book.hydraulics || []}
          tanks={book.tanks || []}
          calculations={book.engineering_calculations?.exhibits || []}
          onClose={() => setShowNewLSS(false)}
          onCreated={() => { setShowNewLSS(false); refresh(); }}
        />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link to="/design-book-engine" className="hover:text-blue-600 transition-colors">Design Book Engine</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to="/design-books" className="hover:text-blue-600 transition-colors">Design Books</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-stone-800 font-medium">{book.book_code}</span>
      </nav>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-5">
        {editMode ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Title</label>
                <input type="text" value={editForm.book_title}
                  onChange={e => setEditForm((f: any) => ({ ...f, book_title: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Linked Project</label>
                <select value={editForm.project_id}
                  onChange={e => setEditForm((f: any) => ({ ...f, project_id: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                  <option value="">— Standalone —</option>
                  {projects.map((p: any) => <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Description</label>
              <textarea value={editForm.description} rows={2} onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Revision</label>
                <input type="text" value={editForm.revision} onChange={e => setEditForm((f: any) => ({ ...f, revision: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Workflow status</label>
                <div className="w-full border border-stone-100 rounded-lg px-3 py-2 text-sm bg-stone-50 text-stone-600">
                  {book.status} · changed through review actions
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-stone-100">
              <button onClick={() => setEditMode(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-600 hover:text-stone-800">
                <X className="w-4 h-4" /> Cancel
              </button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4 mr-1.5" />{saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0">
                <BookMarked className="w-6 h-6 text-violet-600" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                  <EntityCode code={book.book_code} />
                  <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">Rev {book.revision}</span>
                  <StatusBadge status={book.status} />
                </div>
                <h1 className="text-xl font-bold text-stone-900">{book.book_title}</h1>
                {book.description && <p className="text-stone-500 text-sm mt-1">{book.description}</p>}
                {book.project_code && (
                  <Link
                    to={`/projects/${book.project_id}`}
                    className="inline-flex items-center gap-1.5 mt-2 text-sm text-blue-600 hover:text-blue-700"
                    onClick={e => e.stopPropagation()}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {book.project_code} — {book.project_name}
                    {book.client_name && <span className="text-stone-500"> · {book.client_name}</span>}
                  </Link>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isReleased ? (
                isDesigner && (
                  <button onClick={() => setShowNewRevision(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium">
                    <GitFork className="w-3.5 h-3.5" /> Create New Revision
                  </button>
                )
              ) : (
                <>
                  {canSubmitReview && (
                    <button onClick={handleSubmitReview} disabled={transitioning}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
                      <Send className="w-3.5 h-3.5" /> Submit for Review
                    </button>
                  )}
                  {canApprove && (
                    <button onClick={handleApprove} disabled={transitioning}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium disabled:opacity-50">
                      <UserCheck className="w-3.5 h-3.5" /> Approve
                    </button>
                  )}
                  {canRelease && (
                    <button onClick={() => setShowRelease(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" /> Release
                    </button>
                  )}
                  {isDesigner && (
                    <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {isReleased && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-start gap-3">
          <LockKeyhole className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-emerald-900">Released revision — read-only</p>
            <p className="text-sm text-emerald-800 mt-0.5">
              Released {book.released_at ? new Date(book.released_at).toLocaleString() : ''}
              {book.released_by_name ? ` by ${book.released_by_name}` : ''}. The package below is the immutable release snapshot.
            </p>
            {book.release_scope?.length > 0 && (
              <p className="text-xs text-emerald-700 mt-1">Scope: {book.release_scope.join(', ')}</p>
            )}
            {book.release_notes && <p className="text-sm text-emerald-900 mt-2 italic">“{book.release_notes}”</p>}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {book.project_id && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Exhibits', value: exhibits.length, icon: <Layers className="w-4 h-4 text-blue-500" /> },
            { label: 'Total Tanks', value: totalTanks, icon: <FlaskConical className="w-4 h-4 text-violet-500" /> },
            { label: 'Total Volume', value: `${totalGross.toFixed(2)} m³`, icon: <Droplets className="w-4 h-4 text-cyan-600" /> },
            { label: 'Marine / Fresh', value: `${marineVol.toFixed(1)} / ${freshVol.toFixed(1)} m³`, icon: <Waves className="w-4 h-4 text-teal-500" /> },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-stone-200 px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-stone-50 flex items-center justify-center">{c.icon}</div>
              <div>
                <div className="text-xs text-stone-500">{c.label}</div>
                <div className="font-semibold text-stone-800 text-sm">{c.value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b border-stone-200 mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-500'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'exhibits' && (
        <ExhibitsTab
          book={book}
          exhibits={exhibits}
          tanks={tanks}
          exhibitMap={exhibitMap}
          onRefresh={refresh}
          onNewExhibit={() => !isDesignReadOnly && setShowNewExhibit(true)}
          canPromote={isDesigner && !isDesignReadOnly && user?.moduleAccess?.pim !== 'view' && user?.moduleAccess?.pim !== 'hidden'}
          readOnly={isDesignReadOnly}
        />
      )}

      {tab === 'lss' && <LSSTab book={book} onNewLSS={() => !isDesignReadOnly && setShowNewLSS(true)} readOnly={isDesignReadOnly} />}

      {tab === 'thermal' && (
        <ThermalTab
          book={book}
          readOnly={isDesignReadOnly}
          canManageLibrary={isDesigner &&
            user?.moduleAccess?.design_books !== 'view' &&
            user?.moduleAccess?.design_books !== 'hidden'}
          onRefresh={refresh}
        />
      )}

      {tab === 'piping' && (
        <FrictionLossTab book={book} readOnly={isDesignReadOnly} onRefresh={refresh} />
      )}

      {tab === 'review' && (
        <ReviewWorkflowTab
          book={book}
          canRecordHandover={(isDesigner || isManager) && book.status === 'For Review'}
          onRefresh={refresh}
        />
      )}

      {tab === 'versions' && (
        <VersionsTab bookId={id!} onBookRefresh={refresh} readOnly={isDesignReadOnly} />
      )}
    </div>
  );
}

export function thermalWallBasesAreMixed(bases: any[]) {
  return new Set((bases || []).map(basis => [
    String(basis?.construction_type || basis?.code || ''),
    String(basis?.material || ''),
    Number(basis?.thickness_mm),
    Number(basis?.conductivity_w_m_k),
    Number(basis?.u_value_w_m2_k),
  ].join('|'))).size > 1;
}

function thermalExhibitTankWallBasisLegacy(source: any, constructions: any[]) {
  const tank = source?.linked_tanks?.find((item: any) =>
    Number(item?.wall_thickness_mm) > 0 && String(item?.wall_material || '').trim());
  if (!tank) return null;
  const construction = thermalWallConstructionForMaterial(constructions, tank.wall_material);
  const conductivity = Number(construction?.conductivity_w_m_k);
  const thicknessMm = Number(tank.wall_thickness_mm);
  if (!construction || !(conductivity > 0) || !(thicknessMm > 0)) return null;
  const materialResistance = thicknessMm / 1000 / conductivity;
  const overallResistance = 1 / 150 + materialResistance + 1 / 5;
  return normalizeThermalWallConstruction({
    ...construction,
    material: tank.wall_material,
    thickness_mm: thicknessMm,
    material_resistance_m2_k_w: materialResistance,
    material_u_value_w_m2_k: 1 / materialResistance,
    overall_resistance_m2_k_w: overallResistance,
    u_value_w_m2_k: 1 / overallResistance,
    assumption_label: `Exhibit tank wall — ${tank.wall_material}, ${thicknessMm} mm`,
    source_basis: 'Linked exhibit tank with governed material conductivity',
    source_reference: tank.tank_code || tank.tank_id || construction.source_reference,
  });
}

export function ThermalWallBasisChangeNotice({ change }: { change: any }) {
  if (!change?.changed) return null;
  const renderBasis = (title: string, basis: any, tone: string) => {
    const layers = thermalWallBasisLayers(basis);
    return <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <div><span className="block text-xs opacity-70">Basis version</span><b className="font-mono">{thermalWallBasisValue(basis, 'basis_version') || '—'}</b></div>
        <div><span className="block text-xs opacity-70">Conductivity</span><b className="font-mono">{thermalNumber(thermalWallBasisValue(basis, 'conductivity_w_m_k'), 4)} W/m·K</b></div>
        <div><span className="block text-xs opacity-70">Material</span><b>{thermalWallBasisValue(basis, 'material') || '—'}</b></div>
        <div><span className="block text-xs opacity-70">Thickness</span><b className="font-mono">{thermalNumber(thermalWallBasisValue(basis, 'thickness_mm'), 2)} mm</b></div>
        <div><span className="block text-xs opacity-70">Source basis</span><b>{basis?.source_basis || '—'}</b></div>
        <div><span className="block text-xs opacity-70">Source reference</span><b>{basis?.source_reference || '—'}</b></div>
      </div>
      {!!layers.length && (
        <div className="mt-3 rounded-lg border border-current/15 bg-white/60 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Wall layer stack</p>
          <div className="mt-1 divide-y divide-current/10">
            {layers.map((layer: any, index: number) => (
              <div key={layer.key || index} className="grid gap-1 py-1.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <span>{layer.scope ? `${layer.scope} · ` : ''}{layer.material || `Layer ${index + 1}`}</span>
                <span className="font-mono">{thermalNumber(
                  layer.thickness_mm ?? (layer.thickness_m == null ? null : Number(layer.thickness_m) * 1000),
                  2,
                )} mm</span>
                <span className="font-mono">{thermalNumber(layer.conductivity_w_m_k, 4)} W/m·K</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!!basis?.tank_bases?.length && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-current/15 bg-white/60">
          <table className="w-full min-w-[460px] text-xs">
            <thead className="border-b border-current/15 text-left uppercase tracking-wide opacity-70">
              <tr><th className="px-2 py-1.5">Tank</th><th className="px-2 py-1.5">Material</th><th className="px-2 py-1.5">Thickness</th><th className="px-2 py-1.5">Conductivity</th><th className="px-2 py-1.5">Version</th></tr>
            </thead>
            <tbody className="divide-y divide-current/10">
              {basis.tank_bases.map((tank: any, index: number) => (
                <tr key={tank.tank_id || tank.tank_code || index}>
                  <td className="px-2 py-1.5 font-medium">{tank.tank_code || tank.tank_id || 'Linked tank'}</td>
                  <td className="px-2 py-1.5">{tank.material || '—'}</td>
                  <td className="px-2 py-1.5 font-mono">{thermalNumber(tank.thickness_mm, 2)} mm</td>
                  <td className="px-2 py-1.5 font-mono">{thermalNumber(tank.conductivity_w_m_k, 4)} W/m·K</td>
                  <td className="px-2 py-1.5 font-mono">{tank.basis_version || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  };
  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div>
          <p className="font-semibold">Approved Thermal wall basis changed</p>
          <p className="mt-1 text-sm text-amber-900/80">
            This saved calculation is stale because governed wall evidence changed: {change.changed_fields.join(', ')}. Review both snapshots before saving a recalculation.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {renderBasis('Saved wall evidence', change.saved, 'border-amber-200 bg-amber-100/60 text-amber-950')}
        {renderBasis('Current approved basis', change.current, 'border-[#b9c9d0] bg-[#e8f0f2] text-[#263746]')}
      </div>
    </div>
  );
}

const THERMAL_SOURCE_DIAGNOSTIC_LABELS: Record<string, string> = {
  linked_exhibits: 'Linked exhibits',
  linked_tanks: 'Linked tanks and geometry',
  water_temperature_sources: 'Exhibit water temperatures',
  effective_volume_sources: 'Effective water volumes',
  circulation_flows: 'Exhibit circulation flows',
  lighting_sources: 'Exhibit lighting',
  lighting_power_kw: 'Total lighting power',
  equipment_heat_sources: 'Pump and UV heat sources',
  equipment_heat_gain_kw: 'Total equipment heat',
  lss_circulation_flow_m3h: 'LSS design circulation flow',
  duplicate_exhibit_ids: 'Duplicate exhibit relationships',
  wall_construction_defaults: 'Governed wall construction defaults',
};

function stableThermalDiagnosticValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableThermalDiagnosticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((normalized: Record<string, any>, key) => {
    normalized[key] = stableThermalDiagnosticValue(value[key]);
    return normalized;
  }, {});
}

function thermalComparableSource(source: any) {
  if (!source) return source;
  const {
    fingerprint: _fingerprint,
    wall_construction_basis: _wallConstructionBasis,
    ...comparable
  } = source;
  return {
    ...comparable,
    linked_tanks: (comparable.linked_tanks || []).map((tank: any) => {
      const {
        wall_construction_basis: _tankWallConstructionBasis,
        exposed_wall_source: _exposedWallSource,
        ...tankGeometry
      } = tank;
      return tankGeometry;
    }),
  };
}

function thermalSourceDiagnosticChanges(savedSource: any, currentSource: any) {
  if (!savedSource || !currentSource) return [];
  const keys = [...new Set([
    ...Object.keys(savedSource),
    ...Object.keys(currentSource),
  ])].filter(key => key !== 'fingerprint').sort();
  return keys.filter(key =>
    JSON.stringify(stableThermalDiagnosticValue(savedSource[key])) !==
    JSON.stringify(stableThermalDiagnosticValue(currentSource[key])));
}

function thermalDiagnosticJson(value: any) {
  if (value === undefined) return 'Not present';
  return JSON.stringify(stableThermalDiagnosticValue(value), null, 2);
}

export function ThermalFreshnessDiagnostics({ item }: { item: any }) {
  const savedSource = item?.saved?.source_snapshot ||
    item?.calculation?.source_snapshot ||
    item?.result_snapshot?.source_snapshot ||
    null;
  const currentSource = item?.source || null;
  const savedComparableSource = thermalComparableSource(savedSource);
  const currentComparableSource = thermalComparableSource(currentSource);
  const savedWallBasis = item?.saved?.result_snapshot?.wall_construction_basis ||
    item?.calculation?.wall_construction_basis ||
    savedSource?.wall_construction_basis ||
    null;
  const currentWallBasis = item?.current_preview?.wall_construction_basis ||
    item?.current_preview?.source_snapshot?.wall_construction_basis ||
    null;
  const savedFingerprint = item?.saved?.source_fingerprint ||
    item?.calculation?.source_fingerprint ||
    item?.result_snapshot?.source_fingerprint ||
    null;
  const currentFingerprint = item?.source?.fingerprint ||
    item?.source_fingerprint ||
    null;
  const savedVersion = item?.saved?.calculation_version ||
    item?.calculation?.calculation_version ||
    item?.result_snapshot?.calculation_version ||
    null;
  const currentVersion = item?.current_preview?.calculation_version || null;
  const changedKeys = thermalSourceDiagnosticChanges(
    savedComparableSource,
    currentComparableSource,
  );
  const fingerprintsMatch = !!savedFingerprint && !!currentFingerprint &&
    savedFingerprint === currentFingerprint;
  const versionsMatch = !!savedVersion && !!currentVersion && savedVersion === currentVersion;

  return (
    <details className="mt-3 rounded-lg border border-red-200 bg-white/70">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-red-800">
        Show freshness diagnostics
        {changedKeys.length > 0 ? ` (${changedKeys.length} changed source ${changedKeys.length === 1 ? 'category' : 'categories'})` : ''}
      </summary>
      <div className="space-y-3 border-t border-red-200 px-3 py-3 text-xs text-stone-700">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-stone-200 bg-white p-2">
            <span className="block font-semibold text-stone-600">Saved fingerprint</span>
            <code className="break-all">{savedFingerprint || 'Unavailable'}</code>
          </div>
          <div className="rounded-md border border-stone-200 bg-white p-2">
            <span className="block font-semibold text-stone-600">Current fingerprint</span>
            <code className="break-all">{currentFingerprint || 'Unavailable'}</code>
          </div>
          <div className="rounded-md border border-stone-200 bg-white p-2">
            <span className="block font-semibold text-stone-600">Saved calculation version</span>
            <code>{savedVersion || 'Unavailable'}</code>
          </div>
          <div className="rounded-md border border-stone-200 bg-white p-2">
            <span className="block font-semibold text-stone-600">Current calculation version</span>
            <code>{currentVersion || 'Unavailable'}</code>
          </div>
        </div>

        {fingerprintsMatch && versionsMatch && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
            The saved and current fingerprints and calculation versions match. This warning is likely stale browser state rather than a current engineering-source change.
          </p>
        )}

        {(savedWallBasis || currentWallBasis) && (
          <details className="rounded-md border border-stone-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 font-semibold text-stone-800">
              Wall construction basis
            </summary>
            <div className="grid gap-2 border-t border-stone-200 p-2 lg:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold text-stone-500">Saved resolved basis</p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-100 p-2 font-mono text-[11px]">{thermalDiagnosticJson(savedWallBasis)}</pre>
              </div>
              <div>
                <p className="mb-1 font-semibold text-stone-500">Current resolved basis</p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-100 p-2 font-mono text-[11px]">{thermalDiagnosticJson(currentWallBasis)}</pre>
              </div>
            </div>
          </details>
        )}

        {!savedSource || !currentSource ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">
            The saved or current source snapshot is unavailable, so the changed category cannot be identified.
          </p>
        ) : changedKeys.length === 0 ? (
          <p className="rounded-md border border-stone-200 bg-stone-50 p-2">
            No saved-versus-current source category differs. Check the calculation-version values above.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="font-semibold text-red-800">Changed source categories</p>
            {changedKeys.map(key => (
              <details key={key} className="rounded-md border border-stone-200 bg-white">
                <summary className="cursor-pointer px-3 py-2 font-semibold text-stone-800">
                  {THERMAL_SOURCE_DIAGNOSTIC_LABELS[key] || key.replace(/_/g, ' ')}
                </summary>
                <div className="grid gap-2 border-t border-stone-200 p-2 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 font-semibold text-stone-500">Saved</p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-100 p-2 font-mono text-[11px]">{thermalDiagnosticJson(savedComparableSource[key])}</pre>
                  </div>
                  <div>
                    <p className="mb-1 font-semibold text-stone-500">Current</p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-100 p-2 font-mono text-[11px]">{thermalDiagnosticJson(currentComparableSource[key])}</pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
