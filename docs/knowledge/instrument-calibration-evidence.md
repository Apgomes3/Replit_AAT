---
name: Instrument calibration evidence
description: Evidence ownership and immutability rules for LSS instrument ranges, calibration, and datasheet references.
---

Governed instrument-type values seed each new saved instrument instance. The saved effective range, unit, calibration requirements, procedure, interval, and datasheet reference are instance evidence; later catalogue changes must not rewrite them. Designer overrides are allowed only where the governed definition explicitly permits them.

**Why:** Detailed design and commissioning evidence must remain inspectable when catalogue defaults change or a referenced datasheet later becomes unavailable. Released Design Books require database-level immutability, not only read-only routes.

**How to apply:** Read draft work from saved instances, freeze those values in review/release/version packages, restore them from the frozen package, and guard all released LSS control and instrument rows against direct insert, update, or delete.