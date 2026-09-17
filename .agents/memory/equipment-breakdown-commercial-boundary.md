---
name: Equipment Breakdown commercial boundary
description: Rules for keeping Design Book equipment schedules linked to engineering while independently editable for commercial work.
---

Equipment Breakdown is a live commercial workspace, not frozen engineering evidence. Refreshing it may add, update, or remove automatically sourced rows to match current LSS selections, but it must preserve every explicit commercial override and every manual proposal row. Released Design Books remain commercially editable for users with Design Book manage permission.

**Why:** Proposal, procurement, and business-development users need current engineering identities without allowing price, supplier, markup, lead-time, exclusion, or note changes to alter engineering selections or become blocked by engineering release guards.

**How to apply:** Keep read and export operations non-mutating. Put source synchronization behind manage permission, scope all writes to the requested Design Book and project, and store commercial override state separately from source snapshots.