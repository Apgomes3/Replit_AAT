---
name: Aquarium calculation policy
description: Approved units, volume basis, allocation policy, and override behavior for aquarium engineering calculations.
---

Aquarium turnover is expressed as cycles per hour. Required flow uses effective operating volume: gross operating water volume less substrate and theming displacement. Surface-skim and bottom-drain allocations must total 100% within a 0.01 percentage-point tolerance. Saved values that differ from calculated values remain explicit overrides rather than being silently synchronized. Custom-tank surface area is explicit; designers may confirm L × W only when those dimensions truly represent the water footprint, and that confirmed area can support height-based displacement calculations.

**Why:** Engineers need the same auditable definition across Design Book UI and API paths, while preserving engineering judgement and deliberate manual decisions.

**How to apply:** Put new hydraulic or LSS formulas in the shared API calculation contract, return inputs/units/rounding/timestamp with results, and have UI paths render that contract rather than independently recomputing saved-state values. Never infer irregular Custom footprints silently; preserve the explicit confirmed area.