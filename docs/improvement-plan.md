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
  *Still open (decision):* purge the two 25 MB `.dwg` customer files from git **history**
  (rewrites history; everyone re-clones). Uploaded files must be copied separately to any new machine/server.
- [x] **0.3 Node version** · S · done 2026-11-12
  Node 26 is the current LTS, so the project targets it (`.nvmrc` = 26, `engines` >= 22) instead of
  downgrading. `vitest.config.ts` disables Node's built-in Web Storage in test workers on Node 25+, which
  had broken ~500 web tests. Result: 512 → 12 failing tests (remaining ones are real, see 0.6).
- [x] **0.4 Remove leftovers and duplicates** · S · done 2026-11-12
  Deleted `apps/api/package.json` + pnpm files, `apps/web/package-lock.json`, `main.py`, `pyproject.toml`,
  `.replit`, `scripts/post-merge.sh`. `apps/web/package.json` slimmed to its `"type": "module"` marker.
  (`replit.md` is folded into the README in 0.5.)
- [ ] **0.4b Decide on Replit-era folders** · S — *decision needed*
  `artifacts/` (Replit mock-up sandbox + bio-degas 3D prototype, plus the `/__mockup` Vite proxy),
  `.agents/` (Replit agent notes — contain useful domain knowledge, could move to `docs/knowledge/`),
  `attached_assets/` (original specs + pasted prompts — specs could move to `docs/specs/`).
- [ ] **0.5 README + `.env.example` + one-command setup** · M
  How to install, create the database, migrate, seed or import, run, test. `npm run setup` script.
- [ ] **0.6 Green checks** · M
  Fix the 12 failing tests and the 6 web type errors. Give the 3 database integration tests their own
  throwaway test database (never the real-data one). Add `npm run typecheck` and `npm run check`
  (typecheck + tests) and run it before every commit.
- [ ] **0.7 CI on GitHub** · S
  GitHub Actions running `npm run check` on every push.

## Phase 1 — Data and schema

- [x] **1.1 Import the Replit data locally** · done 2026-11-12
  126 tables / 2,815 rows into database `shark_os_replit`; all 281 foreign keys verified, row counts match.
  Seven columns that only existed on Replit were added to the migration.
- [ ] **1.2 Follow-ups from the import** · S
  - Set a password for `kevin@advanced-aquariums.com` (passwords were redacted in the export).
  - Re-run the 2 biological-media runs whose `media_profile_snapshot` / `tan_profile_snapshot` were removed
    by Replit's export sanitizer (marked `{"_export_note": ...}`).
  - ~~Check uploaded files exist~~ — verified: all 8 files referenced by documents and project logos are present.
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

## Drafting module roadmap

- [x] **D.1 Teams and plans** · done 2026-11-12 — teams (manager + members), plans linked to a project and team.
- [ ] **D.2 Task groups and tasks** · L — Planner-style rows: name, assignees, priority, start/finish,
  duration, status, notes, attachments.
  Decided 2026-11-12: no "check" column; buckets become optional **categories** (later, if needed);
  progress is driven by **status** (Not started → In progress → Review → Done); a separate
  **time-based %** shows elapsed time between start and finish so late tasks stand out.
- [ ] **D.3 Bulk task entry** · M — Planner cannot be exported, so provide fast bulk entry
  (paste rows copied from the Planner grid, or a quick multi-row add form) instead of a file import.
- [ ] **D.4 Manager visibility** · M — managers see their own teams' work; drafters see their own tasks.
- [ ] **D.5 Views** · L — by-person workload, timeline.
- [ ] **D.6 Link tasks to deliverables** · M — project documents, design books.

Drafters have Shark OS logins (added 2026-11-12, role `drafter`, which keeps **manage** access to Drafting).
