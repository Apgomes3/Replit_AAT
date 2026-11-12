# Engineering Data Platform
# Product and Project Data Model Expansion

Version: 0.1
Depends on:
00_engineering_data_platform_kickstart.md
01_system_architecture_blueprint.md
02_entity_and_relationship_specification.md
03_workflow_lifecycle_specification.md
04_design_system_and_ui_tokens.md
05_api_contract_specification.md
06_graph_query_specification.md
07_integration_architecture.md
08_repository_and_deployment_architecture.md

Purpose: Define the detailed attribute dictionaries, validation rules, naming structures, relationship properties, and cross-domain linking rules for all major entities in the platform.

---

# 1. Context

The Engineering Data Platform requires a precise and stable data model.

High-level entities are not enough for implementation.

The platform now needs detailed definitions for:

• project structures  
• product structures  
• system and equipment hierarchies  
• documents and revisions  
• knowledge entities  
• bridge entities  
• relationship attributes  
• validation logic  

This document expands the master data model into implementation-ready specifications.

---

# 2. Data Model Principles

1. Every major entity must have a stable internal identifier.
2. Every major entity must have a human-readable code.
3. Every attribute must have a clear meaning.
4. Validation rules must be deterministic.
5. Cross-domain links must be explicit.
6. Product and project data must remain separate unless connected through bridge entities.
7. Relationship properties must be modeled where engineering meaning requires them.

---

# 3. Common Attribute Standards

All major entities should support the following common attributes where applicable.

## Common System Attributes

internal_id  
display_code  
name  
description  
status  
owner_role  
created_at  
created_by  
updated_at  
updated_by  
source_system  
source_reference  
audit_required  

## Validation Rules

- internal_id must be immutable
- display_code must be unique within its entity scope
- name must not be empty
- status must match allowed lifecycle states
- timestamps must be system-generated
- source_system must be null or from approved integration source list

---

# 4. Project Domain Expansion

## 4.1 Project

Purpose

Represents a delivery contract or execution context.

### Required Attributes

project_id  
project_code  
project_name  
client_name  
site_name  
country  
city  
timezone  
project_status  
project_phase  
contract_reference  
start_date  
target_completion_date  
actual_completion_date  
project_manager  
engineering_manager  
qa_owner  

### Optional Attributes

client_code  
internal_program  
currency  
language  
notes  

### Validation Rules

- project_code format: `PRJ-[A-Z0-9]+-[0-9]{3}`
- project_name required
- project_status must be from controlled list
- target_completion_date cannot be earlier than start_date

### Good Example

project_code: PRJ-TY-001  
project_name: Taoyuan Aquarium  
country: Taiwan

### Bad Example

project_code: Project1

Problem:
Code not controlled and not searchable at scale.

---

## 4.2 Area

Purpose

Defines a major project zone or operational area.

### Required Attributes

area_id  
area_code  
project_id  
area_name  
discipline_scope  
status  

### Validation Rules

- area_code unique within project
- area must reference exactly one project

### Example

area_code: ARE-SHARK-01

---

## 4.3 Exhibit

Purpose

Defines an exhibit or operational display context.

### Required Attributes

exhibit_id  
exhibit_code  
project_id  
area_id  
exhibit_name  
water_type  
design_temperature_min  
design_temperature_max  
design_salinity  
status  

### Validation Rules

- exhibit must belong to one area and one project
- water_type must match controlled values: Freshwater, Marine, Brackish, Other

---

## 4.4 Tank Instance

Purpose

Defines a tank deployed in a specific project.

### Required Attributes

tank_instance_id  
tank_code  
project_id  
area_id  
exhibit_id  
tank_name  
tank_type  
shape_type  
gross_volume_m3  
operating_volume_m3  
length_mm  
width_mm  
height_mm  
design_water_level_mm  
primary_material  
status  

### Optional Attributes

acrylic_panel_count  
frp_spec_reference  
steel_frame_reference  
notes  

### Validation Rules

- dimensions must be positive numeric values
- operating_volume_m3 cannot exceed gross_volume_m3
- tank_code format: `TNK-[A-Z0-9-]+`

### Good Example

tank_code: TNK-SHARK-01  
gross_volume_m3: 518

### Bad Example

tank_code: Tank Big

Problem:
Human phrase, not a controlled engineering identifier.

---

## 4.5 System Instance

Purpose

Defines a deployed engineering system in a project.

### Required Attributes

system_instance_id  
system_code  
project_id  
area_id  
exhibit_id  
system_name  
system_type  
design_flow_m3h  
turnover_rate_hr  
water_type  
status  
primary_control_panel_code  

### Optional Attributes

duty_description  
redundancy_strategy  
design_basis_reference  

### Validation Rules

- system_code format: `SYS-[A-Z0-9-]+`
- design_flow_m3h must be positive
- turnover_rate_hr must be positive where applicable

---

## 4.6 Equipment Instance

Purpose

Defines a specific installed or planned equipment record in a project.

### Required Attributes

equipment_instance_id  
equipment_code  
project_id  
system_instance_id  
equipment_type  
equipment_subtype  
equipment_name  
product_usage_id  
operational_duty  
design_flow_m3h  
design_head_m  
power_kw  
material_code  
status  
location_reference  

### Optional Attributes

serial_number  
installation_date  
commissioning_date  
vendor_option_id  
po_reference  

### Validation Rules

- equipment must reference one system instance
- equipment_code format: `EQI-[A-Z0-9-]+`
- product_usage_id required for standard product-backed equipment
- power_kw must be >= 0

### Good Example

equipment_code: EQI-TY-SHARK-FF-01  
equipment_type: Foam Fractionator

### Bad Example

equipment_name: Filter

Problem:
Too generic; cannot distinguish type or trace to product definition.

---

# 5. Product Library Expansion

## 5.1 Product Family

Purpose

Groups reusable product definitions.

### Required Attributes

product_family_id  
product_family_code  
product_family_name  
category_code  
status  
owner_role  

### Validation Rules

- product_family_code format: `PFM-[A-Z0-9-]+`
- family name unique within category

---

## 5.2 Product Master

Purpose

Canonical reusable engineering product definition.

### Required Attributes

product_master_id  
product_code  
product_family_id  
product_name  
product_category  
application_type  
design_flow_m3h  
design_pressure_bar  
design_head_m  
power_kw  
primary_material_code  
standard_status  
default_bom_id  
default_datasheet_id  
default_rule_set_id  
status  

### Optional Attributes

salinity_class  
temperature_class  
regional_compliance  
notes  

### Validation Rules

- product_code format: `PM-[A-Z0-9-]+`
- primary_material_code must reference Material
- default_bom_id optional only if product type legitimately has no BOM
- standard_status must be controlled: Concept, UnderDevelopment, ApprovedStandard, Active, Deprecated, Obsolete

### Good Example

product_code: PM-FF-1500  
product_name: Foam Fractionator FF-1500  
design_flow_m3h: 1500

### Bad Example

product_code: FF  
product_name: Filter

Problem:
Insufficient specificity and not scalable.

---

## 5.3 Product Variant

Purpose

Defines an approved variation of a product master.

### Required Attributes

product_variant_id  
variant_code  
product_master_id  
variant_name  
variant_reason  
override_material_code  
override_power_kw  
override_region  
status  

### Validation Rules

- variant must reference one product master
- overrides must be null unless intentionally differing from master
- variant_code format: `PV-[A-Z0-9-]+`

---

## 5.4 Standard BOM

Purpose

Defines controlled product composition.

### Required Attributes

standard_bom_id  
bom_code  
product_master_id  
revision_code  
status  
effective_from  

### Optional Attributes

effective_to  
notes  

### BOM Line Attributes

bom_line_id  
standard_bom_id  
line_number  
component_type  
component_reference_code  
quantity  
unit  
is_optional  
remarks  

### Validation Rules

- line_number unique within BOM
- quantity > 0 unless optional logical placeholder
- component_reference_code must reference valid product, standard component, or approved vendor option

---

## 5.5 Approved Vendor Option

Purpose

Defines approved commercial/vendor configuration for a product or component.

### Required Attributes

vendor_option_id  
vendor_option_code  
product_master_id  
vendor_id  
manufacturer_id  
vendor_item_code  
approved_status  
lead_time_days  
region_scope  
status  

### Validation Rules

- vendor_id must reference Vendor
- lead_time_days >= 0
- approved_status controlled: Pending, Approved, Restricted, Deprecated

---

# 6. Knowledge Domain Expansion

## 6.1 Material

Purpose

Defines reusable material properties.

### Required Attributes

material_id  
material_code  
material_name  
material_class  
density_kgm3  
temperature_limit_c  
chemical_resistance_class  
status  

### Optional Attributes

supplier_reference  
standard_reference  
notes  

### Validation Rules

- material_code format: `MAT-[A-Z0-9-]+`
- density_kgm3 > 0

---

## 6.2 Specification

Purpose

Defines engineering standard or internal specification.

### Required Attributes

specification_id  
specification_code  
specification_name  
specification_type  
issuing_authority  
revision_code  
status  

### Optional Attributes

effective_from  
effective_to  
linked_document_id  

### Validation Rules

- specification_code format: `SPC-[A-Z0-9-]+`
- effective_to cannot be earlier than effective_from

---

## 6.3 Design Rule

Purpose

Defines reusable engineering rules.

### Required Attributes

design_rule_id  
design_rule_code  
design_rule_name  
rule_domain  
rule_expression_type  
rule_source  
status  

### Optional Attributes

rule_expression  
notes  

### Validation Rules

- rule_domain controlled: Tank, LSS, Equipment, Document, Workflow, Naming, Other

---

## 6.4 Calculation Template

Purpose

Defines reusable engineering calculation framework.

### Required Attributes

calculation_template_id  
template_code  
template_name  
discipline  
input_schema_reference  
output_schema_reference  
status  

### Validation Rules

- template_code format: `CTM-[A-Z0-9-]+`

---

# 7. Document and Governance Expansion

## 7.1 Document

Purpose

Controlled document record independent of raw file storage.

### Required Attributes

document_id  
document_code  
document_type  
document_title  
discipline  
owner_role  
current_revision_id  
lifecycle_state  
status  

### Optional Attributes

origin_system  
linked_file_count  
confidentiality_level  

### Validation Rules

- document_code format: `DOC-[A-Z0-9-]+`
- current_revision_id required after first formal issue
- document_type controlled by Document Type dictionary

---

## 7.2 Drawing

Purpose

Specialized document representing drawings or sheets.

### Required Attributes

drawing_id  
drawing_code  
document_id  
sheet_number  
sheet_title  
drawing_discipline  
current_revision_id  
status  

### Validation Rules

- drawing must reference a Document
- drawing_code format: `DRW-[A-Z0-9-]+`

---

## 7.3 Revision

Purpose

Formal issued state of a controlled entity or document.

### Required Attributes

revision_id  
revision_code  
entity_type  
entity_id  
revision_status  
issued_for  
issued_date  
issued_by  
approved_by  

### Optional Attributes

supersedes_revision_id  
change_summary  

### Validation Rules

- revision_code format recommended: `REV-[A-Z0-9]+`
- approved_by required for issued states beyond draft
- supersedes_revision_id cannot reference self

---

## 7.4 Approval

Purpose

Captures formal approval actions.

### Required Attributes

approval_id  
approval_code  
workflow_instance_id  
entity_type  
entity_id  
approver_user_id  
approval_role  
approval_state  
decision_timestamp  

### Optional Attributes

comment  

### Validation Rules

- approval_state controlled: Pending, Approved, Rejected, Delegated
- decision_timestamp required when not Pending

---

# 8. Bridge Entity Expansion

## 8.1 Product Usage

Purpose

Connects project equipment/system records to reusable product definitions.

### Required Attributes

product_usage_id  
project_id  
product_master_id  
equipment_instance_id  
usage_status  
selection_basis  
status  

### Optional Attributes

product_variant_id  
approved_vendor_option_id  
configuration_id  

### Validation Rules

- must reference one project and one product master
- equipment_instance_id required when usage tied to explicit equipment record

### Good Example

product_usage_id: PU-0001  
project_id: PRJ-TY-001  
product_master_id: PM-FF-1500

### Bad Example

product_usage created with no product_master_id

Problem:
Bridge no longer bridges anything.

---

## 8.2 Product Configuration

Purpose

Stores project-specific controlled parameter overrides.

### Required Attributes

product_configuration_id  
product_usage_id  
configuration_code  
override_field  
override_value  
justification  
approval_state  

### Validation Rules

- override_field must be from controlled whitelist
- approval_state required
- configuration_code format: `PCF-[A-Z0-9-]+`

---

## 8.3 Product Derivative

Purpose

Defines project-derived product requiring controlled divergence from the standard master.

### Required Attributes

product_derivative_id  
derivative_code  
parent_product_master_id  
origin_project_id  
derivative_reason  
reuse_candidate_flag  
status  

### Validation Rules

- parent product required
- origin project required
- derivative_code format: `PDR-[A-Z0-9-]+`

---

# 9. Relationship Property Model

Not all relationships are just simple links. Some must carry properties.

## 9.1 Example Relationship with Properties

Relationship:
System Instance `contains` Equipment Instance

Required relationship properties:

sequence_number  
duty_role  
is_primary  
is_redundant  
effective_from  
effective_to  

## 9.2 Product Usage Relationship Properties

selection_reason  
configuration_required  
procurement_strategy  
installation_scope  

## 9.3 Compliance Relationship Properties

When Product Master `complies_with` Specification:

compliance_status  
verified_by  
verified_date  
evidence_document_id  

### Validation Rules

- relationship properties must be typed
- effective_to cannot be earlier than effective_from
- evidence document must reference controlled Document if used

---

# 10. Naming Structure Expansion

## 10.1 Project Codes

Pattern:
`PRJ-<SITE>-<SEQ>`

Examples:
PRJ-TY-001  
PRJ-BP-002

## 10.2 Area Codes

Pattern:
`ARE-<AREA>-<SEQ>`

Example:
ARE-SHARK-01

## 10.3 Exhibit Codes

Pattern:
`EXH-<EXHIBIT>-<SEQ>`

Example:
EXH-SHARK-01

## 10.4 Tank Codes

Pattern:
`TNK-<EXHIBIT>-<SEQ>`

Example:
TNK-SHARK-01

## 10.5 System Codes

Pattern:
`SYS-<DISCIPLINE>-<AREA>-<SEQ>`

Example:
SYS-LSS-SHARK-01

## 10.6 Equipment Instance Codes

Pattern:
`EQI-<PROJECT>-<AREA>-<TYPE>-<SEQ>`

Example:
EQI-TY-SHARK-FF-01

## 10.7 Product Master Codes

Pattern:
`PM-<TYPE>-<CAPACITY OR SIZE>`

Example:
PM-FF-1500  
PM-SF-900

## 10.8 Document Codes

Pattern:
`DOC-<DOC TYPE>-<AREA OR SYSTEM>-<SEQ>`

Example:
DOC-PID-SHARK-01

## 10.9 Drawing Codes

Pattern:
`DRW-<DISCIPLINE>-<SEQ>`

Example:
DRW-LSS-001

### Rules

- spaces not allowed
- uppercase only in generated codes
- hyphen separator only
- codes must be deterministic where possible

---

# 11. Validation Rule Dictionary

## Example Rule Types

required  
unique_within_scope  
format_pattern  
range_check  
foreign_key_exists  
controlled_vocabulary  
cross_field_consistency  

## Example

Rule Name: operating_volume_not_greater_than_gross  
Entity: Tank Instance  
Type: cross_field_consistency  
Expression: operating_volume_m3 <= gross_volume_m3

## Example

Rule Name: product_master_requires_family  
Entity: Product Master  
Type: foreign_key_exists  
Expression: product_family_id must exist

---

# 12. Cross-Domain Linking Rules

## Project to Product

Allowed only through:
• Product Usage
• Product Configuration
• Product Derivative

Direct free-text product references are not allowed for controlled records.

## Product to Knowledge

Allowed through:
• Material references
• Specification compliance
• Design Rule applicability
• Calculation Template applicability

## Project to Knowledge

Allowed through:
• System compliance
• Tank compliance
• Document references
• Inspection/Test applicability

### Good Example

Equipment Instance → Product Usage → Product Master → Material → Specification

### Bad Example

Equipment Instance contains text field `material_standard = maybe FRP`

Problem:
No controlled relationship, no traceability, no reusable knowledge.

---

# 13. Prompt — Define Entity Attribute Dictionary

Context

High-level entity names are not sufficient for implementation.

Identity

You are a **Master Data Architect for engineering platforms**.

Mission

Define the full attribute dictionary for a target entity.

Deliverables

Provide:

required attributes  
optional attributes  
data types  
validation rules  
naming rules  
good example  
bad example  

Boundaries

Do not invent vague fields such as “details” or “info”.

### Good Example

Product Master includes product_code, product_family_id, design_flow_m3h, primary_material_code, standard_status.

### Bad Example

Product Master fields: name, notes, details.

Problem:
Not specific enough for engineering control.

---

# 14. Prompt — Define Relationship Property Dictionary

Context

Some engineering relationships require property payloads.

Identity

You are a **Knowledge Graph Data Architect**.

Mission

Define relationship-level properties where engineering meaning requires them.

Deliverables

Provide:

relationship type  
required properties  
optional properties  
validation rules  
example path  

Boundaries

Do not store relationship meaning in unstructured notes fields.

### Good Example

System contains Equipment with properties is_primary and duty_role.

### Bad Example

System linked_to Equipment with no properties.

Problem:
Cannot distinguish duty, redundancy, or time-bounded use.

---

# 15. Prompt — Define Naming and Validation Rules

Context

The platform must enforce consistent engineering identifiers.

Identity

You are a **Data Governance Architect**.

Mission

Define naming patterns and validation rules for entity classes.

Deliverables

Provide:

code pattern  
prefix  
scope uniqueness  
forbidden characters  
controlled vocabularies  
cross-field checks  

Boundaries

Do not allow user-generated free-form identifiers for controlled entities.

### Good Example

EQI-TY-SHARK-FF-01

### Bad Example

pump 1 final maybe

Problem:
Not searchable or governable.

---

# 16. Prompt — Define Cross-Domain Linking

Context

Products, projects, and knowledge entities must remain separate but connected.

Identity

You are a **Systems Ontology Architect**.

Mission

Define the allowed cross-domain linking mechanisms.

Deliverables

Provide:

allowed links  
forbidden direct links  
bridge requirements  
example traversal paths  

Boundaries

Do not collapse product and project entities into one record type.

### Good Example

Project equipment references product via Product Usage.

### Bad Example

Project equipment record duplicates all product attributes.

Problem:
Standardization and reuse collapse.

---

# 17. Recommended Next Clarification Cycle

After this document, the next review cycle should make the specifications more exact in these areas:

1. entity-by-entity JSON schema contracts  
2. API request/response payload dictionaries  
3. graph node and edge property schemas  
4. UI screen-by-screen field layouts  
5. workflow state-by-state approval matrices  
6. integration mapping tables per connector  
7. naming rule collision and renumbering handling  
8. role-permission matrix by action and domain  

---

# 18. Final Principle

A strong engineering platform depends on exact data definitions.

Every entity must be identifiable.
Every relationship must be meaningful.
Every validation rule must be explicit.
Projects, products, and knowledge must stay separate unless linked through controlled structures.
