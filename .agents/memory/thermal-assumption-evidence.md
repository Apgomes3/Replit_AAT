---
name: Thermal assumption evidence
description: Governance rule for temperature-range derivation and tank-construction U-value assumptions.
---

Thermal calculations must derive water temperature from the arithmetic midpoint of a complete, valid, consistent linked-exhibit range. Reviewed overrides may change the applied temperature, but must retain the source minimum, maximum, and midpoint. Standard tank constructions resolve from one approved, versioned wall-layer basis; calculations freeze both governed defaults and designer-effective layers. A reviewed custom U-value remains a separate alternative and never combines with layer resistance.

**Why:** A single mutable temperature or unexplained wall coefficient can make saved thermal evidence impossible to audit. Source evidence and the exact applied assumption must remain frozen through review, approval, release, and version restore.

**How to apply:** Block missing, reversed, incomplete, or conflicting linked ranges. Resolve new wall selections only from the active governed record, preserve historical snapshots, and persist temperature plus default/effective wall evidence in both input and result snapshots. Bump the thermal calculation version whenever the governed basis changes.