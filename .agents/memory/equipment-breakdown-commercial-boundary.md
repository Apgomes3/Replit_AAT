---
name: Equipment Breakdown commercial boundary
description: Rules for keeping Design Book equipment schedules linked to engineering while independently editable for commercial work.
---

Equipment Breakdown is a live commercial workspace, not frozen engineering evidence. Refreshing it may add, update, or remove automatically sourced rows to match current LSS selections, but it must preserve every explicit commercial override and every manual proposal row. Biological Media contributes separate procurement rows for required bio crates and required media volume. Released Design Books remain commercially editable for users with Design Book manage permission. Source identity is internal linkage and must never appear in customer-facing exports.

Per-system Pipe/Fittings/Supports and Cable/Cable Tray/Supports allowances use an explicit percentage of the system cost subtotal, exclude all allowance lines from their basis, and convert source costs through governed exchange rates into the allowance currency.

Selling Price and Total Price are calculated commercial values, never independent overrides. Currency conversion uses administrator-managed fixed rates expressed as currency units per USD; RMB is displayed to users while CNY is stored. Changing currency converts Unit Cost atomically and then recalculates prices.

**Why:** Proposal, procurement, and business-development users need current engineering quantities and identities without exposing internal linkage or allowing price, supplier, markup, lead-time, exclusion, or note changes to alter engineering selections or become blocked by engineering release guards. Fixed audited exchange rates keep conversions consistent and reviewable rather than allowing live-market changes to rewrite commercial work.

**How to apply:** Keep read and export operations non-mutating. Put source synchronization behind manage permission, scope all writes to the requested Design Book and project, store commercial override state separately from source snapshots, and lock rows before refresh derives override-preserved values. Apply saved column visibility to both screen and workbook except that Source is always export-excluded.