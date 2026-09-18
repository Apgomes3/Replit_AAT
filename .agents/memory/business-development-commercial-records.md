---
name: Business Development commercial records
description: Governing hierarchy, source-link, approval, and currency rules for Business Books, estimates, quotes, and proposals.
---

A Business Book represents one client project and may exist standalone or link to Project Management. It can contain multiple opportunities covering separate scopes, packages, or sales attempts.

**Why:** Commercial work often begins before a managed project exists, and one client project can involve several independent pursuits.

**How to apply:** Keep Business Books as durable commercial workspaces. Copy client/project details when linking rather than continuously inheriting them, and preserve explicit traceability to Project and Design Book sources.

Draft quotes remain linked to their estimate until issue. Issued estimates, quotes, and proposals freeze their pricing, currencies, exchange rates, source revisions, wording, and approval evidence.

**Why:** Upstream engineering and pricing continue to change, but issued customer commitments must remain reproducible.

**How to apply:** Show source differences and require explicit refresh or revision. Never silently mutate an issued record.

Commercial documents require manager approval, and an author cannot approve their own document. Controlled numbers are generated automatically. Each quote may use its own selling currency.

**Why:** The agreed workflow requires separation of duties, reliable document identity, and flexibility for client-facing currencies.

**How to apply:** Enforce approval separation on the server, allocate numbers transactionally, and never combine unlike currencies into one total without governed conversion.