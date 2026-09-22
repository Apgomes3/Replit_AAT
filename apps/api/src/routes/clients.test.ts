// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adaptLegacyContacts, normalizeContacts, validateContacts } from './clients';

describe('client contact contract', () => {
  const contacts = [
    { name: 'Alex', email: 'Alex@example.com', job_title: 'Buyer' },
    { name: 'Sam', email: 'sam@example.com', is_primary: false },
  ];

  it('accepts multiple employee contacts and defaults the first to primary', () => {
    expect(validateContacts(contacts)).toBeNull();
    expect(normalizeContacts(contacts).map(c => c.is_primary)).toEqual([true, false]);
  });

  it('rejects blank or malformed emails and case-insensitive duplicates', () => {
    expect(validateContacts([{ name: 'Alex', email: ' ' }])).toContain('email');
    expect(validateContacts([{ name: 'Alex', email: 'not-an-email' }])).toContain('email');
    expect(validateContacts([
      { name: 'Alex', email: 'alex@example.com' },
      { name: 'Sam', email: 'ALEX@example.com' },
    ])).toContain('Duplicate contact email');
  });

  it('rejects more than one primary contact', () => {
    expect(validateContacts([
      { name: 'Alex', email: 'alex@example.com', is_primary: true },
      { name: 'Sam', email: 'sam@example.com', is_primary: true },
    ])).toContain('Only one primary');
  });

  it('rejects non-boolean primary flags and adapts complete legacy aliases', () => {
    expect(validateContacts([{ name: 'Alex', email: 'alex@example.com', is_primary: 'yes' }])).toContain('is_primary');
    expect(adaptLegacyContacts({ contact_name: 'Alex', contact_email: 'alex@example.com', contact_phone: '1' }).contacts).toEqual([
      { name: 'Alex', email: 'alex@example.com', phone: '1', is_primary: true },
    ]);
    expect(adaptLegacyContacts({ contact_name: 'Alex' }).error).toContain('both required');
    expect(adaptLegacyContacts({ contact_email: 'alex@example.com' }).error).toContain('both required');
  });
});