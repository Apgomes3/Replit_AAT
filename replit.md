# Engineering Data Platform (EDP)

## Overview
A full-stack knowledge graph platform for aquarium/engineering projects with three domains: Project, Product Library, and Knowledge Hub.

## Architecture

### Stack
- **Frontend**: React 19 + TypeScript + Vite 7 (port 5000)
- **Backend**: Node.js + Express 5 + TypeScript (port 3000)
- **Database**: PostgreSQL (Replit built-in) with recursive CTE graph traversal
- **Auth**: JWT + bcrypt (self-contained, no OAuth)
- **File Storage**: Local disk at `apps/api/uploads/` (S3-swap-ready)
- **CSS**: Tailwind CSS v4 with `@import "tailwindcss"` syntax
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
        routes/
          auth.ts           # POST /login, GET /me
          projects.ts       # Projects, Areas, Exhibits, Tanks, Systems, Equipment
          products.ts       # Product Families, Masters, Variants, BOMs, Vendors
          knowledge.ts      # Materials, Specifications, Design Rules, Calc Templates
          documents.ts      # Documents, Revisions, Approvals, File Upload
          graph.ts          # Graph traversal, impact, reuse
          search.ts         # Cross-entity full-text search
          import.ts         # CSV bulk import (products, equipment, documents)
          admin.ts          # User management, audit logs, stats
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
- **Project domain**: projects, areas, exhibits, tanks, systems, equipment_instances
- **Product Library**: product_families, product_masters, product_variants, standard_boms, bom_lines, vendor_options
- **Bridge**: product_usages (links equipment instances to product masters)
- **Knowledge**: materials, specifications, design_rules, calculation_templates
- **Documents**: documents, document_revisions, approvals, release_packages
- **Graph**: entity_relationships (source_id, source_type, target_id, target_type, edge_type)
- **Workflow**: lifecycle_transitions
- **Auth**: users, refresh_tokens
- **Audit**: audit_logs

## Running the App

```bash
npm run dev        # Start both API (port 3000) + Web (port 5000) concurrently
npm run migrate    # Run database migrations
npm run seed       # Seed Taoyuan Aquarium demo data
```

## Demo Credentials
- **Admin**: admin@edp.com / admin123
- **Engineer**: engineer@edp.com / engineer123
- **Viewer**: viewer@edp.com / viewer123

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
- `GET  /api/v1/admin/stats` — Platform stats including doc status breakdown & recent docs
- `GET  /api/health` — Health check

## Lifecycle States
Draft → Internal Review → Review Commented → Resubmitted → Approved → Released → As-Built → Superseded → Obsolete

## Color Conventions (Graph)
- Blue (#3B82F6): Project domain nodes
- Green (#22C55E): Product library nodes
- Gray (#94A3B8): Knowledge domain nodes
- Amber (#F59E0B): Document nodes

## File Upload
Documents support file attachment via multipart form. Files stored at `apps/api/uploads/`. The system is designed to swap to S3 by changing only the multer storage backend.

## Notes
- All packages installed at workspace root (not in apps/ subdirectories)
- Tailwind v4 uses `@import "tailwindcss"` and `@tailwindcss/postcss` plugin
- Vite config uses `root: __dirname` to serve `apps/web/index.html` when running from monorepo root
- Express v5 is installed (compatible with routes as written)
