---
name: Project tank promotion
description: Boundary between project-owned tanks and reusable PIM tank records.
---

Promoting a project tank creates a separate reusable PIM record and must not convert or mutate the source project tank. Require explicit PIM manage authority and an editable linked Design Book, prevent repeat promotion, and retain an immutable source snapshot alongside the live source link.

**Why:** Project and released Design Book records must remain stable, while the reusable library still needs durable provenance after project cleanup.

**How to apply:** Any future promotion, clone, or library-link flow should preserve this separation and treat source identity as traceability, not ownership transfer.