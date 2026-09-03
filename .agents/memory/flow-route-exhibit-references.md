---
name: Flow Route exhibit references
description: Authority and allocation-separation rules for displaying exhibit hydraulic splits in Flow Route.
---

Flow Route source references aggregate every linked exhibit that contributes to system design flow, regardless of link label. Each linked exhibit retains its own surface-skimming and bottom-drain percentages and canonical flows; the displayed combined flow is their sum. If any linked exhibit calculation is missing, incomplete, invalid, or stale, the aggregate must render as unavailable rather than presenting a partial total or retaining an earlier value. “Surface Skim” maps to each exhibit’s “Surface Skimmer Box” component.

**Why:** Multi-exhibit LSS systems need the complete source-flow basis. Requiring one Primary link discarded valid skimming and bottom-drain contributions from the other exhibits and prevented reviewers from reconciling total flow.

**How to apply:** Read each linked exhibit’s percentages and canonical m³/h flows from the exhibit calculation contract and sum matching components before display conversion. Loop allocations always remain percentages of total system flow and reconcile toward 100%. Exactly one loop may use Foam Fractionation; its required equipment flow is the aggregate Surface Skim flow, independent of that loop’s allocation percentage. Bio/Degas remains a percentage of its resolved parent loop. Never derive or overwrite saved percentages from the exhibit split.