---
name: Design Book review snapshots
description: Why submitted Design Books use frozen packages while project records remain shared and editable.
---

Once a Design Book is submitted for review, reviewers, preflight checks, approval, and release must all use the same frozen point-in-time package. Optional handover reports are appended to that review package before approval. Engineering release blockers cannot be overridden by any role.

**Why:** Exhibits, tanks, LSS systems, links, and Flow Routes are shared project records. Reading them live during review would allow unrelated later project edits to silently change what a manager sees or releases.

**How to apply:** Capture the package in one repeatable-read transaction at submission. Keep Draft/In Progress views live; use the frozen review package for For Review and Approved, then derive the immutable release snapshot from it. The release API must return `RELEASE_BLOCKED` whenever the frozen package has any blocker, even if a client sends legacy override fields.