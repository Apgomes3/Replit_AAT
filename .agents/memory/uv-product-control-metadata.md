---
name: UV control metadata
description: Ownership and review rules for UV installation configuration and control-interface attributes.
---

UV installation configuration and control-interface metadata belong to the Product Master. Configuration uses the governed choices Wall mounted, Stand, or No stand; Control Type, Signal Type, and whether the control arrangement is Optional are also PIM-owned. UV Engineering displays these values read-only.

**Why:** Product identity and supplied-equipment attributes must stay authoritative in PIM instead of drifting between engineering revisions.

**How to apply:** Edit these attributes through the UV Product Master. Any change must refresh the UV catalogue snapshot and require review before the updated catalogue identity is treated as current.