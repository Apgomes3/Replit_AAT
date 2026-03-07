
# Engineering Data Platform
# Design System and UI Tokens Specification

Version: 0.1
Depends on:
00_engineering_data_platform_kickstart.md
01_system_architecture_blueprint.md
02_entity_and_relationship_specification.md
03_workflow_lifecycle_specification.md

Purpose: Define the visual system, UI tokens, layout rules, typography, and interaction patterns for the Engineering Data Platform.

---

# 1. Context

The Engineering Data Platform is a **technical engineering application**, not a marketing website.

The UI must prioritize:

• clarity
• information density
• traceability
• structural relationships
• engineering usability

The visual design must feel:

• technical
• neutral
• stable
• professional

Avoid visual noise.

---

# 2. Design Principles

1. **Engineering First**
UI must prioritize structured engineering data.

2. **Relationship Visibility**
Relationships between entities must always be visible.

3. **Metadata Clarity**
Entity metadata must be readable and structured.

4. **Status Awareness**
Lifecycle states and approvals must be visually clear.

5. **Consistency**
All entity pages follow the same structural layout.

---

# 3. Color System

Use restrained professional colors.

## Primary Colors

Dark Navy  
#1F2A44

Steel Blue  
#3E5C76

Slate Gray  
#748CAB

---

## Neutral Colors

White  
#FFFFFF

Off White  
#F8FAFC

Light Gray  
#E2E8F0

Mid Gray  
#94A3B8

Charcoal  
#334155

---

## Status Colors

Success Green  
#2E7D32

Warning Amber  
#ED6C02

Error Red  
#C62828

Info Blue  
#0288D1

---

## Color Usage Rules

Primary colors used for:

navigation
headers
active selections

Neutral colors used for:

backgrounds
tables
cards

Status colors used only for:

workflow state
errors
warnings
approvals

Never use bright decorative colors.

---

# 4. Typography

## Primary Font

Inter

---

## Secondary Font

Roboto

---

## Monospace Font

JetBrains Mono

Used for:

IDs
codes
technical identifiers

---

## Typography Scale

Page Title  
28px Semibold

Section Title  
20px Semibold

Subsection Title  
16px Medium

Body Text  
14px Regular

Metadata Labels  
12px Medium

Entity Codes  
13px Monospace

---

# 5. Layout System

Use a **3-zone entity layout**.

Left Panel  
Entity hierarchy navigation

Center Panel  
Entity details

Right Panel  
Relationships and activity

---

## Entity Page Layout

Top Bar

Entity code
entity name
lifecycle status
revision status

---

Metadata Block

Attributes table

---

Relationship Block

Parent entities
child entities
linked entities

---

Documents Block

Linked drawings
linked files
linked specifications

---

Activity Block

workflow history
approvals
changes

---

# 6. Table Design

Tables are primary data structures.

Columns must support:

sorting
filtering
search

---

Required columns for entity tables

Code
Name
Type
Status
Revision
Owner
Last Modified

---

## Table Row Behavior

Single click

Select

Double click

Open entity

---

# 7. Graph Visualization

Graph views show relationships.

Graph nodes

Project
Product
System
Equipment
Document
Specification

---

Graph edges

contains
served_by
references
derived_from
uses
approved_by

---

## Graph Display Rules

Nodes color-coded by domain.

Project Domain

Blue

Product Domain

Green

Knowledge Domain

Gray

---

Graph interactions

Zoom
Node focus
Path highlight

---

# 8. Entity Detail Page Template

Every entity page must contain:

Header

Entity Code  
Entity Name  
Lifecycle State

---

Metadata Panel

Attributes

---

Relationships Panel

Parent Entities  
Child Entities  
Cross Domain Links

---

Documents Panel

Drawings
Files
Specifications

---

History Panel

Revision history
Workflow history
Change requests

---

# 9. Status Indicators

Lifecycle states must have clear visual markers.

Draft

Gray

Review

Amber

Approved

Blue

Released

Green

Superseded

Dark Gray

Obsolete

Red

---

# 10. Prompt — Define UI Layout

Context

Engineering users must see structural information clearly.

Identity

You are a **UX Architect for complex engineering platforms**.

Mission

Define layout rules for entity pages.

Deliverables

Provide:

layout zones

navigation structure

entity page structure

Boundaries

Avoid visual clutter.

Prioritize structured information.

---

Good Example

Entity page shows

metadata
relationships
documents
workflow

---

Bad Example

Entity page hides relationships in secondary tabs.

Problem

Users cannot understand system context quickly.

---

# 11. Prompt — Define Table Structures

Context

Tables are primary navigation tools.

Identity

You are a **UX Architect specializing in data-heavy applications**.

Mission

Define table standards.

Deliverables

Define:

required columns
sorting rules
filter rules

---

Good Example

Equipment table

Code
Product
System
Status
Revision

---

Bad Example

Table shows only name.

Problem

Engineering identification impossible.

---

# 12. Prompt — Define Graph Visualization

Context

Relationships must be visualized clearly.

Identity

You are a **Graph Visualization Architect**.

Mission

Define graph display rules.

Deliverables

Define:

node types
edge types
interaction rules

---

Good Example

Equipment node connected to

system
product
documents

---

Bad Example

Graph with unlabeled nodes.

Problem

Relationships unclear.

---

# 13. Icon System

Icons must be minimal.

Recommended library

Lucide Icons

---

Examples

Project

folder-tree

Product

box

System

network

Equipment

cpu

Document

file-text

Specification

clipboard-check

---

# 14. Spacing System

Use consistent spacing tokens.

4px base grid

Spacing tokens

4px
8px
12px
16px
24px
32px

---

# 15. Component Rules

Reusable components

Entity Card

Metadata Table

Relationship Panel

Document List

Workflow Timeline

Graph Viewer

---

# 16. Next Specification Packs

05_api_contract_specification.md

06_graph_query_specification.md

07_integration_architecture.md

---

# Final Principle

The UI must expose engineering structure clearly.

Relationships must be visible.

Entity states must be obvious.

Data must remain structured and readable.
