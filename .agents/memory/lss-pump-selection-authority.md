---
name: LSS pump selection authority
description: Rules for circuit-level LSS pump sizing, evidence, and Design Book release readiness.
---

The Design Book’s calculated system flow is the sole authority for circuit-level pump sizing and lifecycle evidence.

**Why:** Using stored system flow for saves while showing calculated linked-exhibit flow can create contradictory engineering evidence. Formula changes or Flow Route changes can also invalidate an otherwise complete-looking selection.

**How to apply:** Keep display, sizing, freshness, and snapshots on that same flow basis. Treat changed assumptions or formulas as stale, and block release until active circuits have fresh ready selections.

Thermal equipment heat is a downstream consumer of the saved Pump Selection result, not a second pump-sizing authority.

**Why:** Revalidating Flow Route flow or catalog suitability while assembling Thermal heat can contradict Pump Selection and reject a usable saved shaft or motor-input power value. Thermal needs the frozen power result, not a newly resolved duty point.

**How to apply:** For external pumps, consume the saved shaft power per unit; for submerged pumps, consume the saved motor-input power per unit; multiply by saved quantity. Do not recalculate pump hydraulics or propagate current Flow Route freshness/suitability errors into Thermal. Warn only when the saved power result, installation basis, or quantity is missing.

The Design Book owns the project pump tag and the design values entered or calculated during sizing. A selected PIM Product Master is linked as the pump model, but it does not replace the Design Book’s tag or overwrite its engineering evidence.

**Why:** A catalog model identifies what pump is being used, while the Design Book records the project-specific duty point and assignment. Mixing those ownership boundaries would make catalog maintenance change historical project evidence unexpectedly.

**How to apply:** Create the project pump tag first, validate sizing against the authoritative Flow Route basis, then allow a separate model-link action. Preserve the tag, design values, and selected-model snapshot in review/released Design Book packages.

Pump lines are role-scoped within a circuit: the primary line uses the authoritative Flow Route duty, while an optional Foam Fractionator venturi line carries its own persisted, explicit flow basis.

**Why:** A venturi pump can serve a materially different duty from the supply pump. When governed product hydraulics are unavailable, the authoritative supply demand is a usable initial seed only if it is persisted visibly for review and independent editing.

**How to apply:** Enforce uniqueness on system, circuit, and role; seed FFVP from governed product venturi flow first or authoritative FFSP demand second; persist the seed, then keep FFSP and FFVP sizing independent.

Side-stream pump work is controlled by the explicit dedicated-pump decision saved in Flow Route. A No answer creates no active pump duty, while historical selections remain visible as stale/orphaned evidence.

**Why:** Parallel branches do not always have their own pump, and forcing one creates false readiness blockers. Existing engineering evidence must still remain auditable after the decision changes.

**How to apply:** Filter active pump and friction duties from saved side-stream intent, but never delete or detach prior selection snapshots merely because a branch is changed to No.

Pump quantity is part of the saved duty evidence, and identical pumps share the authoritative total duty evenly for per-pump sizing.

**Why:** Sizing every pump against the full loop flow overstates each unit when designers intentionally use two or more parallel pumps.

**How to apply:** Preserve total Flow Route duty, validate quantity as a positive whole number, calculate and display total flow divided by quantity, and include quantity in freshness evidence.

Pump duty tags and names come from the Platform Admin relationship registry, while each saved selection freezes the chosen relationship.

**Why:** Central administration keeps FFSP, FFVP, SFSP, CIRCP, and VACP terminology consistent without allowing later label edits to rewrite historical Design Book evidence.

**How to apply:** Derive FFSP, FFVP, and SFSP from saved Flow Route intent and known roles without a card selector. Prompt for an active origin only when creating a named pump for a new unknown loop; retain saved snapshots and generate one `<system number>-<duty tag>-<sequence>` tag per pump.

Pump model suggestions come from active PIM Pump-category products and must meet the saved per-pump flow and design-head duty. If none fit, create a Draft PIM pump product and link it through a project equipment item.

**Why:** Designers need a governed manufacturer/model choice without confusing the reusable PIM model with the project-specific pump tag. A draft fallback keeps missing catalog work visible and reviewable instead of hiding it in an unclassified equipment row.

**How to apply:** Filter suggestions only after quantity and head establish a duty point. Show only catalogue pumps with rated flow and head at or above that duty; do not carry an out-of-range current selection into the recommendation selector or submit it as a hidden value. Snapshot the linked product when sizing is saved.