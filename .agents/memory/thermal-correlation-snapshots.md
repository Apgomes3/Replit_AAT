---
name: Thermal correlation snapshots
description: Governance rule for approved evaporation correlations and project deviations.
---

Ready thermal calculations must use an approved shared-library correlation captured as an immutable snapshot. Superseding a library version must never rewrite or invalidate the evidence stored with an already saved or released calculation. Retirement confirmation must be bound to the exact current usage set and serialize against thermal saves and Design Book lifecycle transitions.

**Why:** Letting users type an “approved” flag recreates the invented-coefficient risk the governed library is intended to remove. A project deviation is auditable only when both the approved basis and the justified effective coefficient remain visible. UI-only confirmation can become stale while calculations are saved or books enter review/release, so it cannot safely govern retirement by itself.

**How to apply:** Resolve new selections server-side from the approved library record, freeze its identity/version/coefficient/source, and require a written justification for any project-specific effective coefficient. Reject release evidence that lacks that governed snapshot. Before retirement, show usage from live editable records and frozen review/release packages, then revalidate a server-bound acknowledgement while holding the correlation and impacted Design Books stable.