---
name: Flow Route side streams
description: Allocation semantics for side streams branching from a main Flow Route loop.
---

Each side stream is independently allocated from 0% through 100% of its parent loop. Sibling side-stream percentages are not portions of a shared budget and must never be summed or limited to a combined 100%.

**Why:** Side streams model parallel branches that may each receive the parent loop's full design flow under different operating conditions.

**How to apply:** Validate every side stream's percentage independently, including standalone and bulk save paths. Multiple siblings at 100% are valid; only the three main-loop allocations share the system-level 100% limit.