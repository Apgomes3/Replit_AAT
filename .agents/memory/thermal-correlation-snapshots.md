---
name: Thermal correlation snapshots
description: Governance rule for approved evaporation correlations and project deviations.
---

Ready thermal calculations must use an approved shared-library correlation captured as an immutable snapshot. Superseding a library version must never rewrite or invalidate the evidence stored with an already saved or released calculation.

**Why:** Letting users type an “approved” flag recreates the invented-coefficient risk the governed library is intended to remove. A project deviation is auditable only when both the approved basis and the justified effective coefficient remain visible.

**How to apply:** Resolve new selections server-side from the approved library record, freeze its identity/version/coefficient/source, and require a written justification for any project-specific effective coefficient. Reject release evidence that lacks that governed snapshot.