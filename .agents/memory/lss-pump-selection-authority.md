---
name: LSS pump selection authority
description: Rules for circuit-level LSS pump sizing, evidence, and Design Book release readiness.
---

The Design Book’s calculated system flow is the sole authority for circuit-level pump sizing and lifecycle evidence.

**Why:** Using stored system flow for saves while showing calculated linked-exhibit flow can create contradictory engineering evidence. Formula changes or Flow Route changes can also invalidate an otherwise complete-looking selection.

**How to apply:** Keep display, sizing, freshness, and snapshots on that same flow basis. Treat changed assumptions or formulas as stale, and block release until active circuits have fresh ready selections.

The Design Book owns the project pump tag and the design values entered or calculated during sizing. A selected PIM Product Master is linked as the pump model, but it does not replace the Design Book’s tag or overwrite its engineering evidence.

**Why:** A catalog model identifies what pump is being used, while the Design Book records the project-specific duty point and assignment. Mixing those ownership boundaries would make catalog maintenance change historical project evidence unexpectedly.

**How to apply:** Create the project pump tag first, validate sizing against the authoritative Flow Route basis, then allow a separate model-link action. Preserve the tag, design values, and selected-model snapshot in review/released Design Book packages.