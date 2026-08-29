---
name: Compact-unit PIM snapshots
description: Copy-on-select and override rules for Product Master-backed LSS compact units.
---

Product Master specifications are starting values for an independent compact-unit catalog record, not a continuously synchronized source. New units may fill empty compatible fields automatically; saved units and manual values require an explicit reapply action before compatible source values can replace them. Missing source values never clear compact-unit values.

**Why:** LSS compact units can contain reviewed application-specific overrides and fields with no compatible PIM meaning. Silent refreshes would erase those decisions or invent unsupported engineering values.

**How to apply:** Copy only directly compatible identity, flow, electrical, dimension, weight, and connection values. Keep water type, tank-volume limits, filtration contents, UV power, and break-tank volume independent unless a future schema explicitly defines compatible sources.