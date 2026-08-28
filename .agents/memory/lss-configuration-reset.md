---
name: LSS configuration reset
description: Durable ownership and transaction boundary for changing an LSS system between compact and bespoke configurations.
---

Changing an LSS configuration must clear system-owned configuration, Flow Route, linked-exhibit, and selected-equipment data in one transaction, while leaving project tanks, exhibits, tank hydraulics, and reusable PIM source records untouched.

**Why:** Configuration-dependent LSS inputs can become invalid when switching between compact and bespoke systems, but the linked project and catalog records remain authoritative reusable sources.

**How to apply:** Keep reset behind editable Design Book and Projects-manage checks, lock both records during reset, and update client caches immediately so calculations from the previous configuration cannot reappear.