---
name: Thermal correlation snapshots
description: Governance rule for approved evaporation correlations and project deviations.
---

Ready thermal calculations must use an approved shared-library correlation captured as an immutable snapshot. Database defaults, effective values, and override flags stay separate in that evidence. Superseding a library version must never rewrite or invalidate the evidence stored with an already saved or released calculation. Retirement confirmation must be bound to the exact current usage set and serialize against thermal saves and Design Book lifecycle transitions.

**Why:** Letting users type an “approved” flag or submit a legacy adjacent-correlation map recreates the invented-coefficient risk the governed library is intended to remove. A project deviation is auditable only when both the approved basis and justified effective values remain visible. UI-only confirmation can become stale while calculations are saved or books enter review/release, so it cannot safely govern retirement by itself.

**How to apply:** Resolve selections and every adjacent sensitivity value server-side from the locked approved record; never preserve client-supplied correlation maps. Freeze identity, version, database defaults, effective values, override flags, and source, and require a written justification for project-specific overrides. Reject release evidence without that governed snapshot. Before retirement, show usage from live editable records and frozen review/release packages, then revalidate a server-bound acknowledgement while holding the correlation and impacted Design Books stable.