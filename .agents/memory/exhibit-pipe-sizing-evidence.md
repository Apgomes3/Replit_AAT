---
name: Exhibit pipe sizing evidence
description: Governing recommendation, override, and evidence rules for exhibit inlet and weir-discharge pipes.
---

Recommend the smallest active standard DN whose calculated velocity is within the governed service band. Inlet uses total exhibit return flow and the pressure band; discharge after the weir uses surface-skim flow and the gravity band. One-size-up is an explicit selection and may be outside the target band, but that state must remain visible.

**Why:** Live admin standards can change after a design decision, and exhibit turnover or flow allocation can change after a pipe is selected. Showing only the current catalog would silently rewrite or stale the engineering basis.

**How to apply:** Freeze DN, internal diameter, applicable band, authoritative flow, velocity, and within-band status when saving. Recompute retained evidence atomically when governing exhibit hydraulics change, and carry evidence through review/version snapshots.