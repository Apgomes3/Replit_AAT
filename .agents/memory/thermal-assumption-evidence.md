---
name: Thermal assumption evidence
description: Governance rule for temperature-range derivation and tank wall resistance evidence.
---

Thermal calculations must derive water temperature from the arithmetic midpoint of a complete, valid, consistent linked-exhibit range. Reviewed overrides may change the applied temperature, but must retain the source minimum, maximum, and midpoint. Wall conductivity is governed per material, while thickness and layer order belong to each exhibit tank. For multilayer walls, sum every layer resistance `L/k`; never average conductivity. Add water-side and air-side film resistances only after summing the material layers. Calculate each linked tank separately and sum heat-transfer contributions rather than averaging U-values across tanks.

**Why:** A single mutable temperature or unexplained wall coefficient can make saved thermal evidence impossible to audit. Averaged conductivity or U-values are physically wrong for series layers and conceal differences between tank constructions.

**How to apply:** Block missing, reversed, incomplete, or conflicting linked ranges. Resolve each wall layer against the active governed material record, preserve historical snapshots, and persist per-layer resistance plus per-tank wall evidence. Bump the thermal calculation version whenever the governed basis changes.