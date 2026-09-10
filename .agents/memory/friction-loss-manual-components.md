---
name: Friction Loss manual components
description: Defines the ownership boundary for pipe and fitting inputs used in Friction Loss.
---

Friction Loss pipe and fitting rows are direct calculation inputs. Do not require users to create, select, or assign Project Management piping records or establish an LSS relationship.

**Why:** The current workflow intentionally supports hydraulic calculations before a governed project piping relationship exists.

**How to apply:** Keep pipe diameter, length, material, roughness, fitting K-value, and quantity editable and persist them as calculation evidence. Any future project piping linkage must remain optional unless the product rule is explicitly changed.