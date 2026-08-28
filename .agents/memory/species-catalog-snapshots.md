---
name: Species catalog snapshots
description: Durable rules for catalog-backed exhibit allocations and catalog seed maintenance.
---

Catalog-backed exhibit allocations capture scientific/common names, planning size, reference mass, and resolved biomass when selected. Same-link edits must keep those captured values unless the user explicitly refreshes or reselects the catalog record.

**Why:** Catalog corrections must not silently rewrite historical exhibit decisions, including ordinary quantity or notes edits.

**How to apply:** Treat catalog values as copy-on-select planning references. Keep override metadata explicit, preserve captured fields in versions/releases/restores, and require an explicit refresh action to adopt later catalog changes.

Catalog seed maintenance must deactivate superseded records rather than delete them.

**Why:** Deletion can clear live allocation links through foreign-key behavior and make stored version snapshots impossible to restore.

**How to apply:** Keep stable catalog identities indefinitely once allocations may reference them; retire records with active status and retain provenance.