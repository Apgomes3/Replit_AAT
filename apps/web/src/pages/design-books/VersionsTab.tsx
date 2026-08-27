import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Database,
  Fish, GitBranch, Layers, LinkIcon, Plus, RotateCcw, Save, ShieldCheck,
  User, Waves, X,
} from 'lucide-react';
import toast from 'react-hot-toast';

function fmtDate(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${
    date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }`;
}

function countDrift(drift: any) {
  const collections = Object.values(drift?.collections || {}) as any[];
  return collections.reduce(
    (total, item) => total + (item.added?.length || 0) + (item.removed?.length || 0) + (item.changed?.length || 0),
    drift?.project_changed ? 1 : 0,
  );
}

function ScopeSummary({ version }: { version: any }) {
  const summary = version.summary || {};
  const frozen = summary.frozen_records || {};
  const live = summary.live_references || {};
  const driftCount = countDrift(version.drift);
  const unresolved = version.drift?.unresolved_references?.length || 0;
  return (
    <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-3.5 h-3.5 text-violet-600" />
          <p className="text-xs font-semibold text-stone-700">Frozen and restorable</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill icon={<Fish className="w-3 h-3" />} text={`${frozen.species || 0} species rows`} />
          <Pill icon={<Waves className="w-3 h-3" />} text={`${frozen.hydraulics || 0} hydraulic records`} />
          <Pill icon={<Layers className="w-3 h-3" />} text={`${frozen.substrate_theming || 0} substrate/theming records`} />
          {frozen.review_handovers == null
            ? <Pill icon={<Database className="w-3 h-3" />} text="Handovers preserved (older snapshot)" blue />
            : <Pill icon={<Database className="w-3 h-3" />} text={`${frozen.review_handovers} review handovers`} />}
          <Pill icon={<Database className="w-3 h-3" />} text="Book metadata" />
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <LinkIcon className="w-3.5 h-3.5 text-blue-600" />
          <p className="text-xs font-semibold text-stone-700">Live project references — never overwritten</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill icon={<Layers className="w-3 h-3" />} text={`${live.exhibits || 0} exhibits`} blue />
          <Pill icon={<Database className="w-3 h-3" />} text={`${live.tanks || 0} tanks`} blue />
          <Pill icon={<Waves className="w-3 h-3" />} text={`${live.systems || 0} LSS systems`} blue />
          <Pill icon={<LinkIcon className="w-3 h-3" />} text={`${live.system_links || 0} exhibit-system links`} blue />
        </div>
      </div>
      <div className={`rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${
        unresolved ? 'bg-red-50 border-red-200 text-red-700'
          : driftCount ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
      }`}>
        {unresolved || driftCount
          ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          : <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
        <span>
          {unresolved
            ? `${unresolved} referenced project record${unresolved === 1 ? '' : 's'} no longer exist. Restore is blocked.`
            : driftCount
              ? `${driftCount} live project reference change${driftCount === 1 ? '' : 's'} detected since this version.`
              : 'No project-reference drift detected.'}
        </span>
      </div>
      <p className="text-[11px] text-stone-400">
        Snapshot schema {summary.schema_version || 1} · integrity {
          summary.integrity === 'verified' ? 'verified'
            : summary.integrity === 'invalid' ? 'failed'
              : 'not available for this older version'
        } · captured {fmtDate(summary.captured_at || version.created_at)}
      </p>
    </div>
  );
}

function Pill({ icon, text, blue = false }: { icon: React.ReactNode; text: string; blue?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 border rounded-md text-xs ${
      blue ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-stone-50 border-stone-200 text-stone-600'
    }`}>
      {icon}{text}
    </span>
  );
}

function VersionCard({ version, latest, onRestore, restoring, readOnly }: {
  version: any;
  latest: boolean;
  onRestore: (version: any) => void;
  restoring: boolean;
  readOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const unresolved = version.drift?.unresolved_references?.length || 0;
  const integrityFailed = version.summary?.integrity === 'invalid';
  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${latest ? 'border-violet-200 shadow-sm' : 'border-stone-200'}`}>
      <div className="flex items-start gap-4 px-5 py-4">
        <div className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${latest ? 'bg-violet-100' : 'bg-stone-100'}`}>
          <span className={`text-sm font-bold tabular-nums ${latest ? 'text-violet-700' : 'text-stone-600'}`}>
            v{version.version_number}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-stone-800 text-sm">
              {version.version_label || <span className="text-stone-400 font-normal italic">Untitled snapshot</span>}
            </span>
            {latest && <Badge text="Latest" color="violet" />}
            {version.is_recovery_checkpoint && <Badge text="Recovery checkpoint" color="blue" />}
            {version.drift?.has_drift && <Badge text={unresolved ? 'Unresolved references' : 'Project drift'} color={unresolved ? 'red' : 'amber'} />}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-stone-400 flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDate(version.created_at)}</span>
            {version.created_by_name && <span className="text-xs text-stone-400 flex items-center gap-1"><User className="w-3 h-3" />{version.created_by_name}</span>}
          </div>
          {version.notes && <p className="text-xs text-stone-500 mt-1.5 italic leading-relaxed">{version.notes}</p>}
          {expanded && <ScopeSummary version={version} />}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setExpanded(value => !value)}
            className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 px-2 py-1.5 rounded-lg">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? 'Hide detail' : 'View detail'}
          </button>
          {!readOnly && (
            <button onClick={() => onRestore(version)}
              disabled={restoring || unresolved > 0 || integrityFailed}
              title={unresolved ? 'Restore is blocked because referenced project records are missing' : 'Preview and restore this version'}
              className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-violet-700 border border-stone-200 hover:border-violet-300 bg-white px-2.5 py-1.5 rounded-lg disabled:opacity-40 font-medium">
              <RotateCcw className="w-3.5 h-3.5" />{restoring ? 'Restoring…' : 'Restore'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: 'violet' | 'blue' | 'amber' | 'red' }) {
  const colors = {
    violet: 'bg-violet-100 text-violet-700 border-violet-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
    red: 'bg-red-100 text-red-700 border-red-200',
  };
  return <span className={`text-[10px] border px-1.5 py-0.5 rounded-full font-semibold ${colors[color]}`}>{text}</span>;
}

function PreviewColumn({ title, data, after = false }: { title: string; data: any; after?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${after ? 'border-violet-200 bg-violet-50/50' : 'border-stone-200 bg-stone-50'}`}>
      <p className="text-xs uppercase tracking-wide font-semibold text-stone-500 mb-2">{title}</p>
      <p className="text-sm font-semibold text-stone-800">{data?.book_title || 'Untitled'}</p>
      <p className="text-xs text-stone-500 mt-0.5">Revision {data?.revision || '—'} · {data?.status || '—'}</p>
      <div className="grid grid-cols-4 gap-2 mt-3 text-center">
        <PreviewCount label="Species" value={data?.species || 0} />
        <PreviewCount label="Hydraulics" value={data?.hydraulics || 0} />
        <PreviewCount label="Theming" value={data?.substrate_theming || 0} />
        <PreviewCount label={data?.review_handovers_preserved ? 'Handovers kept' : 'Handovers'} value={data?.review_handovers || 0} />
      </div>
    </div>
  );
}

function PreviewCount({ label, value }: { label: string; value: number }) {
  return <div><p className="font-semibold text-stone-800">{value}</p><p className="text-[10px] text-stone-400">{label}</p></div>;
}

export default function VersionsTab({ bookId, onBookRefresh, readOnly = false }: {
  bookId: string;
  onBookRefresh: () => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ version_label: '', notes: '' });
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<any | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['design-book-versions', bookId],
    queryFn: () => api.get(`/design-books/${bookId}/versions`).then(response => response.data),
    enabled: Boolean(bookId),
  });
  const versions: any[] = data?.items || [];

  const createVersion = async () => {
    setCreating(true);
    try {
      await api.post(`/design-books/${bookId}/versions`, {
        version_label: form.version_label.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast.success(form.version_label.trim() ? `Version "${form.version_label.trim()}" saved` : 'Version saved');
      setForm({ version_label: '', notes: '' });
      setShowCreate(false);
      await refetch();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to create version');
    } finally {
      setCreating(false);
    }
  };

  const restoreVersion = async (version: any) => {
    setRestoringId(version.id);
    try {
      await api.post(`/design-books/${bookId}/versions/${version.id}/restore`, {
        preview_token: version.restore_preview?.token,
      });
      toast.success(`Restored to v${version.version_number}; recovery checkpoint created`);
      setConfirmVersion(null);
      onBookRefresh();
      queryClient.invalidateQueries({ queryKey: ['audit', 'design_book', bookId] });
      await refetch();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Restore failed; the current design was not changed');
    } finally {
      setRestoringId(null);
    }
  };

  const previewVersion = async (version: any) => {
    setPreviewingId(version.id);
    try {
      const response = await api.get(`/design-books/${bookId}/versions/${version.id}/preview`);
      setConfirmVersion(response.data);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Could not prepare the restore preview');
    } finally {
      setPreviewingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {confirmVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xl p-6 max-w-2xl w-full max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center"><RotateCcw className="w-5 h-5 text-violet-600" /></div>
                <div>
                  <p className="font-semibold text-stone-800">Preview restore to Version {confirmVersion.version_number}</p>
                  <p className="text-xs text-stone-500">The working copy will be updated in one transaction.</p>
                </div>
              </div>
              <button onClick={() => setConfirmVersion(null)}><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <PreviewColumn title="Before · current working copy" data={confirmVersion.restore_preview?.before} />
              <PreviewColumn title={`After · version ${confirmVersion.version_number}`} data={confirmVersion.restore_preview?.after} after />
            </div>
            <div className="mt-4"><ScopeSummary version={confirmVersion} /></div>
            <p className="text-[11px] text-stone-400 mt-2">
              Preview generated {confirmVersion.restore_preview?.generated_at ? fmtDate(confirmVersion.restore_preview.generated_at) : 'just now'}.
              If the working copy changes, restore will stop and require a refreshed preview.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 my-5 text-xs text-blue-700">
              A recovery checkpoint of the current working copy is created first. Project exhibits, tanks, systems, and exhibit-system links stay live and are not overwritten.
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmVersion(null)} className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50">Cancel</button>
              <button onClick={() => restoreVersion(confirmVersion)} disabled={restoringId === confirmVersion.id}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium disabled:opacity-50">
                <RotateCcw className="w-4 h-4" />{restoringId === confirmVersion.id ? 'Restoring atomically…' : 'Create checkpoint & restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-stone-700">Design Book Versions</span>
          {versions.length > 0 && <span className="text-xs bg-violet-100 text-violet-700 rounded-full px-2 py-0.5 font-medium">{versions.length}</span>}
        </div>
        {!readOnly && !showCreate && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-sm text-violet-700 border border-violet-200 bg-white hover:bg-violet-50 px-3 py-1.5 rounded-lg font-medium">
            <Plus className="w-3.5 h-3.5" /> Create Version
          </button>
        )}
      </div>

      {showCreate && (
        <div className="bg-violet-50/60 border border-violet-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-semibold text-violet-800">New Version Snapshot</p><p className="text-xs text-violet-600 mt-0.5">Freeze Design Book records and capture project references for drift checks.</p></div>
            <button onClick={() => setShowCreate(false)}><X className="w-4 h-4 text-stone-400" /></button>
          </div>
          <input value={form.version_label} onChange={event => setForm(current => ({ ...current, version_label: event.target.value }))}
            placeholder="Version label (optional)" autoFocus
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white" />
          <textarea rows={2} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
            placeholder="Key decisions or milestone context (optional)"
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white resize-none" />
          <div className="bg-white border border-stone-200 rounded-lg px-3 py-2 text-xs text-stone-500">
            Restorable: metadata, species, hydraulics, substrate and theming. Live references: project, exhibits, tanks, LSS systems and links.
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="text-sm text-stone-500 px-3 py-1.5 rounded-lg border border-stone-200 bg-white">Cancel</button>
            <button onClick={createVersion} disabled={creating}
              className="flex items-center gap-1.5 text-sm text-white bg-violet-600 hover:bg-violet-700 px-4 py-1.5 rounded-lg font-medium disabled:opacity-50">
              <Save className="w-3.5 h-3.5" />{creating ? 'Saving atomically…' : 'Save Version'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-stone-400 text-sm">Loading versions…</div>
      ) : versions.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 py-16 text-center">
          <GitBranch className="w-10 h-10 text-stone-200 mx-auto mb-3" />
          <p className="text-stone-500 font-medium">No versions yet</p>
          <p className="text-stone-400 text-sm mt-1 max-w-md mx-auto">Create a verified, restorable milestone before design review or exploration.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((version, index) => (
            <VersionCard key={version.id} version={version} latest={index === 0}
              onRestore={previewVersion} restoring={restoringId === version.id || previewingId === version.id} readOnly={readOnly} />
          ))}
        </div>
      )}
    </div>
  );
}