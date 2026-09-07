---
name: LSS I/O schedule evidence
description: Evidence and grouping rules for generated controls I/O schedules.
---

Generate schedules from saved instrument instances, not current catalogue defaults. Group deterministically by panel and signal direction, with Input before Output, and retain each instance's tag, product snapshot, and saved control logic.

**Why:** An issued Design Book must remain reviewable even when live systems, products, or instrument definitions later change or disappear. Falling back to live data would silently rewrite approved controls evidence.

**How to apply:** Draft schedules may use the saved live Design Book package. For Review, Approved, and Released states, resolve the system and every schedule field from the applicable review/release snapshot; if that package is missing, fail closed rather than exporting live data.