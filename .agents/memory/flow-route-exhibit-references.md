---
name: Flow Route exhibit references
description: Authority and allocation-separation rules for displaying exhibit hydraulic splits in Flow Route.
---

Flow Route source references are authoritative only when exactly one Primary exhibit link resolves to a valid, fresh exhibit hydraulic calculation. Missing, duplicate, incomplete, invalid, or stale context must render as unavailable rather than falling back to another link or retaining an earlier value. “Surface Skim” maps to the exhibit’s “Surface Skimmer Box” component.

**Why:** Reviewers need a traceable exhibit source without an arbitrary link or stale calculation being presented as current.

**How to apply:** Read percentages and canonical m³/h flows from the exhibit calculation contract, then convert only for display. Keep the editable loop allocation as a percentage of total system flow and Bio/Degas as a percentage of that loop; never derive or overwrite either from the exhibit split.