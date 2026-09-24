import { readRecoveryDraft } from '../components/ui/ProtectedDraftBar';

export function draftCreateKey(storageKey: string): string {
  const value = readRecoveryDraft(storageKey)?.value as { idempotencyKey?: unknown } | undefined;
  return typeof value?.idempotencyKey === 'string' && /^[0-9a-f-]{36}$/i.test(value.idempotencyKey)
    ? value.idempotencyKey : crypto.randomUUID();
}

// The key must be durable before the request leaves the browser, not just
// eventually written by the recovery bar's effect after a render.
export function persistCreateDraft(storageKey: string, value: unknown): void {
  localStorage.setItem(`shark-draft:${storageKey}`, JSON.stringify({
    value, savedAt: new Date().toISOString(), source: window.location.pathname,
  }));
}