---
name: Draft conflict boundary
description: How recovered edits and background refreshes interact with optimistic concurrency.
---

An editing session must retain the server revision it started from, including in its browser recovery copy. A background refresh or reopening a stale local draft must not substitute the currently loaded revision into a pending save. A changed revision requires explicit review and resolution rather than an automatic overwrite.

**Why:** A freshly loaded server record can have a valid new revision while the browser still holds older, unsaved work. Sending the fresh revision with that older work defeats concurrency protection even though the server correctly checks versions.

**How to apply:** For future high-value editors, capture the expected revision when the editing baseline is established, preserve it across local recovery, and advance it only after a confirmed save or an explicit choice to discard the older draft and reload.