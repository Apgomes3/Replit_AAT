// Minimal Google OAuth 2.0 + Calendar API client over fetch (no SDK dependency).
import { CALENDAR_SCOPE, GoogleConfig } from './validation';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CAL = 'https://www.googleapis.com/calendar/v3';

export class GoogleApiError extends Error {
  constructor(public status: number, public reason: string) { super(`Google API ${status}: ${reason}`); }
}

export function authUrl(cfg: GoogleConfig, state: string) {
  const p = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: CALENDAR_SCOPE,
    access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'false', state,
  });
  return `${AUTH_URL}?${p}`;
}

async function asJson(res: Response) {
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleApiError(res.status, body?.error?.message ?? body?.error ?? res.statusText);
  return body;
}

export type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope: string };

export async function exchangeCode(cfg: GoogleConfig, code: string): Promise<TokenResponse> {
  return asJson(await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' }),
  }));
}

export async function refreshAccess(cfg: GoogleConfig, refreshToken: string): Promise<TokenResponse> {
  return asJson(await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }),
  }));
}

export async function revoke(token: string): Promise<void> {
  await fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) })
    .catch(() => undefined);
}

/** The primary calendar's id is the account's email address. */
export async function primaryCalendarEmail(accessToken: string): Promise<string> {
  const body = await asJson(await fetch(`${CAL}/calendars/primary`, { headers: { Authorization: `Bearer ${accessToken}` } }));
  return String(body.id);
}

export async function listEvents(accessToken: string, timeMin: string, timeMax: string): Promise<any[]> {
  const items: any[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    if (pageToken) p.set('pageToken', pageToken);
    const body = await asJson(await fetch(`${CAL}/calendars/primary/events?${p}`, { headers: { Authorization: `Bearer ${accessToken}` } }));
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken && items.length < 1000);
  return items;
}
