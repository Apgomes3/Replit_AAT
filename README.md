# Shark OS

[![CI](https://github.com/Apgomes3/Replit_AAT/actions/workflows/ci.yml/badge.svg)](https://github.com/Apgomes3/Replit_AAT/actions/workflows/ci.yml)

Engineering operations platform for Advanced Aquarium Technologies: product catalogue (PIM),
projects and systems, design books with LSS engineering calculations, purchase orders,
business development and drafting.

- **Web:** React 19, TypeScript, Vite 7, Tailwind CSS 4, React Query — `apps/web` (port 5000)
- **API:** Node.js, Express 5, TypeScript — `apps/api` (port 3000; the web dev server proxies `/api`)
- **Database:** PostgreSQL 16
- **Auth:** JWT + bcrypt

## Prerequisites

- **Node.js 26 LTS** (see `.nvmrc`; 22+ works)
- **PostgreSQL 16**
- **Git** — on Windows, line endings are handled by `.gitattributes`; no extra config needed.

## First-time setup

```bash
npm install
npm run setup          # creates .env on first run — edit it, then run again
npm run dev            # API + web together
```

Open <http://localhost:5000>.

`npm run setup` creates the database named in `DATABASE_URL` if needed, runs the migrations and,
**only if the database has no users**, loads the demo dataset. It is safe to re-run at any time.
`npm run setup -- --seed` forces the demo data.

### Demo logins (demo dataset only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@edp.com` | `admin123` |
| HQ manager | `hqmanager@edp.com` | `hqmanager123` |
| PMO | `pmo@edp.com` | `pmo123` |
| Engineer | `engineer@edp.com` | `engineer123` |
| Viewer | `viewer@edp.com` | `viewer123` |

These are development-only accounts; never use them on a server.

## Configuration (`.env`)

Copy `.env.example` (done for you by `npm run setup`). `.env` is git-ignored.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | Long random string used to sign login tokens |
| `APP_URL` | recommended | Public web URL, used in password-reset links |
| `PORT` | no | API port (default 3000) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | for email | Without them, in development, password-reset links are printed to the API console |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start API (3000) and web (5000) together |
| `npm run setup` | Create DB if needed, migrate, seed an empty DB |
| `npm run migrate` | Apply the schema (idempotent) |
| `npm run seed` | Load the demo dataset |
| `npm run check` | Type-check everything, then run all tests |
| `npm run typecheck` | Type-check API and web |
| `npm test` | Unit/component tests (Vitest) |
| `npm run build:api` | Compile the API to `apps/api/dist` |
| `npm run test:browser` | Browser tests (Playwright) |
| `npm run species:catalog:seed` | Load the aquarium species catalogue |

## Project layout

```
apps/
  api/src/
    index.ts            Express app: middleware and route mounting
    db/                 connection pool, migrate.ts (schema), seed data
    modules/<name>/     new-style modules: schema.ts, validation.ts, repository.ts, routes.ts
    routes/             older route files (being split up over time)
    lib/                engineering calculations (thermal, UV, ozone, pumps, pipe sizing…)
    middleware/         auth, module access, errors
  web/src/
    pages/<module>/     screens per module
    components/         layout and shared UI
    lib/, store/, hooks/, types/
docs/                   improvement plan, platform reference, operations
  knowledge/            engineering rules and design decisions (one note per topic)
  specs/                original platform specs and calculation specifications
scripts/                setup script
```

### Adding a module

Follow `apps/api/src/modules/drafting` and `apps/web/src/pages/drafting`:

1. `schema.ts` — idempotent SQL (`CREATE TABLE IF NOT EXISTS …`), registered in `MODULE_SCHEMAS` in `db/migrate.ts`.
2. `validation.ts` — pure input checks (unit-tested, no database).
3. `repository.ts` — all SQL for the module.
4. `routes.ts` — thin HTTP layer, mounted in `index.ts`.
5. Add the module key to `lib/moduleAccess.ts` so admins can control access in **Admin › Roles**.

Schema changes always go through the migration — never edit a database by hand.

## Testing

```bash
npm run check                              # type-check API + web, then all tests — run before every commit
npm test                                   # tests only
npx vitest run apps/api/src/modules/drafting   # one folder
```

**Database integration tests** run only against a separate throwaway database set in
`TEST_DATABASE_URL` (in `.env`). Prepare it once with `npm run setup -- --test`. Tests never see
your normal `DATABASE_URL`; without `TEST_DATABASE_URL` they are skipped. The species-catalog
runtime test also needs a compiled API (`npm run build:api`).

The PDF text check in `lssIoSchedule.test.ts` needs poppler's `pdftotext` on the PATH; it is
reported as skipped when missing.

**CI** (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request: it starts
PostgreSQL 16, prepares the test database, builds the API and runs `npm run check`, including the
database integration tests and the PDF text check.

## Troubleshooting

- **Port 5432 already in use (Windows):** often a PostgreSQL inside WSL. Install/run PostgreSQL on another
  port (e.g. 5433) and put that port in `DATABASE_URL`.
- **`client password must be a string`:** `DATABASE_URL` is missing — check `.env`.
- **`relation … does not exist` after pulling:** run `npm run migrate`.

## Further reading

- [Improvement plan](docs/improvement-plan.md) — the prioritised work backlog
- [Platform reference](docs/platform-reference.md) — modules, workflows, PO pipeline, lifecycle states
- [Operations](docs/operations.md) — diagnostics endpoints
