// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRecoveryDraft } from '../components/ui/ProtectedDraftBar';
import { draftCreateKey, persistCreateDraft } from './createDraftKey';

describe('create draft keys', () => {
  beforeEach(() => localStorage.clear());

  it('stores the key before a request and reuses it after response loss', () => {
    const key = draftCreateKey('enquiry:user-a:create');
    persistCreateDraft('enquiry:user-a:create', { title: 'New request', idempotencyKey: key });
    expect(draftCreateKey('enquiry:user-a:create')).toBe(key);
    expect(draftCreateKey('purchase-order:user-a:create')).not.toBe(key);
    expect(draftCreateKey('enquiry:user-b:create')).not.toBe(key);
    clearRecoveryDraft('enquiry:user-a:create');
    expect(draftCreateKey('enquiry:user-a:create')).not.toBe(key);
  });
});