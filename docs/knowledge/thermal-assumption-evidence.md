---
name: Thermal assumption evidence
description: Governance rule for temperature-range derivation and tank wall resistance evidence.
---

Thermal calculations must derive water temperature from the arithmetic midpoint of a complete, valid, consistent linked-exhibit range. Reviewed overrides may change the applied temperature, but must retain the source minimum, maximum, and midpoint. Wall conductivity is governed per material, while thickness and layer order belong to each exhibit tank. For multilayer walls, sum every layer resistance `L/k`; never average conductivity. Add water-side and air-side film resistances only after summing the material layers. Calculate each linked tank separately and sum heat-transfer contributions rather than averaging U-values across tanks.

Ready sensitivity evidence contains exactly four one-factor temperature scenarios around the base: the shared water-range minimum and maximum, plus ambient air at −2 °C and +2 °C. Water scenarios retain base ambient and radiant-surroundings temperatures; ambient scenarios retain the base water and radiant-surroundings temperatures. Geometry, humidity, evaporation correlation, margins, and all other inputs remain fixed.

**Why:** A single mutable temperature or unexplained wall coefficient can make saved thermal evidence impossible to audit. Averaged conductivity or U-values are physically wrong for series layers and conceal differences between tank constructions. One-factor temperature cases make heating and cooling comparisons traceable without implying an unreviewed multi-variable design envelope.

**How to apply:** Block missing, reversed, incomplete, or conflicting linked ranges. Persist each sensitivity case’s effective water and ambient temperatures with its duties, and freeze those cases unchanged in saved and released evidence. Resolve each wall layer against the active governed material record, preserve historical snapshots, and persist per-layer resistance plus per-tank wall evidence. Bump the thermal calculation version whenever the governed basis changes.