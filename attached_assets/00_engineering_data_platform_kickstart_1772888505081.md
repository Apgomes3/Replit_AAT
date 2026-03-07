
# Engineering Data Platform — Kickstart Specification

Version: 0.1
Purpose: Foundational ontology and conceptual model for the Engineering Data Platform

---

# 1. Context

This platform is designed to manage engineering information across the lifecycle of complex systems such as:

- aquariums
- life support systems
- tanks
- piping systems
- mechanical equipment
- controls
- fabrication

Traditional systems organize data primarily around **projects or file storage**.

This platform instead organizes engineering information as a **knowledge graph**, where entities and their relationships represent the real structure of engineering systems.

The platform supports three independent but connected domains:

1. Project Domain
2. Product Library Domain
3. Knowledge / Reference Domain

These domains interact through **bridge entities**.

---

# 2. System Philosophy

The platform is designed with the following principles:

1. Engineering systems must be represented structurally.
2. Products must exist independently from projects.
3. Projects must instantiate or configure products rather than redefine them.
4. Knowledge such as materials and specifications must remain centralized.
5. Relationships must support graph traversal and impact analysis.

---

# 3. Core Domains

Engineering Data Platform
│
├── Project Domain
├── Product Library Domain
└── Knowledge / Reference Domain

Each domain is independent but connected through graph relationships.

---

# 4. Project Domain

## Purpose

Represents **project delivery and execution**.

Project entities represent **instances of engineering systems deployed in real projects**.

Projects must reference products from the product library whenever possible.

---

## Core Entities

Project  
Project Phase  
Area / Zone  
Exhibit  
Tank Instance  
System Instance  
Subsystem Instance  
Equipment Instance  
Installation Package  
Release Package  
Project Document  
Project Drawing  
Commissioning Record  
Issue / NCR / RFI / TQ  

---

## Example

Project: Taoyuan Aquarium  

Area: Shark Exhibit  

System Instance: LSS-SHARK-01  

Equipment Instance: Foam Fractionator FF-1500

---

# 5. Product Library Domain

## Purpose

Defines reusable engineering products independent of projects.

Products represent standard engineering definitions.

Projects should reference these definitions rather than creating new ones.

---

## Core Entities

Product Family  
Product Master  
Product Variant  
Standard Assembly  
Standard Component  
Standard BOM  
Standard Drawing  
Standard Datasheet  
Standard Calculation  
Product Rule Set  
Approved Vendor Option  
Spare Part Definition  
Product Certification Record  

---

# 6. Knowledge / Reference Domain

## Purpose

Stores shared engineering knowledge used by products and projects.

This ensures engineering rules remain centralized.

---

## Core Entities

Material  
Specification  
Design Rule  
Calculation Template  
Test Standard  
Inspection Method  
SOP / Work Instruction  
Category  
Discipline  
Tag Class  
Asset Class  
Document Type  
Unit Definition  
Approval Role  

---

# 7. Bridge Entities

Bridge entities connect **products to project instances**.

These allow products to remain reusable while projects instantiate them.

## Product Usage
Records that a project uses a standard product.

## Product Configuration
Allows projects to modify product parameters without changing the base definition.

## Product Derivative
Represents a project-specific variation.

---

# 8. Relationship Principles

Relationships must represent engineering meaning.

Examples:

Project → Area  
Area → Exhibit  
Exhibit → Tank  
Exhibit → System Instance  

System Instance → Equipment Instance  

Equipment Instance → Product Master  

Product Master → Product Variant  

Document → Revision  

Revision → Approval  

---

# 9. Graph Navigation Model

The platform must support three main navigation avenues.

## Projects
Project → Area → Exhibit → Tank → System Instance → Equipment Instance

## Product Library
Product Family → Product Master → Product Variant → Standard BOM

## Knowledge Hub
Material → Specification → Design Rule → Calculation Template

---

# 10. Governance Principles

Products remain independent from projects.

Projects must reference products using bridge entities.

Knowledge must remain centralized.

Documents must follow revision control.

Relationships must support graph traversal.

---

# 11. Final Principle

The Engineering Data Platform must behave as a **knowledge graph of engineering systems**, not a document repository.

Projects represent instances.

Products represent reusable engineering definitions.

Knowledge entities represent engineering rules.

Bridge entities connect these domains.
