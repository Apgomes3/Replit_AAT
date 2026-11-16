// Input rules for the client directory. Pure functions, so they are tested without a database.

export const CLIENT_KINDS = ['client', 'consultant', 'contractor', 'partner', 'supplier'] as const;
export type ClientKind = typeof CLIENT_KINDS[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const has = (b: any, k: string) => Object.prototype.hasOwnProperty.call(b ?? {}, k);

/** Trimmed text with inner spaces collapsed; null when blank; an error message when not text or too long. */
function text(value: unknown, label: string, max: number): { v: string | null } | { error: string } {
  if (value === null || value === undefined) return { v: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const v = value.trim().replace(/[ \t]+/g, ' ');
  if (v.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { v: v || null };
}

const COMPANY_SUFFIXES = /\b(the|pty|ltd|limited|inc|incorporated|llc|co|company|corp|corporation|gmbh|sa|srl|bv|plc)\b/g;

/** A company name reduced for comparison: no accents, case, punctuation, spaces or legal suffixes. */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\./g, '') // "S.A." → "sa"
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, '');
}

/** Whether two company names probably mean the same company ("Basspro" and "Bass Pro Shops"). */
export function namesLookAlike(a: string, b: string): boolean {
  const x = normalizeCompanyName(a);
  const y = normalizeCompanyName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && long.includes(short);
}

export interface ClientInput {
  name?: string;
  legal_name?: string | null;
  website?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  kinds?: ClientKind[];
  parent_client_id?: string | null;
  active?: boolean;
}

/** Validates a company. On create, name is required; on update, only the fields sent are checked. */
export function validateClientInput(body: any, mode: 'create' | 'update'): { value: ClientInput } | { error: string } {
  const value: ClientInput = {};
  if (mode === 'create' || has(body, 'name')) {
    const r = text(body?.name, 'Company name', 255);
    if ('error' in r) return r;
    if (!r.v) return { error: 'Company name is required' };
    value.name = r.v;
  }
  const fields: Array<[keyof ClientInput, string, number]> = [
    ['legal_name', 'Legal name', 255], ['website', 'Website', 500], ['country', 'Country', 100],
    ['city', 'City', 100], ['address', 'Address', 1000], ['notes', 'Notes', 5000],
  ];
  for (const [key, label, max] of fields) {
    if (!has(body, key)) continue;
    const r = text(body[key], label, max);
    if ('error' in r) return r;
    (value as any)[key] = r.v;
  }
  if (has(body, 'kinds')) {
    if (!Array.isArray(body.kinds) || !body.kinds.length) return { error: 'Choose at least one kind (client, consultant, contractor, partner, supplier)' };
    const kinds = [...new Set(body.kinds.map((k: unknown) => String(k).trim().toLowerCase()))] as string[];
    const bad = kinds.find(k => !(CLIENT_KINDS as readonly string[]).includes(k));
    if (bad) return { error: `Unknown kind "${bad}"` };
    value.kinds = CLIENT_KINDS.filter(k => kinds.includes(k));
  } else if (mode === 'create') {
    value.kinds = ['client'];
  }
  if (has(body, 'parent_client_id')) {
    const p = body.parent_client_id;
    if (p !== null && p !== '' && !isUuid(p)) return { error: 'parent_client_id must be a company id' };
    value.parent_client_id = p || null;
  }
  if (has(body, 'active')) {
    if (typeof body.active !== 'boolean') return { error: 'active must be true or false' };
    value.active = body.active;
  }
  return { value };
}

export interface ContactInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  job_title?: string | null;
  notes?: string | null;
  is_primary?: boolean;
  left_on?: string | null;
}

/**
 * Validates a person. A new person needs a name and an email or a phone number; an update keeps
 * that true when combined with what is stored (`current`). `left: true` marks them as left today.
 */
export function validateContactInput(body: any, current?: Partial<ContactInput>): { value: ContactInput } | { error: string } {
  const creating = !current;
  const value: ContactInput = {};
  if (creating || has(body, 'name')) {
    const r = text(body?.name, 'Name', 255);
    if ('error' in r) return r;
    if (!r.v) return { error: 'Name is required' };
    value.name = r.v;
  }
  const fields: Array<[keyof ContactInput, string, number]> = [
    ['email', 'Email', 255], ['phone', 'Phone', 100], ['mobile', 'Mobile', 100], ['job_title', 'Job title', 255], ['notes', 'Notes', 5000],
  ];
  for (const [key, label, max] of fields) {
    if (!has(body, key)) continue;
    const r = text(body[key], label, max);
    if ('error' in r) return r;
    (value as any)[key] = key === 'email' && r.v ? r.v.toLowerCase() : r.v;
  }
  if (value.email && !EMAIL.test(value.email)) return { error: 'Email is not a valid address' };
  if (has(body, 'is_primary')) {
    if (typeof body.is_primary !== 'boolean') return { error: 'is_primary must be true or false' };
    value.is_primary = body.is_primary;
  }
  if (has(body, 'left')) {
    if (typeof body.left !== 'boolean') return { error: 'left must be true or false' };
    value.left_on = body.left ? (current?.left_on ?? new Date().toISOString().slice(0, 10)) : null;
  } else if (has(body, 'left_on')) {
    const d = body.left_on;
    if (d !== null && (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d))) return { error: 'left_on must be a date (YYYY-MM-DD)' };
    value.left_on = d;
  }
  if (value.left_on && value.is_primary) return { error: 'Someone who has left cannot be the primary contact' };
  const merged = { ...current, ...value };
  if (!merged.email && !merged.phone && !merged.mobile) return { error: 'Add an email, phone or mobile number' };
  return { value };
}
