---
name: Browser integration boundary
description: How to keep live browser tests using the application API instead of importing server TypeScript into Playwright.
---

Playwright's loader in this workspace does not reliably import TypeScript modules from the API package: named imports appear as CommonJS, while switching to default import can then fail on the module's ESM syntax. Use the running API and a migrated development PostgreSQL database for end-to-end scenarios instead of calling API implementation functions from the Playwright process.

**Why:** Both import forms failed before the live-route approach worked. Testing only mocked network responses would not verify visibility and notification delivery in PostgreSQL.

**How to apply:** Start the existing API alongside the browser test, seed isolated records and users, authenticate through the real login route, and clean up those records after the test. Keep database-dependent scenarios behind a dedicated browser command so fixture-only runs remain self-contained.