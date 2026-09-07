---
name: Tank design-sheet basis
description: Governing rules for supplier-facing exhibit tank design-sheet calculations and unresolved inputs.
---

Tank design sheets must resolve liquid density from the active governed water-type record and accept ambient temperature only from a fresh, Ready Thermal calculation. Never infer either value.

**Why:** Supplier-facing pressure calculations need traceable physical-property evidence, while stale Thermal evidence can silently misstate the design environment. Missing Thermal ambient is permitted only when clearly shown as “No value”/TBC.

**How to apply:** Calculate pressure from effective maximum water level using density × gravity × depth × 1.2. Block generation when pressure-critical inputs are unresolved; retain ambient and structural/nozzle/support loads as explicit TBCs where allowed.