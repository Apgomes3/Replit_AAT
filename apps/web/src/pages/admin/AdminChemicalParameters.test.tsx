import { describe, expect, it } from 'vitest';
import { canManageChemicalParameters } from './AdminChemicalParameters';

describe('chemical parameter administration access', () => {
  it('allows only administrators to manage governed chemical parameters', () => {
    expect(canManageChemicalParameters({ role: 'admin' } as any)).toBe(true);
    expect(canManageChemicalParameters({ role: 'engineer' } as any)).toBe(false);
    expect(canManageChemicalParameters(null)).toBe(false);
  });
});