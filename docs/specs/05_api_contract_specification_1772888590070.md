
# Engineering Data Platform
# API Contract Specification

Version: 0.1
Depends on:
00_engineering_data_platform_kickstart.md
01_system_architecture_blueprint.md
02_entity_and_relationship_specification.md
03_workflow_lifecycle_specification.md
04_design_system_and_ui_tokens.md

Purpose: Define API contracts, schemas, endpoints, filtering rules, authentication, and graph traversal interfaces.

---

# 1. Context

The Engineering Data Platform is **API-first**.

All capabilities must be accessible through APIs to support:

• web UI
• automation
• AI agents
• integrations
• scripts
• reporting tools

APIs must expose **structured engineering entities**, not raw documents.

---

# 2. API Design Principles

1. Resource-based endpoints
2. Stable identifiers
3. Explicit entity types
4. Predictable filtering
5. Pagination by default
6. Versioned API contracts
7. No implicit behavior
8. Relationship navigation through endpoints

---

# 3. Base API Structure

Base URL

/api/v1

---

Example

/api/v1/projects

---

API versions must be explicit.

Example

/api/v1/projects

Future

/api/v2/projects

---

# 4. Core Resource Groups

Project Domain

/projects
/areas
/exhibits
/systems
/equipment-instances

---

Product Library

/product-families
/product-masters
/product-variants
/product-boms

---

Knowledge Domain

/materials
/specifications
/design-rules
/calculation-templates

---

Documents

/documents
/revisions
/approvals
/release-packages

---

Graph & Search

/graph/query
/search

---

Administration

/users
/roles
/permissions

---

# 5. Example Endpoint

GET /api/v1/projects

Response

{
  "items": [
    {
      "project_id": "proj_92a7",
      "project_code": "PRJ-TY-001",
      "project_name": "Taoyuan Aquarium",
      "status": "Active"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 25,
    "total": 1
  }
}

---

# 6. Entity Schema Example

## Project

Attributes

project_id (UUID)
project_code
project_name
client
location
status
start_date
end_date

---

Example Schema

{
  "project_id": "uuid",
  "project_code": "PRJ-TY-001",
  "project_name": "Taoyuan Aquarium",
  "client": "City Government",
  "location": "Taoyuan",
  "status": "Active"
}

---

# 7. Pagination Rules

All list endpoints must support:

page
page_size

Example

/api/v1/projects?page=1&page_size=50

---

Default page_size

25

Maximum page_size

200

---

# 8. Filtering

Endpoints must support filtering by attributes.

Example

/api/v1/projects?status=Active

---

Example

/api/v1/equipment-instances?system=SYS-LSS-01

---

Multiple filters allowed

/api/v1/equipment-instances?system=SYS-LSS-01&status=Active

---

# 9. Sorting

Sorting supported through parameter

sort

Example

/api/v1/projects?sort=project_name

Descending

/api/v1/projects?sort=-project_name

---

# 10. Relationship Endpoints

Relationships must be navigable through APIs.

Example

GET /api/v1/projects/{id}/systems

Returns all systems in project.

---

Example

GET /api/v1/product-masters/{id}/projects

Returns projects using that product.

---

# 11. Graph Query Endpoint

Graph traversal must be supported.

Endpoint

POST /api/v1/graph/query

---

Example request

{
  "start_entity": "PM-FF-1500",
  "relationship": "used_in_projects"
}

---

Example response

{
  "projects": [
    "PRJ-TY-001",
    "PRJ-BP-002"
  ]
}

---

# 12. Search Endpoint

Search across entities.

GET /api/v1/search?q=FF-1500

---

Response

{
  "results": [
    {
      "type": "product",
      "code": "PM-FF-1500"
    },
    {
      "type": "equipment",
      "code": "EQ-FF-1500-01"
    }
  ]
}

---

# 13. Authentication

Use token-based authentication.

Example

Authorization: Bearer <token>

---

Supported methods

OAuth2
API Keys
JWT

---

# 14. Error Handling

Standard error format

{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Missing required field project_code"
  }
}

---

Common error codes

INVALID_REQUEST
NOT_FOUND
UNAUTHORIZED
FORBIDDEN
CONFLICT
SERVER_ERROR

---

# 15. Prompt — Define API Endpoints

Context

Engineering data must be accessible through stable APIs.

Identity

You are an **API Architect for engineering platforms**.

Mission

Define resource endpoints for the platform.

Deliverables

Provide

endpoint structure
entity schemas
filtering rules

---

Good Example

GET /projects/{id}/systems

Clear relationship endpoint.

---

Bad Example

GET /getSystemsForProject

Problem

Non-standard naming.

---

# 16. Prompt — Define Schema Models

Context

Entity schemas must be predictable and explicit.

Identity

You are a **Backend Data Architect**.

Mission

Define JSON schemas for platform entities.

Deliverables

Provide

attribute types
validation rules
required fields

---

Good Example

project_code required.

---

Bad Example

Optional code fields.

Problem

Entities become ambiguous.

---

# 17. Prompt — Define Graph Query Interface

Context

Engineering knowledge graphs require traversal APIs.

Identity

You are a **Knowledge Graph API Architect**.

Mission

Define graph query endpoints.

Deliverables

Define

graph traversal structure
relationship queries
response models

---

Good Example

Find products used in project.

---

Bad Example

Manual filtering required client-side.

Problem

Graph capabilities lost.

---

# 18. Versioning Strategy

APIs must be versioned.

Example

/api/v1/projects

Breaking changes require new version.

---

# 19. Rate Limiting

Protect system performance.

Example

100 requests per minute per user.

---

# 20. Next Specification Packs

06_graph_query_specification.md

07_integration_architecture.md

---

# Final Principle

The API layer exposes structured engineering knowledge.

Entities, relationships, workflows, and documents must all be accessible through stable contracts.
