import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import {
  GitBranch, Plus, RotateCcw, Clock, User, Save, X,
  ChevronDown, ChevronUp, Fish, Layers, Waves, Database,
} from 'lucide-react';
import toast from 'react-hot-toast';

function fmtDate(d: string) {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

function SnapSummary({ snap }: { snap: any }) {
  const exhibits: any[] = snap.exhibits || [];
  const tanks: any[] = snap.tanks || [];
  const species: any[] = snap.species || [];
  const hydraulics: any[] = snap.hydraulics || [];
  const substrate: any[] = snap.substrate || [];
  const systems: any[] = snap.systems || [];

  const totalVol = tanks.reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);

  const pills = [
    { icon: <Layers className="w-3 h-3" />, label: `${exhibits.length} exhibit${exhibits.length !== 1 ? 's' : ''}` },
    { icon: <Database className="w-3 h-3" />, label: `${tanks.length} tank${tanks.length !== 1 ? 's' : ''} · ${totalVol.toFixed(2)} m³` },
    { icon: <Fish className="w-3 h-3" />, label: `${species.length} species row${species.length !== 1 ? 's' : ''}` },
    { icon: <Waves className="w-3 h-3" />, label: `${hydraulics.length} hydraulic${hydraulics.length !== 1 ? 's' : ''}` },
  ].filter(p => p !== null);

  return (
    <div className="mt-3 pt-3 border-t border-violet-100">
      <p className="text-xs font-medium text-stone-500 mb-2">Snapshot contains</p>
      <div className="flex flex-wrap gap-2">
        {pills.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-stone-50 border border-stone-200 rounded-md text-xs text-stone-600">
            {p.icon} {p.label}
          </span>
        ))}
        {substrate.some((s: any) => s.substrate_type && s.substrate_type !== 'None') && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
            Substrate data
          </span>
        )}
        {systems.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
            {systems.length} LSS system{systems.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="text-xs text-stone-400 mt-2 italic">
        Snapshotted {snap.snapshotted_at ? fmtDate(snap.snapshotted_at) : '—'}
      </p>
    </div>
  );
}

function VersionCard({
  ver,
  isLatest,
  onRestore,
  restoring,
  readOnly,
}: {
  ver: any;
  isLatest: boolean;
  onRestore: (ver: any) => void;
  restoring: boolean;
  readOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-white rounded-xl border overflow-hidden transition-shadow ${
      isLatest ? 'border-violet-200 shadow-sm' : 'border-stone-200'
    }`}>
      <div className="flex items-start gap-4 px-5 py-4">
        {/* Version badge */}
        <div className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 mt-0.5 ${
          isLatest ? 'bg-violet-100' : 'bg-stone-100'
        }`}>
          <span className={`text-sm font-bold tabular-nums ${isLatest ? 'text-violet-700' : 'text-stone-600'}`}>
            v{ver.version_number}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-stone-800 text-sm">
              {ver.version_label || <span className="text-stone-400 font-normal italic">Untitled snapshot</span>}
            </span>
            {isLatest && (
              <span className="text-xs bg-violet-100 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full font-medium">
                Latest
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-stone-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />{fmtDate(ver.created_at)}
            </span>
            {ver.created_by_name && (
              <span className="text-xs text-stone-400 flex items-center gap-1">
                <User className="w-3 h-3" />{ver.created_by_name}
              </span>
            )}
          </div>
          {ver.notes && (
            <p className="text-xs text-stone-500 mt-1.5 italic leading-relaxed">{ver.notes}</p>
          )}

          {/* Expanded snapshot summary */}
          {expanded && ver._snap && <SnapSummary snap={ver._snap} />}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {ver._snap && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 px-2 py-1.5 rounded-lg transition-colors"
              title={expanded ? 'Collapse' : 'View snapshot summary'}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
          {!readOnly && (
            <button
              onClick={() => onRestore(ver)}
              disabled={restoring}
              className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-violet-700 border border-stone-200 hover:border-violet-300 bg-white px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 font-medium"
              title="Restore this version"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {restoring ? 'Restoring…' : 'Restore'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VersionsTab({
  bookId,
  onBookRefresh,
  readOnly = false,
}: {
  bookId: string;
  onBookRefresh: () => void;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ version_label: '', notes: '' });
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmVer, setConfirmVer] = useState<any | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['design-book-versions', bookId],
    queryFn: () => api.get(`/design-books/${bookId}/versions`).then(r => r.data),
    enabled: !!bookId,
  });

  const versions: any[] = data?.items || [];

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.post(`/design-books/${bookId}/versions`, {
        version_label: form.version_label.trim() || null,
        notes: form.notes.trim() || null,
      });
      const label = form.version_label.trim();
      toast.success(label ? `Version "${label}" saved` : 'Snapshot saved');
      setForm({ version_label: '', notes: '' });
      setShowCreate(false);
      refetch();
    } catch {
      toast.error('Failed to create version');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (ver: any) => {
    setRestoringId(ver.id);
    try {
      await api.post(`/design-books/${bookId}/versions/${ver.id}/restore`);
      toast.success(`Restored to v${ver.version_number}${ver.version_label ? ` — "${ver.version_label}"` : ''}`);
      setConfirmVer(null);
      onBookRefresh();
      refetch();
    } catch {
      toast.error('Restore failed');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Confirm restore modal */}
      {confirmVer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <p className="font-semibold text-stone-800">Restore to Version {confirmVer.version_number}</p>
                {confirmVer.version_label && (
                  <p className="text-sm text-stone-500">"{confirmVer.version_label}"</p>
                )}
              </div>
            </div>
            <p className="text-sm text-stone-600 mb-3">
              This will restore the following design-book-owned data to the state captured in this snapshot:
            </p>
            <ul className="text-sm text-stone-600 space-y-1 mb-4 pl-4">
              <li className="list-disc">Book metadata (title, revision, status, description)</li>
              <li className="list-disc">All species allocations per exhibit</li>
              <li className="list-disc">Water flow & hydraulics settings</li>
              <li className="list-disc">Theming & substrate data</li>
            </ul>
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-5 text-xs text-blue-700">
              Project-side data — exhibits, tanks, and LSS systems — is <strong>not changed</strong> by a restore.
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmVer(null)}
                className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmVer)}
                disabled={restoringId === confirmVer.id}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {restoringId === confirmVer.id ? 'Restoring…' : 'Yes, Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-stone-700">Design Book Versions</span>
          {versions.length > 0 && (
            <span className="text-xs bg-violet-100 text-violet-700 rounded-full px-2 py-0.5 font-medium">
              {versions.length}
            </span>
          )}
        </div>
        {!readOnly && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-900 border border-violet-200 bg-white hover:bg-violet-50 px-3 py-1.5 rounded-lg transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Create Version
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-violet-50/60 border border-violet-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-semibold text-violet-800">New Version Snapshot</span>
            </div>
            <button
              onClick={() => { setShowCreate(false); setForm({ version_label: '', notes: '' }); }}
              className="text-stone-400 hover:text-stone-600 p-1 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">
              Version Label <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Schematic Design, Milestone 1, Concept Freeze…"
              value={form.version_label}
              onChange={e => setForm(f => ({ ...f, version_label: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && !creating && handleCreate()}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">
              Notes <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <textarea
              rows={2}
              placeholder="Key decisions, what changed, milestone context…"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white resize-none"
            />
          </div>
          <div className="bg-white border border-stone-200 rounded-lg px-3 py-2 text-xs text-stone-500">
            Captures: book metadata · exhibits & tanks · species · water flow · substrate & theming · LSS systems
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => { setShowCreate(false); setForm({ version_label: '', notes: '' }); }}
              className="text-sm text-stone-500 hover:text-stone-700 px-3 py-1.5 rounded-lg border border-stone-200 bg-white"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-1.5 text-sm text-white bg-violet-600 hover:bg-violet-700 px-4 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {creating ? 'Saving snapshot…' : 'Save Version'}
            </button>
          </div>
        </div>
      )}

      {/* Versions list */}
      {isLoading ? (
        <div className="py-10 text-center text-stone-400 text-sm">Loading versions…</div>
      ) : versions.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 py-16 text-center">
          <GitBranch className="w-10 h-10 text-stone-200 mx-auto mb-3" />
          <p className="text-stone-500 font-medium">No versions yet</p>
          <p className="text-stone-400 text-sm mt-1 mb-5 max-w-sm mx-auto">
            Create a version to capture the current state as a named, restorable milestone. Great for design reviews, approvals, and "what if" exploration.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-900 border border-violet-200 bg-violet-50 hover:bg-violet-100 px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Create First Version
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((ver, idx) => (
            <VersionCard
              key={ver.id}
              ver={ver}
              isLatest={idx === 0}
              onRestore={v => setConfirmVer(v)}
              restoring={restoringId === ver.id}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}

      {versions.length > 0 && (
        <p className="text-xs text-stone-400 text-center">
          Restore replays species, hydraulics, substrate & book metadata. Project data (exhibits, tanks, LSS) is never overwritten.
        </p>
      )}
    </div>
  );
}
