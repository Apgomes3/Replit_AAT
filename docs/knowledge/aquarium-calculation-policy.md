---
name: Aquarium calculation policy
description: Approved units, volume basis, allocation policy, and override behavior for aquarium engineering calculations.
---

Aquarium turnover is expressed as cycles per hour and remains exhibit-specific when one LSS serves multiple exhibits; ambiguous system turnover is informational and must not invalidate otherwise usable system flow. Required flow uses effective operating volume: gross operating water volume less substrate and theming displacement. Surface-skim and bottom-drain allocations must total 100% within a 0.01 percentage-point tolerance. Manual system flow is opt-in metadata; otherwise linked systems use only the current linked-exhibit aggregate and show unavailable rather than falling back to a stored value. A saved tank or PIM surface area takes priority; otherwise, Custom tanks with valid outer length and width use outer L × W as their water footprint for display and height-based displacement.

Percentage-based theming stores the percentage as its authority, not a derived m³ cache. Resolve it against the current quantity-aware gross exhibit volume before displacement; direct m³ entries remain fixed. Historical records that contain both a percentage and a cached volume use the percentage when no theming height is active.

**Why:** Engineers need the same auditable definition across Design Book UI and API paths, while preserving engineering judgement and deliberate manual decisions.

**Why:** A cached percentage-derived displacement becomes stale when an outline, water level, or tank quantity changes; using net volume as the percentage basis compounds the error.

**How to apply:** Put new hydraulic or LSS formulas in the shared API calculation contract, return inputs/units/rounding/timestamp with results, and have UI paths render that contract rather than independently recomputing saved-state values. Show turnover beside each linked exhibit after design flow; do not use missing system-level turnover as an invalid-calculation reason. Treat a stored system flow as authoritative only when its source is explicitly manual. Preserve explicit saved surface areas; use outer L × W only as the fallback when both outer dimensions are available. Calculate percentage theming from the current gross exhibit basis on every read and freeze the resulting calculation only when creating a review or release snapshot.