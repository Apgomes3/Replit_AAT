import { describe, expect, it } from 'vitest';
import { namesLookAlike, normalizeCompanyName, validateClientInput, validateContactInput } from './validation';

describe('company names', () => {
  it('compares names without case, spaces, accents, punctuation or legal suffixes', () => {
    expect(normalizeCompanyName('Acuário de Michín, S.A.')).toBe('acuariodemichin');
    expect(normalizeCompanyName('Bass Pro Shops Pty Ltd')).toBe('bassproshops');
    expect(namesLookAlike('Basspro', 'Bass Pro Shops')).toBe(true);
    expect(namesLookAlike('Seaworld', 'Sea World Gold Coast')).toBe(true);
    expect(namesLookAlike('SEA LIFE', 'Sea Life Sydney')).toBe(true); // a group and its site: worth a question
    expect(namesLookAlike('Zoo', 'Zoo Atlanta')).toBe(false); // too short to match inside a longer name
    expect(namesLookAlike('NRH', 'NRH')).toBe(true);
    expect(namesLookAlike('Coral Vita', 'Pairi Daiza')).toBe(false);
  });
});

describe('validateClientInput', () => {
  it('needs a name on create and defaults the kind to client', () => {
    expect(validateClientInput({ name: '  ' }, 'create')).toEqual({ error: 'Company name is required' });
    expect(validateClientInput({ name: ' Aquarium  of Guam ' }, 'create')).toEqual({ value: { name: 'Aquarium of Guam', kinds: ['client'] } });
  });

  it('checks kinds, parent and active, and only touches fields that were sent on update', () => {
    expect(validateClientInput({ kinds: ['Supplier', 'client', 'client'] }, 'update')).toEqual({ value: { kinds: ['client', 'supplier'] } });
    expect(validateClientInput({ kinds: [] }, 'update')).toEqual({ error: expect.stringMatching(/at least one kind/) });
    expect(validateClientInput({ kinds: ['customer'] }, 'update')).toEqual({ error: 'Unknown kind "customer"' });
    expect(validateClientInput({ parent_client_id: 'x' }, 'update')).toEqual({ error: expect.stringMatching(/company id/) });
    expect(validateClientInput({ parent_client_id: '' , country: '' }, 'update')).toEqual({ value: { parent_client_id: null, country: null } });
    expect(validateClientInput({ active: 'yes' }, 'update')).toEqual({ error: 'active must be true or false' });
  });
});

describe('validateContactInput', () => {
  it('needs a name and an email, phone or mobile', () => {
    expect(validateContactInput({ name: 'Ana' })).toEqual({ error: 'Add an email, phone or mobile number' });
    expect(validateContactInput({ name: 'Ana', mobile: '+61 400 000 000' })).toEqual({ value: { name: 'Ana', mobile: '+61 400 000 000' } });
    expect(validateContactInput({ name: 'Ana', email: 'ANA@Example.com' })).toEqual({ value: { name: 'Ana', email: 'ana@example.com' } });
    expect(validateContactInput({ name: 'Ana', email: 'not-an-email' })).toEqual({ error: 'Email is not a valid address' });
  });

  it('keeps the rule when updating against what is stored', () => {
    const stored = { email: 'ana@example.com', phone: null, mobile: null };
    expect(validateContactInput({ email: '' }, stored)).toEqual({ error: 'Add an email, phone or mobile number' });
    expect(validateContactInput({ email: '', phone: '123' }, stored)).toEqual({ value: { email: null, phone: '123' } });
  });

  it('marks people as left today, keeps an earlier date, and brings them back', () => {
    const today = new Date().toISOString().slice(0, 10);
    const stored = { email: 'ana@example.com' };
    expect(validateContactInput({ left: true }, stored)).toEqual({ value: { left_on: today } });
    expect(validateContactInput({ left: true }, { ...stored, left_on: '2026-01-31' })).toEqual({ value: { left_on: '2026-01-31' } });
    expect(validateContactInput({ left: false }, { ...stored, left_on: '2026-01-31' })).toEqual({ value: { left_on: null } });
    expect(validateContactInput({ left: true, is_primary: true }, stored)).toEqual({ error: expect.stringMatching(/cannot be the primary/) });
  });
});
