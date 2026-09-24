import { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';

export type RecoveryDraft = {
  value: unknown;
  savedAt: string;
  source: string;
  version?: string;
};

export function readRecoveryDraft(key: string): RecoveryDraft | null {
  try {
    const raw = localStorage.getItem(`shark-draft:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'string' || !('value' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRecoveryDraft(key: string) {
  try { localStorage.removeItem(`shark-draft:${key}`); } catch { /* storage may be unavailable */ }
}

const fingerprint = (value: unknown) => JSON.stringify(value);

function NavigationGuard({ dirty, localFailed }: { dirty: boolean; localFailed: boolean }) {
  const blocker = useBlocker(dirty);
  return blocker.state === 'blocked' ? <div role="dialog" aria-label="Unsaved changes" className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4">
    <div className="max-w-md rounded-xl bg-white p-6 shadow-xl">
      <h2 className="text-lg font-bold">Leave with unsaved changes?</h2>
      <p className="my-3 text-sm">The server has not saved this work. {localFailed ? 'No browser recovery copy could be stored.' : 'A recovery copy is stored on this browser.'}</p>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => blocker.reset()} className="rounded border px-3 py-2 text-sm">Keep editing</button>
        <button type="button" onClick={() => blocker.proceed()} className="rounded bg-rose-700 px-3 py-2 text-sm text-white">Leave</button>
      </div>
    </div>
  </div> : null;
}

type Props<T> = {
  storageKey: string;
  value: T;
  baseline: T;
  version?: string | null;
  onRestore: (value: T, recovery: RecoveryDraft) => void;
  onDiscard?: () => void;
  onSave?: () => unknown | Promise<unknown>;
  onConflictReload?: () => unknown | Promise<unknown>;
  saving?: boolean;
  error?: any;
  enabled?: boolean;
  /** Change after a confirmed server save, including creates whose editor closes immediately. */
  savedAt?: number | string | null;
  autosave?: boolean;
};

/**
 * A local draft is a recovery copy, never a server commit. Only a confirmed save
 * (or a matching server baseline) removes it. Version conflicts never autosave.
 */
export default function ProtectedDraftBar<T>({
  storageKey, value, baseline, version, onRestore, onDiscard, onSave, onConflictReload,
  saving = false, error, enabled = true, savedAt, autosave = false,
}: Props<T>) {
  const key = `shark-draft:${storageKey}`;
  const dirty = enabled && fingerprint(value) !== fingerprint(baseline);
  const [recovery, setRecovery] = useState<RecoveryDraft | null>(null);
  const [checkedKey, setCheckedKey] = useState('');
  const [localFailed, setLocalFailed] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [manualError, setManualError] = useState<any>(null);
  const [restoredVersion, setRestoredVersion] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | string | null>(null);
  const previousSaved = useRef(savedAt);
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const cleanVersion = useRef({ key, version: version == null ? null : String(version) });
  if (cleanVersion.current.key !== key || !dirty) {
    cleanVersion.current = { key, version: version == null ? null : String(version) };
  }
  const originalVersion = restoredVersion || cleanVersion.current.version;
  const newerVersion = dirty && originalVersion != null && version != null && originalVersion !== String(version);
  const conflict = newerVersion || error?.response?.status === 409 || manualError?.response?.status === 409;
  const effectiveError = error || manualError;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!enabled || checkedKey === key) return;
    const candidate = readRecoveryDraft(storageKey);
    if (candidate && fingerprint(candidate.value) !== fingerprint(baseline)) {
      setRecovery(candidate);
    } else if (candidate) {
      clearRecoveryDraft(storageKey);
    }
    setCheckedKey(key);
  }, [enabled, key, checkedKey, storageKey, baseline]);

  useEffect(() => {
    if (savedAt != null && savedAt !== previousSaved.current) {
      previousSaved.current = savedAt;
      clearRecoveryDraft(storageKey);
      setLastSaved(savedAt);
      setManualError(null);
      setRestoredVersion(null);
    }
  }, [savedAt, storageKey]);

  useEffect(() => {
    if (!enabled || checkedKey !== key || recovery) return;
    if (!dirty) {
      clearRecoveryDraft(storageKey);
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify({
        value,
        savedAt: new Date().toISOString(),
        source: window.location.pathname,
        version: originalVersion || undefined,
      } satisfies RecoveryDraft));
      setLocalFailed(false);
    } catch {
      setLocalFailed(true);
    }
  }, [enabled, key, checkedKey, recovery, dirty, value, version, originalVersion, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!autosave || !onSave || !dirty || saving || !online || conflict || recovery) return;
    const timer = window.setTimeout(() => {
      Promise.resolve(onSave()).catch(setManualError);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [autosave, onSave, dirty, saving, online, conflict, recovery, value]);

  if (!enabled) return null;
  const state = conflict ? 'Conflict' : !online ? 'Offline' : saving ? 'Saving' :
    effectiveError || localFailed ? 'Save failed' : dirty ? 'Unsaved' : 'Saved';
  const conflictCurrent = effectiveError?.response?.data?.error?.current_record ??
    effectiveError?.response?.data?.error?.current ??
    effectiveError?.response?.data?.current;
  return (
    <>
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <strong>{state}</strong>
        {dirty && <span>{localFailed ? 'Browser recovery storage is unavailable. Copy your changes before leaving.' : 'Recovery copy stored in this browser.'}</span>}
        {!dirty && lastSaved && <span>Saved {new Date(lastSaved).toLocaleString()}</span>}
        {effectiveError && <span>{effectiveError?.response?.data?.error?.message || 'The server did not save these changes.'}</span>}
        {conflict && <span>Another session changed this record. Your draft remains on this device; review both versions before choosing.</span>}
        {conflict && <details className="w-full"><summary className="cursor-pointer">Review my draft</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2">{JSON.stringify(value, null, 2)}</pre></details>}
        {(conflictCurrent || newerVersion) && <details className="w-full"><summary className="cursor-pointer">Review newer server version</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2">{JSON.stringify(conflictCurrent || baseline, null, 2)}</pre></details>}
        {conflict && onConflictReload && <button type="button" onClick={() => {
          void Promise.resolve(onConflictReload()).then(() => {
            clearRecoveryDraft(storageKey);
            setManualError(null);
            setRestoredVersion(null);
          }).catch(setManualError);
        }} className="font-semibold underline">Use newer server version (discard this draft)</button>}
        {dirty && !conflict && onSave && !saving && online && <button type="button" onClick={() => void Promise.resolve(onSave()).catch(setManualError)} className="font-semibold underline">Save / retry</button>}
      </div>
      {recovery && <div role="dialog" aria-label="Recover local draft" className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4">
        <div className="max-w-lg rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-bold">Recover unsaved work?</h2>
          <p className="my-3 text-sm">A draft from <strong>{recovery.source}</strong> was stored on this browser at <strong>{new Date(recovery.savedAt).toLocaleString()}</strong>. It has not been saved to the server. Review the current record before replacing the form.</p>
          {recovery.version != null && version != null && recovery.version !== String(version) && <p className="mb-3 text-sm text-amber-800">The server version changed since this draft was created. Saving it may require conflict resolution.</p>}
          <details className="mb-4 text-xs"><summary className="cursor-pointer">Review recovered draft</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(recovery.value, null, 2)}</pre></details>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { clearRecoveryDraft(storageKey); onDiscard?.(); setRecovery(null); }} className="rounded border px-3 py-2 text-sm">Discard local draft</button>
            <button type="button" onClick={() => { setRestoredVersion(recovery.version || null); onRestore(recovery.value as T, recovery); setRecovery(null); }} className="rounded bg-blue-700 px-3 py-2 text-sm text-white">Restore draft</button>
          </div>
        </div>
      </div>}
      {dataRouter && <NavigationGuard dirty={dirty} localFailed={localFailed} />}
    </>
  );
}