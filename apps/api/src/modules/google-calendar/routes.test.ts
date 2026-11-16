// @vitest-environment node
import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth', () => ({
  JWT_SECRET: 'test-secret',
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'user-1', email: 'antonio@advanced-aquariums.com', role: 'admin' }; next(); },
}));
vi.mock('../../db/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('./repository', () => ({ getConnection: vi.fn(), saveConnection: vi.fn(), saveAccessToken: vi.fn(), deleteConnection: vi.fn() }));
vi.mock('./google', async () => {
  const actual: any = await vi.importActual('./google');
  return { ...actual, exchangeCode: vi.fn(), refreshAccess: vi.fn(), revoke: vi.fn(), primaryCalendarEmail: vi.fn(), listEvents: vi.fn() };
});

import * as repo from './repository';
import * as google from './google';
import { decryptToken, encryptToken } from './validation';
import router from './routes';

const KEY = crypto.randomBytes(32);
const r = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const g = google as unknown as Record<string, ReturnType<typeof vi.fn>>;

async function call(method: string, path: string) {
  const app = express();
  app.use('/gc', router);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/gc${path}`, { method, redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), body: text ? JSON.parse(text.startsWith('{') ? text : '{}') : null };
  } finally { server.close(); }
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', GOOGLE_REDIRECT_URI: 'http://localhost:5000/api/v1/google-calendar/callback',
    GOOGLE_TOKEN_KEY: KEY.toString('base64'), GOOGLE_CALENDAR_ALLOWED_EMAILS: 'antonio@advanced-aquariums.com', APP_URL: 'http://localhost:5000',
  });
});

describe('google calendar routes', () => {
  it('reports status without exposing tokens', async () => {
    r.getConnection.mockResolvedValue({ google_email: 'antonio@advanced-aquariums.com', refresh_token_enc: 'x', connected_at: '2026-11-16' });
    const res = await call('GET', '/status');
    expect(res.body).toEqual({ configured: true, allowed: true, connected: true, google_email: 'antonio@advanced-aquariums.com', connected_at: '2026-11-16' });
  });

  it('builds a read-only consent URL with signed state', async () => {
    const res = await call('POST', '/connect');
    const url = new URL(res.body.url);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect((jwt.verify(url.searchParams.get('state')!, 'test-secret:google-calendar-state') as any).uid).toBe('user-1');
  });

  it('refuses people outside the allow-list', async () => {
    process.env.GOOGLE_CALENDAR_ALLOWED_EMAILS = 'someone@else.com';
    expect((await call('POST', '/connect')).status).toBe(403);
  });

  it('says when the server is not configured', async () => {
    delete process.env.GOOGLE_TOKEN_KEY;
    expect((await call('POST', '/connect')).body.error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });

  it('stores encrypted tokens on callback and returns to the app', async () => {
    g.exchangeCode.mockResolvedValue({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, scope: 'calendar.readonly' });
    g.primaryCalendarEmail.mockResolvedValue('antonio@advanced-aquariums.com');
    const state = jwt.sign({ uid: 'user-1' }, 'test-secret:google-calendar-state', { expiresIn: '10m' });
    const res = await call('GET', `/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.location).toBe('http://localhost:5000/?google_calendar=connected');
    const saved = r.saveConnection.mock.calls[0][0];
    expect(saved.userId).toBe('user-1');
    expect(saved.refreshTokenEnc).not.toContain('ref');
    expect(decryptToken(saved.refreshTokenEnc, KEY)).toBe('ref');
  });

  it('rejects a forged or login-token state', async () => {
    const forged = jwt.sign({ uid: 'user-1' }, 'test-secret');
    const res = await call('GET', `/callback?code=abc&state=${forged}`);
    expect(res.location).toContain('google_calendar=expired');
    expect(g.exchangeCode).not.toHaveBeenCalled();
  });

  it('refreshes an expired access token before listing events', async () => {
    r.getConnection.mockResolvedValue({ refresh_token_enc: encryptToken('ref', KEY), access_token_enc: encryptToken('old', KEY), access_expires_at: new Date(Date.now() - 1000) });
    g.refreshAccess.mockResolvedValue({ access_token: 'new', expires_in: 3600, scope: '' });
    g.listEvents.mockResolvedValue([{ id: 'e1', summary: 'Site visit', start: { date: '2026-11-17' }, end: { date: '2026-11-18' } }]);
    const res = await call('GET', '/events?from=2026-11-16&to=2026-11-23');
    expect(res.status).toBe(200);
    expect(g.listEvents).toHaveBeenCalledWith('new', '2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z');
    expect(res.body.events[0]).toMatchObject({ id: 'e1', title: 'Site visit', all_day: true });
    expect(r.saveAccessToken).toHaveBeenCalled();
  });

  it('forgets a connection whose access Google has revoked', async () => {
    r.getConnection.mockResolvedValue({ refresh_token_enc: encryptToken('ref', KEY), access_token_enc: null, access_expires_at: null });
    g.refreshAccess.mockRejectedValue(new google.GoogleApiError(400, 'invalid_grant'));
    const res = await call('GET', '/events?from=2026-11-16&to=2026-11-23');
    expect(res.status).toBe(409);
    expect(r.deleteConnection).toHaveBeenCalledWith('user-1');
  });

  it('validates the events window', async () => {
    expect((await call('GET', '/events?from=2026-11-16&to=2026-11-01')).status).toBe(400);
  });

  it('disconnect revokes at Google and deletes', async () => {
    r.getConnection.mockResolvedValue({ google_email: 'a', refresh_token_enc: encryptToken('ref', KEY) });
    const res = await call('DELETE', '/connection');
    expect(res.status).toBe(204);
    expect(g.revoke).toHaveBeenCalledWith('ref');
    expect(r.deleteConnection).toHaveBeenCalledWith('user-1');
  });
});
