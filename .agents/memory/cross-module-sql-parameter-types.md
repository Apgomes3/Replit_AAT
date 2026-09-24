---
name: Cross-module SQL parameter types
description: PostgreSQL parameter inference when optional cross-module search adapters are excluded.
---

Declare typed authentication parameters in every query variant of a dynamic cross-module union, including empty and single-module sources.

**Why:** PostgreSQL cannot infer the type of a bound parameter when role or module filtering removes the only adapter that referenced it. Search looked correct for all-module requests but failed with a database error for client-only and audit-only filters.

**How to apply:** When extending optional union adapters or building separate count and page queries, keep the parameter positions and explicit types valid for every possible adapter subset; smoke-test a single adapter as well as the full union.