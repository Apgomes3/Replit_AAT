---
name: Weir formula selection
description: Policy for choosing and presenting Francis and Bazin weir calculations.
---

Francis is the recommended method for the approved sharp-crested rectangular, free-discharge case when head is 50–600 mm and H/L is at most 0.50. Bazin remains an explicit user-selected alternative, not an automatic fallback.

**Why:** Engineers need to compare methods based on head and the calculated head-to-crest-length ratio without the application silently changing the saved design basis.

**How to apply:** Persist the selected method with the geometry and operating conditions. Display the selected formula, coefficient, head, crest length, and H/L. Bazin requires at least 50 mm head; H/L above 0.50 is a visible engineering-review warning rather than a hidden method switch.