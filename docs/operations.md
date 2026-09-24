# Shark OS operational diagnostics

API responses carry `X-Correlation-ID` (a new server-generated UUID per request).
Error JSON carries the same value in `error.correlationId`; share this reference
with support, not request payloads. Domain audit entries written by the shared
audit helper include `details.correlationId`. Never paste credentials into reports.

`GET /api/live` is process liveness. `GET /api/health` and `GET /api/ready`
check PostgreSQL with a 3-second deadline and return 503 when unavailable.
Monitor readiness for traffic routing; liveness alone does not mean the
application can serve data.

Logs are JSON lines in stdout. `http_request` includes timestamp, correlationId,
method, matched endpoint pattern (never URL parameters or query), safe role
and a validated actor UUID when authenticated,
status, durationMs, category and slow. `http_error` reports category and status,
not error messages or stacks. `database_operation` reports slow/failing duration
without SQL or parameters. `audit_write_failure` signals a missing audit event.
Categories: `invalid_client` (4xx), `rate_limit` (429), `application` (5xx),
`database` (dependency failure), `none` (success); endpoints above 1000ms
and DB operations above 500ms are slow. Notification route delays set
`notificationDelayed`. Logs are JSON in all environments so collection does
not depend on a development-only formatter.

An authenticated administrator can call `GET /api/v1/admin/operations?minutes=15`
(`minutes` is 5, 15 or 60). This is an in-process rolling summary by matched
endpoint: request counts, 5xx errors, slow counts, database failures, notification
delays and maximum latency. It holds at most 10,000 recent events, resets on
restart, and is **per instance** rather than an aggregated deployment metric.
Use collected stdout logs to investigate longer windows or multi-instance
deployments. Alert on sustained readiness 503s, repeated database failures,
notification delays or increases in error/slow counts. Filter JSON logs by
`correlationId` to connect a browser reference with the relevant request and
database event; never log request bodies, tokens or record contents.