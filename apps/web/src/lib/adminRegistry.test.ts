import { describe, expect, it } from 'vitest';
import { ADMIN_ENTRIES, ADMIN_DOMAIN_LABELS, adminPopupGroups, visibleAdminEntries } from './adminRegistry';

describe('admin registry', () => {
  it('has unique ids and routes, and a known domain for every entry', () => {
    expect(new Set(ADMIN_ENTRIES.map(e => e.id)).size).toBe(ADMIN_ENTRIES.length);
    expect(new Set(ADMIN_ENTRIES.map(e => e.to)).size).toBe(ADMIN_ENTRIES.length);
    for (const e of ADMIN_ENTRIES) {
      expect(ADMIN_DOMAIN_LABELS[e.domain]).toBeTruthy();
      expect(e.description.length).toBeGreaterThan(0);
    }
  });

  it('shows everything to admins and only granted entries to others', () => {
    expect(visibleAdminEntries({ role: 'admin', moduleAccess: {} })).toHaveLength(ADMIN_ENTRIES.length);
    expect(visibleAdminEntries({ role: 'engineer', moduleAccess: { design_books: 'manage' } }).map(e => e.id))
      .toEqual(['thermal-wall-constructions']);
    expect(visibleAdminEntries({ role: 'viewer', moduleAccess: { design_books: 'manage' } })).toEqual([]);
    expect(visibleAdminEntries(null)).toEqual([]);
  });

  it('keeps the popup groups in order and drops empty ones', () => {
    expect(adminPopupGroups(ADMIN_ENTRIES).map(g => g.label)).toEqual(['Library', 'Documents', 'Order Management', 'System']);
    expect(adminPopupGroups(visibleAdminEntries({ role: 'engineer', moduleAccess: { design_books: 'manage' } })).map(g => g.label)).toEqual(['Library']);
  });
});
