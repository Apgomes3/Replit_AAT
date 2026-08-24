---
name: PO vendor privacy
description: Privacy rule for vendor suggestions derived from purchase order history.
---

Vendor autocomplete results must use the same visibility boundary as the purchase-order list, rather than exposing every vendor name in the database.

**Why:** Vendor names are procurement data and can reveal information from purchase orders a user is not authorized to view.

**How to apply:** Preserve the created-by, designated-user, and current-stage-assignee visibility checks when changing or adding endpoints that suggest or aggregate PO vendors.