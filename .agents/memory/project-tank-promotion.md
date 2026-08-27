---
name: Project tank promotion
description: Boundary between project-owned tanks and reusable PIM tank records.
---

Promoting a project tank creates a separate reusable PIM record and must not convert or mutate the source project tank. Require explicit PIM manage authority and an editable linked Design Book, prevent repeat promotion, and retain an immutable source snapshot alongside the live source link.

**Why:** Project and released Design Book records must remain stable, while the reusable library still needs durable provenance after project cleanup.

**How to apply:** Any future promotion, clone, or library-link flow should preserve this separation and treat source identity as traceability, not ownership transfer.

PIM-linked project tanks must continue inheriting library values until a designer explicitly chooses a project-specific override.

**Why:** Materializing effective library values during creation or unrelated edits silently freezes inheritance and obscures whether a value is reusable or project-specific.

**How to apply:** Keep inherited and overridden values distinguishable throughout editing, calculations, and review snapshots, and protect any operation that establishes a library relationship.