import { describe, expect, it } from 'vitest';
import { versionConflict, versionMatches, versionToken } from './concurrency';

describe('draft-write concurrency tokens', () => {
  it('uses the selected row revision and rejects a stale expected_version', () => {
    const current = {
      id: 'record-1',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      version: '987654',
    };
    expect(versionToken(current)).toBe('987654');
    expect(versionMatches(current, '987654')).toBe(true);
    expect(versionMatches(current, '987653')).toBe(false);
  });

  it('returns the current record and current_version on conflict', () => {
    const response = versionConflict({
      id: 'record-1',
      title: 'Current value',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      version: '987654',
    });
    expect(response.error.code).toBe('VERSION_CONFLICT');
    expect(response.error.current_version).toBe('987654');
    expect(response.error.current_record).toMatchObject({ id: 'record-1', title: 'Current value', version: '987654' });
  });
});