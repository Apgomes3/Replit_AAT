---
name: Thermal UV power authority
description: Defines the boundary between UV Selection engineering and downstream Thermal heat input.
---

Thermal must consume the UV Selection snapshot’s saved rated power and saved unit quantity as the complete UV heat input. It must not recalculate UV sizing or gate heat input on current flow, fluence, compatibility, freshness, or pass/fail status.

**Why:** UV Selection owns UV engineering and freezes the selected equipment values. Thermal is only a downstream consumer of that saved equipment power; recalculating or revalidating UV performance would create conflicting authority and unstable heat loads.

**How to apply:** Prefer the saved UV result stream. Use the saved input stream only for legacy snapshots that do not contain result streams. Mark the Thermal UV source incomplete only when the saved quantity or saved rated power is missing.