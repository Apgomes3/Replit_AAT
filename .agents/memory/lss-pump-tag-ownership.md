---
name: LSS pump tag ownership
description: Defines how generated project pump tags are reclaimed when already attached to the wrong LSS duty.
---

A generated pump tag is authoritative for its governed LSS system and duty. If the same project tag already exists in the wrong location, reuse and update that project equipment record for the correct LSS instead of rejecting the save or creating another record.

**Why:** Project equipment tags must remain unique, but a misplaced generated tag should not block the location that legitimately owns it.

**How to apply:** Reassign the existing project equipment row transactionally, detach previous-system pump-selection references, and preserve the project-level uniqueness constraint. Repeat requests for the same duty remain idempotent.