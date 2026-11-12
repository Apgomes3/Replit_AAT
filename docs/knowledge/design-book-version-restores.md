---
name: Design Book version restores
description: The durable boundary and safety rules for restorable Design Book versions.
---

Design Book versions freeze Design Book-owned metadata and child records, while project entities such as exhibits, tanks, LSS systems, and exhibit-system links remain live references. Restores update the working copy rather than creating a new revision.

**Why:** Project entities are shared outside a Design Book. Rewriting them from a version could destroy unrelated project work, while silently ignoring deleted references could produce an incomplete restore.

**How to apply:** Show drift for changed live references and block restore when references are unresolved. Bind confirmation to the current state, create a recovery checkpoint, and apply the checkpoint, restored rows, lineage record, and audit entry in one transaction. Older snapshots must preserve collections they did not capture.