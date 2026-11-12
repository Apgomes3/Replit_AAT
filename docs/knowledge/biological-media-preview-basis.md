---
name: Biological Media preview basis
description: Engineering and lifecycle boundaries for deterministic Biological Media sizing previews.
---

Biological Media concept previews use TAN nitrogen as the sizing mass basis, an approved overall-VTR profile, and the profile safety factor exactly once. NH3 molecular-mass conversion is display-only.

**Why:** Mixing mass bases or reapplying the safety factor silently changes required media, while a mutable preview must not be mistaken for an approved engineering run.

**How to apply:** Keep formulas server-side and deterministic, gate on approved compatible profile revisions and operating envelopes, mark prior previews stale after any draft edit, and label preview output as non-certified.