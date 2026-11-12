---
name: Thermal plate selection
description: Governs how Thermal plate products and plate-side flow are selected and frozen.
---

Thermal plate selection uses the active steady-state cooling or heating duty from a current saved Thermal calculation. Heating selection excludes recovery heating. Plate-side flow must come from a Flow Route side stream whose preset is Thermal.

**Why:** The selected plate needs one auditable engineering basis. Allowing arbitrary or UV/custom streams would make the hydraulic source ambiguous, while including recovery heating would contradict the approved active-duty display policy.

**How to apply:** Require an active Product Master Thermal record with matching duty and sufficient canonical kW capacity. Freeze the required duty, resolved stream flow, product values, and Thermal source identity with the selection.