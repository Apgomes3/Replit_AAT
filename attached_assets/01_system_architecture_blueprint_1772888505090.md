# Engineering Data Platform — System Architecture Blueprint

Version: 0.1  
Depends on: `00_engineering_data_platform_kickstart.md`  
Purpose: Technical architecture blueprint for the Engineering Data Platform

---

# 1. Scope

This document defines the technical architecture for a platform that combines:

- PDM-style document and revision control
- Engineering Knowledge Graph relationships
- Product Library management independent of projects
- Shared Knowledge / Reference management
- Bridge logic between products and project instances

This architecture must support:

- large engineering files
- structured metadata
- graph traversal
- revision control
- workflow approvals
- reusable products
- project-specific configurations
- role-based access
- auditability

---

# 2. Architecture Principles

1. **Domain separation**  
   Project, Product Library, and Knowledge domains must remain logically separate.

2. **Authoritative records**  
   Each entity type must have one clear system-of-record inside the platform.

3. **Bridge-based reuse**  
   Projects reference products through bridge entities, not by redefining them.

4. **File + graph hybrid model**  
   Files are managed as controlled artifacts; engineering meaning is managed through entities and relationships.

5. **API-first design**  
   All core functions must be accessible through stable APIs.

6. **Event-driven updates**  
   Revision changes, approvals, and cross-domain updates should emit events.

7. **Searchable by metadata and graph**  
   Users must search by attributes and also traverse relationships.

8. **Traceability by default**  
   All state transitions, approvals, and critical edits must be auditable.

---

# 3. High-Level Architecture

```text
Client Applications
├── Web App
├── Admin Console
└── API Clients / Integrations

Application Layer
├── Identity & Access Service
├── Project Domain Service
├── Product Library Service
├── Knowledge Service
├── Document Control Service
├── Workflow & Approval Service
├── Revision Service
├── Search Service
├── Graph Query Service
├── Notification Service
└── Audit Service

Data Layer
├── Relational Database
├── Graph Database / Graph Model Layer
├── Search Index
├── Object File Storage
└── Event Log / Message Bus

Integration Layer
├── CAD Connectors
├── Revit / BIM Connectors
├── ERP Connectors
├── SharePoint / DMS Connectors
├── Email / Notification Connectors
└── Import / Export Adapters
```

---

# 4. Main Technical Layers

## 4.1 Presentation Layer

Primary UI:

- Web application for daily engineering use
- Admin console for governance, metadata, roles, and configuration

Primary UX entry points:

- Projects
- Product Library
- Knowledge Hub
- Documents
- Changes
- Approvals
- Reports
- Admin

## 4.2 Application Layer

This layer contains business logic and domain orchestration.

Main responsibilities:

- enforce naming and numbering rules
- manage revisions and versions
- resolve graph relationships
- execute approval workflows
- validate lifecycle transitions
- serve search and traversal queries
- manage notifications and audit records

## 4.3 Data Layer

This layer persists structured entities, relationships, files, and indexes.

Recommended split:

- **Relational database** for structured master data, lifecycles, approvals, attributes
- **Graph store** for relationship traversal and impact analysis
- **Search index** for fast full-text and metadata search
- **Object storage** for file binaries and file versions
- **Event store / message bus** for change propagation and integrations

## 4.4 Integration Layer

This layer handles external systems without making them the master source of truth.

Supported integration categories:

- CAD metadata extraction
- Revit/BIM model references
- ERP item and procurement sync
- SharePoint / file repository references
- email / approval notifications
- CSV / Excel import pipelines
- API-based external access

---

# 5. Domain Service Architecture

## 5.1 Identity & Access Service

Purpose:

- authentication
- authorization
- role assignment
- approval rights
- domain visibility rules

Core responsibilities:

- user profiles
- role-to-permission mapping
- project-level access restrictions
- product library governance rights
- audit of permission changes

## 5.2 Project Domain Service

Purpose:

Manage project structures and project-specific instances.

Core entities managed:

- Project
- Area
- Exhibit
- Tank Instance
- System Instance
- Subsystem Instance
- Equipment Instance
- Project Document
- Release Package

Core responsibilities:

- create and maintain project hierarchies
- bind project instances to products
- track installation and commissioning status
- manage project-level overrides

## 5.3 Product Library Service

Purpose:

Manage reusable products independently from projects.

Core entities managed:

- Product Family
- Product Master
- Product Variant
- Standard BOM
- Standard Drawing
- Standard Datasheet
- Product Rule Set
- Approved Vendor Option

Core responsibilities:

- manage standard definitions
- manage reusable configurations
- control active/deprecated/obsolete product states
- promote project derivatives into reusable standards

## 5.4 Knowledge Service

Purpose:

Manage shared engineering references.

Core entities managed:

- Material
- Specification
- Design Rule
- Calculation Template
- Test Standard
- Inspection Method
- SOP
- Approval Role
- Category / Tag Class / Asset Class

Core responsibilities:

- maintain centralized rules
- link standards to products and projects
- support engineering governance and QA/QC

## 5.5 Document Control Service

Purpose:

Control files, records, and document metadata.

Core responsibilities:

- document registration
- file storage
- metadata assignment
- file version tracking
- formal revision issuance
- superseded record handling

## 5.6 Workflow & Approval Service

Purpose:

Execute approval processes and lifecycle transitions.

Core responsibilities:

- workflow templates
- role-based approval routing
- review cycles
- approval comments
- hold / reject / resubmit logic
- release package approvals

## 5.7 Revision Service

Purpose:

Separate working versions from issued revisions.

Core responsibilities:

- version history
- formal revisions
- revision comparison metadata
- as-built state management
- rollback governance

## 5.8 Graph Query Service

Purpose:

Resolve engineering relationships and cross-domain paths.

Core responsibilities:

- relationship traversal
- impact analysis
- dependency tracing
- product reuse analysis
- project-to-product navigation

## 5.9 Search Service

Purpose:

Serve full-text, metadata, and domain-specific search.

Core responsibilities:

- indexing
- faceted filtering
- saved searches
- search ranking by domain relevance
- graph-assisted search suggestions

## 5.10 Notification Service

Purpose:

Handle email, in-app, and webhook notifications.

Core responsibilities:

- approval requests
- revision release notices
- change impact notices
- subscription alerts

## 5.11 Audit Service

Purpose:

Maintain non-repudiable history of key changes.

Core responsibilities:

- log entity creation
- log lifecycle transitions
- log approval actions
- log permission changes
- log cross-domain promotion actions

---

# 6. Data Model Strategy

## 6.1 Relational Model

Use the relational layer for:

- entity master records
- attributes
- lifecycle states
- users and permissions
- approvals
- revisions
- workflow instances
- numbering and naming rules

## 6.2 Graph Model

Use the graph layer for:

- entity-to-entity relationships
- graph traversal
- impact analysis
- product reuse paths
- dependency discovery

Typical graph edges:

- `has`
- `contains`
- `served_by`
- `references`
- `uses`
- `configured_from`
- `derived_from`
- `approved_by`
- `complies_with`
- `provided_by`

## 6.3 Search Index

Index:

- document titles
- metadata fields
- project identifiers
- product identifiers
- equipment tags
- vendor names
- specifications
- revision codes
- relationship-derived keywords

## 6.4 Object Storage

Use object storage for:

- CAD files
- PDFs
- images
- spreadsheets
- vendor files
- drawing exports
- calculation attachments

Required file metadata:

- object key
- checksum
- mime type
- file size
- uploaded by
- upload timestamp
- linked entity
- version number
- revision state

---

# 7. Entity Identification Strategy

All key entities must have stable IDs.

## 7.1 Internal IDs

Use immutable internal UUIDs for system integrity.

Examples:

- `proj_uuid`
- `prod_uuid`
- `doc_uuid`
- `equip_uuid`

## 7.2 Human-Readable Codes

Use readable structured codes for engineering and user-facing references.

Examples:

- Project: `PRJ-TY-001`
- Exhibit: `EXH-SHARK-01`
- System: `SYS-LSS-SHARK-01`
- Equipment Instance: `EQ-FF-1500-01`
- Product Master: `PM-FF-1500`
- Document: `DOC-PID-LSS-SHARK-01`
- Drawing: `DRW-TK-001`
- Revision: `REV-B`

## 7.3 Rules

- internal IDs never change
- display codes may be revised only under controlled renumbering rules
- no duplicate human-readable codes in the same scope
- prefixes must reflect entity class

---

# 8. Naming and Numbering Structure

## 8.1 Naming Principles

Names must be:

- unambiguous
- role-neutral
- domain-aligned
- searchable
- stable across lifecycle transitions

## 8.2 Suggested Prefixes

### Project Domain
- `PRJ` Project
- `PHS` Project Phase
- `ARE` Area
- `EXH` Exhibit
- `TNK` Tank Instance
- `SYS` System Instance
- `SUB` Subsystem Instance
- `EQI` Equipment Instance
- `RLS` Release Package
- `PJD` Project Document
- `PDR` Project Drawing

### Product Library Domain
- `PFM` Product Family
- `PM` Product Master
- `PV` Product Variant
- `SBM` Standard BOM
- `SDR` Standard Drawing
- `SDS` Standard Datasheet
- `PRS` Product Rule Set
- `AVO` Approved Vendor Option

### Knowledge Domain
- `MAT` Material
- `SPC` Specification
- `DRL` Design Rule
- `CTM` Calculation Template
- `TST` Test Standard
- `IMP` Inspection Method
- `SOP` Work Instruction / SOP

### Governance
- `REV` Revision
- `VER` Version
- `WF` Workflow
- `APR` Approval
- `CR` Change Request
- `AUD` Audit Event

## 8.3 Product Structure Naming

Recommended pattern:

`<Category>-<Base Product>-<Capacity or Key Size>-<Variant>`

Examples:

- `FF-1500-SALT`
- `SF-900-HDPE`
- `UV-1200-MARINE`
- `LCU-S3-240V`

## 8.4 Project Instance Naming

Recommended pattern:

`<Project>-<System>-<Equipment Type>-<Sequence>`

Examples:

- `TY-SHARK-FF-01`
- `TY-SHARK-SF-01`
- `BP-QUAR-UV-02`

---

# 9. Product Structure Model

## 9.1 Product Family

Groups related products.

Examples:

- Foam Fractionators
- Sand Filters
- UV Reactors
- Control Panels
- FRP Tanks

## 9.2 Product Master

Canonical reusable definition.

Includes:

- performance envelope
- standard BOM
- standard drawing set
- rule set
- approved vendor options

## 9.3 Product Variant

Specific approved variation of a product master.

Examples:

- different material
- different salinity application
- different power standard
- different regional compliance

## 9.4 Project Product Usage

Records project consumption of a product.

## 9.5 Project Product Configuration

Records controlled parameter overrides.

## 9.6 Project Product Derivative

Records a new derivative created from a standard product.

---

# 10. Version and Revision Model

## 10.1 Version

Working-state changes.

Examples:

- v1 Draft
- v2 Draft updated after comments

## 10.2 Revision

Formal issued state.

Examples:

- Rev A For Review
- Rev B For Construction
- Rev C As-Built

## 10.3 Rules

- versions change frequently during drafting
- revisions change only on controlled issue
- superseded revisions remain visible but clearly marked
- only one current revision may be effective per controlled scope
- as-built revisions are final project record revisions

---

# 11. Workflow Model

## 11.1 Standard Workflow Stages

1. Draft
2. Internal Review
3. Review Commented
4. Resubmitted
5. Approved for Internal Use
6. Released for Procurement / Fabrication / Construction
7. As-Built
8. Superseded / Obsolete

## 11.2 Approval Structure

Typical approval chain:

- Author
- Reviewer
- Discipline Lead
- Engineering Manager
- Project Manager (if project-controlled)
- QA/QC (if hold point or release package)
- Final issuer

## 11.3 Workflow Rules

- workflows must be template-driven
- transitions must be permission-controlled
- all approvals require timestamps and actors
- rejected items must preserve review history

---

# 12. Search Architecture

## 12.1 Search Modes

### Project Search
Examples:

- all equipment in Project Taoyuan
- all released drawings in Shark Exhibit

### Product Search
Examples:

- all active foam fractionators
- all variants of SF-900

### Knowledge Search
Examples:

- FRP material specifications
- acrylic handling SOP

### Graph Traversal Search
Examples:

- where is product FF-1500 used
- what documents affect tank TK-002
- which specifications apply to system SYS-LSS-SHARK-01

## 12.2 Search Filters

- domain
- entity type
- lifecycle state
- revision state
- project
- product family
- exhibit
- system
- equipment type
- vendor
- material
- discipline
- date range

---

# 13. Relationship Representation

Relationships must be explicit in both backend and UI.

## 13.1 Required Relationship Visibility in Detail Pages

Each detail page must show:

- parent entities
- child entities
- referenced products
- referenced standards
- linked documents
- linked revisions
- change requests
- approvals
- audit events

## 13.2 Required Relationship Blocks by Entity

### Project Detail
- Areas
- Exhibits
- Systems
- Release Packages
- Issues
- Documents

### Product Master Detail
- Product Family
- Variants
- Standard BOM
- Standard Drawings
- Approved Vendor Options
- Used In Projects
- Derived Products

### Equipment Instance Detail
- Project
- System
- Product Master
- Configuration Overrides
- Documents
- Vendor Links
- Installation / Commissioning Records

### Knowledge Entity Detail
- Products using this rule
- Projects affected by this rule
- Related standards
- Related documents

---

# 14. UI Design Baseline

## 14.1 Color System

Use a restrained technical palette.

### Primary colors
- Dark Navy: `#1F2A44`
- Steel Blue: `#3E5C76`
- Slate Gray: `#748CAB`

### Neutral colors
- White: `#FFFFFF`
- Off White: `#F8FAFC`
- Light Gray: `#E2E8F0`
- Mid Gray: `#94A3B8`
- Charcoal: `#334155`

### Status colors
- Success Green: `#2E7D32`
- Warning Amber: `#ED6C02`
- Error Red: `#C62828`
- Info Blue: `#0288D1`

### Usage rules
- use status colors only for status, warnings, approvals, errors
- do not use bright decorative colors
- relation lines in graph views should default to neutral gray/blue tones

## 14.2 Typography

Recommended fonts:

- Primary UI font: `Inter`
- Secondary fallback: `Roboto`
- Monospace for codes / IDs: `JetBrains Mono`

Usage:

- page titles: 24–28 px semibold
- section titles: 18–20 px semibold
- body text: 14–16 px regular
- metadata labels: 12–13 px medium
- IDs / codes: monospace 12–14 px

## 14.3 UI Style Rules

- dense but readable
- technical, not decorative
- cards only where structure benefits clarity
- primary navigation always visible
- detail pages must show metadata and relationships side by side
- graph panels must complement, not replace, structured tables

---

# 15. Code Structure Blueprint

## 15.1 Recommended Repository Structure

```text
engineering-data-platform/
├── apps/
│   ├── web/
│   └── admin/
├── services/
│   ├── identity-service/
│   ├── project-service/
│   ├── product-service/
│   ├── knowledge-service/
│   ├── document-service/
│   ├── workflow-service/
│   ├── revision-service/
│   ├── graph-service/
│   ├── search-service/
│   ├── notification-service/
│   └── audit-service/
├── packages/
│   ├── ui/
│   ├── types/
│   ├── naming-rules/
│   ├── validation-rules/
│   └── shared-utils/
├── integrations/
│   ├── revit/
│   ├── cad/
│   ├── erp/
│   ├── sharepoint/
│   └── email/
├── infrastructure/
│   ├── database/
│   ├── graph/
│   ├── search/
│   ├── storage/
│   └── deployment/
├── docs/
│   ├── 00_engineering_data_platform_kickstart.md
│   └── 01_system_architecture_blueprint.md
└── tests/
    ├── unit/
    ├── integration/
    ├── contract/
    └── e2e/
```

## 15.2 Naming Rules for Code

- services use kebab-case folders
- shared types use PascalCase type names
- API routes use noun-based resources
- no domain logic inside UI components
- naming rule packages must be reusable across services

---

# 16. API Design Baseline

## 16.1 Principles

- API-first
- resource-based
- explicit IDs
- pagination for search
- filtering by domain attributes
- stable contract versioning

## 16.2 Example Resource Groups

- `/projects`
- `/areas`
- `/exhibits`
- `/systems`
- `/equipment-instances`
- `/product-families`
- `/product-masters`
- `/product-variants`
- `/materials`
- `/specifications`
- `/documents`
- `/revisions`
- `/approvals`
- `/graph/query`
- `/search`

## 16.3 Graph Query Endpoint

Support controlled graph traversal queries.

Examples:

- find product usage by product master
- find impacted documents by change request
- find standards affecting a project system

---

# 17. Permissions Model

## 17.1 Core Roles

- Viewer
- Contributor
- Reviewer
- Approver
- Discipline Lead
- Product Library Manager
- Project Manager
- QA/QC
- Admin

## 17.2 Permission Groups

- view
- create
- edit metadata
- upload file
- issue revision
- approve workflow
- release package
- create derivative
- promote derivative to standard
- manage naming rules
- manage permissions

## 17.3 Rules

- product library governance must be separately permissioned
- project access may be restricted by project membership
- approval rights must be explicit, not implied
- audit access must be read-only for most users

---

# 18. Integration Strategy

## 18.1 Connector Principles

- integrations are adapters, not core masters
- external system failures must not corrupt core records
- sync direction must be explicit
- imported data must be traceable to source system

## 18.2 Integration Types

### CAD / Revit
- metadata extraction
- file reference registration
- model version linkage

### ERP
- item references
- procurement status
- vendor item mapping

### SharePoint / DMS
- linked repository references
- controlled migration support
- file metadata ingestion

### Email / Notifications
- approval notices
- release notices
- change notices

---

# 19. Non-Functional Requirements

## Performance
- detail page load under acceptable engineering-use thresholds
- search must support large metadata sets
- graph traversal must return useful results quickly for common paths

## Security
- role-based access control
- encrypted auth flows
- audit logs for sensitive actions

## Reliability
- document storage integrity
- checksum validation
- retry-safe event handling

## Scalability
- support growing project volumes
- support reusable product library expansion
- support cross-project analytics

---

# 20. Specification Deepening Stages

The next work packages should make this blueprint more specific.

## Stage A — Entity Specification Pack
Define all entities and required attributes in full detail.

## Stage B — Relationship Specification Pack
Define every relationship type, cardinality, and display rule.

## Stage C — Naming and Numbering Pack
Define exact code patterns, prefixes, scope rules, and collision rules.

## Stage D — Workflow and Revision Pack
Define all approval chains, transitions, version/revision rules, and edge cases.

## Stage E — UI and Design System Pack
Define screen-by-screen wireframes, color tokens, typography tokens, spacing, iconography.

## Stage F — API Contract Pack
Define endpoint contracts, request/response models, validation, and auth rules.

## Stage G — Integration Pack
Define connector contracts, sync logic, mapping rules, and failure handling.

## Stage H — Implementation Pack
Define final code modules, tech stack, deployment architecture, testing strategy, and observability.

---

# 21. Final Principle

The platform must be built as a structured engineering system, not a generic document portal.

Project entities represent deployed instances.
Product entities represent reusable definitions.
Knowledge entities represent rules and standards.
Relationships must be explicit, visible, and queryable.
Files are controlled artifacts attached to engineering meaning, not the primary model.
