// Pure helpers for the Google Calendar connection (no database, no network).
import crypto from 'crypto';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const MAX_RANGE_DAYS = 92;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string; tokenKey: Buffer; allowedEmails: string[] };

/** Reads the Google settings from the environment; null when any required one is missing. */
export function readGoogleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  const keyText = env.GOOGLE_TOKEN_KEY?.trim();
  if (!clientId || !clientSecret || !redirectUri || !keyText) return null;
  const tokenKey = Buffer.from(keyText, 'base64');
  if (tokenKey.length !== 32) return null;
  const allowedEmails = (env.GOOGLE_CALENDAR_ALLOWED_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return { clientId, clientSecret, redirectUri, tokenKey, allowedEmails };
}

/** Empty allow-list means everyone may connect. */
export const mayConnect = (cfg: GoogleConfig, email: string) =>
  !cfg.allowedEmails.length || cfg.allowedEmails.includes(email.toLowerCase());

/** AES-256-GCM: "iv.tag.ciphertext", each base64. */
export function encryptToken(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}

export function decryptToken(sealed: string, key: Buffer): string {
  const [iv, tag, data] = sealed.split('.').map(s => Buffer.from(s, 'base64'));
  if (!iv || !tag || !data) throw new Error('Malformed encrypted token');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates an events window (YYYY-MM-DD, `to` exclusive, at most ~3 months). */
export function validateRange(from: unknown, to: unknown): { from: string; to: string } | { error: string } {
  if (typeof from !== 'string' || !ISO_DATE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) return { error: 'from must be a date (YYYY-MM-DD)' };
  if (typeof to !== 'string' || !ISO_DATE.test(to) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) return { error: 'to must be a date (YYYY-MM-DD)' };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days <= 0) return { error: 'to must be after from' };
  if (days > MAX_RANGE_DAYS) return { error: `The range can be at most ${MAX_RANGE_DAYS} days` };
  return { from, to };
}

export type CalendarEvent = {
  id: string; title: string; start: string; end: string; all_day: boolean;
  location: string | null; link: string | null; busy: boolean;
};

/** Maps a Google `events.list` item to what Shark OS shows; drops cancelled events. */
export function toCalendarEvent(item: any): CalendarEvent | null {
  if (!item || item.status === 'cancelled') return null;
  const allDay = !!item.start?.date;
  const start = item.start?.dateTime ?? item.start?.date;
  const end = item.end?.dateTime ?? item.end?.date;
  if (!start || !end) return null;
  return {
    id: String(item.id), title: item.summary || '(No title)', start, end, all_day: allDay,
    location: item.location ?? null, link: item.htmlLink ?? null, busy: item.transparency !== 'transparent',
  };
}
