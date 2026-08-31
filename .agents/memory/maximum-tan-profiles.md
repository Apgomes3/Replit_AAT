---
name: Maximum TAN profiles
description: Governance boundary between TAN-generation coefficients and Maximum TAN concentration assumptions.
---

Maximum TAN concentration profiles are a separate controlled library from TAN-generation profiles. Cases freeze both the source identity and resolved mg N/L value; Custom is explicit and is never an approved controlled profile.

**Why:** TAN generation describes nitrogen produced from feed, while Maximum TAN is a water-concentration assumption used by ammonia speciation, operating-envelope checks, and optional hydraulics. Combining them would make historical calculations ambiguous.

**How to apply:** Resolve defaults only for new or incomplete cases, never overwrite a saved value, snapshot source plus value in immutable runs, and block new controlled-profile evidence after that revision is retired.