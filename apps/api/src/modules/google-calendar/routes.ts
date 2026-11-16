// Google Calendar (/api/v1/google-calendar): each person links their own Google account, read-only.
// GET  /status      — connected? which account?
// POST /connect     — returns the Google consent URL (state is a short-lived signed token)
// GET  /callback    — Google redirects here (browser, no Bearer header); stores encrypted tokens
// GET  /events      — events from the primary calendar in [from, to)
// DELETE /connection — revokes at Google and forgets the tokens
import { NextFunction, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, AuthRequest, JWT_SECRET } from '../../middleware/auth';
import { logAudit } from '../../db/audit';
import * as repo from './repository';
import * as google from './google';
import { decryptToken, encryptToken, GoogleConfig, mayConnect, readGoogleConfig, toCalendarEvent, validateRange } from './validation';

const router = Router();
// Separate secret so a state token can never pass as a login token (and vice versa).
const STATE_SECRET = `${JWT_SECRET}:google-calendar-state`;
const appUrl = () => (process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '');

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });

function config(res: Response): GoogleConfig | null {
  const cfg = readGoogleConfig();
  if (!cfg) fail(res, 503, 'GOOGLE_NOT_CONFIGURED', 'Google Calendar is not set up on this server yet (see .env.example).');
  return cfg;
}

const expiry = (seconds: number) => new Date(Date.now() + Math.max(0, seconds - 60) * 1000);

/** A valid access token for the user, refreshing it when it has expired. Null when not connected. */
async function accessTokenFor(cfg: GoogleConfig, userId: string): Promise<string | null> {
  const conn = await repo.getConnection(userId);
  if (!conn) return null;
  if (conn.access_token_enc && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now()) {
    return decryptToken(conn.access_token_enc, cfg.tokenKey);
  }
  try {
    const t = await google.refreshAccess(cfg, decryptToken(conn.refresh_token_enc, cfg.tokenKey));
    await repo.saveAccessToken(userId, encryptToken(t.access_token, cfg.tokenKey), expiry(t.expires_in));
    return t.access_token;
  } catch (e) {
    // Access was revoked in Google (or the token expired): forget it so the person can reconnect.
    if (e instanceof google.GoogleApiError && (e.status === 400 || e.status === 401)) {
      await repo.deleteConnection(userId);
      return null;
    }
    throw e;
  }
}

router.get('/status', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cfg = readGoogleConfig();
    const conn = await repo.getConnection(req.user!.id);
    res.json({
      configured: !!cfg,
      allowed: !!cfg && mayConnect(cfg, req.user!.email),
      connected: !!conn,
      google_email: conn?.google_email ?? null,
      connected_at: conn?.connected_at ?? null,
    });
  } catch (e) { next(e); }
});

router.post('/connect', authenticate, (req: AuthRequest, res: Response) => {
  const cfg = config(res);
  if (!cfg) return;
  if (!mayConnect(cfg, req.user!.email)) return fail(res, 403, 'FORBIDDEN', 'Google Calendar is not enabled for your account yet.');
  const state = jwt.sign({ uid: req.user!.id }, STATE_SECRET, { expiresIn: '10m' });
  res.json({ url: google.authUrl(cfg, state) });
});

router.get('/callback', async (req, res) => {
  const back = (result: string) => res.redirect(`${appUrl()}/?google_calendar=${result}`);
  const cfg = readGoogleConfig();
  if (!cfg) return back('not_configured');
  if (req.query.error) return back('denied');
  let uid: string;
  try {
    uid = (jwt.verify(String(req.query.state ?? ''), STATE_SECRET) as any).uid;
    if (typeof uid !== 'string') throw new Error('bad state');
  } catch { return back('expired'); }
  const code = req.query.code;
  if (typeof code !== 'string' || !code) return back('error');
  try {
    const t = await google.exchangeCode(cfg, code);
    if (!t.refresh_token) return back('error');
    const email = await google.primaryCalendarEmail(t.access_token);
    await repo.saveConnection({
      userId: uid, googleEmail: email, scope: t.scope,
      refreshTokenEnc: encryptToken(t.refresh_token, cfg.tokenKey),
      accessTokenEnc: encryptToken(t.access_token, cfg.tokenKey), accessExpiresAt: expiry(t.expires_in),
    });
    await logAudit(uid, 'google_calendar', uid, 'connect', { google_email: email }).catch(() => undefined);
    back('connected');
  } catch (e) {
    console.error('Google Calendar connect failed:', e instanceof Error ? e.message : e);
    back('error');
  }
});

router.get('/events', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const range = validateRange(req.query.from, req.query.to);
  if ('error' in range) return fail(res, 400, 'VALIDATION', range.error);
  const cfg = config(res);
  if (!cfg) return;
  try {
    const token = await accessTokenFor(cfg, req.user!.id);
    if (!token) return fail(res, 409, 'NOT_CONNECTED', 'Connect your Google Calendar first.');
    // Day boundaries in UTC; the client widens the window by a day either side for time zones.
    const items = await google.listEvents(token, `${range.from}T00:00:00Z`, `${range.to}T00:00:00Z`);
    res.json({ events: items.map(toCalendarEvent).filter(Boolean) });
  } catch (e) {
    if (e instanceof google.GoogleApiError) return fail(res, 502, 'GOOGLE_ERROR', 'Google Calendar could not be read just now.');
    next(e);
  }
});

router.delete('/connection', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const conn = await repo.getConnection(req.user!.id);
    const cfg = readGoogleConfig();
    if (conn && cfg) {
      try { await google.revoke(decryptToken(conn.refresh_token_enc, cfg.tokenKey)); } catch { /* forget it anyway */ }
    }
    await repo.deleteConnection(req.user!.id);
    if (conn) await logAudit(req.user!.id, 'google_calendar', req.user!.id, 'disconnect', { google_email: conn.google_email }).catch(() => undefined);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
