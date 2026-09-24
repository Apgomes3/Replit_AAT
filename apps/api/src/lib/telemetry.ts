import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

type Context = { correlationId: string; databaseFailure: boolean };
export const requestContext = new AsyncLocalStorage<Context>();
export const correlationId = () => requestContext.getStore()?.correlationId;
export const SLOW_REQUEST_MS = 1000;
export const SLOW_DATABASE_MS = 500;
export function isDatabaseError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' &&
    (/^[0-9][0-9A-Z]{4}$/.test(code) || ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(code));
}
export function flagDatabaseFailure() {
  const context = requestContext.getStore();
  if (context) context.databaseFailure = true;
}
type Event = { at: number; endpoint: string; status: number; durationMs: number; category: string };
const events: Event[] = [];
const WINDOW_MS = 60 * 60 * 1000;

export function emit(event: Record<string, string | number | boolean | undefined>) {
  // Strict field allowlist by construction at call sites; never serialize Error,
  // request bodies, URL/query strings, headers, SQL, or database parameters.
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));
}

export function classify(status: number, databaseFailure = false) {
  if (status >= 500 && databaseFailure) return 'database';
  if (status >= 500) return 'application';
  if (status === 429) return 'rate_limit';
  if (status >= 400 && status < 500) return 'invalid_client';
  return 'none';
}

export function record(event: Event) {
  const cutoff = Date.now() - WINDOW_MS;
  while (events.length && events[0].at < cutoff) events.shift();
  events.push(event);
  // Bound memory even under extreme traffic.
  if (events.length > 10000) events.splice(0, events.length - 10000);
}

export function summary(minutes: number) {
  const grouped = new Map<string, { endpoint: string; requests: number; errors: number; slow: number; databaseFailures: number; notificationDelays: number; maxDurationMs: number }>();
  for (const event of events) {
    if (event.at < Date.now() - minutes * 60_000) continue;
    const row = grouped.get(event.endpoint) ?? { endpoint: event.endpoint, requests: 0, errors: 0, slow: 0, databaseFailures: 0, notificationDelays: 0, maxDurationMs: 0 };
    row.requests++;
    if (event.status >= 500) row.errors++;
    if (event.durationMs >= SLOW_REQUEST_MS) row.slow++;
    if (event.category === 'database') row.databaseFailures++;
    if (event.endpoint.includes('/notifications') && event.durationMs >= SLOW_REQUEST_MS) row.notificationDelays++;
    row.maxDurationMs = Math.max(row.maxDurationMs, event.durationMs);
    grouped.set(event.endpoint, row);
  }
  return [...grouped.values()].sort((a, b) => b.errors - a.errors || b.slow - a.slow);
}

export function observe(req: Request, res: Response, next: NextFunction) {
  // Never trust client-provided IDs: a fresh UUID cannot inject log content.
  const id = randomUUID();
  const start = process.hrtime.bigint();
  res.setHeader('X-Correlation-ID', id);
  requestContext.run({ correlationId: id, databaseFailure: false }, () => {
    const originalJson = res.json.bind(res);
    res.json = ((body: any) => {
      if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
        body = { ...body, error: { ...body.error, correlationId: id } };
      }
      return originalJson(body);
    }) as typeof res.json;
    res.on('finish', () => {
      if (!req.originalUrl.startsWith('/api/')) return;
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      const endpoint = req.route ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
      const category = classify(res.statusCode, requestContext.getStore()?.databaseFailure);
      record({ at: Date.now(), endpoint, status: res.statusCode, durationMs, category });
      const actor = (req as Request & { user?: { id?: string; role?: string } }).user;
      const role = actor?.role;
      emit({
        event: 'http_request', correlationId: id, method: req.method, endpoint,
        role: role && /^[a-z_]{1,40}$/.test(role) ? role : 'anonymous',
        actorId: actor?.id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(actor.id) ? actor.id : undefined,
        status: res.statusCode, durationMs, category,
        slow: durationMs >= SLOW_REQUEST_MS,
        ...(endpoint.includes('/notifications') && durationMs >= SLOW_REQUEST_MS ? { notificationDelayed: true } : {}),
      });
    });
    next();
  });
}

export function databaseEvent(durationMs: number, failed: boolean) {
  const context = requestContext.getStore();
  if (failed && context) context.databaseFailure = true;
  if (failed || durationMs >= SLOW_DATABASE_MS) {
    emit({ event: 'database_operation', correlationId: context?.correlationId, durationMs, category: failed ? 'database' : 'slow_database' });
  }
}