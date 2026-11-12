---
name: Exhibit environmental inheritance
description: Governs copying environmental design values when creating an exhibit from a previous exhibit.
---

New Design Book exhibits may optionally copy water type and the minimum/maximum design temperature from an existing exhibit in the same project. This is a one-time creation aid, not a persistent relationship; the copied values remain editable and later source changes never propagate.

**Why:** Related exhibits often share environmental design conditions, but a live link would let later edits silently change established exhibit requirements.

**How to apply:** Validate that the source belongs to the same project, use inherited values only where creation inputs are missing, never mutate the source, and do not store an ongoing parent/link reference.