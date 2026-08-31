---
name: Product hydraulic catalog defaults
description: Rules for applying vendor-identified starting hydraulic values without overriding later operator edits.
---

Catalog-derived hydraulic values are starting values, not permanent fallbacks. Apply each identified default once per product and default version, and retain evidence that it was applied so later edits or intentional clearing remain authoritative.

**Why:** A repeatable migration that treats `NULL` as “not initialized” will silently restore a default after an operator deliberately blanks the field.

**How to apply:** Require positive catalog identification rather than a broad product-class default, record one-time application separately from the editable value, and keep create, duplicate, and migration identification rules aligned.