---
name: PostgreSQL concurrency test synchronization
description: Reliable coordination for database-backed tests that must prove one transaction blocks another.
---

Synchronize concurrency tests by capturing the holding connection's `pg_backend_pid()` and polling for a session whose `pg_blocking_pids(pid)` contains that exact PID.

**Why:** Fixed delays are flaky, and restricted database roles may expose blocker relationships while hiding other sessions' SQL text in `pg_stat_activity`.

**How to apply:** Use this when a test must wait until a competing operation is genuinely blocked before committing or rolling back the transaction that owns the lock.