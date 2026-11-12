---
name: LSS control draft grouping
description: How saved control instances retain independent valve group identities when hydrated into editable drafts.
---

Determine whether a saved control instance is a grouped valve from its active or frozen definition before hydrating the editable draft. Once normalized, draft identity may use the retained group key directly.

**Why:** Lightweight editable drafts intentionally omit catalogue tag metadata. Re-evaluating valve status from a draft therefore collapses valid size-group keys to a legacy key, causing edits to create duplicate groups or update the wrong evidence.

**How to apply:** Any control-panel hydration or draft-key refactor must normalize valve status while definition metadata is available, discard stray group keys for non-valves, and preserve the normalized key throughout edits and saves.