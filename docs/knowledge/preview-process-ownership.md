---
name: Preview process ownership
description: Avoid false-positive readiness when old app processes retain the preview port.
---

Preview readiness must verify the application JavaScript loads, not just that the HTML responds or a workflow reports running. Keep the main app on its fixed preview port instead of allowing silent fallback to another port.

**Why:** Duplicate main-app processes have survived workflow transitions. A broken older process retained the preview port while a healthy new process served elsewhere, making successful restarts appear ineffective.

**How to apply:** When preview and workflow health disagree, inspect process ownership and test a transformed application module. Stop only confirmed stale main-app trees; leave unrelated artifact services alone.
