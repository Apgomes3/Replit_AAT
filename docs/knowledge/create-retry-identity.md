---
name: Create retry identity
description: Distinguishing an uncertain create retry from a genuinely new record.
---

When a browser can lose a create response, keep a stable idempotency key with the user's recovery draft and reuse it on every retry until the created record is confirmed. Scope the key to the creator and record type; rotate it when a draft is discarded or a new record is started.

**Why:** A lost response is not evidence that the create failed. Generating a new key during a retry can create a duplicate even when the browser retained the entered form.

**How to apply:** Persist the draft and its key synchronously before sending a create request, not only in an asynchronous UI effect. On the server, resolve concurrent requests within the transaction before allocating numbers or writing related records. Keep the existing record and its effects unchanged on replay.