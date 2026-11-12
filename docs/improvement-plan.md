# Shark OS — improvement plan

Living checklist from the November 2026 structure review. We take items **one at a time, in order**,
each as its own commit. Tick the box and add the date when an item is done.

**Status key:** `[ ]` to do · `[~]` in progress · `[x]` done
**Size:** S = under an hour · M = half a day · L = a day or more

Ground rules (agreed 2026-11-12):
- All development happens locally; **Replit is no longer used for code**. GitHub is the source of truth.
- New features are built as modules in `apps/api/src/modules/<name>/` (schema, validation, repository, routes)
  and `apps/web/src/pages/<name>/` — never by growing the existing large files.
- Schema changes go through the migration, never by hand in a database.

---

## Phase 0 — Foundation (make the project safe to work on)

- [x] **0.1 Commit the local-setup work** · S · done 2026-11-12
  Lockfile registry fix, migration ordering fixes, rebuilt purchase-order tables, Replit drift columns,
  `dotenv` load fix, Drafting module v1. Nothing is committed yet.
- [x] **0.2 Git hygiene** · S · done 2026-11-12
  Real `.gitignore`; `.gitattributes` forcing LF line endings; stopped tracking build output (189 files),
  uploaded files (15) and Replit screenshots (23) — all still on disk.
  The two 25 MB `.dwg` files are **in use** (documents DESIGN-001/002, Alibaug Koi Pond) so they stay on
  disk; history is not rewritten (decided 2026-11-12). Uploaded files must be copied separately to any
  new machine/server.
- [x] **0.3 Node version** · S · done 2026-11-12
  Node 26 is the current LTS, so the project targets it (`.nvmrc` = 26, `engines` >= 22) instead of
  downgrading. `vitest.config.ts` disables Node's built-in Web Storage in test workers on Node 25+, which
  had broken ~500 web tests. Result: 512 → 12 failing tests (remaining ones are real, see 0.6).
- [x] **0.4 Remove leftovers and duplicates** · S · done 2026-11-12
  Deleted `apps/api/package.json` + pnpm files, `apps/web/package-lock.json`, `main.py`, `pyproject.toml`,
  `.replit`, `scripts/post-merge.sh`. `apps/web/package.json` slimmed to its `"type": "module"` marker.
  (`replit.md` is folded into the README in 0.5.)
- [x] **0.4b Replit-era folders** · S · done 2026-11-12
  Deleted `artifacts/` (mock-up sandbox, 3D prototype) and the `/__mockup` Vite proxy, the Replit agent
  scripts/outputs and 179 pasted screenshots. Kept the knowledge: 64 engineering rule notes →
  `docs/knowledge/`; 12 original specs, 5 calculation-spec .docx and 11 pasted notes → `docs/specs/`.
- [x] **0.5 README + `.env.example` + one-command setup** · M · done 2026-11-12
  `README.md`, `.env.example`, `npm run setup` (creates DB, migrates, seeds only an empty DB).
  `replit.md` moved to `docs/platform-reference.md` with the Replit-only setup parts replaced.
- [x] **0.6 Green checks** · M · done 2026-11-12
  0 type errors, 1,190 tests passing (1 skipped: needs `pdftotext`). Fixed 6 type errors (3 were real UI
  bugs: missing "+" icon, PO bulk-assign count, CSV error tooltip), 9 stale tests, and 1 real regression
  (LSS control screen read the live system for issued books). Integration tests now use only
  `TEST_DATABASE_URL` (`npm run setup -- --test`); added `npm run typecheck` / `npm run check` / `npm run build:api`.
- [x] **0.7 CI on GitHub** · S · done 2026-11-12
  `.github/workflows/ci.yml`: Postgres 16 service, `npm ci`, test DB setup, API build, `npm run check`
  (pdftotext installed, so nothing is skipped). First run green in ~2.5 minutes.

## Phase 1 — Data and schema

- [x] **1.1 Import the Replit data locally** · done 2026-11-12
  126 tables / 2,815 rows into database `shark_os_replit`; all 281 foreign keys verified, row counts match.
  Seven columns that only existed on Replit were added to the migration.
- [ ] **1.2 Follow-ups from the import** · S
  - Set a password for `kevin@advanced-aquariums.com` (passwords were redacted in the export).
  - Re-run the 2 biological-media runs whose `media_profile_snapshot` / `tan_profile_snapshot` were removed
    by Replit's export sanitizer (marked `{"_export_note": ...}`).
  - ~~Check uploaded files exist~~ — verified: all 8 files referenced by documents and project logos are present.
  - ~~Remove 32 audit-log rows written by integration tests that ran against `shark_os_replit`~~ — done
    2026-11-12 (they referenced 4 test records that no longer existed; no real data was changed).
- [ ] **1.3 Numbered migrations** · L
  Replace the single 3,600-line schema string with `migrations/0001_baseline.sql`, `0002_...` plus a
  `schema_migrations` table, so each change is recorded, reviewable and runs exactly once.
- [ ] **1.4 Replace demo seed with a realistic dev dataset** · M
  Optionally an anonymised snapshot of the real data, so new machines start with useful data.

## Phase 2 — Code structure (incremental, alongside feature work)

- [ ] **2.1 Document the module convention** · S
  Short `docs/architecture.md` using Drafting as the reference example.
- [ ] **2.2 Shared types package** · M
  `packages/shared` for API/web types and calculations (e.g. `calculateUVSelection` exists twice today).
- [ ] **2.3 Consistent input validation** · M
  One approach (zod, or the pure-function style used in Drafting) for all new and touched endpoints.
- [ ] **2.4 Split `routes/designBooks.ts` (5,500 lines)** · L — move into `modules/design-books/` piece by piece.
- [ ] **2.5 Split `routes/projects.ts` (3,900 lines)** · L
- [ ] **2.6 Split `DesignBookLSSDetail.tsx` (5,700) and `DesignBookDetail.tsx` (5,300)** · L — one tab/panel per file.
- [ ] **2.7 Data-access layer for touched code** · ongoing
  When a route file is changed, move its SQL into a repository (1,330 queries currently live in route handlers).

## Phase 3 — Security and operations

- [ ] **3.1 Remove the hard-coded JWT fallback secret** · S — refuse to start without `JWT_SECRET` outside development.
- [ ] **3.2 Protect uploaded files** · M — `/uploads` is served without authentication.
- [ ] **3.3 Separate database user for the app** · S — the app currently connects as the `postgres` superuser.
- [ ] **3.4 Production deployment** · L — Alibaba Cloud HK plan (Caddy, systemd, Postgres).

---

## PIM: ASW price list import

Source: `ASW Equipment Price List 20240624.xlsx` (OneDrive › Engineering Management › ASW Pricelist).
Analysed 2026-11-12 (read-only):

| Sheet | Rows | Notes |
|---|---|---|
| LSS Equipment | 364 | 28 categories; supplier cost in RMB/USD/GBP → USD, markup, RRP; extra tech columns (kW, sand, L×W×H) |
| Pipe & Fittings | 649 | category column is mostly item names (335 distinct); ~half lack USD cost |
| Tanks - FRP | 33 | some priced per m² (rates, not products) |
| LSS Spare Parts / Lights / Platforms / Consumables | 18 / 19 / 6 / 1 | |

Data issues: 49 sizes stored as dates (e.g. "2 µm" → 1900-01-02), exchange rate formulas point to an external
workbook, 9 duplicate model codes, 9 rows without cost. Only 15 of 364 equipment rows match the existing
92 PIM products exactly — matching needs suggestions the user confirms.

Proposed approach: upload the .xlsx → preview/validation screen (per row: target family, match to existing
product or new, cleaned size, USD cost and RRP, warnings) → import only confirmed rows. Keyed on
supplier + model so a newer price list updates prices instead of duplicating. Supplier prices go to
vendor options; product cost / sell price on the product; kW, dimensions and sand data to the technical tables.

- [x] **P.1 Scope and rules** · decided 2026-11-12: LSS Equipment sheet first; bag filter socks, media,
  spare parts and skid items (break/BIO tank, plumbing, frame, plinth) become **components**, skid labour is
  not imported; costs converted with the **app's exchange-rate table**; sell price = RRP; a match **updates**
  the existing product's prices; **Shark OS is the master** after import (one-time migration with a reviewed
  dry run, re-runnable without duplicates).
- [x] **P.2 Importer: LSS Equipment** · L · done 2026-11-12 — importer in `apps/api/src/modules/pim-import`
  (`npm run import:pricelist`). Imported from the user-reviewed file (`ASW-pricelist-review-final.xlsx`):
  **208 products created, 36 updated, 93 components created**, 4 new families; backup taken first
  (`D:\Dev\db-backups\shark_os_replit-before-asw-import-20261112-1748.dump`). GBP/ZAR rates added
  (1 ZAR = 0.060 USD, 1 GBP = 1.33 USD). Also fixed: the product list silently capped at 200 items.
- [ ] **P.3 Importer: Pipe & Fittings** (category clean-up) · M
- [ ] **P.4 Remaining sheets / tank m² rates** · S
- [ ] **P.5 PIM redesign** · L — proposal in [pim-redesign-proposal.md](pim-redesign-proposal.md) (study of Plytix,
  AtroPIM, UnoPim, Pimcore): one item catalogue, family templates, attribute library with units, variants with
  inheritance, typed relationships, dated supplier offers, completeness/lifecycle. *Waiting for decisions (§7).*

## Drafting module roadmap

- [x] **D.1 Teams and plans** · done 2026-11-12 — teams (manager + members), plans linked to a project and team.
- [x] **D.2 Task groups and tasks** · L · done 2026-11-12 — plan board (`/drafting/plans/:id`) with optional
  groups, quick-add, multi-assignee tasks, priority, status, start/due, duration, time-used bar and late flags;
  plan list shows progress. (Attachments not yet — later, with deliverable links in D.6.)
  Decided 2026-11-12: no "check" column; buckets become optional **categories** (later, if needed);
  progress is driven by **status** (Not started → In progress → Review → Done); a separate
  **time-based %** shows elapsed time between start and finish so late tasks stand out.
- [ ] **D.3 Bulk task entry** · M — Planner cannot be exported, so provide fast bulk entry
  (paste rows copied from the Planner grid, or a quick multi-row add form) instead of a file import.
- [ ] **D.4 Manager visibility** · M — managers see their own teams' work; drafters see their own tasks.
- [ ] **D.5 Views** · L — by-person workload, timeline.
- [ ] **D.6 Link tasks to deliverables** · M — project documents, design books.

Drafters have Shark OS logins (added 2026-11-12, role `drafter`, which keeps **manage** access to Drafting).
