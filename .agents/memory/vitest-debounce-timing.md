---
name: Vitest debounce timing
description: Reliable timer usage for React Query and Testing Library debounce tests in this workspace.
---

For React Query UI tests, use fake timers only while checking that a debounce coalesces requests, then restore real timers before `findBy*` or `waitFor` assertions.

**Why:** Testing Library's async polling and React Query state updates can stall or remain visibly loading when fake timers stay active or are switched immediately after advancing a fetch.

**How to apply:** Use real-time waits for tests that need to observe the settled result or loading transition; reserve fake timers for precise request-count and debounce-boundary checks.