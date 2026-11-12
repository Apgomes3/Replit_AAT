
# Engineering Data Platform
# Graph Query Specification

Version: 0.1
Depends on:
00_engineering_data_platform_kickstart.md
01_system_architecture_blueprint.md
02_entity_and_relationship_specification.md
03_workflow_lifecycle_specification.md
04_design_system_and_ui_tokens.md
05_api_contract_specification.md

Purpose: Define the engineering knowledge graph model, node and edge types, traversal rules, and query patterns.

---

# 1. Context

The Engineering Data Platform uses a **knowledge graph layer** to represent relationships between engineering entities.

The graph enables:

• product reuse discovery
• impact analysis
• dependency tracing
• engineering navigation
• cross-domain intelligence

Traditional document systems cannot represent these relationships effectively.

---

# 2. Graph Model Principles

1. Every entity is a **node**
2. Relationships are **edges**
3. Edges must have explicit meaning
4. Nodes must have stable identifiers
5. Traversal must be deterministic
6. Graph queries must support engineering workflows

---

# 3. Node Types

## Project Domain Nodes

Project
Area
Exhibit
Tank
System Instance
Subsystem Instance
Equipment Instance

---

## Product Library Nodes

Product Family
Product Master
Product Variant
Standard BOM
Standard Component
Vendor Option

---

## Knowledge Domain Nodes

Material
Specification
Design Rule
Calculation Template
Test Standard
Inspection Method
SOP

---

## Document Nodes

Document
Drawing
Specification File
Calculation File
Revision
Release Package

---

# 4. Edge Types

Edges must describe engineering meaning.

Examples:

contains
served_by
references
uses
derived_from
configured_from
approved_by
complies_with
supersedes
attached_to

---

# 5. Example Graph

Project → Exhibit → System → Equipment → Product Master

Example

PRJ-TY-001
   contains
EXH-SHARK-01
   served_by
SYS-LSS-SHARK-01
   contains
EQ-FF-1500-01
   references
PM-FF-1500

---

# 6. Edge Cardinality

Relationships must define cardinality.

Example

Project → Area
1 → many

Area → Exhibit
1 → many

System → Equipment
1 → many

Equipment → Product Master
many → 1

---

# 7. Traversal Patterns

Graph traversal must support common engineering questions.

Example patterns:

Project → Equipment
Product → Projects
System → Documents
Material → Products
Specification → Systems

---

# 8. Impact Analysis Queries

Example

If Product Master changes:

Which projects are affected?

Traversal

Product Master
→ Equipment Instances
→ Systems
→ Projects

---

Example

If Material specification changes:

Traversal

Material
→ Product Masters
→ Equipment Instances
→ Projects

---

# 9. Product Reuse Discovery

Graph queries can reveal product reuse.

Example

Find all projects using product FF-1500.

Traversal

Product Master
→ Equipment Instances
→ Systems
→ Projects

---

# 10. Dependency Tracing

Trace dependencies of a system.

Example

System SYS-LSS-SHARK-01

Traversal

System
→ Equipment
→ Product Master
→ Materials
→ Specifications

---

# 11. Graph Query Endpoint Model

Endpoint

POST /api/v1/graph/query

---

Example Request

{
  "start_node": "PM-FF-1500",
  "edge_type": "used_in_projects",
  "depth": 3
}

---

Example Response

{
  "nodes": [
    {"type": "Project", "code": "PRJ-TY-001"},
    {"type": "Project", "code": "PRJ-BP-002"}
  ]
}

---

# 12. Graph Optimization Rules

To maintain performance:

• limit traversal depth
• cache common queries
• index node relationships
• precompute frequently used paths

---

# 13. Prompt — Define Graph Schema

Context

Engineering relationships must be represented as graph structures.

Identity

You are a **Knowledge Graph Architect**.

Mission

Define node types and edge types.

Deliverables

Provide

node types
edge types
cardinality rules
relationship semantics

---

Good Example

Equipment → references → Product Master

---

Bad Example

Equipment → related_to → Product

Problem

Relationship meaning unclear.

---

# 14. Prompt — Define Graph Queries

Context

Graph queries enable engineering intelligence.

Identity

You are a **Graph Query Engineer**.

Mission

Define common traversal queries.

Deliverables

Provide

impact analysis queries
reuse discovery queries
dependency queries

---

Good Example

Find all projects affected by product change.

---

Bad Example

Manual lookup across tables.

Problem

Relationships not leveraged.

---

# 15. Prompt — Define Impact Analysis

Context

Engineering changes must reveal affected entities.

Identity

You are a **Systems Impact Analyst**.

Mission

Define graph queries for impact analysis.

Deliverables

Provide

change propagation paths
affected entity detection
risk indicators

---

Good Example

Material change reveals impacted products.

---

Bad Example

Change implemented without visibility.

Problem

Engineering risk.

---

# 16. Visualization Requirements

Graph UI must support:

node focus
path highlight
relationship labels
domain color coding

---

Node Colors

Project Domain

Blue

Product Domain

Green

Knowledge Domain

Gray

Documents

Orange

---

# 17. Query Safety Rules

Prevent runaway queries.

Rules

max depth: 5

max nodes returned: 500

timeout: 2 seconds

---

# 18. Future Graph Capabilities

Future extensions may include:

engineering recommendation engine
product similarity detection
automatic dependency alerts
AI-assisted system design

---

# 19. Next Specification Packs

07_integration_architecture.md

08_repository_and_deployment_architecture.md

---

# Final Principle

The knowledge graph turns the platform from a document repository into an engineering intelligence system.
