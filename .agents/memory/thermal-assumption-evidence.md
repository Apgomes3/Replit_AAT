---
name: Thermal assumption evidence
description: Governance rule for temperature-range derivation and tank-construction U-value assumptions.
---

Thermal calculations must derive water temperature from the arithmetic midpoint of a complete, valid, consistent linked-exhibit range. Reviewed overrides may change the applied temperature, but must retain the source minimum, maximum, and midpoint. Standard tank-construction U-values are versioned assumptions; custom U-values and explicit wall layers remain reviewed alternatives.

**Why:** A single mutable temperature or unexplained wall coefficient can make saved thermal evidence impossible to audit. Source evidence and the exact applied assumption must remain frozen through review, approval, release, and version restore.

**How to apply:** Block missing, reversed, incomplete, or conflicting linked ranges. Persist temperature and wall-construction basis objects in both input and result snapshots, and bump the thermal calculation version whenever the governed basis changes.