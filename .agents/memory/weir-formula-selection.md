---
name: Weir formula selection
description: Policy for choosing and presenting Francis and Bazin weir calculations.
---

Francis is the recommended method for the approved sharp-crested rectangular, free-discharge case when head is within the 50–600 mm preferred reference range and H/L is at most 0.50. Both Francis and Bazin still calculate below 50 mm, with a visible engineering-review warning. Bazin remains an explicit user-selected alternative, not an automatic fallback.

**Why:** Engineers need to compare methods based on head and the calculated head-to-crest-length ratio without the application silently changing the saved design basis.

**How to apply:** Persist the selected method with the geometry and operating conditions. Display the selected formula, coefficient, head, crest length, and H/L. A head below 50 mm is a visible engineering-review warning; H/L above 0.50 is also a visible review warning rather than a hidden method switch.

Persist the calculated skimmer-box opening length in millimetres as an auditable snapshot, but treat the live formula inputs as the source of truth.

**Why:** Flow, head, method, or boundary-condition changes can make a previously stored result stale even though the historical value is still useful.

**How to apply:** Recalculate in the UI whenever an input changes, compare the rounded result with the saved length, clearly mark changed results as unsaved, and persist the new result with the updated design basis.