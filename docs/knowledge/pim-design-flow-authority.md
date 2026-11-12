---
name: PIM design-flow authority
description: Durable authority, synchronization, and conflict-resolution rules for Product Master and Hydraulic design flow.
---

Treat Hydraulic design flow as the engineering-facing authority, while persisting the same value on Product Master for compatibility. Any save, create, or duplicate path that can set design flow must update both records and the linked audit event in one transaction.

**Why:** The two fields historically drifted. Missing values can be backfilled without losing information, but two populated unequal values represent an engineering decision and must never be silently overwritten by an unrelated edit.

**How to apply:** Backfill a missing side from the populated side. Expose populated conflicts, require an explicit choice of Hydraulic or Product Master before resolving them, retain the prior values and selected source in audit history, and preserve unrelated Hydraulic specifications during flow-only edits.