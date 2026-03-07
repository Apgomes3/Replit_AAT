
# Engineering Data Platform
# Entity and Relationship Specification Pack

Version: 0.1
Depends on:
00_engineering_data_platform_kickstart.md
01_system_architecture_blueprint.md

Purpose: Define entities, attributes, relationships, and naming rules in detail.

---

# 1. Context

The Engineering Data Platform manages structured engineering knowledge.

Three domains exist:

Project Domain  
Product Library Domain  
Knowledge Domain  

Bridge entities connect projects and products.

This file defines:

• entity definitions  
• attribute structures  
• relationship definitions  
• naming standards  
• prompts for generating and validating models  

---

# 2. Entity Definition Structure

Each entity must define:

Name  
Domain  
Purpose  
Core Attributes  
Relationships  
Lifecycle  
Owner  

---

# 3. Project Domain Entities

## Entity: Project

Purpose  
Represents a delivery program or contract.

Core attributes

project_id  
project_code  
project_name  
client  
location  
status  
start_date  
end_date  

Relationships

Project → Area  
Project → Product Usage  
Project → Documents  

Lifecycle

Concept  
Active  
Completed  
Archived  

---

## Prompt — Define Project Entity

### Context

Projects represent engineering delivery contexts.
They organize systems, exhibits, equipment, and documents.

### Identity

You are a **Data Architect for engineering information systems**.

### Mission

Define the **Project entity specification**.

### Deliverables

Provide:

• attributes  
• lifecycle states  
• relationships  
• validation rules  

### Boundaries

Do not mix product attributes into project attributes.

Projects represent instances, not reusable definitions.

### Good Example

Project

project_code: PRJ-TY-001  
project_name: Taoyuan Aquarium  

Relationships

Project → Area  
Project → Product Usage  

### Bad Example

Project contains product definitions.

Problem:

Product definitions belong in Product Library.

---

# 4. Product Library Entities

## Entity: Product Master

Purpose

Represents the canonical reusable engineering product definition.

Core attributes

product_id  
product_code  
product_name  
product_family  
design_flow  
material  
power_rating  
standard_status  

Relationships

Product Master → Product Variant  
Product Master → Standard BOM  
Product Master → Vendor Option  

Lifecycle

Concept  
Development  
Approved  
Active  
Deprecated  
Obsolete  

---

## Prompt — Define Product Master

### Context

Products must exist independently from projects.
Projects only reference them.

### Identity

You are a **Product Data Architect for engineering platforms**.

### Mission

Define the **Product Master entity**.

### Deliverables

Provide:

• attributes  
• lifecycle  
• relationships  
• reuse rules  

### Good Example

Product Master

product_code: PM-FF-1500  
product_name: Foam Fractionator FF-1500  

### Bad Example

Product defined only inside a project.

Problem

Product reuse cannot be tracked.

---

# 5. Knowledge Domain Entities

## Entity: Material

Purpose

Defines materials used by products and projects.

Core attributes

material_code  
material_name  
density  
chemical_resistance  
temperature_limit  

Relationships

Material → Specification  
Material → Product Master  

Lifecycle

Active  
Deprecated  
Obsolete  

---

## Prompt — Define Knowledge Entities

### Context

Knowledge entities represent engineering rules and standards.

### Identity

You are an **Engineering Knowledge Architect**.

### Mission

Define entities that store reusable engineering knowledge.

### Deliverables

Define:

Material  
Specification  
Design Rule  
Calculation Template  

### Good Example

Material

MAT-FRP-VE  
Vinyl Ester FRP  

### Bad Example

Material attributes stored inside product record.

Problem

Material definitions become duplicated.

---

# 6. Bridge Entities

## Entity: Product Usage

Purpose

Records that a project uses a product.

Attributes

usage_id  
project_id  
product_id  
equipment_instance  

Relationships

Project → Product Usage  
Product Usage → Product Master  

---

## Prompt — Define Bridge Entities

### Context

Bridge entities allow products to remain reusable.

### Identity

You are a **Systems Architect specializing in product reuse**.

### Mission

Define entities connecting projects and products.

### Deliverables

Define:

Product Usage  
Product Configuration  
Product Derivative  

### Good Example

Project: Taoyuan Aquarium  
uses Product: FF-1500  

### Bad Example

Project directly embeds product attributes.

Problem

Product library becomes meaningless.

---

# 7. Relationship Dictionary

Relationships must describe engineering meaning.

Examples

Project → Area  
Area → Exhibit  
Exhibit → System  
System → Equipment  
Equipment → Product Master  

---

## Prompt — Relationship Design

### Context

Relationships define the engineering knowledge graph.

### Identity

You are a **Knowledge Graph Architect**.

### Mission

Define relationships between entities.

### Deliverables

Provide:

relationship_name  
source_entity  
target_entity  
cardinality  
description  

### Good Example

served_by  
Exhibit → System Instance  

### Bad Example

linked_to  

Meaning unclear.

---

# 8. Naming and Numbering Rules

Naming must be consistent and deterministic.

Examples

PRJ-TY-001  
SYS-LSS-SHARK-01  
PM-FF-1500  
DOC-PID-001  

---

## Prompt — Naming Rules

### Context

Entity identifiers must be readable and structured.

### Identity

You are a **Data Governance Architect**.

### Mission

Define naming conventions.

### Deliverables

Define rules for:

Project codes  
Product codes  
Equipment codes  
Document codes  

### Good Example

SYS-LSS-SHARK-01  

Clear system identification.

### Bad Example

System1  

Ambiguous identifier.

---

# 9. Relationship Visibility

Every entity page must display relationships.

Required sections

Parent entities  
Child entities  
Linked documents  
Linked standards  
Change requests  

---

## Prompt — Relationship Visualization

### Context

Users must understand engineering relationships quickly.

### Identity

You are a **UX Architect for technical platforms**.

### Mission

Define relationship display patterns.

### Deliverables

Define:

graph view  
table view  
navigation links  

### Good Example

Equipment page shows

Product reference  
System parent  
Linked drawings  

### Bad Example

Equipment page shows only attributes.

Relationships hidden.

---

# 10. Next Specification Packs

Next stages will deepen the architecture.

Stage A  
Lifecycle and Workflow Specification  

Stage B  
Design System and UI Tokens  

Stage C  
API Contract Specification  

Stage D  
Integration Architecture  

Stage E  
Graph Query Specification  

---

# Final Principle

Engineering systems must be represented structurally.

Projects represent instances.  
Products represent reusable definitions.  
Knowledge represents rules.  
Bridge entities connect the domains.
