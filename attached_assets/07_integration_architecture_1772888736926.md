# Engineering Data Platform
# Integration Architecture Specification

Version: 0.1
Depends on:
00_engineering_data_platform_kickstart.md
01_system_architecture_blueprint.md
02_entity_and_relationship_specification.md
03_workflow_lifecycle_specification.md
04_design_system_and_ui_tokens.md
05_api_contract_specification.md
06_graph_query_specification.md

Purpose: Define the integration architecture, connector patterns, data ownership rules, synchronization logic, and failure handling for external systems.

---

# 1. Context

The Engineering Data Platform must integrate with external tools without becoming dependent on them as the master source of truth.

The platform must support integration with:

• CAD systems  
• Revit / BIM tools  
• ERP systems  
• SharePoint / document repositories  
• email and notification systems  
• CSV / Excel import pipelines  
• webhook-based automation  

Integrations must enrich the platform, not control it.

---

# 2. Integration Principles

1. External systems are adapters, not core masters.
2. Source-of-truth ownership must be explicit.
3. Every imported record must retain source traceability.
4. Sync direction must be defined per entity type.
5. Integration failures must be isolated and recoverable.
6. Connectors must be replaceable without changing the core domain model.
7. File synchronization and metadata synchronization must be treated separately.

---

# 3. Integration Categories

## 3.1 CAD Integration

Purpose

Register engineering files, extract metadata, and link controlled files to entities.

Supported data

• file references  
• title block metadata  
• drawing numbers  
• revision tags  
• model identifiers  
• linked entity codes  

Typical systems

• AutoCAD  
• Inventor  
• SolidWorks  
• Onshape exports  
• other CAD exports  

---

## 3.2 Revit / BIM Integration

Purpose

Link BIM models and element metadata to project and product entities.

Supported data

• model identifiers  
• family references  
• instance references  
• view and sheet metadata  
• parameter extraction  
• document linkage  

Typical systems

• Revit  
• ACC/BIM 360 exports  
• IFC exports  

---

## 3.3 ERP Integration

Purpose

Connect engineering data to commercial and procurement records.

Supported data

• item references  
• procurement status  
• purchase package status  
• vendor references  
• approved manufacturer records  
• lead times  
• cost references  

Typical systems

• ERP item master  
• purchasing modules  
• supplier systems  

---

## 3.4 SharePoint / DMS Integration

Purpose

Reference or migrate legacy document repositories.

Supported data

• document links  
• file metadata  
• folder mapping  
• legacy transmittal references  
• migration status  

---

## 3.5 Email / Notification Integration

Purpose

Support approval notifications, release notices, and workflow alerts.

Supported events

• approval requested  
• approval completed  
• revision released  
• change request raised  
• release package issued  

---

## 3.6 CSV / Excel Import

Purpose

Bulk-load structured records into the platform.

Supported imports

• product libraries  
• equipment lists  
• document registers  
• vendor lists  
• material libraries  
• project system lists  

---

## 3.7 Webhook / Automation Integration

Purpose

Trigger external workflows from platform events.

Examples

• send approval notifications  
• create downstream tasks  
• update reporting dashboards  
• notify external orchestration tools  

---

# 4. Source-of-Truth Hierarchy

Source-of-truth must be explicit by record type.

## Platform as source-of-truth

The Engineering Data Platform is the source-of-truth for:

• project entities  
• product library entities  
• knowledge entities  
• relationships  
• lifecycle states  
• workflow states  
• revisions  
• approvals  

## External systems may be source-of-truth for selected fields

Examples

### ERP
• purchase order status  
• supplier lead time  
• commercial item code  

### CAD / Revit
• native file geometry  
• authoring-tool-specific metadata  

### SharePoint / DMS
• legacy repository location during migration only  

---

# 5. Sync Directions

Sync direction must be declared for every integration path.

## One-way into platform

Examples

ERP → procurement status  
CAD → extracted title block metadata  
Revit → parameter extraction  

## One-way out of platform

Examples

Platform → notifications  
Platform → downstream reporting  
Platform → webhook events  

## Controlled bidirectional

Allowed only where explicitly justified.

Example

Platform ↔ ERP item references

Conditions

• field-level ownership defined  
• conflict rules defined  
• audit trail enabled  

---

# 6. Connector Pattern

Every integration connector must follow the same structure.

## Required connector components

Connector Name  
Source System  
Target Domain  
Entity Types  
Sync Direction  
Sync Trigger  
Mapping Rules  
Validation Rules  
Failure Handling  
Audit Requirements  

---

## Good Example

Connector Name: ERP Procurement Status Connector

Source System: ERP  
Target Domain: Project Domain  
Entity Types: Equipment Instance, Purchase Package  
Sync Direction: ERP → Platform  
Sync Trigger: Scheduled every 30 minutes  
Mapping Rules: ERP item code maps to approved vendor option or purchase package  
Failure Handling: retry queue, error log, no destructive overwrite

---

## Bad Example

Connector pulls all data and overwrites all matching fields.

Problem

• source-of-truth unclear  
• no conflict handling  
• high risk of corrupting master data  

---

# 7. CAD Integration Rules

CAD integrations must separate:

• binary file registration  
• metadata extraction  
• relationship binding  

## CAD minimum metadata fields

file_name  
file_type  
document_code  
revision_code  
author  
creation_date  
last_modified_date  
linked_entity_code  

## CAD binding rule

No CAD file may remain unlinked if it is intended to be controlled.

Every controlled CAD file must be linked to at least one entity:

• Document  
• Drawing  
• Product Master  
• Equipment Instance  
• System Instance  

---

## Prompt — Define CAD Integration

Context

Engineering files must be controlled without making CAD tools the system-of-record.

Identity

You are a **CAD Integration Architect**.

Mission

Define how CAD files and metadata integrate into the platform.

Deliverables

Provide:

connector structure  
minimum metadata fields  
binding rules  
file and metadata ownership rules  

Boundaries

Do not make CAD tools the owner of lifecycle states or approvals.

### Good Example

CAD file registered as Document with extracted revision and linked entity code.

### Bad Example

CAD folders mirrored into platform with no entity linkage.

Problem

Files remain disconnected from engineering meaning.

---

# 8. Revit / BIM Integration Rules

Revit / BIM integrations must support model references and parameter extraction without making BIM the sole engineering model.

## Revit minimum metadata fields

model_id  
model_name  
sheet_number  
view_name  
family_name  
instance_id  
project_code  
linked_entity_code  

## BIM binding rule

Revit data may enrich:

• Project  
• Area  
• Exhibit  
• System Instance  
• Equipment Instance  
• Drawing  

But platform entities must remain authoritative for naming, lifecycle, and relationships.

---

## Prompt — Define Revit / BIM Integration

Context

BIM data must support project navigation and coordination, not replace domain governance.

Identity

You are a **BIM Integration Architect**.

Mission

Define how BIM metadata and references integrate into the platform.

Deliverables

Provide:

connector model  
parameter extraction rules  
entity mapping rules  
conflict handling  

Boundaries

Do not allow BIM family naming to override platform naming governance.

### Good Example

Revit sheet metadata imported and linked to Drawing entity.

### Bad Example

Revit families become Product Master records automatically.

Problem

Product library loses governance and reuse logic.

---

# 9. ERP Integration Rules

ERP integration must support procurement and vendor visibility while keeping engineering definitions controlled by the platform.

## ERP minimum fields

erp_item_code  
vendor_code  
purchase_status  
lead_time  
po_reference  
cost_code  
approved_manufacturer  

## ERP ownership rules

ERP owns:

• purchase order state  
• lead time  
• commercial cost references  

Platform owns:

• engineering product definition  
• equipment classification  
• relationship model  
• engineering release state  

---

## Prompt — Define ERP Integration

Context

Commercial status must link to engineering entities without distorting the engineering model.

Identity

You are an **ERP Integration Architect**.

Mission

Define ERP-to-platform synchronization rules.

Deliverables

Provide:

field ownership  
mapping rules  
sync direction  
conflict resolution  
error handling  

Boundaries

ERP must not create engineering entities implicitly.

### Good Example

ERP lead time updates approved vendor option.

### Bad Example

ERP item list creates uncontrolled Product Masters.

Problem

Engineering product library becomes polluted with procurement records.

---

# 10. SharePoint / DMS Integration Rules

SharePoint and legacy document repositories must be treated as transitional or linked repositories, not conceptual masters.

## Use cases

• linked legacy documents  
• migration staging  
• document register ingestion  
• controlled archive references  

## Rules

• repository path must be stored as reference metadata only  
• file migration status must be visible  
• migrated records must receive platform IDs  
• legacy folder structure must not dictate platform ontology  

---

## Prompt — Define SharePoint / DMS Integration

Context

Legacy repositories contain documents but not structured engineering meaning.

Identity

You are a **Document Migration Architect**.

Mission

Define how SharePoint or legacy DMS repositories integrate into the platform.

Deliverables

Provide:

migration model  
linking rules  
metadata extraction rules  
archive handling  

Boundaries

Do not reproduce folder structures as platform domain models.

### Good Example

Legacy PDF linked to Document entity with migration status = referenced.

### Bad Example

Platform navigation copied directly from SharePoint folders.

Problem

Engineering structure remains buried in document folders.

---

# 11. CSV / Excel Import Rules

Bulk imports must be structured, validated, and reversible.

## Import requirements

• template definition  
• required field validation  
• duplicate detection  
• dry-run preview  
• row-level error reporting  
• import audit log  

## Typical import templates

Product Master import  
Equipment Instance import  
Document Register import  
Vendor import  
Material import  

---

## Prompt — Define CSV / Excel Import

Context

Engineering teams often start with spreadsheets; imports must convert them into controlled records.

Identity

You are a **Data Import Architect**.

Mission

Define spreadsheet and CSV import rules.

Deliverables

Provide:

template structures  
validation rules  
duplicate handling  
rollback rules  

Boundaries

Do not allow blind bulk inserts without validation.

### Good Example

Import validates product_code uniqueness before commit.

### Bad Example

Spreadsheet rows inserted directly without mapping or validation.

Problem

Master data becomes inconsistent immediately.

---

# 12. Event and Webhook Rules

Platform events must be published in a controlled format.

## Event categories

entity.created  
entity.updated  
revision.issued  
workflow.approval_requested  
workflow.approved  
release_package.issued  
change_request.created  

## Event payload minimum fields

event_id  
event_type  
entity_type  
entity_id  
timestamp  
actor  
summary  

## Webhook safety rules

• signed payloads  
• retry with backoff  
• idempotent receivers required  
• dead-letter queue for failed deliveries  

---

## Prompt — Define Webhook Architecture

Context

Platform events must support automation without compromising reliability.

Identity

You are an **Event-Driven Systems Architect**.

Mission

Define webhook and event publication rules.

Deliverables

Provide:

event types  
payload models  
delivery rules  
retry rules  
security rules  

Boundaries

Do not allow webhooks to mutate core platform data without explicit API contracts.

### Good Example

revision.issued event triggers release notification.

### Bad Example

Webhook directly edits project entity state without validation.

Problem

Core governance is bypassed.

---

# 13. Mapping and Transformation Rules

Every integration must define field-level mapping.

## Required mapping structure

Source Field  
Source Type  
Target Entity  
Target Field  
Transformation Rule  
Validation Rule  
Ownership Rule  

## Example

ERP field: vendor_code  
Target Entity: Approved Vendor Option  
Target Field: vendor_reference  
Transformation: trim + uppercase  
Validation: must match existing Vendor code  
Ownership: ERP owns source value

---

# 14. Conflict Resolution Rules

Conflicts must be predictable.

## Conflict resolution order

1. reject unauthorized overwrite
2. preserve platform authoritative value
3. store inbound conflicting value in error log / staging
4. notify responsible integration owner

## Examples

If ERP sends product_name for Product Master:
reject overwrite

If ERP sends lead_time for Approved Vendor Option:
accept update if mapping valid

---

# 15. Integration Audit Requirements

Every integration action must log:

connector_id  
source_system  
entity_type  
entity_id  
action  
timestamp  
status  
payload_reference  
error_message if applicable  

---

# 16. Relationship Presence in Integrated Records

Integrated data must still surface relationships clearly.

## Example requirements

CAD-linked Drawing detail page must show:
• linked System Instance  
• linked Product Master if applicable  
• linked Revision  
• source file metadata  

ERP-linked Equipment Instance detail page must show:
• approved vendor option  
• procurement status  
• related purchase package  

SharePoint-linked Document detail page must show:
• migration status  
• original source path  
• controlled platform entity link  

---

# 17. Integration UI Requirements

Integration status must be visible in the platform.

## Required UI fields

source_system  
sync_status  
last_sync_at  
last_sync_result  
mapping_status  
migration_status where applicable  

## Sync statuses

Not Linked  
Linked  
Pending Sync  
Synced  
Sync Error  
Deprecated Connector  

---

# 18. Security Rules

Integrations must follow least-privilege access.

## Requirements

• service accounts per connector  
• scoped API credentials  
• no shared admin tokens  
• secret rotation support  
• audit trail for credential changes  

---

# 19. Non-Functional Rules

## Performance
Integrations must not block user-facing platform transactions.

## Reliability
Retries must be safe and non-destructive.

## Maintainability
Connector logic must remain isolated from core domain logic.

## Observability
Every connector must expose logs, health status, and error counts.

---

# 20. Prompt — Define Source-of-Truth Matrix

Context

A multi-system environment requires explicit field ownership.

Identity

You are a **Master Data Governance Architect**.

Mission

Define source-of-truth ownership by entity and field.

Deliverables

Provide:

entity ownership matrix  
field-level ownership examples  
conflict rules  
sync direction rules  

Boundaries

No shared ownership without explicit conflict rules.

### Good Example

Platform owns Product Master.name; ERP owns Approved Vendor Option.lead_time.

### Bad Example

Both ERP and platform can edit product_name freely.

Problem

No stable authoritative record exists.

---

# 21. Next Specification Packs

08_repository_and_deployment_architecture.md

09_product_and_project_data_model_expansion.md

---

# Final Principle

Integrations must connect external tools to the platform without weakening engineering governance.

The platform owns engineering structure.
External tools contribute files, references, and selected operational data.
All sync directions, mappings, and ownership rules must be explicit.
