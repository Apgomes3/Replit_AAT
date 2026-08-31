---
name: Compact-unit PIM snapshots
description: Copy-on-select and override rules for Product Master-backed LSS compact units.
---

Product Master specifications are starting values for an independent compact-unit catalog record, not a continuously synchronized source. New units may fill empty compatible fields automatically; saved units and manual values require an explicit reapply action before compatible source values can replace them. Missing source values never clear compact-unit values.

Product Master BOMs follow the same snapshot rule: copy active/effective BOM lines and provenance into ordered unit-owned equipment, preserve designer selections and overrides on explicit reimport, and freeze that equipment with Design Book review/release packages. Relinking to another Product Master retains the old BOM list only as manual equipment until the new BOM is explicitly imported; directly selected PIM Component and Product snapshots keep their own source identity.

**Why:** LSS compact units can contain reviewed application-specific overrides and fields with no compatible PIM meaning. Silent refreshes or client-asserted provenance would erase decisions, misstate the approved source, or change released design evidence.

**How to apply:** Copy only directly compatible values. Validate BOM and direct PIM provenance server-side, make reimport confirmed and atomic, and reconcile only prior BOM-owned rows on unambiguous source identity. Direct PIM and custom rows remain separate snapshots even when the BOM contains the same source. If a legacy BOM row names both a Component and Product, Component provenance takes precedence. Keep structured filtration in the unit-owned equipment list, and preserve legacy filtration text only when no structured list exists.