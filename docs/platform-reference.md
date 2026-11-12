# Shark OS platform reference

> Originally `replit.md`, written while the app was built on Replit. Moved here in November 2026;
> some details may be out of date — the code is the source of truth.

## Overview
**Shark OS** — A full-stack engineering operations platform for aquarium/engineering projects. Features a hub-based navigation with three modules: PIM Management (product catalog), Order Management (PO lifecycle), and Project Management.

## Architecture

### Stack
- **Frontend**: React 19 + TypeScript + Vite 7 (port 5000)
- **Backend**: Node.js + Express 5 + TypeScript (port 3000)
- **Database**: PostgreSQL 16 with recursive CTE graph traversal
- **Auth**: JWT + bcrypt (self-contained, no OAuth)
- **File Storage**: Local disk at `apps/api/uploads/` (S3-swap-ready)
- **CSS**: Tailwind CSS v4 with `@import "tailwindcss"` syntax; **design system**: Warm Enterprise theme — amber-600 primary accent, stone neutral palette, warm off-white (`#fafaf9`) background
- **State**: Zustand (auth), React Query v5 (server state)

### Structure
```
workspace/
  package.json              # Root — all npm packages installed here
  apps/
    api/                    # Express API
      src/
        index.ts            # Server entry point (port 3000)
        db/
          index.ts          # pg Pool connection
          migrate.ts        # Full schema (20+ tables)
          seed.ts           # Taoyuan Aquarium demo data
        middleware/
          auth.ts           # JWT authenticate + requireRole
          errors.ts         # Error handler + 404
        lib/
          email.ts          # Nodemailer helper; reads SMTP_* env vars; console fallback in dev
        routes/
          auth.ts           # POST /login, GET /me, POST /reset-password (public)
          projects.ts       # Projects, Areas, Exhibits, Tanks, Systems, Equipment
          products.ts       # Product Families, Masters, Variants, BOMs, Vendors
          knowledge.ts      # Materials, Specifications, Design Rules, Calc Templates
          documents.ts      # Documents, Revisions, Approvals, File Upload
          graph.ts          # Graph traversal, impact, reuse
          search.ts         # Cross-entity full-text search
          import.ts         # CSV bulk import (products, equipment, documents)
          admin.ts          # User management, audit logs, stats; POST /users/:id/send-reset-link
        services/
          graphService.ts   # Recursive graph traversal + impact/reuse analysis
        uploads/            # Local file storage
    web/                    # React frontend
      src/
        App.tsx             # React Router v7 + QueryClient + AuthGuard
        main.tsx            # Entry point
        index.css           # Tailwind v4 import
        types/index.ts      # All shared TypeScript types
        lib/api.ts          # Axios client (proxied /api → localhost:3000)
        store/authStore.ts  # Zustand auth store
        pages/
          auth/Login.tsx
          auth/ResetPassword.tsx  # Public page — token-based password reset
          Dashboard.tsx
          projects/         # ProjectsList, ProjectDetail, SystemDetail, EquipmentDetail
          products/         # ProductFamiliesList, ProductMastersList, ProductMasterDetail
          knowledge/        # MaterialsList, SpecificationsList, DesignRulesList
          documents/        # DocumentsList, DocumentDetail
          graph/GraphExplorer.tsx   # ReactFlow graph visualization
          search/SearchPage.tsx
          admin/            # AdminUsers, AdminImport
        components/
          layout/           # Shell, LeftNav, TopBar
          ui/               # StatusBadge, EntityCode, PageHeader, DataTable,
                            # MetadataPanel, RelationshipPanel, Button,
                            # NewEntityModal, LifecycleHistory
```

## Database Schema
20+ tables covering:
- **Project domain**: projects, areas, exhibits, tanks, systems, equipment_instances, project_piping_items
- **BOM Releases**: bom_releases (project-level snapshot documents), bom_release_lines (equipment/tank/piping snapshot lines)
- **Product Library**: product_families, product_masters, product_variants, standard_boms, bom_lines, vendor_options
  - Tank fields on product_masters: shape_type, length_mm, width_mm, height_mm, design_water_level_mm, wall_thickness_mm, gross_volume_m3, operating_volume_m3
- **Components**: components table (23 seeded) — component_code, type, category, material, specs; linked to bom_lines via component_id FK
- **Bridge**: product_usages (links equipment instances to product masters)
- **Knowledge**: materials, specifications, design_rules, calculation_templates
- **Documents**: documents, document_revisions, approvals, release_packages; has product_id + component_id FKs
- **Graph**: entity_relationships (source_id, source_type, target_id, target_type, edge_type)
- **Workflow**: lifecycle_transitions
- **Auth**: users, refresh_tokens
- **Audit**: audit_logs

## Demo Data (Seed)
- **7 Product Families**: Foam Fractionators (FILTRATION), Circulation Pumps (PUMPING), Drum Filters, UV Sterilizers, Heat Exchangers, Ozone Generators, **Pipes & Fittings (PIPING)**
- **14 Product Masters**: FF-1500, FF-800, Pump 55kW, Pump 22kW, Drum 60Hz, UV 120W, FRP Pipe DN50/80, CPVC Pipe DN50, Elbow/Tee/Reducer/Union/Flange DN50-80
- **23 Components**: 8 mechanical (vessels, blowers, venturi, meters, valves, seals, impellers, cups, diffusers), 15 piping (pipes, elbows, tees, reducers, unions, flanges, ball valves, PRV, air valve)
- **3 BOMs fully linked**: FF-1500 (10 lines), FF-800 (9 lines), Pump-22 (7 lines) — 100% component_id coverage
- **Shared component**: COMP-VEN-50 (Venturi Injector) used in both FF-1500 and FF-800

## Design Book Engine Module
- Top-level nav section "Design Book Engine" (alongside PIM, Orders, Projects)
- Hub page: `/design-book-engine` (`DesignBookEngineDashboard.tsx`) — status counters, active books panel, recent list
- Route: `/design-books` (list) + `/design-books/:id` (detail)
- `design_books` table: id, book_code, project_id (FK, optional), book_title, description, revision, status, notes, created_by, created_at, updated_at
- `design_book_exhibit_species` table: id, design_book_id, exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order
- `design_book_exhibit_hydraulics` table: id, design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct (default 30), bottom_drain_pct (default 70), notes — UNIQUE(design_book_id, exhibit_id)
- Create flow: link to an existing project (auto-imports exhibits + tanks) or standalone
- Detail tabs:
  - **Exhibits**: groups tanks by exhibit with full dimension/volume table; each exhibit has a **Species Allocation** sub-section (add/delete species with scientific name, common name, qty, avg size, biomass; running total biomass)
  - **LSS**: live systems table imported from the linked project (code, name, type, exhibit, water type, flow, turnover, equipment count, status + duty descriptions panel)
  - **Piping**: Coming Soon
- ProjectDetail: shows "Design Book" button in header when a linked book exists for the project
- API: `GET/POST /design-books`, `GET/PUT/DELETE /design-books/:id`
- Species API: `POST /design-books/:id/species`, `PUT /design-books/:id/species/:speciesId`, `DELETE /design-books/:id/species/:speciesId`
- Route file: `apps/api/src/routes/designBooks.ts`
- Frontend: `apps/web/src/pages/design-books/DesignBooksList.tsx`, `DesignBookDetail.tsx`, `DesignBookEngineDashboard.tsx`

## Running the App, configuration and demo logins

See the [README](../README.md) for setup, scripts, environment variables (including SMTP) and the
demo logins. This document describes the platform's domain behaviour.

## PO Pipeline Stage Roles
Stage-specific actors enforced in API (`canAdvanceStage`):
- **Draft → submit**: creator OR any `canManage` role (engineer/hq_manager/admin)
- **Pending Approval → approve/reject**: `po_stage_assignees['pending_approval']` (default: admin + hq_manager); falls back to hq_manager/admin if list is empty
- **Purchase Order → PO Review**: PO creator OR hq_manager/admin OR `po_stage_assignees['purchase_order']`
- **PO Review → Engineering Review**: `po_stage_assignees['po_review']` (default: PMO user)
- **Engineering Review → Released**: `po_stage_assignees['engineering_review']` (default: engineer user)

Admin configures assignees at `/admin/po-stage-roles` (Platform Admin → Order Management → PO Stage Roles).
Table: `po_stage_assignees (id, stage, user_id, created_by, created_at)` — UNIQUE(stage, user_id).

## PO Visibility
- `users.can_see_all_pos BOOLEAN DEFAULT false` — controls whether a user sees all POs or only their own/relevant ones
- Admin and HQ Manager default to `true`; all other roles default to `false`
- Users without `can_see_all_pos` only see POs where they are: creator, designated user, or stage assignee for current status
- Toggle per user in Platform Admin → User Management ("See All POs" column)
- API: `PATCH /admin/users/:id/po-visibility { can_see_all_pos: boolean }`

## Key API Endpoints
- `POST /api/v1/auth/login` — Login
- `GET  /api/v1/projects` — Project list
- `GET  /api/v1/projects/:id` — Project detail with documents
- `GET  /api/v1/equipment-instances/:id` — Equipment detail with documents
- `GET  /api/v1/product-masters/:id` — Product detail with documents, BOM lines, variants, vendors
- `GET  /api/v1/product-masters/:id/relationships` — Product-to-product graph edges
- `POST /api/v1/product-masters/:id/relationships` — Create product-to-product link
- `POST /api/v1/product-boms` — Create a BOM for a product
- `POST /api/v1/product-boms/:id/lines` — Add BOM line
- `DELETE /api/v1/product-boms/:bomId/lines/:lineId` — Remove BOM line
- `POST /api/v1/graph/query` — Graph traversal (depth up to 5)
- `GET  /api/v1/graph/impact/:productId` — Impact analysis
- `GET  /api/v1/graph/product-reuse/:productId` — Product reuse
- `GET  /api/v1/search?q=` — Cross-domain search
- `POST /api/v1/import/products` — CSV bulk import
- `POST /api/v1/lifecycle/transition` — Lifecycle state change
- `GET  /api/v1/components` — Component list (supports ?search= ?page_size=)
- `GET  /api/v1/components/:id` — Component detail with used_in products + attached documents
- `POST /api/v1/components` — Create component
- `PUT  /api/v1/components/:id` — Update component
- `GET  /api/v1/documents?drawing_types=1` — Filter for drawings/models only
- `GET  /api/v1/documents?product_id=` — Documents for a product
- `GET  /api/v1/documents?component_id=` — Documents for a component
- `GET  /api/v1/admin/stats` — Platform stats including components count, doc status breakdown & recent docs
- `GET  /api/health` — Health check

## Lifecycle States
Draft → Internal Review → Review Commented → Resubmitted → Approved → Released → As-Built → Superseded → Obsolete

## Color Conventions (Graph)
- Blue (#3B82F6): Project domain nodes
- Green (#22C55E): Product library nodes
- Gray (#94A3B8): Knowledge domain nodes
- Amber (#F59E0B): Document nodes

## Drawings & Models Library
- Dedicated page at `/products/drawings` (nav: "Drawings Library")
- Filters all documents to drawing/model types: Drawing, GA Drawing, Assembly Drawing, Fabrication Drawing, As-Built Drawing, 3D Model, P&ID, Wiring Diagram
- Filter by entity type (Products / Components / All), drawing type, status, search
- `documents` table has `product_id` and `component_id` FKs — docs can be attached to either

## Document Types (ProductMasterDetail & ComponentDetail)
TDS, O&M Manual, Installation Manual, Certificate, Drawing (General), GA Drawing, Assembly Drawing, Fabrication Drawing, As-Built Drawing, 3D Model, P&ID, Wiring Diagram, Test Report, Specification

## ComponentDetail Tabs
- **Specifications**: Current component specs + Used in Products + Details panel
- **Documents**: Attached drawings/models with Add Document modal (same pattern as ProductMasterDetail)

## File Upload
Documents support file attachment via multipart form. Files stored at `apps/api/uploads/`. The system is designed to swap to S3 by changing only the multer storage backend.

## Notes
- All packages installed at workspace root (not in apps/ subdirectories)
- Tailwind v4 uses `@import "tailwindcss"` and `@tailwindcss/postcss` plugin
- Vite config uses `root: __dirname` to serve `apps/web/index.html` when running from monorepo root
- Express v5 is installed (compatible with routes as written)
