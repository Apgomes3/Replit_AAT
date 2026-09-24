---
name: Notification schema compatibility
description: Legacy notification storage differs from freshly installed schema, affecting event delivery SQL.
---

When expanding notifications, validate the delivery insert against a migrated development database, not just mocked queries. Keep record identity storage compatible with older inboxes and use explicit casts on parameters selected into typed columns.

**Why:** The older inbox table was provisioned outside the main migration and stored record identities as UUIDs. A new installation's schema may not match it. PostgreSQL also inferred a parameter selected through `SELECT DISTINCT` as text when the insert target expected boolean; unit mocks passed while a real transaction failed.

**How to apply:** For future inbox schema changes, migrate older columns explicitly and run a rollback-only insert and duplicate-key replay against PostgreSQL before considering delivery durable.